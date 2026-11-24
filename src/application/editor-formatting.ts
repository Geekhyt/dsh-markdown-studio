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
  selectStart?: number;
  selectEnd?: number;
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
  blockOptions?: InsertBlockOptions,
): [number, number] {
  if (blockOptions?.selectStart != null) {
    const s = start + leadLen + blockOptions.selectStart;
    const e = start + leadLen + (blockOptions.selectEnd ?? blockOptions.selectStart);
    return [s, e];
  }
  if (blockOptions?.collapseToEnd) return [start + totalLen, start + totalLen];
  return [start + leadLen, start + leadLen + blockLen];
}

const LINE_PREFIX_STRIP_RE = /^([ \t]*)(?:#{1,6}\s+|>[ \t]*|[-+*]\s+(?:\[[ xX]\](?:\s+|$))?|\d{1,9}[.)]\s+)?/;

function hasMatchingLinePrefix(line: string, prefix: string, isOrdered: boolean): boolean {
  const trimmed = line.replace(/^[ \t]*/, '');
  if (!trimmed) return true;
  if (isOrdered) return /^\d{1,9}[.)]\s+/.test(trimmed);
  if (prefix === '- [ ] ') return /^[-+*]\s+\[[ xX]\](?:\s+|$)/.test(trimmed);
  if (prefix === '- ' && /^[-+*]\s+\[[ xX]\](?:\s+|$)/.test(trimmed)) return false;
  if (prefix === '> ') return /^>(?:[ \t]+|$)/.test(trimmed);
  return trimmed.startsWith(prefix);
}

function countMarkerRun(text: string, start: number, step: 1 | -1, ch: string): number {
  let count = 0;
  for (let i = start; i >= 0 && i < text.length && text.charAt(i) === ch; i += step) count++;
  return count;
}

function hasCleanInnerWrap(text: string, marker: string): boolean {
  const len = marker.length;
  if (text.length <= len * 2 || !text.startsWith(marker) || !text.endsWith(marker)) return false;
  if (len === 1) {
    const lead = countMarkerRun(text, 0, 1, marker);
    const trail = countMarkerRun(text, text.length - 1, -1, marker);
    if (lead % 2 === 0 || trail % 2 === 0) return false;
  }
  const inner = text.slice(len, text.length - len);
  if (len === 1) return !inner.includes(marker);
  return !inner.includes(marker);
}

function hasCleanOuterWrap(value: string, start: number, end: number, marker: string): boolean {
  const len = marker.length;
  if (start < len) return false;
  if (value.slice(start - len, start) !== marker || value.slice(end, end + len) !== marker) return false;
  if (len === 1) {
    const left = countMarkerRun(value, start - 1, -1, marker);
    const right = countMarkerRun(value, end, 1, marker);
    if (left % 2 === 0 || right % 2 === 0) return false;
  }
  return true;
}

function toggleMultiParagraph(selected: string, before: string, after: string): string {
  const segments = selected.split('\n').filter((line) => line.trim().length > 0);
  const allWrapped =
    before === after && segments.length > 0 && segments.every((segment) => hasCleanInnerWrap(segment, before));
  return selected.replace(/([^\n]+)/g, function (segment) {
    if (!segment.trim()) return segment;
    return allWrapped ? segment.slice(before.length, segment.length - after.length) : before + segment + after;
  });
}

function transformPrefixLine(line: string, prefix: string, index: number, isOrdered: boolean): string {
  const m = LINE_PREFIX_STRIP_RE.exec(line);
  const indent = m ? m[1] : '';
  const body = m ? line.slice(m[0].length) : line;
  const linePrefix = isOrdered ? index + 1 + '. ' : prefix;
  return indent + linePrefix + body;
}

export function createFormattingCommands(options: FormattingOptions): FormattingApi {
  function wrapSelection(before: string, after: string, placeholder?: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const selectedRaw = value.slice(range.start, range.end);
    if (selectedRaw && before === after) {
      const len = before.length;
      if (hasCleanOuterWrap(value, range.start, range.end, before)) {
        options.replaceRange(
          value,
          range.start - len,
          range.end + len,
          selectedRaw,
          range.start - len,
          range.end - len,
        );
        return;
      }
      if (/\n\s*\n/.test(selectedRaw)) {
        const toggled = toggleMultiParagraph(selectedRaw, before, after);
        options.replaceRange(value, range.start, range.end, toggled, range.start, range.start + toggled.length);
        return;
      }
      if (hasCleanInnerWrap(selectedRaw, before)) {
        const inner = selectedRaw.slice(len, selectedRaw.length - len);
        options.replaceRange(value, range.start, range.end, inner, range.start, range.start + inner.length);
        return;
      }
    }
    const selected = selectedRaw || placeholder || '';
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
    const blockStart = range.start > 0 ? value.lastIndexOf('\n', range.start - 1) + 1 : 0;
    const effectiveEnd = range.end > range.start && value[range.end - 1] === '\n' ? range.end - 1 : range.end;
    const rawEnd = value.indexOf('\n', effectiveEnd);
    const blockEnd = rawEnd === -1 ? value.length : rawEnd;
    const lines = value.slice(blockStart, blockEnd).split('\n');
    const isOrdered = /^\d+[.)]\s+$/.test(prefix);
    const hasContent = lines.some((line) => line.trim().length > 0);
    const toggleOff =
      Boolean(prefix) && hasContent && lines.every((line) => hasMatchingLinePrefix(line, prefix, isOrdered));
    const appliedPrefix = toggleOff ? '' : prefix;
    let orderIdx = 0;
    const updatedLines = lines.map((line) => {
      if (lines.length > 1 && !line.trim()) return line;
      return transformPrefixLine(line, appliedPrefix, orderIdx++, !toggleOff && isOrdered);
    });
    const replaced = updatedLines.join('\n');
    const next = value.slice(0, blockStart) + replaced + value.slice(blockEnd);
    options.clearSlash();
    options.setMarkdown(next, { boundary: true, prevSelection: range });
    if (lines.length === 1) {
      const delta = replaced.length - lines[0].length;
      const indentLen = (lines[0].match(/^[ \t]*/) || [''])[0].length;
      const start = Math.max(blockStart + indentLen + appliedPrefix.length, range.start + delta);
      const end = Math.max(start, range.end + delta);
      options.focusRange(start, end);
    } else {
      options.focusRange(blockStart, blockStart + replaced.length);
    }
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
      blockOptions,
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
    const placeholder = options.t('slash.alertPlaceholder');
    const body = selected
      ? selected
          .split('\n')
          .map(function (line) {
            return '> ' + line;
          })
          .join('\n')
      : '> ' + placeholder;
    const header = '> [!NOTE]\n';
    insertBlock(
      header + body,
      selected
        ? { collapseToEnd: true }
        : { selectStart: header.length + 2, selectEnd: header.length + 2 + placeholder.length },
    );
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
    insertBlock('---', { collapseToEnd: true });
  }

  function insertFencedBlock(fence: string): void {
    const value = options.editorValue();
    const range = options.selection();
    const selected = value.slice(range.start, range.end);
    const inner = selected ? selected + (/\n$/.test(selected) ? '' : '\n') : '\n';
    const block = fence + '\n' + inner + fence;
    const innerStart = fence.length + 1;
    insertBlock(
      block,
      selected
        ? { selectStart: innerStart, selectEnd: innerStart + selected.length }
        : { selectStart: innerStart, selectEnd: innerStart },
    );
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
