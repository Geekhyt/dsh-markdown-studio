import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderArticle } from '../src/adapters/render-article';
import { inspectWechatHtml } from '../src/domain/wechat-html-lint';
import { DEFAULT_SETTINGS, SAMPLE_MARKDOWN, THEMES } from '../src/themes';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: dom.window.NodeFilter });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

const forbidden = [
  [/!important/i, '!important'],
  [/data-no-dark/i, 'data-no-dark whitelist'],
  [/font-family/i, 'font-family'],
  [/(?:^|[;"\s])opacity\s*:/i, 'opacity'],
  [/caret-color\s*:/i, 'caret-color'],
  [/text-align\s*:\s*(?:start|end)\b/i, 'logical text-align start/end'],
  [/(?:height|font-size|line-height)\s*:\s*0(?:px|em|rem)?\s*(?:;|"|$)/i, 'zero visual box'],
  [
    /@media|@import|@font-face|:hover|::before|::after|linear-gradient|position\s*:\s*(?:fixed|sticky|absolute)/i,
    'unsupported style',
  ],
] as const;

const BLOCK_TAGS_IN_SPAN = 'div,p,section,blockquote,pre,table,ul,ol,h1,h2,h3,h4,h5,h6,hr';

for (const theme of THEMES) {
  const settings = { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent };
  const preview = renderArticle(SAMPLE_MARKDOWN, settings, {
    forCopy: false,
    forPreview: true,
    footnotesTitle: '脚注',
  });
  const rendered = renderArticle(SAMPLE_MARKDOWN, settings, {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  });
  assert.ok(rendered.html.startsWith('<section id="mdstudio"'), `${theme.id} keeps the section root`);
  assert.deepEqual(inspectWechatHtml(rendered.html), [], `${theme.id} passes inspectWechatHtml cleanly`);
  const previewDoc = new JSDOM(preview.html).window.document;
  const parsed = new JSDOM(rendered.html).window.document;
  const firstHeading = parsed.querySelector('h1');
  assert.equal(firstHeading?.style.marginTop, '0px', `${theme.id} starts the first heading flush`);
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(rendered.html), false, `${theme.id} copy avoids ${label}`);
  }
  // WYSIWYG parity: Copy must preserve all background & foreground styles shown in Preview
  for (const selector of [
    '#mdstudio',
    'h2',
    'h2 .mdstudio-heading-content',
    'h4',
    'p code',
    'mark',
    'blockquote',
    '.mdstudio-alert-note',
    '.mdstudio-alert-note .mdstudio-alert-title',
    'pre',
    'th',
  ]) {
    const prevEl = previewDoc.querySelector<HTMLElement>(selector);
    const copyEl = parsed.querySelector<HTMLElement>(selector);
    assert.ok(prevEl && copyEl, `${theme.id} renders ${selector} in both preview and copy`);
    assert.equal(
      copyEl.style.backgroundColor,
      prevEl.style.backgroundColor,
      `${theme.id} copy preserves ${selector} background-color`,
    );
    assert.equal(copyEl.style.color, prevEl.style.color, `${theme.id} copy preserves ${selector} color`);
  }
  const inlineCode = parsed.querySelector<HTMLElement>('p code')!;
  assert.equal(
    inlineCode.style.display,
    'inline-block',
    `${theme.id} inline code uses inline-block for uniform pill height and vertical centering`,
  );
  assert.equal(inlineCode.style.lineHeight, '1.35', `${theme.id} inline code keeps balanced pill line-height`);
  assert.notEqual(
    inlineCode.style.backgroundColor,
    'transparent',
    `${theme.id} inline code keeps visible pill background on copy`,
  );
  assert.notEqual(inlineCode.style.backgroundColor, '', `${theme.id} inline code inlines background-color on copy`);
  assert.notEqual(inlineCode.style.color, 'inherit', `${theme.id} inline code keeps explicit color on copy`);
  const mark = parsed.querySelector<HTMLElement>('mark')!;
  assert.notEqual(mark.style.backgroundColor, 'transparent', `${theme.id} mark keeps highlight background on copy`);
  assert.notEqual(mark.style.backgroundColor, '', `${theme.id} mark inlines background-color on copy`);
  assert.notEqual(
    mark.style.color,
    'inherit',
    `${theme.id} mark uses explicit text color so mp-darkmode stays readable`,
  );
  assert.notEqual(mark.style.color, '', `${theme.id} mark inlines explicit color on copy`);
  // plugin_spec 1.4: no fixed pixel widths on content, heading, table or hr nodes
  for (const el of parsed.querySelectorAll<HTMLElement>(
    'section, p, h1, h2, h3, h4, h5, h6, blockquote, pre, table, th, td, hr, span',
  )) {
    const width = el.style.width;
    assert.equal(
      /^\d+(\.\d+)?px$/i.test(width),
      false,
      `${theme.id} avoids fixed px width on <${el.tagName.toLowerCase()}> (${width})`,
    );
  }
  // plugin_spec 1.5: no fixed height on text-containing elements
  for (const el of parsed.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, blockquote, li, th, td, pre, code, span',
  )) {
    assert.equal(el.style.height, '', `${theme.id} avoids fixed height on <${el.tagName.toLowerCase()}>`);
  }
  // plugin_spec 2.3: never nest block elements inside <span> or set display:block on <span>
  for (const span of parsed.querySelectorAll<HTMLElement>('span')) {
    assert.equal(span.querySelector(BLOCK_TAGS_IN_SPAN), null, `${theme.id} never nests block tags inside <span>`);
    assert.notEqual(span.style.display, 'block', `${theme.id} never sets display:block on <span>`);
  }
  // plugin_spec 1.8: <pre> contains code only, with no injected header text
  const firstPre = parsed.querySelector('pre');
  const firstCodeText = (firstPre?.textContent || '').replace(/\u00a0/g, ' ');
  assert.ok(
    firstCodeText.startsWith('export function greet(name)'),
    `${theme.id} keeps <pre> pure code without injected chrome text`,
  );

  assert.ok(rendered.html.includes('class="mdstudio-task"'), `${theme.id} keeps task structure`);
  const referencesAt = rendered.html.indexOf('class="mdstudio-references"');
  assert.ok(referencesAt > 0, `${theme.id} keeps the references section`);
  const inlineBody = rendered.html.slice(0, referencesAt);
  assert.equal(inlineBody.includes('https://example.com/guide'), false, `${theme.id} hides bare URLs from the body`);
  assert.equal(
    inlineBody.includes('https://example.com/changelog'),
    false,
    `${theme.id} hides bare URLs from the body`,
  );
  assert.ok(inlineBody.includes('mdstudio-ref'), `${theme.id} keeps inline reference markers`);
  assert.ok(rendered.html.includes('https://example.com/guide'), `${theme.id} keeps full URLs in references`);
  assert.ok(inlineBody.includes('DeepSeek Harness'), `${theme.id} keeps named link text`);
}
console.log('WeChat plugin_spec checks passed for all 8 themes.');

// Verify MathJax SVG inline & block formulas across all 8 themes (Preview + Copy)
dom.window.__MDSTUDIO_MATH__ = {
  cssText: 'svg[data-mml-node="math"] { vertical-align: middle; }',
  render: (tex: unknown, display?: boolean) =>
    `<svg width="${display ? '14ex' : '6ex'}" height="${display ? '4.2ex' : '2.1ex'}" viewBox="0 -800 3000 1100" data-mml-node="math" data-tex-len="${String(tex || '').length}"><g stroke="currentColor" fill="currentColor"><path data-mjx-texclass="ORD" style="opacity:1" d="M10 10H90V90H10Z"></path></g></svg>`,
};
const mathMarkdown =
  '# 公式校验\n\n行内公式 $a^2 + b^2 = c^2$ 与正常正文混排。\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n';
for (const theme of THEMES) {
  const settings = { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent };
  const preview = renderArticle(mathMarkdown, settings, { forPreview: true, forCopy: false, footnotesTitle: '脚注' });
  const previewDoc = new JSDOM(preview.html).window.document;
  const previewInline = previewDoc.querySelector<HTMLElement>('.mdstudio-math[data-mdstudio-display="0"]');
  const previewBlock = previewDoc.querySelector<HTMLElement>('.mdstudio-math[data-mdstudio-display="1"]');
  assert.ok(previewInline?.querySelector('svg'), `${theme.id} preview keeps inline math SVG`);
  assert.ok(previewBlock?.querySelector('svg'), `${theme.id} preview keeps block math SVG`);
  assert.equal(previewInline?.style.display, 'inline', `${theme.id} preview inline math stays inline`);
  assert.equal(previewBlock?.style.display, 'block', `${theme.id} preview block math stays block`);
  assert.equal(
    previewDoc.querySelectorAll('.mdstudio-math [data-mdstudio-pseudo]').length,
    0,
    `${theme.id} never injects pseudo spans into math`,
  );

  const copied = renderArticle(mathMarkdown, settings, { forPreview: false, forCopy: true, footnotesTitle: '脚注' });
  assert.deepEqual(inspectWechatHtml(copied.html), [], `${theme.id} math copy passes inspectWechatHtml`);
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(copied.html), false, `${theme.id} math copy avoids ${label}`);
  }
  const copyDoc = new JSDOM(copied.html).window.document;
  const copyInline = copyDoc.querySelector<HTMLElement>('span.mdstudio-math-inline[data-mdstudio-math="true"]');
  const copyBlock = copyDoc.querySelector<HTMLElement>('section.mdstudio-math-block[data-mdstudio-math="true"]');
  assert.ok(copyInline, `${theme.id} copy emits span.mdstudio-math-inline`);
  assert.ok(copyBlock, `${theme.id} copy emits section.mdstudio-math-block`);
  assert.equal(copyInline.style.display, 'inline', `${theme.id} copy inline equation is inline`);
  assert.equal(copyBlock.style.display, 'block', `${theme.id} copy block equation is block`);
  assert.ok(
    copyBlock.style.color !== '',
    `${theme.id} copy block equation carries explicit text color for SVG currentColor`,
  );
  assert.ok(copyBlock.style.backgroundColor !== '', `${theme.id} copy block equation carries background surface`);
  const blockSvg = copyBlock.querySelector<SVGElement>('svg');
  const blockPath = copyBlock.querySelector<SVGElement>('path');
  assert.equal(blockSvg?.style.maxWidth, '300%', `${theme.id} copy block equation preserves scrollable 300% max-width`);
  assert.equal(blockPath?.getAttribute('fill'), 'currentColor', `${theme.id} copy math path uses currentColor`);
  assert.equal(blockPath?.getAttribute('data-mjx-texclass'), null, `${theme.id} copy strips MathJax data-* attributes`);
  assert.equal(
    copyDoc.querySelectorAll('[data-mdstudio-math="true"] [data-mdstudio-pseudo]').length,
    0,
    `${theme.id} copy never injects pseudo spans into equations`,
  );
  assert.equal(
    copyDoc.querySelectorAll('p').length,
    1,
    `${theme.id} unwraps <p> around mdstudio-math-block so HTML5 parsing creates no empty <p></p>`,
  );
}
delete dom.window.__MDSTUDIO_MATH__;
console.log('MathJax formula checks passed for all 8 themes (preview + copy).');

// Mixed inline prose + block formula in one paragraph also splits cleanly without empty <p>
dom.window.__MDSTUDIO_MATH__ = {
  cssText: '',
  render: () => '<svg width="8ex" height="2ex" viewBox="0 0 100 40"><path d="M0 0h10v10H0z"></path></svg>',
};
const mixedMath = renderArticle('前文说明\n$$x = 1$$\n后文说明', DEFAULT_SETTINGS, {
  forPreview: false,
  forCopy: true,
  footnotesTitle: '脚注',
});
const mixedDoc = new JSDOM(mixedMath.html).window.document;
assert.equal(
  Array.from(mixedDoc.querySelectorAll('p')).every((p) => (p.textContent || '').trim().length > 0),
  true,
  'mixed inline + block math leaves zero empty paragraphs',
);
delete dom.window.__MDSTUDIO_MATH__;

const placeholder = renderArticle(
  '![示例图](missing-local.png)\n\n![named](data:image/png;base64,AAAA)',
  { ...DEFAULT_SETTINGS, imagePlaceholders: true },
  {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  },
);
assert.ok(
  placeholder.html.includes('mdstudio-img-placeholder'),
  'copy turns unresolved local images into placeholders',
);
assert.ok(placeholder.html.includes('示例图'), 'placeholder keeps the image alt');
console.log('copy image-placeholder check passed.');

const fallbackPlaceholder = renderArticle(
  '![](missing%ZZ.png)\n\n![](missing-two.png?x=1)',
  { ...DEFAULT_SETTINGS, imagePlaceholders: true },
  {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  },
);
assert.ok(
  fallbackPlaceholder.html.includes('missing%ZZ.png'),
  'placeholder fallback keeps malformed filenames as text',
);
assert.ok(fallbackPlaceholder.html.includes('missing-two.png'), 'placeholder fallback strips query strings');
const noPlaceholder = renderArticle(
  '![](missing.png)',
  { ...DEFAULT_SETTINGS, imagePlaceholders: false },
  { forCopy: true, forPreview: false, footnotesTitle: '脚注' },
);
assert.equal(noPlaceholder.html.includes('mdstudio-img-placeholder'), false, 'placeholder can be disabled');

const scrollMarkdown = [
  '# 滑动容器规范校验',
  '',
  ':::scroll',
  '**分镜一**：老艺人站在舞台正中，竹板一合开场。',
  '',
  '> 台词：说一句，看一版！',
  ':::',
  '',
  ':::scroll-x',
  '**01 · 批量打样**',
  '3 分钟出多版小样供挑选。',
  '---',
  '**02 · 锁定节奏**',
  '微调光影与台词衔接。',
  ':::',
  '',
  ':::scroll-x',
  '![机位 A](https://example.com/cam-a.png)',
  '![机位 B](https://example.com/cam-b.png)',
  ':::',
].join('\n');

for (const theme of THEMES) {
  const settings = { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent };
  const copied = renderArticle(scrollMarkdown, settings, {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
    scrollVerticalHint: '上下滑动 ↕',
    scrollHorizontalHint: '左右滑动 ↔',
  });
  assert.deepEqual(inspectWechatHtml(copied.html), [], `${theme.id} scroll containers pass inspectWechatHtml`);
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(copied.html), false, `${theme.id} scroll copy avoids ${label}`);
  }
  const doc = new JSDOM(copied.html).window.document;
  const vBody = doc.querySelector<HTMLElement>('.mdstudio-scroll-body')!;
  assert.equal(vBody.style.overflowY, 'auto', `${theme.id} vertical scroll body inlines overflow-y:auto`);
  assert.equal(vBody.style.maxHeight, '260px', `${theme.id} vertical scroll body inlines max-height:260px`);
  assert.equal(vBody.style.height, '', `${theme.id} vertical scroll body avoids fixed height`);
  const track = doc.querySelector<HTMLElement>('.mdstudio-scroll-track')!;
  assert.equal(track.style.display, 'flex', `${theme.id} horizontal track inlines display:flex`);
  assert.equal(
    track.style.flexDirection,
    'row',
    `${theme.id} horizontal track inlines explicit flex-direction:row for WeChat paragraph splitter`,
  );
  assert.equal(track.style.overflowX, 'auto', `${theme.id} horizontal track inlines overflow-x:auto`);
  for (const scrollBox of doc.querySelectorAll<HTMLElement>('.mdstudio-scroll-x')) {
    assert.equal(
      scrollBox.hasAttribute('data-ignore-width'),
      true,
      `${theme.id} scroll-x root carries data-ignore-width`,
    );
    for (const block of scrollBox.querySelectorAll<HTMLElement>(
      'section,p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,table,blockquote,pre',
    )) {
      assert.equal(
        block.hasAttribute('data-ignore-width'),
        true,
        `${theme.id} scroll-x descendant <${block.tagName.toLowerCase()}> carries data-ignore-width`,
      );
    }
  }
  for (const galleryImg of doc.querySelectorAll<HTMLImageElement>('.mdstudio-scroll-media img')) {
    assert.equal(galleryImg.style.width, '100%', `${theme.id} gallery image uses responsive width:100%`);
    assert.equal(galleryImg.style.maxWidth, '100%', `${theme.id} gallery image uses max-width:100%`);
  }
  const firstHorizontal = doc.querySelectorAll<HTMLElement>('.mdstudio-scroll-x')[0];
  const slides = Array.from(firstHorizontal.querySelectorAll<HTMLElement>('.mdstudio-scroll-slide'));
  assert.equal(slides.length, 2, `${theme.id} renders 2 horizontal cards`);
  assert.equal(slides[0].style.maxWidth, '82%', `${theme.id} horizontal card uses percentage max-width`);
  assert.equal(slides[0].style.marginRight, '10px', `${theme.id} first horizontal card has 10px right gap`);
  assert.equal(slides[1].style.marginRight, '0px', `${theme.id} last horizontal card clears right margin`);
  for (const el of doc.querySelectorAll<HTMLElement>('section, p, span')) {
    assert.equal(/^\d+(\.\d+)?px$/i.test(el.style.width), false, `${theme.id} scroll nodes avoid fixed px width`);
  }
  assert.equal(copied.text.includes(':::scroll'), false, `${theme.id} plain text strips :::scroll fence markers`);
}
console.log('Scroll containers (vertical + horizontal) pass WeChat plugin_spec across all 8 themes.');

const listAndTaskMarkdown = [
  '# 列表与待办规范校验',
  '',
  '1. 第一步',
  '2. 第二步',
  '',
  '- [x] 已完成事项',
  '- [ ] 待办事项',
  '',
  '## 嵌套与松散任务',
  '',
  '- 外层列表',
  '  - [x] 嵌套已完成',
  '  - [ ] 嵌套待办',
  '',
  '## 松散多段待办',
  '',
  '- [x] 松散任务首段',
  '',
  '  松散任务次段',
].join('\n');

const leadingZeroThemes = new Set(['gallery', 'ruby']);
for (const theme of THEMES) {
  const settings = { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent };
  const preview = renderArticle(listAndTaskMarkdown, settings, {
    forCopy: false,
    forPreview: true,
    footnotesTitle: '脚注',
  });
  const copied = renderArticle(listAndTaskMarkdown, settings, {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  });
  assert.deepEqual(inspectWechatHtml(copied.html), [], `${theme.id} list+task copy passes inspectWechatHtml`);
  const prevDoc = new JSDOM(preview.html).window.document;
  const copyDoc = new JSDOM(copied.html).window.document;
  const ol = copyDoc.querySelector<HTMLElement>('ol')!;
  const olPadEm = parseFloat(ol.style.paddingLeft);
  if (leadingZeroThemes.has(theme.id)) {
    assert.equal(ol.style.listStyleType, 'decimal-leading-zero', `${theme.id} uses decimal-leading-zero`);
    assert.ok(olPadEm >= 2.3, `${theme.id} decimal-leading-zero ol has >= 2.3em left gutter (${ol.style.paddingLeft})`);
  } else {
    assert.ok(olPadEm >= 1.85, `${theme.id} decimal ol has >= 1.85em left gutter (${ol.style.paddingLeft})`);
  }
  const topTaskList = copyDoc.querySelector<HTMLElement>('section.mdstudio-task-list')!;
  assert.ok(topTaskList, `${theme.id} converts top-level task list to section.mdstudio-task-list on copy`);
  assert.ok(
    topTaskList.querySelector('p.mdstudio-task.is-checked'),
    `${theme.id} emits p.mdstudio-task.is-checked for inline task rows`,
  );
  const looseSection = copyDoc.querySelector<HTMLElement>('section.mdstudio-task.is-checked');
  assert.ok(looseSection, `${theme.id} emits section.mdstudio-task for multi-paragraph loose task rows`);
  const prevCheckedBox = prevDoc.querySelector<HTMLElement>('.mdstudio-task-box.is-checked')!;
  const copyCheckedBox = copyDoc.querySelector<HTMLElement>('.mdstudio-task-box.is-checked')!;
  assert.equal(copyCheckedBox.style.backgroundColor, prevCheckedBox.style.backgroundColor);
  assert.equal(copyCheckedBox.style.color, prevCheckedBox.style.color);
  const doneText = copyDoc.querySelector<HTMLElement>('.mdstudio-task.is-checked .mdstudio-task-text')!;
  assert.ok(doneText.style.textDecoration.includes('line-through'), `${theme.id} strikes through completed task text`);
}
console.log('Ordered list left gutters and task-list WeChat normalization passed across all 8 themes.');

const v2EditorialMarkdown = [
  '---',
  'category: AI 写作',
  '---',
  '',
  '# 让 AI 一次就听懂你',
  '',
  ':::lead',
  '写了三百字，AI 还是答非所问？五分钟讲一个今天就能照做的写法。',
  ':::',
  '',
  ':::tldr',
  '1. 先说结果，再给背景',
  '2. 一次只交代一件事',
  ':::',
  '',
  '## 先说你要什么',
  '',
  '### 紧跟小节',
  '',
  '大多数人写提示词，习惯从背景讲起。**最先读到的那句话，分量最重。**',
  '',
  ':::pull',
  '给一个例子，胜过十句要求。',
  ':::',
  '',
  '![图：把目标挪到第一行之后](https://example.com/cover.png)',
  '',
  ':::sign',
  '写于一个不赶时间的下午。',
  '觉得有用，就点个「在看」吧。',
  ':::',
].join('\n');

for (const theme of THEMES) {
  const settings = { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent };
  const copied = renderArticle(v2EditorialMarkdown, settings, {
    forCopy: true,
    forPreview: false,
    footnotesTitle: '脚注',
  });
  assert.deepEqual(inspectWechatHtml(copied.html), [], `${theme.id} v2 editorial blocks pass inspectWechatHtml`);
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(copied.html), false, `${theme.id} v2 editorial blocks avoid ${label}`);
  }
  const doc = new JSDOM(copied.html).window.document;
  assert.ok(doc.querySelector('.mdstudio-meta'), `${theme.id} emits .mdstudio-meta`);
  assert.ok(doc.querySelector('.mdstudio-lead'), `${theme.id} emits explicit .mdstudio-lead`);
  assert.ok(doc.querySelector('.mdstudio-tldr-title')?.textContent, `${theme.id} fills localized tldr title`);
  const adjacentH3 = doc.querySelector<HTMLElement>('h2 + h3');
  assert.equal(adjacentH3?.style.marginTop, '0.75em', `${theme.id} tightens consecutive h2 + h3 top margin`);
  assert.ok(doc.querySelector('.mdstudio-pull'), `${theme.id} emits .mdstudio-pull`);
  const figure = doc.querySelector<HTMLElement>('.mdstudio-figure');
  assert.ok(figure, `${theme.id} emits .mdstudio-figure wrapper for captioned image`);
  assert.equal(figure?.style.marginBottom, '0.45em', `${theme.id} keeps tight image-to-caption proximity`);
  assert.ok(doc.querySelector('.mdstudio-caption'), `${theme.id} emits .mdstudio-caption`);
  assert.ok(doc.querySelector('.mdstudio-sign'), `${theme.id} emits .mdstudio-sign`);
  for (const span of doc.querySelectorAll<HTMLElement>('span')) {
    assert.notEqual(span.style.display, 'block', `${theme.id} v2 copy never sets display:block on <span>`);
  }
}
console.log('v2 editorial blocks (meta, tldr, pull, caption, sign) pass WeChat plugin_spec across all 8 themes.');

{
  // Real MathJax chunk: the TeX `html` extension (\href, \style, \class, \cssId) must stay
  // disabled so formulas can never smuggle `javascript:` links or page-wide styles into the
  // DSH preview, exported HTML or the WeChat clipboard.
  const { render } = await import('../src/math-entry');
  const svg = render('\\href{javascript:alert(1)}{x} + \\style{position:fixed;inset:0}{y} + \\frac{a}{b}', false);
  const body = svg.replace(/aria-label="[^"]*"/, '');
  assert.equal(/<a[\s>]/i.test(body), false, 'formula SVG contains no anchors');
  assert.equal(/javascript:/i.test(body), false, 'formula SVG carries no javascript: URL');
  assert.equal(body.includes('position:fixed'), false, 'formula SVG carries no injected styles');
  assert.ok(body.includes('data-mml-node="mfrac"'), 'ordinary TeX still renders');
  delete dom.window.__MDSTUDIO_MATH__;
  console.log('MathJax chunk rejects \\href / \\style injection.');
}
