import type * as ReactNamespace from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useDelayedFlag } from '../runtime/react-lifecycle';
import type { DshMenuEntry } from '../types/dsh-primitives';
import { BrandMark } from './brand-mark';
import type { IconName } from './icons';
import { toMenuShortcut } from './shortcut-model';
import type { UiKit } from './ui-kit';

export interface HeaderBarState {
  title: string;
  fileName: string;
  view: 'split' | 'edit' | 'preview';
  drawerOpen: boolean;
  menuOpen: boolean;
  copying: boolean;
  modKey: string;
  shiftKey: string;
}

export interface HeaderBarActions {
  onTitle: (value: string) => void;
  onView: (view: 'split' | 'edit' | 'preview') => void;
  onImmersive: () => void;
  onOpenLibrary: () => void;
  onToggleDrawer: () => void;
  onToggleMenu: () => void;
  onCloseMenu?: () => void;
  onNew: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHtml: () => void;
  onExportMarkdown: () => void;
  onExportBundle: () => void;
  onImport: () => void;
  onManageSkills?: () => void;
  onCopyText: () => void;
  onShortcuts: () => void;
  onSample: () => void;
  onClear: () => void;
  onCopy: () => void;
}

export interface HeaderBarProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  state: HeaderBarState;
  actions: HeaderBarActions;
}

function closeHeaderMenu(props: HeaderBarProps): void {
  if (props.actions.onCloseMenu) {
    props.actions.onCloseMenu();
    return;
  }
  if (props.state.menuOpen) props.actions.onToggleMenu();
}

function buildHeaderMenuEntries(
  props: HeaderBarProps,
  icon: (name: IconName, size?: number) => ReactNode,
): DshMenuEntry[] {
  const t = props.t;
  return [
    { type: 'label', id: 'grp-view', text: t('menu.groupView') },
    { id: 'split', label: t('view.split'), icon: icon('split', 14) },
    { id: 'edit', label: t('view.edit'), icon: icon('pencil', 14) },
    { id: 'preview', label: t('view.preview'), icon: icon('eye', 14) },
    {
      id: 'immersive',
      label: t('immersive.enter'),
      icon: icon('focus', 14),
      shortcut: toMenuShortcut([props.state.modKey, props.state.shiftKey, 'F']),
    },
    { type: 'separator', id: 'sep-doc' },
    { type: 'label', id: 'grp-doc', text: t('menu.groupDoc') },
    { id: 'library', label: t('menu.library'), icon: icon('books', 14) },
    { id: 'new', label: t('menu.newDoc'), icon: icon('filePlus', 14) },
    { id: 'openFolder', label: t('menu.openFolder'), icon: icon('workspaceTree', 14) },
    { id: 'openFile', label: t('menu.openFile'), icon: icon('fileText', 14) },
    {
      id: 'save',
      label: t('menu.saveFile'),
      icon: icon('save', 14),
      shortcut: toMenuShortcut([props.state.modKey, 'S']),
    },
    { id: 'saveAs', label: t('menu.saveAs'), icon: icon('fileOutput', 14) },
    { type: 'separator', id: 'sep-export' },
    { type: 'label', id: 'grp-export', text: t('menu.groupExport') },
    { id: 'exportHtml', label: t('menu.exportHtml'), icon: icon('fileCode', 14) },
    { id: 'exportMd', label: t('menu.exportMd'), icon: icon('download', 14) },
    { id: 'exportZip', label: t('menu.exportZip'), icon: icon('archive', 14) },
    { id: 'import', label: t('menu.import'), icon: icon('fileInput', 14) },
    { type: 'separator', id: 'sep-more' },
    { type: 'label', id: 'grp-more', text: t('menu.groupMore') },
    ...(props.actions.onManageSkills
      ? [{ id: 'manageSkills', label: t('menu.writingSkills'), icon: icon('sparkles', 14) }]
      : []),
    { id: 'copyText', label: t('menu.copyText'), icon: icon('copy', 14) },
    { id: 'shortcuts', label: t('menu.shortcuts'), icon: icon('keyboard', 14) },
    { id: 'sample', label: t('menu.sample'), icon: icon('sparkles', 14) },
    { type: 'separator', id: 'sep-danger' },
    { id: 'clear', label: t('menu.clear'), icon: icon('trash', 14), danger: true },
  ];
}

function buildHeaderActionsMap(actions: HeaderBarActions): Record<string, () => void> {
  return {
    split: function () {
      actions.onView('split');
    },
    edit: function () {
      actions.onView('edit');
    },
    preview: function () {
      actions.onView('preview');
    },
    immersive: actions.onImmersive,
    library: actions.onOpenLibrary,
    new: actions.onNew,
    openFolder: actions.onOpenFolder,
    openFile: actions.onOpenFile,
    save: actions.onSave,
    saveAs: actions.onSaveAs,
    exportHtml: actions.onExportHtml,
    exportMd: actions.onExportMarkdown,
    exportZip: actions.onExportBundle,
    import: actions.onImport,
    ...(actions.onManageSkills ? { manageSkills: actions.onManageSkills } : {}),
    copyText: actions.onCopyText,
    shortcuts: actions.onShortcuts,
    sample: actions.onSample,
    clear: actions.onClear,
  };
}

export function HeaderBar(props: HeaderBarProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const ui = props.ui;
  const state = props.state;
  const actions = props.actions;
  const view = state.view;
  const showCopyBusy = useDelayedFlag(props.React, state.copying, 180);

  const icon = function (name: IconName, size = 16): ReactNode {
    return h(ui.Icon, { name: name, size: size });
  };
  const tip = function (label: string, child: ReactElement, disabled = false): ReactNode {
    return h(ui.Tooltip, { label: label, side: 'bottom', disabled: disabled, children: child });
  };
  const actionMap = buildHeaderActionsMap(actions);
  const onSelectMenu = function (id: string): void {
    closeHeaderMenu(props);
    const fn = actionMap[id];
    if (fn) fn();
  };

  const viewSegment = function (target: 'split' | 'edit' | 'preview', glyph: IconName): ReactNode {
    const label = t('view.' + target);
    const active = view === target;
    return tip(
      label,
      h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-icon-btn' + (active ? ' is-active' : ''),
          'aria-pressed': active,
          'aria-label': label,
          onClick: function () {
            actions.onView(target);
          },
        },
        icon(glyph, 15),
      ),
    );
  };

  const focusLabel = t('immersive.enter') + ' · ' + state.modKey + state.shiftKey + 'F';
  const copyTitle = state.copying ? t('copy.working') : t('copy');

  return h(
    'div',
    { className: 'mdstudio-header', 'data-window-drag': 'true' },
    h(
      'div',
      { className: 'mdstudio-header-main' },
      h(
        'div',
        { className: 'mdstudio-brand', 'data-window-drag': 'true' },
        h(
          'span',
          { className: 'mdstudio-brand-badge', 'aria-hidden': 'true', 'data-window-drag': 'true' },
          h(BrandMark, { React: props.React, size: 26 }),
        ),
        h('span', { className: 'mdstudio-brand-name', 'data-window-drag': 'true' }, t('brand')),
      ),
      h('span', { className: 'mdstudio-header-divider', 'aria-hidden': 'true' }),
      h('input', {
        className: 'mdstudio-title-input',
        value: state.title,
        placeholder: t('docTitlePlaceholder'),
        'aria-label': t('docTitlePlaceholder'),
        spellCheck: false,
        onChange: function (event) {
          actions.onTitle(event.target.value);
        },
      }),
      state.fileName ? h('span', { className: 'mdstudio-file-name', title: state.fileName }, state.fileName) : null,
    ),
    h(
      'div',
      { className: 'mdstudio-header-actions' },
      tip(
        t('library.title'),
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-library-btn',
            'aria-label': t('library.title'),
            onClick: actions.onOpenLibrary,
          },
          icon('books', 16),
        ),
      ),
      h('span', { className: 'mdstudio-header-divider', 'aria-hidden': 'true' }),
      h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-icon-btn mdstudio-mobile-view',
          title: view === 'preview' ? t('view.edit') : t('view.preview'),
          'aria-label': view === 'preview' ? t('view.edit') : t('view.preview'),
          'aria-pressed': view === 'preview',
          onClick: function () {
            actions.onView(view === 'preview' ? 'edit' : 'preview');
          },
        },
        icon(view === 'preview' ? 'pencil' : 'eye', 16),
      ),
      h(
        'div',
        { className: 'mdstudio-segmented', role: 'group', 'aria-label': t('view.split') },
        viewSegment('split', 'split'),
        viewSegment('edit', 'pencil'),
        viewSegment('preview', 'eye'),
      ),
      h('span', { className: 'mdstudio-header-divider', 'aria-hidden': 'true' }),
      tip(
        t('drawer.title'),
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-style-btn' + (state.drawerOpen ? ' is-active' : ''),
            'aria-label': t('drawer.title'),
            'aria-expanded': state.drawerOpen,
            onClick: actions.onToggleDrawer,
          },
          icon('sliders', 16),
        ),
      ),
      tip(
        focusLabel,
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-focus-btn',
            'aria-label': t('immersive.enter'),
            onClick: actions.onImmersive,
          },
          icon('focus', 16),
        ),
      ),
      h(ui.Menu, {
        open: state.menuOpen,
        align: 'end',
        side: 'bottom',
        portal: true,
        autoFocus: true,
        selection: 'check',
        selectedIds: [view],
        listClassName: 'mdstudio-header-menu',
        ariaLabel: t('more'),
        onSelect: onSelectMenu,
        onClose: function () {
          closeHeaderMenu(props);
        },
        items: buildHeaderMenuEntries(props, icon),
        anchor: tip(
          t('more'),
          h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-icon-btn' + (state.menuOpen ? ' is-active' : ''),
              'aria-label': t('more'),
              'aria-haspopup': 'menu',
              'aria-expanded': state.menuOpen,
              onClick: actions.onToggleMenu,
            },
            icon('more', 16),
          ),
          state.menuOpen,
        ),
      }),
      tip(
        t('copy') + ' · ' + state.modKey + '↵',
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-copy-btn',
            onClick: actions.onCopy,
            'aria-label': copyTitle,
            'aria-busy': state.copying,
            'aria-disabled': state.copying ? 'true' : undefined,
          },
          h(
            'span',
            { className: 'mdstudio-copy-icon' + (showCopyBusy ? ' is-busy' : ''), 'aria-hidden': 'true' },
            h('span', { className: 'mdstudio-copy-glyph' }, h(ui.Icon, { name: 'copy' })),
            h('span', { className: 'mdstudio-spinner' }),
          ),
          h('span', { className: 'mdstudio-copy-label' }, t('copy')),
        ),
      ),
    ),
  );
}
