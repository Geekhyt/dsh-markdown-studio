/*
 * HTTP routes for the local image store.
 *
 * Loopback + JSON + origin + DSH session auth checks form the write boundary;
 * the local read server is separate. No route exposes configuration or secrets.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ImageHostError, type ImageHostService } from '../application/image-store';

export const ROUTE_PATH = '/api/markdown-studio/wechat';
export const ASSET_PREFIX = '/api/markdown-studio/assets/';
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BODY_READ_TIMEOUT_MS = 30_000;
const HEALTH_READY_WAIT_MS = 1500;

export type HostAuthChecker = (req: IncomingMessage) => 401 | 403 | undefined;

export class RequestBodyError extends Error {
  readonly code: 'BODY_TOO_LARGE' | 'REQUEST_TIMEOUT' | 'BAD_JSON';
  readonly status: number;

  constructor(code: 'BODY_TOO_LARGE' | 'REQUEST_TIMEOUT' | 'BAD_JSON', status: number, message: string) {
    super(message);
    this.name = 'RequestBodyError';
    this.code = code;
    this.status = status;
  }
}

function contentLengthExceeds(req: IncomingMessage, limit: number): boolean {
  const raw = headerValue(req.headers['content-length']).trim();
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > limit;
}

export async function readJsonObjectBody(
  req: IncomingMessage,
  limit: number,
  timeoutMs = BODY_READ_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  if (contentLengthExceeds(req, limit)) {
    throw new RequestBodyError('BODY_TOO_LARGE', 413, '请求内容过大');
  }
  if (req.destroyed || req.aborted) {
    throw new RequestBodyError('BAD_JSON', 400, '请求连接已提前断开');
  }
  if (req.readableEnded) return {};
  return await new Promise(function (resolve, reject) {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(function () {
      fail(new RequestBodyError('REQUEST_TIMEOUT', 408, '读取请求超时'));
      if (typeof req.destroy === 'function') req.destroy();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    function cleanup(): void {
      clearTimeout(timer);
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
        fail(new RequestBodyError('BODY_TOO_LARGE', 413, '请求内容过大'));
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
          reject(new RequestBodyError('BAD_JSON', 400, '请求 JSON 必须是对象'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new RequestBodyError('BAD_JSON', 400, '请求 JSON 无法解析'));
      }
    }
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => fail(new RequestBodyError('BAD_JSON', 400, '请求连接已提前断开'));
    const onClose = (): void => {
      if (!req.complete) fail(new RequestBodyError('BAD_JSON', 400, '请求连接已提前断开'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
  });
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  if (res.headersSent || res.destroyed || res.closed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  for (const [key, val] of Object.entries(extraHeaders)) res.setHeader(key, val);
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

export function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

/** Exact MIME essence check: `text/plain;x=application/json` must not pass as JSON. */
export function isJsonContentType(value: string): boolean {
  return value.split(';')[0].trim().toLowerCase() === 'application/json';
}

const TRUSTED_ELECTRON_PROTOCOLS = new Set(['dsh-app:', 'dsh:', 'app:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const STRICT_LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/i;

export function isLoopbackHostHeader(host: string): boolean {
  const trimmed = host.trim();
  const match = STRICT_LOOPBACK_HOST.exec(trimmed);
  if (!match) return false;
  if (!match[1]) return true;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isLoopbackReq(req: IncomingMessage): boolean {
  const remote = req.socket?.remoteAddress ? String(req.socket.remoteAddress) : '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function isCleanDesktopOrigin(parsed: URL, normOrigin: string): boolean {
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname && parsed.pathname !== '/') return false;
  return Boolean(parsed.hostname) && normOrigin.toLowerCase() === `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

export function isAllowedOrigin(origin: string, host: string, site: string): boolean {
  if (!isLoopbackHostHeader(host)) return false;
  const normSite = site.trim().toLowerCase();
  const normOrigin = origin.trim();
  if (!normOrigin) return normSite === '' || normSite === 'same-origin' || normSite === 'none';
  // An opaque `null` origin is only trusted when the browser vouches for it via Sec-Fetch-Site.
  if (normOrigin === 'null') return normSite === 'same-origin' || normSite === 'none';
  let parsed: URL;
  try {
    parsed = new URL(normOrigin);
  } catch {
    return false;
  }
  if (TRUSTED_ELECTRON_PROTOCOLS.has(parsed.protocol)) {
    return isCleanDesktopOrigin(parsed, normOrigin);
  }
  if (normSite === 'cross-site') return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.origin.toLowerCase() !== normOrigin.toLowerCase()) return false;
  try {
    const canonicalHost = new URL(parsed.protocol + '//' + host.trim()).host.toLowerCase();
    return parsed.host.toLowerCase() === canonicalHost && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function checkHostAuthJson(req: IncomingMessage, res: ServerResponse, checkAuth?: HostAuthChecker): boolean {
  const rejection = checkAuth?.(req);
  if (rejection === undefined) return true;
  sendJson(res, rejection, {
    ok: false,
    error: {
      code: rejection === 401 ? 'UNAUTHORIZED' : 'ORIGIN_REJECTED',
      message: rejection === 401 ? '宿主会话未认证' : '请求来源不被允许',
    },
  });
  return false;
}

export function clampActionLabel(action: string): string {
  return action.length > 64 ? action.slice(0, 64) + '…' : action;
}

function validateImageRequest(req: IncomingMessage, res: ServerResponse, checkAuth?: HostAuthChecker): boolean {
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
  if (!checkHostAuthJson(req, res, checkAuth)) return false;
  if (!isJsonContentType(headerValue(req.headers['content-type']))) {
    sendJson(res, 415, {
      ok: false,
      error: { code: 'CONTENT_TYPE_REQUIRED', message: '需要 application/json 请求' },
    });
    return false;
  }
  return true;
}

async function waitBounded(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!promise) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function dispatchImageAction(
  service: ImageHostService,
  body: Record<string, unknown>,
  res: ServerResponse,
  readyPromise?: Promise<unknown>,
): Promise<void> {
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'health') {
    if (!service.localServerInfo && readyPromise) await waitBounded(readyPromise, HEALTH_READY_WAIT_MS);
    sendJson(res, 200, { ok: true, service: 'markdown-studio-images', version: 5, ...service.info() });
    return;
  }
  if (action === 'asset.store') {
    if (!service.localServerInfo && readyPromise) await waitBounded(readyPromise, HEALTH_READY_WAIT_MS);
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
  sendJson(res, 400, {
    ok: false,
    error: { code: 'UNKNOWN_ACTION', message: '未知操作: ' + clampActionLabel(action) },
  });
}

export function createImageRoute(options: {
  service: ImageHostService;
  maxBodyBytes?: number;
  checkAuth?: HostAuthChecker;
  readyPromise?: Promise<unknown>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  if (!service) throw new Error('createImageRoute needs a service');
  const maxBodyBytes = options.maxBodyBytes || MAX_BODY_BYTES;

  return async function imageRoute(req, res) {
    try {
      if (!validateImageRequest(req, res, options.checkAuth)) return;
      const body = await readJsonObjectBody(req, maxBodyBytes);
      await dispatchImageAction(service, body, res, options.readyPromise);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        const closeHeaders: Record<string, string> =
          error.code === 'BODY_TOO_LARGE' || error.code === 'REQUEST_TIMEOUT' ? { connection: 'close' } : {};
        const status = error.code === 'BAD_JSON' ? 200 : error.status;
        sendJson(
          res,
          status,
          {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              hint: error.code === 'BODY_TOO_LARGE' ? '请减少一次上传的图片数量。' : '',
            },
          },
          closeHeaders,
        );
        return;
      }
      if (error instanceof ImageHostError) {
        sendJson(res, 200, {
          ok: false,
          error: { code: error.code, message: error.message, hint: error.hint, detail: error.detail },
        });
        return;
      }
      sendJson(res, 500, {
        ok: false,
        error: { code: 'INTERNAL', message: '图片服务内部错误', hint: '请稍后重试。' },
      });
    }
  };
}

function sendAssetText(
  res: ServerResponse,
  status: number,
  text: string,
  headOnly = false,
  extraHeaders: Record<string, string> = {},
): void {
  if (res.headersSent || res.destroyed || res.closed || res.writableEnded) return;
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(headOnly ? undefined : text);
}

function parseAssetFilename(req: IncomingMessage, res: ServerResponse, headOnly: boolean): string | null {
  let pathname: string;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    sendAssetText(res, 400, 'bad request', headOnly);
    return null;
  }
  if (pathname.indexOf(ASSET_PREFIX) !== 0) {
    sendAssetText(res, 404, 'not found', headOnly);
    return null;
  }
  return pathname.slice(ASSET_PREFIX.length);
}

function guardAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  headOnly: boolean,
  checkAuth?: HostAuthChecker,
): boolean {
  if (!isLoopbackReq(req) || !isLoopbackHostHeader(headerValue(req.headers.host))) {
    sendAssetText(res, 403, 'loopback only', headOnly);
    return false;
  }
  const rejection = checkAuth?.(req);
  if (rejection !== undefined) {
    sendAssetText(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden', headOnly);
    return false;
  }
  if (req.method !== 'GET' && !headOnly) {
    sendAssetText(res, 405, 'method not allowed', false, { allow: 'GET, HEAD' });
    return false;
  }
  return true;
}

export function createAssetRoute(options: {
  service: ImageHostService;
  checkAuth?: HostAuthChecker;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  if (!service) throw new Error('createAssetRoute needs a service');

  return async function assetRoute(req, res) {
    const headOnly = req.method === 'HEAD';
    try {
      if (!guardAssetRequest(req, res, headOnly, options.checkAuth)) return;
      const filename = parseAssetFilename(req, res, headOnly);
      if (filename === null) return;
      const asset = await service.readAsset(filename);
      if (!asset) {
        sendAssetText(res, 404, 'not found', headOnly);
        return;
      }
      if (res.destroyed || res.closed || res.writableEnded) return;
      res.writeHead(200, {
        'content-type': asset.mime,
        'content-length': asset.buffer.length,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      res.end(headOnly ? undefined : asset.buffer);
    } catch {
      if (!res.headersSent) sendAssetText(res, 500, 'internal error', headOnly);
      else if (!res.destroyed && !res.closed && !res.writableEnded) res.end();
    }
  };
}
