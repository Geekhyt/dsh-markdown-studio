import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiHostError, type AiHostService } from '../application/ai-service';
import {
  checkHostAuthJson,
  clampActionLabel,
  headerValue,
  type HostAuthChecker,
  isAllowedOrigin,
  isJsonContentType,
  isLoopbackReq,
  RequestBodyError,
  readJsonObjectBody,
  sendJson,
} from './routes';

export const AI_ROUTE_PATH = '/api/markdown-studio/ai';
export const MAX_AI_BODY_BYTES = 1024 * 1024;

function writeNdjson(res: ServerResponse, event: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || res.closed) return;
  res.write(JSON.stringify(event) + '\n');
}

function verifyRequestEnvelope(req: IncomingMessage, res: ServerResponse, checkAuth?: HostAuthChecker): boolean {
  if (req.method !== 'POST') {
    sendJson(
      res,
      405,
      { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
      { allow: 'POST' },
    );
    return false;
  }
  if (!isLoopbackReq(req)) {
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
  if (!checkHostAuthJson(req, res, checkAuth)) return false;
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
  teardownSignal?: AbortSignal,
): Promise<void> {
  if (res.destroyed || res.closed || res.socket?.destroyed) return;
  const controller = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort();
  };
  const onTeardown = (): void => {
    controller.abort();
  };
  if (teardownSignal?.aborted) controller.abort();
  else teardownSignal?.addEventListener('abort', onTeardown, { once: true });
  res.on('close', onClose);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
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
      writeNdjson(res, { type: 'error', code: 'INTERNAL', message: 'AI 服务内部错误' });
    }
  } finally {
    res.removeListener('close', onClose);
    teardownSignal?.removeEventListener('abort', onTeardown);
    if (!res.writableEnded && !res.destroyed && !res.closed) res.end();
  }
}

export function createAiRoute(options: {
  service: AiHostService;
  maxBodyBytes?: number;
  signal?: AbortSignal;
  checkAuth?: HostAuthChecker;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  const maxBodyBytes = options.maxBodyBytes || MAX_AI_BODY_BYTES;
  const teardownSignal = options.signal;

  return async function aiRoute(req, res) {
    try {
      if (!verifyRequestEnvelope(req, res, options.checkAuth)) return;
      const body = await readJsonObjectBody(req, maxBodyBytes);
      const action = typeof body.action === 'string' ? body.action : '';
      if (action === 'ai.status') {
        sendJson(res, 200, { ok: true, ...(await service.status()) });
        return;
      }
      if (action === 'ai.stream') {
        await handleStreamAction(service, body, res, teardownSignal);
        return;
      }
      sendJson(res, 400, {
        ok: false,
        error: { code: 'UNKNOWN_ACTION', message: '未知操作: ' + clampActionLabel(action) },
      });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        const closeHeaders: Record<string, string> =
          error.code === 'BODY_TOO_LARGE' || error.code === 'REQUEST_TIMEOUT' ? { connection: 'close' } : {};
        const status = error.code === 'BAD_JSON' ? 200 : error.status;
        sendJson(
          res,
          status,
          { ok: false, error: { code: error.code, message: error.message, hint: '' } },
          closeHeaders,
        );
        return;
      }
      if (error instanceof AiHostError) {
        sendJson(res, 200, { ok: false, error: { code: error.code, message: error.message, hint: error.hint } });
        return;
      }
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'AI 服务内部错误' } });
    }
  };
}
