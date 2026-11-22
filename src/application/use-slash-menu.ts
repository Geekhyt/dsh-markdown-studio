import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';
import { clamp } from '../domain/settings';
import { computeSafePopoverPos, computeUnobstructedWidth } from '../domain/surface-geometry';
import { collectSurfaceObstacles } from '../runtime/dom-surfaces';
import { useDocumentEvent } from '../runtime/react-lifecycle';

export type SlashIconKey =
  | 'quote'
  | 'info'
  | 'code'
  | 'table'
  | 'checkSquare'
  | 'listBullet'
  | 'listOrdered'
  | 'image'
  | 'link'
  | 'minus'
  | 'paragraph'
  | 'pencil'
  | 'sparkles'
  | 'scrollY'
  | 'scrollX';

export interface SlashCommandEntry {
  id: string;
  icon: string;
  iconName?: SlashIconKey;
  label: string;
  hint: string;
  text: string;
  keywords: string[];
  selectStart?: number;
  selectEnd?: number;
}

interface SlashState {
  start: number;
  end: number;
  query: string;
  selected: number;
  pos: { top: number; left: number } | null;
}

export interface SlashMenuOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  rootRef: ReactNamespace.RefObject<HTMLDivElement | null>;
  editorValue: () => string;
  selection: () => SelectionRange;
  coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number } | null;
  setMarkdown: (next: string, options?: { boundary?: boolean; prevSelection?: SelectionRange }) => void;
  focusRange: (start: number, end: number) => void;
  closeOutline: () => void;
}

export interface SlashMenuApi {
  open: boolean;
  items: SlashCommandEntry[];
  selected: number;
  pos: { top: number; left: number } | null;
  close: () => void;
  selectIndex: (index: number) => void;
  syncAtCaret: (value: string, caret: number) => void;
  refreshFromCaret: () => void;
  applyCommand: (index: number) => void;
  handleKeyDown: (event: ReactNamespace.KeyboardEvent<HTMLElement>, blocked: boolean) => boolean;
}

function buildSlashCommands(t: (key: string) => string): SlashCommandEntry[] {
  const vPlaceholder = t('scroll.verticalPlaceholder');
  const hPlaceholder = t('scroll.horizontalPlaceholder');
  const alertTitle = t('insert.alertTitle');
  const imageAlt = t('insert.imageAlt');
  const linkText = t('insert.linkText');
  return [
    { id: 'h1', icon: 'H1', label: t('slash.h1'), hint: '#', text: '# ', keywords: ['h1', 'heading', '标题', '一级'] },
    {
      id: 'h2',
      icon: 'H2',
      label: t('slash.h2'),
      hint: '##',
      text: '## ',
      keywords: ['h2', 'heading', '标题', '二级'],
    },
    {
      id: 'h3',
      icon: 'H3',
      label: t('slash.h3'),
      hint: '###',
      text: '### ',
      keywords: ['h3', 'heading', '标题', '三级'],
    },
    {
      id: 'h4',
      icon: 'H4',
      label: t('slash.h4'),
      hint: '####',
      text: '#### ',
      keywords: ['h4', 'heading', '标题', '四级'],
    },
    {
      id: 'h5',
      icon: 'H5',
      label: t('slash.h5'),
      hint: '#####',
      text: '##### ',
      keywords: ['h5', 'heading', '标题', '五级'],
    },
    {
      id: 'h6',
      icon: 'H6',
      label: t('slash.h6'),
      hint: '######',
      text: '###### ',
      keywords: ['h6', 'heading', '标题', '六级'],
    },
    {
      id: 'quote',
      icon: '',
      iconName: 'quote',
      label: t('slash.quote'),
      hint: '>',
      text: '> ',
      keywords: ['quote', '引用'],
    },
    {
      id: 'alert',
      icon: '',
      iconName: 'info',
      label: t('slash.alert'),
      hint: '> [!NOTE]',
      text: '> [!NOTE] ' + alertTitle + '\n> ',
      selectStart: 10,
      selectEnd: 10 + alertTitle.length,
      keywords: ['alert', 'note', 'tip', 'callout', '提示', '提示块'],
    },
    {
      id: 'code',
      icon: '',
      iconName: 'code',
      label: t('slash.code'),
      hint: '```',
      text: '```js\n\n```',
      selectStart: 6,
      selectEnd: 6,
      keywords: ['code', '代码', '代码块'],
    },
    {
      id: 'table',
      icon: '',
      iconName: 'table',
      label: t('slash.table'),
      hint: '| --- |',
      text: t('insert.tableTemplate'),
      keywords: ['table', '表格'],
    },
    {
      id: 'task',
      icon: '',
      iconName: 'checkSquare',
      label: t('slash.task'),
      hint: '- [ ]',
      text: '- [ ] ',
      keywords: ['task', 'todo', '任务', '清单'],
    },
    {
      id: 'bullet',
      icon: '',
      iconName: 'listBullet',
      label: t('slash.bullet'),
      hint: '-',
      text: '- ',
      keywords: ['list', 'bullet', '列表', '无序'],
    },
    {
      id: 'numbered',
      icon: '',
      iconName: 'listOrdered',
      label: t('slash.numbered'),
      hint: '1.',
      text: '1. ',
      keywords: ['list', 'number', '列表', '有序'],
    },
    {
      id: 'image',
      icon: '',
      iconName: 'image',
      label: t('slash.image'),
      hint: '![]()',
      text: '![' + imageAlt + '](https://)',
      selectStart: 2,
      selectEnd: 2 + imageAlt.length,
      keywords: ['image', 'img', '图片', '图'],
    },
    {
      id: 'link',
      icon: '',
      iconName: 'link',
      label: t('slash.link'),
      hint: '[]()',
      text: '[' + linkText + '](https://)',
      selectStart: 1,
      selectEnd: 1 + linkText.length,
      keywords: ['link', '链接'],
    },
    {
      id: 'divider',
      icon: '',
      iconName: 'minus',
      label: t('slash.divider'),
      hint: '---',
      text: '---',
      keywords: ['divider', 'hr', '分割线', '分隔线'],
    },
    {
      id: 'scroll',
      icon: '',
      iconName: 'scrollY',
      label: t('slash.scroll'),
      hint: ':::scroll',
      text: ':::scroll\n' + vPlaceholder + '\n:::',
      selectStart: 10,
      selectEnd: 10 + vPlaceholder.length,
      keywords: ['scroll', 'prompt', 'drawer', '滑动', '上下滑动', '抽屉', '长文'],
    },
    {
      id: 'scroll-x',
      icon: '',
      iconName: 'scrollX',
      label: t('slash.scrollX'),
      hint: ':::scroll-x',
      text: ':::scroll-x\n' + hPlaceholder + '\n:::',
      selectStart: 12,
      selectEnd: 12 + hPlaceholder.length,
      keywords: ['scroll-x', 'scrollx', 'swipe', 'carousel', 'gallery', '左右滑动', '横滑', '画廊', '轮播'],
    },
    {
      id: 'meta',
      icon: '',
      iconName: 'sparkles',
      label: t('slash.meta'),
      hint: ':::meta',
      text: ':::meta ' + t('slash.metaPlaceholder'),
      selectStart: 8,
      selectEnd: 8 + t('slash.metaPlaceholder').length,
      keywords: ['meta', 'eyebrow', 'kicker', '眉题', '栏目', '阅读时长'],
    },
    {
      id: 'lead',
      icon: '',
      iconName: 'paragraph',
      label: t('slash.lead'),
      hint: ':::lead',
      text: ':::lead\n' + t('slash.leadPlaceholder') + '\n:::',
      selectStart: 8,
      selectEnd: 8 + t('slash.leadPlaceholder').length,
      keywords: ['lead', 'intro', 'standfirst', '导语', '引言', '开场', '开篇'],
    },
    {
      id: 'tldr',
      icon: '',
      iconName: 'listBullet',
      label: t('slash.tldr'),
      hint: ':::tldr',
      text: ':::tldr\n- ' + t('slash.tldrPlaceholder') + '\n:::',
      selectStart: 10,
      selectEnd: 10 + t('slash.tldrPlaceholder').length,
      keywords: ['tldr', 'summary', 'highlights', '速览', '要点', '摘要', '导览', '提要'],
    },
    {
      id: 'pull',
      icon: '',
      iconName: 'quote',
      label: t('slash.pull'),
      hint: ':::pull',
      text: ':::pull\n' + t('slash.pullPlaceholder') + '\n:::',
      selectStart: 8,
      selectEnd: 8 + t('slash.pullPlaceholder').length,
      keywords: ['pull', 'pullquote', 'highlight', '金句', '摘录'],
    },
    {
      id: 'sign',
      icon: '',
      iconName: 'pencil',
      label: t('slash.sign'),
      hint: ':::sign',
      text: ':::sign\n' + t('slash.signPlaceholder') + '\n:::',
      selectStart: 8,
      selectEnd: 8 + t('slash.signPlaceholder').length,
      keywords: ['sign', 'signoff', 'footer', 'ending', '落款', '结尾', '署名'],
    },
  ];
}

function matchSlashItems(items: SlashCommandEntry[], rawQuery: string): SlashCommandEntry[] {
  const query = rawQuery.toLowerCase();
  if (!query) return items;
  return items.filter(function (item) {
    if (item.label.toLowerCase().includes(query)) return true;
    return item.keywords.some(function (kw) {
      return kw.toLowerCase().includes(query);
    });
  });
}

function resolveSlashTop(coords: { top: number; bottom: number }, wrapTop: number, wrapHeight: number): number {
  const maxTop = Math.max(8, Math.round(wrapHeight - 120));
  const rawBelow = Math.round(coords.bottom - wrapTop + 6);
  const spaceBelow = wrapHeight - rawBelow;
  const spaceAbove = coords.top - wrapTop - 6;
  const preferBelow = spaceBelow >= Math.min(220, wrapHeight - 16) || spaceBelow >= spaceAbove;
  if (preferBelow) return clamp(rawBelow, 8, maxTop);
  return clamp(Math.round(coords.top - wrapTop - Math.min(348, spaceAbove) - 6), 8, maxTop);
}

function computeSlashPos(
  rootEl: HTMLElement | null,
  coordsAtPos: SlashMenuOptions['coordsAtPos'],
  pos: number,
): { top: number; left: number } | null {
  const wrap = rootEl?.querySelector<HTMLElement>('.mdstudio-editor-wrap');
  const coords = coordsAtPos?.(pos);
  if (!wrap || !coords) return null;
  const rect = wrap.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const obstacles = collectSurfaceObstacles(rootEl);
  const availWidth = computeUnobstructedWidth(rect, obstacles);
  const menuW = Math.min(320, Math.max(180, availWidth - 20));
  const preferredTop = resolveSlashTop(coords, rect.top, rect.height);
  const placed = computeSafePopoverPos({
    surface: rect,
    width: menuW,
    height: Math.min(220, Math.max(120, rect.height - 16)),
    preferredLeft: coords.left - rect.left,
    preferredTop,
    pad: 10,
    obstacles,
  });
  return { top: placed.top, left: placed.left };
}

function scrollActiveSlashItem(rootEl: HTMLElement | null): void {
  if (typeof window === 'undefined' || !rootEl) return;
  window.requestAnimationFrame(function () {
    const active = rootEl.querySelector('.mdstudio-slash-item.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      try {
        active.scrollIntoView({ block: 'nearest' });
      } catch {
        /* ignore */
      }
    }
  });
}

export function useSlashMenu(options: SlashMenuOptions): SlashMenuApi {
  const { React, t, rootRef } = options;
  const [slash, setSlash] = React.useState<SlashState | null>(null);

  const matches = slash ? matchSlashItems(buildSlashCommands(t), slash.query) : [];
  const selected = slash ? clamp(slash.selected, 0, Math.max(0, matches.length - 1)) : 0;

  useDocumentEvent(
    React,
    'mousedown',
    function (event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.mdstudio-slash')) return;
      setSlash(null);
    },
    Boolean(slash),
  );

  function close(): void {
    setSlash(null);
  }

  function selectIndex(index: number): void {
    setSlash(function (prev) {
      return prev ? { ...prev, selected: index } : prev;
    });
  }

  function syncAtCaret(value: string, caret: number): void {
    const previousBreak = caret > 0 ? value.lastIndexOf('\n', caret - 1) : -1;
    const lineStart = previousBreak + 1;
    const line = value.slice(lineStart, caret);
    const match = /^\s*\/([^\s/]{0,18})$/.exec(line);
    if (!match) {
      if (slash) setSlash(null);
      return;
    }
    const slashStart = lineStart + line.indexOf('/');
    options.closeOutline();
    const pos = computeSlashPos(rootRef.current, options.coordsAtPos, slashStart);
    setSlash({ start: slashStart, end: caret, query: match[1], selected: 0, pos });
    scrollActiveSlashItem(rootRef.current);
  }

  function refreshFromCaret(): void {
    const range = options.selection();
    if (range.start !== range.end) {
      setSlash(null);
      return;
    }
    syncAtCaret(options.editorValue(), range.start);
  }

  function applyCommand(index: number): void {
    const command = matches[index];
    if (!slash || !command) return;
    const value = options.editorValue();
    const range = options.selection();
    const typed = value.slice(slash.start, range.start);
    if (!/^\/[^\s/]*$/.test(typed)) {
      setSlash(null);
      return;
    }
    const next = value.slice(0, slash.start) + command.text + value.slice(range.start);
    const selStart = slash.start + (command.selectStart == null ? command.text.length : command.selectStart);
    const selEnd = slash.start + (command.selectEnd == null ? command.text.length : command.selectEnd);
    setSlash(null);
    options.setMarkdown(next, { boundary: true, prevSelection: range });
    options.focusRange(selStart, selEnd);
  }

  function handleKeyDown(event: ReactNamespace.KeyboardEvent<HTMLElement>, blocked: boolean): boolean {
    if (!slash || blocked) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setSlash(null);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length) {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (selected + delta + matches.length) % matches.length;
        setSlash({ ...slash, selected: nextIndex });
        scrollActiveSlashItem(rootRef.current);
      }
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (!matches.length) {
        if (event.key === 'Enter') setSlash(null);
        return false;
      }
      event.preventDefault();
      applyCommand(selected);
      return true;
    }
    return false;
  }

  return {
    open: Boolean(slash),
    items: matches,
    selected,
    pos: slash ? slash.pos : null,
    close,
    selectIndex,
    syncAtCaret,
    refreshFromCaret,
    applyCommand,
    handleKeyDown,
  };
}
