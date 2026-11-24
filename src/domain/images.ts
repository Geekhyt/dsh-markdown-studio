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

function scanInlineImages(source: string): InlineImageSpan[] {
  const spans: InlineImageSpan[] = [];
  for (let i = 0; i < source.length - 1; i++) {
    if (source[i] !== '!' || source[i + 1] !== '[') continue;
    const closeBracket = findBracketEnd(source, i + 1);
    if (closeBracket < 0) {
      if (source.indexOf(']', i + 2) < 0) break;
      continue;
    }
    if (source[closeBracket + 1] !== '(') {
      i = closeBracket;
      continue;
    }
    const parsed = parseInlineImageDest(source, closeBracket + 1);
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
      title: parsed.title,
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
): { url: string; angled: boolean; title: string; closeParen: number } | null {
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
  return { url, angled, title: source.slice(titleStart, i), closeParen: i };
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

function collectHtmlImgSrcs(source: string, addUrl: (raw: string | undefined) => void): void {
  const lower = source.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const start = lower.indexOf('<img', pos);
    if (start < 0) break;
    const after = lower[start + 4] || '';
    if (after && !/[\s/>]/.test(after)) {
      pos = start + 4;
      continue;
    }
    const end = source.indexOf('>', start + 4);
    if (end < 0) break;
    const tag = source.slice(start + 4, end);
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    if (srcMatch) addUrl(srcMatch[1] || srcMatch[2] || srcMatch[3]);
    pos = end + 1;
  }
}

/** Collect all local asset filenames referenced by inline images (incl. nested/escaped alt), reference definitions, and HTML `<img>`. */
export function assetFilesInMarkdown(text: unknown): string[] {
  const files = new Set<string>();
  const source = String(text || '');
  const addUrl = (raw: string | undefined) => {
    const filename = assetFilenameFromSrc(raw);
    if (filename) files.add(filename);
  };
  for (const span of scanInlineImages(source)) addUrl(span.url);
  const refDefPattern = /^ {0,3}\[[^\]]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = refDefPattern.exec(source))) {
    addUrl(match[1] || match[2]);
  }
  collectHtmlImgSrcs(source, addUrl);
  return Array.from(files);
}
