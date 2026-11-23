import type * as ReactNamespace from 'react';
import type { Heading, SelectionRange } from '../domain/article';

export interface SearchState {
  open: boolean;
  query: string;
  replacement: string;
}

export interface EditorSearchOptions {
  editorValue: () => string;
  selection: () => SelectionRange;
  setMarkdown: (value: string, options: { boundary?: boolean; prevSelection?: SelectionRange }) => void;
  focusRange: (start: number, end: number) => void;
  revealRange?: (start: number, end: number) => void;
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void;
  t: (key: string) => string;
  searchPanel: SearchState;
  setSearchPanel: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<SearchState>>;
  searchInputRef: ReactNamespace.RefObject<HTMLInputElement | null>;
  setOutlineOpen: (open: boolean) => void;
}

export interface EditorSearchApi {
  openSearch: () => void;
  updateSearch: (patch: Partial<SearchState>) => void;
  findNext: () => void;
  replaceOne: () => void;
  replaceAll: () => void;
  focusHeading: (heading: Heading) => void;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findNextMatch(text: string, query: string, from: number): { start: number; end: number } | null {
  const pattern = new RegExp(escapeRegExp(query), 'gi');
  pattern.lastIndex = Math.max(0, Math.min(from, text.length));
  let match = pattern.exec(text);
  if (!match && from > 0) {
    pattern.lastIndex = 0;
    match = pattern.exec(text);
  }
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function isExactInsensitiveMatch(slice: string, query: string): boolean {
  return new RegExp('^' + escapeRegExp(query) + '$', 'i').test(slice);
}

export function createEditorSearch(options: EditorSearchOptions): EditorSearchApi {
  function openSearch(): void {
    options.setOutlineOpen(false);
    options.setSearchPanel(function (prev) {
      return Object.assign({}, prev, { open: true });
    });
    window.requestAnimationFrame(function () {
      const input = options.searchInputRef.current;
      if (!input) return;
      input.focus();
      if (typeof input.select === 'function') input.select();
    });
  }

  function updateSearch(patch: Partial<SearchState>): void {
    options.setSearchPanel(function (prev) {
      return Object.assign({}, prev, patch);
    });
  }

  function reveal(start: number, end: number): void {
    (options.revealRange || options.focusRange)(start, end);
  }

  function findNext(): void {
    const text = options.editorValue();
    const query = options.searchPanel.query;
    if (!query) return;
    const selected = options.selection();
    const found = findNextMatch(text, query, selected.end);
    if (!found) {
      options.notify(options.t('search.notFound'), 'error');
      return;
    }
    reveal(found.start, found.end);
  }

  function replaceOne(): void {
    const text = options.editorValue();
    const query = options.searchPanel.query;
    if (!query) return;
    const selected = options.selection();
    const current = text.slice(selected.start, selected.end);
    if (!isExactInsensitiveMatch(current, query)) {
      findNext();
      return;
    }
    const replacement = options.searchPanel.replacement;
    const next = text.slice(0, selected.start) + replacement + text.slice(selected.end);
    options.setMarkdown(next, {
      boundary: true,
      prevSelection: { start: selected.start, end: selected.end },
    });
    const afterEnd = selected.start + replacement.length;
    const nextMatch = findNextMatch(next, query, afterEnd);
    if (nextMatch) reveal(nextMatch.start, nextMatch.end);
    else reveal(afterEnd, afterEnd);
  }

  function replaceAll(): void {
    const text = options.editorValue();
    const query = options.searchPanel.query;
    if (!query) return;
    const pattern = new RegExp(escapeRegExp(query), 'gi');
    const count = (text.match(pattern) || []).length;
    if (!count) {
      options.notify(options.t('search.notFound'), 'error');
      return;
    }
    const replacement = options.searchPanel.replacement;
    const next = text.replace(pattern, function () {
      return replacement;
    });
    options.setMarkdown(next, { boundary: true });
    options.notify(count + ' ' + options.t('search.replaced'));
    reveal(0, 0);
  }

  function focusHeading(heading: Heading): void {
    options.focusRange(heading.start, heading.start + heading.length);
    options.setOutlineOpen(false);
  }

  return { openSearch, updateSearch, findNext, replaceOne, replaceAll, focusHeading };
}
