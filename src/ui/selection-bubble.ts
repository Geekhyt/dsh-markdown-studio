import type * as ReactNamespace from 'react';
import type { SelectionRange } from '../domain/article';
import type { EditorApi } from '../domain/editor-types';
import { clamp } from '../domain/settings';
import { useMountDisposable } from '../runtime/react-lifecycle';

interface PointerPoint {
  x: number;
  y: number;
  at: number;
}

function isInlineCardEventTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return Boolean(el && typeof el.closest === 'function' && el.closest('.mdstudio-ai-inline-card'));
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

function computeSelectionBubblePos(
  rootEl: HTMLElement | null,
  api: EditorApi | null,
  markdown: string,
  range: SelectionRange & { head?: number },
  pointer: PointerPoint | null,
): { top: number; left: number } | null {
  if (range.end <= range.start || !markdown.slice(range.start, range.end).trim()) return null;
  const pane = rootEl ? rootEl.querySelector<HTMLElement>('.mdstudio-editor-pane') : null;
  if (!pane) return null;
  const paneRect = pane.getBoundingClientRect();
  const anchor = resolveBubbleViewportPoint(api, range, pointer);
  if (!anchor) {
    return { top: 52, left: clamp(24, 12, Math.max(12, paneRect.width - 144)) };
  }
  const rawBelow = anchor.yBottom - paneRect.top + 6;
  const rawTop = rawBelow + 38 <= paneRect.height ? rawBelow : anchor.yTop - paneRect.top - 38;
  const top = clamp(Math.round(rawTop), 44, Math.max(44, paneRect.height - 40));
  const left = clamp(Math.round(anchor.x - paneRect.left - 24), 12, Math.max(12, paneRect.width - 144));
  return { top, left };
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
  sync: (markdown: string, nextSelection: SelectionRange & { head?: number }) => void;
  onPointerDown: (event: ReactNamespace.MouseEvent<HTMLDivElement>) => void;
}

export function useSelectionBubble(options: SelectionBubbleOptions): SelectionBubbleApi {
  const { React, rootRef, codeMirrorApiRef, lastSelectionRef } = options;
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const pointerSelectingRef = React.useRef(false);
  const pointerPointRef = React.useRef<PointerPoint | null>(null);
  const pointerCleanupRef = React.useRef<(() => void) | null>(null);

  useMountDisposable(React, function () {
    return function () {
      if (pointerCleanupRef.current) pointerCleanupRef.current();
    };
  });

  function clear(): void {
    setPos(null);
  }

  function clearPointer(): void {
    pointerSelectingRef.current = false;
    pointerPointRef.current = null;
  }

  function sync(markdown: string, nextSelection: SelectionRange & { head?: number }): void {
    if (pointerSelectingRef.current) {
      setPos(null);
      return;
    }
    const raw = pointerPointRef.current;
    const pointer = raw && Date.now() - raw.at < 150 ? raw : null;
    if (!pointer) pointerPointRef.current = null;
    setPos(computeSelectionBubblePos(rootRef.current, codeMirrorApiRef.current, markdown, nextSelection, pointer));
  }

  function onPointerDown(event: ReactNamespace.MouseEvent<HTMLDivElement>): void {
    if (event.button !== 0 || isInlineCardEventTarget(event.target)) return;
    if (pointerCleanupRef.current) pointerCleanupRef.current();
    pointerSelectingRef.current = true;
    pointerPointRef.current = null;
    setPos(null);
    const onUp = function (upEvent: MouseEvent): void {
      window.removeEventListener('mouseup', onUp, true);
      pointerCleanupRef.current = null;
      pointerSelectingRef.current = false;
      pointerPointRef.current =
        upEvent.clientX > 0 || upEvent.clientY > 0 ? { x: upEvent.clientX, y: upEvent.clientY, at: Date.now() } : null;
      window.requestAnimationFrame(function () {
        const curRange = codeMirrorApiRef.current ? codeMirrorApiRef.current.getSelection() : options.selection();
        lastSelectionRef.current = curRange;
        sync(options.editorValue(), curRange);
      });
    };
    pointerCleanupRef.current = function () {
      window.removeEventListener('mouseup', onUp, true);
      pointerCleanupRef.current = null;
    };
    window.addEventListener('mouseup', onUp, true);
  }

  return { pos, clear, clearPointer, sync, onPointerDown };
}
