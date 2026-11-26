import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { HostAuthChecker } from './routes';
import { createStaticBundleRoute } from './static-bundle-route';

export const DARKMODE_PATH = '/api/markdown-studio/darkmode.js';
const BUNDLED_FILE = fileURLToPath(new URL('./darkmode.js', import.meta.url));
const SOURCE_FALLBACK = fileURLToPath(new URL('../../dist/darkmode.js', import.meta.url));

export function createDarkmodeRoute(
  options: { checkAuth?: HostAuthChecker; signal?: AbortSignal } = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return createStaticBundleRoute({
    bundledFile: BUNDLED_FILE,
    sourceFallback: SOURCE_FALLBACK,
    notBuiltMessage: 'darkmode bundle not built',
    checkAuth: options.checkAuth,
    signal: options.signal,
  });
}

export const darkmodeRoute = createDarkmodeRoute();
