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
      if (!window.__MDSTUDIO_MATH__) {
        sharedMathLoadPromise = null;
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

export function useMathAssets(options: MathAssetsOptions): MathAssetsApi {
  const React = options.React;
  const [css, setCss] = React.useState<string>(function () {
    return typeof window !== 'undefined' && window.__MDSTUDIO_MATH__ ? window.__MDSTUDIO_MATH__.cssText : '';
  });
  const [version, setVersion] = React.useState(0);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const mountedRef = React.useRef(true);
  const alreadyLoaded = typeof window !== 'undefined' && Boolean(window.__MDSTUDIO_MATH__);
  const needsMath = !alreadyLoaded && hasMath(options.markdown);

  useMountDisposable(React, function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
    };
  });

  async function ensure(markdown?: string): Promise<void> {
    if (markdown !== undefined && !hasMath(markdown)) return;
    if (window.__MDSTUDIO_MATH__) {
      if (mountedRef.current && css !== window.__MDSTUDIO_MATH__.cssText) {
        setCss(window.__MDSTUDIO_MATH__.cssText);
        setVersion((value) => value + 1);
      }
      return;
    }
    await loadMathScript();
    const loaded = (window as { __MDSTUDIO_MATH__?: { cssText: string } }).__MDSTUDIO_MATH__;
    if (!mountedRef.current) return;
    if (loaded) {
      setLoadFailed(false);
      setCss(loaded.cssText);
      setVersion((value) => value + 1);
    } else {
      setLoadFailed(true);
    }
  }

  const taskKey = !needsMath
    ? 'none'
    : loadFailed
      ? `math-retry:${options.markdown.length}:${options.markdown.slice(0, 32)}`
      : 'math';
  useDebouncedKeyTask(React, taskKey, loadFailed ? 300 : 0, needsMath, function () {
    void ensure(options.markdown);
  });

  return { css, version, ensure };
}
