#!/usr/bin/env node
/**
 * Drift check against the installed DeepSeek Harness Desktop `app.asar`.
 *
 * Scans the unpacked ASAR payload in pure Node (no external CLI required) to
 * verify that every `PLATFORM_MODULES` key, `@deepseek-ai/dsh-client-ui-primitives`
 * export, and client/host extension seam `dsh-markdown-studio` relies on is present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function resolveAsarPath() {
  if (process.env.DSH_ASAR_PATH) return process.env.DSH_ASAR_PATH;
  const candidates = [
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
      : '',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'DeepSeek Harness', 'resources', 'app.asar') : '',
    '/opt/DeepSeek Harness/resources/app.asar',
    '/usr/lib/deepseek-harness/resources/app.asar',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const ASAR_PATH = resolveAsarPath();

const REQUIRED_PLATFORM_MODULES = [
  'react',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
];

const REQUIRED_PRIMITIVE_EXPORTS = [
  'Button',
  'Checkbox',
  'Input',
  'Pill',
  'StateDot',
  'Switch',
  'Tag',
  'Modal',
  'Menu',
  'Toast',
  'Tooltip',
  'IconSearchOutlineRegular',
  'IconCopyOutlineRegular',
];

const REQUIRED_SEAMS = ['sidebar.panellist', 'webServer', '__ModuleLoader__.load', 'locale', 'llm'];

if (!existsSync(ASAR_PATH)) {
  console.log(`[check-host-api] Skipped: DeepSeek Harness app.asar not present on this machine (${ASAR_PATH}).`);
  process.exit(0);
}

const raw = readFileSync(ASAR_PATH, 'latin1');
const errors = [];

for (const mod of REQUIRED_PLATFORM_MODULES) {
  if (!raw.includes(`"${mod}"`) && !raw.includes(`'${mod}'`)) {
    errors.push(`missing platform module "${mod}"`);
  }
}

for (const sym of REQUIRED_PRIMITIVE_EXPORTS) {
  if (!raw.includes(`${sym}:`) && !raw.includes(`exports.${sym}`)) {
    errors.push(`missing dsh-client-ui-primitives export "${sym}"`);
  }
}

for (const seam of REQUIRED_SEAMS) {
  if (!raw.includes(seam)) {
    errors.push(`missing host/client extension seam "${seam}"`);
  }
}

if (errors.length > 0) {
  console.error(`[check-host-api] FAILED against ${ASAR_PATH}:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

console.log(
  `[check-host-api] OK: verified ${REQUIRED_PLATFORM_MODULES.length} platform modules, ` +
    `${REQUIRED_PRIMITIVE_EXPORTS.length} primitives, and ${REQUIRED_SEAMS.length} extension seams against ${ASAR_PATH}.`,
);
