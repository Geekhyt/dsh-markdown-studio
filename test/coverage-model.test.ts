import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';
import { complexity, functionsIn, ownerAt, runtimeSources } from '../scripts/coverage-model';

const source = ts.createSourceFile(
  'example.ts',
  `function outer() {\n  function inner(x: boolean) { if(x) return 1; return 0; }\n  return inner(true);\n}`,
  ts.ScriptTarget.Latest,
  true,
);
const functions = functionsIn(source);
assert.equal(functions.length, 2);
assert.equal(complexity(functions[0].node), 1, 'nested branches do not inflate parent complexity');
assert.equal(complexity(functions[1].node), 2);
assert.equal(
  ownerAt(functions, source, { line: 2, column: 0 })?.name,
  'inner',
  'source-map indentation still maps to the innermost function',
);
const files = runtimeSources(path.resolve('.'));
assert.ok(files.some((file) => file.endsWith(path.join('src', 'app.ts'))));
assert.ok(files.some((file) => file.endsWith(path.join('src', 'application', 'use-library-archive.ts'))));
assert.ok(
  !files.some((file) => file.endsWith(path.join('src', 'domain', 'document-ref.ts'))),
  'type-only files do not enter the runtime denominator',
);
console.log('ok - runtime inventory and nested function coverage mapping');

const { reconcileFunctionEntries } = await import('../scripts/coverage-check');
const whole = { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } };
const inner = { start: { line: 2, column: 2 }, end: { line: 3, column: 3 } };
const fixture = {
  example: {
    path: 'example.ts',
    fnMap: { f: { name: 'example', decl: whole, loc: whole } },
    f: { f: 0 },
    branchMap: { b: { loc: inner } },
    b: { b: [10] },
    statementMap: {},
    s: {},
  },
};
reconcileFunctionEntries(fixture);
assert.equal(fixture.example.f.f, 0, 'inner block hits never imply a function call');
fixture.example.branchMap.b.loc = whole;
reconcileFunctionEntries(fixture);
assert.equal(fixture.example.f.f, 10, 'an exact full-function V8 entry count reconciles anonymous/named versions');
