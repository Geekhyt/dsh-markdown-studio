/** Audit the full runtime-source inventory, then score every AST function. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  type CoverageFile,
  complexity,
  type FunctionNode,
  functionsIn,
  ownerAt,
  runtimeSources,
} from './coverage-model';

const root = path.resolve(import.meta.dirname, '..');
const coverage = JSON.parse(fs.readFileSync(path.join(root, 'coverage/coverage-final.json'), 'utf8')) as Record<
  string,
  CoverageFile
>;
const threshold = 30;
const sources = runtimeSources(root);
const entries = new Map(Object.values(coverage).map((entry) => [path.resolve(entry.path), entry]));
const missing = sources.filter((file) => !entries.has(file));
if (missing.length) throw new Error('Runtime sources missing from coverage:\n' + missing.join('\n'));
const metrics: Array<{
  file: string;
  line: number;
  name: string;
  complexity: number;
  coverage: number;
  crap: number;
  mapping: string;
}> = [];
const unmatched: string[] = [];
for (const file of sources) {
  const entry = entries.get(file)!;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = functionsIn(source);
  const calls = new Map<FunctionNode, number[]>();
  const branches = new Map<FunctionNode, number[]>();
  const statements = new Map<FunctionNode, number[]>();
  for (const [id, fn] of Object.entries(entry.fnMap)) {
    if (fn.name === '__name') continue; // tsx-generated name annotation, not source code.
    const owner = ownerAt(functions, source, fn.decl.start) || ownerAt(functions, source, fn.loc.start);
    if (owner) calls.set(owner, [...(calls.get(owner) || []), entry.f[id]]);
    else
      unmatched.push(
        `${path.relative(root, file).replace(/\\/g, '/')}:${fn.decl.start.line} ${fn.name || '<module wrapper>'}`,
      );
  }
  for (const [id, branch] of Object.entries(entry.branchMap)) {
    const owner = ownerAt(functions, source, branch.loc.start);
    if (owner) branches.set(owner, [...(branches.get(owner) || []), ...entry.b[id]]);
  }
  for (const [id, statement] of Object.entries(entry.statementMap)) {
    const owner = ownerAt(functions, source, statement.start);
    if (owner) statements.set(owner, [...(statements.get(owner) || []), entry.s[id]]);
  }
  for (const fn of functions) {
    const branchCounts = branches.get(fn) || [];
    const callCounts = calls.get(fn) || [];
    const statementCounts = statements.get(fn) || [];
    const counts = branchCounts.length ? branchCounts : callCounts.length ? callCounts : statementCounts;
    const ratio = counts.length ? counts.filter((count) => count > 0).length / counts.length : 0;
    const cc = complexity(fn.node);
    metrics.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      name: fn.name,
      line: fn.line,
      complexity: cc,
      coverage: ratio,
      crap: cc + cc * cc * (1 - ratio) ** 3,
      mapping: branchCounts.length
        ? 'branches'
        : callCounts.length
          ? 'calls'
          : statementCounts.length
            ? 'statements'
            : 'unmapped (0% coverage)',
    });
  }
}
metrics.sort((a, b) => b.crap - a.crap);
const report = {
  sources: sources.length,
  functions: metrics.length,
  missing,
  unmatchedCoverageFunctions: unmatched,
  metrics,
};
fs.writeFileSync(path.join(root, 'coverage/crap-report.json'), JSON.stringify(report, null, 2));
console.log(
  `CRAP gate: ${metrics.length} AST functions in all ${sources.length} runtime sources; threshold ${threshold}`,
);
for (const metric of metrics.slice(0, 20))
  console.log(
    `${metric.crap.toFixed(2)} CC=${metric.complexity} cov=${(metric.coverage * 100).toFixed(0)}% ${metric.file}:${metric.line} ${metric.name}`,
  );
console.log(`Unmatched coverage functions (${unmatched.length}, all listed in coverage/crap-report.json):`);
for (const item of unmatched) console.log('  ' + item);
const unmapped = metrics.filter((metric) => metric.mapping.startsWith('unmapped'));
for (const metric of unmapped)
  console.log(`  UNMAPPED source function (scored at 0%): ${metric.file}:${metric.line} ${metric.name}`);
const failed = metrics.filter((metric) => metric.crap > threshold);
if (failed.length) {
  console.error(`${failed.length} functions exceed CRAP ${threshold}; see coverage/crap-report.json`);
  process.exitCode = 1;
} else console.log('All runtime source functions are at or below CRAP 30.');
