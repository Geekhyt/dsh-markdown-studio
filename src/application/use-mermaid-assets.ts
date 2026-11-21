import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import { prepareImageForWechat } from '../adapters/image-encode';
import type { MermaidCacheEntry } from '../domain/mermaid';
import { renderMarkdown } from '../markdown-parser';
import { useDebouncedKeyTask, useLatest } from '../runtime/react-lifecycle';
import { type MermaidTheme, mermaidCacheKey } from '../themes';

interface MermaidModule {
  render(code: unknown, id?: string): Promise<string>;
}

let sharedMermaidLoadPromise: Promise<MermaidModule | null> | null = null;

function loadMermaidModule(): Promise<MermaidModule | null> {
  if (typeof window !== 'undefined' && window.__MDSTUDIO_MERMAID__) {
    return Promise.resolve(window.__MDSTUDIO_MERMAID__);
  }
  if (sharedMermaidLoadPromise) return sharedMermaidLoadPromise;
  sharedMermaidLoadPromise = new Promise(function (resolve) {
    if (typeof document === 'undefined') {
      sharedMermaidLoadPromise = null;
      resolve(null);
      return;
    }
    const script = document.createElement('script');
    script.src = '/api/markdown-studio/mermaid.js';
    script.async = true;
    script.setAttribute('data-plugin', 'dsh-markdown-studio');
    script.onload = function () {
      if (!window.__MDSTUDIO_MERMAID__) {
        sharedMermaidLoadPromise = null;
        script.remove();
      }
      resolve(window.__MDSTUDIO_MERMAID__ || null);
    };
    script.onerror = function () {
      sharedMermaidLoadPromise = null;
      script.remove();
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return sharedMermaidLoadPromise;
}

export interface MermaidAssetsOptions {
  React: typeof ReactNamespace;
  hostClient: HostClient;
  markdown: string;
  /** Palette-derived Mermaid colours; changing it re-renders diagrams. */
  theme: MermaidTheme;
  pageAliveRef: { current: boolean };
}

export interface MermaidAssetsApi {
  cache: Map<string, MermaidCacheEntry>;
  version: number;
  ensure: (markdown: string) => Promise<void>;
  filenames: () => Set<string>;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function extractMermaidBlocks(markdown: unknown): string[] {
  const source = String(markdown || '');
  if (!/mermaid/i.test(source)) return [];
  const blocks: string[] = [];
  const html = renderMarkdown(source, { linkFootnotes: false }).html;
  const pattern = /<code class="mdstudio-lang-mermaid">([\s\S]*?)<\/code>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const code = decodeHtmlEntities(match[1]).trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

export function prependMermaidDirective(code: string, directive: string): string {
  const fm = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.exec(code);
  if (fm) return fm[0] + (fm[0].endsWith('\n') ? '' : '\n') + directive + '\n' + code.slice(fm[0].length);
  return directive + '\n' + code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function viewBoxSize(viewBox: number[], index: number): number {
  return viewBox.length === 4 && viewBox[index] > 0 ? viewBox[index] : 0;
}

function parseSvgDimension(root: Element, viewBox: number[], name: string, index: number, fallback: number): number {
  return viewBoxSize(viewBox, index) || Number.parseFloat(String(root.getAttribute(name))) || fallback;
}

function svgToPng(svg: string, background: string): Promise<string> {
  return new Promise(function (resolve, reject) {
    try {
      const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = documentNode.documentElement;
      const viewBox = String(root.getAttribute('viewBox') || '')
        .split(/[\s,]+/)
        .map(Number);
      const width = parseSvgDimension(root, viewBox, 'width', 2, 800);
      const height = parseSvgDimension(root, viewBox, 'height', 3, 600);
      root.setAttribute('width', String(width));
      root.setAttribute('height', String(height));
      if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = function () {
        try {
          const scale = Math.min(2, 2400 / Math.max(1, width), 2400 / Math.max(1, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(width * scale));
          canvas.height = Math.max(1, Math.ceil(height * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            URL.revokeObjectURL(url);
            reject(new Error('canvas unavailable'));
            return;
          }
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Mermaid SVG could not be loaded'));
      };
      image.src = url;
    } catch (error) {
      reject(error);
    }
  });
}

export function useMermaidAssets(options: MermaidAssetsOptions): MermaidAssetsApi {
  const React = options.React;
  const cacheRef = React.useRef<Map<string, MermaidCacheEntry>>(new Map());
  const [version, setVersion] = React.useState(0);
  const ensureGenRef = React.useRef(0);
  const inFlightEnsureRef = React.useRef<{ key: string; promise: Promise<void> } | null>(null);
  const pinnedKeysRef = React.useRef<Map<string, number>>(new Map());
  const themeRef = useLatest(React, options.theme);

  function load(): Promise<MermaidModule | null> {
    return loadMermaidModule();
  }

  function updateCacheIfActive(key: string, entry: MermaidCacheEntry): void {
    if (cacheRef.current.has(key)) cacheRef.current.set(key, entry);
  }

  async function renderMermaidToAsset(
    mermaid: MermaidModule,
    theme: MermaidTheme,
    currentKey: string,
    currentCode: string,
    currentIndex: number,
  ): Promise<MermaidCacheEntry | null> {
    const svg = await mermaid.render(
      prependMermaidDirective(currentCode, theme.directive),
      'mdstudio-mermaid-' + Date.now() + '-' + currentIndex,
    );
    if (!cacheRef.current.has(currentKey)) return null;
    const png = await svgToPng(svg, theme.background);
    const prepared = await prepareImageForWechat(png);
    const stored = await options.hostClient.storeAsset(prepared.dataUrl, prepared.filename);
    return {
      status: 'ready',
      filename: stored.filename,
      assetPath: stored.assetPath || 'assets/' + stored.filename,
    };
  }

  async function renderAndStore(
    mermaid: MermaidModule,
    theme: MermaidTheme,
    currentKey: string,
    currentCode: string,
    currentIndex: number,
  ): Promise<void> {
    try {
      const entry = await renderMermaidToAsset(mermaid, theme, currentKey, currentCode, currentIndex);
      if (!entry) return;
      updateCacheIfActive(currentKey, entry);
    } catch (error) {
      updateCacheIfActive(currentKey, { status: 'error', error: errorText(error) });
    }
    if (options.pageAliveRef.current) setVersion((value) => value + 1);
  }

  function loadingPromiseOf(entry: MermaidCacheEntry): Promise<void> {
    return entry.promise || Promise.resolve();
  }

  function awaitExistingEntry(cached: MermaidCacheEntry | undefined): Promise<void> | 'ready' | null {
    if (!cached) return null;
    if (cached.status === 'ready') return 'ready';
    return cached.status === 'loading' ? loadingPromiseOf(cached) : null;
  }

  async function ensureBlock(
    mermaid: MermaidModule,
    theme: MermaidTheme,
    key: string,
    code: string,
    index: number,
  ): Promise<void> {
    const existing = awaitExistingEntry(cacheRef.current.get(key));
    if (existing === 'ready') return;
    if (existing) {
      await existing;
      return;
    }
    cacheRef.current.set(key, { status: 'loading' });
    const task = renderAndStore(mermaid, theme, key, code, index);
    cacheRef.current.set(key, { status: 'loading', promise: task });
    await task;
  }

  function pruneInactiveCache(keys: string[]): void {
    const active = new Set(keys);
    cacheRef.current.forEach(function (_entry, key) {
      if (!active.has(key) && (pinnedKeysRef.current.get(key) || 0) === 0) cacheRef.current.delete(key);
    });
  }

  function isCurrentGen(gen: number): boolean {
    return gen === ensureGenRef.current;
  }

  function isStaleGen(gen: number, unstoppable: boolean): boolean {
    return !unstoppable && !isCurrentGen(gen);
  }

  function adjustPins(keys: string[], delta: 1 | -1): void {
    for (const k of keys) {
      const next = (pinnedKeysRef.current.get(k) || 0) + delta;
      if (next > 0) pinnedKeysRef.current.set(k, next);
      else pinnedKeysRef.current.delete(k);
    }
  }

  function beginBlockScope(keys: string[], unstoppable: boolean): void {
    if (unstoppable) adjustPins(keys, 1);
    else pruneInactiveCache(keys);
  }

  function endBlockScope(keys: string[], unstoppable: boolean): void {
    if (unstoppable) adjustPins(keys, -1);
  }

  async function renderAllBlocks(
    mermaid: MermaidModule,
    theme: MermaidTheme,
    blocks: string[],
    gen: number,
    unstoppable: boolean,
  ): Promise<void> {
    const keys = blocks.map((code) => mermaidCacheKey(code, theme));
    beginBlockScope(keys, unstoppable);
    try {
      for (let index = 0; index < blocks.length; index++) {
        if (isStaleGen(gen, unstoppable)) return;
        await ensureBlock(mermaid, theme, keys[index], blocks[index], index);
      }
    } finally {
      endBlockScope(keys, unstoppable);
    }
  }

  function clearIdleCacheIfUnpinned(gen: number, unstoppable: boolean): void {
    if (!isStaleGen(gen, unstoppable) && pinnedKeysRef.current.size === 0) cacheRef.current.clear();
  }

  function isMermaidUsable(mermaid: MermaidModule | null, gen: number, unstoppable: boolean): mermaid is MermaidModule {
    return Boolean(mermaid && typeof mermaid.render === 'function' && !isStaleGen(gen, unstoppable));
  }

  async function runEnsure(markdown: string, theme: MermaidTheme, gen: number, unstoppable: boolean): Promise<void> {
    const blocks = extractMermaidBlocks(markdown);
    if (!blocks.length) {
      clearIdleCacheIfUnpinned(gen, unstoppable);
      return;
    }
    const mermaid = await load();
    if (!isMermaidUsable(mermaid, gen, unstoppable)) return;
    await renderAllBlocks(mermaid, theme, blocks, gen, unstoppable);
  }

  function ensureRunKey(markdown: string, directive: string, unstoppable: boolean): string {
    return markdown + '\0' + directive + '\0' + (unstoppable ? '1' : '0');
  }

  function nextEnsureGen(unstoppable: boolean): number {
    return unstoppable ? ensureGenRef.current : ++ensureGenRef.current;
  }

  function releaseInFlight(promise: Promise<void>): void {
    if (inFlightEnsureRef.current && inFlightEnsureRef.current.promise === promise) {
      inFlightEnsureRef.current = null;
    }
  }

  async function ensureInternal(markdown: string, unstoppable: boolean): Promise<void> {
    const theme = themeRef.current;
    const runKey = ensureRunKey(markdown, theme.directive, unstoppable);
    const existing = inFlightEnsureRef.current;
    if (existing && existing.key === runKey) return existing.promise;
    const gen = nextEnsureGen(unstoppable);
    const promise = runEnsure(markdown, theme, gen, unstoppable).finally(function () {
      releaseInFlight(promise);
    });
    if (!unstoppable) inFlightEnsureRef.current = { key: runKey, promise };
    return promise;
  }

  function ensure(markdown: string): Promise<void> {
    return ensureInternal(markdown, true);
  }

  useDebouncedKeyTask(React, options.markdown + '\0' + options.theme.directive, 250, true, function () {
    void ensureInternal(options.markdown, false);
  });

  return {
    cache: cacheRef.current,
    version,
    ensure,
    filenames: function () {
      const files = new Set<string>();
      cacheRef.current.forEach(function (entry) {
        if (entry && entry.status === 'ready' && entry.filename) files.add(entry.filename);
      });
      return files;
    },
  };
}
