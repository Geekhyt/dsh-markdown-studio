import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';
import type { ThemeSettings } from '../themes';

export interface FormattingOptions {
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
  setMarkdown: (value: string, options: { boundary?: boolean; prevSelection?: SelectionRange }) => void;
  focusRange: (start: number, end: number) => void;
  clearSlash: () => void;
  imageRef: ReactNamespace.RefObject<HTMLInputElement | null>;
  t: (key: string) => string;
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void;
  settings: ThemeSettings;
  updateSettings: (patch: Partial<ThemeSettings>) => void;
}

export interface InsertBlockOptions {
  collapseToEnd?: boolean;
}

export interface FormattingApi {
  wrapSelection: (before: string, after: string, placeholder?: string) => void;
  setLinePrefix: (prefix: string) => void;
  applyHeadingLevel: (level: number) => void;
  insertBlock: (block: string, blockOptions?: InsertBlockOptions) => void;
  insertQuote: () => void;
  insertAlert: () => void;
  insertList: () => void;
  insertTaskList: () => void;
  insertCode: () => void;
  insertTable: () => void;
  insertHr: () => void;
  insertFencedBlock: (fence: string) => void;
  insertCodeBlock: () => void;
  insertMathBlock: () => void;
  insertScrollBox: () => void;
  insertScrollXBox: () => void;
  insertMeta: () => void;
  insertLead: () => void;
  insertTldr: () => void;
  insertPull: () => void;
  insertSign: () => void;
  toggleLinkFootnotes: () => void;
  openImagePicker: () => void;
}

function resolveBlockSelection(
  start: number,
  leadLen: number,
  blockLen: number,
  totalLen: number,
  collapseToEnd?: boolean,
): [number, number] {
  if (collapseToEnd) return [start + totalLen, start + totalLen];
  return [start + leadLen, start + leadLen + blockLen];
}

export function createFormattingCommands(options: FormattingOptions): FormattingApi {
  function wrapSelection(before: string, after: string, placeholder?: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end) || placeholder || '';
    const inserted = before + selected + after;
    options.replaceRange(
      value,
      range.start,
      range.end,
      inserted,
      range.start + before.length,
      range.start + before.length + selected.length,
    );
  }

  function setLinePrefix(prefix: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const lineStart = value.lastIndexOf('\n', range.start - 1) + 1;
    let lineEnd = value.indexOf('\n', range.start);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const stripped = line.replace(/^\s*(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?/, '');
    const next = value.slice(0, lineStart) + prefix + stripped + value.slice(lineEnd);
    const delta = prefix.length - (line.length - stripped.length);
    options.clearSlash();
    options.setMarkdown(next, { boundary: true, prevSelection: range });
    const start = Math.max(lineStart + prefix.length, range.start + delta);
    const end = Math.max(start, range.end + delta);
    options.focusRange(start, end);
  }

  function applyHeadingLevel(level: number): void {
    if (!level) {
      setLinePrefix('');
      return;
    }
    setLinePrefix(new Array(level + 1).join('#') + ' ');
  }

  function insertBlock(block: string, blockOptions?: InsertBlockOptions): void {
    const value = options.editorValue();
    const range = options.selection();
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    const lead = before.length === 0 || /\n\s*\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    const trail = after.length === 0 || /^\s*\n/.test(after) ? '\n' : '\n\n';
    const insertion = lead + block + trail;
    const [selStart, selEnd] = resolveBlockSelection(
      range.start,
      lead.length,
      block.length,
      insertion.length,
      blockOptions?.collapseToEnd,
    );
    options.replaceRange(value, range.start, range.end, insertion, selStart, selEnd);
  }

  function insertQuote(): void {
    setLinePrefix('> ');
  }

  function insertAlert(): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end).trim();
    const body = selected
      ? selected
          .split('\n')
          .map(function (line) {
            return '> ' + line;
          })
          .join('\n')
      : '> ' + options.t('slash.alertPlaceholder');
    insertBlock('> [!NOTE]\n' + body);
  }

  function insertList(): void {
    setLinePrefix('- ');
  }

  function insertTaskList(): void {
    setLinePrefix('- [ ] ');
  }

  function insertCode(): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end);
    if (selected.indexOf('\n') !== -1) {
      insertBlock('```js\n' + selected + '\n```');
    } else {
      wrapSelection('`', '`', options.t('toolbar.code'));
    }
  }

  function insertTable(): void {
    insertBlock(options.t('insert.tableTemplate'));
  }

  function insertHr(): void {
    insertBlock('---');
  }

  function insertFencedBlock(fence: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end);
    const block = fence + '\n' + selected + (selected && !/\n$/.test(selected) ? '\n' : '') + fence;
    insertBlock(block);
  }

  function insertCodeBlock(): void {
    insertFencedBlock('```');
  }

  function insertMathBlock(): void {
    insertFencedBlock('$$');
  }

  function insertContainerBlock(openTag: string, placeholderKey: string, defaultPrefix?: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end).trim();
    const prefix = selected ? '' : defaultPrefix || '';
    const inner = selected || options.t(placeholderKey);
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    const lead = before.length === 0 || /\n\s*\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    const trail = after.length === 0 || /^\s*\n/.test(after) ? '\n' : '\n\n';
    const header = openTag + '\n' + prefix;
    const block = header + inner + '\n:::';
    const insertion = lead + block + trail;
    const selectStart = range.start + lead.length + header.length;
    options.replaceRange(value, range.start, range.end, insertion, selectStart, selectStart + inner.length);
  }

  function insertScrollBox(): void {
    insertContainerBlock(':::scroll', 'scroll.verticalPlaceholder');
  }

  function insertScrollXBox(): void {
    insertContainerBlock(':::scroll-x', 'scroll.horizontalPlaceholder');
  }

  function insertMeta(): void {
    insertContainerBlock(':::meta', 'slash.metaPlaceholder');
  }

  function insertLead(): void {
    insertContainerBlock(':::lead', 'slash.leadPlaceholder');
  }

  function insertTldr(): void {
    insertContainerBlock(':::tldr', 'slash.tldrPlaceholder', '- ');
  }

  function insertPull(): void {
    insertContainerBlock(':::pull', 'slash.pullPlaceholder');
  }

  function insertSign(): void {
    insertContainerBlock(':::sign', 'slash.signPlaceholder');
  }

  function toggleLinkFootnotes(): void {
    options.updateSettings({ linkFootnotes: !options.settings.linkFootnotes });
    options.notify(options.t(options.settings.linkFootnotes ? 'toast.linkNotesOff' : 'toast.linkNotesOn'));
  }

  function openImagePicker(): void {
    if (options.imageRef.current) options.imageRef.current.click();
  }

  return {
    wrapSelection,
    setLinePrefix,
    applyHeadingLevel,
    insertBlock,
    insertQuote,
    insertAlert,
    insertList,
    insertTaskList,
    insertCode,
    insertTable,
    insertHr,
    insertFencedBlock,
    insertCodeBlock,
    insertMathBlock,
    insertScrollBox,
    insertScrollXBox,
    insertMeta,
    insertLead,
    insertTldr,
    insertPull,
    insertSign,
    toggleLinkFootnotes,
    openImagePicker,
  };
}
