/*
 * Read-only loopback image server.
 *
 * The authenticated DSH web route is not usable from a plain <img> request.
 * This server exposes only content-addressed files under /uploads/<hash>. It
 * never writes, never exposes configuration, and binds to 127.0.0.1.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import type { LocalAsset, LocalServerInfo } from './application/image-store';
import { headerValue, isLoopbackHostHeader, isLoopbackReq } from './http/routes';

export const LOCAL_SERVER_PORTS = [4010, 4011, 4012, 4013, 4014, 4015, 4016, 4017, 4018, 4019];

export interface LocalAssetReader {
  readAsset(filename: unknown): Promise<LocalAsset | null>;
  localServerInfo: LocalServerInfo | null;
  localServerError: string;
}

export interface LocalServerHandle {
  server: http.Server;
  info: LocalServerInfo;
  stop(): Promise<void>;
}

const LOCAL_CORS_LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const LOCAL_CORS_ELECTRON = new Set(['dsh-app:', 'dsh:', 'app:']);

function allowedLocalCorsOrigin(originHeader: string): string {
  const norm = originHeader.trim();
  if (!norm) return '';
  let parsed: URL;
  try {
    parsed = new URL(norm);
  } catch {
    return '';
  }
  if (parsed.username || parsed.password) return '';
  if (LOCAL_CORS_ELECTRON.has(parsed.protocol)) {
    if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) return '';
    return parsed.hostname ? `${parsed.protocol}//${parsed.host}` : '';
  }
  if (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.origin.toLowerCase() === norm.toLowerCase()
  ) {
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_CORS_LOOPBACK.has(host) || (parsed.protocol === 'https:' && host === 'mp.weixin.qq.com')) {
      return parsed.origin;
    }
  }
  return '';
}

function cors(originHeader: string, headers: Record<string, string> = {}): Record<string, string> {
  const allowedOrigin = allowedLocalCorsOrigin(originHeader);
  return {
    vary: 'Origin',
    ...(allowedOrigin ? { 'access-control-allow-origin': allowedOrigin } : {}),
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    ...headers,
  };
}

function canWriteResponse(res: ServerResponse): boolean {
  return !res.headersSent && !res.destroyed && !res.closed && !res.writableEnded;
}

function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  headOnly = false,
  extraHeaders: Record<string, string> = {},
): void {
  if (!canWriteResponse(res)) return;
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(headOnly ? undefined : text);
}

function parsePathname(rawUrl: string | undefined): string | null {
  try {
    return new URL(rawUrl || '/', 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
}

async function handleUploadRequest(
  service: LocalAssetReader,
  res: ServerResponse,
  pathname: string,
  origin: string,
  headOnly: boolean,
): Promise<void> {
  const asset = await service.readAsset(pathname.slice('/uploads/'.length));
  if (!asset) {
    sendText(res, 404, 'not found', headOnly);
    return;
  }
  if (!canWriteResponse(res)) return;
  res.writeHead(
    200,
    cors(origin, {
      'content-type': asset.mime,
      'content-length': String(asset.buffer.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    }),
  );
  res.end(headOnly ? undefined : asset.buffer);
}

async function handleLocalRequest(
  service: LocalAssetReader,
  req: IncomingMessage,
  res: ServerResponse,
  headOnly: boolean,
): Promise<void> {
  if (!isLoopbackReq(req) || !isLoopbackHostHeader(headerValue(req.headers.host))) {
    sendText(res, 403, 'loopback only', headOnly);
    return;
  }
  const pathname = parsePathname(req.url);
  if (!pathname) {
    sendText(res, 400, 'bad request', headOnly);
    return;
  }
  const origin = headerValue(req.headers.origin);
  if (req.method === 'OPTIONS') {
    if (canWriteResponse(res)) {
      const headers =
        pathname.indexOf('/uploads/') === 0
          ? cors(origin, { 'x-content-type-options': 'nosniff' })
          : { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      res.writeHead(204, headers);
      res.end();
    }
    return;
  }
  if (req.method !== 'GET' && !headOnly) {
    sendText(res, 405, 'method not allowed', false, { allow: 'GET, HEAD, OPTIONS' });
    return;
  }
  if (pathname === '/health') {
    if (!canWriteResponse(res)) return;
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(headOnly ? undefined : JSON.stringify({ ok: true, service: 'markdown-studio-images' }));
    return;
  }
  if (pathname.indexOf('/uploads/') !== 0) {
    sendText(res, 404, 'not found', headOnly);
    return;
  }
  await handleUploadRequest(service, res, pathname, origin, headOnly);
}

export function createLocalImageServer(options: { service: LocalAssetReader }): http.Server {
  const service = options.service;
  return http.createServer(async function (req: IncomingMessage, res: ServerResponse) {
    const headOnly = req.method === 'HEAD';
    try {
      await handleLocalRequest(service, req, res, headOnly);
    } catch {
      if (!res.headersSent) sendText(res, 500, 'internal error', headOnly);
      else if (!res.destroyed && !res.closed && !res.writableEnded) res.end();
    }
  });
}

function isRetryableBindError(error: NodeJS.ErrnoException | undefined, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return error?.code === 'EADDRINUSE' || error?.code === 'EACCES';
}

function recordBindFailure(
  service: LocalAssetReader,
  error: NodeJS.ErrnoException | undefined,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) return;
  service.localServerInfo = null;
  service.localServerError = String(error?.message || error);
}

export function startLocalImageServer(options: {
  service: LocalAssetReader;
  ports?: number[];
  signal?: AbortSignal;
}): Promise<LocalServerHandle | null> {
  const service = options.service;
  const signal = options.signal;
  const ports = options.ports && options.ports.length ? options.ports : [...LOCAL_SERVER_PORTS, 0];
  const server = createLocalImageServer({ service });
  let index = 0;

  let ownedInfo: LocalServerInfo | null = null;
  function closeServerImmediately(): void {
    if (ownedInfo && service.localServerInfo === ownedInfo) {
      service.localServerInfo = null;
    }
    try {
      server.close();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    } catch {
      /* ignore */
    }
  }
  const onAbort = (): void => {
    closeServerImmediately();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  function attempt(): Promise<{ server: http.Server; info: LocalServerInfo } | null> {
    if (signal?.aborted) {
      return Promise.resolve(null);
    }
    if (index >= ports.length) {
      service.localServerInfo = null;
      service.localServerError = 'no free port';
      return Promise.resolve(null);
    }
    const port = ports[index++];
    return new Promise(function (resolve) {
      let settled = false;
      function settle(value: { server: http.Server; info: LocalServerInfo } | null): void {
        if (settled) return;
        settled = true;
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
        server.removeListener('close', onClose);
        signal?.removeEventListener('abort', onAttemptAbort);
        resolve(value);
      }
      function onClose(): void {
        settle(null);
      }
      function onAttemptAbort(): void {
        closeServerImmediately();
        settle(null);
      }
      function onError(error: NodeJS.ErrnoException): void {
        if (settled) return;
        server.removeListener('listening', onListening);
        server.removeListener('close', onClose);
        signal?.removeEventListener('abort', onAttemptAbort);
        if (isRetryableBindError(error, signal)) {
          settled = true;
          void attempt().then(resolve);
          return;
        }
        recordBindFailure(service, error, signal);
        settle(null);
      }
      function onListening(): void {
        if (signal?.aborted) {
          closeServerImmediately();
          settle(null);
          return;
        }
        server.on('error', function (runtimeError: Error) {
          service.localServerError = String(runtimeError?.message || runtimeError);
        });
        const address = server.address();
        const actualPort = address && typeof address === 'object' ? address.port : port;
        const info: LocalServerInfo = { port: actualPort, url: 'http://127.0.0.1:' + actualPort };
        ownedInfo = info;
        service.localServerInfo = info;
        service.localServerError = '';
        settle({ server, info });
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.once('close', onClose);
      signal?.addEventListener('abort', onAttemptAbort, { once: true });
      server.listen(port, '127.0.0.1');
    });
  }

  return attempt().then(function (result) {
    if (!result) {
      signal?.removeEventListener('abort', onAbort);
      return null;
    }
    return {
      server: result.server,
      info: result.info,
      stop: function (): Promise<void> {
        signal?.removeEventListener('abort', onAbort);
        if (service.localServerInfo === result.info) {
          service.localServerInfo = null;
        }
        return new Promise(function (resolve) {
          try {
            result.server.close(function () {
              resolve();
            });
            result.server.closeIdleConnections?.();
            result.server.closeAllConnections?.();
          } catch {
            resolve();
          }
        });
      },
    };
  });
}
