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

export interface MeasuredRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const SURFACE_OBSTACLE_SELECTORS = ['.mdstudio-drawer', '.mdstudio-immersive-dock'] as const;

/**
 * Collects viewport bounding rects of active floating/overlay chrome inside
 * `.mdstudio-root` that sits above editor-scoped popovers.
 */
export function collectSurfaceObstacles(rootEl: HTMLElement | null): MeasuredRect[] {
  if (!rootEl) return [];
  const out: MeasuredRect[] = [];
  for (const selector of SURFACE_OBSTACLE_SELECTORS) {
    const el = rootEl.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      out.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    }
  }
  return out;
}

export function isEventInside(event: Event, selector: string): boolean {
  const el = event.target as Element | null;
  return Boolean(el && typeof el.closest === 'function' && el.closest(selector));
}

export function hasVisibleElement(selector: string): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).some(isElementVisible);
}

/**
 * Checks whether an element is connected, enabled, and not hidden by ancestor
 * `display: none` or `visibility: hidden` (works identically in browsers & JSDOM).
 */
export function isElementVisible(el: HTMLElement | null): el is HTMLElement {
  if (
    !el ||
    el === document.body ||
    el === document.documentElement ||
    !el.isConnected ||
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-hidden') === 'true'
  ) {
    return false;
  }
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.documentElement) {
    const style = window.getComputedStyle(cur);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    cur = cur.parentElement;
  }
  return true;
}

/**
 * Resolves a safe visible focus restoration target, avoiding detached menu items
 * or hidden chrome (e.g. HeaderBar buttons while Immersive mode is active).
 */
export function resolveSafeFocusTarget(
  preferred: HTMLElement | null,
  root: HTMLElement | null,
  fallbackSelectors: readonly string[],
): HTMLElement | null {
  if (isElementVisible(preferred) && preferred.getAttribute('role') !== 'menuitem') {
    return preferred;
  }
  if (!root) return null;
  for (const selector of fallbackSelectors) {
    const candidate = root.querySelector<HTMLElement>(selector);
    if (isElementVisible(candidate)) return candidate;
  }
  return null;
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
  surfaceBg: string;
  darkFallbackBg: string;
  paper: boolean;
  dark: boolean;
  previewMode?: 'mobile' | 'desktop';
  relayoutKey?: string;
  empty?: boolean;
  stageRef?: ReactNamespace.RefObject<HTMLDivElement | null>;
  applyDark: (
    articleEl: HTMLElement,
    isCancelled?: () => boolean,
    dirtyBlocks?: readonly HTMLElement[],
  ) => Promise<boolean>;
  cleanupDark?: () => void;
  onMountSurface?: () => void;
  onPreviewRelayout?: () => void;
}

function paintStageBackground(screen: HTMLElement, color: string, fallback: string, isDesktop: boolean): void {
  const bg = color || fallback;
  screen.style.backgroundColor = bg;
  const device = screen.parentElement;
  if (!device) return;
  device.style.backgroundColor = bg;
  const stage = device.parentElement;
  if (stage) stage.style.backgroundColor = isDesktop ? bg : '';
}

const TRANSPARENT_BG = new Set(['', 'rgba(0, 0, 0, 0)', 'transparent']);

function readElementBg(element: HTMLElement): string {
  return typeof window !== 'undefined'
    ? window.getComputedStyle(element).backgroundColor
    : element.style.backgroundColor;
}

function resolveDarkStageBg(article: HTMLElement, fallback: string): string {
  const root = article.querySelector<HTMLElement>('#mdstudio') || article;
  const resolved = readElementBg(root);
  return TRANSPARENT_BG.has(resolved) ? fallback : resolved;
}

function resetArticleSurface(article: HTMLElement): void {
  article.className = 'mdstudio-preview-article';
  article.style.removeProperty('background-color');
  article.style.removeProperty('color');
  for (const attr of Array.from(article.attributes)) {
    if (attr.name.startsWith('data-') && !attr.name.startsWith('data-mdstudio-')) article.removeAttribute(attr.name);
  }
}

/**
 * Projects sanitized inline article HTML onto the preview stage and applies
 * asynchronous `mp-darkmode` transformation with cancellation on rapid edits.
 */
interface MountedSurfaceState {
  node: HTMLDivElement | null;
  html: string;
  dark: boolean;
  darkApplied: boolean;
  rootSignature: string;
  blockHtmls: string[];
  incrementalDarkEdits: number;
}

const MAX_INCREMENTAL_DARK_EDITS = 32;

const EMPTY_MOUNTED_SURFACE: MountedSurfaceState = {
  node: null,
  html: '',
  dark: false,
  darkApplied: false,
  rootSignature: '',
  blockHtmls: [],
  incrementalDarkEdits: 0,
};

function rootElementSignature(el: Element): string {
  const parts: string[] = [el.tagName];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    parts.push(attr.name + '=' + attr.value);
  }
  return parts.join('\0');
}

function parseArticleRoot(doc: Document, html: string): HTMLElement | null {
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  return holder.firstElementChild as HTMLElement | null;
}

function childBlockHtmls(root: Element): string[] {
  const out: string[] = [];
  for (let child = root.firstElementChild; child; child = child.nextElementSibling) {
    out.push(child.outerHTML);
  }
  return out;
}

function findBlockDiffSpan(prev: readonly string[], next: readonly string[]): { head: number; tail: number } {
  const minLen = Math.min(prev.length, next.length);
  let head = 0;
  while (head < minLen && prev[head] === next[head]) head++;
  let tail = 0;
  while (head + tail < minLen && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  return { head, tail };
}

function canMorphPreviousState(article: HTMLDivElement, spec: PreviewSurfaceSpec, prev: MountedSurfaceState): boolean {
  if (prev.node !== article || prev.dark !== spec.dark || !prev.rootSignature) return false;
  if (!spec.dark) return true;
  return prev.darkApplied && prev.incrementalDarkEdits < MAX_INCREMENTAL_DARK_EDITS;
}

function getMorphableRoot(article: HTMLDivElement, expectedChildCount: number): HTMLElement | null {
  const existingRoot = article.firstElementChild as HTMLElement | null;
  if (!existingRoot || existingRoot.id !== 'mdstudio') return null;
  return existingRoot.children.length === expectedChildCount ? existingRoot : null;
}

function spliceMountedBlocks(
  existingRoot: HTMLElement,
  nextRoot: HTMLElement,
  head: number,
  removeEnd: number,
  insertEnd: number,
): HTMLElement[] {
  for (let i = removeEnd - 1; i >= head; i--) {
    existingRoot.children[i]?.remove();
  }
  const anchor = existingRoot.children[head] || null;
  const dirtyBlocks = (Array.from(nextRoot.children) as HTMLElement[]).slice(head, insertEnd);
  for (let i = 0; i < dirtyBlocks.length; i++) {
    existingRoot.insertBefore(dirtyBlocks[i], anchor);
  }
  return dirtyBlocks;
}

function tryMorphMountedArticle(
  article: HTMLDivElement,
  spec: PreviewSurfaceSpec,
  prev: MountedSurfaceState,
): { state: MountedSurfaceState; dirtyBlocks: HTMLElement[] } | null {
  if (!canMorphPreviousState(article, spec, prev)) return null;
  const existingRoot = getMorphableRoot(article, prev.blockHtmls.length);
  if (!existingRoot) return null;
  const nextRoot = parseArticleRoot(article.ownerDocument, spec.html);
  if (!nextRoot || nextRoot.id !== 'mdstudio') return null;
  const nextSig = rootElementSignature(nextRoot);
  if (nextSig !== prev.rootSignature) return null;
  const nextHtmls = childBlockHtmls(nextRoot);
  const { head, tail } = findBlockDiffSpan(prev.blockHtmls, nextHtmls);
  if (head === 0 && tail === 0 && prev.blockHtmls.length > 0) return null;
  const dirtyBlocks = spliceMountedBlocks(
    existingRoot,
    nextRoot,
    head,
    prev.blockHtmls.length - tail,
    nextHtmls.length - tail,
  );
  const hasDirty = dirtyBlocks.length > 0;
  return {
    dirtyBlocks,
    state: {
      node: article,
      html: spec.html,
      dark: spec.dark,
      darkApplied: prev.darkApplied && !hasDirty,
      rootSignature: nextSig,
      blockHtmls: nextHtmls,
      incrementalDarkEdits: spec.dark && hasDirty ? prev.incrementalDarkEdits + 1 : prev.incrementalDarkEdits,
    },
  };
}

function syncMountedArticle(
  article: HTMLDivElement,
  spec: PreviewSurfaceSpec,
  lastMountedRef: ReactNamespace.MutableRefObject<MountedSurfaceState>,
): { changed: boolean; dirtyBlocks?: HTMLElement[] } {
  const prev = lastMountedRef.current;
  if (prev.node === article && prev.html === spec.html && prev.dark === spec.dark) return { changed: false };
  const morphed = tryMorphMountedArticle(article, spec, prev);
  if (morphed) {
    lastMountedRef.current = morphed.state;
    return { changed: true, dirtyBlocks: morphed.dirtyBlocks };
  }
  resetArticleSurface(article);
  article.innerHTML = spec.html;
  const mountedRoot = article.firstElementChild;
  lastMountedRef.current = {
    node: article,
    html: spec.html,
    dark: spec.dark,
    darkApplied: false,
    rootSignature: mountedRoot && mountedRoot.id === 'mdstudio' ? rootElementSignature(mountedRoot) : '',
    blockHtmls: mountedRoot && mountedRoot.id === 'mdstudio' ? childBlockHtmls(mountedRoot) : [],
    incrementalDarkEdits: 0,
  };
  return { changed: true };
}

function usePreviewRelayoutSync(
  React: typeof ReactNamespace,
  previewMode: 'mobile' | 'desktop' | undefined,
  onRelayout?: () => void,
): void {
  const onRelayoutRef = useLatest(React, onRelayout);
  const lastModeRef = React.useRef<'mobile' | 'desktop' | undefined>(previewMode);
  const useIsoLayoutEffect = React.useLayoutEffect || React.useEffect;
  useIsoLayoutEffect(
    function () {
      if (lastModeRef.current === previewMode) return;
      lastModeRef.current = previewMode;
      onRelayoutRef.current?.();
    },
    [previewMode],
  );
}

export function usePreviewHtmlSurface(
  React: typeof ReactNamespace,
  articleRef: ReactNamespace.RefObject<HTMLDivElement | null>,
  spec: PreviewSurfaceSpec,
): void {
  const applyDarkRef = useLatest(React, spec.applyDark);
  const cleanupDarkRef = useLatest(React, spec.cleanupDark);
  const onMountSurfaceRef = useLatest(React, spec.onMountSurface);
  const onRelayoutRef = useLatest(React, spec.onPreviewRelayout);
  const lastMountedRef = React.useRef<MountedSurfaceState>({ ...EMPTY_MOUNTED_SURFACE });
  usePreviewRelayoutSync(React, spec.previewMode, spec.onPreviewRelayout);
  React.useEffect(
    function () {
      const article = articleRef.current;
      const screen = article?.parentElement;
      const isDesktop = spec.previewMode === 'desktop';
      if (!article || !screen) {
        const stage = spec.stageRef?.current;
        if (stage) stage.style.backgroundColor = isDesktop ? spec.surfaceBg || spec.darkFallbackBg : '';
        lastMountedRef.current = { ...EMPTY_MOUNTED_SURFACE };
        cleanupDarkRef.current?.();
        return undefined;
      }
      const freshNode = lastMountedRef.current.node !== article;
      const syncResult = syncMountedArticle(article, spec, lastMountedRef);
      const contentChanged = syncResult.changed;
      if (freshNode) onMountSurfaceRef.current?.();
      if (contentChanged || spec.relayoutKey !== undefined) onRelayoutRef.current?.();
      if (!spec.dark) {
        paintStageBackground(screen, spec.surfaceBg, spec.darkFallbackBg, isDesktop);
        cleanupDarkRef.current?.();
        return undefined;
      }
      if (lastMountedRef.current.darkApplied) {
        paintStageBackground(
          screen,
          spec.paper ? spec.surfaceBg : resolveDarkStageBg(article, spec.darkFallbackBg),
          spec.darkFallbackBg,
          isDesktop,
        );
        return undefined;
      }
      if (!syncResult.dirtyBlocks) {
        paintStageBackground(screen, spec.surfaceBg, spec.darkFallbackBg, isDesktop);
      }
      let cancelled = false;
      void applyDarkRef
        .current(article, () => cancelled, syncResult.dirtyBlocks)
        .then(function (applied) {
          if (cancelled || !applied) return;
          lastMountedRef.current = { ...lastMountedRef.current, darkApplied: true };
          if (!spec.paper) {
            paintStageBackground(
              screen,
              resolveDarkStageBg(article, spec.darkFallbackBg),
              spec.darkFallbackBg,
              isDesktop,
            );
          }
        })
        .catch(function () {});
      return function () {
        cancelled = true;
      };
    },
    [
      spec.html,
      spec.surfaceBg,
      spec.darkFallbackBg,
      spec.paper,
      spec.dark,
      spec.previewMode,
      spec.relayoutKey,
      spec.empty,
    ],
  );
  React.useEffect(function () {
    return function () {
      lastMountedRef.current = { ...EMPTY_MOUNTED_SURFACE };
      cleanupDarkRef.current?.();
    };
  }, []);
}

export interface ImperativeEditorHandle<TBlock, TTransition> {
  getValue(): string;
  setValue(value: string, silent?: boolean, selection?: { anchor: number; head?: number }): void;
  setDark(dark: boolean): void;
  setPlaceholder?(placeholder: string, ariaLabel?: string): void;
  setSlashAria?(open: boolean, activeDescendantId: string | null): void;
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
  placeholder?: string;
  ariaLabel?: string;
  slashAria?: { open: boolean; activeId: string | null };
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

  const syncedRef = React.useRef({ dark: false, placeholder: '', ariaLabel: '' as string | undefined, mounted: false });

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
    syncedRef.current = {
      dark: specRef.current.dark,
      placeholder: specRef.current.placeholder || '',
      ariaLabel: specRef.current.ariaLabel,
      mounted: true,
    };
    specRef.current.onReady?.(instance);
    return function () {
      instance.destroy();
      apiRef.current = null;
      syncedRef.current.mounted = false;
      specRef.current.onReady?.(null);
    };
  }, []);

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (!api || (syncedRef.current.mounted && syncedRef.current.dark === spec.dark)) return;
      syncedRef.current.dark = spec.dark;
      api.setDark(spec.dark);
    },
    [spec.dark],
  );

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api && api.getValue() !== spec.value) api.setValue(spec.value, true);
    },
    [spec.value],
  );

  React.useEffect(
    function () {
      const api = apiRef.current;
      const nextPh = spec.placeholder || '';
      if (
        !api?.setPlaceholder ||
        (syncedRef.current.mounted &&
          syncedRef.current.placeholder === nextPh &&
          syncedRef.current.ariaLabel === spec.ariaLabel)
      ) {
        return;
      }
      syncedRef.current.placeholder = nextPh;
      syncedRef.current.ariaLabel = spec.ariaLabel;
      api.setPlaceholder(nextPh, spec.ariaLabel);
    },
    [spec.placeholder, spec.ariaLabel],
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

  React.useEffect(
    function () {
      const api = apiRef.current;
      if (api?.setSlashAria) api.setSlashAria(Boolean(spec.slashAria?.open), spec.slashAria?.activeId || null);
    },
    [spec.slashAria?.open, spec.slashAria?.activeId],
  );
}
