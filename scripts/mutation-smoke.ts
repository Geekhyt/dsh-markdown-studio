import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface Mutation {
  name: string;
  file: string;
  find: string;
  replace: string;
  test: string;
}

const mutations: Mutation[] = [
  {
    name: 'allow unsafe URL schemes',
    file: 'src/domain/urls.ts',
    find: 'if (/^(https?:|mailto:)/i.test(probe)) return value;',
    replace: 'if (true) return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'accept empty library backups',
    file: 'src/domain/library-backup.ts',
    find: 'if (!docs.length) return null;',
    replace: 'if (false) return null;',
    test: 'test/library-backup.test.ts',
  },
  {
    name: 'accept invalid accent colors',
    file: 'src/domain/settings.ts',
    find: "return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);",
    replace: "return typeof value === 'string';",
    test: 'test/domain.test.ts',
  },
  {
    name: 'skip search filtering',
    file: 'src/domain/library-search.ts',
    find: 'if (titleIndex < 0 && bodyIndex < 0) continue;',
    replace: 'if (false) continue;',
    test: 'test/library-search.test.ts',
  },
  {
    name: 'drop font-size clamping',
    file: 'src/domain/settings.ts',
    find: 'patch.fontSize = clamp(sourceValue.fontSize, 14, 20);',
    replace: 'patch.fontSize = sourceValue.fontSize;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'allow unsafe image schemes',
    file: 'src/domain/urls.ts',
    find: 'if (/^https?:/i.test(probe)) return value;',
    replace: 'return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'allow origin-escaping relative URLs',
    file: 'src/domain/urls.ts',
    find: 'if (!SCHEME.test(probe)) return escapesBaseOrigin(probe) ? null : value;',
    replace: 'if (!SCHEME.test(probe)) return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'ignore search result limit',
    file: 'src/domain/library-search.ts',
    find: 'return results.slice(0, limit);',
    replace: 'return results;',
    test: 'test/library-search.test.ts',
  },
  {
    name: 'drop line-height clamping',
    file: 'src/domain/settings.ts',
    find: 'patch.lineHeight = clamp(sourceValue.lineHeight, 1.4, 2.4);',
    replace: 'patch.lineHeight = sourceValue.lineHeight;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'keep external CSS @import rules',
    file: 'src/domain/custom-css.ts',
    find: 'if (isAtImportSegment(segment)) {',
    replace: 'if (false && isAtImportSegment(segment)) {',
    test: 'test/custom-css.test.ts',
  },
  {
    name: 'bypass external CSS URL fallback strip',
    file: 'src/domain/custom-css.ts',
    find: "out += hasExternalCssUrl(replaced) ? '' : replaced;",
    replace: 'out += replaced;',
    test: 'test/fuzz-and-perf.test.ts',
  },
  {
    name: 'skip WeChat HTML style-tag detection',
    file: 'src/domain/wechat-html-lint.ts',
    find: "['html', /<style\\b/i, 'style-tag', '复制 HTML 仍包含 style 标签'],",
    replace: "['html', /(?!)/, 'style-tag', '复制 HTML 仍包含 style 标签'],",
    test: 'test/wechat-html.test.ts',
  },
  {
    name: 'disable ZIP budget enforcement',
    file: 'src/adapters/zip.ts',
    find: "throw new Error('ZIP_LIMIT_EXCEEDED');",
    replace: 'return;',
    test: 'test/zip.test.ts',
  },
  {
    name: 'allow orphaned search bar on immersive exit to preview',
    file: 'src/domain/studio-overlay.machine.ts',
    find: "case 'EXIT_IMMERSIVE':\n      if (!state.immersive || hasSurfaceModal(state)) return state;\n      return { ...dismissTransient(state, { keepSearch: state.view !== 'preview' }), immersive: null };",
    replace:
      "case 'EXIT_IMMERSIVE':\n      if (!state.immersive || hasSurfaceModal(state)) return state;\n      return { ...dismissTransient(state, { keepSearch: true }), immersive: null };",
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'allow silent overwrite of conflicted disk file',
    file: 'src/domain/file-session.machine.ts',
    find: 'if (!op.overwrite && (state.conflict || externalChanged)) {',
    replace: 'if (false && !op.overwrite && (state.conflict || externalChanged)) {',
    test: 'test/formal-models.test.ts',
  },
];

let survived = 0;
for (const mutation of mutations) {
  const file = path.join(root, mutation.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(mutation.find)) {
    console.error(`FAIL ${mutation.name}: mutation target not found`);
    survived++;
    continue;
  }
  fs.writeFileSync(file, original.replace(mutation.find, mutation.replace));
  try {
    const result = spawnSync(process.execPath, [tsx, mutation.test], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.status === 0) {
      console.error(`FAIL ${mutation.name}: test suite survived the mutation`);
      survived++;
    } else {
      console.log(`ok   ${mutation.name}: killed by ${mutation.test}`);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
}
if (survived) process.exit(1);
console.log(`Mutation smoke passed (${mutations.length} mutations killed).`);
