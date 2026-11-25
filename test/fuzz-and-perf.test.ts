import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';
import { markdownHeadings, markdownToPlain } from '../src/domain/article';
import { hasExternalCssUrl, stripExternalCssUrls } from '../src/domain/custom-css';
import { assetFilesInMarkdown, collectLocalImages, replaceLocalImages } from '../src/domain/images';
import { computeTextDiff } from '../src/domain/text-diff';
import { sanitizeImageUrl, sanitizeLinkUrl } from '../src/domain/urls';
import { inspectWechatHtml } from '../src/domain/wechat-html-lint';
import { extractProtectedTokens } from '../src/domain/writing-skills';
import { engine } from '../src/engine';
import { buildCss, DEFAULT_SETTINGS } from '../src/themes';

function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/* ------------------------------------------------------------------------- */
/* 1. Deterministic Markdown Parser Fuzzing (No Crash, No ReDoS, No XSS)     */
/* ------------------------------------------------------------------------- */

const MD_FRAGMENTS = [
  '# Heading ',
  '## Sub ',
  '***bold italic*** ',
  '**unclosed bold ',
  '__underline?__ ',
  '++under++ ',
  '==mark== ',
  '~~strike~~ ',
  '`inline code` ',
  '```ts\nconst x = 1;\n```\n',
  '~~~mermaid\ngraph TD; A-->B;\n~~~\n',
  '$a^2 + b^2 = c^2$ ',
  '$$\n\\frac{1}{2}\n$$\n',
  '\\(x+1\\) ',
  '\\[y=2\\]\n',
  'Price $100 and $200.50 ',
  '> [!TIP]\n> quoted line\n',
  ':::lead\nLead paragraph\n:::\n',
  ':::scroll-x\n| A | B |\n| --- | --- |\n| 1 | 2 |\n:::\n',
  '- [x] done\n- [ ] todo\n',
  '1. ordered\n2. second\n',
  '[ref][1]\n\n[1]: https://example.com\n',
  '[^fn1]\n\n[^fn1]: footnote text\n',
  '[bad](javascript:alert(1)) ',
  '[bad2](vbscript:msgbox(1)) ',
  '[bad3](//evil.example/a) ',
  '[bad4](/\\evil.example/a) ',
  '![img](javascript:alert(1)) ',
  '![img2](assets/0123456789abcdef01234567.png) ',
  '<script>alert(1)</script> ',
  '***a** *b*** ',
  '| a | b |\n| :--- | ---: |\n| $100 | `x|y` |\n',
  '\\*\\*escaped\\*\\* ',
  '--- \n',
];

const randMd = createPrng(0x20261122);
const UNSAFE_HTML_HREF = /\b(?:href|src)\s*=\s*["']\s*(?:javascript:|vbscript:|data:text\/html|\/\/)/i;
const RAW_SCRIPT_TAG = /<script\b/i;

for (let i = 0; i < 300; i++) {
  const parts: string[] = [];
  const count = 4 + Math.floor(randMd() * 18);
  for (let j = 0; j < count; j++) {
    parts.push(pick(randMd, MD_FRAGMENTS));
    if (randMd() < 0.35) parts.push('\n');
  }
  const doc = parts.join('');
  const start = performance.now();
  const rendered = engine.renderMarkdown(doc, { linkFootnotes: i % 2 === 0 });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 250, `Markdown fuzz #${i} exceeded 250ms (${elapsed.toFixed(1)}ms)`);
  assert.ok(!UNSAFE_HTML_HREF.test(rendered.html), `Markdown fuzz #${i} leaked unsafe href/src`);
  assert.ok(!RAW_SCRIPT_TAG.test(rendered.html), `Markdown fuzz #${i} leaked raw <script> tag`);
  // Companion domain scanners must also stay crash-free and fast
  markdownHeadings(doc);
  markdownToPlain(doc);
  extractProtectedTokens(doc);
}

// Targeted pathological ReDoS probes
const REDOS_PROBES = [
  '*'.repeat(400) + 'a',
  '_'.repeat(400) + 'a',
  '`'.repeat(300) + 'code',
  '['.repeat(200) + 'text' + ']('.repeat(50),
  '> '.repeat(80) + 'nested quote',
  '| a '.repeat(80) + '|\n' + '| --- '.repeat(80) + '|\n' + '| 1 '.repeat(80) + '|',
  '$'.repeat(200) + '100',
];
for (let i = 0; i < REDOS_PROBES.length; i++) {
  const t0 = performance.now();
  engine.renderMarkdown(REDOS_PROBES[i], { linkFootnotes: true });
  const dt = performance.now() - t0;
  assert.ok(dt < 300, `ReDoS probe #${i} exceeded 300ms (${dt.toFixed(1)}ms)`);
}

/* ------------------------------------------------------------------------- */
/* 2. Deterministic Custom CSS & URL Sanitizer Fuzzing                       */
/* ------------------------------------------------------------------------- */

const CSS_ATTACK_FRAGMENTS = [
  '/* comment */',
  '/* unclosed comment',
  'url("https://evil.example/track.png")',
  'url(//evil.example/track.png)',
  'url(/\\evil.example/track.png)',
  '\\75 rl(https://evil.example/x.png)',
  '\\75\\nrl(https://evil.example/x.png)',
  'image-set("https://evil.example/a.png" 1x)',
  'src("https://evil.example/b.png")',
  '@import url("https://evil.example/s.css");',
  '@import "https://evil.example/s2.css";',
  '--bg: url(https://evil.example/v.png); background: var(--bg);',
  'background: url("data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\"></svg>");',
  'color: #1a2b3c; font-size: 16px;',
  'content: "escaped \\" url(https://evil.example/c.png)";',
  'border-left: 3px solid var(--mdstudio-accent, #2563eb);',
];

const randCss = createPrng(0xc55f00d);
for (let i = 0; i < 200; i++) {
  const rules: string[] = [];
  const count = 2 + Math.floor(randCss() * 6);
  for (let j = 0; j < count; j++) {
    rules.push(`#mdstudio p { ${pick(randCss, CSS_ATTACK_FRAGMENTS)} }`);
  }
  const css = rules.join('\n');
  const t0 = performance.now();
  const clean = stripExternalCssUrls(css);
  const dt = performance.now() - t0;
  assert.ok(dt < 150, `CSS fuzz #${i} exceeded 150ms (${dt.toFixed(1)}ms)`);
  assert.equal(
    hasExternalCssUrl(clean),
    false,
    `CSS fuzz #${i} leaked external URL after stripExternalCssUrls:\nIN:\n${css}\nOUT:\n${clean}`,
  );
  assert.ok(!/@import\b/i.test(clean), `CSS fuzz #${i} leaked @import`);
}

// Exhaustive dangerous URL vectors (including embedded control chars inside http/https scheme)
const DANGEROUS_URLS = [
  'javascript:alert(1)',
  '  JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'ht\ttp://evil.example/x',
  'ht\ntp://evil.example/x',
  'https:evil.example/no-slashes',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  '//evil.example/path',
  '\\\\evil.example\\path',
  '/\\evil.example/path',
  '\\/evil.example/path',
  'file:///etc/passwd',
];
for (const bad of DANGEROUS_URLS) {
  assert.equal(sanitizeLinkUrl(bad), null, `sanitizeLinkUrl rejects ${JSON.stringify(bad)}`);
  assert.equal(sanitizeImageUrl(bad), null, `sanitizeImageUrl rejects ${JSON.stringify(bad)}`);
}

// Linear O(n) image scanning ReDoS probes (G7)
for (const [label, payload, runner] of [
  ['unclosed ![' as const, '!['.repeat(20_000), (s: string) => assetFilesInMarkdown(s)],
  ['unclosed <img ' as const, '<img '.repeat(20_000), (s: string) => assetFilesInMarkdown(s)],
  ['unclosed ![a](<' as const, '![a](<'.repeat(12_000), (s: string) => collectLocalImages(s)],
  ['repeated ***a' as const, '***a '.repeat(2500), (s: string) => engine.renderMarkdown(s)],
  ['unclosed [' as const, '[a'.repeat(5000) + ']', (s: string) => engine.renderMarkdown(s)],
] as const) {
  const t0 = performance.now();
  runner(payload);
  const dt = performance.now() - t0;
  assert.ok(dt < 150, `Image/MD scan ReDoS probe (${label}) exceeded 150ms (${dt.toFixed(1)}ms)`);
}
// CSS pseudo content backslash ReDoS & comment/quote smuggling probes
{
  const redosDom = new JSDOM('<!doctype html><section id="mdstudio"><p>x</p></section>');
  const t0 = performance.now();
  engine.inlineCss(
    redosDom.window.document.getElementById('mdstudio')!,
    `p::before { content: "${'\\'.repeat(200)}"; }`,
  );
  assert.ok(performance.now() - t0 < 50, 'evaluatePseudoContent backslash ReDoS probe < 50ms');
  redosDom.window.close();
  for (const smuggle of [
    'p { background: red/**/url(https://evil.example/a.png); }',
    'p { background: u/*x*/rl(https://evil.example/a.png); }',
    'p { content: "\\\\"; } @import url(https://evil.example/b.css);',
  ]) {
    assert.equal(stripExternalCssUrls(smuggle).includes('evil.example'), false, `CSS sanitizer blocks ${smuggle}`);
  }
}
// Image destination parser + replaceLocalImages coverage (angled, nested parens, single/double/paren titles)
const imgDoc = [
  '![a](<assets/0123456789abcdef01234567.png> "double title")',
  "![b](assets/fedcba9876543210fedcba98.jpg 'single title')",
  '![c](assets/aaaaaaaaaaaaaaaaaaaaaaaa.png (paren title))',
  '![d](https://example.com/a(1).png)',
  '![e](data:image/png;base64,AAAA)',
].join('\n');
assert.equal(collectLocalImages(imgDoc).size, 4);
const replacedImgs = replaceLocalImages(
  imgDoc,
  new Map([
    ['assets/0123456789abcdef01234567.png', 'assets/111111111111111111111111.png'],
    ['data:image/png;base64,AAAA', 'assets/222222222222222222222222.png'],
  ]),
);
assert.ok(replacedImgs.includes('![a](<assets/111111111111111111111111.png> "double title")'));
assert.ok(replacedImgs.includes('![e](assets/222222222222222222222222.png)'));
assert.equal(replaceLocalImages('plain text', new Map([['x', 'y']])), 'plain text');
assert.equal(
  replaceLocalImages('![a](assets/0123456789abcdef01234567.png)', new Map()),
  '![a](assets/0123456789abcdef01234567.png)',
);

/* ------------------------------------------------------------------------- */
/* 3. Large-Document Hot-Path Performance Budget (~10,000 chars)             */
/* ------------------------------------------------------------------------- */

const sectionTemplate = (idx: number) =>
  [
    `## 第 ${idx} 节：排版与架构实战`,
    '',
    `这一段包含 **加粗**、*斜体*、==高亮==、++下划线++、\`inlineCode(${idx})\`、公式 $E_${idx} = mc^2$ 以及外链 [参考 ${idx}](https://example.com/ref/${idx})。`,
    '',
    '> [!TIP] 要点提示',
    `> 第 ${idx} 节的核心结论：保持纯函数与确定性模型检测。`,
    '',
    '| 指标 | 当前值 | 预算 |',
    '| :--- | :---: | ---: |',
    `| 模块 ${idx} | 12.4 ms | < 50 ms |`,
    `| 覆盖率 | 95% | >= 90% |`,
    '',
    '```ts',
    `export function metric${idx}(n: number): number {`,
    '  return n > 0 ? n * 2 : 0;',
    '}',
    '```',
    '',
  ].join('\n');

const largeDoc =
  '# 万字长文热路径性能基准测试\n\n:::lead\n验证万字 Markdown 在每次击键热路径下的解析、大纲提取、CSS 内联与 Diff 性能预算。\n:::\n\n' +
  Array.from({ length: 42 }, (_, idx) => sectionTemplate(idx + 1)).join('\n');

assert.ok(largeDoc.length >= 10_000, `large benchmark doc has >= 10k chars (actual ${largeDoc.length})`);

const parseStart = performance.now();
const parsedLarge = engine.renderMarkdown(largeDoc, { linkFootnotes: true });
const parseMs = performance.now() - parseStart;

const headingStart = performance.now();
const headings = markdownHeadings(largeDoc);
const headingMs = performance.now() - headingStart;

const dom = new JSDOM(`<!doctype html><section id="mdstudio">${parsedLarge.html}</section>`);
const rootEl = dom.window.document.getElementById('mdstudio')!;
const themeCss = buildCss(DEFAULT_SETTINGS);
const inlineStart = performance.now();
engine.inlineCss(rootEl, themeCss);
const inlineMs = performance.now() - inlineStart;

const lintIssues = inspectWechatHtml(rootEl.outerHTML);
assert.deepEqual(lintIssues, [], 'large benchmark WeChat HTML passes compatibility lint');

const diffBefore = largeDoc.slice(0, 1200);
const diffAfter = diffBefore.replace(/排版/g, '工程化排版');
const diffStart = performance.now();
const diffResult = computeTextDiff(diffBefore, diffAfter);
const diffMs = performance.now() - diffStart;

// Semantic quality oracle (not just "fast"): 1.2k CJK localized edit must stay pinpoint instead of collapsing to 100% replacement
const diffAddedChars = diffResult.addOffsets.reduce((sum, span) => sum + (span.toOffset - span.fromOffset), 0);
const diffAddRatio = diffAddedChars / diffAfter.length;
assert.ok(
  diffAddRatio > 0 && diffAddRatio < 0.15,
  `computeTextDiff(1.2k CJK) semantic precision degraded: addRatio=${diffAddRatio.toFixed(2)} (expected 0 < r < 0.15)`,
);
assert.ok(diffResult.addOffsets.length >= 1, 'computeTextDiff(1.2k CJK) emits non-empty pinpoint addOffsets');

assert.equal(headings.length, 43, 'large doc extracts all 43 headings');
assert.ok(parseMs < 500, `renderMarkdown(10k) within budget (${parseMs.toFixed(1)}ms < 500ms)`);
assert.ok(headingMs < 150, `markdownHeadings(10k) within budget (${headingMs.toFixed(1)}ms < 150ms)`);
assert.ok(inlineMs < 2500, `inlineCss(10k in JSDOM) within budget (${inlineMs.toFixed(1)}ms < 2500ms)`);
assert.ok(diffMs < 150, `computeTextDiff(1.2k) within budget (${diffMs.toFixed(1)}ms < 150ms)`);

console.log(
  `ok - fuzz & perf budgets passed (300 MD fuzz + 200 CSS fuzz + ReDoS probes; ` +
    `${largeDoc.length} chars: parse=${parseMs.toFixed(1)}ms, headings=${headingMs.toFixed(1)}ms, inline=${inlineMs.toFixed(1)}ms, diff=${diffMs.toFixed(1)}ms)`,
);
