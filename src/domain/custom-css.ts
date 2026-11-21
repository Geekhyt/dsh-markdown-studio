const CSS_URL_FUNCS = new Set(['url', 'src']);
const CSS_MULTI_URL_FUNCS = new Set(['image-set', '-webkit-image-set', 'image', 'cross-fade']);
const C0_AND_CTRL = /[\u0000-\u0020\u007f-\u009f]/g;
const DISALLOWED_URL_PREFIX = /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i;

/** Decode CSS escapes (`\68ttps`, `u\72l`, `\2f `) and CSS string line continuations (`\<newline>`) in one pass. */
function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:\r\n|[\r\n\f])|\\([0-9a-f]{1,6})[ \t\r\n\f]?|\\([\s\S])/gi,
    function (_match, hex?: string, lit?: string) {
      if (hex !== undefined) {
        const code = parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
      }
      return lit ?? '';
    },
  );
}

/** Advance past one CSS backslash escape starting at `index` and return the index of its final char. */
function skipCssEscape(text: string, index: number): number {
  let j = index + 1;
  if (j >= text.length) return index;
  if (/[0-9a-f]/i.test(text[j])) {
    const maxHex = Math.min(text.length, j + 6);
    while (j < maxHex && /[0-9a-f]/i.test(text[j])) j++;
    if (j < text.length && /[ \t\r\n\f]/.test(text[j])) {
      if (text[j] === '\r' && text[j + 1] === '\n') j += 2;
      else j++;
    }
    return j - 1;
  }
  return j;
}

function hasClosingQuote(text: string, from: number, quote: string): boolean {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i = skipCssEscape(text, i);
      continue;
    }
    if (ch === '\n' || ch === '\r') return false;
    if (ch === quote) return true;
  }
  return false;
}

function findBalancedParenEnd(text: string, openIndex: number): number {
  let depth = 1;
  let quote = '';
  for (let i = openIndex + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i = skipCssEscape(text, i);
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (hasClosingQuote(text, i + 1, ch)) quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return text.length;
}

function readQuotedStringEnd(text: string, openIndex: number): number {
  const quote = text[openIndex];
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i = skipCssEscape(text, i);
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length;
}

function extractLeadingUrlValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed[0] === '"' || trimmed[0] === "'") {
    const end = readQuotedStringEnd(trimmed, 0);
    return decodeCssEscapes(trimmed.slice(1, end)).trim();
  }
  let end = 0;
  while (end < trimmed.length) {
    const ch = trimmed[end];
    if (ch === '\\') {
      end = skipCssEscape(trimmed, end) + 1;
      continue;
    }
    if (/[\s)]/.test(ch)) break;
    end++;
  }
  return decodeCssEscapes(trimmed.slice(0, end)).trim();
}

function isExternalUrlString(decoded: string): boolean {
  const normalized = decoded.replace(C0_AND_CTRL, '');
  if (!normalized || /^data:/i.test(normalized)) return false;
  return DISALLOWED_URL_PREFIX.test(normalized);
}

function isExternalUrlArg(raw: string): boolean {
  if (isExternalUrlString(extractLeadingUrlValue(raw))) return true;
  return isExternalUrlString(decodeCssEscapes(raw.trim()));
}

function extractFunctionCandidates(body: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i = skipCssEscape(body, i);
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (hasClosingQuote(body, i + 1, ch)) quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

function scanIdentBeforeParen(text: string, from: number, parenIndex: number): { start: number; rawName: string } {
  let end = parenIndex;
  while (end > from && /\s/.test(text[end - 1])) end--;
  let start = end;
  while (start > from) {
    const prev = text[start - 1];
    if (/[A-Za-z0-9_\\-]/.test(prev)) {
      start--;
      continue;
    }
    // CSS hex escapes inside function names (e.g. `\75 rl(`) consume one trailing space.
    if (/[ \t]/.test(prev) && start >= from + 2 && /\\[0-9a-f]{1,6}$/i.test(text.slice(from, start - 1))) {
      start--;
      continue;
    }
    break;
  }
  return { start, rawName: text.slice(start, end) };
}

function findNextFunctionCall(
  text: string,
  from: number,
): { start: number; fnName: string; rawName: string; open: number; close: number } | null {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i = skipCssEscape(text, i);
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (hasClosingQuote(text, i + 1, ch)) quote = ch;
      continue;
    }
    if (ch !== '(') continue;
    const ident = scanIdentBeforeParen(text, from, i);
    if (!ident.rawName) continue;
    const fnName = decodeCssEscapes(ident.rawName).trim().toLowerCase();
    if (CSS_URL_FUNCS.has(fnName) || CSS_MULTI_URL_FUNCS.has(fnName)) {
      return { start: ident.start, fnName, rawName: ident.rawName, open: i, close: findBalancedParenEnd(text, i) };
    }
  }
  return null;
}

function isAtImportSegment(segment: string): boolean {
  const head = segment.replace(/^\s*(?:<!--|-->|\s)+/, '').slice(0, 48);
  return /^@import\b/i.test(decodeCssEscapes(head));
}

function hasExternalQuotedString(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i = skipCssEscape(text, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = readQuotedStringEnd(text, i);
      if (isExternalUrlString(decodeCssEscapes(text.slice(i + 1, end)).trim())) return true;
      i = end;
    }
  }
  return false;
}

function candidateHasExternalUrl(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (hasExternalQuotedString(trimmed)) return true;
  let cursor = 0;
  while (cursor < trimmed.length) {
    const nested = findNextFunctionCall(trimmed, cursor);
    if (!nested) break;
    const inner = trimmed.slice(nested.open + 1, nested.close);
    const bad = CSS_URL_FUNCS.has(nested.fnName)
      ? isExternalUrlArg(inner)
      : extractFunctionCandidates(inner).some(candidateHasExternalUrl);
    if (bad) return true;
    cursor = nested.close + 1;
  }
  return isExternalUrlArg(trimmed);
}

function precleanCss(value: string): string {
  return String(value || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:\r\n|\r|\n|\f)/g, '');
}

export function hasExternalCssUrl(value: string): boolean {
  const raw = precleanCss(value);
  const importProbe = decodeCssEscapes(raw.replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, '""').replace(/<!--|-->/g, ' '));
  if (isAtImportSegment(raw) || /(?:^|[;{}])\s*@import\b/i.test(importProbe)) return true;
  let cursor = 0;
  while (cursor < raw.length) {
    const call = findNextFunctionCall(raw, cursor);
    if (!call) break;
    const inner = raw.slice(call.open + 1, call.close);
    if (CSS_URL_FUNCS.has(call.fnName)) {
      if (isExternalUrlArg(inner)) return true;
    } else if (extractFunctionCandidates(inner).some(candidateHasExternalUrl)) {
      return true;
    }
    cursor = call.close + 1;
  }
  return false;
}

function replacePlainExternalUrls(segment: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < segment.length) {
    const call = findNextFunctionCall(segment, cursor);
    if (!call) {
      out += segment.slice(cursor);
      break;
    }
    const inner = segment.slice(call.open + 1, call.close);
    if (call.rawName.toLowerCase() === 'url' && !/\\/.test(inner) && isExternalUrlArg(inner)) {
      out += segment.slice(cursor, call.start) + 'none';
      cursor = call.close + 1;
      continue;
    }
    out += segment.slice(cursor, call.close + 1);
    cursor = call.close + 1;
  }
  return out;
}

function splitCssSegments(css: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\\') {
      i = skipCssEscape(css, i);
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (hasClosingQuote(css, i + 1, ch)) quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      parts.push(css.slice(start, i), ch);
      start = i + 1;
    }
  }
  if (start < css.length) parts.push(css.slice(start));
  return parts;
}

/**
 * Remove external CSS `@import` rules and network `url(...)` / `image-set(...)` / `src(...)`
 * references while keeping local and `data:` URLs (including unencoded inline SVG data URIs).
 * Parsing runs quote-, paren-, and CSS-escape-aware so escaped quotes, hex whitespace, C0
 * controls, backslash protocol-relative URLs, and multi-URL functions cannot bypass sanitization.
 */
export function stripExternalCssUrls(css: string): string {
  const cleaned = precleanCss(css);
  const parts = splitCssSegments(cleaned);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment === ';' || segment === '{' || segment === '}') {
      out += segment;
      continue;
    }
    if (isAtImportSegment(segment)) {
      const leadWs = /^\s*/.exec(segment)?.[0] || '';
      out += leadWs;
      if (parts[i + 1] === ';') i++;
      continue;
    }
    const replaced = replacePlainExternalUrls(segment);
    out += hasExternalCssUrl(replaced) ? '' : replaced;
  }
  return out;
}
