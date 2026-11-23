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
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    let index = haystack.indexOf(needle, selected.end);
    if (index < 0) index = haystack.indexOf(needle);
    if (index < 0) {
      options.notify(options.t('search.notFound'), 'error');
      return;
    }
    reveal(index, index + query.length);
  }

  function replaceOne(): void {
    const text = options.editorValue();
    const query = options.searchPanel.query;
    if (!query) return;
    const selected = options.selection();
    const current = text.slice(selected.start, selected.end);
    if (current.toLowerCase() !== query.toLowerCase()) {
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
    const needle = query.toLowerCase();
    const lowerNext = next.toLowerCase();
    let nextIdx = lowerNext.indexOf(needle, afterEnd);
    if (nextIdx < 0) nextIdx = lowerNext.indexOf(needle);
    if (nextIdx >= 0) reveal(nextIdx, nextIdx + query.length);
    else reveal(afterEnd, afterEnd);
  }

  function replaceAll(): void {
    const text = options.editorValue();
    const query = options.searchPanel.query;
    if (!query) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'gi');
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
