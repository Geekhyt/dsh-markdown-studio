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
import {
  computeCaretPopoverPos,
  computeSafePopoverPos,
  computeUnobstructedWidth,
  type SurfaceRect,
} from '../src/domain/surface-geometry';
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
const extracted = assetFilesInMarkdown(
  [
    '![a](assets/0123456789abcdef01234567.png "my title")',
    '![b](./assets/1123456789abcdef01234567.jpg?v=1)',
    '<img src="http://127.0.0.1:4010/uploads/2123456789abcdef01234567.png" />',
    '![c](/api/markdown-studio/assets/3123456789abcdef01234567.JPG)',
  ].join('\n'),
);
assert.deepEqual(
  extracted.sort(),
  [
    '0123456789abcdef01234567.png',
    '1123456789abcdef01234567.jpg',
    '2123456789abcdef01234567.png',
    '3123456789abcdef01234567.jpg',
  ],
  'assetFilesInMarkdown detects titled Markdown, ./assets, HTML img, and host URLs',
);
const refAndBracketAssets = assetFilesInMarkdown(
  [
    '![Arch][a]',
    '![fig [1]](assets/4123456789abcdef01234567.png)',
    '![cdn](https://cdn.example.com/assets/5123456789abcdef01234567.png)',
    '',
    '[a]: assets/6123456789abcdef01234567.png',
  ].join('\n'),
);
assert.deepEqual(
  refAndBracketAssets.sort(),
  ['4123456789abcdef01234567.png', '6123456789abcdef01234567.png'],
  'assetFilesInMarkdown collects reference-style and nested-bracket assets while ignoring external CDN URLs',
);
assert.equal(
  portableizeAssetUrls('http://127.0.0.1:3000/api/markdown-studio/assets/0123456789abcdef01234567.png'),
  'assets/0123456789abcdef01234567.png',
  'portableizeAssetUrls strips leading loopback origin on /api/markdown-studio/assets/',
);
const plainSample = markdownToPlain(
  '---\ntitle: Demo\n# yaml comment\n---\n\n:::lead\n==重点++与++高亮==\n:::\n\n> [!NOTE]\n> 正文',
);
assert.equal(plainSample.includes('title: Demo'), false, 'markdownToPlain strips YAML frontmatter');
assert.equal(plainSample.includes(':::lead'), false, 'markdownToPlain strips editorial directives');
assert.equal(plainSample.includes('[!NOTE]'), false, 'markdownToPlain strips GitHub alert markers');
assert.equal(plainSample.includes('=='), false, 'markdownToPlain strips inline highlight syntax');
assert.equal(
  markdownHeadings('---\n# yaml comment\n---\n\n# Real Heading')
    .map((h) => h.text)
    .join(','),
  'Real Heading',
  'markdownHeadings skips YAML frontmatter comments',
);

// Unified surface-geometry placement solver (overlay drawer + immersive dock avoidance)
const editorSurface: SurfaceRect = { left: 0, top: 84, right: 840, bottom: 720, width: 840, height: 636 };
const overlayDrawer: SurfaceRect = { left: 504, top: 44, right: 840, bottom: 720, width: 336, height: 676 };
const dockedDrawer: SurfaceRect = { left: 840, top: 44, right: 1176, bottom: 720, width: 336, height: 676 };
const immersiveDock: SurfaceRect = { left: 704, top: 96, right: 824, bottom: 134, width: 120, height: 38 };

assert.equal(computeUnobstructedWidth(editorSurface), 840, 'no obstacles leaves full surface width');
assert.equal(
  computeUnobstructedWidth(editorSurface, [overlayDrawer]),
  504,
  'full-height right overlay drawer subtracts occluded width',
);
assert.equal(
  computeUnobstructedWidth(editorSurface, [dockedDrawer]),
  840,
  'docked drawer outside surface right edge does not shrink unobstructed width',
);
assert.equal(
  computeUnobstructedWidth(editorSurface, [immersiveDock]),
  840,
  'compact corner dock does not collapse full-surface width',
);

const outlineUnderDrawer = computeSafePopoverPos({
  surface: editorSurface,
  width: 280,
  height: 160,
  preferredLeft: 306,
  preferredTop: 6,
  pad: 10,
  obstacles: [overlayDrawer],
});
assert.equal(outlineUnderDrawer.left, 214, 'Outline shifts left to stay clear of overlay SettingsDrawer');
assert.equal(outlineUnderDrawer.availWidth, 504);

const pillVsDock = computeSafePopoverPos({
  surface: editorSurface,
  width: 92,
  height: 32,
  preferredLeft: 732,
  preferredTop: 20,
  pad: 10,
  obstacles: [immersiveDock],
});
assert.equal(pillVsDock.top, 56, 'SelectionBubble shifts below colliding top-right ImmersiveDock');

const pillClearOfDock = computeSafePopoverPos({
  surface: editorSurface,
  width: 92,
  height: 32,
  preferredLeft: 120,
  preferredTop: 20,
  obstacles: [immersiveDock],
});
assert.equal(pillClearOfDock.top, 20, 'non-colliding popover keeps preferred top');

const tinySurface: SurfaceRect = { left: 0, top: 0, right: 260, bottom: 80, width: 260, height: 80 };
const bottomDock: SurfaceRect = { left: 140, top: 30, right: 250, bottom: 70, width: 110, height: 40 };
const shiftedLeft = computeSafePopoverPos({
  surface: tinySurface,
  width: 90,
  height: 32,
  preferredLeft: 150,
  preferredTop: 32,
  pad: 10,
  obstacles: [bottomDock],
});
assert.equal(
  shiftedLeft.left,
  42,
  'falls back to horizontal shift when shifting below obstacle would overflow surface',
);

const impossibleObstacle: SurfaceRect = { left: 0, top: 0, right: 260, bottom: 80, width: 260, height: 40 };
const stuckFallback = computeSafePopoverPos({
  surface: tinySurface,
  width: 240,
  height: 32,
  preferredLeft: 10,
  preferredTop: 10,
  pad: 10,
  obstacles: [impossibleObstacle],
});
assert.equal(stuckFallback.left, 10, 'returns clamped coordinates cleanly when no shift fits');

// Caret-anchored popover (SlashMenu) must stay clear of the caret line & bound maxHeight in short viewports
const shortSurface: SurfaceRect = { left: 0, top: 0, right: 600, bottom: 440, width: 600, height: 440 };
const midSlashAbove = computeCaretPopoverPos({
  surface: shortSurface,
  caretTop: 280,
  caretBottom: 298,
  caretLeft: 24,
  width: 320,
  maxMenuHeight: 348,
  gap: 6,
  pad: 10,
  obstacles: [],
});
assert.equal(midSlashAbove.top, undefined, 'mid-page short viewport anchors SlashMenu from bottom above caret');
assert.equal(midSlashAbove.bottom, 440 - (280 - 6), 'bottom anchor leaves exact gap above caretTop');
assert.ok(
  midSlashAbove.maxHeight <= 280 - 6 - 10,
  `maxHeight (${midSlashAbove.maxHeight}) bounds height above caret so menu never overlaps caret line`,
);

const topSlashBelow = computeCaretPopoverPos({
  surface: shortSurface,
  caretTop: 40,
  caretBottom: 58,
  caretLeft: 24,
  width: 320,
  maxMenuHeight: 348,
  gap: 6,
  pad: 10,
  obstacles: [],
});
assert.equal(topSlashBelow.bottom, undefined, 'upper-viewport caret opens SlashMenu below caret');
assert.equal(topSlashBelow.top, 64, 'top anchor sits gap below caretBottom');
assert.equal(topSlashBelow.maxHeight, 348, 'abundant space below preserves full 348px ceiling');

const dockObstacle: SurfaceRect = { left: 420, top: 12, right: 590, bottom: 52, width: 170, height: 40 };
const nearDockBelow = computeCaretPopoverPos({
  surface: shortSurface,
  caretTop: 18,
  caretBottom: 34,
  caretLeft: 380,
  width: 200,
  maxMenuHeight: 348,
  gap: 6,
  pad: 10,
  obstacles: [dockObstacle],
});
assert.ok((nearDockBelow.top ?? 0) >= 58, 'below-caret SlashMenu shifts beneath overlapping top-right dock');

// G3 regression: unbalanced ![ before a valid image must NOT blind assetFilesInMarkdown / collectLocalImages
{
  const brokenThenReal = 'Draft note ![unclosed alt text\n\n![cover](assets/0123456789abcdef01234567.png)';
  assert.deepEqual(
    assetFilesInMarkdown(brokenThenReal),
    ['0123456789abcdef01234567.png'],
    'unbalanced ![ does not hide later assets/ images from AssetGC',
  );
  assert.equal(collectLocalImages(brokenThenReal).size, 1, 'collectLocalImages keeps later images after unbalanced ![');
}

// G6 regression: above-caret popover pushed down by a top obstacle must clamp maxHeight so it never covers the caret line
{
  const aboveWithTopDock = computeCaretPopoverPos({
    surface: { left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 },
    caretTop: 320,
    caretBottom: 340,
    caretLeft: 620,
    width: 240,
    maxMenuHeight: 320,
    obstacles: [{ left: 600, top: 10, right: 790, bottom: 50, width: 190, height: 40 }],
  });
  assert.ok(
    (aboveWithTopDock.top ?? 0) + aboveWithTopDock.maxHeight <= 320,
    'above-caret popover pushed down by top dock clamps height to stay strictly above caretTop',
  );

  // Short-viewport SlashMenu clamping (surface.height = 106px, neither above nor below >= 72px)
  const shortSlash = computeCaretPopoverPos({
    surface: { left: 0, top: 133, right: 960, bottom: 239, width: 960, height: 106 },
    caretTop: 205,
    caretBottom: 225,
    caretLeft: 40,
    width: 240,
    maxMenuHeight: 320,
  });
  assert.ok(
    (shortSlash.top ?? 0) >= 10 && (shortSlash.top ?? 0) + shortSlash.maxHeight <= 96,
    'short-viewport SlashMenu stays strictly inside surface vertical bounds',
  );

  // G4: fenced code & inline code spans are ignored during image asset discovery & replacement
  const fencedImgs =
    '```md\n![code](assets/aaaaaaaaaaaaaaaaaaaaaaaa.png)\n```\n`![inline](assets/cccccccccccccccccccccccc.png)`\n![live](assets/bbbbbbbbbbbbbbbbbbbbbbbb.png)';
  assert.deepEqual(assetFilesInMarkdown(fencedImgs), ['bbbbbbbbbbbbbbbbbbbbbbbb.png']);
  const replacedFenced = replaceLocalImages(
    fencedImgs,
    new Map([
      ['assets/aaaaaaaaaaaaaaaaaaaaaaaa.png', 'assets/111111111111111111111111.png'],
      ['assets/bbbbbbbbbbbbbbbbbbbbbbbb.png', 'assets/222222222222222222222222.png'],
    ]),
  );
  assert.ok(
    replacedFenced.includes('assets/aaaaaaaaaaaaaaaaaaaaaaaa.png') &&
      replacedFenced.includes('assets/222222222222222222222222.png'),
    'replaceLocalImages leaves fenced code examples intact while rewriting live images',
  );

  // YAML block scalar frontmatter title & callout [!NOTE] plain-text strip
  assert.equal(
    deriveTitle('---\ntitle: |\n  Block Scalar Title\n\n  Line Two\n\nauthor: Me\n---\nBody', 'Untitled'),
    'Block Scalar Title\n\nLine Two',
  );
  assert.equal(deriveTitle('---\ntitle: >\n  Folded\n  Title\n---\nBody', 'Untitled'), 'Folded Title');
  assert.equal(
    markdownToPlain('> [!NOTE] Custom Title\n> Body line').includes('[!NOTE]'),
    false,
    'markdownToPlain strips GFM callout marker syntax',
  );
}

console.log('47 settings, asset & surface-geometry edge checks passed.');
