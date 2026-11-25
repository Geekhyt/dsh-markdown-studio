import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import type { SaveSkillInput } from '../application/use-writing-skills';
import {
  BUILTIN_HUMANIZER_ID,
  MAX_CUSTOM_SKILLS,
  MAX_SKILL_DESC_CHARS,
  MAX_SKILL_NAME_CHARS,
  nextCustomSkillName,
  parseSkillMarkdown,
  type WritingSkill,
} from '../domain/writing-skills';
import { useDebouncedKeyTask } from '../runtime/react-lifecycle';
import { CodeMirrorEditor } from './codemirror-editor';
import type { UiKit } from './ui-kit';

export interface SkillManagerActions {
  onClose: () => void;
  onSelectDefault: (id: string) => void;
  onSave: (input: SaveSkillInput) => WritingSkill | null;
  onDelete: (id: string) => void;
  onExport: (skill: WritingSkill) => void;
  onImportFile: (
    file: File | null | undefined,
  ) => Promise<{ name: string; description: string; instructions: string } | null>;
}

export interface SkillManagerDialogProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  open: boolean;
  targetId: string | null;
  modKey: string;
  skills: readonly WritingSkill[];
  activeSkillId: string;
  actions: SkillManagerActions;
}

interface DraftForm {
  selectedId: string | null;
  name: string;
  description: string;
  instructions: string;
  setAsDefault: boolean;
}

function buildInitialDraft(
  skills: readonly WritingSkill[],
  activeSkillId: string,
  targetId: string | null,
  defaultName: string,
  exampleBody: string,
): DraftForm {
  const chosenId = targetId || activeSkillId || BUILTIN_HUMANIZER_ID;
  const found = skills.find((s) => s.id === chosenId) || skills[0];
  if (found) {
    return {
      selectedId: found.id,
      name: found.name,
      description: found.description,
      instructions: found.instructions,
      setAsDefault: found.id === activeSkillId,
    };
  }
  const customs = skills.filter((s) => !s.builtin);
  return {
    selectedId: null,
    name: nextCustomSkillName(customs, defaultName),
    description: '',
    instructions: exampleBody,
    setAsDefault: true,
  };
}

function normalizePastedDraft(form: DraftForm, defaultName: string): SaveSkillInput {
  let name = form.name.trim();
  let description = form.description.trim();
  let instructions = form.instructions.trim();
  if (/^---\r?\n/.test(instructions)) {
    const parsed = parseSkillMarkdown(instructions, name || defaultName);
    if (!name) name = parsed.name;
    if (!description && parsed.description) description = parsed.description;
    instructions = parsed.instructions;
  }
  return { id: form.selectedId, name, description, instructions, setAsDefault: form.setAsDefault };
}

function renderInstructionsSurface(
  React: typeof ReactNamespace,
  editorKey: string,
  value: string,
  readOnly: boolean,
  cmFailed: boolean,
  placeholderText: string,
  ariaLabel: string,
  onChange: (next: string) => void,
  onKeyDown: (event: ReactNamespace.KeyboardEvent<HTMLElement>) => void,
  onCmError: () => void,
): ReactNode {
  const h = React.createElement;
  if (readOnly) {
    return h('pre', { className: 'mdstudio-skill-readonly', tabIndex: 0, 'aria-label': ariaLabel }, value);
  }
  const useCm = !cmFailed && typeof window !== 'undefined' && typeof window.ResizeObserver === 'function';
  if (useCm) {
    return h(
      'div',
      { className: 'mdstudio-skill-cm-box' },
      h(CodeMirrorEditor, {
        key: editorKey,
        React,
        value,
        config: {
          language: 'markdown',
          placeholder: placeholderText,
          ariaLabel,
          enableHistory: true,
        },
        onError: onCmError,
        onChange,
        onKeyDown,
      }),
    );
  }
  return h('textarea', {
    className: 'mdstudio-skill-textarea',
    value,
    placeholder: placeholderText,
    'aria-label': ariaLabel,
    spellCheck: false,
    onKeyDown,
    onChange: function (e: ReactNamespace.ChangeEvent<HTMLTextAreaElement>) {
      onChange(e.target.value);
    },
  });
}

function isModSaveShortcut(event: ReactNamespace.KeyboardEvent<HTMLElement>): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey) return false;
  return event.key.toLowerCase() === 's';
}

function renderSkillTabItem(
  props: SkillManagerDialogProps,
  item: WritingSkill,
  selected: boolean,
  onSelect: (skill: WritingSkill) => void,
): ReactNode {
  const h = props.React.createElement;
  const isDefault = item.id === props.activeSkillId;
  return h(
    'button',
    {
      type: 'button',
      key: item.id,
      role: 'tab',
      id: 'mdstudio-skill-tab-' + item.id,
      'aria-selected': selected,
      'aria-controls': 'mdstudio-skill-panel',
      tabIndex: selected ? 0 : -1,
      autoFocus: selected || undefined,
      'data-mdstudio-autofocus': selected ? '' : undefined,
      className: 'mdstudio-skill-item' + (selected ? ' is-active' : ''),
      title: item.name,
      onClick: function () {
        onSelect(item);
      },
    },
    isDefault ? h('span', { className: 'mdstudio-skill-default-dot', 'aria-hidden': 'true' }) : null,
    h('span', { className: 'mdstudio-skill-item-name' }, item.name),
    item.builtin ? h('span', { className: 'mdstudio-skill-item-chip' }, props.t('ai.builtinBadge')) : null,
  );
}

function nextTabIndex(key: string, current: number, total: number): number {
  if (key === 'ArrowRight') return (current + 1) % total;
  if (key === 'ArrowLeft') return (current - 1 + total) % total;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return -1;
}

function renderBuiltinSummaryBar(
  props: SkillManagerDialogProps,
  currentSkill: WritingSkill | null,
  customCount: number,
  onFork: () => void,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  return h(
    'div',
    { className: 'mdstudio-skill-builtin-head' },
    h(
      'div',
      { className: 'mdstudio-skill-builtin-copy' },
      h(
        'div',
        { className: 'mdstudio-skill-builtin-title-row' },
        h('span', { className: 'mdstudio-skill-builtin-title' }, currentSkill?.name),
        h(props.ui.Tag, { tone: 'outline' }, 'Humanizer-zh · MIT'),
      ),
      h('div', { className: 'mdstudio-skill-builtin-desc' }, currentSkill?.description),
    ),
    h(
      'div',
      { className: 'mdstudio-skill-builtin-actions' },
      props.activeSkillId !== BUILTIN_HUMANIZER_ID
        ? h(
            props.ui.Button,
            {
              variant: 'outline',
              size: 'sm',
              onClick: function () {
                props.actions.onSelectDefault(BUILTIN_HUMANIZER_ID);
              },
            },
            t('ai.setAsDefault'),
          )
        : h(props.ui.Tag, { tone: 'info' }, t('ai.currentDefault') + ' ' + props.modKey + 'J'),
      h(
        props.ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          disabled: customCount >= MAX_CUSTOM_SKILLS,
          onClick: onFork,
        },
        t('ai.forkSkill'),
      ),
    ),
  );
}

function renderCustomMetaFields(
  props: SkillManagerDialogProps,
  form: DraftForm,
  setForm: (next: DraftForm) => void,
  onKeyDown: (event: ReactNamespace.KeyboardEvent<HTMLElement>) => void,
): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  return h(
    'div',
    { className: 'mdstudio-skill-meta-grid' },
    h(
      'label',
      { className: 'mdstudio-skill-field' },
      h('span', { className: 'mdstudio-skill-label' }, t('ai.skillNameLabel')),
      h(props.ui.Input, {
        value: form.name,
        maxLength: MAX_SKILL_NAME_CHARS,
        placeholder: t('ai.skillNamePlaceholder'),
        'aria-label': t('ai.skillNameLabel'),
        onKeyDown,
        onChange: function (e: ReactNamespace.ChangeEvent<HTMLInputElement>) {
          setForm({ ...form, name: e.target.value });
        },
      }),
    ),
    h(
      'label',
      { className: 'mdstudio-skill-field' },
      h('span', { className: 'mdstudio-skill-label' }, t('ai.skillDescLabel')),
      h(props.ui.Input, {
        value: form.description,
        maxLength: MAX_SKILL_DESC_CHARS,
        placeholder: t('ai.skillDescPlaceholder'),
        'aria-label': t('ai.skillDescLabel'),
        onKeyDown,
        onChange: function (e: ReactNamespace.ChangeEvent<HTMLInputElement>) {
          setForm({ ...form, description: e.target.value });
        },
      }),
    ),
  );
}

export function SkillManagerDialog(props: SkillManagerDialogProps): ReactNode {
  if (!props.open) return null;
  return props.React.createElement(SkillManagerDialogContent, {
    ...props,
    key: props.targetId || 'default',
  });
}

function SkillManagerDialogContent(props: SkillManagerDialogProps): ReactNode {
  const React = props.React;
  const h = React.createElement;
  const t = props.t;
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const mainRef = React.useRef<HTMLDivElement | null>(null);
  const customCount = props.skills.filter((s) => !s.builtin).length;
  const [form, setForm] = React.useState<DraftForm>(() =>
    buildInitialDraft(
      props.skills,
      props.activeSkillId,
      props.targetId,
      t('ai.defaultCustomName'),
      t('ai.exampleSkillBody'),
    ),
  );
  const [editorEpoch, setEditorEpoch] = React.useState(0);
  const [cmFailed, setCmFailed] = React.useState(false);
  useDebouncedKeyTask(React, (form.selectedId || '__draft__') + ':' + editorEpoch, 0, props.open, function () {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  });

  const currentSkill = form.selectedId ? props.skills.find((s) => s.id === form.selectedId) || null : null;
  const isBuiltin = Boolean(currentSkill?.builtin);
  const normalizedDraft = isBuiltin ? null : normalizePastedDraft(form, '');
  const canSaveDraft = Boolean(normalizedDraft && normalizedDraft.name && normalizedDraft.instructions);
  const closeLabel = t('close');

  function selectExisting(item: WritingSkill): void {
    if (item.id !== form.selectedId) setEditorEpoch((value) => value + 1);
    setForm({
      selectedId: item.id,
      name: item.name,
      description: item.description,
      instructions: item.instructions,
      setAsDefault: item.id === props.activeSkillId,
    });
  }

  function startNewDraft(seed?: { name: string; description: string; instructions: string }): void {
    const customs = props.skills.filter((s) => !s.builtin);
    setEditorEpoch((value) => value + 1);
    setForm({
      selectedId: null,
      name: seed?.name || nextCustomSkillName(customs, t('ai.defaultCustomName')),
      description: seed?.description || '',
      instructions: seed?.instructions || t('ai.exampleSkillBody'),
      setAsDefault: true,
    });
  }

  function handleSave(): void {
    if (isBuiltin || !canSaveDraft) return;
    const normalized = normalizePastedDraft(form, t('ai.defaultCustomName'));
    const saved = props.actions.onSave(normalized);
    if (saved) {
      setForm({
        selectedId: saved.id,
        name: saved.name,
        description: saved.description,
        instructions: saved.instructions,
        setAsDefault: normalized.setAsDefault,
      });
    }
  }

  function handleDelete(): void {
    if (!currentSkill || currentSkill.builtin) return;
    props.actions.onDelete(currentSkill.id);
    const builtin = props.skills[0];
    if (builtin) selectExisting(builtin);
  }

  function onEditorKeyDown(event: ReactNamespace.KeyboardEvent<HTMLElement>): void {
    if (isModSaveShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      handleSave();
    }
  }

  async function handleFileChosen(event: ReactNamespace.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    const parsed = await props.actions.onImportFile(file);
    if (parsed) startNewDraft(parsed);
  }

  return h(
    props.ui.Modal,
    {
      open: props.open,
      onClose: props.actions.onClose,
      title: t('ai.managerTitle'),
      closeLabel,
      headless: true,
      className: 'mdstudio-skill-modal',
    },
    h('input', {
      ref: function (el: HTMLInputElement | null) {
        fileRef.current = el;
      },
      type: 'file',
      hidden: true,
      accept: '.md,.txt,text/markdown',
      className: 'mdstudio-hidden-input',
      tabIndex: -1,
      'aria-hidden': 'true',
      onChange: function (e: ReactNamespace.ChangeEvent<HTMLInputElement>) {
        void handleFileChosen(e);
      },
    }),
    h(
      'div',
      { className: 'mdstudio-skill-head' },
      h('span', { className: 'mdstudio-skill-head-title' }, t('ai.managerTitle')),
      h(
        'div',
        {
          className: 'mdstudio-skill-tabs',
          role: 'tablist',
          'aria-label': t('ai.skillListLabel'),
          'aria-orientation': 'horizontal',
          onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLDivElement>) {
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            if (!tabs.length) return;
            const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
            const next = nextTabIndex(event.key, Math.max(0, current), tabs.length);
            if (next < 0) return;
            event.preventDefault();
            tabs[next].click();
            tabs[next].focus();
          },
        },
        props.skills.map(function (item) {
          return renderSkillTabItem(props, item, form.selectedId === item.id, selectExisting);
        }),
        form.selectedId === null
          ? h(
              'button',
              {
                type: 'button',
                role: 'tab',
                id: 'mdstudio-skill-tab-draft',
                'aria-selected': true,
                'aria-controls': 'mdstudio-skill-panel',
                tabIndex: 0,
                className: 'mdstudio-skill-item is-active is-draft',
              },
              h('span', { className: 'mdstudio-skill-item-name' }, form.name.trim() || t('ai.newSkillDraft')),
              h('span', { className: 'mdstudio-skill-item-chip is-draft' }, t('ai.newDraftChip')),
            )
          : null,
      ),
      h(
        'div',
        { className: 'mdstudio-skill-head-actions' },
        h(
          props.ui.Button,
          {
            variant: 'outline',
            size: 'sm',
            icon: h(props.ui.Icon, { name: 'filePlus', size: 13 }),
            disabled: customCount >= MAX_CUSTOM_SKILLS,
            onClick: function () {
              startNewDraft();
            },
          },
          t('ai.newSkillBtn'),
        ),
        h(
          props.ui.Button,
          {
            variant: 'outline',
            size: 'sm',
            icon: h(props.ui.Icon, { name: 'fileInput', size: 13 }),
            disabled: customCount >= MAX_CUSTOM_SKILLS,
            onClick: function () {
              fileRef.current?.click();
            },
          },
          t('ai.importSkillBtn'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn mdstudio-modal-close',
            title: closeLabel,
            'aria-label': closeLabel,
            onClick: props.actions.onClose,
          },
          h(props.ui.Icon, { name: 'close', size: 14 }),
        ),
      ),
    ),
    h(
      'div',
      {
        ref: mainRef,
        className: 'mdstudio-skill-main',
        id: 'mdstudio-skill-panel',
        role: 'tabpanel',
        'aria-labelledby': form.selectedId ? 'mdstudio-skill-tab-' + form.selectedId : 'mdstudio-skill-tab-draft',
      },
      isBuiltin
        ? renderBuiltinSummaryBar(props, currentSkill, customCount, function () {
            if (!currentSkill) return;
            startNewDraft({
              name: currentSkill.name + t('ai.forkSuffix'),
              description: currentSkill.description,
              instructions: currentSkill.instructions,
            });
          })
        : renderCustomMetaFields(props, form, setForm, onEditorKeyDown),
      !isBuiltin
        ? h(
            'div',
            { className: 'mdstudio-skill-body-head' },
            h('span', { className: 'mdstudio-skill-label' }, t('ai.skillBodyLabel')),
            h(props.ui.Checkbox, {
              checked: form.setAsDefault,
              onChange: function (checked: boolean) {
                setForm({ ...form, setAsDefault: checked });
              },
              label: t('ai.setDefaultCheckbox') + ' (' + props.modKey + 'J)',
            }),
          )
        : null,
      renderInstructionsSurface(
        React,
        'skill-ed-' + editorEpoch,
        form.instructions,
        isBuiltin,
        cmFailed,
        t('ai.skillBodyPlaceholder'),
        t('ai.skillBodyLabel'),
        function (next) {
          setForm(function (prev) {
            return { ...prev, instructions: next };
          });
        },
        onEditorKeyDown,
        function () {
          setCmFailed(true);
        },
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-skill-foot' },
      h('span', { className: 'mdstudio-skill-foot-hint', title: t('ai.localOnlyHint') }, t('ai.localOnlyHint')),
      h(
        'div',
        { className: 'mdstudio-skill-foot-actions' },
        currentSkill && !currentSkill.builtin
          ? h(
              props.ui.Button,
              { variant: 'ghost', size: 'sm', className: 'is-danger', onClick: handleDelete },
              t('drawer.deleteCustomTheme'),
            )
          : null,
        h(
          props.ui.Button,
          {
            variant: 'outline',
            size: 'sm',
            onClick: function () {
              props.actions.onExport(
                currentSkill || {
                  id: 'draft',
                  name: form.name.trim() || t('ai.defaultCustomName'),
                  description: form.description.trim(),
                  instructions: form.instructions,
                },
              );
            },
          },
          t('ai.exportSkillBtn'),
        ),
        !isBuiltin
          ? h(
              props.ui.Button,
              {
                variant: 'primary',
                size: 'sm',
                disabled: !canSaveDraft,
                onClick: handleSave,
              },
              t('ai.saveSkillBtn'),
            )
          : null,
      ),
    ),
  );
}
