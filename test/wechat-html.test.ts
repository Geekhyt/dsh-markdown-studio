import assert from 'node:assert/strict';
import { inspectWechatHtml } from '../src/domain/wechat-html-lint';

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
console.log('10 WeChat HTML checks passed.');
