import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';

export interface SetMarkdownOptions {
  boundary?: boolean;
  title?: string;
  prevSelection?: SelectionRange;
  resetHistory?: boolean;
}

interface HistoryEntry {
  markdown: string;
  selStart: number;
  selEnd: number;
}

interface HistoryState {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  undoChars: number;
  redoChars: number;
  lastAt: number;
  forceBoundary: boolean;
}

export interface DocumentHistoryOptions {
  React: typeof ReactNamespace;
  initialMarkdown: string;
  onApply: (markdown: string, title?: string) => void;
  getSelection: () => SelectionRange;
  focusRange: (start: number, end: number) => void;
}

export interface DocumentHistoryApi {
  markdownRef: { current: string };
  lastSelectionRef: { current: SelectionRange };
  setMarkdown: (next: string, options?: SetMarkdownOptions) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  reset: (markdown: string) => void;
  historyMarkdowns: () => string[];
}

/**
 * Document-level Undo/Redo & synchronous draft coordinator.
 *
 * Why a dedicated history stack instead of CodeMirror's built-in `@codemirror/commands` history:
 * 1. Toolbar formatting, Slash commands, image insertion, and AI Writing Skill patches rewrite
 *    full string slices via `setMarkdown(next, { boundary: true })`, which would reset or
 *    desynchronize internal EditorView transaction history.
 * 2. Both CodeMirror 6 and the fallback `<textarea>` (used in JSDOM tests and error recovery)
 *    share identical Undo/Redo semantics and selection restoration through this single coordinator.
 */
export function useDocumentHistory(options: DocumentHistoryOptions): DocumentHistoryApi {
  const React = options.React;
  const markdownRef = React.useRef<string>(options.initialMarkdown);
  const historyRef = React.useRef<HistoryState>({
    undo: [],
    redo: [],
    undoChars: 0,
    redoChars: 0,
    lastAt: 0,
    forceBoundary: true,
  });
  const lastSelectionRef = React.useRef<SelectionRange>({
    start: options.initialMarkdown.length,
    end: options.initialMarkdown.length,
  });

  function setMarkdown(next: string, nextOptions?: SetMarkdownOptions): void {
    const previous = markdownRef.current;
    const opts = nextOptions || {};
    const history = historyRef.current;
    if (opts.resetHistory) {
      history.undo = [];
      history.redo = [];
      history.undoChars = 0;
      history.redoChars = 0;
      history.lastAt = 0;
      history.forceBoundary = true;
    }
    if (next === previous) {
      if (opts.title !== undefined) options.onApply(next, opts.title);
      return;
    }
    if (!opts.resetHistory) {
      const now = Date.now();
      const canCoalesce =
        !opts.boundary && !history.forceBoundary && history.undo.length > 0 && now - history.lastAt < 700;
      if (!canCoalesce) {
        const pre = opts.prevSelection || lastSelectionRef.current || { start: previous.length, end: previous.length };
        history.undo.push({ markdown: previous, selStart: pre.start, selEnd: pre.end });
        history.undoChars += previous.length;
        while (history.undo.length > 80 || history.undoChars > 3500000) {
          const dropped = history.undo.shift();
          if (!dropped) break;
          history.undoChars -= dropped.markdown.length;
        }
      }
      history.redo = [];
      history.redoChars = 0;
      history.lastAt = now;
      history.forceBoundary = !!opts.boundary;
    }
    markdownRef.current = next;
    options.onApply(next, opts.title);
  }

  function undo(): boolean {
    const history = historyRef.current;
    const entry = history.undo.pop();
    if (!entry) return false;
    const current = options.getSelection();
    const currentMarkdown = markdownRef.current;
    history.redo.push({ markdown: currentMarkdown, selStart: current.start, selEnd: current.end });
    history.redoChars += currentMarkdown.length;
    history.undoChars = Math.max(0, history.undoChars - entry.markdown.length);
    history.lastAt = 0;
    history.forceBoundary = true;
    markdownRef.current = entry.markdown;
    options.onApply(entry.markdown);
    options.focusRange(entry.selStart, entry.selEnd);
    return true;
  }

  function redo(): boolean {
    const history = historyRef.current;
    const entry = history.redo.pop();
    if (!entry) return false;
    const current = options.getSelection();
    const currentMarkdown = markdownRef.current;
    history.undo.push({ markdown: currentMarkdown, selStart: current.start, selEnd: current.end });
    history.undoChars += currentMarkdown.length;
    history.redoChars = Math.max(0, history.redoChars - entry.markdown.length);
    history.lastAt = 0;
    history.forceBoundary = true;
    markdownRef.current = entry.markdown;
    options.onApply(entry.markdown);
    options.focusRange(entry.selStart, entry.selEnd);
    return true;
  }

  function reset(markdown: string): void {
    markdownRef.current = markdown;
    lastSelectionRef.current = { start: markdown.length, end: markdown.length };
    historyRef.current = { undo: [], redo: [], undoChars: 0, redoChars: 0, lastAt: 0, forceBoundary: true };
  }

  return {
    markdownRef,
    lastSelectionRef,
    setMarkdown,
    undo,
    redo,
    canUndo: () => historyRef.current.undo.length > 0,
    canRedo: () => historyRef.current.redo.length > 0,
    reset,
    historyMarkdowns: () => [
      ...historyRef.current.undo.map((entry) => entry.markdown),
      ...historyRef.current.redo.map((entry) => entry.markdown),
    ],
  };
}
