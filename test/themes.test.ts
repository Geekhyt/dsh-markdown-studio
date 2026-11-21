import assert from 'node:assert/strict';
import {
  buildCss,
  DEFAULT_SETTINGS,
  exampleCss,
  getTheme,
  isBuiltinThemeId,
  isPaperTheme,
  mermaidThemeFor,
  SAMPLE_MARKDOWN,
  SAMPLE_MARKDOWN_EN,
  SAMPLE_TITLE_EN,
  sampleArticleFor,
  THEMES,
  themeCodePreview,
} from '../src/themes';

assert.equal(THEMES.length, 8, 'eight built-in themes');
assert.equal(isBuiltinThemeId('classic'), true, 'built-in theme id is recognized');
assert.equal(isBuiltinThemeId('custom:violet'), false, 'custom theme id is not built-in');
assert.equal(isBuiltinThemeId('does-not-exist'), false, 'unknown theme id is not built-in');
assert.ok(SAMPLE_MARKDOWN.includes('八套主题'), 'sample reflects the current theme count');
assert.equal(getTheme('ink').id, 'ink', 'theme lookup by id');
assert.equal(getTheme('does-not-exist').id, 'classic', 'unknown themes fall back to classic');

const paperIds = ['gallery', 'warm', 'night', 'ink'];
const flushIds = ['classic', 'tech', 'ruby', 'poster'];

for (const id of paperIds) {
  assert.equal(isPaperTheme(id), true, `${id} is a tinted/dark paper theme`);
  const css = buildCss({ ...DEFAULT_SETTINGS, theme: id, accent: getTheme(id).defaultAccent });
  assert.ok(css.includes('padding: 1.5em 1.15em'), `${id} gets a safe paper gutter`);
  assert.ok(
    css.includes('border-radius: var(--mdstudio-paper-radius)'),
    `${id} gets a theme-matched paper card radius`,
  );
}
for (const id of flushIds) {
  assert.equal(isPaperTheme(id), false, `${id} uses a flush full-width white canvas`);
  const css = buildCss({ ...DEFAULT_SETTINGS, theme: id, accent: getTheme(id).defaultAccent });
  assert.equal(css.includes('padding: 1.5em 1.15em'), false, `${id} omits paper card padding`);
}
for (const theme of THEMES) {
  const css = buildCss({ ...DEFAULT_SETTINGS, theme: theme.id, accent: theme.defaultAccent });
  assert.ok(css.includes('.mdstudio-content'), `${theme.id} emits content CSS`);
  assert.ok(css.includes('font-size: 16px'), `${theme.id} emits the configured font size`);
  assert.ok(css.length > 500, `${theme.id} produces substantial CSS`);

  const fallbackAccentCss = buildCss({ ...DEFAULT_SETTINGS, theme: theme.id, accent: '' });
  assert.ok(
    fallbackAccentCss.includes(`--mdstudio-accent: ${theme.defaultAccent};`),
    `${theme.id} falls back to its default accent`,
  );

  const customAccentCss = buildCss({ ...DEFAULT_SETTINGS, theme: theme.id, accent: '#126789' });
  assert.ok(customAccentCss.includes('--mdstudio-accent: #126789;'), `${theme.id} applies user accent`);
  assert.notEqual(customAccentCss, css, `${theme.id} responds dynamically to custom accent`);
}

const classicExample = exampleCss();
assert.ok(classicExample.includes('--mdstudio-bg: #ffffff'), 'example is the first theme source');
assert.ok(classicExample.includes('.mdstudio-content h2'), 'example includes complete theme rules');
assert.ok(classicExample.includes('/* ---- 主题变量 ---- */'), 'example has section comments');
assert.ok(classicExample.includes('  /* 色彩 */'), 'example has variable group comments');
assert.ok(classicExample.includes('/* 加粗 */'), 'example comments bold');
assert.ok(classicExample.includes('/* 引用块 */'), 'example comments blockquotes');
assert.ok(classicExample.includes('/* 斜体 */'), 'example comments italics');
assert.ok(classicExample.includes('\n\n'), 'example has readable spacing');
const custom = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:test',
  customThemes: [{ id: 'custom:test', name: 'Test', css: '#mdstudio h1 { letter-spacing: 0.2em; }' }],
});
assert.ok(custom.includes('#mdstudio h1 { letter-spacing: 0.2em; }'), 'custom CSS is appended');
const dracula = buildCss({ ...DEFAULT_SETTINGS, codeTheme: 'dracula' });
assert.ok(dracula.includes('background-color: #282a36'), 'code theme overrides the code surface');
assert.ok(dracula.includes('.mdstudio-tok-keyword'), 'code theme includes token colors');
assert.ok(
  !buildCss({ ...DEFAULT_SETTINGS, codeTheme: 'theme' }).includes('background-color: #282a36'),
  'follow-theme adds no code palette',
);
const externalCss = '#mdstudio { background-image: url(https://example.com/pixel.png); }';
const stripped = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:ext',
  customThemes: [{ id: 'custom:ext', name: 'Ext', css: externalCss }],
});
assert.ok(!stripped.includes('https://example.com/pixel.png'), 'external CSS URLs are stripped by default');
const allowed = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:ext',
  customThemes: [{ id: 'custom:ext', name: 'Ext', css: externalCss }],
  allowExternalCssResources: true,
});
assert.ok(allowed.includes('https://example.com/pixel.png'), 'external CSS URLs require explicit opt-in');

const namedCustomCss = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:violet',
  customThemes: [
    {
      id: 'custom:violet',
      name: '暮光紫',
      css: '#mdstudio { --mdstudio-bg: #1e1b4b; --mdstudio-accent: #8b5cf6; } .mdstudio-content h2 { letter-spacing: 0.14em; }',
    },
  ],
});
assert.ok(namedCustomCss.includes('letter-spacing: 0.14em'), 'active custom theme CSS is compiled into buildCss');
const customMermaid = mermaidThemeFor({
  ...DEFAULT_SETTINGS,
  theme: 'custom:violet',
  customThemes: [
    { id: 'custom:violet', name: '暮光紫', css: '#mdstudio { --mdstudio-bg: #1e1b4b; --mdstudio-accent: #8b5cf6; }' },
  ],
});
assert.equal(customMermaid.background, '#1e1b4b', 'Mermaid palette follows active custom theme background');
assert.ok(customMermaid.directive.includes('#8b5cf6'), 'Mermaid palette follows active custom theme accent');

const codeSurfaces = THEMES.map(
  (t) => themeCodePreview({ ...DEFAULT_SETTINGS, theme: t.id, accent: t.defaultAccent }).bg,
);
assert.equal(
  new Set(codeSurfaces).size,
  THEMES.length,
  'every built-in theme has its own distinct follow-theme code surface',
);
assert.notEqual(
  themeCodePreview({ ...DEFAULT_SETTINGS, theme: 'warm', accent: '#27694c' }).bg,
  themeCodePreview({ ...DEFAULT_SETTINGS, theme: 'warm', accent: '#c01b1b' }).bg,
  'follow-theme code surface adapts dynamically to custom accent',
);
assert.equal(
  themeCodePreview({
    ...DEFAULT_SETTINGS,
    theme: 'custom:violet',
    customThemes: [
      {
        id: 'custom:violet',
        name: '暮光紫',
        css: '#mdstudio { --mdstudio-code-bg: #221144; --mdstudio-code-text: #f0e8ff; --mdstudio-accent: #8b5cf6; }',
      },
    ],
  }).bg,
  '#221144',
  'follow-theme swatch preview reads --mdstudio-code-bg from active custom theme',
);
assert.equal(
  themeCodePreview({
    ...DEFAULT_SETTINGS,
    theme: 'custom:plain',
    customThemes: [
      { id: 'custom:plain', name: 'Plain', css: '#mdstudio { --mdstudio-bg: #faf5ff; --mdstudio-accent: #7c3aed; }' },
    ],
  }).bg,
  '#faf5ff',
  'follow-theme swatch preview falls back to custom theme paper bg',
);

assert.equal(sampleArticleFor('en').title, SAMPLE_TITLE_EN);
assert.equal(sampleArticleFor('en-US').markdown, SAMPLE_MARKDOWN_EN);
assert.ok(!/[\u4e00-\u9fff]/.test(SAMPLE_MARKDOWN_EN), 'English sample article contains zero Chinese characters');
const enExampleCss = exampleCss('en');
assert.ok(enExampleCss.includes('/* ---- Theme Variables ---- */'), 'English example CSS uses English section headers');
assert.ok(!/[\u4e00-\u9fff]/.test(enExampleCss), 'English example CSS contains zero Chinese characters');

const customWithDracula = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:violet',
  codeTheme: 'dracula',
  customThemes: [
    {
      id: 'custom:violet',
      name: '暮光紫',
      css: '#mdstudio pre { background-color: #221144; color: #f0e8ff; }',
    },
  ],
});
assert.ok(
  customWithDracula.lastIndexOf('#282a36') > customWithDracula.indexOf('#221144'),
  'explicit codeTheme overrides custom theme pre colors',
);

const standaloneWithoutPrefix = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:clean',
  customThemes: [
    {
      id: 'custom:clean',
      name: '纯净版',
      css: exampleCss().replace(/\.mdstudio-content h2 \.mdstudio-heading-prefix::before\s*\{[^}]*\}/, ''),
    },
  ],
});
assert.equal(
  standaloneWithoutPrefix.includes('mdstudio-heading-prefix::before'),
  false,
  'standalone custom theme deleting Classic heading prefix does not re-inherit it from THEMES[0]',
);
assert.ok(
  standaloneWithoutPrefix.includes(':where(.mdstudio-content > h1:first-child'),
  'first-child heading flush uses zero-specificity :where() so custom CSS wins',
);

// Partial custom CSS mentioning tag names in comments or white-space: pre still inherits base theme
const partialWithComment = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:partial',
  customThemes: [
    {
      id: 'custom:partial',
      name: '局部微调',
      css: '/* Override #mdstudio p, h1, h2, blockquote, pre */\n.mdstudio-content h2 { color: #b91c1c; }',
    },
  ],
});
assert.ok(
  partialWithComment.includes('--mdstudio-font-size'),
  'comment mentioning tag names does not misclassify partial custom CSS as standalone',
);

// Explicit @base pragma & relaxed structural standalone detection
const pragmaStandalone = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:minimal-warm',
  customThemes: [
    {
      id: 'custom:minimal-warm',
      name: '暖纸极简',
      css: '/* @base: standalone */\n#mdstudio { background: #fbf7ef; color: #2f2419; }\n#mdstudio h2 { color: #8c3b1b; }\n#mdstudio p { margin: 0 0 12px; }',
    },
  ],
});
assert.equal(
  pragmaStandalone.includes('mdstudio-heading-prefix::before'),
  false,
  '/* @base: standalone */ skips Classic base even without h1/pre/blockquote',
);

const pragmaClassic = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:force-classic',
  customThemes: [
    {
      id: 'custom:force-classic',
      name: '继承 Classic',
      css: '/* @base: classic */\n' + exampleCss(),
    },
  ],
});
assert.ok(
  pragmaClassic.includes('--mdstudio-font-size'),
  '/* @base: classic */ forces inheriting the built-in Classic base',
);

const structuralWithoutPre = buildCss({
  ...DEFAULT_SETTINGS,
  theme: 'custom:editorial',
  customThemes: [
    {
      id: 'custom:editorial',
      name: '极简专栏',
      css: '#mdstudio { background: #fffdf8; color: #222; } #mdstudio h1, #mdstudio h2 { color: #111; } #mdstudio p { line-height: 1.8; }',
    },
  ],
});
assert.equal(
  structuralWithoutPre.includes('--mdstudio-font-size'),
  false,
  'standalone custom theme with root+surface+text+prose+h1+h2 no longer requires pre/blockquote',
);

console.log('30 theme checks passed.');
