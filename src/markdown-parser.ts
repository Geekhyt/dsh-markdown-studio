import { sanitizeImageUrl, sanitizeLinkUrl } from './domain/urls';

/*
 * Markdown Studio engine.
 *
 * Pure Markdown parsing and HTML generation, plus the DOM-only CSS inliner.
 * This module is strict TypeScript and has no React or application imports.
 */

export interface RenderOptions {
  locale?: 'zh' | 'en';
  linkFootnotes?: boolean;
  footnotesTitle?: string;
  referencesTitle?: string;
  scrollVerticalHint?: string;
  scrollHorizontalHint?: string;
}

export interface EngineReference {
  label: string;
  url: string;
}

export interface RenderResult {
  html: string;
  meta: Record<string, string>;
  refs: EngineReference[];
}

interface FootnoteDefinition {
  id: string;
  text: string;
}

interface RenderContext {
  refs: EngineReference[];
  refIndex: Map<string, number>;
  linkDefs: Map<string, Destination>;
  footnotes: Map<string, FootnoteDefinition>;
  footnoteNumbers: Map<string, number>;
  footnoteOrder: string[];
  inLink?: boolean;
  options: {
    linkFootnotes: boolean;
    footnotesTitle: string;
    scrollVerticalHint: string;
    scrollHorizontalHint: string;
  };
}

interface BlockResult {
  html: string;
  next: number;
}

interface Destination {
  href: string;
  title: string;
}

interface LinkMatch extends Destination {
  label: string;
  end: number;
}

interface ListItem {
  lines: string[];
  checked: boolean | null;
  indent: number;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return ESCAPES[ch];
  });
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(String(value == null ? '' : value)).replace(/\n/g, '&#10;');
}

/* ------------------------------------------------------------------------- */
/* Generic string helpers                                                     */
/* ------------------------------------------------------------------------- */

function findCodeSpanClose(text: string, from: number, ticks: number): number {
  let pos = from;
  while (pos < text.length) {
    const next = text.indexOf('`', pos);
    if (next === -1) return -1;
    let run = 1;
    while (text.charAt(next + run) === '`') run++;
    if (run === ticks) return next;
    pos = next + run;
  }
  return -1;
}

function isOddBackslashEscaped(text: string, index: number): boolean {
  let count = 0;
  let pos = index - 1;
  while (pos >= 0 && text.charAt(pos) === '\\') {
    count++;
    pos--;
  }
  return (count & 1) === 1;
}

function findMathClose(text: string, from: number, delimiter: string): number {
  let pos = from;
  while (pos < text.length) {
    const next = text.indexOf(delimiter, pos);
    if (next === -1) return -1;
    if (!isOddBackslashEscaped(text, next)) return next;
    pos = next + 1;
  }
  return -1;
}

function skipTeXMath(text: string, index: number): number {
  if (text.charAt(index) !== '\\') return index;
  const next = text.charAt(index + 1);
  if (next !== '(' && next !== '[') return index;
  const close = findMathClose(text, index + 2, next === '(' ? '\\)' : '\\]');
  return close === -1 ? index : close + 1;
}

function isInlineCurrencyMath(text: string, openEnd: number, close: number): boolean {
  if (/[0-9]/.test(text.charAt(close + 1))) return true;
  const source = text.slice(openEnd, close);
  if (!source.trim().length || /^\s/.test(source) || /\s$/.test(source)) return true;
  if (/^[0-9]/.test(source) && !source.includes('\\') && /[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/.test(source)) {
    return true;
  }
  return false;
}

function skipCodeOrMath(text: string, index: number): number {
  const ch = text[index];
  if (ch === '\\') return skipTeXMath(text, index);
  if (ch !== '`' && ch !== '$') return index;
  let len = 1;
  while (text[index + len] === ch) len++;
  if (ch === '`') {
    const close = findCodeSpanClose(text, index + len, len);
    return close === -1 ? index + len - 1 : close + len - 1;
  }
  const close = findMathClose(text, index + len, '$'.repeat(len));
  if (close === -1) return index;
  if (len === 1 && isInlineCurrencyMath(text, index + 1, close)) return index;
  return close + len - 1;
}

function isExternalHref(href: string): boolean {
  if (!/^(?:https?:)?\/\//i.test(href)) return false;
  return !/^(?:https?:)?\/\/(mp\.weixin\.qq\.com|mp\.weixin\.com)\//i.test(href);
}

/* ------------------------------------------------------------------------- */
/* Markdown highlighting                                                      */
/* ------------------------------------------------------------------------- */

const JS_KEYWORDS = new Set<string>(
  (
    'const let var function return if else for while do switch case break continue new class extends ' +
    'import export from default try catch finally throw typeof instanceof in of async await yield static get set ' +
    'delete void this super interface type enum implements public private protected readonly ' +
    'declare namespace abstract as satisfies keyof infer never unknown any string number boolean object'
  ).split(/\s+/),
);

const PY_KEYWORDS = new Set<string>(
  (
    'def class return if elif else for while in not and or is import from as ' +
    'with try except finally raise lambda pass yield async await global nonlocal assert del print self match case'
  ).split(/\s+/),
);

const SH_KEYWORDS = new Set<string>(
  (
    'if then else fi for while do done case esac function in export local return echo cd ' +
    'set unset source alias sudo git npm pnpm yarn node python pip curl wget cat grep sed awk mkdir rm cp mv'
  ).split(/\s+/),
);

function tokenSpan(kind: string | null, text: string): string {
  if (!kind) return escapeHtml(text);
  return '<span class="mdstudio-tok-' + kind + '">' + escapeHtml(text) + '</span>';
}

function highlightScript(code: string, keywords: Set<string>, language: string): string {
  var hashComments = language === 'py' || language === 'sh' || language === 'yaml' || language === 'toml';
  var re = hashComments
    ? /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d[\w.]*\b|[A-Za-z_$][\w$]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d[\w.]*\b|[A-Za-z_$][\w$]*)/g;
  var out = '';
  var last = 0;
  var m;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    var token = m[0];
    var kind = '';
    if (
      (!hashComments && (token.indexOf('//') === 0 || token.indexOf('/*') === 0)) ||
      (hashComments && token.charAt(0) === '#')
    ) {
      kind = 'comment';
    } else if (/^["'`]/.test(token)) {
      kind = 'string';
    } else if (/^\d/.test(token)) {
      kind = 'number';
    } else if (/^(true|false|null|undefined|None|True|False)$/.test(token)) {
      kind = 'literal';
    } else if (keywords.has(token)) {
      kind = 'keyword';
    } else if (/^[A-Za-z_$]/.test(token)) {
      var after = code.slice(m.index + token.length);
      if (/^\s*\(/.test(after)) kind = 'function';
    }
    out += tokenSpan(kind, token);
    last = m.index + token.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

function highlightAttrs(source: string): string {
  var re = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
  var out = '';
  var last = 0;
  var m;
  while ((m = re.exec(source)) !== null) {
    out += escapeHtml(source.slice(last, m.index));
    out += '<span class="mdstudio-tok-attr">' + escapeHtml(m[1]) + '</span>';
    out += escapeHtml(m[2]);
    if (m[3]) out += tokenSpan('string', m[3]);
    last = re.lastIndex;
  }
  out += escapeHtml(source.slice(last));
  return out;
}

function highlightMarkup(code: string): string {
  var re = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?>)/g;
  var out = '';
  var last = 0;
  var m;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    if (m[1]) {
      out += tokenSpan('comment', m[1]);
    } else {
      out += '<span class="mdstudio-tok-tag">' + escapeHtml(m[2] + m[3]) + '</span>';
      out += highlightAttrs(m[4]);
      out += '<span class="mdstudio-tok-tag">' + escapeHtml(m[5]) + '</span>';
    }
    last = re.lastIndex;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

function highlightCss(code: string): string {
  var re =
    /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)/g;
  var out = '';
  var last = 0;
  var m;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    var token = m[0];
    var kind = 'number';
    if (/^\/\*/.test(token)) kind = 'comment';
    else if (/^["']/.test(token)) kind = 'string';
    out += tokenSpan(kind, token);
    last = m.index + token.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

export function highlightCode(code: string, language?: string): string {
  var lang = String(language || '').toLowerCase();
  if (!lang) return escapeHtml(code);
  if (/^(html|xml|svg|vue|markup)$/.test(lang)) return highlightMarkup(code);
  if (/^(css|scss|less|sass)$/.test(lang)) return highlightCss(code);
  if (/^(js|javascript|jsx|mjs|cjs|json|ts|typescript|tsx)$/.test(lang)) {
    return highlightScript(code, lang === 'json' ? new Set() : JS_KEYWORDS, lang);
  }
  if (/^(py|python)$/.test(lang)) return highlightScript(code, PY_KEYWORDS, 'py');
  if (/^(sh|bash|shell|zsh|console|yaml|yml|toml|ini|dockerfile)$/.test(lang)) {
    return highlightScript(code, SH_KEYWORDS, 'sh');
  }
  return escapeHtml(code);
}

/* ------------------------------------------------------------------------- */
/* Markdown inline parsing                                                    */
/* ------------------------------------------------------------------------- */

function normalizeLabel(label: string): string {
  return String(label || '')
    .replace(/[`*_~=+]/g, '')
    .trim();
}

function addReference(ctx: RenderContext, label: string, href: string): number {
  var existing = ctx.refIndex.get(href);
  if (existing) return existing;
  var index = ctx.refs.length + 1;
  ctx.refs.push({ label: normalizeLabel(label) || href, url: href });
  ctx.refIndex.set(href, index);
  return index;
}

function renderLink(ctx: RenderContext, labelHtml: string, labelText: string, href: string, title: string): string {
  const safeHref = sanitizeLinkUrl(href);
  if (!safeHref) return labelHtml;
  href = safeHref;
  if (!ctx.options.linkFootnotes || !isExternalHref(href)) {
    return (
      '<a href="' +
      escapeAttr(href) +
      '"' +
      (title ? ' title="' + escapeAttr(title) + '"' : '') +
      '>' +
      labelHtml +
      '</a>'
    );
  }
  var index = addReference(ctx, labelText, href);
  return '<span class="mdstudio-link">' + labelHtml + '<sup class="mdstudio-ref">[' + index + ']</sup></span>';
}

function parseDestination(raw: string): Destination {
  var dest = String(raw || '').trim();
  var href = '';
  var title = '';
  if (dest.charAt(0) === '<') {
    var close = dest.indexOf('>');
    if (close !== -1) {
      href = dest.slice(1, close);
      var rest = dest.slice(close + 1).trim();
      title = stripQuotes(rest);
    }
  } else {
    var split = /^(\S+)(?:\s+([\s\S]+))?$/.exec(dest);
    if (split) {
      href = split[1];
      title = stripQuotes((split[2] || '').trim());
    }
  }
  return { href: href, title: title };
}

function stripQuotes(value: string): string {
  if (!value) return '';
  var m = /^["'(]([\s\S]*)["')]$/.exec(value);
  return m ? m[1] : value;
}

function findMatching(text: string, start: number, open: string, close: string): number {
  var depth = 0;
  var quote = null;
  for (var i = start; i < text.length; i++) {
    var ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    // Only treat quotes as title delimiters after whitespace so apostrophes inside URLs (e.g. Newton's_laws) stay intact.
    if ((ch === '"' || ch === "'") && i > start && /\s/.test(text[i - 1])) {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findLinkBracketEnd(text: string, start: number): number {
  if (text.charAt(start) !== '[') return -1;
  var depth = 0;
  for (var i = start; i < text.length; i++) {
    const jumped = skipCodeOrMath(text, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    var ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseLinkAt(text: string, start: number): LinkMatch | null {
  var end = findLinkBracketEnd(text, start);
  if (end === -1 || text.charAt(end + 1) !== '(') return null;
  var close = findMatching(text, end + 1, '(', ')');
  if (close === -1) return null;
  var dest = parseDestination(text.slice(end + 2, close));
  return {
    label: text.slice(start + 1, end),
    href: dest.href,
    title: dest.title,
    end: close + 1,
  };
}

function normalizeRefKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseRefLinkAt(text: string, start: number, linkDefs: Map<string, Destination>): LinkMatch | null {
  const end = findLinkBracketEnd(text, start);
  if (end === -1 || !linkDefs.size) return null;
  const label = text.slice(start + 1, end);
  if (text.charAt(end + 1) === '[') {
    const refEnd = findLinkBracketEnd(text, end + 1);
    if (refEnd === -1) return null;
    const rawRef = text.slice(end + 2, refEnd);
    const def = linkDefs.get(normalizeRefKey(rawRef || label));
    return def ? { label, href: def.href, title: def.title, end: refEnd + 1 } : null;
  }
  const shortcut = linkDefs.get(normalizeRefKey(label));
  return shortcut ? { label, href: shortcut.href, title: shortcut.title, end: end + 1 } : null;
}

function isIntrawordNeighbor(ch: string, delimiterChar: string): boolean {
  return ch === delimiterChar || /[A-Za-z0-9]/.test(ch);
}

function isIntrawordGuarded(ch: string): boolean {
  return ch === '_' || ch === '+' || ch === '=';
}

function canSplitTripleOpen(text: string, index: number, delimiter: string, ch: string): boolean {
  if (delimiter !== '**' && delimiter !== '*' && delimiter !== '__' && delimiter !== '_') return false;
  if (text.charAt(index + 1) !== ch || text.charAt(index + 2) !== ch) return false;
  const fourth = text.charAt(index + 3);
  return Boolean(fourth && fourth !== ch && !/\s/.test(fourth));
}

function canOpenEmphasis(text: string, index: number, delimiter: string): boolean {
  const ch = delimiter.charAt(0);
  const after = text.charAt(index + delimiter.length);
  if (!after || /\s/.test(after)) return false;
  // Allow `**` / `*` (or `__` / `_`) to split a leading triple run (`***italic* and bold**` or `***bold** and italic*`).
  if (after === ch && !canSplitTripleOpen(text, index, delimiter, ch)) {
    return false;
  }
  const before = index > 0 ? text.charAt(index - 1) : '';
  if (before === ch) return false;
  if (isIntrawordGuarded(ch) && before && isIntrawordNeighbor(before, ch)) return false;
  return true;
}

function canCloseAt(text: string, from: number, i: number, closeAt: number, ch: string, len: number): boolean {
  if (i <= from || /\s/.test(text.charAt(i - 1))) return false;
  return ch !== '_' || !isIntrawordNeighbor(text.charAt(closeAt + len), ch);
}

interface EmphasisScanState {
  complementOpen: boolean;
  tripleDepth: number;
  fallbackTriple: number;
}

function stepStarOrUnderRun(
  text: string,
  from: number,
  i: number,
  ch: string,
  len: number,
  runLen: number,
  state: EmphasisScanState,
): number {
  const complementLen = len === 2 ? 1 : 2;
  const nextChar = text.charAt(i + runLen);
  const canOpen = Boolean(nextChar && !/\s/.test(nextChar));
  const canClose = i > from && !/\s/.test(text.charAt(i - 1));
  if (runLen === complementLen) {
    if (canOpen && !state.complementOpen) state.complementOpen = true;
    else if (canClose && state.complementOpen) state.complementOpen = false;
    return -1;
  }
  if (runLen !== 3) return -1;
  if (state.complementOpen && canClose && canCloseAt(text, from, i, i + 3 - len, ch, len)) return i + 3 - len;
  if (state.tripleDepth > 0 && canClose) state.tripleDepth--;
  else if (canOpen) state.tripleDepth++;
  else if (canClose && state.fallbackTriple === -1 && canCloseAt(text, from, i, i, ch, len)) state.fallbackTriple = i;
  return -1;
}

function findClosingDelimiter(text: string, from: number, delimiter: string): number {
  const ch = delimiter.charAt(0);
  const len = delimiter.length;
  const trackNested = (ch === '*' || ch === '_') && len < 3;
  const openedInsideTriple = trackNested && text.charAt(from) === ch;
  const state: EmphasisScanState = { complementOpen: false, tripleDepth: 0, fallbackTriple: -1 };
  for (let i = from; i <= text.length - len; i++) {
    const jumped = skipCodeOrMath(text, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    const cur = text.charAt(i);
    if (cur === '\\') {
      i++;
      continue;
    }
    if (cur !== ch) continue;
    let runLen = 1;
    while (text.charAt(i + runLen) === ch) runLen++;
    if (runLen === len && canCloseAt(text, from, i, i, ch, len)) {
      if (openedInsideTriple && state.complementOpen) return -1;
      return i;
    }
    if (trackNested) {
      const matched = stepStarOrUnderRun(text, from, i, ch, len, runLen, state);
      if (matched !== -1) return matched;
    }
    i += runLen - 1;
  }
  return state.fallbackTriple;
}

interface InlineToken {
  html: string;
  next: number;
}

const ASCII_PUNCT_RE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  ne: '≠',
  approx: '≈',
  rarr: '→',
  larr: '←',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  deg: '°',
  sect: '§',
  para: '¶',
  euro: '€',
  yen: '¥',
  pound: '£',
  cent: '¢',
};

function decodeCodePoint(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(cp);
}

function inlineEntity(text: string, index: number): InlineToken | null {
  if (text.charAt(index) !== '&') return null;
  const match = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,15}));/.exec(text.slice(index));
  if (!match) return null;
  if (match[1] || match[2]) {
    const cp = match[1] ? parseInt(match[1], 10) : parseInt(match[2], 16);
    return { html: escapeHtml(decodeCodePoint(cp)), next: index + match[0].length };
  }
  const named = NAMED_ENTITIES[match[3]];
  return named ? { html: escapeHtml(named), next: index + match[0].length } : null;
}

function inlineEscape(text: string, index: number): InlineToken | null {
  if (text.charAt(index) !== '\\' || index + 1 >= text.length) return null;
  const nextChar = text.charAt(index + 1);
  if (nextChar === '\n') return { html: '<br>', next: index + 2 };
  if (!ASCII_PUNCT_RE.test(nextChar)) return null;
  return { html: escapeHtml(nextChar), next: index + 2 };
}

function renderMathSpan(display: boolean, source: string): string {
  return (
    '<span class="mdstudio-math" data-mdstudio-display="' +
    (display ? '1' : '0') +
    '" data-mdstudio-tex="' +
    escapeAttr(source) +
    '"></span>'
  );
}

function inlineTeXMath(text: string, index: number): InlineToken | null {
  if (text.charAt(index) !== '\\') return null;
  const next = text.charAt(index + 1);
  if (next !== '(' && next !== '[') return null;
  const display = next === '[';
  const close = findMathClose(text, index + 2, display ? '\\]' : '\\)');
  if (close === -1) return null;
  const source = text.slice(index + 2, close).trim();
  if (!source) return null;
  return { html: renderMathSpan(display, source), next: close + 2 };
}

function inlineMath(text: string, index: number): InlineToken | null {
  if (text.charAt(index) !== '$') return null;
  const display = text.substr(index, 2) === '$$';
  const delimiter = display ? '$$' : '$';
  const openEnd = index + delimiter.length;
  const close = findMathClose(text, openEnd, delimiter);
  if (close === -1) return null;
  const source = text.slice(openEnd, close);
  if (!source.trim().length) return null;
  if (!display && isInlineCurrencyMath(text, openEnd, close)) return null;
  return { html: renderMathSpan(display, source), next: close + delimiter.length };
}

function stripCodeSpanPadding(raw: string): string {
  const flat = raw.replace(/\n/g, ' ');
  if (flat.length >= 2 && flat.charAt(0) === ' ' && flat.charAt(flat.length - 1) === ' ' && /[^ ]/.test(flat)) {
    return flat.slice(1, -1);
  }
  return flat;
}

function inlineCode(text: string, index: number): InlineToken | null {
  if (text.charAt(index) !== '`') return null;
  let ticks = 1;
  while (text.charAt(index + ticks) === '`') ticks++;
  const close = findCodeSpanClose(text, index + ticks, ticks);
  if (close === -1) return { html: new Array(ticks + 1).join('`'), next: index + ticks };
  return {
    html: '<code>' + escapeHtml(stripCodeSpanPadding(text.slice(index + ticks, close))) + '</code>',
    next: close + ticks,
  };
}

function inlineImage(text: string, index: number, ctx?: RenderContext): InlineToken | null {
  if (text.charAt(index) !== '!' || text.charAt(index + 1) !== '[') return null;
  const image = parseLinkAt(text, index + 1) || (ctx ? parseRefLinkAt(text, index + 1, ctx.linkDefs) : null);
  if (!image) return null;
  const safeSrc = sanitizeImageUrl(image.href);
  if (!safeSrc) return { html: escapeHtml(image.label), next: image.end };
  return {
    html:
      '<img src="' +
      escapeAttr(safeSrc) +
      '" alt="' +
      escapeAttr(image.label) +
      '"' +
      (image.title ? ' title="' + escapeAttr(image.title) + '"' : '') +
      '>',
    next: image.end,
  };
}

function inlineFootnote(text: string, index: number, ctx: RenderContext): InlineToken | null {
  if (text.charAt(index) !== '[' || !ctx.footnotes) return null;
  const footnote = /^\[\^([^\]\s]+)\]/.exec(text.slice(index));
  if (!footnote || !ctx.footnotes.has(footnote[1])) return null;
  const id = footnote[1];
  let number = ctx.footnoteNumbers.get(id);
  if (!number) {
    number = ctx.footnoteOrder.length + 1;
    ctx.footnoteNumbers.set(id, number);
    ctx.footnoteOrder.push(id);
  }
  return { html: '<sup class="mdstudio-footnote-ref">[' + number + ']</sup>', next: index + footnote[0].length };
}

function inlineLink(text: string, index: number, ctx: RenderContext): InlineToken | null {
  if (text.charAt(index) !== '[') return null;
  const footnote = inlineFootnote(text, index, ctx);
  if (footnote) return footnote;
  if (ctx.inLink) return null;
  const link = parseLinkAt(text, index) || parseRefLinkAt(text, index, ctx.linkDefs);
  if (!link) return null;
  const label = normalizeLabel(link.label);
  const hideUrlLabel = /^https?:\/\//i.test(label) && ctx.options.linkFootnotes && isExternalHref(link.href);
  ctx.inLink = true;
  const innerHtml = hideUrlLabel ? '' : renderInline(link.label, ctx);
  ctx.inLink = false;
  return {
    html: renderLink(ctx, innerHtml, label, link.href, link.title),
    next: link.end,
  };
}

function inlineAutoLink(text: string, index: number, ctx: RenderContext): InlineToken | null {
  if (text.charAt(index) !== '<') return null;
  const auto = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(text.slice(index));
  if (!auto) return null;
  const label = auto[1].replace(/^mailto:/, '');
  const hidden = ctx.options.linkFootnotes && isExternalHref(auto[1]);
  return {
    html: renderLink(ctx, hidden ? '' : escapeHtml(label), hidden ? '' : label, auto[1], ''),
    next: index + auto[0].length,
  };
}

function trimBareUrl(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url.charAt(url.length - 1);
    if (/[?!.,:*_~;'"，。！？；：、》」』】]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function inlineBareLink(text: string, index: number, ctx: RenderContext): InlineToken | null {
  const ch = text.charAt(index);
  if (ch !== 'h' && ch !== 'H') return null;
  if (index !== 0 && /[A-Za-z0-9/@._\-=]/.test(text.charAt(index - 1))) return null;
  const bare = /^(https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+)/.exec(text.slice(index));
  if (!bare) return null;
  const url = trimBareUrl(bare[1]);
  if (!/^https?:\/\/\S/.test(url)) return null;
  const hidden = ctx.options.linkFootnotes && isExternalHref(url);
  return {
    html: renderLink(ctx, hidden ? '' : escapeHtml(url), hidden ? '' : url, url, ''),
    next: index + url.length,
  };
}

const EMPHASIS_SPECS: ReadonlyArray<{ delim: string; open: string; close: string }> = [
  { delim: '***', open: '<strong><em>', close: '</em></strong>' },
  { delim: '___', open: '<strong><em>', close: '</em></strong>' },
  { delim: '**', open: '<strong>', close: '</strong>' },
  { delim: '__', open: '<strong>', close: '</strong>' },
  { delim: '~~', open: '<del>', close: '</del>' },
  { delim: '==', open: '<mark>', close: '</mark>' },
  { delim: '++', open: '<u>', close: '</u>' },
  { delim: '*', open: '<em>', close: '</em>' },
  { delim: '_', open: '<em>', close: '</em>' },
];

function inlineEmphasis(text: string, index: number, ctx: RenderContext): InlineToken | null {
  for (let s = 0; s < EMPHASIS_SPECS.length; s++) {
    const spec = EMPHASIS_SPECS[s];
    if (!text.startsWith(spec.delim, index) || !canOpenEmphasis(text, index, spec.delim)) continue;
    const end = findClosingDelimiter(text, index + spec.delim.length, spec.delim);
    if (end !== -1) {
      return {
        html: spec.open + renderInline(text.slice(index + spec.delim.length, end), ctx) + spec.close,
        next: end + spec.delim.length,
      };
    }
  }
  return null;
}

function inlineTokenAt(text: string, index: number, ctx: RenderContext): InlineToken | null {
  return (
    inlineEntity(text, index) ||
    inlineMath(text, index) ||
    inlineCode(text, index) ||
    inlineImage(text, index, ctx) ||
    inlineLink(text, index, ctx) ||
    inlineAutoLink(text, index, ctx) ||
    inlineBareLink(text, index, ctx) ||
    inlineEmphasis(text, index, ctx)
  );
}

function renderInline(text: string, ctx: RenderContext): string {
  let out = '';
  let buffer = '';
  let i = 0;
  function flush(): void {
    if (buffer) {
      out += escapeHtml(buffer);
      buffer = '';
    }
  }
  while (i < text.length) {
    const escaped = inlineTeXMath(text, i) || inlineEscape(text, i);
    if (escaped) {
      flush();
      out += escaped.html;
      i = escaped.next;
      continue;
    }
    if (text.charAt(i) === '\n') {
      flush();
      out += '<br>';
      i++;
      continue;
    }
    const token = inlineTokenAt(text, i, ctx);
    if (token) {
      flush();
      out += token.html;
      i = token.next;
      continue;
    }
    buffer += text.charAt(i);
    i++;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------------- */
/* Markdown block parsing                                                     */
/* ------------------------------------------------------------------------- */

const ALERT_DEFS: Record<string, { icon: string; label: string }> = {
  NOTE: { icon: '📌', label: 'NOTE' },
  TIP: { icon: '💡', label: 'TIP' },
  IMPORTANT: { icon: '❗', label: 'IMPORTANT' },
  WARNING: { icon: '⚠️', label: 'WARNING' },
  CAUTION: { icon: '🛑', label: 'CAUTION' },
};

function isHr(line: string): boolean {
  return /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

interface FenceOpening {
  fenceChar: string;
  fenceLength: number;
  language: string;
}

function parseFenceOpening(line: string): FenceOpening | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const fence = match[1];
  const rest = match[2];
  if (fence.charAt(0) === '`' && rest.indexOf('`') !== -1) return null;
  const langMatch = /^\s*([^\s`~]*)/.exec(rest);
  return {
    fenceChar: fence.charAt(0),
    fenceLength: fence.length,
    language: ((langMatch && langMatch[1]) || '').toLowerCase(),
  };
}

function stepFenceState(state: FenceOpening | null, line: string): FenceOpening | null {
  if (!state) return parseFenceOpening(line);
  const closeRe = new RegExp('^ {0,3}' + state.fenceChar + '{' + state.fenceLength + ',}[ \\t]*$');
  return closeRe.test(line) ? null : state;
}

function isFence(line: string): boolean {
  return parseFenceOpening(line) !== null;
}

function isHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/.test(line);
}

function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line) || /^\s*\|\s*:?-{1,}:?\s*\|\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  var head = lines[index];
  var sep = lines[index + 1];
  if (head.indexOf('|') === -1 || sep.indexOf('|') === -1) return false;
  if (!isTableSeparatorLine(sep)) return false;
  return splitTableRow(head).length === splitTableRow(sep).length;
}

function isScrollContainerStart(line: string): boolean {
  return /^ {0,3}:::scroll(?:-x)?(?:[ \t]+\d{2,3}(?:px)?)?[ \t]*$/i.test(line);
}

function isEditorialContainerStart(line: string): boolean {
  return /^ {0,3}:::(?:lead|tldr|pull|sign|meta)(?:[ \t]+.*)?$/i.test(line);
}

function isMathBlockStart(line: string): boolean {
  return /^ {0,3}(?:\$\$|\\\[)/.test(line);
}

function isListLine(line: string): boolean {
  return !isHr(line) && /^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line);
}

function isBlockStart(line: string, lines: string[], index: number): boolean {
  return (
    isHeading(line) ||
    isFence(line) ||
    isMathBlockStart(line) ||
    isScrollContainerStart(line) ||
    isEditorialContainerStart(line) ||
    isHr(line) ||
    /^ {0,3}>/.test(line) ||
    isListLine(line) ||
    isTableStart(lines, index)
  );
}

function splitTableCells(row: string): string[] {
  const cells: string[] = [];
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    const jumped = skipCodeOrMath(row, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    if (row[i] === '\\') {
      i++;
      continue;
    }
    if (row[i] === '|') {
      cells.push(row.slice(start, i).trim());
      start = i + 1;
    }
  }
  cells.push(row.slice(start).trim());
  return cells;
}

function splitTableRow(line: string): string[] {
  var row = String(line || '').trim();
  if (row.charAt(0) === '|') row = row.slice(1);
  if (row.charAt(row.length - 1) === '|' && !isOddBackslashEscaped(row, row.length - 1)) row = row.slice(0, -1);
  return splitTableCells(row);
}

function isTableInterrupt(line: string): boolean {
  return (
    isHeading(line) ||
    isFence(line) ||
    isMathBlockStart(line) ||
    isScrollContainerStart(line) ||
    isEditorialContainerStart(line) ||
    isHr(line) ||
    /^ {0,3}>/.test(line) ||
    isListLine(line)
  );
}

function renderTable(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var header = splitTableRow(lines[start]);
  var divider = splitTableRow(lines[start + 1]);
  var align = divider.map(function (cell) {
    var value = cell.replace(/\s/g, '');
    if (/^:-+:$/.test(value)) return 'center';
    if (/^-+:$/.test(value)) return 'right';
    if (/^:-+$/.test(value)) return 'left';
    return '';
  });
  var rows: string[][] = [];
  var i = start + 2;
  while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1 && !isTableInterrupt(lines[i])) {
    rows.push(splitTableRow(lines[i]));
    i++;
  }
  function cell(tag: string, content: string, index: number): string {
    var style = align[index] ? ' style="text-align:' + align[index] + '"' : '';
    return '<' + tag + style + '>' + renderInline(content, ctx) + '</' + tag + '>';
  }
  var html = '<table><thead><tr>';
  header.forEach(function (value, index) {
    html += cell('th', value, index);
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function (row) {
    html += '<tr>';
    for (var c = 0; c < header.length; c++) html += cell('td', row[c] || '', c);
    html += '</tr>';
  });
  html += '</tbody></table>';
  return { html: html, next: i };
}

function listMarkerMatches(line: string, match: RegExpExecArray | null, indent: number, ordered: boolean): boolean {
  if (!match || isHr(line)) return false;
  return match[1].length === indent && /\d/.test(match[2]) === ordered;
}

function parseTaskLine(raw: string): { text: string; checked: boolean | null } {
  const task = /^\[([ xX])\]\s*([\s\S]*)$/.exec(raw);
  if (!task) return { text: raw, checked: null };
  return { text: task[2], checked: task[1].toLowerCase() === 'x' };
}

function formatTaskItem(rawInner: string, checked: boolean, loose: boolean): string {
  var box = checked
    ? '<span class="mdstudio-task-box is-checked">✓</span>'
    : '<span class="mdstudio-task-box">\u00a0</span>';
  var leading = /^<p>([\s\S]*?)<\/p>/.exec(rawInner);
  if (leading) {
    var inlineText = leading[1] ? '<span class="mdstudio-task-text">' + leading[1] + '</span>' : '';
    var rest = rawInner.slice(leading[0].length);
    return loose ? '<p>' + box + inlineText + '</p>' + rest : box + inlineText + rest;
  }
  return rawInner ? '<p>' + box + '</p>' + rawInner : box;
}

function renderListHtml(
  items: ListItem[],
  ordered: boolean,
  startNumber: number,
  loose: boolean,
  ctx: RenderContext,
): string {
  var allTasks =
    !ordered &&
    items.length > 0 &&
    items.every(function (item) {
      return item.checked !== null;
    });
  var html = ordered
    ? '<ol' + (startNumber !== 1 ? ' start="' + startNumber + '"' : '') + '>'
    : '<ul' + (allTasks ? ' class="mdstudio-task-list"' : '') + '>';
  items.forEach(function (item) {
    var rawInner = blocks(item.lines, ctx);
    if (item.checked !== null) {
      var taskClass = item.checked ? ' class="mdstudio-task is-checked"' : ' class="mdstudio-task"';
      html += '<li' + taskClass + '>' + formatTaskItem(rawInner, item.checked, loose) + '</li>';
      return;
    }
    var inner = rawInner;
    if (!loose) {
      var leading = /^<p>([\s\S]*?)<\/p>/.exec(inner);
      if (leading) inner = leading[1] + inner.slice(leading[0].length);
    }
    html += '<li>' + inner + '</li>';
  });
  return html + (ordered ? '</ol>' : '</ul>');
}

function parseList(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var marker = /^(\s*)([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
  var first = marker.exec(lines[start]);
  if (!first) return { html: '', next: start + 1 };
  var baseIndent = first[1].length;
  var ordered = /\d/.test(first[2]);
  var startNumber = ordered ? parseInt(first[2], 10) : 1;
  var items: ListItem[] = [];
  var current: ListItem | null = null;
  var loose = false;
  var i = start;

  while (i < lines.length) {
    var line = lines[i];
    var match = marker.exec(line);
    if (listMarkerMatches(line, match, baseIndent, ordered)) {
      if (current) items.push(current);
      const itemMatch = match as RegExpExecArray;
      var task = parseTaskLine(itemMatch[3] || '');
      current = {
        lines: [task.text],
        checked: task.checked,
        indent: itemMatch[1].length + itemMatch[2].length + 1,
      };
      i++;
      continue;
    }

    if (!current) break;

    if (/^\s*$/.test(line)) {
      var nextIndex = i + 1;
      while (nextIndex < lines.length && /^\s*$/.test(lines[nextIndex])) nextIndex++;
      if (nextIndex >= lines.length) {
        i = nextIndex;
        break;
      }
      var nextLine = lines[nextIndex];
      var nextMatch = marker.exec(nextLine);
      var nextIndent = (nextLine.match(/^\s*/) || [''])[0].length;
      var sibling = listMarkerMatches(nextLine, nextMatch, baseIndent, ordered);
      if (sibling || nextIndent > baseIndent) {
        current.lines.push('');
        loose = true;
        i = nextIndex;
        continue;
      }
      i = nextIndex;
      break;
    }

    var indent = (line.match(/^\s*/) || [''])[0].length;
    if (listMarkerMatches(line, match, baseIndent, !ordered)) break;
    if (match && match[1].length < baseIndent) break;

    if (indent > baseIndent) {
      var strip = Math.min(indent, current.indent);
      current.lines.push(line.slice(strip));
      i++;
      continue;
    }

    if (!match && !isBlockStart(line, lines, i)) {
      current.lines.push(line);
      i++;
      continue;
    }
    break;
  }
  if (current) items.push(current);
  return { html: renderListHtml(items, ordered, startNumber, loose, ctx), next: i };
}

function parseFence(lines: string[], start: number): BlockResult {
  var opening = parseFenceOpening(lines[start]);
  if (!opening) return { html: '', next: start + 1 };
  var content = [];
  var i = start + 1;
  var closing = new RegExp('^ {0,3}' + opening.fenceChar + '{' + opening.fenceLength + ',}\\s*$');
  while (i < lines.length) {
    var line = lines[i];
    if (closing.test(line)) {
      i++;
      break;
    }
    content.push(line);
    i++;
  }
  var raw = content.join('\n');
  var body = highlightCode(raw, opening.language) || '';
  return {
    html:
      '<pre><code' +
      (opening.language ? ' class="mdstudio-lang-' + escapeAttr(opening.language) + '"' : '') +
      '>' +
      body +
      '</code></pre>',
    next: i,
  };
}

const ALERT_MARKER_RE = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/i;

function isQuoteLazyContinuation(
  isAlertBlock: boolean,
  content: string[],
  line: string,
  lines: string[],
  index: number,
): boolean {
  if (isAlertBlock || !content.length || content[content.length - 1] === '') return false;
  return !isBlockStart(line, lines, index);
}

function parseBlockquote(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var content: string[] = [];
  var isAlertBlock = ALERT_MARKER_RE.test(lines[start] || '');
  var fenceState: FenceOpening | null = null;
  var i = start;
  while (i < lines.length) {
    var line = lines[i];
    if (/^ {0,3}>/.test(line)) {
      if (!fenceState && i > start && ALERT_MARKER_RE.test(line)) break;
      var stripped = line.replace(/^ {0,3}> ?/, '');
      fenceState = stepFenceState(fenceState, stripped);
      content.push(stripped);
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      // Plain quotes merge across a single blank line; alerts stay independent blocks.
      var nextIndex = i + 1;
      if (
        !isAlertBlock &&
        nextIndex < lines.length &&
        /^ {0,3}>/.test(lines[nextIndex]) &&
        !ALERT_MARKER_RE.test(lines[nextIndex])
      ) {
        content.push('');
        i++;
        continue;
      }
      break;
    }
    if (isQuoteLazyContinuation(isAlertBlock, content, line, lines, i)) {
      var trimmed = line.replace(/^[ \t]+|[ \t]+$/g, '');
      fenceState = stepFenceState(fenceState, trimmed);
      content.push(trimmed);
      i++;
      continue;
    }
    break;
  }

  var alert = null;
  var inlineTitle = '';
  if (content.length) {
    var firstLine = content[0];
    var alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(firstLine);
    if (alertMatch) {
      alert = alertMatch[1].toUpperCase();
      inlineTitle = (alertMatch[2] || '').trim();
      content.shift();
    }
  }

  if (alert) {
    var def = ALERT_DEFS[alert];
    var title = inlineTitle || def.label;
    var body = blocks(content, ctx);
    return {
      html:
        '<section class="mdstudio-alert mdstudio-alert-' +
        alert.toLowerCase() +
        '">' +
        '<p class="mdstudio-alert-title">' +
        escapeHtml(title) +
        '</p>' +
        body +
        '</section>',
      next: i,
    };
  }
  return { html: '<blockquote>' + blocks(content, ctx) + '</blockquote>', next: i };
}

function isBlockDirectiveStart(line: string): boolean {
  return (
    isScrollContainerStart(line) ||
    /^ {0,3}:::tldr(?:[ \t]+.*)?$/i.test(line) ||
    /^ {0,3}:::(?:lead|pull|sign|meta)[ \t]*$/i.test(line)
  );
}

function collectScrollBody(lines: string[], start: number): { body: string[]; next: number } {
  var body: string[] = [];
  var fenceState: FenceOpening | null = null;
  var depth = 0;
  var i = start;
  while (i < lines.length) {
    var line = lines[i];
    fenceState = stepFenceState(fenceState, line);
    if (!fenceState && isBlockDirectiveStart(line)) {
      depth++;
      body.push(line);
      i++;
      continue;
    }
    if (!fenceState && /^ {0,3}:::[ \t]*$/.test(line)) {
      if (depth > 0) {
        depth--;
        body.push(line);
        i++;
        continue;
      }
      i++;
      break;
    }
    body.push(line);
    i++;
  }
  return { body: body, next: i };
}

function parseStandaloneImageLine(line: string, ctx?: RenderContext): { html: string; caption: string } | null {
  var trimmed = line.trim();
  if (trimmed.charAt(0) !== '!' || trimmed.charAt(1) !== '[') return null;
  var parsed = parseLinkAt(trimmed, 1) || (ctx ? parseRefLinkAt(trimmed, 1, ctx.linkDefs) : null);
  if (!parsed || parsed.end !== trimmed.length) return null;
  var token = inlineImage(trimmed, 0, ctx);
  if (!token || token.html.indexOf('<img ') !== 0) return null;
  return { html: token.html, caption: parsed.label.trim() };
}

function stepDirectiveDepth(depth: number, line: string): number {
  if (/^ {0,3}:::\s*$/.test(line)) return Math.max(0, depth - 1);
  if (isBlockDirectiveStart(line)) return depth + 1;
  return depth;
}

function splitSlideGroups(body: string[], splitOnBlank: boolean): string[][] {
  var groups: string[][] = [];
  var current: string[] = [];
  var fenceState: FenceOpening | null = null;
  var directiveDepth = 0;
  for (var i = 0; i < body.length; i++) {
    var line = body[i];
    fenceState = stepFenceState(fenceState, line);
    var isSep = !fenceState && directiveDepth === 0 && (splitOnBlank ? /^\s*$/.test(line) : isHr(line));
    if (isSep) {
      if (
        current.some(function (item) {
          return item.trim().length > 0;
        })
      )
        groups.push(current);
      current = [];
      continue;
    }
    if (!fenceState) directiveDepth = stepDirectiveDepth(directiveDepth, line);
    current.push(line);
  }
  if (
    current.some(function (item) {
      return item.trim().length > 0;
    })
  )
    groups.push(current);
  return groups;
}

function hasTopLevelHr(body: string[]): boolean {
  var fenceState: FenceOpening | null = null;
  var directiveDepth = 0;
  for (var i = 0; i < body.length; i++) {
    var prevFence = fenceState;
    fenceState = stepFenceState(fenceState, body[i]);
    if (!prevFence && !fenceState) {
      if (directiveDepth === 0 && isHr(body[i])) return true;
      directiveDepth = stepDirectiveDepth(directiveDepth, body[i]);
    }
  }
  return false;
}

function splitHorizontalSlides(body: string[], ctx: RenderContext): string[][] {
  if (hasTopLevelHr(body)) return splitSlideGroups(body, false);
  var nonEmpty = body.filter(function (line) {
    return line.trim().length > 0;
  });
  if (
    nonEmpty.length >= 2 &&
    nonEmpty.every(function (line) {
      return parseStandaloneImageLine(line, ctx) !== null;
    })
  ) {
    return nonEmpty.map(function (line) {
      return [line];
    });
  }
  return splitSlideGroups(body, true);
}

function renderHorizontalSlide(slide: string[], ctx: RenderContext): string {
  var nonEmpty = slide.filter(function (line) {
    return line.trim().length > 0;
  });
  var standalone = nonEmpty.length === 1 ? parseStandaloneImageLine(nonEmpty[0], ctx) : null;
  if (standalone) {
    var captionHtml = standalone.caption
      ? '<p class="mdstudio-scroll-caption" data-ignore-width="">' + escapeHtml(standalone.caption) + '</p>'
      : '';
    return (
      '<section class="mdstudio-scroll-slide" data-ignore-width=""><section class="mdstudio-scroll-media" data-ignore-width="">' +
      standalone.html +
      '</section>' +
      captionHtml +
      '</section>'
    );
  }
  return '<section class="mdstudio-scroll-slide" data-ignore-width="">' + blocks(slide, ctx) + '</section>';
}

function parseScrollContainer(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var match = /^ {0,3}:::scroll(-x)?(?:[ \t]+(\d{2,3})(?:px)?)?[ \t]*$/i.exec(lines[start]);
  if (!match) return { html: '', next: start + 1 };
  var isHorizontal = !!match[1];
  var collected = collectScrollBody(lines, start + 1);
  if (isHorizontal) {
    var slides = splitHorizontalSlides(collected.body, ctx);
    var trackInner = slides
      .map(function (slide) {
        return renderHorizontalSlide(slide, ctx);
      })
      .join('');
    return {
      html:
        '<section class="mdstudio-scroll-x" data-ignore-width=""><section class="mdstudio-scroll-track" data-ignore-width="">' +
        trackInner +
        '</section><p class="mdstudio-scroll-x-hint">' +
        escapeHtml(ctx.options.scrollHorizontalHint) +
        '</p></section>',
      next: collected.next,
    };
  }
  var customHeight = match[2] ? Math.min(560, Math.max(120, Number(match[2]))) : 0;
  var styleAttr = customHeight ? ' style="max-height: ' + customHeight + 'px;"' : '';
  return {
    html:
      '<section class="mdstudio-scroll"><p class="mdstudio-scroll-hint">' +
      escapeHtml(ctx.options.scrollVerticalHint) +
      '</p><section class="mdstudio-scroll-body"' +
      styleAttr +
      '>' +
      blocks(collected.body, ctx) +
      '</section></section>',
    next: collected.next,
  };
}

function parseFrontmatter(text: string): { meta: Record<string, string>; rest: string } | null {
  var match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  var lines = match[1].split(/\r?\n/);
  var meta: Record<string, string> = {};
  var lastKey = '';
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    if (lastKey && /^[ \t]+-[ \t]+(.*)$/.test(raw)) {
      var item = raw.replace(/^[ \t]+-[ \t]+/, '').trim();
      meta[lastKey] = meta[lastKey] ? meta[lastKey] + ', ' + item : item;
      continue;
    }
    var pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) return null;
    var value = pair[2].trim();
    if (
      (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
    ) {
      value = value.slice(1, -1);
    }
    lastKey = pair[1];
    meta[lastKey] = value;
  }
  return { meta: meta, rest: text.slice(match[0].length) };
}

function renderDisplayMathHtml(tex: string): string {
  return (
    '<p><span class="mdstudio-math" data-mdstudio-display="1" data-mdstudio-tex="' + escapeAttr(tex) + '"></span></p>'
  );
}

function parseDelimitedMathBlock(
  lines: string[],
  start: number,
  singleRe: RegExp,
  openRe: RegExp,
  closeRe: RegExp,
  closeToken: string,
): BlockResult | null {
  var single = singleRe.exec(lines[start]);
  if (single && single[1].trim() && single[1].indexOf(closeToken) === -1) {
    return { html: renderDisplayMathHtml(single[1].trim()), next: start + 1 };
  }
  var open = openRe.exec(lines[start]);
  if (!open || open[1].indexOf(closeToken) !== -1) return null;
  var body: string[] = open[1] ? [open[1]] : [];
  for (var i = start + 1; i < lines.length; i++) {
    var close = closeRe.exec(lines[i]);
    if (close && !isOddBackslashEscaped(lines[i], close[1].length)) {
      if (close[1].trim()) body.push(close[1]);
      var tex = body.join('\n').trim();
      return tex ? { html: renderDisplayMathHtml(tex), next: i + 1 } : null;
    }
    body.push(lines[i]);
  }
  return null;
}

function parseMathBlock(lines: string[], start: number): BlockResult | null {
  return (
    parseDelimitedMathBlock(
      lines,
      start,
      /^ {0,3}\$\$(.+?)\$\$[ \t]*$/,
      /^ {0,3}\$\$[ \t]*(.*)$/,
      /^(.*?)\$\$[ \t]*$/,
      '$$',
    ) ||
    parseDelimitedMathBlock(
      lines,
      start,
      /^ {0,3}\\\[(.+?)\\\][ \t]*$/,
      /^ {0,3}\\\[[ \t]*(.*)$/,
      /^(.*?)\\\][ \t]*$/,
      '\\]',
    )
  );
}

function renderInlineLinesJoined(lines: string[], sep: string, ctx: RenderContext): string {
  return lines
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .map(function (line) {
      return renderInline(line, ctx);
    })
    .join(sep);
}

function renderSimpleEditorial(
  className: string,
  arg: string,
  lines: string[],
  start: number,
  sep: string,
  ctx: RenderContext,
): BlockResult {
  if (arg) {
    return { html: '<p class="' + className + '">' + renderInline(arg, ctx) + '</p>', next: start + 1 };
  }
  var collected = collectScrollBody(lines, start + 1);
  return {
    html: '<p class="' + className + '">' + renderInlineLinesJoined(collected.body, sep, ctx) + '</p>',
    next: collected.next,
  };
}

function renderPullEditorial(arg: string, lines: string[], start: number, ctx: RenderContext): BlockResult {
  if (arg) {
    return { html: '<section class="mdstudio-pull">' + renderInline(arg, ctx) + '</section>', next: start + 1 };
  }
  var collected = collectScrollBody(lines, start + 1);
  var inner = blocks(collected.body, ctx);
  var singlePara = /^<p>([\s\S]*?)<\/p>$/.exec(inner);
  var pullBody = singlePara ? singlePara[1] : inner;
  return { html: '<section class="mdstudio-pull">' + pullBody + '</section>', next: collected.next };
}

function parseEditorialContainer(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var match = /^ {0,3}:::(lead|tldr|pull|sign|meta)(?:[ \t]+(.*?))?[ \t]*$/i.exec(lines[start]);
  if (!match) return { html: '', next: start + 1 };
  var kind = match[1].toLowerCase();
  var arg = (match[2] || '').trim();
  if (kind === 'lead') return renderSimpleEditorial('mdstudio-lead', arg, lines, start, '<br>', ctx);
  if (kind === 'sign') return renderSimpleEditorial('mdstudio-sign', arg, lines, start, '<br>', ctx);
  if (kind === 'meta') return renderSimpleEditorial('mdstudio-meta', arg, lines, start, ' · ', ctx);
  if (kind === 'pull') return renderPullEditorial(arg, lines, start, ctx);
  var collected = collectScrollBody(lines, start + 1);
  var titleAttr = arg ? '' : ' data-mdstudio-default-tldr="1"';
  var titleText = escapeHtml(arg || '30 秒速览');
  return {
    html:
      '<section class="mdstudio-tldr"><p class="mdstudio-tldr-title"' +
      titleAttr +
      '>' +
      titleText +
      '</p>' +
      blocks(collected.body, ctx) +
      '</section>',
    next: collected.next,
  };
}

function shouldEmitImageCaption(caption: string): boolean {
  if (!caption || caption.length <= 1) return false;
  if (/^(?:image|img|photo|picture|screenshot|logo|mermaid diagram)$/i.test(caption)) return false;
  if (/^[\w.-]+\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(caption)) return false;
  return true;
}

function parseSpecialBlock(lines: string[], start: number, ctx: RenderContext): BlockResult | null {
  var line = lines[start];
  if (isFence(line)) return parseFence(lines, start);
  if (isMathBlockStart(line)) return parseMathBlock(lines, start);
  if (isScrollContainerStart(line)) return parseScrollContainer(lines, start, ctx);
  if (isEditorialContainerStart(line)) return parseEditorialContainer(lines, start, ctx);
  return null;
}

function renderHeadingHtml(level: number, titleHtml: string): string {
  return (
    '<h' +
    level +
    '><span class="mdstudio-heading-prefix"></span><span class="mdstudio-heading-content">' +
    titleHtml +
    '</span><span class="mdstudio-heading-suffix"></span></h' +
    level +
    '>'
  );
}

function parseParagraph(lines: string[], start: number, ctx: RenderContext): BlockResult {
  var paragraph = [lines[start].replace(/^[ \t]+|[ \t]+$/g, '')];
  var i = start + 1;
  while (i < lines.length) {
    var next = lines[i];
    if (/^\s*$/.test(next)) break;
    var setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(next);
    if (setext) {
      var level = setext[1].charAt(0) === '=' ? 1 : 2;
      return { html: renderHeadingHtml(level, renderInline(paragraph.join('\n'), ctx)), next: i + 1 };
    }
    if (isBlockStart(next, lines, i)) break;
    paragraph.push(next.replace(/^[ \t]+|[ \t]+$/g, ''));
    i++;
  }
  if (paragraph.length === 1) {
    var standaloneImg = parseStandaloneImageLine(paragraph[0], ctx);
    if (standaloneImg && shouldEmitImageCaption(standaloneImg.caption)) {
      return {
        html:
          '<p class="mdstudio-figure">' +
          renderInline(paragraph[0], ctx) +
          '</p><p class="mdstudio-caption">' +
          escapeHtml(standaloneImg.caption) +
          '</p>',
        next: i,
      };
    }
  }
  return { html: '<p>' + renderInline(paragraph.join('\n'), ctx) + '</p>', next: i };
}

function blocks(lines: string[], ctx: RenderContext): string {
  var out = '';
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    var special = parseSpecialBlock(lines, i, ctx);
    if (special) {
      out += special.html;
      i = special.next;
      continue;
    }

    var heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (heading) {
      var level = heading[1].length;
      var title = (heading[2] || '').replace(/[ \t]+#+[ \t]*$/, '');
      out += renderHeadingHtml(level, renderInline(title, ctx));
      i++;
      continue;
    }

    if (isHr(line)) {
      out += '<hr>';
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      var quote = parseBlockquote(lines, i, ctx);
      out += quote.html;
      i = quote.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      var table = renderTable(lines, i, ctx);
      out += table.html;
      i = table.next;
      continue;
    }

    if (isListLine(line)) {
      var list = parseList(lines, i, ctx);
      out += list.html;
      i = list.next;
      continue;
    }

    var para = parseParagraph(lines, i, ctx);
    out += para.html;
    i = para.next;
  }

  return out;
}

function parseLinkRefLine(line: string, linkDefs: Map<string, Destination>): boolean {
  const match = /^ {0,3}\[([^^\]\n][^\]]*)\]:[ \t]*(.+)$/.exec(line);
  if (!match) return false;
  const key = normalizeRefKey(match[1]);
  const dest = parseDestination(match[2]);
  if (!key || !dest.href) return false;
  if (!linkDefs.has(key)) linkDefs.set(key, dest);
  return true;
}

function extractDefinitions(text: string): {
  text: string;
  footnotes: Map<string, FootnoteDefinition>;
  linkDefs: Map<string, Destination>;
} {
  var lines = String(text || '').split('\n');
  var kept = [];
  var footnotes = new Map<string, FootnoteDefinition>();
  var linkDefs = new Map<string, Destination>();
  var current: FootnoteDefinition | null = null;
  var fenceState: FenceOpening | null = null;
  for (var index = 0; index < lines.length; index++) {
    var line = lines[index];
    var prevFence = fenceState;
    fenceState = stepFenceState(fenceState, line);
    if (prevFence || fenceState) {
      current = null;
      kept.push(line);
      continue;
    }
    var match = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
    if (match) {
      current = { id: match[1], text: match[2] };
      footnotes.set(match[1], current);
      continue;
    }
    if (current && /^(?: {2,}|\t)/.test(line) && line.trim()) {
      current.text += '\n' + line.replace(/^(?: {2,}|\t)+/, '');
      continue;
    }
    if (parseLinkRefLine(line, linkDefs)) {
      current = null;
      continue;
    }
    current = null;
    kept.push(line);
  }
  return { text: kept.join('\n'), footnotes, linkDefs };
}

function buildFrontmatterMetaHtml(meta: Record<string, string>, rawBody: string, locale?: 'zh' | 'en'): string {
  var custom = (meta.meta || '').trim();
  if (custom) return '<p class="mdstudio-meta">' + escapeHtml(custom) + '</p>';
  var category = (meta.category || '').trim();
  var showReadingTime = /^(?:true|1|yes)$/i.test((meta.readingTime || '').trim());
  if (!category && !showReadingTime) return '';
  var plain = rawBody
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`~[\]()!|-]/g, '')
    .replace(/\s+/g, '');
  var minutes = Math.max(1, Math.round(plain.length / 350));
  var timeLabel = locale === 'en' ? minutes + ' min read' : '约 ' + minutes + ' 分钟读完';
  var parts = category ? [category, timeLabel] : [timeLabel];
  return '<p class="mdstudio-meta">' + escapeHtml(parts.join(' · ')) + '</p>';
}

function findTopLevelH1Index(html: string): number {
  const tagRe = /<(\/?)(blockquote|section|h1)\b[^>]*>/gi;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    if (tag === 'h1') {
      if (!closing && depth === 0) return match.index;
    } else if (closing) {
      depth = Math.max(0, depth - 1);
    } else {
      depth++;
    }
  }
  return -1;
}

function injectFrontmatterMeta(html: string, metaHtml: string): string {
  if (!metaHtml || html.indexOf('class="mdstudio-meta"') !== -1) return html;
  var h1Index = findTopLevelH1Index(html);
  if (h1Index === -1) return metaHtml + html;
  return html.slice(0, h1Index) + metaHtml + html.slice(h1Index);
}

const RENDER_DEFAULTS_ZH = {
  footnotes: '脚注',
  references: '参考资料',
  scrollV: '上下滑动 ↕',
  scrollH: '左右滑动 ↔',
  refSep: '：',
};

const RENDER_DEFAULTS_EN = {
  footnotes: 'Footnotes',
  references: 'References',
  scrollV: 'Scroll ↕',
  scrollH: 'Swipe ↔',
  refSep: ': ',
};

function renderFootnotesHtml(ctx: RenderContext, title: string): string {
  if (!ctx.footnoteOrder.length) return '';
  var footnoteItems = '';
  for (var i = 0; i < ctx.footnoteOrder.length; i++) {
    var definition = ctx.footnotes.get(ctx.footnoteOrder[i]);
    if (!definition) continue;
    var num = i + 1;
    footnoteItems +=
      '<p class="mdstudio-footnote-item" id="mdstudio-fn-' +
      num +
      '">[' +
      num +
      '] ' +
      renderInline(definition.text, ctx) +
      '</p>';
  }
  return (
    '<section class="mdstudio-footnotes"><p class="mdstudio-footnotes-title">' +
    escapeHtml(title) +
    '</p>' +
    footnoteItems +
    '</section>'
  );
}

function renderReferencesHtml(refs: EngineReference[], title: string, sep: string): string {
  if (!refs.length) return '';
  var items = refs
    .map(function (ref, index) {
      var label = String(ref.label || '').trim();
      var url = String(ref.url || '').trim();
      var text = label && label !== url ? label + sep + url : url;
      return '<p class="mdstudio-ref-item">' + (index + 1) + '. ' + escapeHtml(text) + '</p>';
    })
    .join('');
  return (
    '<section class="mdstudio-references"><p class="mdstudio-refs-title">' +
    escapeHtml(title) +
    '</p>' +
    items +
    '</section>'
  );
}

function disambiguateFootnoteMarkers(html: string, ctx: RenderContext, locale?: 'zh' | 'en'): string {
  if (!ctx.footnoteOrder.length || !ctx.refs.length) return html;
  var prefix = locale === 'en' ? 'n' : '注';
  return html
    .replace(
      /<sup class="mdstudio-footnote-ref">\[(\d+)\]<\/sup>/g,
      '<sup class="mdstudio-footnote-ref">[' + prefix + '$1]</sup>',
    )
    .replace(/(<p class="mdstudio-footnote-item" id="mdstudio-fn-\d+">)\[(\d+)\]/g, '$1[' + prefix + '$2]');
}

export function renderMarkdown(source: unknown, options?: RenderOptions): RenderResult {
  var opts = options || {};
  var text = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  var meta: Record<string, string> = {};
  var frontmatter = parseFrontmatter(text);
  if (frontmatter) {
    meta = frontmatter.meta;
    text = frontmatter.rest;
  }
  var extracted = extractDefinitions(text);
  text = extracted.text;
  var defaults = opts.locale === 'en' ? RENDER_DEFAULTS_EN : RENDER_DEFAULTS_ZH;
  var footnotesTitle = opts.footnotesTitle || defaults.footnotes;
  var referencesTitle = opts.referencesTitle || defaults.references;
  var ctx: RenderContext = {
    refs: [],
    refIndex: new Map<string, number>(),
    linkDefs: extracted.linkDefs,
    footnotes: extracted.footnotes,
    footnoteNumbers: new Map<string, number>(),
    footnoteOrder: [],
    options: {
      linkFootnotes: opts.linkFootnotes !== false,
      footnotesTitle: footnotesTitle,
      scrollVerticalHint: opts.scrollVerticalHint || defaults.scrollV,
      scrollHorizontalHint: opts.scrollHorizontalHint || defaults.scrollH,
    },
  };
  var html = injectFrontmatterMeta(blocks(text.split('\n'), ctx), buildFrontmatterMetaHtml(meta, text, opts.locale));
  html += renderFootnotesHtml(ctx, footnotesTitle);
  html = disambiguateFootnoteMarkers(html, ctx, opts.locale);
  html += renderReferencesHtml(ctx.refs, referencesTitle, defaults.refSep);
  return { html: html, meta: meta, refs: ctx.refs };
}
