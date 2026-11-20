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

function cors(headers: Record<string, string> = {}): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    ...headers,
  };
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, cors({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }));
  res.end(text);
}

export function createLocalImageServer(options: { service: LocalAssetReader }): http.Server {
  const service = options.service;
  return http.createServer(async function (req: IncomingMessage, res: ServerResponse) {
    try {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors());
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed');
        return;
      }
      if (pathname === '/health') {
        const body = JSON.stringify({ ok: true, service: 'markdown-studio-images' });
        res.writeHead(200, cors({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }));
        res.end(body);
        return;
      }
      if (pathname.indexOf('/uploads/') !== 0) {
        sendText(res, 404, 'not found');
        return;
      }
      const filename = pathname.slice('/uploads/'.length);
      const asset = await service.readAsset(filename);
      if (!asset) {
        sendText(res, 404, 'not found');
        return;
      }
      res.writeHead(
        200,
        cors({
          'content-type': asset.mime,
          'content-length': String(asset.buffer.length),
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        }),
      );
      if (req.method === 'HEAD') res.end();
      else res.end(asset.buffer);
    } catch (error) {
      if (!res.headersSent) sendText(res, 500, 'internal error');
      else res.end();
    }
  });
}

export function startLocalImageServer(options: {
  service: LocalAssetReader;
  ports?: number[];
}): Promise<LocalServerHandle | null> {
  const service = options.service;
  const ports = options.ports && options.ports.length ? options.ports : LOCAL_SERVER_PORTS;
  const server = createLocalImageServer({ service });
  let index = 0;

  function attempt(): Promise<{ server: http.Server; info: LocalServerInfo } | null> {
    if (index >= ports.length) {
      service.localServerInfo = null;
      service.localServerError = 'no free port';
      return Promise.resolve(null);
    }
    const port = ports[index++];
    return new Promise(function (resolve) {
      function onError(error: NodeJS.ErrnoException): void {
        server.removeListener('listening', onListening);
        if (error?.code === 'EADDRINUSE') {
          void attempt().then(resolve);
          return;
        }
        service.localServerInfo = null;
        service.localServerError = String(error?.message || error);
        resolve(null);
      }
      function onListening(): void {
        server.removeListener('error', onError);
        const address = server.address();
        const actualPort = address && typeof address === 'object' ? address.port : port;
        const info: LocalServerInfo = { port: actualPort, url: 'http://127.0.0.1:' + actualPort };
        service.localServerInfo = info;
        service.localServerError = '';
        resolve({ server, info });
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  return attempt().then(function (result) {
    if (!result) return null;
    return {
      server: result.server,
      info: result.info,
      stop: function (): Promise<void> {
        return new Promise(function (resolve) {
          try {
            result.server.close(function () {
              resolve();
            });
          } catch (error) {
            resolve();
          }
        });
      },
    };
  });
}
