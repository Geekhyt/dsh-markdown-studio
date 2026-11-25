import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { headerValue, type HostAuthChecker, isLoopbackHostHeader, isLoopbackReq } from './routes';

export interface StaticBundleRouteOptions {
  bundledFile: string;
  sourceFallback: string;
  notBuiltMessage: string;
  checkAuth?: HostAuthChecker;
  signal?: AbortSignal;
}

interface CachedBundle {
  buffer: Buffer;
  etag: string;
  statKey: string;
}

function sendPlain(
  res: ServerResponse,
  status: number,
  text: string,
  headOnly: boolean,
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

function computeWeakEtag(buffer: Buffer): string {
  return '"' + crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16) + '"';
}

function etagMatches(header: string, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//i, ''))
    .some((token) => token === '*' || token === etag);
}

export function createStaticBundleRoute(
  options: StaticBundleRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let cache: CachedBundle | null = null;
  if (options.signal) {
    options.signal.addEventListener(
      'abort',
      () => {
        cache = null;
      },
      { once: true },
    );
  }

  async function loadBundle(): Promise<CachedBundle> {
    const target = await resolveExistingFile(options.bundledFile, options.sourceFallback);
    const info = await stat(target);
    const statKey = `${target}:${info.mtimeMs}:${info.size}`;
    if (cache && cache.statKey === statKey) return cache;
    const buffer = await readFile(target);
    const next: CachedBundle = { buffer, etag: computeWeakEtag(buffer), statKey };
    if (!options.signal?.aborted) cache = next;
    return next;
  }

  return async function staticBundleRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headOnly = req.method === 'HEAD';
    const host = headerValue(req.headers.host);
    if (!isLoopbackReq(req) || !isLoopbackHostHeader(host)) {
      sendPlain(res, 403, 'loopback only', headOnly);
      return;
    }
    const rejection = options.checkAuth?.(req);
    if (rejection !== undefined) {
      sendPlain(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden', headOnly);
      return;
    }
    if (req.method !== 'GET' && !headOnly) {
      sendPlain(res, 405, 'method not allowed', false, { allow: 'GET, HEAD' });
      return;
    }
    let bundle: CachedBundle;
    try {
      bundle = await loadBundle();
    } catch {
      sendPlain(res, 404, options.notBuiltMessage, headOnly);
      return;
    }
    if (res.headersSent || res.destroyed || res.closed || res.writableEnded) return;
    if (etagMatches(headerValue(req.headers['if-none-match']), bundle.etag)) {
      res.writeHead(304, {
        etag: bundle.etag,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': bundle.buffer.length,
      etag: bundle.etag,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(headOnly ? undefined : bundle.buffer);
  };
}

async function resolveExistingFile(primary: string, fallback: string): Promise<string> {
  try {
    await stat(primary);
    return primary;
  } catch (error) {
    if (!fallback) throw error;
    await stat(fallback);
    return fallback;
  }
}
