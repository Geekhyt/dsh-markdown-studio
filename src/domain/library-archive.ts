import type { LibraryState } from './article';
import { assetFilesInMarkdown } from './images';

export const LIBRARY_ARCHIVE_FORMAT = 'markdown-studio-archive';
export const LIBRARY_ARCHIVE_VERSION = 1;
export const LIBRARY_ARCHIVE_MANIFEST = 'manifest.json';
export const LIBRARY_ARCHIVE_BACKUP = 'library.json';

export function isAssetFilename(value: string): boolean {
  return /^[a-f0-9]{24}\.(png|jpg)$/.test(value);
}

export function missingArchiveAssets(library: LibraryState, present: Iterable<string>): string[] {
  const available = new Set(present);
  return collectReferencedAssets(library).filter(function (filename) {
    return !available.has(filename);
  });
}

export function collectReferencedAssets(library: LibraryState): string[] {
  const files = new Set<string>();
  const documents = [...library.docs, ...(library.trash || [])];
  for (const article of documents) {
    for (const filename of assetFilesInMarkdown(article.markdown)) files.add(filename);
  }
  return Array.from(files).sort();
}
