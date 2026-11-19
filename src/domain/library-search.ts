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

function snippetAround(text: string, query: string): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(query);
  if (at < 0) return compact(text.slice(0, 100));
  const start = Math.max(0, at - 36);
  const end = Math.min(text.length, at + query.length + 52);
  return (start > 0 ? '…' : '') + compact(text.slice(start, end)) + (end < text.length ? '…' : '');
}

export function searchArticles(docs: Article[], rawQuery: string, limit = 50): LibrarySearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  const results: LibrarySearchResult[] = [];
  for (const article of docs) {
    const plain = markdownToPlain(article.markdown);
    if (!query) {
      results.push({ article, snippet: compact(plain).slice(0, 100), titleMatch: false, score: 0 });
      continue;
    }
    const titleIndex = article.title.toLowerCase().indexOf(query);
    const bodyIndex = plain.toLowerCase().indexOf(query);
    if (titleIndex < 0 && bodyIndex < 0) continue;
    const hits = plain.toLowerCase().split(query).length - 1;
    results.push({
      article,
      snippet: bodyIndex >= 0 ? snippetAround(plain, query) : compact(plain).slice(0, 100),
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
