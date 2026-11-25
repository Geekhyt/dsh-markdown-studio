import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { HostAuthChecker } from './routes';
import { createStaticBundleRoute } from './static-bundle-route';

export const MERMAID_PATH = '/api/markdown-studio/mermaid.js';
const BUNDLED_FILE = fileURLToPath(new URL('./mermaid.js', import.meta.url));
const SOURCE_FALLBACK = fileURLToPath(new URL('../../dist/mermaid.js', import.meta.url));

export function createMermaidRoute(
  options: { checkAuth?: HostAuthChecker; signal?: AbortSignal } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return createStaticBundleRoute({
    bundledFile: BUNDLED_FILE,
    sourceFallback: SOURCE_FALLBACK,
    notBuiltMessage: 'mermaid bundle not built',
    checkAuth: options.checkAuth,
    signal: options.signal,
  });
}

export const mermaidRoute = createMermaidRoute();
