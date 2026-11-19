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
}

export interface HostHealth {
  localServerUrl: string;
  localServerPort: number;
}

export interface AssetEntry {
  alt: string;
  kind: 'data' | 'asset';
}

export function assetFilenameFromSrc(src: unknown): string {
  const value = String(src || '');
  let match = /(?:^|\/)(assets\/[a-f0-9]{24}\.(?:png|jpg))$/i.exec(value);
  if (match) return match[1].split('/').pop() || '';
  match = /\/api\/markdown-studio\/assets\/([a-f0-9]{24}\.(?:png|jpg))$/i.exec(value);
  if (match) return match[1];
  match = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/uploads\/([a-f0-9]{24}\.(?:png|jpg))$/i.exec(value);
  return match ? match[1] : '';
}

export function resolveArticleImageSrc(src: string, imageBaseUrl: string): string {
  const file = assetFilenameFromSrc(src);
  return file && imageBaseUrl ? `${imageBaseUrl}/uploads/${file}` : '';
}

export function portableizeAssetUrls(text: unknown): string {
  return String(text || '')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/uploads\/([a-f0-9]{24}\.(?:png|jpg))/gi, 'assets/$1')
    .replace(/\/api\/markdown-studio\/assets\/([a-f0-9]{24}\.(?:png|jpg))/g, 'assets/$1');
}

export function collectLocalImages(text: unknown): Map<string, AssetEntry> {
  const images = new Map<string, AssetEntry>();
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || '')))) {
    const url = match[2];
    if (/^data:image\//i.test(url)) images.set(url, { alt: match[1], kind: 'data' });
    else if (assetFilenameFromSrc(url)) images.set(url, { alt: match[1], kind: 'asset' });
  }
  return images;
}

export function replaceLocalImages(text: unknown, mapping: Map<string, string>): string {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  return String(text || '').replace(pattern, (match, alt: string, url: string) => {
    const hosted = mapping.get(url);
    return hosted ? `![${alt}](${hosted})` : match;
  });
}

export function approximateDataBytes(dataUrl: unknown): number {
  const comma = String(dataUrl).indexOf(',');
  const payload = comma >= 0 ? String(dataUrl).length - comma - 1 : String(dataUrl).length;
  return Math.floor((payload * 3) / 4);
}

export function assetFilesInMarkdown(text: unknown): string[] {
  const files = new Set<string>();
  const pattern = /!\[[^\]]*\]\((assets\/[a-f0-9]{24}\.(?:png|jpg))\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || '')))) {
    const filename = match[1].split('/').pop();
    if (filename) files.add(filename);
  }
  return Array.from(files);
}
