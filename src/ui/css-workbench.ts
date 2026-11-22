import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import {
  createCustomThemeId,
  extractCustomThemePreview,
  findCustomTheme,
  MAX_CUSTOM_NAME_CHARS,
  MAX_CUSTOM_THEMES,
  nextCustomThemeName,
  removeCustomTheme,
  upsertCustomTheme,
} from '../domain/custom-themes';
import { useDebouncedKeyTask, useMountDisposable } from '../runtime/react-lifecycle';
import type { CustomTheme, ThemeSettings } from '../themes';
import * as themes from '../themes';
import type { DshTagTone } from '../types/dsh-primitives';
import { CodeMirrorEditor } from './codemirror-editor';
import type { UiKit } from './ui-kit';

interface CustomStatus {
  tone: DshTagTone;
  cls: string;
  text: string;
}

function isCustomDirty(editing: CustomTheme | null, nameDraft: string, cssDraft: string): boolean {
  if (!editing) return false;
  const normalizedName = nameDraft.trim() || editing.name;
  return editing.name !== normalizedName || editing.css !== cssDraft;
}

function resolveCustomStatus(
  editing: CustomTheme | null,
  activeThemeId: string,
  dirty: boolean,
  t: (key: string) => string,
): CustomStatus {
  if (!editing) return { tone: 'outline', cls: 'mdstudio-css-state', text: t('drawer.cssNotApplied') };
  if (dirty) return { tone: 'warning', cls: 'mdstudio-css-state is-dirty', text: t('drawer.cssDirty') };
  if (editing.id === activeThemeId) {
    return { tone: 'success', cls: 'mdstudio-css-state is-applied', text: t('drawer.cssApplied') };
  }
  return { tone: 'outline', cls: 'mdstudio-css-state', text: t('drawer.customSaved') };
}

function resolveTargetDraft(
  settings: ThemeSettings,
  targetId: string | null,
  baseName: string,
  locale: 'zh' | 'en',
): { editingId: string | null; nameDraft: string; cssDraft: string } {
  const list = settings.customThemes || [];
  if (targetId) {
    const found = findCustomTheme(list, targetId);
    if (found) {
      return { editingId: found.id, nameDraft: found.name, cssDraft: found.css };
    }
  }
  return {
    editingId: null,
    nameDraft: nextCustomThemeName(list, baseName),
    cssDraft: themes.exampleCss(locale),
  };
}

export interface CssWorkbenchProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  open?: boolean;
  visible: boolean;
  targetId: string | null;
  requestSeq: number;
  settings: ThemeSettings;
  modKey: string;
  locale?: 'zh' | 'en';
  onBack: () => void;
  onSettings: (patch: Partial<ThemeSettings>) => void;
  onNotify: (text: string) => void;
  onDraftCssChange: (css: string) => void;
}

function renderThemeChipStrip(
  props: CssWorkbenchProps,
  editing: CustomTheme | null,
  onSelect: (theme: CustomTheme) => void,
  onNew: () => void,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const list = props.settings.customThemes || [];
  return h(
    'div',
    { className: 'mdstudio-custom-bar' },
    h(
      'div',
      { className: 'mdstudio-custom-chips', role: 'group', 'aria-label': t('drawer.customListLabel') },
      list.map(function (item) {
        const selected = editing ? editing.id === item.id : false;
        const preview = extractCustomThemePreview(item.css, props.settings.accent);
        return h(
          'button',
          {
            type: 'button',
            key: item.id,
            className: 'mdstudio-custom-chip' + (selected ? ' is-active' : ''),
            'aria-pressed': selected,
            onClick: function () {
              onSelect(item);
            },
          },
          h('span', {
            className: 'mdstudio-custom-chip-dot',
            'aria-hidden': true,
            style: { backgroundColor: preview.accent },
          }),
          h('span', { className: 'mdstudio-custom-chip-label' }, item.name),
        );
      }),
      editing === null
        ? h('span', { className: 'mdstudio-custom-chip is-active is-draft' }, t('drawer.customDraftChip'))
        : null,
    ),
    h(
      props.ui.Button,
      {
        variant: 'outline',
        size: 'sm',
        icon: h(props.ui.Icon, { name: 'filePlus', size: 12 }),
        className: 'mdstudio-custom-add-btn',
        disabled: list.length >= MAX_CUSTOM_THEMES,
        onClick: onNew,
      },
      t('drawer.customNewShort'),
    ),
  );
}

function renderCssSurface(
  props: CssWorkbenchProps,
  editorKey: string,
  cssDraft: string,
  setCssDraft: (value: string) => void,
  onKeyDown: (event: ReactNamespace.KeyboardEvent<HTMLElement>) => void,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const useCm = typeof window !== 'undefined' && typeof window.ResizeObserver === 'function';
  if (useCm) {
    return h(
      'div',
      { className: 'mdstudio-css-codemirror' },
      h(CodeMirrorEditor, {
        key: editorKey,
        React: props.React,
        value: cssDraft,
        config: {
          language: 'css',
          placeholder: t('drawer.customPlaceholder'),
          ariaLabel: t('drawer.custom'),
          enableHistory: true,
        },
        onChange: setCssDraft,
        onKeyDown: onKeyDown,
      }),
    );
  }
  return h('textarea', {
    className: 'mdstudio-css',
    value: cssDraft,
    placeholder: t('drawer.customPlaceholder'),
    spellCheck: false,
    'aria-label': t('drawer.custom'),
    onKeyDown: onKeyDown,
    onChange: function (event: ReactNamespace.ChangeEvent<HTMLTextAreaElement>) {
      setCssDraft(event.target.value);
    },
  });
}

function hasOnlyModKey(event: ReactNamespace.KeyboardEvent<HTMLElement>): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

function isSaveKeyEvent(event: ReactNamespace.KeyboardEvent<HTMLElement>): boolean {
  return hasOnlyModKey(event) && event.key.toLowerCase() === 's';
}

function canSaveTheme(customList: CustomTheme[], editing: CustomTheme | null, trimmedCss: string): boolean {
  if (!trimmedCss) return false;
  return Boolean(editing) || customList.length < MAX_CUSTOM_THEMES;
}

function resolveSavedThemeIdentity(
  customList: CustomTheme[],
  editing: CustomTheme | null,
  nameDraft: string,
  baseName: string,
): { id: string; finalName: string } {
  const fallbackName = editing ? editing.name : nextCustomThemeName(customList, baseName);
  const finalName = (nameDraft.trim() || fallbackName).slice(0, MAX_CUSTOM_NAME_CHARS);
  return { id: editing ? editing.id : createCustomThemeId(), finalName };
}

function buildSavedThemeUpdate(
  settings: ThemeSettings,
  editing: CustomTheme | null,
  nameDraft: string,
  cssDraft: string,
  baseName: string,
): { id: string; finalName: string; trimmedCss: string; patch: Partial<ThemeSettings> } | null {
  const customList = settings.customThemes || [];
  const trimmedCss = cssDraft.trim();
  if (!canSaveTheme(customList, editing, trimmedCss)) return null;
  const { id, finalName } = resolveSavedThemeIdentity(customList, editing, nameDraft, baseName);
  const nextList = upsertCustomTheme(customList, { id, name: finalName, css: trimmedCss });
  const preview = extractCustomThemePreview(trimmedCss, settings.accent);
  return {
    id,
    finalName,
    trimmedCss,
    patch: {
      customThemes: nextList,
      theme: id,
      accent: preview.accent,
    },
  };
}

export function CssWorkbenchPane(props: CssWorkbenchProps): ReactNode {
  if (!(props.open ?? props.visible)) return null;
  return props.React.createElement(CssWorkbenchContent, { ...props, key: 'css-wb-' + props.requestSeq });
}

function CssWorkbenchContent(props: CssWorkbenchProps): ReactNode {
  const React = props.React;
  const h = React.createElement;
  const t = props.t;
  const ui = props.ui;
  const settings = props.settings;
  const customList = settings.customThemes || [];
  const rawLocale = props.locale || props.ui.locale?.();
  const cssLocale: 'zh' | 'en' = rawLocale ? (/^en/i.test(rawLocale) ? 'en' : 'zh') : 'zh';
  const [draft, setDraft] = React.useState(() =>
    resolveTargetDraft(settings, props.targetId, t('drawer.defaultCustomName'), cssLocale),
  );
  const [editorEpoch, setEditorEpoch] = React.useState(0);
  const { editingId, nameDraft, cssDraft } = draft;
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);

  function commitDraft(
    next: { editingId: string | null; nameDraft: string; cssDraft: string },
    resetEditorSession = false,
  ): void {
    setDraft(next);
    if (resetEditorSession) setEditorEpoch((value) => value + 1);
    props.onDraftCssChange(next.cssDraft);
  }

  function updateCssDraft(next: string): void {
    setDraft((prev) => ({ ...prev, cssDraft: next }));
    props.onDraftCssChange(next);
  }

  useMountDisposable(React, function () {
    props.onDraftCssChange(draft.cssDraft);
    const focusTimer = window.setTimeout(function () {
      const nameEl = nameInputRef.current;
      if (draft.editingId === null) {
        nameEl?.focus();
        return;
      }
      const pane = nameEl?.closest<HTMLElement>('.mdstudio-css-workbench');
      if (!pane || pane.contains(document.activeElement)) return;
      const target = pane.querySelector<HTMLElement>('.cm-content, textarea.mdstudio-css') || nameEl;
      target?.focus();
    }, 20);
    return function () {
      window.clearTimeout(focusTimer);
      props.onDraftCssChange('');
    };
  });

  const editingMissing = Boolean(editingId && !findCustomTheme(customList, editingId));
  useDebouncedKeyTask(React, editingId || '', 0, editingMissing, function () {
    const fallback = customList[0] || null;
    if (fallback) {
      commitDraft({ editingId: fallback.id, nameDraft: fallback.name, cssDraft: fallback.css }, true);
    } else {
      commitDraft(
        {
          editingId: null,
          nameDraft: nextCustomThemeName(customList, t('drawer.defaultCustomName')),
          cssDraft: themes.exampleCss(cssLocale),
        },
        true,
      );
    }
  });

  const editing = editingId ? findCustomTheme(customList, editingId) : null;
  const dirty = isCustomDirty(editing, nameDraft, cssDraft);
  const status = resolveCustomStatus(editing, settings.theme, dirty, t);

  function selectCustomTheme(item: CustomTheme): void {
    commitDraft({ editingId: item.id, nameDraft: item.name, cssDraft: item.css }, item.id !== editingId);
  }

  function startNewCustomTheme(): void {
    commitDraft(
      {
        editingId: null,
        nameDraft: nextCustomThemeName(customList, t('drawer.defaultCustomName')),
        cssDraft: themes.exampleCss(cssLocale),
      },
      true,
    );
    window.setTimeout(function () {
      nameInputRef.current?.focus();
    }, 20);
  }

  function saveCustomTheme(): void {
    const result = buildSavedThemeUpdate(settings, editing, nameDraft, cssDraft, t('drawer.defaultCustomName'));
    if (!result) return;
    props.onSettings(result.patch);
    commitDraft({ editingId: result.id, nameDraft: result.finalName, cssDraft: result.trimmedCss });
    props.onNotify(t('toast.cssApplied'));
  }

  function deleteCustomTheme(): void {
    if (!editing) return;
    const nextList = removeCustomTheme(customList, editing.id);
    const wasActive = settings.theme === editing.id;
    props.onSettings({
      customThemes: nextList,
      ...(wasActive ? { theme: themes.DEFAULT_SETTINGS.theme, accent: themes.DEFAULT_SETTINGS.accent } : {}),
    });
    const fallback = nextList[0] || null;
    if (fallback) {
      commitDraft({ editingId: fallback.id, nameDraft: fallback.name, cssDraft: fallback.css }, true);
    } else {
      commitDraft(
        {
          editingId: null,
          nameDraft: nextCustomThemeName(nextList, t('drawer.defaultCustomName')),
          cssDraft: themes.exampleCss(cssLocale),
        },
        true,
      );
    }
    props.onNotify(t('toast.customThemeDeleted'));
  }

  function onEditorKeyDown(event: ReactNamespace.KeyboardEvent<HTMLElement>): void {
    if (!isSaveKeyEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    saveCustomTheme();
  }

  return h(
    'div',
    {
      className: 'mdstudio-pane mdstudio-editor-pane mdstudio-css-workbench' + (props.visible ? '' : ' is-hidden'),
      'data-mdstudio-wb-seq': String(props.requestSeq),
      role: 'region',
      'aria-label': t('drawer.tabCss'),
    },
    h(
      'div',
      { className: 'mdstudio-css-head' },
      h(
        ui.Button,
        {
          variant: 'ghost',
          size: 'sm',
          icon: h(ui.Icon, { name: 'arrowLeft', size: 14 }),
          className: 'mdstudio-css-back-btn',
          onClick: props.onBack,
        },
        t('drawer.backToEditor'),
      ),
      h('span', { className: 'mdstudio-tool-sep', 'aria-hidden': 'true' }),
      h(ui.Input, {
        type: 'text',
        ref: function (el: HTMLInputElement | null) {
          nameInputRef.current = el;
        },
        className: 'mdstudio-input mdstudio-css-name',
        wrapClassName: 'mdstudio-css-name-wrap',
        value: nameDraft,
        maxLength: MAX_CUSTOM_NAME_CHARS,
        placeholder: t('drawer.customNamePlaceholder'),
        'aria-label': t('drawer.customName'),
        onKeyDown: onEditorKeyDown,
        onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
          const val = event.target.value;
          setDraft((prev) => ({ ...prev, nameDraft: val }));
        },
      }),
      h(
        'span',
        { role: 'status', className: 'mdstudio-custom-status-wrap' },
        h(ui.Tag, { tone: status.tone, className: status.cls }, status.text),
      ),
      h('div', { className: 'mdstudio-spacer' }),
      h(
        'div',
        { className: 'mdstudio-css-toolbar' },
        h(
          ui.Button,
          {
            variant: 'outline',
            size: 'sm',
            className: 'mdstudio-css-btn',
            onClick: function () {
              updateCssDraft(themes.exampleCss(cssLocale));
            },
          },
          t('drawer.restoreExample'),
        ),
        editing
          ? h(
              ui.Button,
              {
                variant: 'ghost',
                size: 'sm',
                className: 'mdstudio-css-btn is-danger',
                onClick: deleteCustomTheme,
              },
              t('drawer.deleteCustomTheme'),
            )
          : h(
              ui.Button,
              {
                variant: 'ghost',
                size: 'sm',
                className: 'mdstudio-css-btn is-danger',
                onClick: function () {
                  updateCssDraft('');
                },
              },
              t('drawer.clearCss'),
            ),
        h(
          ui.Button,
          {
            variant: 'primary',
            size: 'sm',
            className: 'mdstudio-css-btn',
            disabled: !canSaveTheme(customList, editing, cssDraft.trim()),
            onClick: saveCustomTheme,
          },
          t('drawer.saveCustomTheme'),
        ),
      ),
    ),
    renderThemeChipStrip(props, editing, selectCustomTheme, startNewCustomTheme),
    h(
      'div',
      { className: 'mdstudio-editor-wrap mdstudio-css-editor-wrap' },
      renderCssSurface(props, 'css-ed-' + editorEpoch, cssDraft, updateCssDraft, onEditorKeyDown),
    ),
    h(
      'div',
      { className: 'mdstudio-editor-stats' },
      h('span', null, t('drawer.cssLiveHint')),
      h('span', { className: 'mdstudio-editor-stats-dot', 'aria-hidden': 'true' }),
      h('span', null, props.modKey + 'S ' + t('drawer.saveCustomTheme')),
    ),
  );
}
