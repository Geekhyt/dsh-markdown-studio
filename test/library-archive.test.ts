import assert from 'node:assert/strict';
import type { Article, LibraryState } from '../src/domain/article';
import { collectReferencedAssets, isAssetFilename, missingArchiveAssets } from '../src/domain/library-archive';
import { DEFAULT_SETTINGS } from '../src/themes';

const article: Article = {
  id: 'a',
  title: 'A',
  markdown: '![x](assets/0123456789abcdef01234567.png)',
  settings: { ...DEFAULT_SETTINGS },
  view: 'split',
  updatedAt: 1,
};
const library: LibraryState = {
  activeId: 'a',
  docs: [article],
  trash: [{ ...article, id: 't', markdown: '![z](assets/bbbbbbbbbbbbbbbbbbbbbbbb.png)' }],
};
const files = collectReferencedAssets(library);
assert.deepEqual(files, ['0123456789abcdef01234567.png', 'bbbbbbbbbbbbbbbbbbbbbbbb.png']);
assert.equal(isAssetFilename(files[0]), true);
assert.equal(isAssetFilename('../evil.png'), false);
assert.equal(isAssetFilename('0123456789abcdef01234567.gif'), false);
assert.deepEqual(collectReferencedAssets({ activeId: 'x', docs: [{ ...article, markdown: 'none' }] }), []);
assert.deepEqual(missingArchiveAssets(library, ['0123456789abcdef01234567.png']), ['bbbbbbbbbbbbbbbbbbbbbbbb.png']);
assert.deepEqual(missingArchiveAssets(library, files), []);
console.log('6 library-archive checks passed.');
