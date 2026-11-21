import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { disarmEscapeTab } from '../application/editor-shortcuts';
import type { AiReviewSession } from '../application/use-writing-skills';
import type { Heading } from '../domain/article';
import type { EditorApi, EditorDiffTransition, EditorInlineBlock, EditorSelection } from '../domain/editor-types';
import type { WritingSkill } from '../domain/writing-skills';
import { useDocumentEvent } from '../runtime/react-lifecycle';
import type { DshMenuEntry } from '../types/dsh-primitives';
import { CodeMirrorEditor } from './codemirror-editor';
import type { IconName } from './icons';
import { toMenuShortcut } from './shortcut-model';
import { AiReviewOverlay, SkillSplitTrigger } from './skill-controls';
import type { UiKit } from './ui-kit';

export interface EditorToolbarModel {
  modKey: string;
  shiftKey: string;
  altKey: string;
  linkFootnotes: boolean;
  canUndo: boolean;
  canRedo: boolean;
  fileConflict: boolean;
  permission: 'granted' | 'prompt' | 'denied';
  onAuthorize: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onHeadingLevel: (level: number) => void;
  onBold: () => void;
  onItalic: () => void;
  onStrike: () => void;
  onUnderline: () => void;
  onInlineMath: () => void;
  onOrderedList: () => void;
  onTaskList: () => void;
  onAlert: () => void;
  onCodeBlock: () => void;
  onMathBlock: () => void;
  onScrollBox: () => void;
  onScrollXBox: () => void;
  onMeta: () => void;
  onLead: () => void;
  onTldr: () => void;
  onPull: () => void;
  onSign: () => void;
  onToggleLinkFootnotes: () => void;
  onMark: () => void;
  onQuote: () => void;
  onCode: () => void;
  onLink: () => void;
  onImage: () => void;
  onList: () => void;
  onTable: () => void;
  onHr: () => void;
  onSearch: () => void;
  onOutline: () => void;
  onReload: () => void;
}

export interface SlashItem {
  id: string;
  icon: string;
  iconName?: IconName;
  label: string;
  hint: string;
}

export interface EditorSlashModel {
  open: boolean;
  items: SlashItem[];
  selected: number;
  onSelect: (index: number) => void;
  onApply: (index: number) => void;
}

export interface EditorSearchModel {
  open: boolean;
  query: string;
  replacement: string;
  inputRef: ReactNamespace.RefObject<HTMLInputElement | null>;
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onFind: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export interface EditorOutlineModel {
  open: boolean;
  headings: Heading[];
  onFocus: (heading: Heading) => void;
  onClose: () => void;
}

export interface EditorContentModel {
  useCodeMirror: boolean;
  markdown: string;
  placeholder: string;
  textareaRef: ReactNamespace.RefObject<HTMLTextAreaElement | null>;
  onReady: (api: EditorApi | null) => void;
  onError: () => void;
  onPointerDown?: (event: ReactNamespace.MouseEvent<HTMLDivElement>) => void;
  onChange: (value: string, selection: EditorSelection) => void;
  onSelection: (selection: EditorSelection) => void;
  onKeyDown: (event: ReactNamespace.KeyboardEvent<HTMLElement>) => void;
  onPaste: (event: ReactNamespace.ClipboardEvent<HTMLElement>) => void;
  onDrop: (event: ReactNamespace.DragEvent<HTMLElement>) => void;
  onBlur: () => void;
  onTextareaInput: (
    value: string,
    caret: number,
    boundary: boolean,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onTextareaSelect: (selectionStart: number, selectionEnd: number) => void;
  onTextareaScroll: () => void;
  onRefreshSlash: () => void;
}

export interface EditorAiModel {
  skills: readonly WritingSkill[];
  activeSkill: WritingSkill;
  session: AiReviewSession | null;
  inlineBlocks: readonly EditorInlineBlock[];
  diffTransition: EditorDiffTransition | null;
  selectionBubblePos: { top: number; left: number } | null;
  onRunSkill: (skill?: WritingSkill) => void;
  onOpenManager: () => void;
  onCancel: () => void;
}

export interface EditorPaneProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  visible: boolean;
  ui: UiKit;
  stats: { words: number; chars: number };
  toolbar: EditorToolbarModel;
  slash: EditorSlashModel;
  search: EditorSearchModel;
  outline: EditorOutlineModel;
  content: EditorContentModel;
  ai?: EditorAiModel;
}

interface FormatEntry {
  id: string;
  label: string;
  shortcutParts: readonly string[];
  icon?: string;
  iconName?: IconName;
  run: () => void;
}

interface FormatGroup {
  label: string;
  entries: FormatEntry[];
}

function buildFormatGroups(t: (key: string) => string, toolbar: EditorToolbarModel): FormatGroup[] {
  const mod = toolbar.modKey;
  const shift = toolbar.shiftKey;
  const alt = toolbar.altKey;
  const headingEntries: FormatEntry[] = [
    {
      id: 'p',
      iconName: 'paragraph',
      label: t('toolbar.paragraph'),
      shortcutParts: [mod, shift, '0'],
      run: function () {
        toolbar.onHeadingLevel(0);
      },
    },
  ];
  for (let level = 1; level <= 6; level++) {
    headingEntries.push({
      id: 'h' + level,
      icon: 'H' + level,
      label: t('slash.h' + level),
      shortcutParts: [mod, String(level)],
      run: (function (value) {
        return function () {
          toolbar.onHeadingLevel(value);
        };
      })(level),
    });
  }
  return [
    { label: t('format.groupHeading'), entries: headingEntries },
    {
      label: t('format.groupText'),
      entries: [
        {
          id: 'bold',
          iconName: 'bold',
          label: t('toolbar.bold'),
          shortcutParts: [mod, shift, 'B'],
          run: toolbar.onBold,
        },
        {
          id: 'italic',
          iconName: 'italic',
          label: t('toolbar.italic'),
          shortcutParts: [mod, 'I'],
          run: toolbar.onItalic,
        },
        {
          id: 'strike',
          iconName: 'strikethrough',
          label: t('toolbar.strike'),
          shortcutParts: [mod, shift, 'X'],
          run: toolbar.onStrike,
        },
        {
          id: 'underline',
          iconName: 'underline',
          label: t('toolbar.underline'),
          shortcutParts: [mod, 'U'],
          run: toolbar.onUnderline,
        },
        {
          id: 'mark',
          iconName: 'highlight',
          label: t('toolbar.mark'),
          shortcutParts: [mod, shift, 'H'],
          run: toolbar.onMark,
        },
        {
          id: 'inline-code',
          iconName: 'code',
          label: t('toolbar.code'),
          shortcutParts: [mod, 'E'],
          run: toolbar.onCode,
        },
        {
          id: 'inline-math',
          iconName: 'sigma',
          label: t('toolbar.inlineMath'),
          shortcutParts: [mod, shift, 'E'],
          run: toolbar.onInlineMath,
        },
      ],
    },
    {
      label: t('format.groupBlock'),
      entries: [
        {
          id: 'quote',
          iconName: 'quote',
          label: t('toolbar.quote'),
          shortcutParts: [mod, shift, '9'],
          run: toolbar.onQuote,
        },
        {
          id: 'alert',
          iconName: 'info',
          label: t('slash.alert'),
          shortcutParts: ['/alert'],
          run: toolbar.onAlert,
        },
        {
          id: 'ordered',
          iconName: 'listOrdered',
          label: t('toolbar.orderedList'),
          shortcutParts: [mod, shift, '7'],
          run: toolbar.onOrderedList,
        },
        {
          id: 'unordered',
          iconName: 'listBullet',
          label: t('toolbar.list'),
          shortcutParts: [mod, shift, '8'],
          run: toolbar.onList,
        },
        {
          id: 'task',
          iconName: 'checkSquare',
          label: t('slash.task'),
          shortcutParts: [mod, alt, '4'],
          run: toolbar.onTaskList,
        },
        {
          id: 'code-block',
          iconName: 'codeBlock',
          label: t('toolbar.codeBlock'),
          shortcutParts: [mod, alt, 'C'],
          run: toolbar.onCodeBlock,
        },
        {
          id: 'math-block',
          iconName: 'mathBlock',
          label: t('toolbar.mathBlock'),
          shortcutParts: [mod, alt, shift, 'E'],
          run: toolbar.onMathBlock,
        },
        { id: 'hr', iconName: 'minus', label: t('toolbar.hr'), shortcutParts: [mod, alt, '-'], run: toolbar.onHr },
      ],
    },
    {
      label: t('format.groupInsert'),
      entries: [
        { id: 'link', iconName: 'link', label: t('toolbar.link'), shortcutParts: [mod, 'K'], run: toolbar.onLink },
        {
          id: 'table',
          iconName: 'table',
          label: t('toolbar.table'),
          shortcutParts: [mod, alt, 'T'],
          run: toolbar.onTable,
        },
        {
          id: 'image',
          iconName: 'image',
          label: t('toolbar.image'),
          shortcutParts: [mod, alt, 'P'],
          run: toolbar.onImage,
        },
      ],
    },
    {
      label: t('format.groupOther'),
      entries: [
        {
          id: 'lead',
          iconName: 'paragraph',
          label: t('slash.lead'),
          shortcutParts: ['/lead'],
          run: toolbar.onLead,
        },
        {
          id: 'tldr',
          iconName: 'listBullet',
          label: t('slash.tldr'),
          shortcutParts: ['/tldr'],
          run: toolbar.onTldr,
        },
        {
          id: 'pull',
          iconName: 'quote',
          label: t('slash.pull'),
          shortcutParts: ['/pull'],
          run: toolbar.onPull,
        },
        {
          id: 'meta',
          iconName: 'sparkles',
          label: t('slash.meta'),
          shortcutParts: ['/meta'],
          run: toolbar.onMeta,
        },
        {
          id: 'sign',
          iconName: 'pencil',
          label: t('slash.sign'),
          shortcutParts: ['/sign'],
          run: toolbar.onSign,
        },
        {
          id: 'scroll-box',
          iconName: 'scrollY',
          label: t('toolbar.scrollBox'),
          shortcutParts: [mod, alt, 'V'],
          run: toolbar.onScrollBox,
        },
        {
          id: 'scroll-x-box',
          iconName: 'scrollX',
          label: t('toolbar.scrollXBox'),
          shortcutParts: [mod, alt, 'X'],
          run: toolbar.onScrollXBox,
        },
        {
          id: 'link-notes',
          iconName: 'bookmarkLink',
          label: t('toolbar.linkFootnotes'),
          shortcutParts: [mod, alt, 'L'],
          run: toolbar.onToggleLinkFootnotes,
        },
      ],
    },
  ];
}

function buildFormatMenuModel(
  React: typeof ReactNamespace,
  icons: UiKit,
  groups: readonly FormatGroup[],
): { items: DshMenuEntry[]; actions: Record<string, () => void> } {
  const h = React.createElement;
  const items: DshMenuEntry[] = [];
  const actions: Record<string, () => void> = {};
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (groupIndex > 0) items.push({ type: 'separator', id: 'sep-fmt-' + groupIndex });
    items.push({ type: 'label', id: 'grp-fmt-' + groupIndex, text: group.label });
    for (let i = 0; i < group.entries.length; i++) {
      const entry = group.entries[i];
      actions[entry.id] = entry.run;
      const iconNode = entry.iconName
        ? h(icons.Icon, { name: entry.iconName, size: 14 })
        : h('span', { className: 'mdstudio-menu-text-icon' }, entry.icon);
      items.push({
        id: entry.id,
        label: entry.label,
        icon: iconNode,
        shortcut: entry.shortcutParts.length ? toMenuShortcut(entry.shortcutParts) : undefined,
      });
    }
  }
  return { items, actions };
}

function FormatMenu(props: {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  icons: UiKit;
  toolbar: EditorToolbarModel;
}): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const toolbar = props.toolbar;
  const [open, setOpen] = props.React.useState(false);
  const model = buildFormatMenuModel(props.React, props.icons, buildFormatGroups(t, toolbar));

  return h(props.icons.Menu, {
    open,
    align: 'start',
    side: 'bottom',
    portal: true,
    autoFocus: true,
    selection: 'check',
    selectedIds: toolbar.linkFootnotes ? ['link-notes'] : [],
    className: 'mdstudio-format-wrap',
    listClassName: 'mdstudio-format-menu',
    ariaLabel: t('toolbar.format'),
    items: model.items,
    onSelect: function (id: string) {
      setOpen(false);
      const fn = model.actions[id];
      if (fn) fn();
    },
    onClose: function () {
      setOpen(false);
    },
    anchor: h(props.icons.Tooltip, {
      label: t('toolbar.format'),
      side: 'bottom',
      disabled: open,
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-tool mdstudio-format-trigger' + (open ? ' is-active' : ''),
          title: t('toolbar.format'),
          'aria-label': t('toolbar.format'),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: function () {
            setOpen(!open);
          },
        },
        h('span', { className: 'mdstudio-tool-text' }, t('toolbar.format')),
        h(
          'span',
          { className: 'mdstudio-heading-caret', 'aria-hidden': 'true' },
          h(props.icons.Icon, { name: 'chevronDown', size: 12 }),
        ),
      ),
    }),
  });
}

function renderToolbarEnd(props: EditorPaneProps): ReactNode {
  const h = props.React.createElement;
  const { t, ui: icons, toolbar } = props;
  return h(
    'div',
    { className: 'mdstudio-toolbar-end' },
    toolbar.permission !== 'granted'
      ? h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-conflict',
            title: t('file.reauthorize'),
            onClick: toolbar.onAuthorize,
          },
          t('file.reauthorize'),
        )
      : null,
    toolbar.fileConflict
      ? h(
          'button',
          { type: 'button', className: 'mdstudio-conflict', title: t('file.reload'), onClick: toolbar.onReload },
          h(icons.Icon, { name: 'alert', size: 14 }),
          t('file.conflict'),
        )
      : null,
  );
}

function renderAiOverlays(props: EditorPaneProps): ReactNode {
  const h = props.React.createElement;
  const { t, ui: icons, toolbar, content, ai } = props;
  if (!ai) return null;
  const showFloat = Boolean(ai.selectionBubblePos && !ai.session);
  return h(
    props.React.Fragment,
    null,
    h(AiReviewOverlay, {
      React: props.React,
      t,
      ui: icons,
      session: ai.session,
      useCodeMirror: content.useCodeMirror,
      inlineBlocks: ai.inlineBlocks,
      onCancel: ai.onCancel,
      onRetry: function () {
        ai.onRunSkill(ai.session?.skill);
      },
    }),
    showFloat && ai.selectionBubblePos
      ? h(SkillSplitTrigger, {
          React: props.React,
          t,
          ui: icons,
          modKey: toolbar.modKey,
          skills: ai.skills,
          activeSkill: ai.activeSkill,
          busy: false,
          style: { top: ai.selectionBubblePos.top, left: ai.selectionBubblePos.left },
          onRun: ai.onRunSkill,
          onOpenManager: ai.onOpenManager,
        })
      : null,
  );
}

function computeOutlineLeft(anchor: HTMLElement | null): number {
  const pane = anchor?.closest<HTMLElement>('.mdstudio-editor-pane');
  if (!anchor || !pane) return 10;
  const aRect = anchor.getBoundingClientRect();
  const pRect = pane.getBoundingClientRect();
  const maxLeft = Math.max(10, pRect.width - 290);
  return Math.max(10, Math.min(Math.round(aRect.left - pRect.left), maxLeft));
}

function hasOpenModal(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector('[aria-modal="true"]'));
}

function isUnhandledEscape(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  return event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal();
}

function isImeEvent(event: ReactNamespace.KeyboardEvent<HTMLElement>): boolean {
  return Boolean(event.nativeEvent.isComposing || event.keyCode === 229);
}

function focusAnchorButton(anchor: HTMLElement | null): void {
  const trigger = anchor?.querySelector<HTMLElement>('button');
  if (trigger) trigger.focus();
}

export function EditorPane(props: EditorPaneProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const content = props.content;
  const toolbar = props.toolbar;
  const slash = props.slash;
  const search = props.search;
  const outline = props.outline;
  const icons = props.ui;
  const outlineRef = props.React.useRef<HTMLDivElement | null>(null);
  const outlineAnchorRef = props.React.useRef<HTMLSpanElement | null>(null);
  const [outlineLeft, setOutlineLeft] = props.React.useState(10);

  useDocumentEvent(
    props.React,
    'mousedown',
    function (event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (outlineRef.current && outlineRef.current.contains(target)) return;
      if (target.closest('.mdstudio-outline-anchor')) return;
      outline.onClose();
    },
    outline.open,
  );

  useDocumentEvent(
    props.React,
    'keydown',
    function (event: KeyboardEvent) {
      if (!isUnhandledEscape(event)) return;
      event.preventDefault();
      outline.onClose();
      focusAnchorButton(outlineAnchorRef.current);
    },
    outline.open,
  );

  return h(
    'div',
    {
      className:
        'mdstudio-pane mdstudio-editor-pane' + (props.visible ? '' : ' is-hidden') + (search.open ? ' has-search' : ''),
    },
    h(
      'div',
      { className: 'mdstudio-toolbar', role: 'toolbar', 'aria-label': t('toolbar.label') },
      h(
        icons.ToolButton,
        {
          title: t('toolbar.undo') + ' · ' + toolbar.modKey + 'Z',
          onClick: toolbar.onUndo,
          disabled: !toolbar.canUndo,
        },
        h(icons.Icon, { name: 'undo' }),
      ),
      h(
        icons.ToolButton,
        {
          title: t('toolbar.redo') + ' · ' + toolbar.modKey + toolbar.shiftKey + 'Z',
          onClick: toolbar.onRedo,
          disabled: !toolbar.canRedo,
        },
        h(icons.Icon, { name: 'redo' }),
      ),
      h('span', { className: 'mdstudio-tool-sep' }),
      h(FormatMenu, { React: props.React, t: t, icons: icons, toolbar: toolbar }),
      h(
        icons.ToolButton,
        { title: t('toolbar.bold') + ' · ' + toolbar.modKey + toolbar.shiftKey + 'B', onClick: toolbar.onBold },
        h(icons.Icon, { name: 'bold', size: 15 }),
      ),
      h(
        icons.ToolButton,
        { title: t('toolbar.italic') + ' · ' + toolbar.modKey + 'I', onClick: toolbar.onItalic },
        h(icons.Icon, { name: 'italic', size: 15 }),
      ),
      h(
        icons.ToolButton,
        { title: t('toolbar.strike') + ' · ' + toolbar.modKey + toolbar.shiftKey + 'X', onClick: toolbar.onStrike },
        h(icons.Icon, { name: 'strikethrough', size: 15 }),
      ),
      h(
        icons.ToolButton,
        { title: t('toolbar.underline') + ' · ' + toolbar.modKey + 'U', onClick: toolbar.onUnderline },
        h(icons.Icon, { name: 'underline', size: 15 }),
      ),
      h(
        icons.ToolButton,
        { title: t('toolbar.code') + ' · ' + toolbar.modKey + 'E', onClick: toolbar.onCode },
        h(icons.Icon, { name: 'code', size: 15 }),
      ),
      h('span', { className: 'mdstudio-tool-sep' }),
      h(
        icons.ToolButton,
        { title: t('toolbar.link') + ' · ' + toolbar.modKey + 'K', onClick: toolbar.onLink },
        h(icons.Icon, { name: 'link' }),
      ),
      h('span', { className: 'mdstudio-tool-sep' }),
      h(
        icons.ToolButton,
        { title: t('toolbar.search') + ' · ' + toolbar.modKey + 'F', onClick: toolbar.onSearch },
        h(icons.Icon, { name: 'search', size: 15 }),
      ),
      h(
        'span',
        { className: 'mdstudio-outline-anchor', ref: outlineAnchorRef },
        h(
          icons.ToolButton,
          {
            title: t('toolbar.outline'),
            active: outline.open,
            ariaExpanded: outline.open,
            onClick: function () {
              if (!outline.open) setOutlineLeft(computeOutlineLeft(outlineAnchorRef.current));
              toolbar.onOutline();
            },
          },
          h(icons.Icon, { name: 'listTree', size: 15 }),
        ),
      ),
      renderToolbarEnd(props),
    ),
    renderAiOverlays(props),
    slash.open
      ? h(
          'div',
          {
            className: 'mdstudio-slash',
            onMouseDown: function (event: ReactNamespace.MouseEvent<HTMLDivElement>) {
              event.preventDefault();
            },
          },
          h('div', { className: 'mdstudio-slash-head', id: 'mdstudio-slash-title' }, t('slash.title')),
          slash.items.length
            ? h(
                'div',
                {
                  className: 'mdstudio-slash-list',
                  role: 'listbox',
                  'aria-labelledby': 'mdstudio-slash-title',
                },
                slash.items.map(function (item, index) {
                  return h(
                    'button',
                    {
                      type: 'button',
                      key: item.id,
                      id: 'mdstudio-slash-opt-' + item.id,
                      role: 'option',
                      'aria-selected': index === slash.selected,
                      className:
                        'mdstudio-slash-item mdstudio-drop-item' + (index === slash.selected ? ' is-active' : ''),
                      onMouseEnter: function () {
                        slash.onSelect(index);
                      },
                      onClick: function () {
                        slash.onApply(index);
                      },
                    },
                    h(
                      'span',
                      { className: 'mdstudio-slash-icon', 'aria-hidden': 'true' },
                      item.iconName ? h(icons.Icon, { name: item.iconName, size: 16 }) : item.icon,
                    ),
                    h(
                      'span',
                      { className: 'mdstudio-slash-copy' },
                      h('span', { className: 'mdstudio-slash-label' }, item.label),
                      h('span', { className: 'mdstudio-slash-hint' }, item.hint),
                    ),
                  );
                }),
              )
            : h('div', { className: 'mdstudio-slash-empty', role: 'status' }, t('slash.empty')),
          h('div', { className: 'mdstudio-slash-foot' }, t('slash.foot')),
        )
      : null,
    search.open
      ? h(
          'div',
          {
            className: 'mdstudio-searchbar',
            onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLDivElement>) {
              if (isImeEvent(event)) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                search.onClose();
              }
            },
          },
          h(icons.Input, {
            ref: function (el: HTMLInputElement | null) {
              (search.inputRef as { current: HTMLInputElement | null }).current = el;
            },
            icon: h(icons.Icon, { name: 'search', size: 14 }),
            className: 'mdstudio-search-input',
            wrapClassName: 'mdstudio-searchbar-field',
            value: search.query,
            placeholder: t('search.placeholder'),
            'aria-label': t('search.placeholder'),
            onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
              search.onQuery(event.target.value);
            },
            onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLInputElement>) {
              if (isImeEvent(event)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                search.onFind();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                search.onClose();
              }
            },
          }),
          h(icons.Input, {
            className: 'mdstudio-search-input',
            wrapClassName: 'mdstudio-searchbar-field',
            value: search.replacement,
            placeholder: t('search.replace'),
            'aria-label': t('search.replace'),
            onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
              search.onReplacement(event.target.value);
            },
            onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLInputElement>) {
              if (isImeEvent(event)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                search.onReplaceOne();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                search.onClose();
              }
            },
          }),
          h(
            icons.Button,
            { variant: 'outline', size: 'sm', className: 'mdstudio-search-btn', onClick: search.onFind },
            t('search.next'),
          ),
          h(
            icons.Button,
            { variant: 'outline', size: 'sm', className: 'mdstudio-search-btn', onClick: search.onReplaceOne },
            t('search.replaceOne'),
          ),
          h(
            icons.Button,
            { variant: 'outline', size: 'sm', className: 'mdstudio-search-btn', onClick: search.onReplaceAll },
            t('search.replaceAll'),
          ),
          h(icons.Tooltip, {
            label: t('close'),
            side: 'bottom',
            children: h(
              'button',
              {
                type: 'button',
                className: 'mdstudio-icon-btn mdstudio-search-close',
                'aria-label': t('close'),
                onClick: search.onClose,
              },
              h(icons.Icon, { name: 'close', size: 13 }),
            ),
          }),
        )
      : null,
    outline.open
      ? h(
          'div',
          {
            className: 'mdstudio-outline',
            ref: outlineRef,
            style: { left: outlineLeft },
            role: 'navigation',
            'aria-label': t('outline.title'),
          },
          h('div', { className: 'mdstudio-outline-head' }, t('outline.title')),
          outline.headings.length
            ? outline.headings.map(function (heading, index) {
                return h(
                  'button',
                  {
                    type: 'button',
                    key: 'outline-' + heading.start + '-' + index,
                    className: 'mdstudio-outline-item mdstudio-drop-item',
                    style: { paddingLeft: 8 + (heading.level - 1) * 10, fontWeight: heading.level <= 2 ? 600 : 400 },
                    onClick: function () {
                      outline.onFocus(heading);
                    },
                    title: heading.text,
                  },
                  h('span', { className: 'mdstudio-outline-lvl', 'aria-hidden': 'true' }, 'H' + heading.level),
                  h('span', { className: 'mdstudio-outline-text' }, heading.text),
                );
              })
            : h('p', { className: 'mdstudio-outline-empty' }, t('outline.empty')),
        )
      : null,
    h(
      'div',
      {
        className: 'mdstudio-editor-wrap',
        onMouseDownCapture: function (event: ReactNamespace.MouseEvent<HTMLDivElement>) {
          disarmEscapeTab();
          content.onPointerDown?.(event);
        },
        onBlurCapture: function () {
          disarmEscapeTab();
        },
      },
      content.useCodeMirror
        ? h(CodeMirrorEditor, {
            React: props.React,
            value: content.markdown,
            config: {
              placeholder: content.placeholder,
              ariaLabel: t('editor.label'),
            },
            inlineBlocks: props.ai?.inlineBlocks,
            diffTransition: props.ai?.diffTransition,
            onReady: content.onReady,
            onError: content.onError,
            onChange: content.onChange,
            onSelection: content.onSelection,
            onKeyDown: content.onKeyDown,
            onPaste: content.onPaste,
            onDragOver: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
              event.preventDefault();
            },
            onDrop: content.onDrop,
            onBlur: content.onBlur,
          })
        : h('textarea', {
            className: 'mdstudio-editor',
            ref: content.textareaRef,
            value: content.markdown,
            spellCheck: false,
            placeholder: content.placeholder,
            'aria-label': t('editor.label'),
            onChange: function (event: ReactNamespace.ChangeEvent<HTMLTextAreaElement>) {
              const native = event.nativeEvent as InputEvent;
              const inputType = native.inputType || '';
              const boundary = /paste|drop/i.test(inputType);
              content.onTextareaInput(
                event.target.value,
                event.target.selectionStart,
                boundary,
                event.target.selectionStart,
                event.target.selectionEnd,
              );
            },
            onSelect: function (event: ReactNamespace.SyntheticEvent<HTMLTextAreaElement>) {
              content.onTextareaSelect(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
            },
            onMouseUp: function (event: ReactNamespace.MouseEvent<HTMLTextAreaElement>) {
              content.onTextareaSelect(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
            },
            onKeyDown: content.onKeyDown,
            onKeyUp: function (event: ReactNamespace.KeyboardEvent<HTMLTextAreaElement>) {
              content.onTextareaSelect(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
              if (
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight' ||
                event.key === 'Home' ||
                event.key === 'End'
              )
                content.onRefreshSlash();
            },
            onClick: content.onRefreshSlash,
            onScroll: content.onTextareaScroll,
            onBlur: content.onBlur,
            onPaste: content.onPaste,
            onDragOver: function (event: ReactNamespace.DragEvent<HTMLTextAreaElement>) {
              event.preventDefault();
            },
            onDrop: content.onDrop,
          }),
    ),
    h(
      'div',
      { className: 'mdstudio-editor-stats' },
      h('span', null, t('stats.wordCount') + ' ' + props.stats.words.toLocaleString()),
      h('span', { className: 'mdstudio-editor-stats-dot', 'aria-hidden': 'true' }),
      h('span', null, t('stats.charCount') + ' ' + props.stats.chars.toLocaleString()),
    ),
  );
}
