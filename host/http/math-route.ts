import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { isLoopbackHostHeader, isLoopbackReq } from './routes';

export const MATH_PATH = '/api/markdown-studio/math.js';
const BUNDLED_FILE = fileURLToPath(new URL('./math.js', import.meta.url));
const IS_SOURCE_CHECKOUT = /[/\\]host[/\\]http[/\\]/.test(fileURLToPath(import.meta.url));
const SOURCE_FALLBACK = IS_SOURCE_CHECKOUT ? fileURLToPath(new URL('../../dist/math.js', import.meta.url)) : '';

let cachedBundled: Buffer | null = null;

async function readMathBundle(): Promise<Buffer> {
  if (cachedBundled && !IS_SOURCE_CHECKOUT) return cachedBundled;
  try {
    const buf = await readFile(BUNDLED_FILE);
    if (!IS_SOURCE_CHECKOUT) cachedBundled = buf;
    return buf;
  } catch (error) {
    if (!SOURCE_FALLBACK) throw error;
    return await readFile(SOURCE_FALLBACK);
  }
}

export async function mathRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headOnly = req.method === 'HEAD';
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || '';
  if (!isLoopbackReq(req) || !isLoopbackHostHeader(host)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(headOnly ? undefined : 'loopback only');
    return;
  }
  if (req.method !== 'GET' && !headOnly) {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  try {
    const source = await readMathBundle();
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': source.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(headOnly ? undefined : source);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(headOnly ? undefined : 'math bundle not built');
  }
}
