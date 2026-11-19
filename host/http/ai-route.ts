import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiHostError, type AiHostService } from '../application/ai-service';

export const AI_ROUTE_PATH = '/api/markdown-studio/ai';
export const MAX_AI_BODY_BYTES = 512 * 1024;

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function isLoopback(remote: string): boolean {
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

/** Exact MIME essence check: `text/plain;x=application/json` must not pass as JSON. */
function isJsonContentType(value: string): boolean {
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

function isAllowedOrigin(origin: string, host: string, site: string): boolean {
  if (!origin) return true;
  // An opaque `null` origin is only trusted when the browser vouches for it via Sec-Fetch-Site.
  if (origin === 'null') return site === 'same-origin' || site === 'none';
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    return parsed.host === host;
  } catch (error) {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function writeNdjson(res: ServerResponse, event: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.write(JSON.stringify(event) + '\n');
}

async function readJsonObject(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: unknown) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > limit) {
        fail(new AiHostError('BODY_TOO_LARGE', '请求内容超出限制'));
        if (typeof req.pause === 'function') req.pause();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new AiHostError('BAD_JSON', '请求体必须是 JSON 对象'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(new AiHostError('BAD_JSON', '请求 JSON 无法解析'));
      }
    });
    req.on('error', fail);
  });
}

function verifyRequestEnvelope(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    return false;
  }
  const remote = req.socket?.remoteAddress ? String(req.socket.remoteAddress) : '';
  if (!isLoopback(remote)) {
    sendJson(res, 403, { ok: false, error: { code: 'LOOPBACK_ONLY', message: 'AI 接口仅允许本机访问' } });
    return false;
  }
  const host = headerValue(req.headers.host);
  const origin = headerValue(req.headers.origin);
  const site = headerValue(req.headers['sec-fetch-site']).toLowerCase();
  if (!isAllowedOrigin(origin, host, site)) {
    sendJson(res, 403, { ok: false, error: { code: 'ORIGIN_REJECTED', message: '请求来源不被允许' } });
    return false;
  }
  if (!isJsonContentType(headerValue(req.headers['content-type']))) {
    sendJson(res, 415, { ok: false, error: { code: 'CONTENT_TYPE_REQUIRED', message: '需要 application/json 请求' } });
    return false;
  }
  return true;
}

async function handleStreamAction(
  service: AiHostService,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-accel-buffering', 'no');
  try {
    const route = await service.stream(
      body,
      (delta) => {
        writeNdjson(res, { type: 'delta', text: delta });
      },
      controller.signal,
    );
    writeNdjson(res, { type: 'done', provider: route.provider, model: route.model });
  } catch (error) {
    if (error instanceof AiHostError) {
      writeNdjson(res, { type: 'error', code: error.code, message: error.message, hint: error.hint });
    } else {
      writeNdjson(res, {
        type: 'error',
        code: 'INTERNAL',
        message: 'AI 服务内部错误',
      });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export function createAiRoute(options: {
  service: AiHostService;
  maxBodyBytes?: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  const maxBodyBytes = options.maxBodyBytes || MAX_AI_BODY_BYTES;

  return async function aiRoute(req, res) {
    try {
      if (!verifyRequestEnvelope(req, res)) return;
      const body = await readJsonObject(req, maxBodyBytes);
      const action = typeof body.action === 'string' ? body.action : '';
      if (action === 'ai.status') {
        sendJson(res, 200, { ok: true, ...(await service.status()) });
        return;
      }
      if (action === 'ai.stream') {
        await handleStreamAction(service, body, res);
        return;
      }
      sendJson(res, 400, { ok: false, error: { code: 'UNKNOWN_ACTION', message: '未知操作: ' + action } });
    } catch (error) {
      if (error instanceof AiHostError) {
        if (error.code === 'BODY_TOO_LARGE' && !res.headersSent) {
          res.setHeader('connection', 'close');
        }
        sendJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 200, {
          ok: false,
          error: { code: error.code, message: error.message, hint: error.hint },
        });
        return;
      }
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'AI 服务内部错误' } });
    }
  };
}
