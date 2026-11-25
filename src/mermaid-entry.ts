import mermaid from 'mermaid';
import { hasExternalCssUrl, stripExternalCssUrls } from './domain/custom-css';

declare global {
  interface Window {
    __MDSTUDIO_MERMAID__?: { render: typeof render };
  }
}

let initialized = false;
const MERMAID_RENDER_TIMEOUT_MS = 10_000;

const MERMAID_SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'themeCSS',
  'htmlLabels',
  'flowchart',
  'fontFamily',
];

function ensureInitialized(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    secure: MERMAID_SECURE_KEYS,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  });
  initialized = true;
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_PAINT_ATTRS = ['fill', 'stroke', 'filter', 'clip-path', 'mask'];

/** In YAML, `'`/`"` starts a quoted scalar only at a token boundary, never mid-word (e.g. `it's fine`). */
function isYamlQuoteStart(text: string, index: number, bound: number): boolean {
  const ch = text[index];
  if (ch !== '"' && ch !== "'") return false;
  if (index <= bound) return true;
  return /[\s:,{[\-?]/.test(text[index - 1]);
}

function scanQuotedEnd(text: string, openIndex: number): number {
  const quote = text[openIndex];
  for (let i = openIndex + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (quote === "'" && text[i] === "'" && text[i + 1] === "'") {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length - 1;
}

function isYamlCommentStart(text: string, index: number, bound: number): boolean {
  return text[index] === '#' && (index === bound || /[\s{,[\n]/.test(text[index - 1]));
}

function findLineBreakOrEnd(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl;
}

function findDirectiveBraceEnd(source: string, openBrace: number): number {
  let depth = 1;
  for (let i = openBrace + 1; i < source.length; i++) {
    const ch = source[i];
    if (isYamlQuoteStart(source, i, openBrace + 1)) {
      i = scanQuotedEnd(source, i);
      continue;
    }
    if (isYamlCommentStart(source, i, openBrace + 1)) {
      i = findLineBreakOrEnd(source, i);
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripYamlComments(text: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (isYamlQuoteStart(text, i, 0)) {
      i = scanQuotedEnd(text, i);
      continue;
    }
    if (isYamlCommentStart(text, i, 0)) {
      out += text.slice(start, i);
      const nl = findLineBreakOrEnd(text, i);
      i = nl - 1;
      start = nl;
    }
  }
  return start === 0 ? text : out + text.slice(start);
}

function splitDirectiveEntries(body: string): string[] {
  const clean = stripYamlComments(body);
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (isYamlQuoteStart(clean, i, start)) {
      i = scanQuotedEnd(clean, i);
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && (ch === ',' || ch === '\n')) {
      entries.push(clean.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(clean.slice(start));
  return entries;
}

const YAML_SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '/': '/',
  '\\': '\\',
  '"': '"',
};

function decodeYamlHexEscape(hex: string): string {
  const code = parseInt(hex, 16);
  return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
}

function decodeYamlDoubleQuoted(raw: string): string {
  // YAML 1.2 escaped line breaks (`\` + newline + leading spaces) fold to empty string.
  const folded = raw.replace(/\\\r?\n[ \t]*/g, '');
  return folded.replace(
    /\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|U([0-9a-f]{8})|([\s\S]))/gi,
    function (_m, x2?: string, u4?: string, u8?: string, lit?: string) {
      const hex = x2 || u4 || u8;
      if (hex) return decodeYamlHexEscape(hex);
      return lit ? (YAML_SIMPLE_ESCAPES[lit] ?? lit) : '';
    },
  );
}

function stripYamlNodeProps(text: string): string {
  let rest = text.trimStart();
  while (rest) {
    const m = /^(?:!<[^>]+>|![^\s,{}[\]]*|&[^\s,{}[\]]*)\s*/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

function decodeYamlScalar(raw: string): string {
  const cleaned = stripYamlNodeProps(raw.trim());
  if (!cleaned) return '';
  if (cleaned[0] === '"') return decodeYamlDoubleQuoted(cleaned.slice(1, scanQuotedEnd(cleaned, 0)));
  if (cleaned[0] === "'") return cleaned.slice(1, scanQuotedEnd(cleaned, 0)).replace(/''/g, "'");
  return cleaned;
}

function collectYamlAnchors(entries: string[]): Map<string, string> {
  const anchors = new Map<string, string>();
  for (const entry of entries) {
    const m = /&([^\s,{}[\]:]+)\s+([^\n,{}[\]]+)/.exec(entry);
    if (m) anchors.set(m[1], decodeYamlScalar(m[2]));
  }
  return anchors;
}

function parseQuotedYamlKey(rest: string, explicit: boolean): { key: string; explicitOnly: boolean; aliased: boolean } {
  const end = scanQuotedEnd(rest, 0);
  const rawKey = rest.slice(1, end);
  const after = rest.slice(end + 1).trimStart();
  const decoded = rest[0] === '"' ? decodeYamlDoubleQuoted(rawKey) : rawKey.replace(/''/g, "'");
  if (after.startsWith(':')) return { key: decoded, explicitOnly: false, aliased: false };
  return { key: explicit ? decoded : '', explicitOnly: explicit && !after, aliased: false };
}

function parseYamlEntryKey(
  entry: string,
  anchors: ReadonlyMap<string, string>,
): { key: string; explicitOnly: boolean; aliased: boolean } {
  let rest = entry.trim();
  const explicit = /^\?(?:\s|$)/.test(rest);
  if (explicit) rest = rest.slice(1).trimStart();
  rest = stripYamlNodeProps(rest);
  if (!rest) return { key: '', explicitOnly: false, aliased: false };
  if (rest[0] === '"' || rest[0] === "'") return parseQuotedYamlKey(rest, explicit);
  const colon = rest.indexOf(':');
  const rawKey = colon > 0 ? rest.slice(0, colon).trim() : explicit ? rest : '';
  const explicitOnly = colon <= 0 && explicit;
  if (rawKey.startsWith('*')) {
    return { key: anchors.get(rawKey.slice(1).trim()) || rawKey, explicitOnly, aliased: true };
  }
  return { key: rawKey, explicitOnly, aliased: false };
}

function stripNestedFlowMappings(entry: string): string {
  let out = '';
  let cursor = 0;
  for (let i = 0; i < entry.length; i++) {
    if (isYamlQuoteStart(entry, i, 0)) {
      i = scanQuotedEnd(entry, i);
      continue;
    }
    if (entry[i] === '{') {
      const end = findDirectiveBraceEnd(entry, i);
      if (end > i) {
        out += entry.slice(cursor, i + 1) + stripImgFromDirectiveBody(entry.slice(i + 1, end)) + '}';
        i = end;
        cursor = end + 1;
      }
    }
  }
  return cursor === 0 ? entry : out + entry.slice(cursor);
}

function stripImgFromDirectiveBody(body: string): string {
  const entries = splitDirectiveEntries(body)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const anchors = collectYamlAnchors(entries);
  const kept: string[] = [];
  let skipNextValue = false;
  for (const entry of entries) {
    if (skipNextValue) {
      skipNextValue = false;
      if (entry.startsWith(':')) continue;
    }
    const parsed = parseYamlEntryKey(entry, anchors);
    const keyLower = parsed.key.trim().toLowerCase();
    if (keyLower === 'img' || keyLower === '<<') {
      skipNextValue = parsed.explicitOnly;
      continue;
    }
    // Fail-closed: strip unresolved YAML alias keys whose value contains a URL scheme.
    if (parsed.aliased && /(?:https?:|data:|\/\/)/i.test(entry)) {
      skipNextValue = parsed.explicitOnly;
      continue;
    }
    kept.push(stripNestedFlowMappings(entry));
  }
  if (!kept.length) return '';
  return body.includes('\n') ? '\n  ' + kept.join('\n  ') + '\n' : ' ' + kept.join(', ') + ' ';
}

/** Strip Mermaid 11 `@{ img: ... }` metadata so `mermaid.render()` never triggers outbound `new Image()` SSRF fetches. */
export function stripMermaidImageDirectives(source: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < source.length) {
    const idx = source.indexOf('@{', cursor);
    if (idx < 0) {
      out += source.slice(cursor);
      break;
    }
    const end = findDirectiveBraceEnd(source, idx + 1);
    if (end < 0) {
      out += source.slice(cursor);
      break;
    }
    out += source.slice(cursor, idx) + '@{' + stripImgFromDirectiveBody(source.slice(idx + 2, end)) + '}';
    cursor = end + 1;
  }
  return out;
}

const MERMAID_STYLE_LINE_RE = /^([ \t]*(?:classDef|style|linkStyle)\s+\S+\s+)([\s\S]*)$/i;
const MERMAID_SEQ_PROPS_RE = /^([ \t]*properties(?:\s+[^:{[\n]+)?\s*:?\s*)([{[][\s\S]*)$/i;
const MERMAID_SEQ_DETAILS_RE = /^[ \t]*details(?:\s+[^:{[\n]+)?\s*[:{[]/i;
const DANGEROUS_INLINE_HTML_RE =
  /<\/?(?:img|iframe|script|object|embed|link|style|audio|video|source|base|meta)\b[^>]*>/gi;

function scrubStyleDeclList(raw: string): string {
  const parts = raw.split(',');
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (hasExternalCssUrl(trimmed)) continue;
    const clean = stripExternalCssUrls(trimmed).trim();
    if (clean) kept.push(clean);
  }
  return kept.join(',');
}

function isUnsafeSequenceProp(key: string, val: unknown): boolean {
  if (/^(?:icon|img|image|src|href|url|link)$/i.test(key)) return true;
  return typeof val === 'string' && /(?:https?:|\/\/)/i.test(val);
}

function scrubSequencePropsJson(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return '{}';
    const next: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (!isUnsafeSequenceProp(key, val)) next[key] = val;
    }
    return JSON.stringify(next);
  } catch {
    return '{}';
  }
}

/**
 * Pre-render Mermaid source sanitizer: neutralizes all known pre-sanitization
 * SSRF & DOM-read vectors across flowchart, sequenceDiagram, stateDiagram-v2,
 * block-beta, and architecture-beta BEFORE `mermaid.render()` touches the DOM.
 */
export function sanitizeMermaidSource(source: string): string {
  const withoutDirectives = stripMermaidImageDirectives(source);
  const lines = withoutDirectives.split('\n');
  const safeLines: string[] = [];
  for (const line of lines) {
    if (MERMAID_SEQ_DETAILS_RE.test(line)) continue;
    const propsMatch = MERMAID_SEQ_PROPS_RE.exec(line);
    if (propsMatch) {
      safeLines.push(propsMatch[1] + scrubSequencePropsJson(propsMatch[2]));
      continue;
    }
    const styleMatch = MERMAID_STYLE_LINE_RE.exec(line);
    if (styleMatch) {
      const scrubbed = scrubStyleDeclList(styleMatch[2]);
      if (scrubbed) safeLines.push(styleMatch[1] + scrubbed);
      continue;
    }
    safeLines.push(line.replace(DANGEROUS_INLINE_HTML_RE, ''));
  }
  return safeLines.join('\n');
}

function isLocalFragmentRef(value: string): boolean {
  return value.trim().startsWith('#');
}

function stripUnsafeSvgAttrs(node: Element): void {
  const style = node.getAttribute('style');
  if (style) {
    const cleanStyle = stripExternalCssUrls(style);
    if (cleanStyle) node.setAttribute('style', cleanStyle);
    else node.removeAttribute('style');
  }
  for (const attr of SVG_PAINT_ATTRS) {
    const val = node.getAttribute(attr);
    if (val && hasExternalCssUrl(val)) node.removeAttribute(attr);
  }
  for (const attr of Array.from(node.attributes)) {
    if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
  }
}

function stripUnsafeSvgLinks(node: Element, tag: string): void {
  const href = node.getAttribute('href');
  if (href && (tag !== 'use' || !isLocalFragmentRef(href))) node.removeAttribute('href');
  const xlinkHref = node.getAttributeNS(XLINK_NS, 'href') || node.getAttribute('xlink:href');
  if (xlinkHref && (tag !== 'use' || !isLocalFragmentRef(xlinkHref))) {
    node.removeAttribute('xlink:href');
    node.removeAttributeNS(XLINK_NS, 'href');
  }
}

function sanitizeMermaidSvgNode(node: Element): void {
  const tag = node.tagName.toLowerCase();
  if (tag === 'style') {
    node.textContent = stripExternalCssUrls(node.textContent || '');
    return;
  }
  stripUnsafeSvgAttrs(node);
  stripUnsafeSvgLinks(node, tag);
}

function readSvgNumber(el: Element, attr: string): number {
  const parsed = Number.parseFloat(el.getAttribute(attr) ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Convert plain-text `<foreignObject>` (used by Mermaid 11 `venn-beta` and
 * `architecture-beta` even with `htmlLabels: false`) into pure SVG `<text>` so
 * labels survive sanitization with zero `<foreignObject>` left in the SVG.
 */
function replaceForeignObjectWithText(fo: Element, doc: Document): void {
  const text = (fo.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text || !fo.parentNode) {
    fo.remove();
    return;
  }
  const label = doc.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', String(readSvgNumber(fo, 'x') + readSvgNumber(fo, 'width') / 2));
  label.setAttribute('y', String(readSvgNumber(fo, 'y') + readSvgNumber(fo, 'height') / 2));
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'central');
  label.setAttribute('font-size', '14');
  label.setAttribute('fill', 'currentColor');
  label.textContent = text;
  fo.parentNode.replaceChild(label, fo);
}

/** DOM-sanitize Mermaid SVG output: convert text `<foreignObject>` to `<text>`, drop `<script>`/`<image>`, external links/URLs, and scrub `<style>`. */
export function sanitizeMermaidSvg(svg: string): string {
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.tagName.toLowerCase() === 'svg') {
      for (const el of Array.from(root.querySelectorAll('script, image'))) el.remove();
      for (const fo of Array.from(root.querySelectorAll('foreignObject'))) replaceForeignObjectWithText(fo, doc);
      Array.from(root.querySelectorAll('a')).forEach((link) => {
        while (link.firstChild) link.parentNode?.insertBefore(link.firstChild, link);
        link.remove();
      });
      sanitizeMermaidSvgNode(root);
      Array.from(root.querySelectorAll('*')).forEach(sanitizeMermaidSvgNode);
      return new XMLSerializer().serializeToString(root);
    }
  }
  return svg
    .replace(/<(?:script|image|foreignObject)\b[\s\S]*?(?:\/>|<\/(?:script|image|foreignObject)\s*>)/gi, '')
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (_m, open, css, close) {
      return open + stripExternalCssUrls(css) + close;
    });
}

let renderSeq = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

function removeTempNode(nodeId: string): void {
  const node = document.getElementById(nodeId);
  if (node) node.remove();
}

/** Mermaid mounts a temporary `#d<id>` (or sandbox `#i<id>`) node and leaves it behind when parsing fails. */
function removeTempNodes(id: string): void {
  if (typeof document === 'undefined') return;
  removeTempNode('d' + id);
  removeTempNode('i' + id);
}

async function renderSerialized(source: string, id?: string): Promise<string> {
  ensureInitialized();
  renderSeq += 1;
  const renderId = (id || 'mdstudio-mermaid') + '-r' + renderSeq;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const safeSource = sanitizeMermaidSource(source);
    const result = await Promise.race([
      mermaid.render(renderId, safeSource),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mermaid render timeout')), MERMAID_RENDER_TIMEOUT_MS);
      }),
    ]);
    return sanitizeMermaidSvg(result.svg);
  } finally {
    if (timer) clearTimeout(timer);
    removeTempNodes(renderId);
  }
}

export function render(code: unknown, id?: string): Promise<string> {
  const source = String(code || '');
  const task = renderQueue.then(
    () => renderSerialized(source, id),
    () => renderSerialized(source, id),
  );
  renderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MERMAID__ = { render };
}
