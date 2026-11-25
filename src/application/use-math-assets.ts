import type * as ReactNamespace from 'react';
import { containsMath } from '../engine';
import { useDebouncedKeyTask, useMountDisposable } from '../runtime/react-lifecycle';

export interface MathAssetsOptions {
  React: typeof ReactNamespace;
  markdown: string;
}

export interface MathAssetsApi {
  css: string;
  version: number;
  ensure: (markdown?: string) => Promise<void>;
}

export function hasMath(markdown: string): boolean {
  return containsMath(markdown);
}

let sharedMathLoadPromise: Promise<void> | null = null;

function loadMathScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.__MDSTUDIO_MATH__) return Promise.resolve();
  if (sharedMathLoadPromise) return sharedMathLoadPromise;
  sharedMathLoadPromise = new Promise(function (resolve) {
    if (typeof document === 'undefined') {
      sharedMathLoadPromise = null;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '/api/markdown-studio/math.js';
    script.async = true;
    script.setAttribute('data-plugin', 'dsh-markdown-studio');
    script.onload = function () {
      sharedMathLoadPromise = null;
      if (!window.__MDSTUDIO_MATH__) {
        script.remove();
      }
      resolve();
    };
    script.onerror = function () {
      sharedMathLoadPromise = null;
      script.remove();
      resolve();
    };
    document.head.appendChild(script);
  });
  return sharedMathLoadPromise;
}

function isMathLoaded(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__MDSTUDIO_MATH__);
}

function buildMathTaskKey(needsMath: boolean, loadFailed: boolean, markdown: string): string {
  if (!needsMath) return 'none';
  return loadFailed ? `math-retry:${markdown.length}:${markdown.slice(0, 24)}:${markdown.slice(-24)}` : 'math';
}

export function useMathAssets(options: MathAssetsOptions): MathAssetsApi {
  const React = options.React;
  const [mathReady, setMathReady] = React.useState<boolean>(isMathLoaded);
  const [css, setCss] = React.useState<string>(function () {
    return isMathLoaded() ? window.__MDSTUDIO_MATH__!.cssText : '';
  });
  const [version, setVersion] = React.useState(0);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const mountedRef = React.useRef(true);
  const loaded = mathReady && isMathLoaded();
  const hasMathInDoc = React.useMemo(
    function () {
      return loaded ? false : hasMath(options.markdown);
    },
    [loaded, options.markdown],
  );
  const needsMath = !loaded && hasMathInDoc;

  useMountDisposable(React, function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
    };
  });

  function syncLoadedCss(cssText: string): void {
    if (!mountedRef.current || (mathReady && css === cssText)) return;
    setMathReady(true);
    setCss(cssText);
    setVersion((value) => value + 1);
  }

  function applyLoadOutcome(loadedMod: { cssText: string } | undefined): void {
    if (!mountedRef.current) return;
    if (loadedMod) {
      setLoadFailed(false);
      setMathReady(true);
      setCss(loadedMod.cssText);
      setVersion((value) => value + 1);
    } else {
      setLoadFailed(true);
    }
  }

  async function ensure(markdown?: string): Promise<void> {
    if (markdown !== undefined && !hasMath(markdown)) return;
    if (window.__MDSTUDIO_MATH__) {
      syncLoadedCss(window.__MDSTUDIO_MATH__.cssText);
      return;
    }
    await loadMathScript();
    applyLoadOutcome((window as { __MDSTUDIO_MATH__?: { cssText: string } }).__MDSTUDIO_MATH__);
  }

  const taskKey = buildMathTaskKey(needsMath, loadFailed, options.markdown);
  useDebouncedKeyTask(React, taskKey, loadFailed ? 300 : 0, needsMath, function () {
    void ensure(options.markdown);
  });

  return { css, version, ensure };
}
