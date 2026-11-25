import type * as ReactNamespace from 'react';
import {
  canHandleImmersiveShortcutPolicy,
  isFullscreenDrawer,
  resolveStudioEscape,
  type SurfaceImmersiveMode,
  type UnifiedEscapeAction,
} from '../domain/studio-overlay.machine';
import { hasVisibleElement, isElementVisible, isEventInside } from '../runtime/dom-surfaces';
import { useDocumentEvent, useWindowEvent } from '../runtime/react-lifecycle';

export type GlobalShortcutAction = 'save' | 'saveAs' | 'copy' | 'find' | null;

const EXTERNAL_DIALOG_SELECTOR = '[aria-modal="true"]:not(.mdstudio-drawer), [role="dialog"]:not(.mdstudio-drawer)';
const PORTALED_MENU_SELECTOR = '[role="menu"], [data-menu-material]';
const PLUGIN_PORTALED_MENU_SELECTOR =
  '.mdstudio-menu, .mdstudio-header-menu, .mdstudio-format-menu, .mdstudio-skill-menu-list';
const MARKDOWN_EDITOR_WRAP_SELECTOR = '.mdstudio-editor-pane:not(.mdstudio-css-workbench) .mdstudio-editor-wrap';
const MARKDOWN_EDITOR_SURFACE_SELECTOR =
  '.mdstudio-editor-pane:not(.mdstudio-css-workbench) .mdstudio-codemirror, textarea.mdstudio-editor';

export interface StudioKeyboardState {
  hasModal: boolean;
  menuOpen: boolean;
  drawerOpen: boolean;
  showMarkdownEditor: boolean;
  slashOpen: boolean;
  outlineOpen: boolean;
  searchOpen: boolean;
  hasAiSession: boolean;
  bubbleVisible?: boolean;
  immersive: SurfaceImmersiveMode;
  containerWidth: number;
}

export interface StudioKeyboardActions {
  onToggleImmersive: () => void;
  onExitImmersive: () => void;
  onSave: (forceDialog: boolean) => void;
  onCopy: () => void;
  onOpenFind: () => void;
  onCloseMenu: () => void;
  onCloseDrawer: () => void;
  onCloseSlash: () => void;
  onCloseOutline: () => void;
  onCloseSearch: () => void;
  onCancelAi: () => void;
  onClearBubble?: () => void;
}

export interface UseStudioKeyboardOptions {
  React: typeof ReactNamespace;
  rootRef: ReactNamespace.RefObject<HTMLElement | null>;
  state: StudioKeyboardState;
  actions: StudioKeyboardActions;
}

export function isEventInPluginScope(event: Event, root: HTMLElement | null): boolean {
  if (!root) return false;
  const target = event.target;
  if (
    !target ||
    target === document ||
    target === window ||
    target === document.body ||
    target === document.documentElement
  ) {
    return true;
  }
  if (typeof (target as Node).nodeType !== 'number') return false;
  if (root.contains(target as Node)) return true;
  const el = target as Element;
  return typeof el.closest === 'function' && Boolean(el.closest(PLUGIN_PORTALED_MENU_SELECTOR));
}

export function resolveGlobalShortcutAction(
  event: KeyboardEvent,
  flags: {
    hasModal: boolean;
    inEditor: boolean;
    inCssWorkbench: boolean;
    showMarkdownEditor: boolean;
    fullscreenDrawer: boolean;
  },
): GlobalShortcutAction {
  if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || flags.hasModal || flags.fullscreenDrawer || flags.inEditor) {
    return null;
  }
  const key = String(event.key || '').toLowerCase();
  if (key === 's' && !flags.inCssWorkbench) return event.shiftKey ? 'saveAs' : 'save';
  if (key === 'enter' && !event.shiftKey) return 'copy';
  if (key === 'f' && !event.shiftKey && flags.showMarkdownEditor) return 'find';
  return null;
}

function isImeOrHandled(event: KeyboardEvent): boolean {
  return Boolean(event.isComposing || event.keyCode === 229 || event.defaultPrevented);
}

function isImmersiveToggleKey(event: KeyboardEvent): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return mod && event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'f';
}

function tryHandleImmersiveToggle(
  event: KeyboardEvent,
  state: StudioKeyboardState,
  actions: StudioKeyboardActions,
): boolean {
  if (!isImmersiveToggleKey(event)) return false;
  if (state.hasModal || hasVisibleElement(EXTERNAL_DIALOG_SELECTOR)) return false;
  if (!canHandleImmersiveShortcutPolicy(state, 'toggle')) return false;
  event.preventDefault();
  event.stopPropagation();
  actions.onToggleImmersive();
  return true;
}

function isFocusInside(selector: string): boolean {
  const active = typeof document !== 'undefined' ? (document.activeElement as Element | null) : null;
  return Boolean(active && typeof active.closest === 'function' && active.closest(selector));
}

function runEscapeAction(
  action: UnifiedEscapeAction,
  event: KeyboardEvent,
  root: HTMLElement | null,
  actions: StudioKeyboardActions,
): void {
  if (action === 'none') return;
  event.preventDefault();
  event.stopPropagation();
  if (action === 'exit-immersive') {
    actions.onExitImmersive();
    return;
  }
  if (action === 'close-menu') {
    const focusInMenu = isFocusInside(PLUGIN_PORTALED_MENU_SELECTOR);
    actions.onCloseMenu();
    if (focusInMenu) root?.querySelector<HTMLElement>('[data-mdstudio-menu-trigger="more"]')?.focus();
  } else if (action === 'close-drawer') actions.onCloseDrawer();
  else if (action === 'close-slash') actions.onCloseSlash();
  else if (action === 'close-search') actions.onCloseSearch();
  else if (action === 'cancel-ai') actions.onCancelAi();
  else if (action === 'clear-bubble') {
    const focusInBubble = isFocusInside('.mdstudio-skill-split');
    actions.onClearBubble?.();
    if (focusInBubble) {
      root
        ?.querySelector<HTMLElement>(
          '.mdstudio-editor-pane:not(.mdstudio-css-workbench) .cm-content, textarea.mdstudio-editor',
        )
        ?.focus();
    }
  } else if (action === 'close-outline') {
    const focusInOutline = isFocusInside('.mdstudio-outline');
    actions.onCloseOutline();
    if (focusInOutline) root?.querySelector<HTMLElement>('.mdstudio-outline-anchor button')?.focus();
  }
}

function runGlobalAction(action: GlobalShortcutAction, event: KeyboardEvent, actions: StudioKeyboardActions): void {
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === 'save') actions.onSave(false);
  else if (action === 'saveAs') actions.onSave(true);
  else if (action === 'copy') actions.onCopy();
  else if (action === 'find') actions.onOpenFind();
}

/**
 * Single authoritative Studio keyboard router replacing scattered document/window
 * keydown listeners across StudioPage, EditorPane, and ImmersiveDock.
 */
export function useStudioKeyboard(options: UseStudioKeyboardOptions): void {
  const handleKeyDown = (event: KeyboardEvent, fromWindow: boolean): void => {
    if (fromWindow && event.target !== window) return;
    const root = options.rootRef.current;
    if (isImeOrHandled(event) || !root || !isElementVisible(root)) return;
    if (!isEventInPluginScope(event, root)) return;
    const { state, actions } = options;
    if (tryHandleImmersiveToggle(event, state, actions)) return;
    const liveWidth = root.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : state.containerWidth);
    const fullscreenDrawer = isFullscreenDrawer(state.drawerOpen, liveWidth);
    if (event.key === 'Escape') {
      const hasModal = state.hasModal || hasVisibleElement(EXTERNAL_DIALOG_SELECTOR);
      const action = resolveStudioEscape({
        hasModal,
        hasDomMenu: hasVisibleElement(PORTALED_MENU_SELECTOR),
        menuOpen: state.menuOpen,
        drawerOpen: state.drawerOpen,
        fullscreenDrawer,
        inDrawer: isEventInside(event, '.mdstudio-drawer'),
        inEditor: isEventInside(event, MARKDOWN_EDITOR_WRAP_SELECTOR),
        showMarkdownEditor: state.showMarkdownEditor,
        slashOpen: state.slashOpen,
        outlineOpen: state.outlineOpen,
        searchOpen: state.searchOpen,
        hasAiSession: state.hasAiSession,
        bubbleVisible: Boolean(state.bubbleVisible),
        immersive: state.immersive,
      });
      runEscapeAction(action, event, root, actions);
      return;
    }
    if (fromWindow) return;
    const hasBlockingOverlay =
      state.hasModal || hasVisibleElement(EXTERNAL_DIALOG_SELECTOR + ', ' + PORTALED_MENU_SELECTOR);
    const shortcut = resolveGlobalShortcutAction(event, {
      hasModal: hasBlockingOverlay,
      inEditor: isEventInside(event, MARKDOWN_EDITOR_SURFACE_SELECTOR),
      inCssWorkbench: isEventInside(event, '.mdstudio-css-workbench'),
      showMarkdownEditor: state.showMarkdownEditor,
      fullscreenDrawer,
    });
    runGlobalAction(shortcut, event, actions);
  };

  useDocumentEvent(options.React, 'keydown', (event) => handleKeyDown(event, false), true);
  useWindowEvent(options.React, 'keydown', (event) => handleKeyDown(event, true), true);
}
