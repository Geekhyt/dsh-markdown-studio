/** Reconcile V8 function entries across Node (anonymous) and Chromium (inferred
 * names). Only a block with the exact same full function range may supply its
 * entry count; hits inside a function are never used to infer a call. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { CoverageFile } from './coverage-model';

const require = createRequire(import.meta.url);
export function reconcileFunctionEntries(
  files: Record<string, CoverageFile>,
): Array<{ file: string; name: string; count: number }> {
  const reconciled: Array<{ file: string; name: string; count: number }> = [];
  for (const entry of Object.values(files)) {
    const blocks = new Map<string, number>();
    for (const [id, block] of Object.entries(entry.branchMap)) {
      const key = JSON.stringify(block.loc);
      blocks.set(key, Math.max(blocks.get(key) || 0, ...entry.b[id]));
    }
    for (const [id, fn] of Object.entries(entry.fnMap)) {
      const count = Math.max(entry.f[id], blocks.get(JSON.stringify(fn.loc)) || 0);
      if (count > entry.f[id]) {
        entry.f[id] = count;
        reconciled.push({ file: entry.path, name: fn.name, count });
      }
    }
  }
  return reconciled;
}
if (process.argv[1]?.endsWith('coverage-check.ts')) {
  const file = 'coverage/coverage-final.json';
  const coverage = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CoverageFile>;
  fs.writeFileSync('coverage/coverage-raw.json', JSON.stringify(coverage));
  const reconciled = reconcileFunctionEntries(coverage);
  fs.writeFileSync(file, JSON.stringify(coverage));
  fs.writeFileSync('coverage/function-entry-reconciliation.json', JSON.stringify(reconciled, null, 2));
  const map = require('istanbul-lib-coverage').createCoverageMap(coverage);
  const summary = map.getCoverageSummary().toJSON() as Record<string, { total: number; covered: number; pct: number }>;
  fs.writeFileSync('coverage/coverage-summary.json', JSON.stringify(summary, null, 2));
  console.log(`Verified function entry counts against exact V8 block ranges (${reconciled.length} reconciled)`);
  for (const [name, threshold] of Object.entries({ statements: 90, branches: 65, functions: 90, lines: 90 })) {
    const value = summary[name];
    console.log(`${name}: ${value.pct}% (${value.covered}/${value.total}); required ${threshold}%`);
    if (value.pct < threshold) process.exitCode = 1;
  }
}
