import type * as ReactNamespace from 'react';
import type { EditorApi } from '../domain/editor-types';
import { useLatest, useMountDisposable } from '../runtime/react-lifecycle';

export interface ScrollSyncOptions {
  React: typeof ReactNamespace;
  codeMirrorApiRef: { current: EditorApi | null };
  textareaRef: { current: HTMLTextAreaElement | null };
  onCodeMirrorReady?: (api: EditorApi | null) => void;
}

export interface ScrollSyncApi {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  previewRef: { current: HTMLDivElement | null };
  registerCodeMirror: (api: EditorApi | null) => void;
  syncPreviewFromEditor: () => void;
  syncEditorFromPreview: () => void;
  restorePreviewScroll: () => void;
  restoreEditorScroll: () => void;
  resetPreviewScroll: () => void;
  capturePreviewRatio: () => void;
  applyCapturedPreviewRatio: () => void;
}

export function useScrollSync(options: ScrollSyncOptions): ScrollSyncApi {
  const React = options.React;
  const [enabled, setEnabled] = React.useState(true);
  const enabledRef = useLatest(React, enabled);
  const lockSourceRef = React.useRef<'editor' | 'preview' | null>(null);
  const unlockTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const disposeRef = React.useRef<(() => void) | null>(null);
  const lastRatioRef = React.useRef(0);
  const pendingEditorSyncRef = React.useRef(false);
  const pendingRelayoutRatioRef = React.useRef<number | null>(null);

  useMountDisposable(React, function () {
    return function () {
      if (unlockTimerRef.current !== null) {
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
      if (disposeRef.current) {
        disposeRef.current();
        disposeRef.current = null;
      }
    };
  });

  function acquireLock(source: 'editor' | 'preview'): void {
    lockSourceRef.current = source;
    if (unlockTimerRef.current !== null) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = setTimeout(function () {
      lockSourceRef.current = null;
      unlockTimerRef.current = null;
    }, 80);
  }

  function scrollMax(element: HTMLElement): number {
    return Math.max(0, element.scrollHeight - element.clientHeight);
  }

  function scrollToRatio(element: HTMLElement, ratio: number): void {
    element.scrollTop = Math.max(0, Math.min(1, ratio)) * scrollMax(element);
  }

  function readEditorRatio(): number | null {
    if (options.codeMirrorApiRef.current) {
      const info = options.codeMirrorApiRef.current.getScrollInfo();
      return info.max > 0 ? info.top / info.max : null;
    }
    if (options.textareaRef.current) {
      const max = scrollMax(options.textareaRef.current);
      return max > 0 ? options.textareaRef.current.scrollTop / max : null;
    }
    return null;
  }

  function applyRatioToEditor(ratio: number): boolean {
    const cm = options.codeMirrorApiRef.current;
    if (cm) {
      if (cm.getScrollInfo().max <= 0) return false;
      cm.scrollToRatio(ratio);
      return true;
    }
    const ta = options.textareaRef.current;
    if (ta && scrollMax(ta) > 0) {
      scrollToRatio(ta, ratio);
      return true;
    }
    return false;
  }

  function syncPreviewFromEditor(): void {
    const ratio = readEditorRatio();
    if (ratio !== null && !pendingEditorSyncRef.current) lastRatioRef.current = ratio;
    if (!enabledRef.current || lockSourceRef.current === 'preview' || ratio === null) return;
    const preview = previewRef.current;
    if (!preview || preview.clientHeight === 0) return;
    acquireLock('editor');
    scrollToRatio(preview, ratio);
  }

  function syncEditorFromPreview(): void {
    const preview = previewRef.current;
    if (!preview) return;
    const max = scrollMax(preview);
    if (max <= 0) return;
    const ratio = preview.scrollTop / max;
    lastRatioRef.current = ratio;
    if (!enabledRef.current || lockSourceRef.current === 'editor') return;
    acquireLock('preview');
    pendingEditorSyncRef.current = !applyRatioToEditor(ratio);
  }

  function restorePreviewScroll(): void {
    if (!enabledRef.current) return;
    const preview = previewRef.current;
    if (!preview) return;
    const ratio = pendingEditorSyncRef.current ? lastRatioRef.current : (readEditorRatio() ?? lastRatioRef.current);
    if (ratio <= 0) return;
    acquireLock('editor');
    scrollToRatio(preview, ratio);
  }

  function restoreEditorScroll(): void {
    if (!enabledRef.current || !pendingEditorSyncRef.current) return;
    const ratio = lastRatioRef.current;
    const apply = (): void => {
      if (!pendingEditorSyncRef.current) return;
      acquireLock('preview');
      if (!applyRatioToEditor(ratio)) return;
      pendingEditorSyncRef.current = false;
    };
    apply();
    if (pendingEditorSyncRef.current && typeof window !== 'undefined') {
      window.requestAnimationFrame(apply);
    }
  }

  function resetPreviewScroll(): void {
    lastRatioRef.current = 0;
    pendingEditorSyncRef.current = false;
    pendingRelayoutRatioRef.current = null;
    const preview = previewRef.current;
    if (preview) preview.scrollTop = 0;
  }

  function capturePreviewRatio(): void {
    const preview = previewRef.current;
    if (!preview) return;
    const max = scrollMax(preview);
    pendingRelayoutRatioRef.current = max > 0 ? preview.scrollTop / max : 0;
    acquireLock('editor');
  }

  function applyCapturedPreviewRatio(): void {
    const ratio = pendingRelayoutRatioRef.current;
    pendingRelayoutRatioRef.current = null;
    if (ratio === null) return;
    const preview = previewRef.current;
    if (!preview) return;
    const appliedMax = scrollMax(preview);
    acquireLock('editor');
    scrollToRatio(preview, ratio);
    lastRatioRef.current = ratio;
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(function () {
        const current = previewRef.current;
        if (!current || scrollMax(current) === appliedMax) return;
        acquireLock('editor');
        scrollToRatio(current, ratio);
      });
    }
  }

  function registerCodeMirror(api: EditorApi | null): void {
    if (disposeRef.current) {
      disposeRef.current();
      disposeRef.current = null;
    }
    options.codeMirrorApiRef.current = api;
    if (!api) {
      if (options.onCodeMirrorReady) options.onCodeMirrorReady(null);
      return;
    }
    acquireLock('preview');
    if (options.onCodeMirrorReady) options.onCodeMirrorReady(api);
    disposeRef.current = api.onScroll(syncPreviewFromEditor);
  }

  return {
    enabled,
    setEnabled,
    previewRef,
    registerCodeMirror,
    syncPreviewFromEditor,
    syncEditorFromPreview,
    restorePreviewScroll,
    restoreEditorScroll,
    resetPreviewScroll,
    capturePreviewRatio,
    applyCapturedPreviewRatio,
  };
}
