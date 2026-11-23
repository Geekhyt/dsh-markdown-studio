import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import type { ImportBackupSummary, ImportModeChoice } from '../application/use-library-archive';
import type { Article } from '../domain/article';
import type { ConfirmDialogFn, PromptDialogFn } from '../domain/dialog';
import type { MergeConflict, MergeDecision } from '../domain/library-backup';
import { type LibrarySearchResult, searchArticles } from '../domain/library-search';
import type { WorkspaceDirectory, WorkspaceEntry, WorkspaceFile } from '../domain/workspace';
import { useDebouncedKeyTask, useDocumentEvent } from '../runtime/react-lifecycle';
import type { DshMenuEntry } from '../types/dsh-primitives';
import type { UiKit } from './ui-kit';

interface DialogCommon {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  onClose: () => void;
}

export interface LibraryDialogActions {
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onEmptyTrash: () => void;
  onExportArchive: () => void;
  onImport: (file: File | null | undefined) => void;
  onRecoverImport: () => void;
}

export interface LibraryDialogProps extends DialogCommon {
  open: boolean;
  docs: Article[];
  trash: Article[];
  activeId: string;
  hasRecovery: boolean;
  actions: LibraryDialogActions;
}

function highlightHit(h: typeof ReactNamespace.createElement, text: string, needle: string): ReactNode {
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return h(
    'span',
    null,
    text.slice(0, at),
    h('mark', { className: 'mdstudio-search-hit' }, text.slice(at, at + needle.length)),
    text.slice(at + needle.length),
  );
}

function formatRelativeUnit(count: number, unit: string): string {
  return /^[a-z]\b/i.test(unit) ? count + unit : count + ' ' + unit;
}

function formatRelativeStamp(ts: number, t: (key: string) => string, locale?: string): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return t('library.justNow');
  if (diff < 3_600_000) return formatRelativeUnit(Math.floor(diff / 60_000), t('library.minutesAgo'));
  if (diff < 86_400_000) return formatRelativeUnit(Math.floor(diff / 3_600_000), t('library.hoursAgo'));
  if (diff < 7 * 86_400_000) return formatRelativeUnit(Math.floor(diff / 86_400_000), t('library.daysAgo'));
  const dateLocale = locale ? (/^zh/i.test(locale) ? 'zh-CN' : locale) : undefined;
  return new Date(ts).toLocaleDateString(dateLocale);
}

function formatLibraryMeta(entry: Article, tab: 'docs' | 'trash', t: (key: string) => string, locale?: string): string {
  const chars = entry.markdown.length + ' ' + t('stats.chars');
  if (tab === 'docs') return formatRelativeStamp(entry.updatedAt, t, locale) + ' · ' + chars;
  return (
    t('library.deletedAt') + ' ' + formatRelativeStamp(entry.deletedAt || entry.updatedAt, t, locale) + ' · ' + chars
  );
}

function renderDocsRow(props: LibraryDialogProps, result: LibrarySearchResult, needle: string): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const entry = result.article;
  const active = entry.id === props.activeId;
  const deleteLabel = t('library.delete');
  return h(
    'div',
    {
      className: 'mdstudio-library-row' + (active ? ' is-active' : ''),
      key: entry.id,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'mdstudio-library-main',
        onClick: function () {
          props.actions.onSwitch(entry.id);
        },
      },
      active
        ? h(props.ui.StateDot, { state: 'done', size: 7, className: 'mdstudio-library-dot' })
        : h('span', { className: 'mdstudio-library-dot-spacer', 'aria-hidden': 'true' }),
      h(
        'span',
        { className: 'mdstudio-library-row-body' },
        h(
          'span',
          { className: 'mdstudio-library-title-line' },
          h('span', { className: 'mdstudio-library-title' }, highlightHit(h, entry.title || t('untitled'), needle)),
          active ? h('span', { className: 'mdstudio-library-current' }, t('library.current')) : null,
        ),
        needle && result.snippet
          ? h('span', { className: 'mdstudio-library-snippet' }, highlightHit(h, result.snippet, needle))
          : null,
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-library-tail' },
      h('span', { className: 'mdstudio-library-meta' }, formatLibraryMeta(entry, 'docs', t, props.ui.locale?.())),
      h(
        'div',
        { className: 'mdstudio-library-row-actions' },
        h(props.ui.Tooltip, {
          label: deleteLabel,
          side: 'top',
          children: h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-icon-btn mdstudio-library-icon-action is-danger',
              'aria-label': deleteLabel,
              onClick: function () {
                props.actions.onDelete(entry.id);
              },
            },
            h(props.ui.Icon, { name: 'trash', size: 14 }),
          ),
        }),
      ),
    ),
  );
}

function renderTrashRow(props: LibraryDialogProps, result: LibrarySearchResult, needle: string): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const entry = result.article;
  const purgeLabel = t('library.purge');
  return h(
    'div',
    {
      className: 'mdstudio-library-row is-trash-row',
      key: entry.id,
    },
    h(
      'div',
      { className: 'mdstudio-library-main is-trash' },
      h(
        'span',
        { className: 'mdstudio-library-row-body' },
        h('span', { className: 'mdstudio-library-title' }, highlightHit(h, entry.title || t('untitled'), needle)),
        h('span', { className: 'mdstudio-library-meta' }, formatLibraryMeta(entry, 'trash', t, props.ui.locale?.())),
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-library-row-actions is-visible' },
      h(
        props.ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          className: 'mdstudio-library-restore-btn',
          onClick: function () {
            props.actions.onRestore(entry.id);
          },
        },
        t('library.restore'),
      ),
      h(props.ui.Tooltip, {
        label: purgeLabel,
        side: 'top',
        children: h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-library-icon-action is-danger',
            'aria-label': purgeLabel,
            onClick: function () {
              props.actions.onPurge(entry.id);
            },
          },
          h(props.ui.Icon, { name: 'trash', size: 14 }),
        ),
      }),
    ),
  );
}

function buildLibraryMenuItems(props: LibraryDialogProps): DshMenuEntry[] {
  const h = props.React.createElement;
  const t = props.t;
  const items: DshMenuEntry[] = [
    { id: 'import', label: t('library.importMenu'), icon: h(props.ui.Icon, { name: 'fileInput', size: 14 }) },
    { id: 'exportArchive', label: t('library.exportMenu'), icon: h(props.ui.Icon, { name: 'download', size: 14 }) },
  ];
  if (props.hasRecovery) {
    items.push({ type: 'separator', id: 'sep-recovery' });
    items.push({
      id: 'recover',
      label: t('library.recoverImport'),
      icon: h(props.ui.Icon, { name: 'history', size: 14 }),
    });
  }
  if (props.trash.length > 0) {
    items.push({ type: 'separator', id: 'sep-trash' });
    items.push({
      id: 'emptyTrash',
      label: t('library.emptyTrash'),
      icon: h(props.ui.Icon, { name: 'trash', size: 14 }),
      danger: true,
    });
  }
  return items;
}

function toggleLibraryTab(current: 'docs' | 'trash'): 'docs' | 'trash' {
  return current === 'docs' ? 'trash' : 'docs';
}

const LIBRARY_TAB_KEYS: Record<string, (current: 'docs' | 'trash') => 'docs' | 'trash'> = {
  Home: () => 'docs',
  End: () => 'trash',
  ArrowLeft: toggleLibraryTab,
  ArrowRight: toggleLibraryTab,
};

function nextLibraryTab(key: string, current: 'docs' | 'trash'): 'docs' | 'trash' | null {
  const resolver = LIBRARY_TAB_KEYS[key];
  return resolver ? resolver(current) : null;
}

function emptyLibraryMessage(tab: 'docs' | 'trash', hasQuery: boolean, t: (key: string) => string): string {
  if (hasQuery) return t('library.noResults');
  return tab === 'trash' ? t('library.trashEmpty') : t('library.empty');
}

function useModalMenuState(React: typeof ReactNamespace, open: boolean, closeModal: () => void) {
  const [prevOpen, setPrevOpen] = React.useState(open);
  const [rawMenuOpen, setRawMenuOpen] = React.useState(false);
  const dismissSuppressRef = React.useRef<'escape' | 'pointer' | null>(null);
  const insideMenuRef = React.useRef(false);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && rawMenuOpen) setRawMenuOpen(false);
  }
  const menuOpen = open && rawMenuOpen;
  const updateMenuOpen = function (next: boolean, fromAction = false): void {
    setRawMenuOpen(next);
    if (!next) {
      if (fromAction || insideMenuRef.current) {
        dismissSuppressRef.current = null;
      } else if (dismissSuppressRef.current !== 'escape') {
        dismissSuppressRef.current = 'pointer';
        window.setTimeout(function () {
          if (dismissSuppressRef.current === 'pointer') dismissSuppressRef.current = null;
        }, 0);
      }
      insideMenuRef.current = false;
    } else {
      dismissSuppressRef.current = null;
    }
  };
  const markInsideMenu = function (event: Event): void {
    const target = event.target as Element | null;
    insideMenuRef.current = Boolean(
      target &&
        typeof target.closest === 'function' &&
        target.closest('[role="menu"], [role="menuitem"], [data-menu-material]'),
    );
  };
  const markEscapeWhileMenuOpen = function (event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    dismissSuppressRef.current = 'escape';
    Promise.resolve().then(function () {
      if (dismissSuppressRef.current === 'escape') dismissSuppressRef.current = null;
    });
  };
  useDocumentEvent(React, 'pointerdown', markInsideMenu, menuOpen, true);
  useDocumentEvent(React, 'mousedown', markInsideMenu, menuOpen, true);
  useDocumentEvent(React, 'keydown', markEscapeWhileMenuOpen, menuOpen, true);
  const onModalClose = function (): void {
    if (!open) return;
    if (menuOpen) {
      if (!insideMenuRef.current) updateMenuOpen(false, false);
      insideMenuRef.current = false;
      return;
    }
    if (dismissSuppressRef.current !== null) {
      dismissSuppressRef.current = null;
      return;
    }
    closeModal();
  };
  return { menuOpen, updateMenuOpen, onModalClose };
}

export function LibraryDialog(props: LibraryDialogProps): ReactNode {
  const React = props.React;
  const [tab, setTab] = React.useState<'docs' | 'trash'>('docs');
  const [query, setQuery] = React.useState('');
  const { menuOpen, updateMenuOpen, onModalClose } = useModalMenuState(React, props.open, props.onClose);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  useDebouncedKeyTask(React, tab + '\0' + query, 0, props.open, function () {
    if (listRef.current) listRef.current.scrollTop = 0;
  });
  if (!props.open) return null;
  const h = React.createElement;
  const t = props.t;
  const results = searchArticles(tab === 'docs' ? props.docs : props.trash, query);
  const needle = query.trim().toLowerCase();
  if (tab === 'trash' && !needle) {
    results.sort(function (a, b) {
      return (b.article.deletedAt || b.article.updatedAt) - (a.article.deletedAt || a.article.updatedAt);
    });
  }
  const onSelectMenu = function (id: string): void {
    updateMenuOpen(false, true);
    if (id === 'import') fileRef.current?.click();
    else if (id === 'exportArchive') props.actions.onExportArchive();
    else if (id === 'recover') props.actions.onRecoverImport();
    else if (id === 'emptyTrash') props.actions.onEmptyTrash();
  };
  const moreLabel = t('more');
  const closeLabel = t('close');
  return h(
    props.ui.Modal,
    {
      open: props.open,
      onClose: onModalClose,
      title: t('library.title'),
      closeLabel: closeLabel,
      className: 'mdstudio-library-modal',
      headless: true,
    },
    h(
      'div',
      { className: 'mdstudio-library-head' },
      h(props.ui.Input, {
        icon: h(props.ui.Icon, { name: 'search', size: 14 }),
        className: 'mdstudio-search-input mdstudio-library-search',
        wrapClassName: 'mdstudio-library-search-wrap',
        value: query,
        placeholder: t('library.search'),
        'aria-label': t('library.search'),
        autoFocus: true,
        onChange: function (event) {
          setQuery(event.target.value);
        },
      }),
      h(
        'div',
        {
          className: 'mdstudio-library-seg',
          role: 'tablist',
          'aria-label': t('library.title'),
          onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLDivElement>) {
            const next = nextLibraryTab(event.key, tab);
            if (!next) return;
            event.preventDefault();
            setTab(next);
            event.currentTarget.querySelector<HTMLButtonElement>('[data-mdstudio-tab="' + next + '"]')?.focus();
          },
        },
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: 'mdstudio-library-tab-docs',
            'data-mdstudio-tab': 'docs',
            'aria-selected': tab === 'docs',
            'aria-controls': 'mdstudio-library-panel',
            tabIndex: tab === 'docs' ? 0 : -1,
            className: 'mdstudio-library-tab' + (tab === 'docs' ? ' is-active' : ''),
            onClick: function () {
              setTab('docs');
            },
          },
          t('library.articles') + ' ' + props.docs.length,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: 'mdstudio-library-tab-trash',
            'data-mdstudio-tab': 'trash',
            'aria-selected': tab === 'trash',
            'aria-controls': 'mdstudio-library-panel',
            tabIndex: tab === 'trash' ? 0 : -1,
            className: 'mdstudio-library-tab' + (tab === 'trash' ? ' is-active' : ''),
            onClick: function () {
              setTab('trash');
            },
          },
          t('library.trash') + ' ' + props.trash.length,
        ),
      ),
      h(
        props.ui.Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: h(props.ui.Icon, { name: 'filePlus', size: 14 }),
          className: 'mdstudio-library-new-btn',
          onClick: props.actions.onNew,
        },
        t('library.newShort'),
      ),
      h(props.ui.Menu, {
        open: menuOpen,
        portal: true,
        align: 'end',
        ariaLabel: moreLabel,
        listClassName: 'mdstudio-library-menu',
        items: buildLibraryMenuItems(props),
        onSelect: onSelectMenu,
        onClose: function () {
          updateMenuOpen(false);
        },
        anchor: h(props.ui.Tooltip, {
          label: moreLabel,
          side: 'bottom',
          disabled: menuOpen,
          children: h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-icon-btn mdstudio-library-more-btn' + (menuOpen ? ' is-active' : ''),
              'aria-label': moreLabel,
              'aria-haspopup': 'menu',
              'aria-expanded': menuOpen,
              onClick: function () {
                updateMenuOpen(!menuOpen);
              },
            },
            h(props.ui.Icon, { name: 'more', size: 15 }),
          ),
        }),
      }),
      h(props.ui.Tooltip, {
        label: closeLabel,
        side: 'bottom',
        children: h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-modal-close mdstudio-search-close',
            'aria-label': closeLabel,
            onClick: props.onClose,
          },
          h(props.ui.Icon, { name: 'close', size: 14 }),
        ),
      }),
      h('input', {
        type: 'file',
        ref: fileRef,
        className: 'mdstudio-hidden-input',
        tabIndex: -1,
        'aria-hidden': 'true',
        accept: '.zip,application/zip,.json,application/json',
        onChange: function (event) {
          props.actions.onImport(event.target.files && event.target.files[0]);
          event.target.value = '';
        },
      }),
    ),
    tab === 'trash' && props.trash.length > 0
      ? h(
          'div',
          { className: 'mdstudio-library-trash-bar' },
          h('span', { className: 'mdstudio-library-trash-hint' }, t('library.trashHint')),
          h(
            props.ui.Button,
            {
              variant: 'ghost',
              size: 'sm',
              className: 'mdstudio-library-empty-trash',
              onClick: props.actions.onEmptyTrash,
            },
            t('library.emptyTrash'),
          ),
        )
      : null,
    h(
      'div',
      {
        className: 'mdstudio-library-body',
        id: 'mdstudio-library-panel',
        role: 'tabpanel',
        'aria-labelledby': 'mdstudio-library-tab-' + tab,
      },
      results.length
        ? h(
            'div',
            { ref: listRef, className: 'mdstudio-library-list' },
            results.map(function (result) {
              return tab === 'docs' ? renderDocsRow(props, result, needle) : renderTrashRow(props, result, needle);
            }),
          )
        : h('p', { className: 'mdstudio-help mdstudio-library-empty' }, emptyLibraryMessage(tab, needle.length > 0, t)),
    ),
  );
}

export interface ImportModeDialogProps extends DialogCommon {
  summary: ImportBackupSummary;
  onChoose: (mode: ImportModeChoice) => void;
  onCancel: () => void;
}

function buildImportModeDescription(summary: ImportBackupSummary, t: (key: string) => string): string {
  const docPart = summary.docCount + ' ' + t('library.articles');
  const assetPart = summary.assetCount > 0 ? ' · ' + summary.assetCount + ' ' + t('localImages') : '';
  const missingPart =
    summary.missingCount > 0 ? ' (' + summary.missingCount + ' ' + t('library.archiveMissing') + ')' : '';
  return (
    t('library.importModeDescPrefix') + ' ' + docPart + assetPart + missingPart + t('library.importModeDescSuffix')
  );
}

export function ImportModeDialog(props: ImportModeDialogProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  return h(props.ui.Modal, {
    open: true,
    onClose: props.onClose,
    title: t('library.importTitle'),
    closeLabel: t('close'),
    description: buildImportModeDescription(props.summary, t),
    className: 'mdstudio-import-mode-dialog',
    footer: h(
      'div',
      { className: 'mdstudio-import-mode-actions' },
      h(
        props.ui.Button,
        {
          variant: 'outline',
          size: 'md',
          className: 'mdstudio-dialog-cancel',
          onClick: props.onCancel,
        },
        t('dialog.cancel'),
      ),
      h(
        props.ui.Button,
        {
          variant: 'outline',
          size: 'md',
          className: 'mdstudio-import-replace-btn',
          onClick: function () {
            props.onChoose('replace');
          },
        },
        t('library.importReplace'),
      ),
      h(
        props.ui.Button,
        {
          variant: 'primary',
          size: 'md',
          autoFocus: true,
          className: 'mdstudio-dialog-submit mdstudio-import-merge-btn',
          onClick: function () {
            props.onChoose('merge');
          },
        },
        t('library.importMergeRecommended'),
      ),
    ),
  });
}

export interface MergeConflictDialogProps extends DialogCommon {
  conflicts: MergeConflict[];
  defaultDecision?: MergeDecision;
  onApply: (decisions: Record<string, MergeDecision>) => void;
  onCancel: () => void;
}

export function MergeConflictDialog(props: MergeConflictDialogProps): ReactNode {
  const React = props.React;
  const h = React.createElement;
  const t = props.t;
  const initial = function (): Record<string, MergeDecision> {
    const result: Record<string, MergeDecision> = {};
    props.conflicts.forEach(function (conflict) {
      result[conflict.id] = props.defaultDecision || 'incoming';
    });
    return result;
  };
  const [decisions, setDecisions] = React.useState<Record<string, MergeDecision>>(initial);
  const setAll = function (decision: MergeDecision): void {
    const result: Record<string, MergeDecision> = {};
    props.conflicts.forEach(function (conflict) {
      result[conflict.id] = decision;
    });
    setDecisions(result);
  };
  return h(
    props.ui.Modal,
    {
      open: true,
      onClose: props.onClose,
      title: t('library.mergeConflictsTitle'),
      closeLabel: t('close'),
      description: t('library.mergeConflictsDesc'),
      className: 'mdstudio-conflict-dialog',
      footer: h(
        'div',
        { className: 'mdstudio-conflict-actions' },
        h(
          props.ui.Button,
          {
            variant: 'ghost',
            size: 'sm',
            onClick: function () {
              setAll('incoming');
            },
          },
          t('library.mergeAllIncoming'),
        ),
        h(
          props.ui.Button,
          {
            variant: 'ghost',
            size: 'sm',
            onClick: function () {
              setAll('current');
            },
          },
          t('library.mergeAllCurrent'),
        ),
        h('span', { className: 'mdstudio-spacer' }),
        h(props.ui.Button, { variant: 'outline', size: 'md', onClick: props.onCancel }, t('library.mergeCancel')),
        h(
          props.ui.Button,
          {
            variant: 'primary',
            size: 'md',
            onClick: function () {
              props.onApply(decisions);
            },
            autoFocus: true,
          },
          t('library.mergeApply'),
        ),
      ),
    },
    h(
      'div',
      { className: 'mdstudio-conflict-list' },
      props.conflicts.map(function (conflict) {
        const title = conflict.title || t('untitled');
        const currentChoice = decisions[conflict.id] || 'incoming';
        return h(
          'div',
          { className: 'mdstudio-conflict-row', key: conflict.id },
          h(
            'div',
            { className: 'mdstudio-conflict-copy' },
            h('strong', null, title),
            h('span', { className: 'mdstudio-conflict-meta' }, t('library.mergeConflictMeta')),
          ),
          h(
            'div',
            { className: 'mdstudio-library-seg mdstudio-conflict-seg', role: 'group', 'aria-label': title },
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': currentChoice === 'incoming',
                className: 'mdstudio-library-tab' + (currentChoice === 'incoming' ? ' is-active' : ''),
                onClick: function () {
                  setDecisions(function (prev) {
                    return { ...prev, [conflict.id]: 'incoming' };
                  });
                },
              },
              t('library.mergeIncoming'),
            ),
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': currentChoice === 'current',
                className: 'mdstudio-library-tab' + (currentChoice === 'current' ? ' is-active' : ''),
                onClick: function () {
                  setDecisions(function (prev) {
                    return { ...prev, [conflict.id]: 'current' };
                  });
                },
              },
              t('library.mergeCurrent'),
            ),
          ),
        );
      }),
    ),
  );
}

export interface WorkspaceDialogActions {
  onConfirm: ConfirmDialogFn;
  onPrompt: PromptDialogFn;
  onOpen: (entry: WorkspaceFile) => void;
  onPickFolder: () => void;
  onRefresh: () => void;
  onCreateFile: (directoryPath: string, name: string) => void;
  onCreateDirectory: (directoryPath: string, name: string) => void;
  onRename: (entry: WorkspaceFile, name: string) => void;
  onRenameDirectory: (entry: WorkspaceDirectory, name: string) => void;
  onMove: (entry: WorkspaceEntry, targetPath: string) => void;
  onDelete: (entry: WorkspaceEntry) => void;
  onSelectDirectory: (path: string) => void;
}

export interface WorkspaceDialogProps extends DialogCommon {
  open: boolean;
  loading: boolean;
  entries: WorkspaceEntry[];
  name: string;
  selectedDir: string;
  error: string;
  actions: WorkspaceDialogActions;
}

async function promptMoveEntry(props: WorkspaceDialogProps, entry: WorkspaceEntry): Promise<void> {
  const target = await props.actions.onPrompt({
    title: props.t('workspace.movePrompt'),
    defaultValue: '',
    allowEmpty: true,
  });
  if (target !== null) props.actions.onMove(entry, target.trim());
}

async function confirmDeleteEntry(props: WorkspaceDialogProps, entry: WorkspaceEntry): Promise<void> {
  const ok = await props.actions.onConfirm({
    title: props.t('workspace.deleteConfirm') + ' ' + entry.name,
    danger: true,
  });
  if (ok) props.actions.onDelete(entry);
}

function renderWorkspaceActions(
  props: WorkspaceDialogProps,
  entry: WorkspaceEntry,
  onRenameEntry: () => void,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const moveLabel = t('workspace.move');
  const renameLabel = t('workspace.rename');
  const deleteLabel = t('workspace.delete');
  return h(
    'div',
    { className: 'mdstudio-workspace-actions' },
    h(props.ui.Tooltip, {
      label: moveLabel,
      side: 'top',
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-icon-btn mdstudio-library-icon-action',
          'aria-label': moveLabel,
          onClick: function () {
            void promptMoveEntry(props, entry);
          },
        },
        h(props.ui.Icon, { name: 'fileOutput', size: 13 }),
      ),
    }),
    h(props.ui.Tooltip, {
      label: renameLabel,
      side: 'top',
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-icon-btn mdstudio-library-icon-action',
          'aria-label': renameLabel,
          onClick: onRenameEntry,
        },
        h(props.ui.Icon, { name: 'pencil', size: 13 }),
      ),
    }),
    h(props.ui.Tooltip, {
      label: deleteLabel,
      side: 'top',
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-icon-btn mdstudio-library-icon-action is-danger',
          'aria-label': deleteLabel,
          onClick: function () {
            void confirmDeleteEntry(props, entry);
          },
        },
        h(props.ui.Icon, { name: 'trash', size: 13 }),
      ),
    }),
  );
}

interface WorkspaceTreeState {
  collapsed: Record<string, boolean>;
  forceExpand: boolean;
  onToggleDir: (path: string) => void;
}

function renderWorkspaceDirectory(
  props: WorkspaceDialogProps,
  entry: WorkspaceDirectory,
  depth: number,
  tree: WorkspaceTreeState,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const selected = entry.path === props.selectedDir;
  const expanded = tree.forceExpand || !tree.collapsed[entry.path];
  const onRenameDir = function (): void {
    void props.actions.onPrompt({ title: t('workspace.renamePrompt'), defaultValue: entry.name }).then(function (name) {
      if (name) props.actions.onRenameDirectory(entry, name);
    });
  };
  return h(
    'div',
    { key: entry.path },
    h(
      'div',
      {
        className: 'mdstudio-workspace-row' + (selected ? ' is-selected' : ''),
        style: { paddingLeft: 8 + depth * 14 },
        draggable: true,
        onDragStart: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
          event.dataTransfer?.setData('text/plain', entry.path);
        },
        onDragOver: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
          event.preventDefault();
        },
        onDrop: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
          event.preventDefault();
          const source = event.dataTransfer?.getData('text/plain');
          const sourceEntry = source ? findWorkspaceEntry(props.entries, source) : undefined;
          if (sourceEntry && source !== entry.path) props.actions.onMove(sourceEntry, entry.path);
        },
      },
      h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-workspace-dir',
          'aria-expanded': expanded,
          'aria-current': selected ? 'true' : undefined,
          onClick: function () {
            props.actions.onSelectDirectory(entry.path);
          },
          onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLButtonElement>) {
            if (event.key !== (expanded ? 'ArrowLeft' : 'ArrowRight')) return;
            event.preventDefault();
            tree.onToggleDir(entry.path);
          },
          title: entry.path,
        },
        h(
          'span',
          {
            className: 'mdstudio-workspace-caret',
            'aria-hidden': 'true',
            onClick: function (event: ReactNamespace.MouseEvent<HTMLSpanElement>) {
              event.stopPropagation();
              tree.onToggleDir(entry.path);
            },
          },
          h(props.ui.Icon, { name: expanded ? 'chevronDown' : 'chevronRight', size: 12 }),
        ),
        h(props.ui.Icon, { name: expanded || selected ? 'folderOpen' : 'folder', size: 14 }),
        h('span', { className: 'mdstudio-workspace-name' }, entry.name),
      ),
      renderWorkspaceActions(props, entry, onRenameDir),
    ),
    expanded
      ? entry.children.map(function (child) {
          return workspaceNode(props, child, depth + 1, tree);
        })
      : null,
  );
}

function workspaceNode(
  props: WorkspaceDialogProps,
  entry: WorkspaceEntry,
  depth: number,
  tree: WorkspaceTreeState,
): ReactNode {
  if (entry.kind === 'directory') return renderWorkspaceDirectory(props, entry, depth, tree);
  const h = props.React.createElement;
  const t = props.t;
  const onRenameFile = function (): void {
    void props.actions.onPrompt({ title: t('workspace.renamePrompt'), defaultValue: entry.name }).then(function (name) {
      if (name) props.actions.onRename(entry, name);
    });
  };
  return h(
    'div',
    {
      key: entry.path,
      className: 'mdstudio-workspace-row',
      style: { paddingLeft: 8 + depth * 14 },
      draggable: true,
      onDragStart: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
        event.dataTransfer?.setData('text/plain', entry.path);
      },
    },
    h(
      'button',
      {
        type: 'button',
        className: 'mdstudio-library-main mdstudio-workspace-file',
        onClick: function () {
          props.actions.onOpen(entry);
        },
        title: entry.path,
      },
      h(props.ui.Icon, { name: 'fileText', size: 14 }),
      h('span', { className: 'mdstudio-library-title' }, entry.name),
    ),
    renderWorkspaceActions(props, entry, onRenameFile),
  );
}

function flattenWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === 'directory' ? [entry, ...flattenWorkspaceEntries(entry.children)] : [entry],
  );
}

function findWorkspaceEntry(entries: WorkspaceEntry[], path: string): WorkspaceEntry | undefined {
  return flattenWorkspaceEntries(entries).find((entry) => entry.path === path);
}

function filterWorkspace(entries: WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  const filtered: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      const children = filterWorkspace(entry.children, query);
      if (entry.name.toLowerCase().includes(needle) || children.length) {
        filtered.push({ ...entry, children });
      }
    } else if (entry.name.toLowerCase().includes(needle)) {
      filtered.push(entry);
    }
  }
  return filtered;
}

function buildWorkspaceMenuItems(props: WorkspaceDialogProps): DshMenuEntry[] {
  const h = props.React.createElement;
  const t = props.t;
  return [
    { id: 'newFolder', label: t('workspace.newFolder'), icon: h(props.ui.Icon, { name: 'folder', size: 14 }) },
    { id: 'refresh', label: t('workspace.refresh'), icon: h(props.ui.Icon, { name: 'refresh', size: 14 }) },
    { type: 'separator', id: 'sep-ws' },
    { id: 'pick', label: t('workspace.pick'), icon: h(props.ui.Icon, { name: 'folderOpen', size: 14 }) },
  ];
}

export function WorkspaceDialog(props: WorkspaceDialogProps): ReactNode {
  const [query, setQuery] = props.React.useState('');
  const [collapsed, setCollapsed] = props.React.useState<Record<string, boolean>>({});
  const { menuOpen, updateMenuOpen, onModalClose } = useModalMenuState(props.React, props.open, props.onClose);
  const bodyRef = props.React.useRef<HTMLDivElement | null>(null);
  useDebouncedKeyTask(props.React, query, 0, props.open, function () {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  });
  if (!props.open) return null;
  const h = props.React.createElement;
  const t = props.t;
  const selectedName = props.selectedDir || t('workspace.root');
  const locationText = props.name ? props.name + (props.selectedDir ? ' / ' + props.selectedDir : '') : selectedName;
  const visibleEntries = filterWorkspace(props.entries, query);
  const treeState: WorkspaceTreeState = {
    collapsed,
    forceExpand: Boolean(query.trim()),
    onToggleDir: function (dirPath: string) {
      setCollapsed(function (prev) {
        return { ...prev, [dirPath]: !prev[dirPath] };
      });
    },
  };
  const title = t('workspace.title') + (props.name ? ' · ' + props.name : '');
  const onNewFile = function (): void {
    void props.actions.onPrompt({ title: t('workspace.filePrompt') }).then(function (name) {
      if (name) props.actions.onCreateFile(props.selectedDir, name);
    });
  };
  const onNewFolder = function (): void {
    void props.actions.onPrompt({ title: t('workspace.folderPrompt') }).then(function (name) {
      if (name) props.actions.onCreateDirectory(props.selectedDir, name);
    });
  };
  const onSelectMenu = function (id: string): void {
    updateMenuOpen(false, true);
    if (id === 'newFolder') onNewFolder();
    else if (id === 'refresh') props.actions.onRefresh();
    else if (id === 'pick') props.actions.onPickFolder();
  };
  const moreLabel = t('more');
  const closeLabel = t('close');
  return h(
    props.ui.Modal,
    {
      open: props.open,
      onClose: onModalClose,
      title: title,
      closeLabel: closeLabel,
      className: 'mdstudio-workspace-modal',
      headless: true,
    },
    h(
      'div',
      { className: 'mdstudio-library-head mdstudio-workspace-toolbar' },
      h(props.ui.Input, {
        type: 'search',
        icon: h(props.ui.Icon, { name: 'search', size: 14 }),
        className: 'mdstudio-workspace-search',
        wrapClassName: 'mdstudio-workspace-search-wrap',
        placeholder: t('workspace.search'),
        'aria-label': t('workspace.search'),
        value: query,
        autoFocus: true,
        onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
          setQuery(event.target.value);
        },
      }),
      h(
        'span',
        { className: 'mdstudio-workspace-loc', title: locationText },
        h(props.ui.Icon, { name: 'folderOpen', size: 13 }),
        h('span', { className: 'mdstudio-workspace-loc-text' }, locationText),
      ),
      h(
        props.ui.Button,
        {
          variant: 'primary',
          size: 'sm',
          icon: h(props.ui.Icon, { name: 'filePlus', size: 14 }),
          className: 'mdstudio-library-new-btn',
          onClick: onNewFile,
        },
        t('workspace.newFile'),
      ),
      h(props.ui.Menu, {
        open: menuOpen,
        portal: true,
        align: 'end',
        ariaLabel: moreLabel,
        listClassName: 'mdstudio-workspace-menu',
        items: buildWorkspaceMenuItems(props),
        onSelect: onSelectMenu,
        onClose: function () {
          updateMenuOpen(false);
        },
        anchor: h(props.ui.Tooltip, {
          label: moreLabel,
          side: 'bottom',
          disabled: menuOpen,
          children: h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-icon-btn mdstudio-workspace-more-btn' + (menuOpen ? ' is-active' : ''),
              'aria-label': moreLabel,
              'aria-haspopup': 'menu',
              'aria-expanded': menuOpen,
              onClick: function () {
                updateMenuOpen(!menuOpen);
              },
            },
            h(props.ui.Icon, { name: 'more', size: 15 }),
          ),
        }),
      }),
      h(props.ui.Tooltip, {
        label: closeLabel,
        side: 'bottom',
        children: h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-modal-close mdstudio-search-close',
            'aria-label': closeLabel,
            onClick: props.onClose,
          },
          h(props.ui.Icon, { name: 'close', size: 14 }),
        ),
      }),
    ),
    h(
      'div',
      { ref: bodyRef, className: 'mdstudio-library-body mdstudio-workspace-body' },
      props.error ? h('div', { className: 'mdstudio-host-error' }, props.error) : null,
      props.loading
        ? h('p', { className: 'mdstudio-help mdstudio-library-empty', role: 'status' }, t('workspace.loading'))
        : h(
            'div',
            { className: 'mdstudio-workspace-tree' },
            h(
              'button',
              {
                type: 'button',
                className: 'mdstudio-workspace-root' + (props.selectedDir ? '' : ' is-selected'),
                'aria-current': props.selectedDir ? undefined : 'true',
                onClick: function () {
                  props.actions.onSelectDirectory('');
                },
                onDragOver: function (event: ReactNamespace.DragEvent<HTMLButtonElement>) {
                  event.preventDefault();
                },
                onDrop: function (event: ReactNamespace.DragEvent<HTMLButtonElement>) {
                  event.preventDefault();
                  const source = event.dataTransfer?.getData('text/plain');
                  const sourceEntry = source ? findWorkspaceEntry(props.entries, source) : undefined;
                  if (sourceEntry) props.actions.onMove(sourceEntry, '');
                },
              },
              t('workspace.root'),
            ),
            visibleEntries.length
              ? visibleEntries.map(function (entry) {
                  return workspaceNode(props, entry, 0, treeState);
                })
              : h(
                  'p',
                  { className: 'mdstudio-help mdstudio-library-empty' },
                  query.trim() ? t('workspace.noResults') : t('workspace.empty'),
                ),
          ),
    ),
  );
}
