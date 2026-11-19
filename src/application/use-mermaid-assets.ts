import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import { prepareImageForWechat } from '../adapters/image-encode';
import type { MermaidCacheEntry } from '../domain/mermaid';
import { useDebouncedKeyTask, useLatest } from '../runtime/react-lifecycle';
import { type MermaidTheme, mermaidCacheKey } from '../themes';

interface MermaidModule {
  render(code: unknown, id?: string): Promise<string>;
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

export function extractMermaidBlocks(markdown: unknown): string[] {
  const blocks: string[] = [];
  const pattern = /(?:^|\n) {0,3}(`{3,}|~{3,})[ \t]*mermaid[^\r\n]*\r?\n([\s\S]*?)\r?\n {0,3}\1[ \t]*(?=\r?\n|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(markdown || '')))) {
    const code = match[2].trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

export function prependMermaidDirective(code: string, directive: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(code);
  if (fm) return fm[0] + (fm[0].endsWith('\n') ? '' : '\n') + directive + '\n' + code.slice(fm[0].length);
  return directive + '\n' + code;
}

function svgToPng(svg: string, background: string): Promise<string> {
  return new Promise(function (resolve, reject) {
    try {
      const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = documentNode.documentElement;
      const viewBox = String(root.getAttribute('viewBox') || '')
        .split(/[\s,]+/)
        .map(Number);
      function dimension(name: string, index: number, fallback: number): number {
        return viewBox.length === 4 && viewBox[index] > 0
          ? viewBox[index]
          : parseFloat(root.getAttribute(name) || '') || fallback;
      }
      const width = dimension('width', 2, 800);
      const height = dimension('height', 3, 600);
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
  const loadPromiseRef = React.useRef<Promise<MermaidModule | null> | null>(null);
  const themeRef = useLatest(React, options.theme);

  function load(): Promise<MermaidModule | null> {
    if (window.__MDSTUDIO_MERMAID__) return Promise.resolve(window.__MDSTUDIO_MERMAID__);
    if (loadPromiseRef.current) return loadPromiseRef.current;
    loadPromiseRef.current = new Promise(function (resolve) {
      if (typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const script = document.createElement('script');
      script.src = '/api/markdown-studio/mermaid.js';
      script.async = true;
      script.onload = function () {
        if (!window.__MDSTUDIO_MERMAID__) {
          loadPromiseRef.current = null;
          script.remove();
        }
        resolve(window.__MDSTUDIO_MERMAID__ || null);
      };
      script.onerror = function () {
        loadPromiseRef.current = null;
        script.remove();
        resolve(null);
      };
      document.head.appendChild(script);
    });
    return loadPromiseRef.current;
  }

  async function ensure(markdown: string): Promise<void> {
    const blocks = extractMermaidBlocks(markdown);
    if (!blocks.length) return;
    const mermaid = await load();
    if (!mermaid || typeof mermaid.render !== 'function') return;
    const theme = themeRef.current;
    const keys = blocks.map(function (code) {
      return mermaidCacheKey(code, theme);
    });
    const active = new Set(keys);
    cacheRef.current.forEach(function (_entry, key) {
      if (!active.has(key)) cacheRef.current.delete(key);
    });
    for (let index = 0; index < blocks.length; index++) {
      const key = keys[index];
      const cached = cacheRef.current.get(key);
      if (cached && cached.status === 'ready') continue;
      if (cached && cached.status === 'loading') {
        if (cached.promise) await cached.promise;
        continue;
      }
      const task = (async function (currentKey: string, currentCode: string, currentIndex: number) {
        try {
          const svg = await mermaid.render(
            prependMermaidDirective(currentCode, theme.directive),
            'mdstudio-mermaid-' + Date.now() + '-' + currentIndex,
          );
          const png = await svgToPng(svg, theme.background);
          const prepared = await prepareImageForWechat(png);
          const stored = await options.hostClient.storeAsset(prepared.dataUrl, prepared.filename);
          cacheRef.current.set(currentKey, {
            status: 'ready',
            filename: stored.filename,
            assetPath: stored.assetPath || 'assets/' + stored.filename,
          });
        } catch (error) {
          cacheRef.current.set(currentKey, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (options.pageAliveRef.current)
          setVersion(function (value) {
            return value + 1;
          });
      })(key, blocks[index], index);
      cacheRef.current.set(key, { status: 'loading', promise: task });
      await task;
    }
  }

  useDebouncedKeyTask(React, options.markdown + '\0' + options.theme.directive, 250, true, function () {
    void ensure(options.markdown);
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
