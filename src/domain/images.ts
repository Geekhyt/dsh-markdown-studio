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

const LOCAL_IMAGE_PATTERN = /!\[([^\]]*)\]\((?:<([^>\n]+)>|([^)\s]+))(\s+(?:"[^"]*"|'[^']*'))?\)/g;

export function collectLocalImages(text: unknown): Map<string, AssetEntry> {
  const images = new Map<string, AssetEntry>();
  const pattern = new RegExp(LOCAL_IMAGE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || '')))) {
    const url = match[2] || match[3];
    if (/^data:image\//i.test(url)) images.set(url, { alt: match[1], kind: 'data' });
    else if (assetFilenameFromSrc(url)) images.set(url, { alt: match[1], kind: 'asset' });
  }
  return images;
}

export function replaceLocalImages(text: unknown, mapping: Map<string, string>): string {
  return String(text || '').replace(
    LOCAL_IMAGE_PATTERN,
    (match, alt: string, angled?: string, plain?: string, title = '') => {
      const url = angled || plain || '';
      const hosted = mapping.get(url);
      if (!hosted) return match;
      return `![${alt}](${angled ? `<${hosted}>` : hosted}${title})`;
    },
  );
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
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readInlineImageUrl(source: string, openParen: number): string {
  let i = openParen + 1;
  while (i < source.length && /[ \t]/.test(source[i])) i++;
  if (source[i] === '<') {
    const close = source.indexOf('>', i + 1);
    return close > i ? source.slice(i + 1, close) : '';
  }
  let end = i;
  let depth = 0;
  while (end < source.length) {
    const ch = source[end];
    if (ch === '\\') {
      end += 2;
      continue;
    }
    if (/\s/.test(ch)) break;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    end++;
  }
  return source.slice(i, end);
}

/** Collect all local asset filenames referenced by inline images (incl. nested/escaped alt), reference definitions, and HTML `<img>`. */
export function assetFilesInMarkdown(text: unknown): string[] {
  const files = new Set<string>();
  const source = String(text || '');
  const addUrl = (raw: string | undefined) => {
    const filename = assetFilenameFromSrc(raw);
    if (filename) files.add(filename);
  };
  for (let i = 0; i < source.length - 1; i++) {
    if (source[i] !== '!' || source[i + 1] !== '[') continue;
    const closeBracket = findBracketEnd(source, i + 1);
    if (closeBracket < 0 || source[closeBracket + 1] !== '(') continue;
    addUrl(readInlineImageUrl(source, closeBracket + 1));
    i = closeBracket + 1;
  }
  const refDefPattern = /^ {0,3}\[[^\]]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = refDefPattern.exec(source))) {
    addUrl(match[1] || match[2]);
  }
  const htmlPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  while ((match = htmlPattern.exec(source))) {
    addUrl(match[1] || match[2] || match[3]);
  }
  return Array.from(files);
}
