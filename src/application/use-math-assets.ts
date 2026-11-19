import type * as ReactNamespace from 'react';
import { useDebouncedKeyTask } from '../runtime/react-lifecycle';

export interface MathAssetsOptions {
  React: typeof ReactNamespace;
  markdown: string;
}

export interface MathAssetsApi {
  css: string;
  version: number;
  ensure: () => Promise<void>;
}

function hasMath(markdown: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\(|\\\[/.test(markdown);
}

export function useMathAssets(options: MathAssetsOptions): MathAssetsApi {
  const React = options.React;
  const [css, setCss] = React.useState<string>(function () {
    return typeof window !== 'undefined' && window.__MDSTUDIO_MATH__ ? window.__MDSTUDIO_MATH__.cssText : '';
  });
  const [version, setVersion] = React.useState(0);
  const promiseRef = React.useRef<Promise<void> | null>(null);
  const needsMath = hasMath(options.markdown);

  function ensure(): Promise<void> {
    if (window.__MDSTUDIO_MATH__) {
      if (css !== window.__MDSTUDIO_MATH__.cssText) {
        setCss(window.__MDSTUDIO_MATH__.cssText);
        setVersion(function (value) {
          return value + 1;
        });
      }
      return Promise.resolve();
    }
    if (promiseRef.current) return promiseRef.current;
    promiseRef.current = new Promise(function (resolve) {
      if (typeof document === 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = '/api/markdown-studio/math.js';
      script.async = true;
      script.onload = function () {
        if (window.__MDSTUDIO_MATH__) {
          setCss(window.__MDSTUDIO_MATH__.cssText);
          setVersion(function (value) {
            return value + 1;
          });
        } else {
          promiseRef.current = null;
          script.remove();
        }
        resolve();
      };
      script.onerror = function () {
        promiseRef.current = null;
        script.remove();
        resolve();
      };
      document.head.appendChild(script);
    });
    return promiseRef.current;
  }

  useDebouncedKeyTask(React, needsMath ? 'math' : 'none', 0, needsMath, function () {
    void ensure();
  });

  return { css, version, ensure };
}
