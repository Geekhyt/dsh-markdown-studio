import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderArticle } from '../src/adapters/render-article';
import { CODE_THEMES } from '../src/code-themes';
import { parseThemePatch, sanitizeSettings } from '../src/domain/settings';
import { inspectWechatHtml } from '../src/domain/wechat-html-lint';
import { contrast, ensureContrast, readableOn } from '../src/theme-system/color';
import {
  ATOM_LIBRARY,
  atomFor,
  type Recipe,
  recipePalette,
  SLOT_ORDER,
  type Slot,
  STRUCTURAL_SLOTS,
} from '../src/theme-system/compose';
import { paletteContrastIssues } from '../src/theme-system/palette';
import { RECIPES } from '../src/theme-system/recipes';
import { buildCss, DEFAULT_SETTINGS, mermaidCacheKey, mermaidThemeFor, THEMES } from '../src/themes';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: dom.window.NodeFilter });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log('ok -', name);
}

/* Accents that historically break themes: very light, neon, near-black. */
const STRESS_ACCENTS = ['#facc15', '#67e8f9', '#ff00ff', '#111827', '#22c55e', '#f97316'];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/!important/i, '!important'],
  [/font-family/i, 'font-family'],
  [/(?:^|[;"\s])opacity\s*:/i, 'opacity'],
  [/(?:height|font-size|line-height)\s*:\s*0(?:px|em|rem)?\s*(?:;|"|$)/i, 'zero visual box'],
  [
    /@media|@import|:hover|::before|::after|linear-gradient|radial-gradient|position\s*:\s*(?:fixed|sticky|absolute)|display\s*:\s*grid|float\s*:/i,
    'unsupported style',
  ],
];

const KITCHEN_SINK = [
  '# 标题',
  '',
  ':::lead',
  '开篇导语段落',
  ':::',
  '',
  '普通首段，**加粗**、==高亮==、++下划线++、`code`。',
  '',
  '## 章节一',
  '',
  '### 小节',
  '',
  '#### 四级',
  '',
  '> 第一段引用',
  '>',
  '> 第二段引用',
  '',
  '- 列表一',
  '- 列表二',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '- [x] 已完成事项',
  '- [ ] 待办事项',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '---',
  '',
  '> [!WARNING] 注意',
  '> 提示块正文',
  '',
  '![图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=)',
].join('\n');

/** Render the kitchen sink through the real theme pipeline with a recipe's atoms swapped in. */
function copyHtmlFor(recipe: Recipe, accent: string): string {
  const target = RECIPES.find((r) => r.id === recipe.id);
  assert.ok(target, `${recipe.id} is a registered recipe`);
  const saved = target.atoms;
  target.atoms = recipe.atoms;
  try {
    return renderArticle(
      KITCHEN_SINK,
      { ...DEFAULT_SETTINGS, theme: recipe.id, accent },
      {
        forCopy: true,
        forPreview: false,
        footnotesTitle: '脚注',
      },
    ).html;
  } finally {
    target.atoms = saved;
  }
}

function assertWechatSafe(html: string, label: string): void {
  assert.deepEqual(inspectWechatHtml(html), [], `${label} passes inspectWechatHtml`);
  for (const [pattern, name] of FORBIDDEN) assert.equal(pattern.test(html), false, `${label} avoids ${name}`);
  const parsed = new JSDOM(html).window.document;
  for (const el of parsed.querySelectorAll<HTMLElement>(
    'section, p, h1, h2, h3, h4, h5, h6, blockquote, pre, table, th, td, hr, span',
  )) {
    assert.equal(
      /^\d+(\.\d+)?px$/i.test(el.style.width),
      false,
      `${label} avoids px width on <${el.tagName.toLowerCase()}>`,
    );
  }
  for (const el of parsed.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, blockquote, li, th, td, pre, code, span',
  )) {
    assert.equal(el.style.height, '', `${label} avoids fixed height on <${el.tagName.toLowerCase()}>`);
  }
  for (const span of parsed.querySelectorAll<HTMLElement>('span')) {
    assert.notEqual(span.style.display, 'block', `${label} never sets display:block on <span>`);
  }
  const pre = parsed.querySelector('pre');
  assert.ok(
    (pre?.textContent || '').replace(/\u00a0/g, ' ').startsWith('const a = 1;'),
    `${label} keeps <pre> pure code`,
  );
}

check('colour helpers guarantee readable text', () => {
  assert.ok(contrast('#000000', '#ffffff') > 20);
  assert.ok(contrast(ensureContrast('#facc15', '#ffffff', 4.5), '#ffffff') >= 4.5);
  assert.ok(contrast(ensureContrast('#1e3a8a', '#15171c', 4.5), '#15171c') >= 4.5);
  assert.equal(readableOn('#c81e1e', '#14171c', '#ffffff'), '#ffffff');
  assert.equal(readableOn('#fde047', '#18181b', '#ffffff'), '#18181b');
});

check('every atom in the library composes into WeChat-safe copy HTML', () => {
  const base = RECIPES[0];
  let combos = 0;
  for (const slot of SLOT_ORDER) {
    for (const name of Object.keys(ATOM_LIBRARY[slot])) {
      for (const accent of [base.accent, '#facc15']) {
        const atoms = { ...base.atoms, [slot]: name } as Recipe['atoms'];
        // numbered sub-headings need a numbered h2 to read sensibly
        if (slot === 'h3' && name === 'numberedSub') atoms.h2 = 'docIndex';
        const recipe: Recipe = { ...base, atoms };
        assertWechatSafe(copyHtmlFor(recipe, accent), `${slot}.${name} @ ${accent}`);
        combos++;
      }
    }
  }
  assert.ok(combos > 120, `exercised ${combos} atom combinations`);
});

check('every recipe stays WeChat-safe and readable under stress accents', () => {
  for (const recipe of RECIPES) {
    for (const accent of [recipe.accent].concat(STRESS_ACCENTS)) {
      const palette = recipePalette(recipe, { accent, fontSize: 16, lineHeight: 1.8 });
      assert.deepEqual(paletteContrastIssues(palette), [], `${recipe.id} @ ${accent} keeps WCAG contrast`);
      assertWechatSafe(copyHtmlFor(recipe, accent), `${recipe.id} @ ${accent}`);
    }
  }
});

function toHex6(cssColor: string): string {
  if (/^#[0-9a-f]{6}$/i.test(cssColor)) return cssColor;
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(cssColor);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

check('every theme × codeTheme combination keeps pre code transparent and readable', () => {
  const sample = '```css\n.mdstudio-content {\n  --mdstudio-accent: #4d6bfe;\n}\n```';
  for (const theme of THEMES) {
    for (const codeTheme of CODE_THEMES) {
      const rendered = renderArticle(
        sample,
        { ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent, codeTheme: codeTheme.id },
        { forCopy: true, forPreview: false, footnotesTitle: '脚注' },
      );
      const doc = new JSDOM(rendered.html).window.document;
      const pre = doc.querySelector<HTMLElement>('pre')!;
      const preCode = doc.querySelector<HTMLElement>('pre code')!;
      assert.equal(
        preCode.style.backgroundColor,
        'transparent',
        `${theme.id} + ${codeTheme.id} resets pre code background to transparent`,
      );
      assert.ok(
        contrast(toHex6(preCode.style.color), toHex6(pre.style.backgroundColor)) >= 4.5,
        `${theme.id} + ${codeTheme.id} keeps >= 4.5:1 code text contrast`,
      );
    }
  }
});

check('recipes are distinct: one signature, limited structural overlap', () => {
  assert.deepEqual(
    RECIPES.map((r) => r.id),
    THEMES.map((t) => t.id),
  );
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  for (const recipe of RECIPES) {
    assert.ok(SLOT_ORDER.includes(recipe.signature), `${recipe.id} declares a signature slot`);
    for (const slot of SLOT_ORDER) {
      assert.ok(
        typeof atomFor(slot as Slot, String(recipe.atoms[slot])) === 'function',
        `${recipe.id}.${slot} references a real atom`,
      );
    }
  }
  for (let i = 0; i < RECIPES.length; i++) {
    for (let j = i + 1; j < RECIPES.length; j++) {
      const a = RECIPES[i];
      const b = RECIPES[j];
      const shared = STRUCTURAL_SLOTS.filter((slot) => a.atoms[slot] === b.atoms[slot]);
      assert.ok(shared.length <= 2, `${a.id} and ${b.id} share too many structural atoms: ${shared.join(', ')}`);
    }
  }
  const quotes = new Set(RECIPES.map((r) => r.atoms.quote));
  const dividers = new Set(RECIPES.map((r) => r.atoms.hr));
  const h2s = new Set(RECIPES.map((r) => r.atoms.h2));
  assert.ok(quotes.size >= 7, `quote styles are varied (${quotes.size})`);
  assert.ok(dividers.size >= 7, `divider styles are varied (${dividers.size})`);
  assert.equal(h2s.size, RECIPES.length, 'every theme has its own h2');
});

check('user accent flows through every theme', () => {
  for (const theme of THEMES) {
    const css = buildCss({ ...DEFAULT_SETTINGS, theme: theme.id, accent: '#126789' });
    assert.ok(css.includes('--mdstudio-accent: #126789;'), `${theme.id} applies the user accent`);
  }
});

check('inline styles follow the CSS cascade for shorthand and longhand', () => {
  const later = renderArticle(
    '> 引用',
    {
      ...DEFAULT_SETTINGS,
      theme: 'custom:later',
      customThemes: [
        {
          id: 'custom:later',
          name: 'Later',
          css: '.mdstudio-content blockquote { border-left: 9px solid #ff0000; }\n.mdstudio-content blockquote { border: 0; }',
        },
      ],
    },
    { forCopy: false, forPreview: true, footnotesTitle: '脚注' },
  );
  const laterQuote = new JSDOM(later.html).window.document.querySelector<HTMLElement>('blockquote');
  assert.equal(laterQuote?.style.borderLeftWidth, '0px', 'a later shorthand resets an earlier longhand');

  const specific = renderArticle(
    '> 引用',
    {
      ...DEFAULT_SETTINGS,
      theme: 'custom:specific',
      customThemes: [
        {
          id: 'custom:specific',
          name: 'Specific',
          css: '#mdstudio blockquote { border-left: 9px solid #ff0000; }\n.mdstudio-content blockquote { border: 0; }',
        },
      ],
    },
    { forCopy: false, forPreview: true, footnotesTitle: '脚注' },
  );
  const specificQuote = new JSDOM(specific.html).window.document.querySelector<HTMLElement>('blockquote');
  assert.equal(specificQuote?.style.borderLeftWidth, '9px', 'a more specific longhand survives a weaker shorthand');
});

check('Mermaid diagrams inherit the theme palette and are cached per theme', () => {
  const night = mermaidThemeFor({ ...DEFAULT_SETTINGS, theme: 'night', accent: '' });
  const classic = mermaidThemeFor({ ...DEFAULT_SETTINGS, theme: 'classic', accent: '' });
  const recoloured = mermaidThemeFor({ ...DEFAULT_SETTINGS, theme: 'classic', accent: '#c81e1e' });
  assert.equal(night.background, '#16171b', 'night diagrams render on the night paper');
  assert.match(night.directive, /^%%\{init: \{"theme":"base","themeVariables":\{/);
  assert.ok(classic.directive.includes('"primaryBorderColor":"#3d57e6"'), 'classic nodes use the classic accent');
  assert.ok(recoloured.directive.includes('"primaryBorderColor":"#c81e1e"'), 'a custom accent recolours diagrams');
  assert.notEqual(mermaidCacheKey('graph TD; A-->B', night), mermaidCacheKey('graph TD; A-->B', classic));
  assert.equal(
    mermaidThemeFor({ ...DEFAULT_SETTINGS, theme: 'missing' }).background,
    '#ffffff',
    'unknown themes fall back to classic',
  );
});

check('unknown theme ids fall back to classic while preserving valid user accents', () => {
  assert.deepEqual(
    {
      theme: sanitizeSettings({ theme: 'unknown-theme' }).theme,
      accent: sanitizeSettings({ theme: 'unknown-theme' }).accent,
    },
    { theme: 'classic', accent: '#3d57e6' },
  );
  assert.equal(
    sanitizeSettings({ theme: 'unknown-theme', accent: '#123456' }).accent,
    '#123456',
    'user-picked custom accents survive unknown theme fallback',
  );
  assert.equal(
    parseThemePatch({ settings: { theme: 'unknown-theme' } }),
    null,
    'imported theme files ignore unknown theme ids',
  );
  assert.equal(
    sanitizeSettings({ theme: 'tech', accent: '#123456' }).accent,
    '#123456',
    'user-picked accents are kept',
  );
});

check('every theme × accent × container keeps >= 4.5:1 contrast for inline strong, em, and links', () => {
  const sample = [
    ':::lead',
    'Lead with **bold**, *italic*, and [link](https://example.com)',
    ':::',
    '',
    ':::tldr',
    'Summary with **bold**, *italic*, and [link](https://example.com)',
    ':::',
    '',
    ':::pull',
    'Pull quote with **bold**, *italic*, and [link](https://example.com)',
    ':::',
    '',
    '> Blockquote with **bold**, *italic*, and [link](https://example.com)',
    '',
    '> [!NOTE]',
    '> Alert with **bold**, *italic*, and [link](https://example.com)',
    '',
    '| **Bold H** | *Italic H* | [Link H](https://example.com) |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |',
    '',
  ].join('\n');
  const containers = ['th', 'blockquote', '.mdstudio-pull', '.mdstudio-lead', '.mdstudio-tldr', '.mdstudio-alert'];
  const inlines = ['strong', 'em', 'a'];
  const resolveEffectiveBg = (el: HTMLElement, rootBg: string): string => {
    let cur: HTMLElement | null = el;
    while (cur) {
      const bg = cur.style.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return toHex6(bg);
      cur = cur.parentElement;
    }
    return rootBg;
  };
  const resolveEffectiveFg = (el: HTMLElement, rootFg: string): string => {
    let cur: HTMLElement | null = el;
    while (cur) {
      const fg = cur.style.color;
      if (fg && fg !== 'inherit') return toHex6(fg);
      cur = cur.parentElement;
    }
    return rootFg;
  };
  for (const theme of THEMES) {
    for (const accent of [theme.defaultAccent, ...STRESS_ACCENTS]) {
      const rendered = renderArticle(
        sample,
        { ...DEFAULT_SETTINGS, theme: theme.id, accent, linkFootnotes: false },
        { forCopy: true, forPreview: false, footnotesTitle: '脚注' },
      );
      const doc = new JSDOM(rendered.html).window.document;
      const rootEl = doc.querySelector<HTMLElement>('#mdstudio')!;
      const rootBg = toHex6(rootEl.style.backgroundColor || '#ffffff');
      const rootFg = toHex6(rootEl.style.color || '#111111');
      for (const containerSel of containers) {
        for (const containerEl of Array.from(doc.querySelectorAll<HTMLElement>(containerSel))) {
          for (const inlineSel of inlines) {
            for (const inlineEl of Array.from(containerEl.querySelectorAll<HTMLElement>(inlineSel))) {
              const fg = resolveEffectiveFg(inlineEl, rootFg);
              const bg = resolveEffectiveBg(inlineEl, rootBg);
              const ratio = contrast(fg, bg);
              assert.ok(
                ratio >= 4.5,
                `${theme.id} @ ${accent} ${containerSel} ${inlineSel} contrast ${ratio.toFixed(2)}:1 (${fg} on ${bg}) < 4.5:1`,
              );
            }
          }
        }
      }
    }
  }
});

console.log(`\n${checks} theme-system checks passed.`);

const { derivePalette } = await import('../src/theme-system/palette');
const fallbackPalette = derivePalette({ paper: '#ffffff', ink: '#111111' }, '#123456', 16, 1.8);
assert.equal(fallbackPalette.radius, '8px');
assert.equal(fallbackPalette.accent2, '#123456');
assert.ok(fallbackPalette.text);
