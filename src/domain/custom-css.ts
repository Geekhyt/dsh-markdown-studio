const CSS_URL_FUNCS = new Set(['url', 'src']);
const CSS_MULTI_URL_FUNCS = new Set(['image-set', '-webkit-image-set', 'image', 'cross-fade']);
const NETWORK_REFERENCE = /^(?:https?:)?\/\//i;

/** Decode CSS escapes (`\68ttps`, `u\72l`, `\2f `) and CSS string line continuations (`\<newline>`). */
function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\(?:\r\n|\r|\n|\f)/g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, function (_match, hex: string) {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    })
    .replace(/\\([\s\S])/g, '$1');
}

function hasClosingQuote(text: string, from: number, quote: string): boolean {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
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
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
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

function extractLeadingUrlValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const first = trimmed[0];
  if (first === '"' || first === "'") {
    let i = 1;
    while (i < trimmed.length) {
      if (trimmed[i] === '\\') {
        i += 2;
        continue;
      }
      if (trimmed[i] === first) break;
      i++;
    }
    return decodeCssEscapes(trimmed.slice(1, i)).trim();
  }
  const tokenMatch = /^([^\s)]+)/.exec(trimmed);
  return decodeCssEscapes(tokenMatch ? tokenMatch[1] : trimmed).trim();
}

function isExternalUrlArg(raw: string): boolean {
  const url = extractLeadingUrlValue(raw);
  if (!url || /^data:/i.test(url)) return false;
  return NETWORK_REFERENCE.test(url);
}

function extractFunctionCandidates(body: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
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

function findNextFunctionCall(
  text: string,
  from: number,
): { start: number; fnName: string; rawName: string; open: number; close: number } | null {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (hasClosingQuote(text, i + 1, ch)) quote = ch;
      continue;
    }
    if (ch !== '(') continue;
    let end = i;
    while (end > from && /\s/.test(text[end - 1])) end--;
    let start = end;
    while (start > from && /[A-Za-z0-9_\\-]/.test(text[start - 1])) start--;
    const rawName = text.slice(start, end);
    if (!rawName) continue;
    const fnName = decodeCssEscapes(rawName).trim().toLowerCase();
    if (CSS_URL_FUNCS.has(fnName) || CSS_MULTI_URL_FUNCS.has(fnName)) {
      return { start, fnName, rawName, open: i, close: findBalancedParenEnd(text, i) };
    }
  }
  return null;
}

function isAtImportSegment(segment: string): boolean {
  const head = segment.trimStart().slice(0, 48);
  return /^@import\b/i.test(decodeCssEscapes(head));
}

function candidateHasExternalUrl(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed[0] === '"' || trimmed[0] === "'") return isExternalUrlArg(trimmed);
  const nested = findNextFunctionCall(trimmed, 0);
  if (nested) {
    const inner = trimmed.slice(nested.open + 1, nested.close);
    return CSS_URL_FUNCS.has(nested.fnName)
      ? isExternalUrlArg(inner)
      : extractFunctionCandidates(inner).some(candidateHasExternalUrl);
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
  if (
    isAtImportSegment(raw) ||
    /(?:^|[;{}])\s*@import\b/i.test(decodeCssEscapes(raw.replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, '""')))
  ) {
    return true;
  }
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
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
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
 * Parsing runs quote- and paren-aware before escape decoding so escaped quotes (`\"` / `\22 `)
 * and URL modifiers can never bypass sanitization.
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
      // Also drop the trailing `;` of the `@import` rule while keeping leading whitespace/newlines.
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
