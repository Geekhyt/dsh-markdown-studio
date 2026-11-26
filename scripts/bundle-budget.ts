import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const budgets = [
  { file: 'dist/client.js', max: 12 * 1024, maxGzip: 5 * 1024 },
  { file: 'dist/client.studio.js', max: 1.1 * 1024 * 1024, maxGzip: 365 * 1024 },
  { file: 'dist/index.js', max: 150 * 1024, maxGzip: 65 * 1024 },
  { file: 'dist/math.js', max: 2 * 1024 * 1024, maxGzip: 650 * 1024 },
  { file: 'dist/mermaid.js', max: 4 * 1024 * 1024, maxGzip: 1050 * 1024 },
  { file: 'dist/darkmode.js', max: 200 * 1024, maxGzip: 65 * 1024 },
];
let failed = false;
for (const entry of budgets) {
  const full = path.join(root, entry.file);
  if (!fs.existsSync(full)) {
    console.error(`missing build artifact: ${entry.file}`);
    failed = true;
    continue;
  }
  const raw = fs.readFileSync(full);
  const size = raw.byteLength;
  const gzipSize = gzipSync(raw).byteLength;
  const rawOk = size <= entry.max;
  const gzipOk = gzipSize <= entry.maxGzip;
  const ok = rawOk && gzipOk;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${entry.file}: ${(size / 1024).toFixed(1)} KiB (budget ${(entry.max / 1024).toFixed(1)} KiB) ` +
      `| gzip ${(gzipSize / 1024).toFixed(1)} KiB (budget ${(entry.maxGzip / 1024).toFixed(1)} KiB)`,
  );
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Bundle budget passed (raw + gzip).');
