import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import type { AiReviewSession } from '../application/use-writing-skills';
import type { WritingSkill } from '../domain/writing-skills';
import type { EditorInlineBlock } from '../domain/editor-types';
import type { DshMenuEntry } from '../types/dsh-primitives';
import { PORTALED_MENU_SELECTOR } from './selection-bubble';
import { toMenuShortcut } from './shortcut-model';
import type { UiKit } from './ui-kit';

export interface SkillSplitTriggerProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  modKey: string;
  skills: readonly WritingSkill[];
  activeSkill: WritingSkill;
  busy: boolean;
  style?: ReactNamespace.CSSProperties;
  onRun: (skill?: WritingSkill) => void;
  onOpenManager: () => void;
}

const MANAGE_MENU_ID = '__manage_skills__';

function buildSkillMenuItems(
  React: typeof ReactNamespace,
  icons: UiKit,
  t: (key: string) => string,
  skills: readonly WritingSkill[],
  activeSkillId: string,
  modKey: string,
): DshMenuEntry[] {
  const h = React.createElement;
  const items: DshMenuEntry[] = [];
  for (const skill of skills) {
    items.push({
      id: skill.id,
      label: skill.name,
      icon: h(icons.Icon, { name: 'sparkles', size: 14 }),
      shortcut: skill.id === activeSkillId ? toMenuShortcut([modKey, 'J']) : undefined,
    });
  }
  items.push({ type: 'separator', id: 'sep-skills-manage' });
  items.push({
    id: MANAGE_MENU_ID,
    label: t('ai.manageSkills'),
    icon: h(icons.Icon, { name: 'filePlus', size: 14 }),
  });
  return items;
}

export function SkillSplitTrigger(props: SkillSplitTriggerProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const icons = props.ui;
  const [open, setOpen] = props.React.useState(false);
  const items = buildSkillMenuItems(props.React, icons, t, props.skills, props.activeSkill.id, props.modKey);
  const runHint = props.activeSkill.name + ' · ' + props.modKey + 'J';

  function handleSelect(id: string): void {
    setOpen(false);
    if (id === MANAGE_MENU_ID) {
      props.onOpenManager();
      return;
    }
    const chosen = props.skills.find((item) => item.id === id);
    if (chosen) props.onRun(chosen);
  }

  const runBtn = h(
    'button',
    {
      type: 'button',
      className: 'mdstudio-tool mdstudio-skill-run-btn',
      disabled: props.busy,
      'aria-label': runHint,
      onClick: function () {
        props.onRun(props.activeSkill);
      },
    },
    h(icons.Icon, { name: 'sparkles', size: 14 }),
    h(
      'span',
      { className: 'mdstudio-tool-text mdstudio-skill-run-label', title: props.activeSkill.name },
      props.activeSkill.name,
    ),
  );

  const caretBtn = h(
    'button',
    {
      type: 'button',
      className: 'mdstudio-tool mdstudio-skill-caret-btn' + (open ? ' is-active' : ''),
      'aria-label': t('ai.switchSkill'),
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: function () {
        setOpen(!open);
      },
    },
    h(
      'span',
      { className: 'mdstudio-heading-caret', 'aria-hidden': 'true' },
      h(icons.Icon, { name: 'chevronDown', size: 12 }),
    ),
  );

  return h(
    'div',
    {
      className: 'mdstudio-skill-split is-floating' + (props.busy ? ' is-busy' : ''),
      style: props.style,
      onMouseDown: function (event: ReactNamespace.MouseEvent<HTMLDivElement>) {
        const target = event.target as Element | null;
        if (target && typeof target.closest === 'function' && target.closest(PORTALED_MENU_SELECTOR)) return;
        event.preventDefault();
      },
    },
    runBtn,
    h(icons.Menu, {
      open,
      align: 'start',
      side: 'bottom',
      portal: true,
      autoFocus: true,
      selection: 'check',
      selectedIds: [props.activeSkill.id],
      className: 'mdstudio-skill-menu-anchor',
      listClassName: 'mdstudio-skill-menu-list',
      ariaLabel: t('ai.switchSkill'),
      items,
      onSelect: handleSelect,
      onClose: function () {
        setOpen(false);
      },
      anchor: caretBtn,
    }),
  );
}

export interface AiReviewHeaderProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  session: AiReviewSession | null;
  useCodeMirror: boolean;
  inlineBlocks: readonly EditorInlineBlock[];
  onCancel: () => void;
  onRetry: () => void;
}

function renderDiffSpanList(
  h: typeof ReactNamespace.createElement,
  parts: readonly { text: string; changed?: boolean }[] | undefined,
  fallbackText: string,
  changedCls: string,
): ReactNode {
  if (!parts || !parts.length) return fallbackText;
  return parts.map(function (part, idx) {
    return part.changed ? h('span', { key: idx, className: changedCls }, part.text) : part.text;
  });
}

function renderFallbackBlocks(
  React: typeof ReactNamespace,
  icons: UiKit,
  blocks: readonly EditorInlineBlock[],
): ReactNode {
  const h = React.createElement;
  if (!blocks.length) return null;
  return h(
    'div',
    { className: 'mdstudio-ai-fallback-stack' },
    blocks.map(function (item) {
      return h(
        'div',
        {
          key: item.id,
          className: 'mdstudio-ai-fallback-diff',
          'data-mdstudio-ai-patch': item.id,
        },
        item.delParts && item.delParts.length
          ? h(
              'div',
              { className: 'mdstudio-ai-fallback-del' },
              renderDiffSpanList(h, item.delParts, '', 'mdstudio-ai-del-word'),
            )
          : null,
        h(
          'div',
          { className: 'mdstudio-ai-inline-card is-' + item.status },
          h(
            'div',
            { className: 'mdstudio-ai-inline-prose' },
            item.status === 'ready'
              ? renderDiffSpanList(h, item.addParts, item.text, 'mdstudio-ai-add-word')
              : item.text,
          ),
          h(
            'div',
            { className: 'mdstudio-ai-inline-bar' },
            item.warning
              ? h('span', { className: 'mdstudio-ai-inline-reason is-warn', title: item.warning }, item.warning)
              : null,
            h(
              'div',
              { className: 'mdstudio-ai-inline-btns' },
              h(
                icons.Button,
                { variant: 'outline', size: 'sm', className: 'mdstudio-diff-outline-btn', onClick: item.onSecondary },
                item.secondaryLabel,
              ),
              item.status === 'error' && item.retryLabel && item.onRetry
                ? h(
                    icons.Button,
                    { variant: 'outline', size: 'sm', className: 'mdstudio-diff-outline-btn', onClick: item.onRetry },
                    item.retryLabel,
                  )
                : null,
              item.status === 'ready'
                ? h(icons.Button, { variant: 'primary', size: 'sm', onClick: item.onPrimary }, item.primaryLabel)
                : null,
            ),
          ),
        ),
      );
    }),
  );
}

export function AiReviewOverlay(props: AiReviewHeaderProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const icons = props.ui;
  const session = props.session;
  if (!session) return null;

  const showErrorBanner = session.status === 'error' && !props.useCodeMirror;

  return h(
    props.React.Fragment,
    null,
    showErrorBanner
      ? h(
          'div',
          { className: 'mdstudio-ai-banner', role: 'alert' },
          h(
            'div',
            { className: 'mdstudio-ai-banner-main' },
            h(icons.StateDot, { state: 'error', size: 7 }),
            h('span', { className: 'mdstudio-ai-banner-title', title: session.error }, session.error),
          ),
          h(
            'div',
            { className: 'mdstudio-ai-banner-actions' },
            h(icons.Button, { variant: 'outline', size: 'sm', onClick: props.onRetry }, t('ai.retry')),
            h(icons.Button, { variant: 'outline', size: 'sm', onClick: props.onCancel }, t('ai.exitReview')),
          ),
        )
      : null,
    !props.useCodeMirror ? renderFallbackBlocks(props.React, icons, props.inlineBlocks) : null,
  );
}
