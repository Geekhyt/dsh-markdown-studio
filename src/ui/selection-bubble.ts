import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';
import type { EditorApi } from '../domain/editor-types';
import { computeSafePopoverPos, type SurfaceRect } from '../domain/surface-geometry';
import { collectSurfaceObstacles } from '../runtime/dom-surfaces';
import { useDocumentEvent, useLatest, useMountDisposable } from '../runtime/react-lifecycle';

interface PointerPoint {
  x: number;
  y: number;
  at: number;
}

export const PORTALED_MENU_SELECTOR = '.mdstudio-menu, .mdstudio-menu-scrim, [role="menu"], [data-menu-material]';
export const EDITOR_OVERLAY_SELECTOR =
  '.mdstudio-ai-inline-card, .mdstudio-skill-split, .mdstudio-slash, .mdstudio-outline, ' + PORTALED_MENU_SELECTOR;
export const BUBBLE_INTERACTIVE_SELECTOR = '.mdstudio-editor-wrap, .mdstudio-skill-split, ' + PORTALED_MENU_SELECTOR;

function matchesTargetSelector(target: EventTarget | null, selector: string): boolean {
  const el = target as Element | null;
  return Boolean(el && typeof el.closest === 'function' && el.closest(selector));
}

function isOverlayEventTarget(target: EventTarget | null): boolean {
  return matchesTargetSelector(target, EDITOR_OVERLAY_SELECTOR);
}

function resolveBubbleViewportPoint(
  api: EditorApi | null,
  range: SelectionRange & { head?: number },
  pointer: PointerPoint | null,
): { x: number; yBottom: number; yTop: number } | null {
  if (pointer) return { x: pointer.x, yBottom: pointer.y, yTop: pointer.y };
  const targetPos = range.head !== undefined ? range.head : range.end;
  const coords = api?.coordsAtPos ? api.coordsAtPos(targetPos) : null;
  if (!coords) return null;
  return { x: coords.left + 24, yBottom: coords.bottom, yTop: coords.top };
}

function isBlockedActiveFocus(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as Element | null;
  if (!active || typeof active.closest !== 'function') return false;
  return Boolean(active.closest('.mdstudio-searchbar, .mdstudio-title-input, [aria-modal="true"]'));
}

function resolveBubbleContainer(rootEl: HTMLElement | null): HTMLElement | null {
  if (!rootEl) return null;
  return (
    rootEl.querySelector<HTMLElement>('.mdstudio-editor-wrap') ||
    rootEl.querySelector<HTMLElement>('.mdstudio-editor-pane')
  );
}

function hasSelectedProse(
  markdown: string,
  range: SelectionRange & { head?: number; programmatic?: boolean },
): boolean {
  if (range.programmatic || range.end <= range.start) return false;
  return Boolean(markdown.slice(range.start, range.end).trim());
}

function isBubbleInteractiveTarget(target: EventTarget | null): boolean {
  return matchesTargetSelector(target, BUBBLE_INTERACTIVE_SELECTOR);
}

function clampBubbleCoords(
  surfaceRect: DOMRect,
  anchor: { x: number; yBottom: number; yTop: number } | null,
  obstacles: readonly SurfaceRect[],
): { top: number; left: number } {
  const preferredLeft = anchor ? anchor.x - surfaceRect.left - 24 : 24;
  const rawBelow = anchor ? anchor.yBottom - surfaceRect.top + 6 : 10;
  const preferredTop = anchor && rawBelow + 38 > surfaceRect.height ? anchor.yTop - surfaceRect.top - 38 : rawBelow;
  const placed = computeSafePopoverPos({
    surface: surfaceRect,
    width: 156,
    height: 34,
    preferredLeft,
    preferredTop,
    pad: 12,
    obstacles,
  });
  return { top: placed.top, left: placed.left };
}

function computeSelectionBubblePos(
  rootEl: HTMLElement | null,
  api: EditorApi | null,
  markdown: string,
  range: SelectionRange & { head?: number; programmatic?: boolean },
  pointer: PointerPoint | null,
): { top: number; left: number } | null {
  if (isBlockedActiveFocus() || !hasSelectedProse(markdown, range)) return null;
  const surface = resolveBubbleContainer(rootEl);
  if (!surface) return null;
  const anchor = resolveBubbleViewportPoint(api, range, pointer);
  return clampBubbleCoords(surface.getBoundingClientRect(), anchor, collectSurfaceObstacles(rootEl));
}

export interface SelectionBubbleOptions {
  React: typeof ReactNamespace;
  rootRef: ReactNamespace.RefObject<HTMLDivElement | null>;
  codeMirrorApiRef: ReactNamespace.MutableRefObject<EditorApi | null>;
  lastSelectionRef: ReactNamespace.MutableRefObject<SelectionRange>;
  editorValue: () => string;
  selection: () => SelectionRange;
}

export interface SelectionBubbleApi {
  pos: { top: number; left: number } | null;
  clear: () => void;
  clearPointer: () => void;
  sync: (markdown: string, nextSelection: SelectionRange & { head?: number; programmatic?: boolean }) => void;
  onPointerDown: (event: ReactNamespace.MouseEvent<HTMLDivElement>) => void;
}

export function useSelectionBubble(options: SelectionBubbleOptions): SelectionBubbleApi {
  const { React, rootRef, codeMirrorApiRef, lastSelectionRef } = options;
  const optionsRef = useLatest(React, options);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const pointerSelectingRef = React.useRef(false);
  const pointerPointRef = React.useRef<PointerPoint | null>(null);
  const pointerCleanupRef = React.useRef<(() => void) | null>(null);
  const rafIdRef = React.useRef<number | null>(null);

  function cancelPendingRaf(): void {
    if (rafIdRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }

  useMountDisposable(React, function () {
    return function () {
      cancelPendingRaf();
      if (pointerCleanupRef.current) pointerCleanupRef.current();
    };
  });

  useDocumentEvent(
    React,
    'mousedown',
    function (event: MouseEvent) {
      if (isBubbleInteractiveTarget(event.target)) return;
      clear();
      clearPointer();
    },
    Boolean(pos),
  );

  function clear(): void {
    cancelPendingRaf();
    setPos(null);
  }

  function clearPointer(): void {
    if (pointerCleanupRef.current) pointerCleanupRef.current();
    else cancelPendingRaf();
    pointerSelectingRef.current = false;
    pointerPointRef.current = null;
  }

  function sync(markdown: string, nextSelection: SelectionRange & { head?: number; programmatic?: boolean }): void {
    if (pointerSelectingRef.current || nextSelection.programmatic) {
      setPos(null);
      return;
    }
    const raw = pointerPointRef.current;
    const pointer = raw && Date.now() - raw.at < 150 ? raw : null;
    if (!pointer) pointerPointRef.current = null;
    setPos(computeSelectionBubblePos(rootRef.current, codeMirrorApiRef.current, markdown, nextSelection, pointer));
  }

  function onPointerDown(event: ReactNamespace.MouseEvent<HTMLDivElement>): void {
    if (event.button !== 0 || isOverlayEventTarget(event.target)) return;
    cancelPendingRaf();
    if (pointerCleanupRef.current) pointerCleanupRef.current();
    pointerSelectingRef.current = true;
    pointerPointRef.current = null;
    setPos(null);
    const detachListeners = function (): void {
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('dragstart', onCancel, true);
      window.removeEventListener('blur', onCancel);
    };
    const onCancel = function (): void {
      detachListeners();
      pointerCleanupRef.current = null;
      pointerSelectingRef.current = false;
      pointerPointRef.current = null;
    };
    const onUp = function (upEvent: MouseEvent): void {
      detachListeners();
      pointerCleanupRef.current = null;
      pointerSelectingRef.current = false;
      pointerPointRef.current =
        upEvent.clientX > 0 || upEvent.clientY > 0 ? { x: upEvent.clientX, y: upEvent.clientY, at: Date.now() } : null;
      rafIdRef.current = window.requestAnimationFrame(function () {
        rafIdRef.current = null;
        const latest = optionsRef.current;
        const curRange = codeMirrorApiRef.current ? codeMirrorApiRef.current.getSelection() : latest.selection();
        lastSelectionRef.current = curRange;
        sync(latest.editorValue(), curRange);
      });
    };
    pointerCleanupRef.current = function () {
      cancelPendingRaf();
      detachListeners();
      pointerCleanupRef.current = null;
    };
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('dragstart', onCancel, true);
    window.addEventListener('blur', onCancel);
  }

  return { pos, clear, clearPointer, sync, onPointerDown };
}
