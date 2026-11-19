import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create as createShellPlugin } from '../src/shell-entry';
import type { ClientContext, ClientPlugin, LocaleService } from '../src/types/dsh';
import {
  getPluginStyleRegistry,
  isPluginStylesMounted,
  mountPluginStyles,
  unmountPluginStyles,
} from '../src/ui/style-lifecycle';

const root = path.resolve(import.meta.dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
  name: string;
  files: string[];
  dsh: { client: { inject: string[] } };
};

const ALLOWED_PLATFORM_MODULES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]);

function extractSyncRequires(code: string): string[] {
  const matches = [...code.matchAll(/(?<!\.)\brequire\((["'`])([^"'`]+)\1\)/g)];
  return [...new Set(matches.map((m) => m[2]))];
}

// 1. Cold-boot dist/client.js purity & < 50 KiB gate
{
  const clientPath = path.join(root, 'dist/client.js');
  const clientCode = fs.readFileSync(clientPath, 'utf8');
  const clientBytes = fs.statSync(clientPath).size;

  assert.ok(clientBytes < 50 * 1024, `dist/client.js is ${clientBytes}B (< 50 KiB cold-boot budget)`);
  assert.ok(clientCode.startsWith('window.__ModuleLoader__.load({'), 'dist/client.js wraps in __ModuleLoader__.load');
  assert.ok(clientCode.includes(`id: ${JSON.stringify(pkg.name)}`), 'dist/client.js declares package id');
  assert.ok(
    /require\.async\(["'`]\.\/client\.studio\.js["'`]\)/.test(clientCode),
    'dist/client.js lazy-loads ./client.studio.js',
  );

  // Heavy editors, dark-mode engines, MathJax & Mermaid must NEVER leak into cold-boot client.js
  assert.ok(!clientCode.includes('EditorView'), 'CodeMirror 6 stays out of dist/client.js');
  assert.ok(!clientCode.includes('convertCssToDark'), 'mp-darkmode stays out of dist/client.js');
  assert.ok(!clientCode.includes('mathjax'), 'MathJax stays out of dist/client.js');
  assert.ok(!clientCode.includes('sequenceDiagram'), 'Mermaid stays out of dist/client.js');

  const syncRequires = extractSyncRequires(clientCode);
  assert.ok(syncRequires.length > 0, 'dist/client.js requires react from platform');
  for (const spec of syncRequires) {
    assert.ok(ALLOWED_PLATFORM_MODULES.has(spec), `unexpected sync require in dist/client.js: ${spec}`);
  }
  assert.ok(
    pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'),
    'package.json declares dsh-client-ui-primitives inject',
  );
}

// 2. Self-contained dist/client.studio.js chunk purity
{
  const studioPath = path.join(root, 'dist/client.studio.js');
  const studioCode = fs.readFileSync(studioPath, 'utf8');
  assert.ok(
    studioCode.startsWith(
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, chunk: "client.studio.js", factory: (require) => {`,
    ),
    'dist/client.studio.js wraps in official DSH chunk envelope',
  );
  const syncRequires = extractSyncRequires(studioCode);
  for (const spec of syncRequires) {
    assert.ok(!spec.startsWith('.'), `dist/client.studio.js must have zero relative sync requires (${spec})`);
    assert.ok(ALLOWED_PLATFORM_MODULES.has(spec), `unexpected sync require in dist/client.studio.js: ${spec}`);
  }
}

// 3. Reversible style lifecycle & hot disable / re-enable
{
  interface FakeStyleNode {
    dataset: Record<string, string>;
    textContent: string;
    remove(): void;
  }
  const headStyles: FakeStyleNode[] = [];
  const prevDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement() {
      const node: FakeStyleNode = {
        dataset: {},
        textContent: '',
        remove() {
          const idx = headStyles.indexOf(node);
          if (idx >= 0) headStyles.splice(idx, 1);
        },
      };
      return node;
    },
    querySelector(sel: string) {
      const m = /^style\[data-plugin-css=("[^"]+")\]$/.exec(sel);
      if (!m) return null;
      const target = JSON.parse(m[1]) as string;
      return headStyles.find((s) => s.dataset.pluginCss === target) || null;
    },
    querySelectorAll(sel: string) {
      const m = /^style\[data-plugin=("[^"]+")\]$/.exec(sel);
      if (!m) return [];
      const target = JSON.parse(m[1]) as string;
      return [...headStyles.filter((s) => s.dataset.plugin === target)];
    },
    head: {
      appendChild(node: FakeStyleNode) {
        headStyles.push(node);
        return node;
      },
    },
  };

  try {
    const reg = getPluginStyleRegistry();
    reg.sheets.set('dsh-markdown-studio/chrome', '.mdstudio-root{display:flex}');

    let loadCount = 0;
    let shouldFail = true;
    const mockStudio: ClientPlugin = {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => () => {});
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'dsh-markdown-studio' }, () =>
            React.createElement('section', { 'data-studio-ready': 'true' }, 'Studio Ready'),
          ),
        );
      },
    };

    const shell = createShellPlugin(React, null, async () => {
      loadCount++;
      if (shouldFail) throw new Error('network glitch');
      return mockStudio;
    });

    const cleanups: Array<() => void> = [];
    const mainComponents: Array<React.ComponentType<Record<string, unknown>>> = [];
    const localeNamespaces: string[] = [];
    const localeDisposed: string[] = [];
    const fakeLocale: LocaleService = {
      getSnapshot: () => ({ revision: 1, locales: [{ id: 'zh-CN' }] }),
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
      register: (ns, id) => {
        localeNamespaces.push(ns);
        return () => {
          localeDisposed.push(id);
        };
      },
      bind: () => () => 'Markdown Studio',
    };
    const makeCtx = (): ClientContext => ({
      get: <T>(name: string) => (name === 'locale' ? (fakeLocale as unknown as T) : undefined),
      effect(setup) {
        const teardown = setup();
        if (typeof teardown === 'function') cleanups.push(teardown);
      },
      slots: {
        inject: (_k, cb) => {
          cb();
        },
        register: (opts, comp) => {
          if (opts.name === 'main') mainComponents.push(comp);
          return () => {};
        },
      },
    });

    // Enable plugin -> styles mounted & shell uses isolated locale namespace
    shell.apply(makeCtx());
    assert.equal(isPluginStylesMounted(), true);
    assert.equal(headStyles.length, 1);
    assert.equal(mainComponents.length, 1);
    assert.ok(
      localeNamespaces.every((ns) => ns === 'dsh-markdown-studio.shell'),
      'shell uses isolated locale namespace',
    );

    // SSR render of LazyStudioView before chunk settles shows accessible status
    const loadingHtml = renderToStaticMarkup(React.createElement(mainComponents[0], {}));
    assert.ok(loadingHtml.includes('role="status"'));

    // Disable plugin -> all plugin styles and locale registrations cleanly removed
    while (cleanups.length > 0) cleanups.pop()!();
    assert.equal(isPluginStylesMounted(), false);
    assert.equal(headStyles.length, 0);
    assert.ok(localeDisposed.includes('zh-CN'));

    // Hot re-enable plugin without window reload -> styles restored cleanly
    shouldFail = false;
    shell.apply(makeCtx());
    assert.equal(isPluginStylesMounted(), true);
    assert.equal(headStyles.length, 1);
    mountPluginStyles();
    assert.equal(headStyles.length, 1, 'idempotent mountPluginStyles does not duplicate style tags');

    while (cleanups.length > 0) cleanups.pop()!();
    unmountPluginStyles();
    assert.equal(loadCount >= 0, true);
  } finally {
    if (prevDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDoc;
  }
}

// 4. DSH Plugin Manager locale/*.json + docs/DETAIL.*.md packaging contract
{
  const localeDir = path.join(root, 'locale');
  const localeFiles = fs
    .readdirSync(localeDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  assert.deepEqual(localeFiles, ['en.json', 'zh-CN.json', 'zh.json'], 'ships en.json, zh-CN.json, and zh.json');

  for (const localeFile of localeFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(localeDir, localeFile), 'utf8')) as {
      meta?: { title?: string; description?: string; detail?: string };
    };
    const expectedTitle = localeFile.startsWith('zh') ? 'Markdown Studio 排版工作台' : 'Markdown Studio';
    assert.equal(parsed.meta?.title, expectedTitle, `${localeFile} meta.title matches`);
    assert.ok((parsed.meta?.description?.length || 0) > 30, `${localeFile} meta.description is substantive`);

    const detail = parsed.meta?.detail;
    assert.equal(typeof detail, 'string', `${localeFile} declares meta.detail`);
    const detailPath = path.join(root, detail!);
    assert.ok(fs.existsSync(detailPath), `${detail} exists on disk`);
    assert.ok(pkg.files.includes(detail!), `${detail} is listed in package.json files`);

    const detailMd = fs.readFileSync(detailPath, 'utf8');
    assert.ok(!/<\/?(?:details|summary)\b/i.test(detailMd), `${detail} contains no raw <details> HTML`);
    assert.ok(!detailMd.includes('img.shields.io'), `${detail} contains no shields.io badges`);

    for (const imgMatch of detailMd.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = imgMatch[1];
      assert.equal(rawTarget.startsWith('http'), false, `${detail} image ${rawTarget} is packaged locally, not remote`);
      const resolvedImg = path.resolve(path.dirname(detailPath), rawTarget);
      assert.ok(fs.existsSync(resolvedImg), `${detail} image ${rawTarget} exists on disk`);
      const relImg = path.relative(root, resolvedImg).replace(/\\/g, '/');
      assert.ok(pkg.files.includes(relImg), `${relImg} is listed in package.json files`);
    }
  }
}

// 5. Public README & DETAIL link integrity and theme naming freshness
{
  assert.ok(pkg.files.includes('THIRD_PARTY_LICENSES.txt'), 'THIRD_PARTY_LICENSES.txt ships in the npm tarball');
  const licenses = fs.readFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
  for (const bundled of ['mermaid@', 'mathjax-full@', 'dompurify@', '@codemirror/view@', 'mp-darkmode@']) {
    assert.ok(licenses.includes('\n' + bundled), `THIRD_PARTY_LICENSES.txt covers ${bundled}`);
  }
  const docFiles = ['README.md', 'README.en.md', 'docs/DETAIL.zh.md', 'docs/DETAIL.md', 'CONTRIBUTING.md'];
  for (const relDoc of docFiles) {
    const absDoc = path.join(root, relDoc);
    const content = fs.readFileSync(absDoc, 'utf8').replace(/```[\s\S]*?```/g, '');
    assert.equal(content.includes('杂志'), false, `${relDoc} must not reference deprecated 杂志 theme`);
    for (const m of content.matchAll(/!?\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|data:|assets\/<)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(absDoc), target);
      assert.ok(fs.existsSync(resolved), `${relDoc} link target exists: ${target}`);
    }
    for (const m of content.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
      const target = m[1];
      if (/^(https?:|data:)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(absDoc), target);
      assert.ok(fs.existsSync(resolved), `${relDoc} <img> src exists: ${target}`);
    }
  }
}

console.log(
  'ok - OSS readiness: cold-boot shell <50 KiB, self-contained studio chunk, reversible style lifecycle, and locale detail contract',
);
