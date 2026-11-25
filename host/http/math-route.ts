import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { HostAuthChecker } from './routes';
import { createStaticBundleRoute } from './static-bundle-route';

export const MATH_PATH = '/api/markdown-studio/math.js';
const BUNDLED_FILE = fileURLToPath(new URL('./math.js', import.meta.url));
const SOURCE_FALLBACK = fileURLToPath(new URL('../../dist/math.js', import.meta.url));

export function createMathRoute(
  options: { checkAuth?: HostAuthChecker; signal?: AbortSignal } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return createStaticBundleRoute({
    bundledFile: BUNDLED_FILE,
    sourceFallback: SOURCE_FALLBACK,
    notBuiltMessage: 'math bundle not built',
    checkAuth: options.checkAuth,
    signal: options.signal,
  });
}

export const mathRoute = createMathRoute();
