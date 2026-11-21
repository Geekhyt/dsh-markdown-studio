import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';

export interface EditorShortcutsOptions {
  t: (key: string) => string;
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void;
  editorValue: () => string;
  selection: () => SelectionRange;
  replaceRange: (
    value: string,
    start: number,
    end: number,
    text: string,
    selectStart?: number | null,
    selectEnd?: number | null,
  ) => void;
  undo: () => void;
  redo: () => void;
  copyArticle: () => void;
  linkedFile: () => FileSystemFileHandle | null;
  saveLocalFile: (forceDialog?: boolean) => Promise<void>;
  persistNow: () => boolean;
  wrapSelection: (before: string, after: string, placeholder?: string) => void;
  setLinePrefix: (prefix: string) => void;
  applyHeadingLevel: (level: number) => void;
  insertMathBlock: () => void;
  insertCodeBlock: () => void;
  insertScrollBox: () => void;
  insertScrollXBox: () => void;
  insertTable: () => void;
  insertHr: () => void;
  openImagePicker: () => void;
  toggleLinkFootnotes: () => void;
  openSearch: () => void;
  runWritingSkill?: () => void;
  acceptAiReview?: () => boolean;
  cancelAiReview?: () => boolean;
}

function handleSaveShortcut(options: EditorShortcutsOptions): void {
  const currentFile = options.linkedFile();
  if (currentFile && typeof currentFile.createWritable === 'function') {
    void options.saveLocalFile(false);
    return;
  }
  const saved = options.persistNow();
  options.notify(options.t(saved ? 'toast.saved' : 'storage.saveFailed'), saved ? 'success' : 'error');
}

function handleActionKey(
  options: EditorShortcutsOptions,
  event: ReactNamespace.KeyboardEvent<HTMLElement>,
  key: string,
): boolean {
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) options.redo();
    else options.undo();
    return true;
  }
  if (key === 'y') {
    event.preventDefault();
    options.redo();
    return true;
  }
  if (key === 'enter' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    options.copyArticle();
    return true;
  }
  if (key === 'j' && !event.altKey && !event.shiftKey && options.runWritingSkill) {
    event.preventDefault();
    options.runWritingSkill();
    return true;
  }
  if (key === 's' && !event.altKey) {
    event.preventDefault();
    handleSaveShortcut(options);
    return true;
  }
  return false;
}

type AltAction = (options: EditorShortcutsOptions, shiftKey: boolean) => void;

const ALT_CODE_MAP: Record<string, AltAction> = {
  KeyE: (options, shiftKey) => {
    if (shiftKey) options.insertMathBlock();
    else options.wrapSelection('$', '$', options.t('toolbar.inlineMath'));
  },
  Digit4: (options) => options.setLinePrefix('- [ ] '),
  KeyC: (options) => options.insertCodeBlock(),
  KeyT: (options) => options.insertTable(),
  KeyP: (options) => options.openImagePicker(),
  Minus: (options) => options.insertHr(),
  KeyV: (options) => options.insertScrollBox(),
  KeyX: (options) => options.insertScrollXBox(),
  KeyL: (options) => options.toggleLinkFootnotes(),
};

const ALT_KEY_TO_CODE: Record<string, string> = {
  e: 'KeyE',
  '4': 'Digit4',
  c: 'KeyC',
  t: 'KeyT',
  p: 'KeyP',
  '-': 'Minus',
  v: 'KeyV',
  x: 'KeyX',
  l: 'KeyL',
};

function handleAltShortcut(
  options: EditorShortcutsOptions,
  event: ReactNamespace.KeyboardEvent<HTMLElement>,
  key: string,
  code: string,
): boolean {
  if (!event.altKey) return false;
  const resolved = ALT_CODE_MAP[code] ? code : ALT_KEY_TO_CODE[key] || '';
  const action = resolved ? ALT_CODE_MAP[resolved] : undefined;
  if (!action) return false;
  event.preventDefault();
  action(options, event.shiftKey);
  return true;
}

function handleShiftFormattingKey(
  options: EditorShortcutsOptions,
  event: ReactNamespace.KeyboardEvent<HTMLElement>,
  key: string,
  code: string,
): boolean {
  if (!event.shiftKey) return false;
  if (key === 'b') {
    event.preventDefault();
    options.wrapSelection('**', '**', options.t('toolbar.bold'));
    return true;
  }
  if (key === 'e') {
    event.preventDefault();
    options.wrapSelection('$', '$', options.t('toolbar.inlineMath'));
    return true;
  }
  if (key === 'x') {
    event.preventDefault();
    options.wrapSelection('~~', '~~', options.t('toolbar.strike'));
    return true;
  }
  if (key === 'h') {
    event.preventDefault();
    options.wrapSelection('==', '==', options.t('toolbar.mark'));
    return true;
  }
  if (code === 'Digit7') {
    event.preventDefault();
    options.setLinePrefix('1. ');
    return true;
  }
  if (code === 'Digit8') {
    event.preventDefault();
    options.setLinePrefix('- ');
    return true;
  }
  if (code === 'Digit9') {
    event.preventDefault();
    options.setLinePrefix('> ');
    return true;
  }
  if (code === 'Digit0') {
    event.preventDefault();
    options.setLinePrefix('');
    return true;
  }
  return false;
}

function handlePlainFormattingKey(
  options: EditorShortcutsOptions,
  event: ReactNamespace.KeyboardEvent<HTMLElement>,
  key: string,
  code: string,
): void {
  if (event.shiftKey || event.altKey) return;
  if (key === 'u') {
    event.preventDefault();
    options.wrapSelection('++', '++', options.t('toolbar.underline'));
    return;
  }
  if (key === 'f') {
    event.preventDefault();
    options.openSearch();
    return;
  }
  if (key === 'i') {
    event.preventDefault();
    options.wrapSelection('*', '*', options.t('toolbar.italic'));
    return;
  }
  if (key === 'k') {
    event.preventDefault();
    options.wrapSelection('[', '](https://)', options.t('toolbar.link'));
    return;
  }
  if (key === 'e') {
    event.preventDefault();
    options.wrapSelection('`', '`', options.t('toolbar.code'));
    return;
  }
  if (/^Digit[1-6]$/.test(code)) {
    event.preventDefault();
    options.applyHeadingLevel(Number(code.slice(5)));
  }
}

function isEmbeddedInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.closest('.mdstudio-ai-inline-card')) return true;
  if (el.tagName === 'TEXTAREA') return false;
  if (el.closest('button, a, input, select')) return true;
  return Boolean(el.closest('.cm-scroller') && !el.closest('.cm-content'));
}

function indentOrOutdentSelection(options: EditorShortcutsOptions, shiftKey: boolean): void {
  const value = options.editorValue();
  const range = options.selection();
  if (shiftKey) {
    const lineStart = range.start > 0 ? value.lastIndexOf('\n', range.start - 1) + 1 : 0;
    const match = /^(?: {2}|\t)/.exec(value.slice(lineStart));
    if (match) {
      const drop = match[0].length;
      options.replaceRange(
        value,
        lineStart,
        lineStart + drop,
        '',
        Math.max(lineStart, range.start - drop),
        Math.max(lineStart, range.end - drop),
      );
    }
    return;
  }
  options.replaceRange(value, range.start, range.end, '  ', range.start + 2, range.start + 2);
}

const ESCAPE_TAB_ARMED = new WeakMap<object, boolean>();
const FALLBACK_SCOPE = {};

function escapeScopeOf(event: ReactNamespace.KeyboardEvent<HTMLElement>): object {
  return (event.currentTarget as object | null) || (event.target as object | null) || FALLBACK_SCOPE;
}

const MODIFIER_ONLY_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

function handleNonModKey(options: EditorShortcutsOptions, event: ReactNamespace.KeyboardEvent<HTMLElement>): boolean {
  const scope = escapeScopeOf(event);
  if (event.key === 'Escape') {
    if (options.cancelAiReview && options.cancelAiReview() === true) {
      ESCAPE_TAB_ARMED.delete(scope);
      event.preventDefault();
      return true;
    }
    // WCAG 2.1.2 keyboard escape hatch: Escape followed by Tab/Shift+Tab releases focus from the editor.
    ESCAPE_TAB_ARMED.set(scope, true);
    return false;
  }
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (ESCAPE_TAB_ARMED.get(scope) || isEmbeddedInteractiveTarget(event.target)) {
      ESCAPE_TAB_ARMED.delete(scope);
      return true;
    }
    event.preventDefault();
    if (!event.shiftKey && options.acceptAiReview && options.acceptAiReview() === true) return true;
    indentOrOutdentSelection(options, event.shiftKey);
    return true;
  }
  if (!MODIFIER_ONLY_KEYS.has(event.key)) ESCAPE_TAB_ARMED.delete(scope);
  return false;
}

export function createEditorShortcuts(
  options: EditorShortcutsOptions,
): (event: ReactNamespace.KeyboardEvent<HTMLElement>) => void {
  return function handleEditorShortcut(event: ReactNamespace.KeyboardEvent<HTMLElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (handleNonModKey(options, event)) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = String(event.key || '').toLowerCase();
    const code = event.code || (/^[0-9]$/.test(key) ? 'Digit' + key : '');
    if (handleActionKey(options, event, key)) return;
    if (handleAltShortcut(options, event, key, code)) return;
    if (handleShiftFormattingKey(options, event, key, code)) return;
    handlePlainFormattingKey(options, event, key, code);
  };
}
