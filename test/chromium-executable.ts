import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  try {
    const builtIn = chromium.executablePath();
    if (builtIn && fs.existsSync(builtIn)) return builtIn;
  } catch {
    // Fall through to local Playwright cache discovery.
  }
  const cacheRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  for (const cacheRoot of cacheRoots) {
    if (!fs.existsSync(cacheRoot)) continue;
    const dirs = fs
      .readdirSync(cacheRoot)
      .filter((entry) => entry.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const sub of [
        'chrome-headless-shell-mac-arm64',
        'chrome-headless-shell-mac-x64',
        'chrome-headless-shell-linux64',
      ]) {
        const candidate = path.join(cacheRoot, dir, sub, 'chrome-headless-shell');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}
