import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';

export interface SetMarkdownOptions {
  boundary?: boolean;
  composing?: boolean;
  title?: string;
  prevSelection?: SelectionRange;
  resetHistory?: boolean;
}

export function normalizeLineEndings(text: string): string {
  return text.indexOf('\r') === -1 ? text : text.replace(/\r\n?/g, '\n');
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
  coalesceStartAt: number;
  forceBoundary: boolean;
}

function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

export interface DocumentHistoryOptions {
  React: typeof ReactNamespace;
  initialMarkdown: string;
  onApply: (markdown: string, title?: string) => void;
  getSelection: () => SelectionRange;
  focusRange: (start: number, end: number) => void;
  now?: () => number;
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
  const initialNormalized = normalizeLineEndings(options.initialMarkdown);
  const markdownRef = React.useRef<string>(initialNormalized);
  const composingBaseRef = React.useRef<HistoryEntry | null>(null);
  const historyRef = React.useRef<HistoryState>({
    undo: [],
    redo: [],
    undoChars: 0,
    redoChars: 0,
    lastAt: 0,
    coalesceStartAt: 0,
    forceBoundary: true,
  });
  const lastSelectionRef = React.useRef<SelectionRange>({
    start: initialNormalized.length,
    end: initialNormalized.length,
  });

  function pushUndoSnapshot(history: HistoryState, entry: HistoryEntry): void {
    history.undo.push(entry);
    history.undoChars += entry.markdown.length;
    while (history.undo.length > 1 && (history.undo.length > 80 || history.undoChars > 3500000)) {
      const dropped = history.undo.shift();
      if (!dropped) break;
      history.undoChars -= dropped.markdown.length;
    }
  }

  function resetHistoryState(history: HistoryState): void {
    composingBaseRef.current = null;
    history.undo = [];
    history.redo = [];
    history.undoChars = 0;
    history.redoChars = 0;
    history.lastAt = 0;
    history.coalesceStartAt = 0;
    history.forceBoundary = true;
  }

  function snapshotSelection(previous: string, prevSelection?: SelectionRange): HistoryEntry {
    const pre = prevSelection || lastSelectionRef.current || { start: previous.length, end: previous.length };
    return { markdown: previous, selStart: pre.start, selEnd: pre.end };
  }

  function recordUndoChange(history: HistoryState, entry: HistoryEntry, boundary: boolean): void {
    const now = (options.now || Date.now)();
    pushUndoSnapshot(history, entry);
    history.redo = [];
    history.redoChars = 0;
    history.lastAt = now;
    history.coalesceStartAt = now;
    history.forceBoundary = boundary;
  }

  function applyComposingFrame(next: string, previous: string, opts: SetMarkdownOptions): void {
    if (!composingBaseRef.current) composingBaseRef.current = snapshotSelection(previous, opts.prevSelection);
    if (next !== previous) {
      markdownRef.current = next;
      options.onApply(next, opts.title);
    }
  }

  function flushComposingFrame(
    next: string,
    previous: string,
    opts: SetMarkdownOptions,
    history: HistoryState,
    pendingCompose: HistoryEntry,
  ): void {
    if (next !== pendingCompose.markdown && !opts.resetHistory) {
      recordUndoChange(history, pendingCompose, true);
    }
    if (next !== previous || opts.title !== undefined) {
      markdownRef.current = next;
      options.onApply(next, opts.title);
    }
  }

  function setMarkdown(rawNext: string, nextOptions?: SetMarkdownOptions): void {
    const next = normalizeLineEndings(rawNext);
    const previous = markdownRef.current;
    const opts = nextOptions || {};
    const history = historyRef.current;
    if (opts.resetHistory) resetHistoryState(history);
    if (opts.composing && !opts.resetHistory) {
      applyComposingFrame(next, previous, opts);
      return;
    }
    const pendingCompose = composingBaseRef.current;
    composingBaseRef.current = null;
    if (pendingCompose) {
      flushComposingFrame(next, previous, opts, history, pendingCompose);
      return;
    }
    if (next === previous) {
      if (opts.title !== undefined) options.onApply(next, opts.title);
      return;
    }
    if (!opts.resetHistory) {
      const now = (options.now || Date.now)();
      const lineBreakChanged = countLines(next) !== countLines(previous);
      const canCoalesce =
        !opts.boundary &&
        !history.forceBoundary &&
        !lineBreakChanged &&
        history.undo.length > 0 &&
        now - history.lastAt < 700 &&
        now - history.coalesceStartAt < 5000;
      if (!canCoalesce) {
        pushUndoSnapshot(history, snapshotSelection(previous, opts.prevSelection));
        history.coalesceStartAt = now;
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
    const pendingCompose = composingBaseRef.current;
    composingBaseRef.current = null;
    if (pendingCompose && markdownRef.current !== pendingCompose.markdown) {
      pushUndoSnapshot(history, pendingCompose);
    }
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
    lastSelectionRef.current = { start: entry.selStart, end: entry.selEnd };
    options.onApply(entry.markdown);
    options.focusRange(entry.selStart, entry.selEnd);
    return true;
  }

  function redo(): boolean {
    composingBaseRef.current = null;
    const history = historyRef.current;
    const entry = history.redo.pop();
    if (!entry) return false;
    const current = options.getSelection();
    const currentMarkdown = markdownRef.current;
    pushUndoSnapshot(history, { markdown: currentMarkdown, selStart: current.start, selEnd: current.end });
    history.redoChars = Math.max(0, history.redoChars - entry.markdown.length);
    history.lastAt = 0;
    history.coalesceStartAt = 0;
    history.forceBoundary = true;
    markdownRef.current = entry.markdown;
    lastSelectionRef.current = { start: entry.selStart, end: entry.selEnd };
    options.onApply(entry.markdown);
    options.focusRange(entry.selStart, entry.selEnd);
    return true;
  }

  function reset(markdown: string): void {
    const normalized = normalizeLineEndings(markdown);
    composingBaseRef.current = null;
    markdownRef.current = normalized;
    lastSelectionRef.current = { start: normalized.length, end: normalized.length };
    historyRef.current = {
      undo: [],
      redo: [],
      undoChars: 0,
      redoChars: 0,
      lastAt: 0,
      coalesceStartAt: 0,
      forceBoundary: true,
    };
  }

  return {
    markdownRef,
    lastSelectionRef,
    setMarkdown,
    undo,
    redo,
    canUndo: () =>
      historyRef.current.undo.length > 0 ||
      Boolean(composingBaseRef.current && markdownRef.current !== composingBaseRef.current.markdown),
    canRedo: () => historyRef.current.redo.length > 0,
    reset,
    historyMarkdowns: () => [
      ...historyRef.current.undo.map((entry) => entry.markdown),
      ...historyRef.current.redo.map((entry) => entry.markdown),
    ],
  };
}
