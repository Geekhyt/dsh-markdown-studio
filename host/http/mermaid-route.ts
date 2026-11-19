import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

export const MERMAID_PATH = '/api/markdown-studio/mermaid.js';
const BUNDLED_FILE = fileURLToPath(new URL('./mermaid.js', import.meta.url));
// Source checkouts (tsx) resolve the sibling build output; never the process working directory.
const SOURCE_FALLBACK = fileURLToPath(new URL('../../dist/mermaid.js', import.meta.url));

export async function mermaidRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  try {
    let source: Buffer;
    try {
      source = await readFile(BUNDLED_FILE);
    } catch (error) {
      source = await readFile(SOURCE_FALLBACK);
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': source.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(source);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('mermaid bundle not built');
  }
}
