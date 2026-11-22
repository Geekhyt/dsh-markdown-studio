import type * as ReactNamespace from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { useAutoDismissTimer, useDocumentEvent, useWindowEvent } from '../runtime/react-lifecycle';
import type {
  DshButtonProps,
  DshCheckboxProps,
  DshIconProps,
  DshInputProps,
  DshMenuEntry,
  DshMenuItem,
  DshMenuProps,
  DshModalProps,
  DshPillProps,
  DshPrimitivesModule,
  DshStateDotProps,
  DshSwitchProps,
  DshTagProps,
  DshToastProps,
  DshTooltipProps,
} from '../types/dsh-primitives';
import { createIcon, type IconName } from './icons';

const PRIMITIVE_ICON_KEYS: Partial<Record<IconName, readonly (keyof DshPrimitivesModule)[]>> = {
  search: ['IconSearchOutlineRegular', 'IconSearchOutline16'],
  sliders: ['IconSlidersTwoOutlineRegular', 'IconSettingsOutlineRegular', 'IconSettingsOutline16'],
  more: ['IconEllipsisOutlineRegular', 'IconEllipsisOutline16'],
  filePlus: ['IconPlusOutlineRegular', 'IconPlusOutline16'],
  check: ['IconCheckOutlineRegular', 'IconCheckOutline16'],
  checkSquare: ['IconChecklistOutlineRegular'],
  close: ['IconCloseOutlineRegular', 'IconCloseOutline16'],
  copy: ['IconCopyOutlineRegular', 'IconCopyOutline16'],
  refresh: ['IconRefreshOutlineRegular', 'IconRefreshOutline16'],
  pencil: ['IconEditOutlineRegular', 'IconEditOutline16'],
  link: ['IconLinkOutlineRegular', 'IconLinkOutline16'],
  trash: ['IconTrashOutlineRegular', 'IconTrashOutline16'],
  alert: ['IconWarningOutlineRegular', 'IconWarningOutline16'],
  info: ['IconInfoOutlineRegular'],
  save: ['IconSaveOutlineRegular'],
  download: ['IconDownloadOutlineRegular', 'IconDownloadOutline16'],
  fileInput: ['IconUploadOutlineRegular'],
  focus: ['IconFullscreenOutlineRegular', 'IconFullscreenOutline16'],
  code: ['IconInspectOutlineRegular'],
  folder: ['IconFolderCloseRegular', 'IconFolderClose16'],
  folderOpen: ['IconFolderOpenOutlineRegular', 'IconFolderOpenOutline16'],
  workspaceTree: ['IconWorkspaceTreeOutlineRegular'],
  help: ['IconQuestionOutlineRegular', 'IconQuestionOutline14'],
  archive: ['IconArchiveOutlineRegular', 'IconArchiveOutline20'],
  sparkles: ['IconSparkleRegular', 'IconSparkle16'],
  eye: ['IconEyeOutlineRegular'],
  split: ['IconCompareSplitOutlineRegular'],
  fileText: ['IconBrowseOutlineRegular'],
  listBullet: ['IconFlatListOutlineRegular'],
  history: ['IconClockOutlineRegular'],
  chevronDown: ['IconChevronDownOutlineRegular'],
  chevronRight: ['IconChevronRightOutlineRegular'],
  dragHandle: ['IconDragHandleOutlineRegular'],
};

function isReactComponent<T>(value: unknown): value is T {
  if (typeof value === 'function') return true;
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

function resolveNativeIcon(mod: DshPrimitivesModule | null, name: IconName): ComponentType<DshIconProps> | null {
  const keys = mod ? PRIMITIVE_ICON_KEYS[name] : undefined;
  if (!mod || !keys) return null;
  for (const key of keys) {
    const candidate = mod[key];
    if (isReactComponent<ComponentType<DshIconProps>>(candidate)) return candidate;
  }
  return null;
}

function pickComponent<P>(
  mod: DshPrimitivesModule | null,
  key: keyof DshPrimitivesModule,
  fallback: ComponentType<P>,
): ComponentType<P> {
  const candidate = mod ? mod[key] : undefined;
  return isReactComponent<ComponentType<P>>(candidate) ? candidate : fallback;
}

function joinClass(base: string, extra?: string): string {
  return extra ? base + ' ' + extra : base;
}

function isMenuSep(entry: DshMenuEntry): entry is { type: 'separator'; id: string } {
  return 'type' in entry && entry.type === 'separator';
}

function isMenuLabel(entry: DshMenuEntry): entry is { type: 'label'; id: string; text: string } {
  return 'type' in entry && entry.type === 'label';
}

function nextMenuIndex(key: string, current: number, total: number): number {
  if (key === 'ArrowDown') return (current + 1) % total;
  if (key === 'ArrowUp') return (current - 1 + total) % total;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return -1;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]):not([tabindex="-1"]), input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    let cur: HTMLElement | null = element;
    while (cur && cur !== container) {
      const style = window.getComputedStyle(cur);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      cur = cur.parentElement;
    }
    return true;
  });
}

export function trapModalTab(event: ReactNamespace.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(event.currentTarget);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const onContainer = document.activeElement === event.currentTarget;
  if (event.shiftKey && (document.activeElement === first || onContainer)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || onContainer)) {
    event.preventDefault();
    first.focus();
  }
}

export type BridgedToastProps = Omit<DshToastProps, 'tone'> & { tone?: 'success' | 'error' | 'info' };
export type BridgedMenuProps = DshMenuProps & { ariaLabel?: string };

function withInputRef(
  React: typeof ReactNamespace,
  render: (props: DshInputProps, ref: ReactNamespace.ForwardedRef<HTMLInputElement>) => ReactElement,
): ComponentType<DshInputProps> {
  if (typeof React.forwardRef === 'function') {
    return React.forwardRef<HTMLInputElement, DshInputProps>(render);
  }
  return function PlainInput(props: DshInputProps) {
    return render(props, null);
  };
}

export function createDshBridge(React: typeof ReactNamespace, primitives?: DshPrimitivesModule | null) {
  const h = React.createElement;
  const FallbackIcon = createIcon(React);
  const mod = primitives ?? null;

  function Icon(props: { name: IconName; size?: number; strokeWidth?: number; className?: string }): ReactElement {
    const NativeIcon = resolveNativeIcon(mod, props.name);
    if (NativeIcon) {
      return h(NativeIcon, { size: props.size || 16, className: joinClass('mdstudio-icon', props.className) });
    }
    return h(FallbackIcon, props);
  }

  function FallbackButton(props: DshButtonProps): ReactElement {
    const { variant = 'ghost', size = 'md', icon, className, children, ...rest } = props;
    const legacy = variant === 'primary' ? 'mdstudio-btn is-primary' : 'mdstudio-btn';
    const cls = joinClass('mdstudio-dsh-btn ' + legacy + ' is-' + variant + ' is-' + size, className);
    return h(
      'button',
      { type: 'button', ...rest, 'data-mdstudio-autofocus': rest.autoFocus ? 'true' : undefined, className: cls },
      icon != null ? h('span', { className: 'mdstudio-dsh-btn-icon' }, icon) : null,
      children,
    );
  }

  function FallbackCheckbox(props: DshCheckboxProps): ReactElement {
    return h(
      'label',
      {
        className: joinClass('mdstudio-checkbox', props.className),
        title: props.title,
      },
      h('input', {
        type: 'checkbox',
        checked: Boolean(props.checked),
        disabled: Boolean(props.disabled),
        onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
          props.onChange(event.target.checked);
        },
      }),
      h('span', null, props.label),
    );
  }

  const FallbackInput = withInputRef(React, function FallbackInputInner(props, ref) {
    const { icon, className, wrapClassName, ...rest } = props;
    const inputNode = h('input', {
      ...rest,
      'data-mdstudio-autofocus': rest.autoFocus ? 'true' : undefined,
      ref,
      className: joinClass('mdstudio-input', className),
    });
    if (icon == null) return inputNode;
    return h(
      'span',
      { className: joinClass('mdstudio-input-wrap', wrapClassName) },
      h('span', { className: 'mdstudio-input-icon', 'aria-hidden': 'true' }, icon),
      inputNode,
    );
  });

  function FallbackSwitch(props: DshSwitchProps): ReactElement {
    const base = props.checked ? 'mdstudio-switch is-on' : 'mdstudio-switch';
    return h(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': Boolean(props.checked),
        'aria-label': props.label,
        title: props.title,
        disabled: Boolean(props.disabled),
        className: joinClass(base, props.className),
        onClick: function () {
          props.onChange(!props.checked);
        },
      },
      h('span', { className: 'mdstudio-switch-thumb' }),
    );
  }

  function FallbackPill(props: DshPillProps): ReactElement {
    const { active = false, className, children, ...rest } = props;
    const base = active ? 'mdstudio-pill is-active' : 'mdstudio-pill';
    return h(
      'button',
      { type: 'button', 'aria-pressed': active, ...rest, className: joinClass(base, className) },
      children,
    );
  }

  function FallbackTag(props: DshTagProps): ReactElement {
    return h(
      'span',
      { className: joinClass('mdstudio-tag', props.className), 'data-mdstudio-tone': props.tone || 'outline' },
      props.children,
    );
  }

  function FallbackStateDot(props: DshStateDotProps): ReactElement {
    const size = props.size || 8;
    return h('span', {
      className: joinClass('mdstudio-state-dot', props.className),
      'data-mdstudio-state': props.state,
      style: { width: size, height: size },
      'aria-hidden': 'true',
    });
  }

  function stripNativeTitle(child: ReactElement): ReactElement {
    const props = (child.props || {}) as { title?: string };
    return props.title !== undefined
      ? React.cloneElement(child as ReactElement<{ title?: string }>, { title: undefined })
      : child;
  }

  function FallbackTooltip(props: DshTooltipProps): ReactElement {
    const [tip, setTip] = React.useState<{ left: number; top: number } | null>(null);
    const [tipId] = React.useState(() => 'mdstudio-tip-' + Math.random().toString(36).slice(2, 8));
    const child = props.children as ReactElement<{
      title?: string;
      'aria-describedby'?: string;
      onMouseEnter?: (event: ReactNamespace.MouseEvent<HTMLElement>) => void;
      onMouseLeave?: (event: ReactNamespace.MouseEvent<HTMLElement>) => void;
      onFocus?: (event: ReactNamespace.FocusEvent<HTMLElement>) => void;
      onBlur?: (event: ReactNamespace.FocusEvent<HTMLElement>) => void;
      onClick?: (event: ReactNamespace.MouseEvent<HTMLElement>) => void;
    }>;
    const show = function (target: HTMLElement): void {
      if (props.disabled) return;
      const rect = target.getBoundingClientRect();
      const left = Math.min(Math.max(rect.left + rect.width / 2, 76), Math.max(76, window.innerWidth - 76));
      const top = props.side === 'top' ? Math.max(8, rect.top - 34) : rect.bottom + 8;
      setTip({ left, top });
    };
    const hide = function (): void {
      setTip(null);
    };
    useDocumentEvent(
      React,
      'keydown',
      function (event: KeyboardEvent) {
        if (event.key === 'Escape') setTip(null);
      },
      Boolean(tip),
    );
    useWindowEvent(React, 'blur', hide, Boolean(tip));
    useWindowEvent(React, 'resize', hide, Boolean(tip));
    const resolved = tip ? (typeof props.label === 'function' ? props.label() : props.label) : '';
    const visible = Boolean(!props.disabled && tip && resolved);
    return h(
      React.Fragment,
      null,
      React.cloneElement(child, {
        title: undefined,
        'aria-describedby': visible ? tipId : child.props['aria-describedby'],
        onMouseEnter: function (event: ReactNamespace.MouseEvent<HTMLElement>) {
          child.props.onMouseEnter?.(event);
          show(event.currentTarget);
        },
        onMouseLeave: function (event: ReactNamespace.MouseEvent<HTMLElement>) {
          child.props.onMouseLeave?.(event);
          hide();
        },
        onFocus: function (event: ReactNamespace.FocusEvent<HTMLElement>) {
          child.props.onFocus?.(event);
          show(event.currentTarget);
        },
        onBlur: function (event: ReactNamespace.FocusEvent<HTMLElement>) {
          child.props.onBlur?.(event);
          hide();
        },
        onClick: function (event: ReactNamespace.MouseEvent<HTMLElement>) {
          hide();
          child.props.onClick?.(event);
        },
      }),
      visible && tip
        ? h(
            'span',
            {
              id: tipId,
              className: 'mdstudio-tooltip',
              role: 'tooltip',
              style: { left: tip.left, top: tip.top, ...(props.maxWidth ? { maxWidth: props.maxWidth } : {}) },
            },
            resolved,
          )
        : null,
    );
  }

  function FallbackToast(props: BridgedToastProps): ReactElement {
    useAutoDismissTimer(React, props.holdMs ?? 2800, props.onDone);
    const tone = props.tone || 'success';
    const isErr = tone === 'error';
    const defaultGlyph: IconName = isErr ? 'alert' : tone === 'info' ? 'info' : 'check';
    return h(
      'div',
      {
        className: isErr ? 'mdstudio-toast is-error' : tone === 'info' ? 'mdstudio-toast is-info' : 'mdstudio-toast',
        role: isErr ? 'alert' : 'status',
      },
      h(
        'span',
        { className: 'mdstudio-toast-icon', 'aria-hidden': 'true' },
        props.icon !== undefined ? props.icon : h(Icon, { name: defaultGlyph, size: 15 }),
      ),
      h('span', { className: 'mdstudio-toast-text' }, props.text),
    );
  }

  function FallbackModal(props: DshModalProps): ReactElement | null {
    const focusedOnOpenRef = React.useRef(false);
    const previousFocusRef = React.useRef<HTMLElement | null>(null);
    const focusTimerRef = React.useRef<number | null>(null);
    const attachDialogRef = React.useCallback(function (el: HTMLDivElement | null): void {
      if (!el) {
        focusedOnOpenRef.current = false;
        if (focusTimerRef.current !== null) {
          window.clearTimeout(focusTimerRef.current);
          focusTimerRef.current = null;
        }
        const prev = previousFocusRef.current;
        previousFocusRef.current = null;
        const active = document.activeElement;
        const focusLost = !active || active === document.body || active === document.documentElement;
        if (focusLost && prev && document.contains(prev)) prev.focus();
        return;
      }
      if (!focusedOnOpenRef.current) {
        focusedOnOpenRef.current = true;
        const active = document.activeElement as HTMLElement | null;
        previousFocusRef.current = active && !el.contains(active) ? active : null;
        focusTimerRef.current = window.setTimeout(function () {
          focusTimerRef.current = null;
          if (!el.isConnected || el.contains(document.activeElement)) return;
          const focusable = getFocusableElements(el);
          const auto = focusable.find(
            (item) => item.hasAttribute('autofocus') || item.hasAttribute('data-mdstudio-autofocus'),
          );
          (auto || focusable[0] || el).focus();
        }, 0);
      }
    }, []);
    useDocumentEvent(
      React,
      'keydown',
      function (event: KeyboardEvent) {
        if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      },
      props.open,
    );
    if (!props.open) return null;
    const modalBase =
      (props.tone === 'warning'
        ? 'mdstudio-modal mdstudio-fallback-modal is-warning'
        : 'mdstudio-modal mdstudio-fallback-modal') + (props.headless ? ' is-headless' : '');
    return h(
      'div',
      { className: 'mdstudio-modal-scrim', onClick: props.onClose },
      h(
        'div',
        {
          ref: attachDialogRef,
          className: joinClass(modalBase, props.className),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': props.title,
          tabIndex: -1,
          onClick: function (event: ReactNamespace.MouseEvent<HTMLDivElement>) {
            event.stopPropagation();
          },
          onKeyDown: trapModalTab,
        },
        props.headless
          ? props.children
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: joinClass('mdstudio-modal-content', props.contentClassName) },
                h(
                  'div',
                  { className: 'mdstudio-modal-head' },
                  h(
                    'h2',
                    { className: 'mdstudio-modal-title' },
                    props.tone === 'warning'
                      ? h(Icon, { name: 'alert', size: 18, className: 'mdstudio-modal-warn-icon' })
                      : null,
                    props.title,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'mdstudio-modal-close mdstudio-search-close',
                      'aria-label': props.closeLabel,
                      onClick: props.onClose,
                    },
                    h(Icon, { name: 'close', size: 14 }),
                  ),
                ),
                props.description ? h('p', { className: 'mdstudio-modal-desc' }, props.description) : null,
                props.children !== undefined ? h('div', { className: 'mdstudio-modal-body' }, props.children) : null,
              ),
              props.footer !== undefined ? h('div', { className: 'mdstudio-modal-footer' }, props.footer) : null,
            ),
      ),
    );
  }

  function isMenuEntrySelected(props: BridgedMenuProps, id: string): boolean {
    if (id === props.selectedId) return true;
    return Boolean(props.selectedIds && props.selectedIds.includes(id));
  }

  function renderFallbackMenuEntry(props: BridgedMenuProps, entry: DshMenuEntry): ReactNode {
    if (isMenuSep(entry)) return h('div', { key: entry.id, className: 'mdstudio-menu-sep', role: 'separator' });
    if (isMenuLabel(entry))
      return h('div', { key: entry.id, className: 'mdstudio-menu-group', role: 'presentation' }, entry.text);
    const item: DshMenuItem = entry;
    const active = isMenuEntrySelected(props, item.id);
    const cls =
      'mdstudio-menu-item mdstudio-drop-item' + (item.danger ? ' is-danger' : '') + (active ? ' is-active' : '');
    return h(
      'button',
      {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled,
        className: cls,
        'aria-keyshortcuts': item.shortcut?.aria,
        'aria-current': active ? 'true' : undefined,
        onClick: function () {
          props.onSelect(item.id);
        },
      },
      item.icon !== undefined
        ? h('span', { className: 'mdstudio-menu-icon-slot', 'aria-hidden': 'true' }, item.icon)
        : null,
      h('span', { className: 'mdstudio-menu-label' }, item.label),
      item.shortcut && item.shortcut.keys.length
        ? h(
            'span',
            { className: 'mdstudio-menu-shortcut', 'aria-hidden': 'true' },
            item.shortcut.keys.map(function (k, idx) {
              return h('kbd', { key: idx, className: k === '+' ? 'is-sep' : undefined }, k);
            }),
          )
        : null,
      active && props.selection !== 'fill'
        ? h('span', { className: 'mdstudio-menu-check', 'aria-hidden': 'true' }, h(Icon, { name: 'check', size: 14 }))
        : null,
    );
  }

  function positionFixedMenu(
    menuEl: HTMLElement,
    anchorEl: HTMLElement | null,
    align?: 'start' | 'end',
    side?: 'top' | 'bottom' | 'right',
  ): void {
    if (!anchorEl || typeof window === 'undefined') return;
    const rect = anchorEl.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const menuWidth = menuEl.offsetWidth || 244;
    const pad = 8;
    const rawLeft = side === 'right' ? rect.right + 4 : align === 'start' ? rect.left : rect.right - menuWidth;
    const left = Math.min(Math.max(rawLeft, pad), Math.max(pad, vw - menuWidth - pad));
    const spaceBelow = vh - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove =
      side === 'top' ? spaceAbove >= 160 || spaceAbove > spaceBelow : spaceBelow < 180 && spaceAbove > spaceBelow;
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.right = 'auto';
    if (side === 'right') {
      menuEl.style.top = Math.round(Math.min(Math.max(rect.top, pad), Math.max(pad, vh - 180))) + 'px';
      menuEl.style.bottom = 'auto';
      menuEl.style.maxHeight = Math.min(640, Math.max(120, Math.round(vh - rect.top - 12))) + 'px';
      return;
    }
    if (openAbove) {
      menuEl.style.top = 'auto';
      menuEl.style.bottom = Math.round(vh - rect.top + 4) + 'px';
      menuEl.style.maxHeight = Math.min(640, Math.max(120, Math.round(spaceAbove - 4))) + 'px';
    } else {
      menuEl.style.top = Math.round(rect.bottom + 4) + 'px';
      menuEl.style.bottom = 'auto';
      menuEl.style.maxHeight = Math.min(640, Math.max(120, Math.round(spaceBelow - 4))) + 'px';
    }
  }

  function FallbackMenuPanel(
    panelProps: BridgedMenuProps & { wrapRef: ReactNamespace.RefObject<HTMLDivElement | null> },
  ): ReactElement {
    const focusedOnOpenRef = React.useRef(false);
    const menuElRef = React.useRef<HTMLDivElement | null>(null);
    const reposition = function (event?: Event): void {
      const el = menuElRef.current;
      if (!el) return;
      if (event && event.type === 'scroll' && event.target === el) return;
      positionFixedMenu(el, panelProps.wrapRef.current || el.parentElement, panelProps.align, panelProps.side);
    };
    useWindowEvent(React, 'resize', reposition, true);
    useWindowEvent(React, 'scroll', reposition, true, true);
    const attachMenuRef = React.useCallback(
      function (el: HTMLDivElement | null): void {
        menuElRef.current = el;
        if (!el) return;
        positionFixedMenu(el, panelProps.wrapRef.current || el.parentElement, panelProps.align, panelProps.side);
        if (panelProps.autoFocus !== false && !focusedOnOpenRef.current) {
          focusedOnOpenRef.current = true;
          const first = el.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
          if (first) first.focus();
        }
      },
      [panelProps.align, panelProps.side, panelProps.autoFocus, panelProps.wrapRef],
    );
    const onMenuKeyDown = function (event: ReactNamespace.KeyboardEvent<HTMLDivElement>): void {
      if (event.key === 'Tab') {
        panelProps.onClose();
        return;
      }
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
      if (!items.length) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        panelProps.onClose();
        const btn = panelProps.wrapRef.current?.querySelector<HTMLElement>('button');
        if (btn)
          window.setTimeout(function () {
            btn.focus();
          }, 0);
        return;
      }
      const next = nextMenuIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.length);
      if (next < 0) return;
      event.preventDefault();
      items[next].focus();
    };
    const alignCls = panelProps.align === 'start' ? 'mdstudio-menu is-align-start' : 'mdstudio-menu';
    const menuCls = joinClass(alignCls, panelProps.listClassName);
    return h(
      'div',
      {
        ref: attachMenuRef,
        className: menuCls,
        role: 'menu',
        'aria-label': panelProps.ariaLabel,
        onKeyDown: onMenuKeyDown,
      },
      panelProps.items.map(function (entry) {
        return renderFallbackMenuEntry(panelProps, entry);
      }),
      panelProps.footer && panelProps.footer.length
        ? h('div', { className: 'mdstudio-menu-sep', role: 'separator' })
        : null,
      panelProps.footer
        ? panelProps.footer.map(function (entry) {
            return renderFallbackMenuEntry(panelProps, entry);
          })
        : null,
    );
  }

  function FallbackMenu(props: BridgedMenuProps): ReactElement {
    const wrapRef = React.useRef<HTMLDivElement | null>(null);
    return h(
      'div',
      { ref: wrapRef, className: joinClass('mdstudio-menu-wrap', props.className) },
      props.anchor,
      props.open
        ? h('div', {
            className: 'mdstudio-menu-scrim',
            'aria-hidden': 'true',
            onClick: props.onClose,
          })
        : null,
      props.open ? h(FallbackMenuPanel, { ...props, wrapRef }) : null,
    );
  }

  function adaptTooltip(Native: ComponentType<DshTooltipProps>): ComponentType<DshTooltipProps> {
    return function DshTooltipWrap(props: DshTooltipProps) {
      return h(Native, {
        side: props.side || 'bottom',
        delayMs: props.delayMs ?? 0,
        disabled: props.disabled,
        maxWidth: props.maxWidth,
        label: props.label,
        children: stripNativeTitle(props.children),
      });
    };
  }

  function adaptInput(Native: ComponentType<DshInputProps>): ComponentType<DshInputProps> {
    return withInputRef(React, function DshInputWrap(props, ref) {
      const { wrapClassName, className, ...rest } = props;
      return h(Native, {
        ...rest,
        ref,
        className: joinClass('mdstudio-dsh-input-wrap', wrapClassName || className),
      });
    });
  }

  function adaptToast(Native: ComponentType<DshToastProps>): ComponentType<BridgedToastProps> {
    return function DshToastWrap(props: BridgedToastProps) {
      const fallbackIcon =
        props.tone === 'error'
          ? h(Icon, { name: 'alert', size: 15 })
          : props.tone === 'info'
            ? h(Icon, { name: 'info', size: 15 })
            : undefined;
      return h(Native, {
        text: props.text,
        tone: props.tone === 'success' ? 'success' : undefined,
        icon: props.icon !== undefined ? props.icon : fallbackIcon,
        anchor: props.anchor,
        holdMs: props.holdMs,
        onDone: props.onDone,
      });
    };
  }

  function adaptModal(Native: ComponentType<DshModalProps>): ComponentType<DshModalProps> {
    return function DshModalWrap(props: DshModalProps) {
      return h(Native, {
        ...props,
        className: joinClass('mdstudio-modal', props.className),
        contentClassName: joinClass('mdstudio-modal-content', props.contentClassName),
      });
    };
  }

  function adaptMenu(Native: ComponentType<DshMenuProps>): ComponentType<BridgedMenuProps> {
    return function DshMenuWrap(props: BridgedMenuProps) {
      const { ariaLabel: _ariaLabel, ...rest } = props;
      return h(Native, { ...rest, className: joinClass('mdstudio-menu-wrap', props.className) });
    };
  }

  const RawInput = mod && isReactComponent<ComponentType<DshInputProps>>(mod.Input) ? mod.Input : null;
  const RawTooltip = mod && isReactComponent<ComponentType<DshTooltipProps>>(mod.Tooltip) ? mod.Tooltip : null;
  const RawToast = mod && isReactComponent<ComponentType<DshToastProps>>(mod.Toast) ? mod.Toast : null;
  const RawModal = mod && isReactComponent<ComponentType<DshModalProps>>(mod.Modal) ? mod.Modal : null;
  const RawMenu = mod && isReactComponent<ComponentType<DshMenuProps>>(mod.Menu) ? mod.Menu : null;

  const Input: ComponentType<DshInputProps> = RawInput ? adaptInput(RawInput) : FallbackInput;

  return {
    hasNativePrimitives: mod !== null,
    Icon,
    Button: pickComponent(mod, 'Button', FallbackButton),
    Switch: pickComponent(mod, 'Switch', FallbackSwitch),
    Checkbox: pickComponent(mod, 'Checkbox', FallbackCheckbox),
    Input,
    Pill: pickComponent(mod, 'Pill', FallbackPill),
    Tag: pickComponent(mod, 'Tag', FallbackTag),
    StateDot: pickComponent(mod, 'StateDot', FallbackStateDot),
    Tooltip: RawTooltip ? adaptTooltip(RawTooltip) : FallbackTooltip,
    Toast: RawToast ? adaptToast(RawToast) : FallbackToast,
    Modal: RawModal ? adaptModal(RawModal) : FallbackModal,
    Menu: RawMenu ? adaptMenu(RawMenu) : FallbackMenu,
  };
}

export type DshBridge = ReturnType<typeof createDshBridge>;
