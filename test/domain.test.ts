import assert from 'node:assert/strict';
import { deriveTitle, markdownHeadings, markdownToPlain, parseView, slugify } from '../src/domain/article';
import {
  approximateDataBytes,
  assetFilenameFromSrc,
  assetFilesInMarkdown,
  collectLocalImages,
  portableizeAssetUrls,
  replaceLocalImages,
  resolveArticleImageSrc,
} from '../src/domain/images';
import { MAX_CUSTOM_CSS_CHARS } from '../src/domain/custom-themes';
import { clamp, parseThemePatch, sanitizeSettings } from '../src/domain/settings';
import { DEFAULT_SETTINGS, getTheme } from '../src/themes';

assert.equal(deriveTitle('---\ntitle: 标题\n---\n\n正文', '未命名'), '标题');
assert.equal(deriveTitle('# 一级标题\n\n正文', '未命名'), '一级标题');
assert.equal(deriveTitle('正文', '未命名'), '未命名');
assert.equal(parseView('edit'), 'edit');
assert.equal(parseView('preview'), 'preview');
assert.equal(parseView('unknown'), 'split');
assert.equal(slugify('Hello / World'), 'Hello-World');

const headings = markdownHeadings(
  '# A\ntext\n\n```\n# not heading\n```\n\n~~~sh\n# also not heading\n~~~\n\n```inline```\n\n## B # ',
);
assert.deepEqual(
  headings.map((heading) => [heading.level, heading.text]),
  [
    [1, 'A'],
    [2, 'B'],
  ],
);
assert.equal(markdownToPlain('# 标题\n\n~~~sh\necho 1\n~~~\n\n**正文** [链接](https://x.test)').includes('标题'), true);
assert.equal(markdownToPlain('# 标题\n\n~~~sh\necho 1\n~~~\n\n**正文**').includes('echo 1'), false);
assert.equal(markdownToPlain('# 标题\n\n**正文**').includes('#'), false);

const invalid = sanitizeSettings({ theme: 'missing', accent: 'red', fontSize: 100, lineHeight: 0.2 });
assert.equal(invalid.theme, 'classic');
assert.equal(invalid.accent, DEFAULT_SETTINGS.accent);
assert.equal(invalid.fontSize, 20);
assert.equal(invalid.lineHeight, 1.4);
assert.equal(sanitizeSettings({ codeTheme: 'dracula' }).codeTheme, 'dracula');
assert.equal(sanitizeSettings({ codeTheme: 'missing' }).codeTheme, 'theme');

const file = '0123456789abcdef01234567.png';
assert.equal(assetFilenameFromSrc(`assets/${file}`), file);
assert.equal(assetFilenameFromSrc(`http://127.0.0.1:4010/uploads/${file}`), file);
assert.equal(
  resolveArticleImageSrc(`assets/${file}`, 'http://127.0.0.1:4010'),
  `http://127.0.0.1:4010/uploads/${file}`,
);
assert.equal(portableizeAssetUrls(`http://127.0.0.1:4010/uploads/${file}`), `assets/${file}`);
const localImages = collectLocalImages(`![a](assets/${file})\n\n![b](data:image/png;base64,AA==)`);
assert.equal(localImages.size, 2);
assert.match(
  replaceLocalImages(`![a](data:image/png;base64,AA==)`, new Map([['data:image/png;base64,AA==', `assets/${file}`]])),
  new RegExp(file),
);
assert.deepEqual(assetFilesInMarkdown(`![a](assets/${file})`), [file]);
assert.equal(approximateDataBytes('data:image/png;base64,AAAA'), 3);

const themePatch = parseThemePatch({ settings: { theme: 'ink', codeTheme: 'dracula', fontSize: 99 } });
assert.equal(themePatch?.theme, 'ink');
assert.equal(themePatch?.codeTheme, 'dracula');
assert.equal(themePatch?.fontSize, 20);
assert.equal(parseThemePatch({ settings: { lineHeight: 9 } })?.lineHeight, 2.4);
assert.equal(parseThemePatch({ settings: { unknown: true } }), null);
assert.equal(parseThemePatch({ settings: { accent: 'red' } }), null);

console.log('24 domain checks passed.');

assert.equal(clamp(5, 10, 20), 10);
assert.equal(clamp(15, 10, 20), 15);
assert.equal(clamp(25, 10, 20), 20);
const defaults = sanitizeSettings(null);
assert.equal(defaults.theme, DEFAULT_SETTINGS.theme);
assert.equal(defaults.fontSize, DEFAULT_SETTINGS.fontSize);
assert.equal(sanitizeSettings([]).theme, DEFAULT_SETTINGS.theme);
assert.equal(sanitizeSettings('not-an-object').theme, DEFAULT_SETTINGS.theme);
assert.equal(sanitizeSettings({ accent: '#ABC123' }).accent, '#ABC123');
assert.equal(sanitizeSettings({ theme: 'ink', accent: 'bad' }).accent, getTheme('ink').defaultAccent);
assert.equal(sanitizeSettings({ fontSize: 13 }).fontSize, 14);
assert.equal(sanitizeSettings({ fontSize: 21 }).fontSize, 20);
assert.equal(sanitizeSettings({ fontSize: 0 }).fontSize, 16);
assert.equal(sanitizeSettings({ fontSize: '18' }).fontSize, 18);
assert.equal(sanitizeSettings({ lineHeight: 0 }).lineHeight, 1.75);
assert.equal(sanitizeSettings({ lineHeight: '2' }).lineHeight, 2);
assert.equal(
  sanitizeSettings({ allowExternalCssResources: true }).allowExternalCssResources,
  false,
  'persisted / imported settings can never enable remote CSS resources',
);
assert.equal(sanitizeSettings({ linkFootnotes: true, imagePlaceholders: false, codeNbsp: true }).linkFootnotes, true);
assert.equal(parseThemePatch(null), null);
assert.equal(parseThemePatch([]), null);
assert.equal(parseThemePatch({ settings: [] }), null);
const topLevelPatch = parseThemePatch({
  theme: 'ink',
  fontSize: 15,
  customThemes: [{ id: 'custom:long', name: 'Long', css: 'x'.repeat(MAX_CUSTOM_CSS_CHARS + 50) }],
});
assert.equal(topLevelPatch?.theme, 'ink');
assert.equal(topLevelPatch?.fontSize, 15);
assert.equal(topLevelPatch?.customThemes?.[0]?.css.length, MAX_CUSTOM_CSS_CHARS);
assert.equal(parseThemePatch({ settings: { fontSize: Infinity } }), null);
assert.equal(parseThemePatch({ settings: { lineHeight: '2' } }), null);
assert.equal(
  parseThemePatch({ settings: { allowExternalCssResources: true } }),
  null,
  'imported theme JSON cannot silently enable remote CSS resources',
);
assert.equal(
  parseThemePatch({ settings: { linkFootnotes: true, imagePlaceholders: false, codeNbsp: true } })?.codeNbsp,
  true,
);

const withCustom = sanitizeSettings({
  theme: 'custom:aurora',
  customThemes: [{ id: 'custom:aurora', name: '极光', css: '#mdstudio { --mdstudio-accent: #0d9488; }' }],
});
assert.equal(withCustom.theme, 'custom:aurora');
assert.equal(withCustom.accent, '#0d9488');
assert.equal(withCustom.customThemes?.length, 1);

const missingCustom = sanitizeSettings({
  theme: 'custom:deleted',
  customThemes: [{ id: 'custom:aurora', name: '极光', css: '#mdstudio { --mdstudio-accent: #0d9488; }' }],
});
assert.equal(missingCustom.theme, 'classic');

const customPatch = parseThemePatch({
  settings: {
    theme: 'custom:aurora',
    customThemes: [{ id: 'custom:aurora', name: '极光', css: '#mdstudio { --mdstudio-accent: #0d9488; }' }],
  },
});
assert.equal(customPatch?.theme, 'custom:aurora');
assert.equal(customPatch?.customThemes?.length, 1);
console.log('23 settings edge checks passed.');
