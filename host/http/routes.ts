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
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  return await new Promise(function (resolve, reject) {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      reject(error);
    }
    req.on('data', function (chunk: unknown) {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) {
        fail(new ImageHostError('BODY_TOO_LARGE', '请求内容过大', '请减少一次上传的图片数量。'));
        try {
          req.destroy();
        } catch (error) {
          /* ignore */
        }
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', function () {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed: unknown = text ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new ImageHostError('BAD_JSON', '请求 JSON 必须是对象'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(new ImageHostError('BAD_JSON', '请求 JSON 无法解析'));
      }
    });
    req.on('error', function (error: Error) {
      fail(error);
    });
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

function isAllowedOrigin(origin: string, host: string, site: string): boolean {
  if (!origin) return true;
  // An opaque `null` origin is only trusted when the browser vouches for it via Sec-Fetch-Site.
  if (origin === 'null') return site === 'same-origin' || site === 'none';
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (error) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return parsed.host === host;
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
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
        return;
      }
      const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
      const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (!loopback) {
        sendJson(res, 403, { ok: false, error: { code: 'LOOPBACK_ONLY', message: '图片接口仅允许本机访问' } });
        return;
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
              'origin=' +
              (origin || '(none)') +
              ' host=' +
              (host || '(none)') +
              ' sec-fetch-site=' +
              (site || '(none)'),
          },
        });
        return;
      }
      const contentType = headerValue(req.headers['content-type']);
      if (!isJsonContentType(contentType)) {
        sendJson(res, 415, {
          ok: false,
          error: { code: 'CONTENT_TYPE_REQUIRED', message: '需要 application/json 请求' },
        });
        return;
      }
      const body = await readJsonBody(req, maxBodyBytes);
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
    } catch (error) {
      if (error instanceof ImageHostError) {
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

export function createAssetRoute(options: {
  service: ImageHostService;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const service = options.service;
  if (!service) throw new Error('createAssetRoute needs a service');

  return async function assetRoute(req, res) {
    try {
      const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
      const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (!loopback) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('loopback only');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname.indexOf(ASSET_PREFIX) !== 0) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const filename = pathname.slice(ASSET_PREFIX.length);
      const asset = await service.readAsset(filename);
      if (!asset) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': asset.mime,
        'content-length': asset.buffer.length,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(asset.buffer);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end('internal error');
    }
  };
}
