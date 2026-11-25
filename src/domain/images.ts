export interface StoredAsset {
  filename: string;
  assetPath: string;
  localUrl: string;
  url: string;
  mime: string;
  bytes: number;
}

export interface AssetItem {
  filename: string;
  assetPath: string;
  url: string;
  bytes: number;
  mime: string;
  storedAt?: string;
}

export interface HostHealth {
  localServerUrl: string;
  localServerPort: number;
}

export interface AssetEntry {
  alt: string;
  kind: 'data' | 'asset';
}

const LOOPBACK_ORIGIN = 'https?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?';
const ASSET_NAME = '([a-f0-9]{24}\\.(?:png|jpg))';
const RELATIVE_ASSET_RE = new RegExp(`(?:^|\\/)assets\\/${ASSET_NAME}$`, 'i');
const API_ASSET_RE = new RegExp(`^(?:${LOOPBACK_ORIGIN})?\\/api\\/markdown-studio\\/assets\\/${ASSET_NAME}$`, 'i');
const UPLOAD_ASSET_RE = new RegExp(`^${LOOPBACK_ORIGIN}\\/uploads\\/${ASSET_NAME}$`, 'i');

export function assetFilenameFromSrc(src: unknown): string {
  const value = String(src || '')
    .trim()
    .split('?')[0]
    .split('#')[0];
  if (!value) return '';
  let match = UPLOAD_ASSET_RE.exec(value) || API_ASSET_RE.exec(value);
  if (match) return match[1].toLowerCase();
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return '';
  match = RELATIVE_ASSET_RE.exec(value);
  return match ? match[1].toLowerCase() : '';
}

export function resolveArticleImageSrc(src: string, imageBaseUrl: string): string {
  const file = assetFilenameFromSrc(src);
  return file && imageBaseUrl ? `${imageBaseUrl}/uploads/${file}` : '';
}

export function portableizeAssetUrls(text: unknown): string {
  return String(text || '')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/uploads\/([a-f0-9]{24}\.(?:png|jpg))/gi, 'assets/$1')
    .replace(
      /(?:https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?)?\/api\/markdown-studio\/assets\/([a-f0-9]{24}\.(?:png|jpg))/gi,
      'assets/$1',
    );
}

interface InlineImageSpan {
  start: number;
  end: number;
  alt: string;
  url: string;
  angled: boolean;
  title: string;
}

function advanceMarkdownFence(active: string, line: string): string {
  if (!active) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open || (open[1].charAt(0) === '`' && open[2].includes('`'))) return '';
    return open[1];
  }
  const close = new RegExp('^ {0,3}' + active.charAt(0) + '{' + active.length + ',}[ \\t]*$');
  return close.test(line) ? '' : active;
}

function maskInlineCodeLine(line: string): string {
  if (!line.includes('`')) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let ticks = 1;
    while (line[i + ticks] === '`') ticks++;
    let close = -1;
    let scan = i + ticks;
    while (scan < line.length) {
      const next = line.indexOf('`', scan);
      if (next < 0) break;
      let run = 1;
      while (line[next + run] === '`') run++;
      if (run === ticks) {
        close = next;
        break;
      }
      scan = next + run;
    }
    if (close >= 0) {
      out += ' '.repeat(close + ticks - i);
      i = close + ticks;
    } else {
      out += line.slice(i, i + ticks);
      i += ticks;
    }
  }
  return out;
}

/** Replace fenced code blocks and inline code spans with equal-length spaces (keeping line breaks & offsets exact). */
function maskCodePreservingOffsets(source: string): string {
  if (!source.includes('`') && !source.includes('~')) return source;
  const lines = source.split('\n');
  let fence = '';
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const hasCr = line.endsWith('\r');
    const clean = hasCr ? line.slice(0, -1) : line;
    const prevFence = fence;
    fence = advanceMarkdownFence(fence, clean);
    if (prevFence || fence) {
      lines[idx] = ' '.repeat(clean.length) + (hasCr ? '\r' : '');
    } else {
      lines[idx] = maskInlineCodeLine(clean) + (hasCr ? '\r' : '');
    }
  }
  return lines.join('\n');
}

function scanInlineImages(source: string, preMasked?: string): InlineImageSpan[] {
  const masked = preMasked ?? maskCodePreservingOffsets(source);
  const spans: InlineImageSpan[] = [];
  for (let i = 0; i < masked.length - 1; i++) {
    if (masked[i] !== '!' || masked[i + 1] !== '[') continue;
    const closeBracket = findBracketEnd(masked, i + 1);
    if (closeBracket < 0) {
      if (masked.indexOf(']', i + 2) < 0) break;
      continue;
    }
    if (masked[closeBracket + 1] !== '(') {
      i = closeBracket;
      continue;
    }
    const parsed = parseInlineImageDest(masked, closeBracket + 1);
    if (!parsed) {
      i = closeBracket + 1;
      continue;
    }
    spans.push({
      start: i,
      end: parsed.closeParen + 1,
      alt: source.slice(i + 2, closeBracket),
      url: parsed.url,
      angled: parsed.angled,
      title:
        source.slice(
          closeBracket + 2 + (parsed.angled ? parsed.url.length + 2 : parsed.url.length),
          parsed.closeParen,
        ) === parsed.title
          ? parsed.title
          : source.slice(parsed.titleStart, parsed.closeParen),
    });
    i = parsed.closeParen;
  }
  return spans;
}

function skipSpaces(source: string, index: number): number {
  let i = index;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  return i;
}

function readUnangledImageUrl(source: string, start: number): { url: string; next: number } {
  let i = start;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) break;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  return { url: source.slice(start, i), next: i };
}

function skipOptionalImageTitle(source: string, start: number): number {
  let i = skipSpaces(source, start);
  const open = source[i];
  if (open !== '"' && open !== "'" && open !== '(') return i;
  const close = open === '(' ? ')' : open;
  i++;
  while (i < source.length && source[i] !== close) {
    if (source[i] === '\\') i++;
    i++;
  }
  if (i >= source.length) return -1;
  return skipSpaces(source, i + 1);
}

function parseInlineImageDest(
  source: string,
  openParen: number,
): { url: string; angled: boolean; title: string; titleStart: number; closeParen: number } | null {
  let i = skipSpaces(source, openParen + 1);
  let url = '';
  let angled = false;
  if (source[i] === '<') {
    const closeAngle = source.indexOf('>', i + 1);
    if (closeAngle < 0) return null;
    url = source.slice(i + 1, closeAngle);
    if (url.includes('\n')) return null;
    angled = true;
    i = closeAngle + 1;
  } else {
    const bare = readUnangledImageUrl(source, i);
    url = bare.url;
    i = bare.next;
  }
  if (!url) return null;
  const titleStart = i;
  i = skipOptionalImageTitle(source, titleStart);
  if (i < 0 || source[i] !== ')') return null;
  return { url, angled, title: source.slice(titleStart, i), titleStart, closeParen: i };
}

export function collectLocalImages(text: unknown): Map<string, AssetEntry> {
  const images = new Map<string, AssetEntry>();
  for (const span of scanInlineImages(String(text || ''))) {
    if (/^data:image\//i.test(span.url)) images.set(span.url, { alt: span.alt, kind: 'data' });
    else if (assetFilenameFromSrc(span.url)) images.set(span.url, { alt: span.alt, kind: 'asset' });
  }
  return images;
}

export function replaceLocalImages(text: unknown, mapping: Map<string, string>): string {
  const source = String(text || '');
  if (!mapping.size) return source;
  const spans = scanInlineImages(source);
  if (!spans.length) return source;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const hosted = mapping.get(span.url);
    if (!hosted) continue;
    out += source.slice(cursor, span.start);
    out += `![${span.alt}](${span.angled ? `<${hosted}>` : hosted}${span.title})`;
    cursor = span.end;
  }
  return cursor === 0 ? source : out + source.slice(cursor);
}

export function approximateDataBytes(dataUrl: unknown): number {
  const comma = String(dataUrl).indexOf(',');
  const payload = comma >= 0 ? String(dataUrl).length - comma - 1 : String(dataUrl).length;
  return Math.floor((payload * 3) / 4);
}

function findBracketEnd(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '\n' && (source[i + 1] === '\n' || (source[i + 1] === '\r' && source[i + 2] === '\n'))) {
      return -1;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isImgTagStart(source: string, idx: number): boolean {
  if (idx + 4 >= source.length) return false;
  if ((source.charCodeAt(idx + 1) | 32) !== 105) return false;
  if ((source.charCodeAt(idx + 2) | 32) !== 109) return false;
  if ((source.charCodeAt(idx + 3) | 32) !== 103) return false;
  const sep = source.charAt(idx + 4);
  return sep === ' ' || sep === '\t' || sep === '\n' || sep === '\r' || sep === '/' || sep === '>';
}

function collectHtmlImgSrcs(source: string, addUrl: (raw: string | undefined) => void): void {
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (!isImgTagStart(source, start)) {
      cursor = start + 1;
      continue;
    }
    const end = source.indexOf('>', start + 4);
    if (end < 0) break;
    const attrs = source.slice(start + 4, end);
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
    if (srcMatch) addUrl(srcMatch[1] || srcMatch[2] || srcMatch[3]);
    cursor = end + 1;
  }
}

/** Collect all local asset filenames referenced by inline images (incl. nested/escaped alt), reference definitions, and HTML `<img>`. */
export function assetFilesInMarkdown(text: unknown): string[] {
  const files = new Set<string>();
  const source = String(text || '');
  const masked = maskCodePreservingOffsets(source);
  const addUrl = (raw: string | undefined) => {
    const filename = assetFilenameFromSrc(raw);
    if (filename) files.add(filename);
  };
  for (const span of scanInlineImages(source, masked)) addUrl(span.url);
  const refDefPattern = /^ {0,3}\[[^\]]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = refDefPattern.exec(masked))) {
    addUrl(match[1] || match[2]);
  }
  collectHtmlImgSrcs(masked, addUrl);
  return Array.from(files);
}
