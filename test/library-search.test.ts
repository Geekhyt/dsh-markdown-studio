import assert from 'node:assert/strict';
import type { Article } from '../src/domain/article';
import { searchArticles } from '../src/domain/library-search';
import { DEFAULT_SETTINGS } from '../src/themes';

function article(id: string, title: string, markdown: string, updatedAt = 0): Article {
  return { id, title, markdown, settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt };
}
const docs = [
  article('a', '写作计划', '# 选题\n\n今天写公众号。', 1),
  article('b', '日记', '# 日常\n\n公众号发布了。', 2),
  article('c', 'Other', '# Nothing', 3),
];
const titleHits = searchArticles(docs, '写作');
assert.equal(titleHits.length, 1);
assert.equal(titleHits[0].article.id, 'a');
assert.equal(titleHits[0].titleMatch, true);
const bodyHits = searchArticles(docs, '公众号');
assert.equal(bodyHits.length, 2);
assert.ok(bodyHits[0].snippet.includes('公众号'));
assert.ok(bodyHits[0].snippet.length <= 120);
assert.equal(searchArticles(docs, 'missing').length, 0);
assert.equal(searchArticles(docs, '').length, 3);
assert.ok(searchArticles(docs, '')[0].article.updatedAt >= searchArticles(docs, '')[1].article.updatedAt);
assert.equal(searchArticles([...docs, ...docs], '公众号', 3).length, 3, 'limit applies');

console.log('21 library-search checks passed.');

const whitespace = searchArticles([article('w', 'White', 'alpha\n\n  beta\t gamma')], 'alpha');
assert.equal(whitespace[0].snippet, 'alpha beta gamma', 'compacts whitespace in snippets');
assert.equal(
  searchArticles([article('u', 'UPPER', '# body')], 'upper')[0].titleMatch,
  true,
  'title matching is case-insensitive',
);
assert.equal(
  searchArticles([article('b', 'Other', '# Body')], 'body')[0].titleMatch,
  false,
  'body matches are not title matches when only body has it',
);
const titleOrder = searchArticles(
  [article('late', 'prefix TARGET', '# body', 1), article('early', 'TARGET prefix', '# body', 2)],
  'target',
);
assert.equal(titleOrder[0].article.id, 'early', 'earlier title position wins');
const hitOrder = searchArticles(
  [article('one', 'One', 'target', 1), article('three', 'Three', 'target target target', 2)],
  'target',
);
assert.equal(hitOrder[0].article.id, 'three', 'more body hits score higher');
const tieOrder = searchArticles([article('old', 'Same', 'target', 1), article('new', 'Same', 'target', 3)], 'target');
assert.equal(tieOrder[0].article.id, 'new', 'equal score falls back to updatedAt');
const longSnippet = searchArticles(
  [article('long', 'Long', 'x'.repeat(120) + ' needle ' + 'y'.repeat(120))],
  'needle',
)[0].snippet;
assert.ok(longSnippet.startsWith('…') && longSnippet.endsWith('…'), 'long snippets mark both sides');
assert.ok(longSnippet.includes('needle'), 'long snippets keep the hit');
const startSnippet = searchArticles([article('start', 'Start', 'needle ' + 'z'.repeat(100))], 'needle')[0].snippet;
assert.ok(startSnippet.startsWith('needle') && startSnippet.endsWith('…'), 'start snippets mark only the tail');
assert.equal(searchArticles(docs, '  公众号  ').length, 2, 'query is trimmed');
assert.equal(searchArticles(docs, '公众号', 0).length, 0, 'limit 0 is honored');
assert.ok(searchArticles(docs, '')[0].snippet.length <= 100, 'empty-query snippets are bounded');
assert.ok(
  searchArticles(docs, '')[0].snippet.trim() === searchArticles(docs, '')[0].snippet,
  'empty-query snippets are trimmed',
);
const snakeHits = searchArticles(
  [article('snake', 'Tech', '检索标识符 QUANTUM_MATRIX_2026 与 _强调_ 文本')],
  'QUANTUM_MATRIX',
);
assert.equal(snakeHits.length, 1, 'intraword underscores in snake_case identifiers remain searchable');
assert.ok(
  snakeHits[0].snippet.includes('QUANTUM_MATRIX_2026') &&
    snakeHits[0].snippet.includes('强调') &&
    !snakeHits[0].snippet.includes('_强调_'),
);
