import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderArticle } from '../src/adapters/render-article';
import { prepareClipboardDom, removeEmptyZeroHeightContainers } from '../src/adapters/wechat-clipboard-dom';
import { inspectWechatHtml } from '../src/domain/wechat-html-lint';
import { DEFAULT_SETTINGS } from '../src/themes';

const safe =
  '<section id="mdstudio" data-tool="dsh-markdown-studio"><p style="color:#333">正文</p><img src="https://example.com/a.png"></section>';
assert.deepEqual(inspectWechatHtml(safe), []);

const div = inspectWechatHtml('<div id="mdstudio"><p>正文</p></div>').map((issue) => issue.code);
assert.deepEqual(div, ['root-not-section']);

const all = inspectWechatHtml(
  '<section id="mdstudio"><style>p{}</style><p style="color:var(--x); width:calc(100% - 1px); line-height:0; height:0; font-size:0; font-family:Arial; display:grid; background:linear-gradient(#fff,#000)">x</p><img src="http://127.0.0.1:4010/uploads/a.png"><span class="katex"></span><ul><li>a<ul><li>b</li></ul></li></ul><a href="#fn-1">1</a></section>',
).map((issue) => issue.code);
assert.deepEqual(all, [
  'style-tag',
  'css-variable',
  'css-calc',
  'local-image',
  'katex-html',
  'nested-list',
  'fragment-link',
  'line-height-zero',
  'height-zero',
  'font-size-zero',
  'font-family',
  'unsupported-layout',
  'gradient-background',
]);

// Code blocks using ```katex or illustrating href/src/style examples and data-style must not false-positive
const codeExampleHtml =
  '<section id="mdstudio" data-style="font-family:Arial"><pre><code class="mdstudio-lang-katex">\\frac{1}{2}</code></pre>' +
  '<pre><code class="mdstudio-lang-html"><div style="display:grid;font-family:Arial"><a href="#section">demo</a><img src="http://127.0.0.1:4010/a.png"></div></code></pre></section>';
assert.deepEqual(
  inspectWechatHtml(codeExampleHtml),
  [],
  'mdstudio-lang-katex, data-style, and code-body style examples do not trigger false-positive WeChat lint issues',
);

// G5 WeChat clipboard DOM regressions: mixed bullet+task lists, nested tasks, blockquote lists inside <li>,
// inline image placeholder <span>, missing MathJax fallback, and zero-height empty container pruning.
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: dom.window.NodeFilter });

  const mixedMd = [
    '- Regular bullet 1',
    '  - Nested regular bullet',
    '- [x] Done task',
    '- [ ] Open task',
    '',
    '1. Phase 1',
    '   - [x] Nested task done',
    '',
    '- List item with quote',
    '',
    '  > Quoted heading',
    '  > - Quoted bullet inside blockquote',
    '',
    'Inline missing image: before ![badge](missing.png) after.',
    '',
    'Formula without runtime: $a^2 + b^2 = c^2$.',
  ].join('\n');

  delete (dom.window as { __MDSTUDIO_MATH__?: unknown }).__MDSTUDIO_MATH__;
  const rendered = renderArticle(mixedMd, DEFAULT_SETTINGS, {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  });
  const parsed = new JSDOM(rendered.html).window.document;

  assert.ok(
    Array.from(parsed.querySelectorAll('ul > li')).some((li) => (li.textContent || '').includes('Regular bullet 1')),
    'mixed bullet+task list preserves regular bullets as <ul><li>',
  );
  assert.equal(
    parsed.querySelectorAll('ul > li.mdstudio-task').length,
    0,
    'both top-level and nested task lists convert to <section class="mdstudio-task-list">',
  );
  const bq = parsed.querySelector('blockquote');
  assert.ok(
    bq && (bq.textContent || '').includes('Quoted bullet inside blockquote'),
    'lists inside <blockquote> inside <li> remain inside the blockquote',
  );
  const inlinePlaceholder = parsed.querySelector('.mdstudio-img-placeholder');
  assert.equal(inlinePlaceholder?.tagName, 'SPAN', 'inline missing image uses <span> placeholder inside mixed <p>');
  assert.ok(
    (parsed.body.textContent || '').includes('a^2 + b^2 = c^2'),
    'missing __MDSTUDIO_MATH__ preserves raw TeX instead of deleting the equation',
  );

  // Direct removeEmptyZeroHeightContainers + hasNonZeroBoxStyle coverage
  const boxDoc = new JSDOM(
    '<!doctype html><section id="root"><section id="empty-zero"></section><section id="with-border" style="border-top: 2px solid #333;"></section><section id="with-pad" style="padding-top: 8px;"></section><section id="with-height" style="height: 12px;"></section></section>',
  ).window.document;
  const boxRoot = boxDoc.getElementById('root')!;
  prepareClipboardDom(boxRoot);
  removeEmptyZeroHeightContainers(boxRoot);
  assert.equal(boxRoot.querySelector('#empty-zero'), null, 'truly zero-height empty section is pruned');
  assert.ok(boxRoot.querySelector('#with-border'), 'empty section with positive border is preserved');
  assert.ok(boxRoot.querySelector('#with-pad'), 'empty section with positive padding is preserved');
  assert.ok(boxRoot.querySelector('#with-height'), 'empty section with positive height is preserved');
  dom.window.close();
}

console.log('19 WeChat HTML checks passed.');
