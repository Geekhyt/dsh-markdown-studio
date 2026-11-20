/**
 * Imperative DOM & Host Surface Bindings.
 *
 * Isolates MutationObservers, layout observers, innerHTML/darkmode preview
 * projection, and imperative CodeMirror 6 widget lifecycle inside `src/runtime/`
 * so UI components remain pure declarative render functions.
 */
import type * as ReactNamespace from 'react';
import { useExternalStore, useLatest } from './react-lifecycle';

function readHostDarkAttr(): boolean {
  return typeof document !== 'undefined' && Boolean(document.body?.hasAttribute('data-ds-dark-theme'));
}

function subscribeHostDarkAttr(onChange: () => void): () => void {
  if (typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') {
    return function () {};
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  return function () {
    observer.disconnect();
  };
}

/**
 * Reactive subscription to DeepSeek Harness host dark theme (`body[data-ds-dark-theme]`).
 */
export function useHostDarkTheme(React: typeof ReactNamespace): boolean {
  return useExternalStore(React, subscribeHostDarkAttr, readHostDarkAttr);
}

/**
 * Binds an imperative DOM observer to a mounted element ref synchronously before paint.
 */
export function useElementBinding<T extends HTMLElement>(
  React: typeof ReactNamespace,
  ref: ReactNamespace.RefObject<T | null>,
  bind: (element: T) => () => void,
): void {
  const bindRef = useLatest(React, bind);
  const useIsoLayoutEffect = React.useLayoutEffect || React.useEffect;
  useIsoLayoutEffect(function () {
    const el = ref.current;
    if (!el) return undefined;
    return bindRef.current(el);
  }, []);
}

export interface PreviewSurfaceSpec {
  html: string;
  bg: string;
  stageBg: string;
  paper: boolean;
  dark: boolean;
  applyDark: (articleEl: HTMLElement) => Promise<boolean>;
}

/**
 * Projects sanitized inline article HTML onto the preview stage and applies
 * asynchronous `mp-darkmode` transformation with cancellation on rapid edits.
 */
export function usePreviewHtmlSurface(
  React: typeof ReactNamespace,
  articleRef: ReactNamespace.RefObject<HTMLDivElement | null>,
  spec: PreviewSurfaceSpec,
): void {
  const applyDarkRef = useLatest(React, spec.applyDark);
  React.useEffect(
    function () {
      const article = articleRef.current;
      const screen = article?.parentElement;
      if (!article || !screen) return undefined;
      const lightStage = spec.paper ? spec.stageBg : spec.bg;
      const darkStage = spec.paper ? '#0e1013' : '#191919';
      const stageColor = spec.dark ? darkStage : lightStage;
      article.innerHTML = spec.html;
      screen.style.backgroundColor = stageColor;
      if (screen.parentElement) screen.parentElement.style.backgroundColor = stageColor;
      if (!spec.dark) return undefined;
      let cancelled = false;
      void applyDarkRef.current(article).then(function (applied) {
        if (!cancelled && applied && !spec.paper) {
          const resolvedBg = article.style.backgroundColor || '#191919';
          screen.style.backgroundColor = resolvedBg;
          if (screen.parentElement) screen.parentElement.style.backgroundColor = resolvedBg;
        }
      });
      return function () {
        cancelled = true;
      };
    },
    [spec.html, spec.bg, spec.stageBg, spec.paper, spec.dark],
  );
}

export interface ImperativeEditorHandle<TBlock, TTransition> {
  getValue(): string;
  setValue(value: string): void;
  setDark(dark: boolean): void;
  setInlineBlocks?(blocks: readonly TBlock[]): void;
  setDiffTransition?(transition: TTransition | null): void;
  destroy(): void;
}

export interface ImperativeEditorMountSpec<
  TApi extends ImperativeEditorHandle<TBlock, TTransition>,
  TBlock,
  TTransition,
> {
  value: string;
  dark: boolean;
  inlineBlocks?: readonly TBlock[];
  diffTransition?: TTransition | null;
  mount: (parent: HTMLDivElement, initialDark: boolean) => TApi;
  onReady?: (api: TApi | null) => void;
  onError?: (error: unknown) => void;
}

/**
 * Lifecycle adapter for an imperative editor instance (CodeMirror 6),
 * handling mount/destroy and prop synchronization (`value`, `dark`, inline widgets).
 */
export function useImperativeEditor<TApi extends ImperativeEditorHandle<TBlock, TTransition>, TBlock, TTransition>(
  React: typeof ReactNamespace,
  hostRef: ReactNamespace.RefObject<HTMLDivElement | null>,
  spec: ImperativeEditorMountSpec<TApi, TBlock, TTransition>,
): void {
  const apiRef = React.useRef<TApi | null>(null);
  const specRef = useLatest(React, spec);

  React.useEffect(function () {
    const parent = hostRef.current;
    if (!parent) return undefined;
    let instance: TApi;
    try {
      instance = specRef.current.mount(parent, specRef.current.dark);
    } catch (error) {
      if (typeof window !== 'undefined' && window.console) {
        window.console.error('[markdown-studio] CodeMirror failed', error);
      }
      specRef.current.onError?.(error);
      return undefined;
    }
    apiRef.current = instance;
    specRef.current.onReady?.(instance);
    return function () {
      instance.destroy();
      apiRef.current = null;
      specRef.current.onReady?.(null);
    };
  }, []);

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api) api.setDark(spec.dark);
    },
    [spec.dark],
  );

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api && api.getValue() !== spec.value) api.setValue(spec.value);
    },
    [spec.value],
  );

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api?.setInlineBlocks) api.setInlineBlocks(spec.inlineBlocks || []);
    },
    [spec.inlineBlocks],
  );

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api?.setDiffTransition) api.setDiffTransition(spec.diffTransition || null);
    },
    [spec.diffTransition],
  );
}
