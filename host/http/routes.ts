/*
 * HTTP routes for the local image store.
 *
 * Loopback + JSON + origin checks are the write boundary; the local read
 * server is separate. No route exposes configuration or secrets.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ImageHostError, type ImageHostService } from '../application/image-store';

export const ROUTE_PATH = '/api/markdown-studio/wechat';
export const ASSET_PREFIX = '/api/markdown-studio/assets/';
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

function contentLengthExceeds(req: IncomingMessage, limit: number): boolean {
  const raw = headerValue(req.headers['content-length']).trim();
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > limit;
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (contentLengthExceeds(req, limit)) {
    throw new ImageHostError('BODY_TOO_LARGE', '请求内容过大', '请减少一次上传的图片数量。');
  }
  return await new Promise(function (resolve, reject) {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    function cleanup(): void {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      req.removeListener('close', onClose);
    }
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      cleanup();
      reject(error);
    }
    function onData(chunk: unknown): void {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) {
        fail(new ImageHostError('BODY_TOO_LARGE', '请求内容过大', '请减少一次上传的图片数量。'));
        if (typeof req.pause === 'function') req.pause();
        return;
      }
      chunks.push(buffer);
    }
    function onEnd(): void {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        chunks.length = 0;
        const parsed: unknown = text ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new ImageHostError('BAD_JSON', '请求 JSON 必须是对象'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(new ImageHostError('BAD_JSON', '请求 JSON 无法解析'));
      }
    }
    function onError(error: Error): void {
      fail(error);
    }
    function onAborted(): void {
      fail(new ImageHostError('BAD_JSON', '请求连接已提前断开'));
    }
    function onClose(): void {
      if (!req.complete) fail(new ImageHostError('BAD_JSON', '请求连接已提前断开'));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
  });
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

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

/** Exact MIME essence check: `text/plain;x=application/json` must not pass as JSON. */
function isJsonContentType(value: string): boolean {
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

const ALLOWED_DESKTOP_PROTOCOLS = new Set(['dsh-app:', 'dsh:', 'app:', 'file:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLoopbackHostHeader(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL('http://' + trimmed);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isLoopbackReq(req: IncomingMessage): boolean {
  const remote = req.socket?.remoteAddress ? String(req.socket.remoteAddress) : '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function isAllowedOrigin(origin: string, host: string, site: string): boolean {
  if (host && !isLoopbackHostHeader(host)) return false;
  if (!origin) return site !== 'cross-site';
  // An opaque `null` origin is only trusted when the browser vouches for it via Sec-Fetch-Site.
  if (origin === 'null') return site === 'same-origin' || site === 'none';
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (error) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return ALLOWED_DESKTOP_PROTOCOLS.has(parsed.protocol);
  }
  return (
    Boolean(host) &&
    parsed.host.toLowerCase() === host.toLowerCase() &&
    LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  );
}

function validateImageRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    return false;
  }
  if (!isLoopbackReq(req)) {
    sendJson(res, 403, { ok: false, error: { code: 'LOOPBACK_ONLY', message: '图片接口仅允许本机访问' } });
    return false;
  }
  const host = headerValue(req.headers.host);
  const origin = headerValue(req.headers.origin);
  const site = headerValue(req.headers['sec-fetch-site']).toLowerCase();
  if (!isAllowedOrigin(origin, host, site)) {
    sendJson(res, 403, {
      ok: false,
      error: {
        code: 'ORIGIN_REJECTED',
        message: '请求来源不被允许',
        hint:
          'origin=' + (origin || '(none)') + ' host=' + (host || '(none)') + ' sec-fetch-site=' + (site || '(none)'),
      },
    });
    return false;
  }
  if (!isJsonContentType(headerValue(req.headers['content-type']))) {
    sendJson(res, 415, {
      ok: false,
      error: { code: 'CONTENT_TYPE_REQUIRED', message: '需要 application/json 请求' },
    });
    return false;
  }
  return true;
}

async function dispatchImageAction(
  service: ImageHostService,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'health') {
    sendJson(res, 200, { ok: true, service: 'markdown-studio-images', version: 5, ...service.info() });
    return;
  }
  if (action === 'asset.store') {
    const result = await service.storeAsset({ dataUrl: body.dataUrl, filename: body.filename });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  if (action === 'asset.list') {
    sendJson(res, 200, { ok: true, ...(await service.listAssets()) });
    return;
  }
  if (action === 'asset.delete') {
    sendJson(res, 200, { ok: true, ...(await service.deleteAsset(body)) });
    return;
  }
  sendJson(res, 400, { ok: false, error: { code: 'UNKNOWN_ACTION', message: '未知操作: ' + action } });
}

export function createImageRoute(options: {
  service: ImageHostService;
  maxBodyBytes?: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  if (!service) throw new Error('createImageRoute needs a service');
  const maxBodyBytes = options.maxBodyBytes || MAX_BODY_BYTES;

  return async function imageRoute(req, res) {
    try {
      if (!validateImageRequest(req, res)) return;
      const body = await readJsonBody(req, maxBodyBytes);
      await dispatchImageAction(service, body, res);
    } catch (error) {
      if (error instanceof ImageHostError) {
        if (error.code === 'BODY_TOO_LARGE' && !res.headersSent) {
          res.setHeader('connection', 'close');
          sendJson(res, 413, {
            ok: false,
            error: { code: error.code, message: error.message, hint: error.hint, detail: error.detail },
          });
          return;
        }
        sendJson(res, 200, {
          ok: false,
          error: { code: error.code, message: error.message, hint: error.hint, detail: error.detail },
        });
        return;
      }
      sendJson(res, 500, {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: '图片服务内部错误',
          hint: '请稍后重试。',
        },
      });
    }
  };
}

function sendAssetText(res: ServerResponse, status: number, text: string, headOnly = false): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(headOnly ? undefined : text);
}

export function createAssetRoute(options: {
  service: ImageHostService;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  if (!service) throw new Error('createAssetRoute needs a service');

  return async function assetRoute(req, res) {
    try {
      if (!isLoopbackReq(req) || !isLoopbackHostHeader(headerValue(req.headers.host))) {
        sendAssetText(res, 403, 'loopback only', req.method === 'HEAD');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendAssetText(res, 405, 'method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname.indexOf(ASSET_PREFIX) !== 0) {
        sendAssetText(res, 404, 'not found');
        return;
      }
      const asset = await service.readAsset(pathname.slice(ASSET_PREFIX.length));
      if (!asset) {
        sendAssetText(res, 404, 'not found');
        return;
      }
      res.writeHead(200, {
        'content-type': asset.mime,
        'content-length': asset.buffer.length,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : asset.buffer);
    } catch {
      if (!res.headersSent) sendAssetText(res, 500, 'internal error', req.method === 'HEAD');
      else res.end();
    }
  };
}
