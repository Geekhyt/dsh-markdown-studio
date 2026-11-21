import assert from 'node:assert/strict';
import { stripExternalCssUrls } from '../src/domain/custom-css';
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
import { exampleCss } from '../src/themes';

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

console.log('42 custom-css and custom-themes checks passed.');
