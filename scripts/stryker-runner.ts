/**
 * Single-process test runner for Stryker mutation testing.
 *
 * Importing all 7 domain/store test suites in one `tsx` process avoids paying
 * 7x Node + esbuild startup overhead per mutant and orders the fastest suites
 * first so killed mutants fail fast before reaching slower tests.
 */
const SUITES = [
  '../test/library-backup.test.ts',
  '../test/library-search.test.ts',
  '../test/domain.test.ts',
  '../test/zip.test.ts',
  '../test/engine.test.ts',
  '../test/writing-skills.test.ts',
  '../test/document-store.test.ts',
] as const;

for (const suite of SUITES) {
  await import(suite);
}

export {};
