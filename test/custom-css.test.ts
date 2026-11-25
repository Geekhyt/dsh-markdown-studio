import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { inlineCss } from '../src/css-inliner';
import {
  hasCssUrlRef,
  hasExternalCssUrl,
  isRootThemeSelector,
  preprocessCssInput,
  stripExternalCssUrls,
} from '../src/domain/custom-css';
import {
  createCustomThemeId,
  extractCustomThemePreview,
  findCustomTheme,
  isCustomThemeId,
  mergeCustomThemes,
  nextCustomThemeName,
  normalizeHexColor,
  removeCustomTheme,
  sanitizeCustomThemes,
  upsertCustomTheme,
} from '../src/domain/custom-themes';
import { buildCss, DEFAULT_SETTINGS, exampleCss, formatCssSource } from '../src/themes';

assert.equal(
  stripExternalCssUrls('#mdstudio { background: url(https://example.com/a.png); }'),
  '#mdstudio { background: none; }',
);
assert.equal(
  stripExternalCssUrls('#mdstudio { background: url("http://example.com/a.png"); }'),
  '#mdstudio { background: none; }',
);
assert.equal(
  stripExternalCssUrls('#mdstudio { background: url(//example.com/a.png); }'),
  '#mdstudio { background: none; }',
);
assert.equal(
  stripExternalCssUrls('#mdstudio { background: url(assets/a.png); }'),
  '#mdstudio { background: url(assets/a.png); }',
);
assert.equal(
  stripExternalCssUrls('#mdstudio { background: url(data:image/png;base64,AAAA); }'),
  '#mdstudio { background: url(data:image/png;base64,AAAA); }',
);
assert.equal(
  stripExternalCssUrls(
    '@import "https://evil.example/track.css";\n#mdstudio { background: url("https://evil.example/a.png ); }',
  ),
  '\n#mdstudio { background: none; }',
);
for (const sneaky of [
  '#mdstudio { background-image: image-set("https://evil.example/a.png" 1x); }',
  '#mdstudio { background-image: -webkit-image-set(url(//evil.example/a.png) 1x); }',
  '#mdstudio { background: url(\\68ttps://evil.example/a.png); }',
  '#mdstudio { background: u\\72l(https://evil.example/a.png); }',
  '#mdstudio { background: url( /* x */ "\\2f\\2f evil.example/a.png"); }',
  '@\\69mport "https://evil.example/t.css"; #mdstudio { color: red; }',
]) {
  const cleaned = stripExternalCssUrls(sneaky);
  assert.equal(/evil\.example/.test(cleaned), false, `obfuscated network reference is stripped: ${sneaky}`);
}
assert.equal(
  stripExternalCssUrls('#mdstudio { color: #123456; background: url(data:image/png;base64,AAAA); }'),
  '#mdstudio { color: #123456; background: url(data:image/png;base64,AAAA); }',
  'ordinary declarations survive the obfuscation pass',
);

const generatedId = createCustomThemeId();
assert.equal(isCustomThemeId(generatedId), true);
assert.equal(isCustomThemeId('classic'), false);

assert.deepEqual(sanitizeCustomThemes(null), []);
const cleaned = sanitizeCustomThemes([
  null,
  [],
  { id: 'custom:one', name: '  极简白  ', css: '#mdstudio { --mdstudio-accent: #2563eb; }' },
  { id: 'custom:one', name: '重复 ID', css: '#mdstudio { color: red; }' },
  { id: 'raw id!', name: '', css: '#mdstudio { --mdstudio-bg: #111827; --mdstudio-accent: #f59e0b; }' },
  { id: 'custom:blank', name: '空样式', css: '   ' },
]);
assert.equal(cleaned.length, 2);
assert.equal(cleaned[0].id, 'custom:one');
assert.equal(cleaned[0].name, '极简白');
assert.equal(cleaned[1].id, 'custom:rawid');
assert.equal(cleaned[1].name, '自定义主题 5');

assert.equal(findCustomTheme(cleaned, 'custom:one')?.name, '极简白');
assert.equal(findCustomTheme(cleaned, 'custom:missing'), null);
assert.equal(findCustomTheme(undefined, 'custom:one'), null);

assert.equal(nextCustomThemeName([], '自定义主题'), '自定义主题 1');
assert.equal(nextCustomThemeName([{ id: 'custom:1', name: '自定义主题 1', css: 'a{}' }], '自定义主题'), '自定义主题 2');

const upserted = upsertCustomTheme(cleaned, { id: 'custom:one', name: '新名字', css: '#mdstudio { color: #111; }' });
assert.equal(upserted.length, 2);
assert.equal(upserted[0].name, '新名字');
const appended = upsertCustomTheme(upserted, { id: 'custom:three', name: '第三套', css: '#mdstudio { color: #222; }' });
assert.equal(appended.length, 3);
const removed = removeCustomTheme(appended, 'custom:rawid');
assert.equal(removed.length, 2);
const merged = mergeCustomThemes(removed, [
  { id: 'custom:three', name: '第三套更新', css: '#mdstudio { color: #333; }' },
  { id: 'custom:four', name: '第四套', css: '#mdstudio { color: #444; }' },
]);
assert.equal(merged.length, 3);
assert.equal(findCustomTheme(merged, 'custom:three')?.name, '第三套更新');

assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
assert.equal(normalizeHexColor('#123456'), '#123456');
assert.equal(normalizeHexColor('rgb(0,0,0)'), '');

const examplePreview = extractCustomThemePreview(exampleCss());
assert.equal(examplePreview.bg, '#ffffff');
assert.equal(examplePreview.accent, '#3d57e6');

const varlessPreview = extractCustomThemePreview('#mdstudio { background-color: #f4f3ef; color: #34322f; }', '#ae3a0b');
assert.equal(varlessPreview.bg, '#f4f3ef');
assert.equal(varlessPreview.fg, '#34322f');
assert.equal(varlessPreview.accent, '#ae3a0b');

const lightPreview = extractCustomThemePreview(
  '/* --mdstudio-accent: #000000 */ #mdstudio { --mdstudio-bg: #fff; --mdstudio-accent: #7c3aed; --mdstudio-heading: #1e1b4b; }',
);
assert.equal(lightPreview.bg, '#ffffff');
assert.equal(lightPreview.accent, '#7c3aed');
assert.equal(lightPreview.fg, '#1e1b4b');
assert.equal(lightPreview.border, undefined);

const darkPreview = extractCustomThemePreview('#mdstudio { --mdstudio-bg: #111827; --mdstudio-accent: #14b8a6; }');
assert.equal(darkPreview.bg, '#111827');
assert.equal(darkPreview.accent, '#14b8a6');
assert.equal(darkPreview.fg, '#f3f4f6');
assert.ok(darkPreview.border, 'dark custom preview includes subtle light border');

const commentSplitUrl = stripExternalCssUrls(
  '#mdstudio p { background: u/*x*/rl(https://evil.example/a.png); color: #111; }',
);
assert.equal(commentSplitUrl.includes('evil.example'), false, 'comment-split url() is stripped');

const lineContUrl = stripExternalCssUrls(
  '#mdstudio p { background: u\\\nrl(https://evil.example/b.png); color: #111; }',
);
assert.equal(lineContUrl.includes('evil.example'), false, 'newline-escaped url() is stripped');

const dataThenRemoteImageSet = stripExternalCssUrls(
  '#mdstudio p { background-image: image-set("data:image/png;base64,iVBORw0KGgo=" 1x, "https://attacker.example/beacon.png" 2x); color: #111; }',
);
assert.equal(
  dataThenRemoteImageSet.includes('attacker.example'),
  false,
  'image-set() with data:;base64 before remote URL is stripped',
);
assert.ok(dataThenRemoteImageSet.includes('color: #111'), 'sibling declarations survive image-set strip');

const inlineSvgDataUrl =
  '#mdstudio p { background-image: url("data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\"></svg>"); }';
assert.equal(
  stripExternalCssUrls(inlineSvgDataUrl),
  inlineSvgDataUrl,
  'unencoded inline SVG data: URL with XML namespace is preserved',
);

for (const hardened of [
  '#mdstudio p { background-image: src("https://attacker.example/a.png" type("image/png")); }',
  '#mdstudio p { background-image: u\\72l("https://attacker.example/track.png" anonymous); }',
  '#mdstudio p { background: url("\\68ttps://attacker.example/a\\"b"); }',
  '#mdstudio p { background: image-set("data:image/svg+xml,\\"" 1x, "https://attacker.example/beacon.png" 2x); }',
  '#mdstudio p { background: url("https://attacker.example/a)b"); color: #111; }',
  '@import url("https://attacker.example/a;b.css"); #mdstudio p { color: #222; }',
  '#mdstudio p { background: \\75 rl("https://attacker.example/hex-fn.png"); }',
  '#mdstudio p { background: url(\\68 ttps://attacker.example/unquoted-esc.png); }',
  '#mdstudio p { background: url(ht\ttps://attacker.example/c0-tab.png); }',
  '#mdstudio p { background: url(//attacker.example/proto-rel.png); }',
  '#mdstudio p { background: url(/\\\\attacker.example/backslash-rel.png); }',
  '#mdstudio p { background: cross-fade("https://attacker.example/cf.png", #fff); }',
  '<!-- @import "https://attacker.example/cdo.css"; --> #mdstudio p { color: #333; }',
  '#mdstudio p { background: url(https://attacker.example/a\\)b); color: #444; }',
]) {
  const out = stripExternalCssUrls(hardened);
  assert.equal(/attacker\.example/.test(out), false, `hardened CSS URL vector stripped: ${hardened}`);
}
assert.ok(
  stripExternalCssUrls('@import url("https://attacker.example/a;b.css"); #mdstudio p { color: #222; }').includes(
    'color: #222',
  ),
  'sibling rule survives quoted-semicolon @import removal',
);
assert.ok(
  stripExternalCssUrls('<!-- @import "https://attacker.example/cdo.css"; --> #mdstudio p { color: #333; }').includes(
    'color: #333',
  ),
  'sibling rule survives CDO @import removal',
);

// CSS Syntax Level 3 §4.3.7 newline/CRLF hex-escape url() bypasses & shorthand dark theme preview extraction
for (const newlineVec of [
  '#mdstudio p { background-image: \\75\nrl("https://attacker.example/lf.png"); color: #111; }',
  '#mdstudio p { background-image: \\75\r\nrl("https://attacker.example/crlf.png"); color: #111; }',
  '#mdstudio p { background-image: \\75\frl("https://attacker.example/ff.png"); color: #111; }',
]) {
  const out = stripExternalCssUrls(newlineVec);
  assert.equal(/attacker\.example/.test(out), false, `newline hex escape stripped: ${JSON.stringify(newlineVec)}`);
  assert.ok(out.includes('color: #111'), 'sibling declaration preserved after newline hex strip');
}
const shorthandDark = extractCustomThemePreview(':root { background: #1e1b4b no-repeat; color: #e2e8f0; }');
assert.equal(shorthandDark.bg, '#1e1b4b', 'extractCustomThemePreview supports :root + background shorthand');
assert.equal(shorthandDark.fg, '#e2e8f0');

// G3 regressions: quote-aware comment stripping, CSS var /* bypass, body p specificity,
// quoted var() preservation, prototype-key var(toString) safety, and @ inside declaration blocks.
assert.equal(
  hasExternalCssUrl(':root { --a: "/*"; --b: url("https://evil.example/track.png"); --c: "*/"; }'),
  true,
  'hasExternalCssUrl detects external url() hidden between quoted "/*" and "*/" custom properties',
);
assert.equal(
  stripExternalCssUrls(':root { --a: "/*"; --b: url("https://evil.example/track.png"); --c: "*/"; }').includes(
    'evil.example',
  ),
  false,
  'stripExternalCssUrls strips external url() even when wrapped between quoted "/*" and "*/" custom properties',
);
{
  const dom = new JSDOM(
    '<!doctype html><section id="mdstudio" class="mdstudio-content"><h1>Title</h1><section class="mdstudio-alert mdstudio-alert-warning"><p class="mdstudio-alert-title">WARNING</p><p>Body</p></section><p class="prose">Hello</p></section>',
  );
  const root = dom.window.document.getElementById('mdstudio')!;
  inlineCss(
    root,
    [
      '.mdstudio-content { background-color: #ffffff; }',
      '.mdstudio-content p { color: #3b4048; }',
      '.mdstudio-content .mdstudio-alert-warning .mdstudio-alert-title { color: #92400e; }',
      'body { background-color: #1e1b4b; }',
      'body p { color: #333333; }',
      ':root { --a: "/*"; --b: url("https://evil.example/track.png"); --c: "*/"; --txt: "REPLACED"; }',
      '#mdstudio { background-image: var(--b); color: var(toString, #111111); }',
      '#mdstudio h1::before { content: "/* "; }',
      '#mdstudio h1::after { content: " */"; }',
      '#mdstudio p.prose::before { content: "var(--txt) @import"; }',
    ].join('\n'),
    { allowExternalCssResources: false },
  );
  assert.equal(
    root.style.backgroundImage.includes('evil.example'),
    false,
    'var(/*) external URL bypass is stripped when allowExternalCssResources is false',
  );
  assert.equal(root.style.color, 'rgb(17, 17, 17)', 'var(toString, fallback) ignores Object.prototype properties');
  assert.equal(
    root.style.backgroundColor,
    'rgb(30, 27, 75)',
    'custom body rule matches .mdstudio-content specificity and overrides built-in root background by source order',
  );
  assert.equal(
    root.querySelector<HTMLElement>('p.prose')?.style.color,
    'rgb(51, 51, 51)',
    'custom body p rule matches .mdstudio-content p specificity and overrides prose paragraph color',
  );
  assert.equal(
    root.querySelector<HTMLElement>('.mdstudio-alert-title')?.style.color,
    'rgb(146, 64, 14)',
    'body p specificity does not inflate to #mdstudio p and override .mdstudio-content .mdstudio-alert-warning .mdstudio-alert-title',
  );
  const h1Text = root.querySelector('h1')?.textContent || '';
  assert.ok(
    h1Text.includes('/*') && h1Text.includes('*/'),
    'quoted /* and */ inside content: survive comment stripping',
  );
  const proseText = root.querySelector('p.prose')?.textContent || '';
  assert.ok(
    proseText.includes('var(--txt) @import'),
    'quoted var(--txt) and @import inside content: are preserved verbatim',
  );
}

// G1 regressions: CSS Syntax Level 3 §3.3 form-feed (\f) bypass, quote-aware formatCssSource,
// :is(:root) detection, and sanitizeCustomThemes explicit ID preservation.
{
  assert.equal(preprocessCssInput('a\r\nb\rc\fd\u0000e'), 'a\nb\nc\nd\ufffde', 'CSS §3.3 normalizes CR/FF/NUL');
  const ffSmuggle = 'p { content: "x\f; background: url(https://evil.example/a.png); }';
  assert.equal(hasExternalCssUrl(ffSmuggle), true, 'form-feed bad-string URL smuggling is detected');
  assert.equal(
    stripExternalCssUrls(ffSmuggle).includes('evil.example'),
    false,
    'stripExternalCssUrls strips \\f bad-string smuggled url()',
  );
  const ffCss = 'p { background: url("https://evil.example/a\f.png"); }';
  assert.equal(hasExternalCssUrl(ffCss), true, 'form-feed inside url() is detected as external URL');
  assert.equal(hasCssUrlRef('url("https://evil.example/a\f.png")'), true, 'hasCssUrlRef detects \\f inside url()');
  assert.equal(
    stripExternalCssUrls(ffCss).includes('evil.example'),
    false,
    'stripExternalCssUrls strips \\f-smuggled url()',
  );
  assert.equal(isRootThemeSelector(':is(:root)'), true, ':is(:root) is recognized as a root theme selector');
  assert.equal(isRootThemeSelector(':where(#mdstudio)'), true, ':where(#mdstudio) is recognized as a root selector');
  assert.equal(
    isRootThemeSelector(':is(#mdstudio, .mdstudio-content) :is(pre, code)'),
    false,
    'compound descendant :is() selector is NOT treated as a root theme selector',
  );

  const formatted = formatCssSource('p::after { content: "}"; color: #111; }');
  assert.ok(formatted.includes('content: "}"'), 'formatCssSource preserves quoted closing braces');
  const formattedAt = formatCssSource('@charset "utf-8";\n.mdstudio-content p { color: #111; }');
  assert.ok(
    formattedAt.includes('@charset "utf-8";') && formattedAt.includes('  color: #111;'),
    'formatCssSource preserves statement @-rules and still formats following rules',
  );

  const sanitized = sanitizeCustomThemes([
    { id: '!!!', name: 'Bad Id', css: 'p { color: #111; }' },
    { id: 'custom:theme-1', name: 'Explicit One', css: 'p { color: #222; }' },
  ]);
  assert.equal(sanitized.length, 2, 'earlier invalid ID does not shadow explicit custom:theme-1');
  assert.ok(sanitized.some((item) => item.id === 'custom:theme-1' && item.name === 'Explicit One'));

  // CSS Syntax L3 comment-token boundaries, escaped-quote @import desync, unclosed /* + codeTheme, and rgb/hsl preview
  assert.equal(
    hasExternalCssUrl('p { background: red/**/url(https://evil.example/a.png); }'),
    true,
    'hasExternalCssUrl detects url() separated from preceding token by /**/',
  );
  assert.equal(
    stripExternalCssUrls('p { background: red/**/url(https://evil.example/a.png); }').includes('evil.example'),
    false,
    'stripExternalCssUrls strips red/**/url(...) external URL',
  );
  assert.equal(
    stripExternalCssUrls('p { background: u/*x*/rl(https://evil.example/a.png); }').includes('evil.example'),
    false,
    'stripExternalCssUrls strips comment-split u/*x*/rl(...) external URL',
  );
  assert.equal(
    hasExternalCssUrl('p { content: "\\\\"; } @import url(https://evil.example/a.css);'),
    true,
    'hasExternalCssUrl detects @import after escaped-backslash closed string',
  );
  assert.equal(
    stripExternalCssUrls('p { content: "\\\\"; } @import url(https://evil.example/a.css);').includes('evil.example'),
    false,
    'stripExternalCssUrls strips @import after escaped-backslash closed string',
  );
  assert.equal(
    stripExternalCssUrls(':root { --u: u/*x*/rl(https://evil.example/v.png); } p { background: var(--u); }').includes(
      'evil.example',
    ),
    false,
    'stripExternalCssUrls blocks comment-smuggled var() external URLs',
  );
  const formattedComment = formatCssSource('/* } ; { */ p { color: #111; }');
  assert.equal(formattedComment.includes('} ; {'), false, 'formatCssSource strips comment delimiters safely');
  assert.ok(
    formattedComment.includes('p {\n  color: #111;\n}'),
    'formatCssSource keeps declarations after comment with braces',
  );
  const builtUnclosed = buildCss({
    ...DEFAULT_SETTINGS,
    theme: 'custom:unclosed',
    codeTheme: 'github-dark',
    allowExternalCssResources: true,
    customThemes: [{ id: 'custom:unclosed', name: 'Unclosed', css: '/* unclosed comment\np { color: red; }' }],
  });
  assert.ok(
    builtUnclosed.includes('#0d1117') && !builtUnclosed.includes('/* unclosed'),
    'unclosed custom CSS comment never swallows appended codeTheme CSS',
  );
  const rgbPreview = extractCustomThemePreview(
    'p { --mdstudio-accent: #111111; } :root { --mdstudio-bg: rgb(16, 24, 32); --mdstudio-accent: hsl(210, 90%, 50%); }',
  );
  assert.equal(rgbPreview.bg, '#101820', 'extractCustomThemePreview parses rgb() root background');
  assert.equal(rgbPreview.accent, '#0d7ff2', 'extractCustomThemePreview prioritizes root hsl() accent over descendant');
}

console.log('59 custom-css and custom-themes checks passed.');
