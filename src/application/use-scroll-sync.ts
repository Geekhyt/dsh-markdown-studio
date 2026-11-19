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
}

export function useScrollSync(options: ScrollSyncOptions): ScrollSyncApi {
  const React = options.React;
  const [enabled, setEnabled] = React.useState(true);
  const enabledRef = useLatest(React, enabled);
  const lockRef = React.useRef(false);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const disposeRef = React.useRef<(() => void) | null>(null);

  useMountDisposable(React, function () {
    return function () {
      if (disposeRef.current) {
        disposeRef.current();
        disposeRef.current = null;
      }
    };
  });

  function scrollMax(element: HTMLElement): number {
    return Math.max(0, element.scrollHeight - element.clientHeight);
  }

  function scrollToRatio(element: HTMLElement, ratio: number): void {
    element.scrollTop = Math.max(0, Math.min(1, ratio)) * scrollMax(element);
  }

  function syncPreviewFromEditor(): void {
    if (!enabledRef.current || lockRef.current) return;
    const preview = previewRef.current;
    if (!preview || preview.clientHeight === 0) return;
    let top = 0;
    let max = 0;
    if (options.codeMirrorApiRef.current) {
      const info = options.codeMirrorApiRef.current.getScrollInfo();
      top = info.top;
      max = info.max;
    } else if (options.textareaRef.current) {
      top = options.textareaRef.current.scrollTop;
      max = scrollMax(options.textareaRef.current);
    }
    if (max <= 0) return;
    lockRef.current = true;
    scrollToRatio(preview, top / max);
    window.requestAnimationFrame(function () {
      lockRef.current = false;
    });
  }

  function syncEditorFromPreview(): void {
    if (!enabledRef.current || lockRef.current) return;
    const preview = previewRef.current;
    if (!preview) return;
    const max = scrollMax(preview);
    if (max <= 0) return;
    const ratio = preview.scrollTop / max;
    lockRef.current = true;
    if (options.codeMirrorApiRef.current) {
      options.codeMirrorApiRef.current.scrollToRatio(ratio);
    } else if (options.textareaRef.current) {
      scrollToRatio(options.textareaRef.current, ratio);
    }
    window.requestAnimationFrame(function () {
      lockRef.current = false;
    });
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
    lockRef.current = true;
    if (options.onCodeMirrorReady) options.onCodeMirrorReady(api);
    disposeRef.current = api.onScroll(syncPreviewFromEditor);
    window.requestAnimationFrame(function () {
      lockRef.current = false;
    });
  }

  return {
    enabled,
    setEnabled,
    previewRef,
    registerCodeMirror,
    syncPreviewFromEditor,
    syncEditorFromPreview,
  };
}
