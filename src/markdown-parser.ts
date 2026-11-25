import { parseFrontmatterBlock } from './domain/article';
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
  childStripIndent?: number;
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
    if (
      text.charAt(pos) === '`' &&
      !isOddBackslashEscaped(text, pos) &&
      (pos === from || /[\s([\u2014\u2013-]/.test(text.charAt(pos - 1)))
    ) {
      let ticks = 1;
      while (text.charAt(pos + ticks) === '`') ticks++;
      const codeClose = findCodeSpanClose(text, pos + ticks, ticks);
      if (codeClose !== -1 && !(ticks === 2 && text.slice(pos + ticks, codeClose).includes("''"))) {
        pos = codeClose + ticks;
        continue;
      }
      pos += ticks;
      continue;
    }
    if (text.startsWith(delimiter, pos) && !isOddBackslashEscaped(text, pos)) {
      if (delimiter === '$' || delimiter === '$$') {
        const prevDollar = pos > from && text.charAt(pos - 1) === '$';
        const nextDollar = text.charAt(pos + delimiter.length) === '$';
        if (prevDollar || nextDollar) {
          while (pos < text.length && text.charAt(pos) === '$') pos++;
          continue;
        }
      }
      return pos;
    }
    pos++;
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
  if (/^[0-9]/.test(source) && !source.includes('\\')) {
    if (/[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/.test(source)) return true;
    if (/[(\-–—/]$/.test(source)) return true;
    if (/^\d[\d,.]*[)\s]/.test(source) && /[a-zA-Z]{2,}/.test(source) && !/[+=<>^_*/\\([{]/.test(source)) {
      return true;
    }
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
  const hashComments = language === 'py' || language === 'sh' || language === 'yaml' || language === 'toml';
  const re = hashComments
    ? /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d[\w.]*\b|[A-Za-z_$][\w$]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d[\w.]*\b|[A-Za-z_$][\w$]*)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const token = m[0];
    let kind = '';
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
      const after = code.slice(m.index + token.length);
      if (/^\s*\(/.test(after)) kind = 'function';
    }
    out += tokenSpan(kind, token);
    last = m.index + token.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

function highlightAttrs(source: string): string {
  const re = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
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
  const re = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?>)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
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
  const re =
    /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const token = m[0];
    let kind = 'number';
    if (/^\/\*/.test(token)) kind = 'comment';
    else if (/^["']/.test(token)) kind = 'string';
    out += tokenSpan(kind, token);
    last = m.index + token.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

export function highlightCode(code: string, language?: string): string {
  const lang = String(language || '').toLowerCase();
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
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*\*|___|\*\*|__|~~|==|\+\+)([\s\S]*?)\1/g, '$2')
    .replace(/(^|[\s(])([*_])([^\s*_][\s\S]*?)\2(?=$|[\s).,;:!?])/g, '$1$3')
    .trim();
}

function addReference(ctx: RenderContext, label: string, href: string): number {
  const existing = ctx.refIndex.get(href);
  if (existing) return existing;
  const index = ctx.refs.length + 1;
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
  const index = addReference(ctx, labelText, href);
  return '<span class="mdstudio-link">' + labelHtml + '<sup class="mdstudio-ref">[' + index + ']</sup></span>';
}

function unescapeLinkDest(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function findUnescapedAngleClose(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '>') return i;
  }
  return -1;
}

const LINK_DEST_PUNCT_RE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;

function splitUnescapedHref(dest: string): { rawHref: string; rawTitle: string } {
  for (let i = 0; i < dest.length; i++) {
    if (dest[i] === '\\' && i + 1 < dest.length && LINK_DEST_PUNCT_RE.test(dest[i + 1])) {
      i++;
      continue;
    }
    if (/\s/.test(dest[i])) {
      return { rawHref: dest.slice(0, i), rawTitle: dest.slice(i).trim() };
    }
  }
  return { rawHref: dest, rawTitle: '' };
}

function parseDestination(raw: string): Destination {
  const dest = String(raw || '').trim();
  let href = '';
  let title = '';
  if (dest.charAt(0) === '<') {
    const close = findUnescapedAngleClose(dest, 1);
    if (close !== -1) {
      href = unescapeLinkDest(dest.slice(1, close));
      const rest = dest.slice(close + 1).trim();
      title = unescapeLinkDest(stripQuotes(rest));
    }
  } else if (dest) {
    const split = splitUnescapedHref(dest);
    href = unescapeLinkDest(split.rawHref);
    title = unescapeLinkDest(stripQuotes(split.rawTitle));
  }
  return { href: href, title: title };
}

function stripQuotes(value: string): string {
  if (!value) return '';
  const m = /^"([\s\S]*)"$|^'([\s\S]*)'$|^\(([\s\S]*)\)$/.exec(value);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : value;
}

function findMatching(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  let inAngle = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
    if (inAngle) {
      if (ch === '>' || ch === '\n') inAngle = false;
      continue;
    }
    if (ch === '<' && open === '(' && depth === 1 && text.slice(start + 1, i).trim() === '') {
      inAngle = true;
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

function buildBracketMatchMap(text: string): Map<number, number> {
  const matches = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const jumped = skipCodeOrMath(text, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') stack.push(i);
    else if (ch === ']' && stack.length > 0) {
      matches.set(stack.pop()!, i);
    }
  }
  return matches;
}

function findLinkBracketEnd(text: string, start: number, bracketMap?: Map<number, number>): number {
  if (text.charAt(start) !== '[') return -1;
  if (bracketMap) return bracketMap.get(start) ?? -1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const jumped = skipCodeOrMath(text, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    const ch = text[i];
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

function parseLinkAt(text: string, start: number, bracketMap?: Map<number, number>): LinkMatch | null {
  const end = findLinkBracketEnd(text, start, bracketMap);
  if (end === -1 || text.charAt(end + 1) !== '(') return null;
  const close = findMatching(text, end + 1, '(', ')');
  if (close === -1) return null;
  const dest = parseDestination(text.slice(end + 2, close));
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

function parseRefLinkAt(
  text: string,
  start: number,
  linkDefs: Map<string, Destination>,
  bracketMap?: Map<number, number>,
): LinkMatch | null {
  const end = findLinkBracketEnd(text, start, bracketMap);
  if (end === -1 || !linkDefs.size) return null;
  const label = text.slice(start + 1, end);
  if (text.charAt(end + 1) === '[') {
    const refEnd = findLinkBracketEnd(text, end + 1, bracketMap);
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
  if (before === ch && !isOddBackslashEscaped(text, index - 1)) return false;
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

const AUTO_LINK_STICKY_RE = /<((?:https?:\/\/|mailto:)[^>\s]+)>/iy;
const BARE_URL_STICKY_RE = /(https?:\/\/[^\s<>"'\u2018-\u201f\u2014\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+)/iy;
const ENTITY_STICKY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,15}));/y;
const FOOTNOTE_STICKY_RE = /\[\^([^\]\s]+)\]/y;

function hasEvenRemainingDelimiters(text: string, from: number, delimiter: string): boolean {
  let count = 0;
  let pos = from;
  while (pos < text.length) {
    const found = text.indexOf(delimiter, pos);
    if (found === -1) break;
    count++;
    pos = found + delimiter.length;
  }
  return count % 2 === 0;
}

function skipAutoOrBareLink(text: string, i: number, delimiter: string): number {
  const ch = text.charAt(i);
  if (ch === '<') {
    AUTO_LINK_STICKY_RE.lastIndex = i;
    const auto = AUTO_LINK_STICKY_RE.exec(text);
    return auto ? i + auto[0].length - 1 : i;
  }
  if ((ch === 'h' || ch === 'H') && (i === 0 || !/[A-Za-z0-9/@._\-=]/.test(text.charAt(i - 1)))) {
    BARE_URL_STICKY_RE.lastIndex = i;
    const bare = BARE_URL_STICKY_RE.exec(text);
    if (bare) {
      let url = trimBareUrl(bare[1]);
      if (
        (delimiter === '==' || delimiter === '++') &&
        url.endsWith(delimiter) &&
        hasEvenRemainingDelimiters(text, i + url.length, delimiter)
      ) {
        url = url.slice(0, -delimiter.length);
      }
      if (/^https?:\/\/\S/i.test(url)) return i + url.length - 1;
    }
  }
  return i;
}

function skipInlineLinkOrImage(
  text: string,
  i: number,
  delimiter: string,
  inLink: boolean,
  bracketMap?: Map<number, number>,
): number {
  if (inLink) return i;
  const ch = text.charAt(i);
  const start = ch === '!' && text.charAt(i + 1) === '[' ? i + 1 : ch === '[' ? i : -1;
  if (start === -1) return skipAutoOrBareLink(text, i, delimiter);
  const link = parseLinkAt(text, start, bracketMap);
  return link ? link.end - 1 : i;
}

function findClosingDelimiter(
  text: string,
  from: number,
  delimiter: string,
  failedCache?: Set<string>,
  inLink = false,
  bracketMap?: Map<number, number>,
): number {
  const ch = delimiter.charAt(0);
  const len = delimiter.length;
  const trackNested = (ch === '*' || ch === '_') && len < 3;
  const openedInsideTriple = trackNested && text.charAt(from) === ch;
  const cacheKey = (inLink ? 'L:' : '') + (openedInsideTriple ? 'T:' : '') + delimiter;
  if (failedCache?.has(cacheKey)) return -1;
  const state: EmphasisScanState = { complementOpen: false, tripleDepth: 0, fallbackTriple: -1 };
  let sawAnyCloseCandidate = false;
  for (let i = from; i <= text.length - len; i++) {
    const jumped = skipCodeOrMath(text, i);
    if (jumped > i) {
      i = jumped;
      continue;
    }
    const linkEnd = skipInlineLinkOrImage(text, i, delimiter, inLink, bracketMap);
    if (linkEnd > i) {
      i = linkEnd;
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
      sawAnyCloseCandidate = true;
      if (openedInsideTriple && state.complementOpen) return -1;
      return i;
    }
    if (trackNested) {
      if (runLen === 3 && i > from && !/\s/.test(text.charAt(i - 1))) sawAnyCloseCandidate = true;
      const matched = stepStarOrUnderRun(text, from, i, ch, len, runLen, state);
      if (matched !== -1) return matched;
    }
    i += runLen - 1;
  }
  if (state.fallbackTriple === -1 && !sawAnyCloseCandidate) {
    failedCache?.add(cacheKey);
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
  ENTITY_STICKY_RE.lastIndex = index;
  const match = ENTITY_STICKY_RE.exec(text);
  if (!match) return null;
  if (match[1] || match[2]) {
    const cp = match[1] ? parseInt(match[1], 10) : parseInt(match[2], 16);
    return { html: escapeHtml(decodeCodePoint(cp)), next: index + match[0].length };
  }
  const named = Object.hasOwn(NAMED_ENTITIES, match[3]) ? NAMED_ENTITIES[match[3]] : undefined;
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
  const display = text.charAt(index + 1) === '$';
  if (display && text.charAt(index + 2) === '$') return null;
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

function inlineImage(
  text: string,
  index: number,
  ctx?: RenderContext,
  bracketMap?: Map<number, number>,
): InlineToken | null {
  if (text.charAt(index) !== '!' || text.charAt(index + 1) !== '[') return null;
  const image =
    parseLinkAt(text, index + 1, bracketMap) ||
    (ctx ? parseRefLinkAt(text, index + 1, ctx.linkDefs, bracketMap) : null);
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
  FOOTNOTE_STICKY_RE.lastIndex = index;
  const footnote = FOOTNOTE_STICKY_RE.exec(text);
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

function inlineLink(
  text: string,
  index: number,
  ctx: RenderContext,
  failedBrackets?: Set<string>,
  bracketMap?: Map<number, number>,
): InlineToken | null {
  if (text.charAt(index) !== '[') return null;
  const footnote = inlineFootnote(text, index, ctx);
  if (footnote) return footnote;
  if (ctx.inLink || failedBrackets?.has('[')) return null;
  const link = parseLinkAt(text, index, bracketMap) || parseRefLinkAt(text, index, ctx.linkDefs, bracketMap);
  if (!link) {
    if (!bracketMap && text.indexOf(']', index + 1) === -1) failedBrackets?.add('[');
    return null;
  }
  const label = normalizeLabel(link.label);
  const hideUrlLabel =
    /^https?:\/\/\S+$/i.test(label) &&
    label.toLowerCase() === link.href.toLowerCase() &&
    ctx.options.linkFootnotes &&
    isExternalHref(link.href);
  ctx.inLink = true;
  const innerHtml = hideUrlLabel ? '' : renderInline(link.label, ctx);
  ctx.inLink = false;
  return {
    html: renderLink(ctx, innerHtml, label, link.href, link.title),
    next: link.end,
  };
}

function inlineAutoLink(text: string, index: number, ctx: RenderContext): InlineToken | null {
  if (ctx.inLink || text.charAt(index) !== '<') return null;
  AUTO_LINK_STICKY_RE.lastIndex = index;
  const auto = AUTO_LINK_STICKY_RE.exec(text);
  if (!auto) return null;
  const label = auto[1].replace(/^mailto:/i, '');
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
    if (/[?!.,:*_~;'"\u2018\u2019\u201c\u201d\u2014，。！？；：、》」』】]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' || last === ']') {
      const openCh = last === ')' ? '(' : '[';
      const opens = url.split(openCh).length - 1;
      const closes = url.split(last).length - 1;
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
  if (ctx.inLink) return null;
  const ch = text.charAt(index);
  if (ch !== 'h' && ch !== 'H') return null;
  if (index !== 0 && /[A-Za-z0-9/@._\-=]/.test(text.charAt(index - 1))) return null;
  BARE_URL_STICKY_RE.lastIndex = index;
  const bare = BARE_URL_STICKY_RE.exec(text);
  if (!bare) return null;
  const url = trimBareUrl(bare[1]);
  if (!/^https?:\/\/\S/i.test(url)) return null;
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

function inlineEmphasis(
  text: string,
  index: number,
  ctx: RenderContext,
  failedCache?: Set<string>,
  bracketMap?: Map<number, number>,
): InlineToken | null {
  for (let s = 0; s < EMPHASIS_SPECS.length; s++) {
    const spec = EMPHASIS_SPECS[s];
    if (!text.startsWith(spec.delim, index) || !canOpenEmphasis(text, index, spec.delim)) continue;
    const end = findClosingDelimiter(text, index + spec.delim.length, spec.delim, failedCache, ctx.inLink, bracketMap);
    if (end !== -1) {
      return {
        html: spec.open + renderInline(text.slice(index + spec.delim.length, end), ctx) + spec.close,
        next: end + spec.delim.length,
      };
    }
  }
  return null;
}

function inlineTokenAt(
  text: string,
  index: number,
  ctx: RenderContext,
  failedCache?: Set<string>,
  bracketMap?: Map<number, number>,
): InlineToken | null {
  return (
    inlineEntity(text, index) ||
    inlineMath(text, index) ||
    inlineCode(text, index) ||
    inlineImage(text, index, ctx, bracketMap) ||
    inlineLink(text, index, ctx, failedCache, bracketMap) ||
    inlineAutoLink(text, index, ctx) ||
    inlineBareLink(text, index, ctx) ||
    inlineEmphasis(text, index, ctx, failedCache, bracketMap)
  );
}

function renderInline(text: string, ctx: RenderContext): string {
  let out = '';
  let buffer = '';
  let i = 0;
  const failedCache = new Set<string>();
  const bracketMap = text.includes('[') ? buildBracketMatchMap(text) : undefined;
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
    const token = inlineTokenAt(text, i, ctx, failedCache, bracketMap);
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
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line) || /^\s*\|\s*:?-{1,}:?\s*\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const head = lines[index];
  const sep = lines[index + 1];
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
  let row = String(line || '').trim();
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
  const header = splitTableRow(lines[start]);
  const divider = splitTableRow(lines[start + 1]);
  const align = divider.map(function (cell) {
    const value = cell.replace(/\s/g, '');
    if (/^:-+:$/.test(value)) return 'center';
    if (/^-+:$/.test(value)) return 'right';
    if (/^:-+$/.test(value)) return 'left';
    return '';
  });
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1 && !isTableInterrupt(lines[i])) {
    rows.push(splitTableRow(lines[i]));
    i++;
  }
  function cell(tag: string, content: string, index: number): string {
    const style = align[index] ? ' style="text-align:' + align[index] + '"' : '';
    return '<' + tag + style + '>' + renderInline(content, ctx) + '</' + tag + '>';
  }
  let html = '<table><thead><tr>';
  header.forEach(function (value, index) {
    html += cell('th', value, index);
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function (row) {
    html += '<tr>';
    for (let c = 0; c < header.length; c++) html += cell('td', row[c] || '', c);
    html += '</tr>';
  });
  html += '</tbody></table>';
  return { html: html, next: i };
}

function listMarkerMatches(line: string, match: RegExpExecArray | null, indent: number, ordered: boolean): boolean {
  if (!match || isHr(line)) return false;
  return leadingColumns(match[1]) === indent && /\d/.test(match[2]) === ordered;
}

function parseTaskLine(raw: string): { text: string; checked: boolean | null } {
  const task = /^\[([ xX])\](?:[ \t]+([\s\S]*)|[ \t]*)$/.exec(raw);
  if (!task) return { text: raw, checked: null };
  return { text: task[2] || '', checked: task[1].toLowerCase() === 'x' };
}

function formatTaskItem(rawInner: string, checked: boolean, loose: boolean): string {
  const box = checked
    ? '<span class="mdstudio-task-box is-checked">✓</span>'
    : '<span class="mdstudio-task-box">\u00a0</span>';
  const leading = /^<p>([\s\S]*?)<\/p>/.exec(rawInner);
  if (leading) {
    const inlineText = leading[1] ? '<span class="mdstudio-task-text">' + leading[1] + '</span>' : '';
    const rest = rawInner.slice(leading[0].length);
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
  const allTasks =
    !ordered &&
    items.length > 0 &&
    items.every(function (item) {
      return item.checked !== null;
    });
  let html = ordered
    ? '<ol' + (startNumber !== 1 ? ' start="' + startNumber + '"' : '') + '>'
    : '<ul' + (allTasks ? ' class="mdstudio-task-list"' : '') + '>';
  items.forEach(function (item) {
    const rawInner = blocks(item.lines, ctx);
    if (item.checked !== null) {
      const taskClass = item.checked ? ' class="mdstudio-task is-checked"' : ' class="mdstudio-task"';
      html += '<li' + taskClass + '>' + formatTaskItem(rawInner, item.checked, loose) + '</li>';
      return;
    }
    let inner = rawInner;
    if (!loose) {
      const leading = /^<p>([\s\S]*?)<\/p>/.exec(inner);
      if (leading) inner = leading[1] + inner.slice(leading[0].length);
    }
    html += '<li>' + inner + '</li>';
  });
  return html + (ordered ? '</ol>' : '</ul>');
}

function leadingColumns(line: string): number {
  let cols = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === ' ') cols++;
    else if (ch === '\t') cols += 4 - (cols % 4);
    else break;
  }
  return cols;
}

function stripLeadingColumns(line: string, count: number): string {
  let cols = 0;
  let i = 0;
  while (i < line.length && cols < count) {
    const ch = line.charAt(i);
    if (ch === ' ') {
      cols++;
      i++;
    } else if (ch === '\t') {
      const step = 4 - (cols % 4);
      if (cols + step > count) return ' '.repeat(cols + step - count) + line.slice(i + 1);
      cols += step;
      i++;
    } else {
      break;
    }
  }
  return line.slice(i);
}

function listItemEndsInOpenParagraph(content: string[]): boolean {
  let fence: FenceOpening | null = null;
  let lastWasClosedFence = false;
  for (let idx = 0; idx < content.length; idx++) {
    const prevFence = fence;
    fence = stepFenceState(fence, content[idx]);
    lastWasClosedFence = Boolean(prevFence && !fence);
  }
  if (fence || lastWasClosedFence) return false;
  const last = content[content.length - 1] || '';
  if (!last.trim()) return false;
  if (/^ {0,3}#{1,6}(?:\s|$)/.test(last)) return false;
  if (/^ {0,3}(?:\$\$|:::+|\\\])$/.test(last.trim())) return false;
  if (isHr(last)) return false;
  return true;
}

function appendListContinuationLine(
  line: string,
  lines: string[],
  i: number,
  match: RegExpExecArray | null,
  baseIndent: number,
  ordered: boolean,
  current: ListItem,
): boolean {
  const indent = leadingColumns(line);
  if (listMarkerMatches(line, match, baseIndent, !ordered)) return false;
  if (match && leadingColumns(match[1]) < baseIndent) return false;
  if (indent >= current.indent) {
    const stripCols =
      current.childStripIndent !== undefined ? Math.min(current.indent, current.childStripIndent) : current.indent;
    current.lines.push(stripLeadingColumns(line, stripCols));
    return true;
  }
  if (indent > baseIndent && (Boolean(match) || !isBlockStart(line, lines, i))) {
    if (match && current.childStripIndent === undefined) current.childStripIndent = indent;
    current.lines.push(stripLeadingColumns(line, indent));
    return true;
  }
  if (
    !match &&
    !isBlockStart(line, lines, i) &&
    !/^ {0,3}(?:=+|-+)[ \t]*$/.test(line) &&
    listItemEndsInOpenParagraph(current.lines)
  ) {
    current.childStripIndent = undefined;
    current.lines.push(line);
    return true;
  }
  return false;
}

function parseList(lines: string[], start: number, ctx: RenderContext): BlockResult {
  const marker = /^(\s*)([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
  const first = marker.exec(lines[start]);
  if (!first) return { html: '', next: start + 1 };
  const baseIndent = leadingColumns(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNumber = ordered ? parseInt(first[2], 10) : 1;
  const items: ListItem[] = [];
  let current: ListItem | null = null;
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const match = marker.exec(line);
    if (listMarkerMatches(line, match, baseIndent, ordered)) {
      if (current) items.push(current);
      const itemMatch = match as RegExpExecArray;
      const task = ordered ? { text: itemMatch[3] || '', checked: null } : parseTaskLine(itemMatch[3] || '');
      current = {
        lines: [task.text],
        checked: task.checked,
        indent: leadingColumns(itemMatch[1]) + itemMatch[2].length + 1,
      };
      i++;
      continue;
    }

    if (!current) break;

    if (/^\s*$/.test(line)) {
      let nextIndex = i + 1;
      while (nextIndex < lines.length && /^\s*$/.test(lines[nextIndex])) nextIndex++;
      if (nextIndex >= lines.length) {
        i = nextIndex;
        break;
      }
      const nextLine = lines[nextIndex];
      const nextMatch = marker.exec(nextLine);
      const nextIndent = leadingColumns(nextLine);
      const sibling = listMarkerMatches(nextLine, nextMatch, baseIndent, ordered);
      const minChildIndent = current.childStripIndent ?? current.indent;
      if (sibling || nextIndent >= minChildIndent) {
        current.lines.push('');
        loose = true;
        i = nextIndex;
        continue;
      }
      i = nextIndex;
      break;
    }

    if (appendListContinuationLine(line, lines, i, match, baseIndent, ordered, current)) {
      i++;
      continue;
    }
    break;
  }
  if (current) items.push(current);
  return { html: renderListHtml(items, ordered, startNumber, loose, ctx), next: i };
}

function parseFence(lines: string[], start: number): BlockResult {
  const opening = parseFenceOpening(lines[start]);
  if (!opening) return { html: '', next: start + 1 };
  const content = [];
  let i = start + 1;
  const closing = new RegExp('^ {0,3}' + opening.fenceChar + '{' + opening.fenceLength + ',}\\s*$');
  while (i < lines.length) {
    const line = lines[i];
    if (closing.test(line)) {
      i++;
      break;
    }
    content.push(line);
    i++;
  }
  const raw = content.join('\n');
  const body = highlightCode(raw, opening.language) || '';
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

function quoteEndsInOpenParagraph(content: string[]): boolean {
  let fence: FenceOpening | null = null;
  let lastWasClosedFence = false;
  for (let idx = 0; idx < content.length; idx++) {
    const prevFence = fence;
    fence = stepFenceState(fence, content[idx]);
    lastWasClosedFence = Boolean(prevFence && !fence);
  }
  if (fence || lastWasClosedFence) return false;
  const last = content[content.length - 1] || '';
  if (!last.trim()) return false;
  if (/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])(?:\s|$))/.test(last)) return false;
  if (/^ {0,3}(?:\$\$|:::+|\\\])$/.test(last.trim())) return false;
  if (isHr(last) || last.includes('|')) return false;
  return true;
}

function isQuoteLazyContinuation(
  isAlertBlock: boolean,
  content: string[],
  line: string,
  lines: string[],
  index: number,
): boolean {
  if (isAlertBlock || !content.length || !quoteEndsInOpenParagraph(content)) return false;
  if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) return false;
  return !isBlockStart(line, lines, index);
}

function parseBlockquote(lines: string[], start: number, ctx: RenderContext): BlockResult {
  const content: string[] = [];
  const isAlertBlock = ALERT_MARKER_RE.test(lines[start] || '');
  let fenceState: FenceOpening | null = null;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (/^ {0,3}>/.test(line)) {
      if (!fenceState && i > start && ALERT_MARKER_RE.test(line)) break;
      const stripped = line.replace(/^ {0,3}> ?/, '');
      fenceState = stepFenceState(fenceState, stripped);
      content.push(stripped);
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      // Plain quotes merge across a single blank line; alerts stay independent blocks.
      const nextIndex = i + 1;
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
      const trimmed = line.replace(/^[ \t]+|[ \t]+$/g, '');
      fenceState = stepFenceState(fenceState, trimmed);
      content.push(trimmed);
      i++;
      continue;
    }
    break;
  }

  let alert = null;
  let inlineTitle = '';
  if (content.length) {
    const firstLine = content[0];
    const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+(.*)|[ \t]*)$/i.exec(firstLine);
    if (alertMatch) {
      alert = alertMatch[1].toUpperCase();
      inlineTitle = (alertMatch[2] || '').trim();
      content.shift();
    }
  }

  if (alert) {
    const def = ALERT_DEFS[alert];
    const title = inlineTitle || def.label;
    const body = blocks(content, ctx);
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
  const body: string[] = [];
  let fenceState: FenceOpening | null = null;
  let depth = 0;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
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
  const trimmed = line.trim();
  if (trimmed.charAt(0) !== '!' || trimmed.charAt(1) !== '[') return null;
  const parsed = parseLinkAt(trimmed, 1) || (ctx ? parseRefLinkAt(trimmed, 1, ctx.linkDefs) : null);
  if (!parsed || parsed.end !== trimmed.length) return null;
  const token = inlineImage(trimmed, 0, ctx);
  if (!token || token.html.indexOf('<img ') !== 0) return null;
  return { html: token.html, caption: parsed.label.trim() };
}

function stepDirectiveDepth(depth: number, line: string): number {
  if (/^ {0,3}:::\s*$/.test(line)) return Math.max(0, depth - 1);
  if (isBlockDirectiveStart(line)) return depth + 1;
  return depth;
}

function splitSlideGroups(body: string[], splitOnBlank: boolean): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let fenceState: FenceOpening | null = null;
  let directiveDepth = 0;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    fenceState = stepFenceState(fenceState, line);
    const isSep = !fenceState && directiveDepth === 0 && (splitOnBlank ? /^\s*$/.test(line) : isHr(line));
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
  let fenceState: FenceOpening | null = null;
  let directiveDepth = 0;
  for (let i = 0; i < body.length; i++) {
    const prevFence = fenceState;
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
  const nonEmpty = body.filter(function (line) {
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
  const nonEmpty = slide.filter(function (line) {
    return line.trim().length > 0;
  });
  const standalone = nonEmpty.length === 1 ? parseStandaloneImageLine(nonEmpty[0], ctx) : null;
  if (standalone) {
    const captionHtml = standalone.caption
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
  const match = /^ {0,3}:::scroll(-x)?(?:[ \t]+(\d{2,3})(?:px)?)?[ \t]*$/i.exec(lines[start]);
  if (!match) return { html: '', next: start + 1 };
  const isHorizontal = !!match[1];
  const collected = collectScrollBody(lines, start + 1);
  if (isHorizontal) {
    const slides = splitHorizontalSlides(collected.body, ctx);
    const trackInner = slides
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
  const customHeight = match[2] ? Math.min(560, Math.max(120, Number(match[2]))) : 0;
  const styleAttr = customHeight ? ' style="max-height: ' + customHeight + 'px;"' : '';
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
  const parsed = parseFrontmatterBlock(text);
  return parsed ? { meta: parsed.meta, rest: parsed.body } : null;
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
  const single = singleRe.exec(lines[start]);
  if (single && single[1].trim() && single[1].indexOf(closeToken) === -1) {
    const closeIdx = lines[start].lastIndexOf(closeToken);
    if (closeIdx > 0 && !isOddBackslashEscaped(lines[start], closeIdx)) {
      return { html: renderDisplayMathHtml(single[1].trim()), next: start + 1 };
    }
  }
  const open = openRe.exec(lines[start]);
  if (!open || open[1].indexOf(closeToken) !== -1) return null;
  const body: string[] = open[1] ? [open[1]] : [];
  for (let i = start + 1; i < lines.length; i++) {
    const close = closeRe.exec(lines[i]);
    if (close && !isOddBackslashEscaped(lines[i], close[1].length)) {
      if (close[1].trim()) body.push(close[1]);
      const tex = body.join('\n').trim();
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
  const collected = collectScrollBody(lines, start + 1);
  return {
    html: '<p class="' + className + '">' + renderInlineLinesJoined(collected.body, sep, ctx) + '</p>',
    next: collected.next,
  };
}

function renderPullEditorial(arg: string, lines: string[], start: number, ctx: RenderContext): BlockResult {
  if (arg) {
    return { html: '<section class="mdstudio-pull">' + renderInline(arg, ctx) + '</section>', next: start + 1 };
  }
  const collected = collectScrollBody(lines, start + 1);
  const inner = blocks(collected.body, ctx);
  const singlePara = /^<p>((?:(?!<\/p>)[\s\S])*)<\/p>$/.exec(inner);
  const pullBody = singlePara ? singlePara[1] : inner;
  return { html: '<section class="mdstudio-pull">' + pullBody + '</section>', next: collected.next };
}

function parseEditorialContainer(lines: string[], start: number, ctx: RenderContext): BlockResult {
  const match = /^ {0,3}:::(lead|tldr|pull|sign|meta)(?:[ \t]+(.*?))?[ \t]*$/i.exec(lines[start]);
  if (!match) return { html: '', next: start + 1 };
  const kind = match[1].toLowerCase();
  const arg = (match[2] || '').trim();
  if (kind === 'lead') return renderSimpleEditorial('mdstudio-lead', arg, lines, start, '<br>', ctx);
  if (kind === 'sign') return renderSimpleEditorial('mdstudio-sign', arg, lines, start, '<br>', ctx);
  if (kind === 'meta') return renderSimpleEditorial('mdstudio-meta', arg, lines, start, ' · ', ctx);
  if (kind === 'pull') return renderPullEditorial(arg, lines, start, ctx);
  const collected = collectScrollBody(lines, start + 1);
  const titleAttr = arg ? '' : ' data-mdstudio-default-tldr="1"';
  const titleText = escapeHtml(arg || '30 秒速览');
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
  const line = lines[start];
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
  const paragraph = [lines[start].replace(/^[ \t]+|[ \t]+$/g, '')];
  let i = start + 1;
  while (i < lines.length) {
    const next = lines[i];
    if (/^\s*$/.test(next)) break;
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(next);
    if (setext) {
      const level = setext[1].charAt(0) === '=' ? 1 : 2;
      return { html: renderHeadingHtml(level, renderInline(paragraph.join('\n'), ctx)), next: i + 1 };
    }
    if (isBlockStart(next, lines, i)) break;
    paragraph.push(next.replace(/^[ \t]+|[ \t]+$/g, ''));
    i++;
  }
  if (paragraph.length === 1) {
    const standaloneImg = parseStandaloneImageLine(paragraph[0], ctx);
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
  let out = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const special = parseSpecialBlock(lines, i, ctx);
    if (special) {
      out += special.html;
      i = special.next;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = (heading[2] || '').replace(/[ \t]+#+[ \t]*$/, '');
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
      const quote = parseBlockquote(lines, i, ctx);
      out += quote.html;
      i = quote.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i, ctx);
      out += table.html;
      i = table.next;
      continue;
    }

    if (isListLine(line)) {
      const list = parseList(lines, i, ctx);
      out += list.html;
      i = list.next;
      continue;
    }

    const para = parseParagraph(lines, i, ctx);
    out += para.html;
    i = para.next;
  }

  return out;
}

function parseStrictDelimitedTitle(rest: string): string | null {
  if (!rest) return '';
  const m = /^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\(((?:\\.|[^()\\])*)\))$/.exec(rest);
  if (!m) return null;
  return unescapeLinkDest(m[1] ?? m[2] ?? m[3] ?? '');
}

function isPlausibleLinkRefHref(href: string, angleBracketed: boolean): boolean {
  if (!href) return false;
  if (angleBracketed) return true;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\.{1,2}\/|#|\?)/i.test(href)) return true;
  if (/^\d+(?:\.\d+)+$/.test(href)) return false;
  return (
    /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(href) &&
    (href.includes('/') || (href.includes('.') && /[A-Za-z]/.test(href)))
  );
}

function parseLinkRefDestination(raw: string): Destination | null {
  const dest = String(raw || '').trim();
  if (!dest) return null;
  if (dest.charAt(0) === '<') {
    const close = findUnescapedAngleClose(dest, 1);
    if (close === -1) return null;
    const href = unescapeLinkDest(dest.slice(1, close));
    const title = parseStrictDelimitedTitle(dest.slice(close + 1).trim());
    if (!href || title === null) return null;
    return { href, title };
  }
  const split = /^(\S+)(?:[ \t]+([\s\S]+))?$/.exec(dest);
  if (!split) return null;
  const href = unescapeLinkDest(split[1]);
  if (!isPlausibleLinkRefHref(href, false)) return null;
  const title = parseStrictDelimitedTitle((split[2] || '').trim());
  if (title === null) return null;
  return { href, title };
}

function stepMathBlockState(active: '$$' | '\\[' | null, line: string): '$$' | '\\[' | null {
  const trimmed = line.trim();
  if (!active) {
    if (trimmed === '$$') return '$$';
    if (trimmed === '\\[') return '\\[';
    return null;
  }
  if (active === '$$' && trimmed === '$$') return null;
  if (active === '\\[' && trimmed === '\\]') return null;
  return active;
}

function parseLinkRefLine(line: string, linkDefs: Map<string, Destination>): boolean {
  const match = /^ {0,3}\[([^^\]\n][^\]]*)\]:[ \t]*(.+)$/.exec(line);
  if (!match) return false;
  const key = normalizeRefKey(match[1]);
  const dest = parseLinkRefDestination(match[2]);
  if (!key || !dest) return false;
  if (!linkDefs.has(key)) linkDefs.set(key, dest);
  return true;
}

function extractDefinitions(text: string): {
  text: string;
  footnotes: Map<string, FootnoteDefinition>;
  linkDefs: Map<string, Destination>;
} {
  const lines = String(text || '').split('\n');
  const kept = [];
  const footnotes = new Map<string, FootnoteDefinition>();
  const linkDefs = new Map<string, Destination>();
  let current: FootnoteDefinition | null = null;
  let fenceState: FenceOpening | null = null;
  let mathBlock: '$$' | '\\[' | null = null;
  let canStartLinkDef = true;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const prevFence = fenceState;
    fenceState = stepFenceState(fenceState, line);
    if (prevFence || fenceState) {
      current = null;
      canStartLinkDef = !fenceState;
      kept.push(line);
      continue;
    }
    const prevMath = mathBlock;
    mathBlock = stepMathBlockState(mathBlock, line);
    if (prevMath || mathBlock) {
      current = null;
      canStartLinkDef = !mathBlock;
      kept.push(line);
      continue;
    }
    const match = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
    if (match) {
      current = { id: match[1], text: match[2] };
      footnotes.set(match[1], current);
      canStartLinkDef = true;
      continue;
    }
    if (current && /^(?: {2,}|\t)/.test(line) && line.trim()) {
      const stripped = line.replace(/^(?: {2,}|\t)+/, '');
      current.text = current.text ? current.text + '\n' + stripped : stripped;
      continue;
    }
    if (
      current &&
      !line.trim() &&
      index + 1 < lines.length &&
      /^(?: {2,}|\t)/.test(lines[index + 1]) &&
      lines[index + 1].trim()
    ) {
      continue;
    }
    if (canStartLinkDef && parseLinkRefLine(line, linkDefs)) {
      current = null;
      canStartLinkDef = true;
      continue;
    }
    current = null;
    canStartLinkDef = !line.trim() || /^ {0,3}(?:#{1,6}(?:\s|$)|>)/.test(line) || isHr(line);
    kept.push(line);
  }
  return { text: kept.join('\n'), footnotes, linkDefs };
}

function buildFrontmatterMetaHtml(meta: Record<string, string>, rawBody: string, locale?: 'zh' | 'en'): string {
  const custom = (meta.meta || '').trim();
  if (custom) return '<p class="mdstudio-meta">' + escapeHtml(custom) + '</p>';
  const category = (meta.category || '').trim();
  const rawReadingTime = (meta.readingTime || '').trim();
  const hideReadingTime = /^(?:false|0|no)$/i.test(rawReadingTime);
  const showReadingTime = /^(?:true|1|yes)$/i.test(rawReadingTime);
  if (!category && !showReadingTime) return '';
  const plain = rawBody
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`~[\]()!|-]/g, '')
    .replace(/\s+/g, '');
  const minutes = Math.max(1, Math.round(plain.length / 350));
  const timeLabel = locale === 'en' ? minutes + ' min read' : '约 ' + minutes + ' 分钟读完';
  const parts: string[] = [];
  if (category) parts.push(category);
  if (showReadingTime || (category && !hideReadingTime)) parts.push(timeLabel);
  return '<p class="mdstudio-meta">' + escapeHtml(parts.join(' · ')) + '</p>';
}

function findTopLevelH1Index(html: string): number {
  const tagRe = /<(\/?)(blockquote|section|ul|ol|li|table|h1)\b[^>]*>/gi;
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
  const h1Index = findTopLevelH1Index(html);
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
  let footnoteItems = '';
  for (let i = 0; i < ctx.footnoteOrder.length; i++) {
    const definition = ctx.footnotes.get(ctx.footnoteOrder[i]);
    if (!definition) continue;
    const num = i + 1;
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
  const items = refs
    .map(function (ref, index) {
      const label = String(ref.label || '').trim();
      const url = String(ref.url || '').trim();
      const text = label && label !== url ? label + sep + url : url;
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
  const prefix = locale === 'en' ? 'n' : '注';
  return html
    .replace(
      /<sup class="mdstudio-footnote-ref">\[(\d+)\]<\/sup>/g,
      '<sup class="mdstudio-footnote-ref">[' + prefix + '$1]</sup>',
    )
    .replace(/(<p class="mdstudio-footnote-item" id="mdstudio-fn-\d+">)\[(\d+)\]/g, '$1[' + prefix + '$2]');
}

/**
 * Single-source math syntax detector: delegates directly to `renderMarkdown` when `$` or `\`
 * appears, guaranteeing 100% parity across multiline `$$` blocks, blockquotes, lists, code
 * fences, escapes, and currency prose.
 */
export function containsMath(source: string): boolean {
  if (!source || !/[$\\]/.test(source)) return false;
  return renderMarkdown(source).html.includes('class="mdstudio-math"');
}

export function renderMarkdown(source: unknown, options?: RenderOptions): RenderResult {
  const opts = options || {};
  let text = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  let meta: Record<string, string> = {};
  const frontmatter = parseFrontmatter(text);
  if (frontmatter) {
    meta = frontmatter.meta;
    text = frontmatter.rest;
  }
  const extracted = extractDefinitions(text);
  text = extracted.text;
  const defaults = opts.locale === 'en' ? RENDER_DEFAULTS_EN : RENDER_DEFAULTS_ZH;
  const footnotesTitle = opts.footnotesTitle || defaults.footnotes;
  const referencesTitle = opts.referencesTitle || defaults.references;
  const ctx: RenderContext = {
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
  let html = injectFrontmatterMeta(blocks(text.split('\n'), ctx), buildFrontmatterMetaHtml(meta, text, opts.locale));
  html += renderFootnotesHtml(ctx, footnotesTitle);
  html = disambiguateFootnoteMarkers(html, ctx, opts.locale);
  html += renderReferencesHtml(ctx.refs, referencesTitle, defaults.refSep);
  return { html: html, meta: meta, refs: ctx.refs };
}
