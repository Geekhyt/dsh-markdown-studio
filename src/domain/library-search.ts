import type { Article } from './article';
import { markdownToPlain } from './article';

export interface LibrarySearchResult {
  article: Article;
  snippet: string;
  titleMatch: boolean;
  score: number;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeSlice(text: string, start: number, end: number): string {
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  if (s > 0 && s < text.length) {
    const code = text.charCodeAt(s);
    if (code >= 0xdc00 && code <= 0xdfff) s++;
  }
  if (e > s && e < text.length) {
    const prev = text.charCodeAt(e - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) e--;
  }
  return text.slice(s, e);
}

function snippetAround(text: string, query: string): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(query);
  if (at < 0) return safeSlice(text, 0, 100).trim();
  const start = Math.max(0, at - 36);
  const end = Math.min(text.length, at + query.length + 52);
  return (start > 0 ? '…' : '') + safeSlice(text, start, end).trim() + (end < text.length ? '…' : '');
}

export function searchArticles(docs: Article[], rawQuery: string, limit = 50): LibrarySearchResult[] {
  const query = compact(rawQuery).toLowerCase();
  const results: LibrarySearchResult[] = [];
  for (const article of docs) {
    const plain = compact(markdownToPlain(article.markdown));
    if (!query) {
      results.push({ article, snippet: safeSlice(plain, 0, 100), titleMatch: false, score: 0 });
      continue;
    }
    const titleIndex = compact(article.title).toLowerCase().indexOf(query);
    const bodyIndex = plain.toLowerCase().indexOf(query);
    if (titleIndex < 0 && bodyIndex < 0) continue;
    const hits = plain.toLowerCase().split(query).length - 1;
    results.push({
      article,
      snippet: bodyIndex >= 0 ? snippetAround(plain, query) : safeSlice(plain, 0, 100),
      titleMatch: titleIndex >= 0,
      score: (titleIndex >= 0 ? 1000 - titleIndex : 0) + hits * 10,
    });
  }
  results.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.article.updatedAt - a.article.updatedAt;
  });
  return results.slice(0, limit);
}
