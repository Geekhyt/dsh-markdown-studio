/*
 * L0 — design tokens.
 *
 * A Tone (paper, ink, accent, optional second accent) is expanded into the
 * full Palette. Every palette field is emitted as a `--mdstudio-*` variable so
 * Custom CSS can keep overriding single tokens.
 */
import { contrast, ensureContrast, isDark, mix, readableOn, rgba } from './color';

export var SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
export var SERIF = 'Georgia, "Songti SC", "Noto Serif SC", "Source Han Serif SC", "Times New Roman", serif';
export var MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

export interface TokenColors {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  tag: string;
  attr: string;
  literal: string;
}

export interface Palette {
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentFaint: string;
  onAccent: string;
  accent2: string;
  onAccent2: string;
  band: string;
  point: string;
  ink: string;
  onInk: string;
  fontSize: string;
  lineHeight: string;
  fontStack: string;
  headingFont: string;
  text: string;
  muted: string;
  heading: string;
  bg: string;
  soft: string;
  tldrBg: string;
  alertBg: string;
  paperRadius: string;
  border: string;
  borderStrong: string;
  taskBorder: string;
  tableHead: string;
  codeBg: string;
  codeText: string;
  inlineBg: string;
  inlineText: string;
  radius: string;
  justify: string;
  quoteText: string;
  tableZebra: string;
  codeBorder: string;
  inlineBorder: string;
  markBg: string;
  markText: string;
  markBorder: string;
  strongColor: string;
  emColor: string;
  emStyle: string;
  delColor: string;
  linkColor: string;
  linkUnderline: string;
  quoteBg: string;
  quoteBorder: string;
  quoteRadius: string;
  quotePadding: string;
  hrColor: string;
  hrWidth: string;
  orderedBg: string;
  tableBorder: string;
  imageRadius: string;
  imageBorder: string;
  uColor: string;
  uWidth: string;
  uWeight: string;
  paragraphSpacing: string;
  letterSpacing: string;
  tokens: TokenColors;
}

/** Recipe-level colour intent. Everything else is derived. */
export interface Tone {
  paper: string;
  ink: string;
  text?: string;
  /** Second "point" colour (highlights, ticket cards, marker bands). */
  accent2?: string;
  font?: 'sans' | 'serif';
  code?: 'light' | 'dark';
  radius?: string;
  tokens?: Partial<TokenColors>;
  /** Last-mile adjustments for values that are genuinely theme specific. */
  adjust?: (p: Palette) => void;
}

var LIGHT_TOKENS: TokenColors = {
  keyword: '#cf222e',
  string: '#0a3069',
  comment: '#6e7781',
  number: '#0550ae',
  function: '#8250df',
  tag: '#116329',
  attr: '#0550ae',
  literal: '#0550ae',
};

var DARK_TOKENS: TokenColors = {
  keyword: '#7dd3fc',
  string: '#a5f3b4',
  comment: '#8b95a7',
  number: '#fbbf24',
  function: '#c4b5fd',
  tag: '#f472b6',
  attr: '#7dd3fc',
  literal: '#fbbf24',
};

var DARK_CODE = { bg: '#16181d', text: '#e6e8ee', border: '#2a2e37' };

function pickToneWeights(dark: boolean) {
  return dark
    ? {
        accentSoft: 0.8,
        soft: 0.9,
        inlineBg: 0.82,
        faint: 0.9,
        band: 0.62,
        task: 0.52,
        head: 0.86,
        zebra: 0.94,
        inlineBorder: 0.7,
        mark: 0.75,
        codePaper: 0.9,
      }
    : {
        accentSoft: 0.88,
        soft: 0.955,
        inlineBg: 0.9,
        faint: 0.95,
        band: 0.72,
        task: 0.58,
        head: 0.92,
        zebra: 0.975,
        inlineBorder: 0.8,
        mark: 0.8,
        codePaper: 0.96,
      };
}

export function derivePalette(tone: Tone, accent: string, fontSize: number, lineHeight: number): Palette {
  var paper = tone.paper;
  var ink = tone.ink;
  var dark = isDark(paper);
  var w = pickToneWeights(dark);
  var radius = tone.radius || '8px';
  var accent2 = tone.accent2 || accent;
  var text = tone.text || mix(ink, paper, 0.16);
  var font = tone.font === 'serif' ? SERIF : SANS;
  var accentSoft = mix(accent, paper, w.accentSoft);
  var soft = mix(accent, paper, w.soft);
  var inlineBg = mix(accent, paper, w.inlineBg);
  var markBg = mix(accent2, paper, w.mark);
  // Accent text must stay readable on the strongest tint it is placed on.
  var accentText = ensureContrast(accent, accentSoft, 4.5);
  var border = mix(mix(ink, paper, 0.88), accent, 0.06);
  var borderStrong = mix(mix(ink, paper, 0.76), accent, 0.1);
  var codeDark = tone.code === 'dark';
  var fgContrastBase = dark ? '#111111' : ink;
  var p: Palette = {
    accent: accent,
    accentDeep: accentText,
    accentSoft: accentSoft,
    accentFaint: mix(accent, paper, w.faint),
    onAccent: readableOn(accent, fgContrastBase, '#ffffff'),
    accent2: accent2,
    onAccent2: readableOn(accent2, fgContrastBase, '#ffffff'),
    band: mix(accent2, paper, w.band),
    point: accent2,
    ink: ink,
    onInk: readableOn(ink, '#111111', '#ffffff'),
    fontSize: fontSize + 'px',
    lineHeight: String(lineHeight),
    fontStack: font,
    headingFont: font,
    text: text,
    muted: ensureContrast(mix(ink, paper, 0.42), soft, 4.5),
    heading: ink,
    bg: paper,
    soft: soft,
    tldrBg: accentSoft,
    alertBg: soft,
    paperRadius: '12px',
    border: border,
    borderStrong: borderStrong,
    taskBorder: mix(mix(ink, paper, w.task), accent, 0.08),
    tableHead: mix(accent, paper, w.head),
    codeBg: codeDark ? DARK_CODE.bg : mix(ink, paper, w.codePaper),
    codeText: codeDark ? DARK_CODE.text : ink,
    inlineBg: inlineBg,
    inlineText: ensureContrast(accent, inlineBg, 5.2),
    radius: radius,
    justify: 'justify',
    quoteText: text,
    tableZebra: mix(accent, paper, w.zebra),
    codeBorder: codeDark ? DARK_CODE.border : border,
    inlineBorder: mix(accent, paper, w.inlineBorder),
    markBg: markBg,
    markText: ensureContrast(ink, markBg, 4.5),
    markBorder: accent2,
    strongColor: ink,
    emColor: text,
    emStyle: 'italic',
    delColor: ensureContrast(ensureContrast(mix(ink, paper, 0.45), paper, 4.5), accentSoft, 4.5),
    linkColor: accentText,
    linkUnderline: mix(accent, paper, 0.72),
    quoteBg: soft,
    quoteBorder: accent,
    quoteRadius: '12px',
    quotePadding: '0.8em 1.05em',
    hrColor: border,
    hrWidth: '1px',
    orderedBg: 'transparent',
    tableBorder: border,
    imageRadius: '10px',
    imageBorder: border,
    uColor: dark ? rgba(accent, 0.6) : mix(accent, paper, 0.5),
    uWidth: '2.5px',
    uWeight: '600',
    paragraphSpacing: '1.05em',
    letterSpacing: '0.025em',
    tokens: { ...(codeDark || dark ? DARK_TOKENS : LIGHT_TOKENS), ...(tone.tokens || {}) },
  };
  return p;
}

function isHex(value: string): boolean {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
}

/** True when every text/background pair the atoms rely on is readable. */
export function paletteContrastIssues(p: Palette): string[] {
  var pairs: Array<[string, string, string, number]> = [
    ['text', p.text, p.bg, 4.5],
    ['heading', p.heading, p.bg, 4.5],
    ['accentDeep', p.accentDeep, p.bg, 4.5],
    ['accentDeep/accentSoft', p.accentDeep, p.accentSoft, 4.5],
    ['inlineText/inlineBg', p.inlineText, p.inlineBg, 4.5],
    ['markText/markBg', p.markText, p.markBg, 4.5],
    ['muted', p.muted, p.bg, 4.5],
    ['del', p.delColor, p.bg, 4.5],
    ['onAccent', p.onAccent, p.accent, 3],
    ['onAccent2', p.onAccent2, p.accent2, 3],
    ['onInk', p.onInk, p.ink, 4.5],
  ];
  return pairs
    .filter(function (pair) {
      return isHex(pair[1]) && isHex(pair[2]) && contrast(pair[1], pair[2]) < pair[3];
    })
    .map(function (pair) {
      return pair[0];
    });
}

export var CSS_VARS: Record<string, string> = {
  accent: '--mdstudio-accent',
  accentDeep: '--mdstudio-accent-deep',
  accentSoft: '--mdstudio-accent-soft',
  accentFaint: '--mdstudio-accent-faint',
  onAccent: '--mdstudio-on-accent',
  accent2: '--mdstudio-accent-2',
  onAccent2: '--mdstudio-on-accent-2',
  band: '--mdstudio-band',
  point: '--mdstudio-point',
  ink: '--mdstudio-ink',
  onInk: '--mdstudio-on-ink',
  fontSize: '--mdstudio-font-size',
  lineHeight: '--mdstudio-line-height',
  fontStack: '--mdstudio-font-family',
  headingFont: '--mdstudio-heading-font',
  text: '--mdstudio-text',
  muted: '--mdstudio-muted',
  heading: '--mdstudio-heading',
  bg: '--mdstudio-bg',
  soft: '--mdstudio-soft',
  tldrBg: '--mdstudio-tldr-bg',
  alertBg: '--mdstudio-alert-bg',
  paperRadius: '--mdstudio-paper-radius',
  border: '--mdstudio-border',
  borderStrong: '--mdstudio-border-strong',
  taskBorder: '--mdstudio-task-border',
  tableHead: '--mdstudio-table-head',
  codeBg: '--mdstudio-code-bg',
  codeText: '--mdstudio-code-text',
  inlineBg: '--mdstudio-inline-bg',
  inlineText: '--mdstudio-inline-text',
  radius: '--mdstudio-radius',
  justify: '--mdstudio-justify',
  quoteText: '--mdstudio-quote-text',
  tableZebra: '--mdstudio-table-zebra',
  codeBorder: '--mdstudio-code-border',
  inlineBorder: '--mdstudio-inline-border',
  markBg: '--mdstudio-mark-bg',
  markText: '--mdstudio-mark-text',
  markBorder: '--mdstudio-mark-border',
  strongColor: '--mdstudio-strong-color',
  emColor: '--mdstudio-em-color',
  emStyle: '--mdstudio-em-style',
  delColor: '--mdstudio-del-color',
  linkColor: '--mdstudio-link-color',
  linkUnderline: '--mdstudio-link-underline',
  quoteBg: '--mdstudio-quote-bg',
  quoteBorder: '--mdstudio-quote-border',
  quoteRadius: '--mdstudio-quote-radius',
  quotePadding: '--mdstudio-quote-padding',
  hrColor: '--mdstudio-hr-color',
  hrWidth: '--mdstudio-hr-width',
  orderedBg: '--mdstudio-ordered-bg',
  tableBorder: '--mdstudio-table-border',
  imageRadius: '--mdstudio-image-radius',
  imageBorder: '--mdstudio-image-border',
  uColor: '--mdstudio-u-color',
  uWidth: '--mdstudio-u-width',
  uWeight: '--mdstudio-u-weight',
  paragraphSpacing: '--mdstudio-paragraph-spacing',
  letterSpacing: '--mdstudio-paragraph-letter-spacing',
  'tokens.keyword': '--mdstudio-token-keyword',
  'tokens.string': '--mdstudio-token-string',
  'tokens.comment': '--mdstudio-token-comment',
  'tokens.number': '--mdstudio-token-number',
  'tokens.function': '--mdstudio-token-function',
  'tokens.tag': '--mdstudio-token-tag',
  'tokens.attr': '--mdstudio-token-attr',
  'tokens.literal': '--mdstudio-token-literal',
};

/** `var(--mdstudio-…)` reference for a palette field. */
export function v(name: string): string {
  return 'var(' + CSS_VARS[name] + ')';
}

function paletteValue(p: Palette, key: string): string {
  if (key.indexOf('tokens.') === 0) return p.tokens[key.slice(7) as keyof TokenColors];
  return (p as unknown as Record<string, string>)[key];
}

export function cssVariables(p: Palette): string {
  var lines = Object.keys(CSS_VARS).map(function (key) {
    return '  ' + CSS_VARS[key] + ': ' + paletteValue(p, key) + ';';
  });
  return ['.mdstudio-content {'].concat(lines, ['}']).join('\n');
}
