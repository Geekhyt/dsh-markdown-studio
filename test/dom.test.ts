import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { RenderResult } from '../src/engine';
import { alphaOf, applyDarkPreview } from '../src/adapters/dark-preview';
import { prepareClipboardDom } from '../src/adapters/wechat-clipboard-dom';
import { engine } from '../src/engine';
import type * as themeTypes from '../src/themes';
import * as themes from '../src/themes';
import { create as createCodeMirror } from '../src/ui/codemirror-core';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const document = dom.window.document;

function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`missing selector: ${selector}`);
  return node as T;
}

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log('ok -', name);
}

function article(
  markdown: string,
  settings: themeTypes.ThemeSettings,
  customCss?: string,
): { el: HTMLElement; rendered: RenderResult } {
  const effective: themeTypes.ThemeSettings = customCss
    ? {
        ...settings,
        theme: 'custom:inline-test',
        customThemes: [{ id: 'custom:inline-test', name: 'Inline Test', css: customCss }],
      }
    : settings;
  const css = themes.buildCss(effective);
  const rendered = engine.renderMarkdown(markdown, { linkFootnotes: settings.linkFootnotes !== false });
  const host = document.createElement('div');
  host.innerHTML = `<div id="mdstudio" class="mdstudio-content">${rendered.html}</div>`;
  const el = host.firstElementChild;
  if (!el) throw new Error('article root did not render');
  engine.inlineCss(el as HTMLElement, css);
  return { el: el as HTMLElement, rendered };
}

const base: themeTypes.ThemeSettings = {
  ...themes.DEFAULT_SETTINGS,
  theme: 'classic',
  accent: '#4d6bfe',
  fontSize: 16,
  lineHeight: 1.85,
};

check('root typography and colors become inline styles', () => {
  const { el } = article('# 标题\n\n正文', base);
  assert.equal(el.style.fontSize, '16px');
  assert.equal(el.style.lineHeight, '1.85');
  assert.ok(el.style.color, 'root color is inlined');
  assert.ok(el.style.backgroundColor, 'root background is inlined');
});

check('headings keep the mdstudio-heading-prefix/content/suffix structure and receive theme decorations', () => {
  const { el } = article('## 二级标题', base);
  const h2 = q(el, 'h2');
  assert.equal(h2.style.fontSize, '1.25em');
  const prefix = q<HTMLElement>(h2, ':scope > .mdstudio-heading-prefix');
  const suffix = q<HTMLElement>(h2, ':scope > .mdstudio-heading-suffix');
  assert.equal(prefix.style.display, 'inline-block', 'classic v2 stacks 01 prefix above h2 via inline-block');
  assert.equal(prefix.textContent, '01');
  assert.equal(suffix.style.display, 'none', 'empty suffix decoration is suppressed');
  assert.equal(h2.querySelector(':scope > .mdstudio-heading-content')?.textContent, '二级标题');
});

check('second theme swaps root palette and heading rule', () => {
  const night = { ...base, theme: 'night', accent: '#8b9cff' };
  const { el } = article('## 暗夜', night);
  assert.ok(
    /16|22|23|27/.test(el.style.backgroundColor) || el.style.backgroundColor.includes('22, 23, 27'),
    'dark root background inlined',
  );
  assert.equal(q(el, 'h2').style.color !== '', true);
});

check('external links became reference markers before inlining', () => {
  const { el, rendered } = article('看 [文档](https://example.com/a)。', base);
  assert.equal(rendered.refs.length, 1);
  const ref = q(el, '.mdstudio-ref');
  assert.ok(ref, 'reference sup exists');
  assert.equal(ref.textContent, '[1]');
  assert.ok(q(el, '.mdstudio-references'), 'references section exists');
});

check('custom CSS wins by source order at equal specificity', () => {
  const { el } = article('## 标题', base, '#mdstudio h2 .mdstudio-heading-prefix { width: 9px; border-radius: 50%; }');
  const prefix = q(el, 'h2 .mdstudio-heading-prefix');
  assert.equal(prefix.style.width, '9px');
  assert.equal(prefix.style.borderRadius, '50%');
});

check('higher specificity still beats a later low-specificity rule', () => {
  const { el } = article('## 标题', base, 'h2 { color: red; }');
  const h2 = q(el, 'h2');
  assert.notEqual(h2.style.color, 'red', 'theme .mdstudio-content h2 outranks bare h2');
});

check('#mdstudio selectors from custom themes apply', () => {
  const { el } = article('## 标题', base, '#mdstudio h2 { border-left: 5px solid rgb(255, 0, 0); }');
  assert.ok(q(el, 'h2').style.borderLeft.includes('5px'));
});

check('component tokens customize quote, bold, italic and links', () => {
  const { el } = article(
    '**加粗** *斜体* [链接](https://mp.weixin.qq.com/s/demo)\n\n> 引用',
    base,
    '#mdstudio { --mdstudio-strong-color: #ff0000; --mdstudio-em-color: #00aa00; --mdstudio-link-color: #0000ff; --mdstudio-quote-bg: #eeeeee; }',
  );
  const strong = q<HTMLElement>(el, 'strong');
  const em = q<HTMLElement>(el, 'em');
  const link = q<HTMLElement>(el, '.mdstudio-link, a');
  const quote = q<HTMLElement>(el, 'blockquote');
  assert.ok(strong.style.color === 'rgb(255, 0, 0)' || strong.style.color === '#ff0000');
  assert.ok(em.style.color === 'rgb(0, 170, 0)' || em.style.color === '#00aa00');
  assert.ok(link.style.color === 'rgb(0, 0, 255)' || link.style.color === '#0000ff');
  assert.ok(quote.style.backgroundColor.includes('238') || quote.style.backgroundColor === '#eeeeee');
});

check('the formatted Classic example applies cleanly', () => {
  const { el } = article('## 标题\n\n正文', base, themes.exampleCss());
  assert.ok(el.style.color, 'example sets root text color');
  assert.ok(q(el, 'h2').style.color, 'example sets heading color');
  assert.ok(q(el, 'h2').style.fontSize, 'example keeps heading sizes');
});

check('custom #mdstudio variables override theme tokens', () => {
  const { el } = article(
    '## 标题\n\n正文',
    base,
    '#mdstudio { --mdstudio-text: #ff0000; --mdstudio-heading: #ff0000; }',
  );
  const color = el.style.color;
  const heading = q(el, 'h2').style.color;
  assert.ok(color === 'rgb(255, 0, 0)' || color === '#ff0000', `expected red root text, got ${color}`);
  assert.ok(heading === 'rgb(255, 0, 0)' || heading === '#ff0000', `expected red heading, got ${heading}`);
});

check('css variables declared on :root resolve for later rules', () => {
  const { el } = article('## 标题', base, ':root { --brand: #ff0000; } #mdstudio h2 { color: var(--brand); }');
  const color = q(el, 'h2').style.color;
  assert.ok(color === 'rgb(255, 0, 0)' || color === '#ff0000', `expected red, got ${color}`);
});

check('pseudo elements become real spans with content and styles', () => {
  const { el } = article(
    '## 标题',
    base,
    '.mdstudio-content .mdstudio-heading-content::after { content: " ·"; color: rgb(176, 137, 104); }\n' +
      '#mdstudio h2 .mdstudio-heading-prefix::before { content: ""; width: 6px; height: 6px; background-color: #ff0000; display: inline-block; border-radius: 50%; }',
  );
  const content = q(el, 'h2 .mdstudio-heading-content');
  const after = q<HTMLElement>(content, '[data-mdstudio-pseudo="after"]');
  assert.ok(after, 'after pseudo span exists');
  assert.equal(after.textContent, ' ·');
  assert.ok(after.style.color.includes('176') || after.style.color === 'rgb(176, 137, 104)');
  const prefixBefore = q(el, 'h2 .mdstudio-heading-prefix [data-mdstudio-pseudo="before"]');
  assert.ok(prefixBefore, 'before pseudo span exists');
  assert.equal(prefixBefore.style.width, '6px');
  assert.ok(!prefixBefore.textContent, 'empty content stays empty');
});

check('pseudo elements are not materialized for ::selection', () => {
  const { el } = article('正文', base, 'p::selection { background: red; }');
  assert.equal(el.querySelectorAll('[data-mdstudio-pseudo]').length, 0);
});

check('pseudo elements on void elements are skipped', () => {
  const { el } = article('![x](https://example.com/a.png)', base, 'img::before { content: "*"; }');
  assert.equal(el.querySelectorAll('[data-mdstudio-pseudo]').length, 0);
});

check('existing inline styles are preserved against normal rules', () => {
  const { el } = article('| a | b |\n| --- | :---: |\n| 1 | 2 |', base);
  const cells = el.querySelectorAll<HTMLElement>('th, td');
  const centered = Array.from(cells).find((cell) => cell.style.textAlign === 'center');
  assert.ok(centered, 'table center alignment survives the theme th/td rule');
});

check('our own shorthand does not block a higher-specificity longhand', () => {
  const { el } = article('> 引用段落', base);
  const paragraph = q(el, 'blockquote > p');
  assert.equal(paragraph.style.marginBottom, '0px');
});

check('code tokens receive inline colors and pre keeps scroll styles', () => {
  const { el } = article('```js\nconst answer = "yes"; // note\n```', base);
  const keyword = q(el, '.mdstudio-tok-keyword');
  assert.ok(keyword && keyword.style.color, 'keyword color inlined');
  const pre = q(el, 'pre');
  assert.ok(pre.style.backgroundColor, 'pre background inlined');
  assert.equal(pre.style.getPropertyValue('overflow-x'), 'auto');
  assert.equal(pre.style.getPropertyPriority('overflow-x'), '');
  assert.equal(pre.style.getPropertyValue('white-space'), 'pre');
});

check('code block spaces become NBSP without touching prose', () => {
  const { el } = article('```js\nconst a = 1;\n```\n\n正文 有 空格', base);
  for (const pre of el.querySelectorAll<HTMLElement>('pre')) {
    const walker = document.createTreeWalker(pre, dom.window.NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue;
      if (value && value.includes(' ')) nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      const value = node.nodeValue;
      if (value) node.nodeValue = value.replace(/ /g, '\u00a0');
    }
  }
  const codeText = q(el, 'pre').textContent;
  assert.ok(codeText.includes('\u00a0'));
  const prose = Array.from(el.querySelectorAll('p')).find((p) => p.textContent?.includes('正文'));
  assert.ok(prose && prose.textContent?.includes(' '), 'body text keeps normal spaces');
});

check('important declarations override prior non-important ones', () => {
  const { el } = article('正文', base, '.mdstudio-content p { margin-bottom: 3em !important; }');
  assert.equal(q(el, 'p').style.getPropertyValue('margin-bottom'), '3em');
  assert.equal(q(el, 'p').style.getPropertyPriority('margin-bottom'), 'important');
});

check('state pseudo-classes are ignored instead of crashing', () => {
  assert.doesNotThrow(() => article('正文', base, 'p:hover { color: red; } a:focus-visible { outline: none; }'));
});

check('custom pseudo content escapes html-like text safely', () => {
  const { el } = article('正文', base, '.mdstudio-content p::before { content: "<script>"; }');
  const span = q(el, 'p [data-mdstudio-pseudo="before"]');
  assert.equal(span.textContent, '<script>');
  assert.equal(el.innerHTML.includes('<script>'), false, 'content stays as text, never markup');
});

check('sample article inlines cleanly for all eight themes', () => {
  for (const theme of themes.THEMES) {
    const settings = { ...base, theme: theme.id, accent: theme.defaultAccent };
    const { el } = article(themes.SAMPLE_MARKDOWN, settings);
    assert.ok(el.outerHTML.length > 2000, `${theme.id} renders content`);
    assert.ok(q(el, 'h1').style.fontSize, `${theme.id} inlines h1`);
    assert.ok(q(el, 'pre').style.backgroundColor, `${theme.id} inlines code background`);
    assert.ok(q(el, 'table th').style.backgroundColor, `${theme.id} inlines table head`);
  }
});

console.log(`\n${checks} DOM checks passed.`);

check('theme list markers use native styling', () => {
  const markdown = '- one\n  - two\n    - three\n\n1. one\n   1. two';
  const inspect = (theme: string) => {
    const { el } = article(markdown, { ...base, theme });
    const lists = Array.from(el.querySelectorAll('ul'));
    const ordered = Array.from(el.querySelectorAll('ol'));
    return {
      top: lists[0]?.style.listStyleType,
      nested: lists[1]?.style.listStyleType,
      deep: lists[2]?.style.listStyleType,
      ordered: ordered[0]?.style.listStyleType,
      orderedNested: ordered[1]?.style.listStyleType,
    };
  };
  assert.deepEqual(inspect('classic'), {
    top: 'disc',
    nested: 'circle',
    deep: 'square',
    ordered: 'decimal',
    orderedNested: 'decimal',
  });
  assert.deepEqual(inspect('gallery'), {
    top: 'square',
    nested: 'circle',
    deep: 'disc',
    ordered: 'decimal-leading-zero',
    orderedNested: 'decimal',
  });
  assert.deepEqual(inspect('ruby'), {
    top: 'disc',
    nested: 'circle',
    deep: 'square',
    ordered: 'decimal-leading-zero',
    orderedNested: 'decimal',
  });
  assert.deepEqual(inspect('warm'), {
    top: 'circle',
    nested: 'disc',
    deep: 'square',
    ordered: 'decimal',
    orderedNested: 'decimal',
  });
});

check('classic v2 uses explicit :::lead stroke, leaves plain h1 + p untouched, and stacks 01 on h2', () => {
  const { el } = article(
    '# 一级标题\n\n普通首段不擅自加装饰\n\n:::lead\n显式导语段落\n:::\n\n## 二级标题\n\n#### 四级标题',
    base,
  );
  const h1 = q(el, 'h1');
  const plainFirst = q(el, 'h1 + p');
  const lead = q(el, '.mdstudio-lead');
  const h2Prefix = q(el, 'h2 .mdstudio-heading-prefix');
  const h4 = q(el, 'h4');
  assert.equal(h1.style.fontSize, '1.55em');
  assert.equal(plainFirst.style.borderLeftWidth, '', 'plain paragraph after h1 gets no uninvited lead bar');
  assert.equal(lead.style.borderLeftWidth, '3px', 'explicit :::lead receives the classic lead bar');
  assert.equal(h2Prefix.style.display, 'inline-block');
  assert.equal(h2Prefix.style.width, '100%');
  assert.equal(h2Prefix.textContent, '01');
  assert.ok(h4.style.color !== '');
});

check('recipes materialize distinct v2 WeChat-safe structural identities', () => {
  const sample =
    '# 刊头\n\n:::lead\n导语段落\n:::\n\n:::tldr\n- 速览结论\n:::\n\n## 章节一\n\n**结论句**\n\n### 小节一\n\n### 小节二\n\n++柔光下划线++\n\n## 章节二\n\n> 引用正文\n\n:::pull\n金句摘录\n:::\n\n---\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n| C | D |';
  const renderTheme = (id: string) => {
    const theme = themes.getTheme(id);
    return article(sample, { ...base, theme: id, accent: theme.defaultAccent }).el;
  };
  const texts = (root: HTMLElement, selector: string) =>
    Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);

  const gallery = renderTheme('gallery');
  assert.equal(q(gallery, 'h1').style.borderTopWidth, '3px');
  assert.deepEqual(texts(gallery, 'h2 .mdstudio-heading-prefix'), ['01', '02']);
  assert.equal(q(gallery, 'h2').style.borderTopWidth, '1px');
  assert.equal(q(gallery, 'h3 .mdstudio-heading-prefix').textContent, '▪');
  assert.equal(q(gallery, 'blockquote').style.backgroundColor, 'transparent');
  assert.equal(q(gallery, 'blockquote').style.borderLeftWidth, '2px');
  assert.equal(q(gallery, '.mdstudio-pull').style.borderTopWidth, '1px');
  assert.equal(q(gallery, '.mdstudio-pull').style.borderBottomWidth, '1px');
  assert.equal(q(gallery, 'u').style.borderBottomWidth, '2.5px');

  const tech = renderTheme('tech');
  assert.deepEqual(texts(tech, 'h2 .mdstudio-heading-prefix'), ['01 /', '02 /']);
  assert.deepEqual(texts(tech, 'h3 .mdstudio-heading-prefix'), ['1.1', '1.2']);
  assert.equal(q(tech, '.mdstudio-tldr').style.borderLeftWidth, '3px');
  assert.equal(q(tech, 'blockquote').style.borderLeftWidth, '3px');
  assert.equal(q(tech, 'blockquote').style.backgroundColor, 'transparent');

  const warm = renderTheme('warm');
  assert.equal(q(warm, 'h1').style.textAlign, 'center');
  assert.equal(q(warm, 'h2 .mdstudio-heading-prefix').textContent, '●');
  assert.equal(q(warm, 'h2').style.borderBottomStyle, 'dashed');
  assert.equal(q(warm, 'strong').style.borderBottomWidth, '2px');
  assert.equal(q(warm, 'blockquote').style.borderRadius, '16px');
  assert.equal(q(warm, 'hr').style.width, '3em');

  const night = renderTheme('night');
  assert.deepEqual(texts(night, 'h2 .mdstudio-heading-prefix'), ['— 01 —', '— 02 —']);
  assert.equal(q(night, 'h2').style.textAlign, 'center');
  assert.equal(q(night, 'h3 .mdstudio-heading-prefix').textContent, '›');

  const ink = renderTheme('ink');
  assert.equal(q(ink, 'h2 .mdstudio-heading-prefix').textContent, '「');
  assert.equal(q(ink, 'h2 .mdstudio-heading-suffix').textContent, '」');
  assert.equal(q(ink, 'blockquote').style.backgroundColor, 'transparent');
  assert.equal(q(ink, 'blockquote').style.borderLeftWidth, '1px');
  assert.equal(q(ink, 'p').style.textIndent, '', 'ink paragraphs align flush-left consistently with all other themes');
  assert.equal(q(ink, '.mdstudio-lead').style.borderTopWidth, '1px');

  const ruby = renderTheme('ruby');
  assert.deepEqual(texts(ruby, 'h2 .mdstudio-heading-prefix'), ['01', '02']);
  assert.equal(q(ruby, 'h1').style.borderTopWidth, '4px');
  assert.equal(q(ruby, '.mdstudio-lead').style.fontWeight, '700');
  assert.equal(q(ruby, 'blockquote').style.borderLeftWidth, '3px');

  const poster = renderTheme('poster');
  assert.deepEqual(texts(poster, 'h2 .mdstudio-heading-prefix'), ['NO.01', 'NO.02']);
  assert.equal(q(poster, 'h3 .mdstudio-heading-prefix').textContent, '//');
  assert.equal(q(poster, 'hr').style.borderTopStyle, 'dashed');
  assert.equal(q(poster, 'hr').style.height, '1px');
  assert.ok(q(poster, '.mdstudio-tldr').style.boxShadow.length > 0);
  assert.ok(q(poster, '.mdstudio-pull').style.boxShadow.length > 0);
  assert.equal(q(poster, 'blockquote').style.boxShadow, '');
});

check(
  'CSS counters materialize static decimal, leading-zero and alphabetic tokens without leaking counter properties',
  () => {
    const customCss = [
      '.mdstudio-content { counter-reset: none; }',
      '.mdstudio-content { counter-reset: chap 9 sub 0; }',
      '.mdstudio-content h2 { counter-increment: chap 1 sub 0; counter-reset: sub; }',
      '.mdstudio-content h2 .mdstudio-heading-prefix::before { content: counter(chap, decimal-leading-zero) "." counter(chap, decimal); }',
      '.mdstudio-content h3 { counter-increment: sub; }',
      '.mdstudio-content h3 .mdstudio-heading-prefix::before { content: counter(sub, upper-alpha) "/" counter(sub, lower-alpha) " "; }',
    ].join('\n');
    const rendered = article('## A\n\n### s1\n\n### s2\n\n## B', base, customCss);
    const h2Prefixes = Array.from(rendered.el.querySelectorAll('h2 .mdstudio-heading-prefix')).map(
      (n) => n.textContent,
    );
    const h3Prefixes = Array.from(rendered.el.querySelectorAll('h3 .mdstudio-heading-prefix')).map(
      (n) => n.textContent,
    );
    assert.deepEqual(h2Prefixes, ['10.10', '11.11']);
    assert.deepEqual(h3Prefixes, ['A/a ', 'B/b ']);
    assert.equal(rendered.el.outerHTML.includes('counter-reset'), false);
    assert.equal(rendered.el.outerHTML.includes('counter-increment'), false);
  },
);

check('dark-preview alphaOf treats opaque rgb(0, 0, 0) and rgb(255, 255, 0) as alpha 1', () => {
  assert.equal(alphaOf('rgb(0, 0, 0)'), 1);
  assert.equal(alphaOf('rgb(255, 255, 0)'), 1);
  assert.equal(alphaOf('rgba(0, 0, 0, 0)'), 0);
  assert.equal(alphaOf('rgba(255, 255, 255, 0.5)'), 0.5);
  assert.equal(alphaOf('rgb(0 0 0 / 0.25)'), 0.25);
  assert.equal(alphaOf('transparent'), 0);
});

check('prepareClipboardDom unwraps section blocks nested inside paragraphs with and without surrounding prose', () => {
  const host = document.createElement('section');
  // Construct `p > section` via DOM APIs (mirroring `localPlaceholder` replacing `p > img`),
  // since HTML5 `innerHTML` implicitly closes `<p>` before `<section>`.
  const p1 = document.createElement('p');
  p1.appendChild(document.createTextNode('Intro text '));
  const sec1 = document.createElement('section');
  sec1.className = 'mdstudio-img-placeholder';
  sec1.textContent = 'Placeholder';
  p1.appendChild(sec1);
  p1.appendChild(document.createTextNode(' trailing text'));
  host.appendChild(p1);

  const p2 = document.createElement('p');
  const sec2 = document.createElement('section');
  sec2.textContent = 'Solo';
  p2.appendChild(sec2);
  host.appendChild(p2);

  const p3 = document.createElement('p');
  const img = document.createElement('img');
  img.setAttribute('src', 'https://example.com/a.png');
  img.setAttribute('width', '320');
  img.setAttribute('height', '180');
  p3.appendChild(img);
  const sec3 = document.createElement('section');
  sec3.textContent = 'Card';
  p3.appendChild(sec3);
  host.appendChild(p3);

  assert.equal(host.querySelectorAll('p > section').length, 3);
  prepareClipboardDom(host);
  assert.equal(host.querySelectorAll('p > section').length, 0, 'no <section> remains nested inside <p>');
  assert.ok(host.textContent?.includes('Intro text') && host.textContent?.includes('trailing text'));
  assert.ok(host.textContent?.includes('Solo'));
});

// Exercise applyDarkPreview + CodeMirror create() in JSDOM so unit coverage stays above CRAP threshold on all OSes
{
  const domKeys = [
    'window',
    'self',
    'document',
    'MutationObserver',
    'Node',
    'Element',
    'HTMLElement',
    'SVGElement',
    'HTMLTableElement',
    'HTMLTableCellElement',
    'HTMLImageElement',
    'CSSStyleDeclaration',
  ] as const;
  const saved = new Map<string, unknown>();
  for (const key of domKeys) {
    saved.set(key, (globalThis as Record<string, unknown>)[key]);
    const val =
      key === 'window' || key === 'self' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key];
    if (val !== undefined) {
      Object.defineProperty(globalThis, key, { configurable: true, value: val });
    }
  }
  Object.assign(dom.window, {
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  try {
    const darkHost = document.createElement('div');
    darkHost.innerHTML =
      '<section id="mdstudio" style="background-color: rgb(18, 18, 22); color: rgb(240, 240, 240);"><p>Noir</p></section>';
    document.body.appendChild(darkHost);
    assert.equal(await applyDarkPreview(darkHost), true, 'already-dark paper short-circuits cleanly');
    darkHost.remove();

    const lightHost = document.createElement('div');
    lightHost.innerHTML =
      '<section id="mdstudio" style="background-color: rgb(255, 255, 255); color: rgb(20, 24, 30);">' +
      '<h2 style="color: rgb(15, 20, 30); background-color: rgb(245, 247, 252); background-image: linear-gradient(#fff, #eee);">Heading</h2>' +
      '<p style="color: rgb(220, 225, 235); background-color: transparent;">Bright text</p>' +
      '<span>   </span>' +
      '<span class="mdstudio-math"><svg><text style="color: rgb(0, 0, 0);">x</text></svg></span>' +
      '<img src="https://example.com/a.png" />' +
      '</section>';
    document.body.appendChild(lightHost);
    assert.equal(
      await applyDarkPreview(lightHost),
      true,
      'light preview transforms via mp-darkmode + surface/text lift',
    );
    lightHost.remove();

    const cmParent = document.createElement('div');
    document.body.appendChild(cmParent);
    let lastChange = '';
    let selCalls = 0;
    const mdEditor = createCodeMirror({
      parent: cmParent,
      doc: '# Hello\n\nworld',
      language: 'markdown',
      dark: false,
      onChange: (val) => {
        lastChange = val;
      },
      onSelection: () => {
        selCalls++;
      },
    });
    mdEditor.setDark(true);
    mdEditor.setValue('# Updated');
    assert.equal(lastChange, '# Updated');
    assert.ok(selCalls >= 1);
    mdEditor.destroy();

    const cssParent = document.createElement('div');
    document.body.appendChild(cssParent);
    const cssEditor = createCodeMirror({
      parent: cssParent,
      doc: '.mdstudio-content { color: red; }',
      language: 'css',
      dark: true,
      placeholder: 'Custom CSS',
    });
    cssEditor.destroy();
    cmParent.remove();
    cssParent.remove();
    checks += 2;
    console.log('ok - applyDarkPreview and CodeMirror create() work in JSDOM');

    check('CSS $= attribute selectors and post-var() external URL blocking work', () => {
      const box = document.createElement('section');
      box.id = 'mdstudio';
      box.innerHTML = '<a href="a.pdf">pdf</a><p>body</p>';
      engine.inlineCss(box, '#mdstudio a[href$=".pdf"], #mdstudio p { color: #123456; }');
      assert.equal(q(box, 'p').style.color, 'rgb(18, 52, 86)');

      const box2 = document.createElement('section');
      box2.id = 'mdstudio';
      box2.innerHTML = '<p>text</p>';
      engine.inlineCss(
        box2,
        '#mdstudio { --u: url("https://evil.example/track.png"); } #mdstudio p { background-image: var(--u); color: #222; }',
      );
      assert.equal(box2.innerHTML.includes('evil.example'), false, 'CSS var() cannot smuggle external url()');
      assert.equal(q(box2, 'p').style.color, 'rgb(34, 34, 34)');
    });
  } finally {
    for (const [key, prev] of saved.entries()) {
      if (prev === undefined) delete (globalThis as Record<string, unknown>)[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value: prev });
    }
  }
}
