/**
 * Low-level React & browser lifecycle primitives.
 *
 * Architectural rule: business and UI modules (`src/domain/`, `src/application/`,
 * `src/adapters/`, `src/ui/`, `src/app.ts`) are strictly forbidden from calling
 * `useEffect` or `useLayoutEffect` directly. All framework subscriptions,
 * disposable mount scopes, timers, and DOM event bindings live in `src/runtime/`.
 */
import type * as ReactNamespace from 'react';

/**
 * Vercel `advanced-use-latest`: keeps a stable ref synced to the latest value
 * inside an isomorphic layout effect (never mutating `ref.current` during render).
 */
export function useLatest<T>(React: typeof ReactNamespace, value: T): ReactNamespace.MutableRefObject<T> {
  const ref = React.useRef(value);
  const useIsoLayoutEffect = React.useLayoutEffect || React.useEffect;
  useIsoLayoutEffect(
    function () {
      ref.current = value;
    },
    [value],
  );
  return ref;
}

/**
 * Cordis-style mount/unmount disposable scope (`ctx.effect(() => cleanup)`).
 * Runs once when the component mounts and disposes when it unmounts — no
 * dependency-array re-execution loops.
 */
export function useMountDisposable(React: typeof ReactNamespace, setup: () => void | (() => void)): void {
  const setupRef = useLatest(React, setup);
  React.useEffect(function () {
    return setupRef.current();
  }, []);
}

/**
 * Subscribe to an external store using React 18 `useSyncExternalStore`, falling
 * back cleanly when invoked against minimal unit-test React stubs.
 */
export function useExternalStore<T>(
  React: typeof ReactNamespace,
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  if (React.useSyncExternalStore) {
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
  const [, setTick] = React.useState(0);
  React.useEffect(
    function () {
      return subscribe(function () {
        setTick(function (v) {
          return v + 1;
        });
      });
    },
    [subscribe],
  );
  return getSnapshot();
}

/**
 * Declarative `window` event listener with live handler reference (never stale).
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  React: typeof ReactNamespace,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  enabled = true,
  capture = false,
): void {
  const handlerRef = useLatest(React, handler);
  React.useEffect(
    function () {
      if (!enabled || typeof window === 'undefined') return undefined;
      const listener = function (event: WindowEventMap[K]): void {
        handlerRef.current(event);
      };
      window.addEventListener(type, listener, capture);
      return function () {
        window.removeEventListener(type, listener, capture);
      };
    },
    [type, enabled, capture],
  );
}

/**
 * Declarative `document` event listener with live handler reference (never stale).
 */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  React: typeof ReactNamespace,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  enabled = true,
  capture = false,
): void {
  const handlerRef = useLatest(React, handler);
  React.useEffect(
    function () {
      if (!enabled || typeof document === 'undefined') return undefined;
      const listener = function (event: DocumentEventMap[K]): void {
        handlerRef.current(event);
      };
      document.addEventListener(type, listener, capture);
      return function () {
        document.removeEventListener(type, listener, capture);
      };
    },
    [type, enabled, capture],
  );
}

/**
 * Delayed boolean flag (e.g. showing a busy spinner only if an async action
 * takes longer than `delayMs`, avoiding visual flash on fast operations).
 */
export function useDelayedFlag(React: typeof ReactNamespace, active: boolean, delayMs: number): boolean {
  const [shown, setShown] = React.useState(false);
  React.useEffect(
    function () {
      if (!active) {
        setShown(false);
        return undefined;
      }
      const timer = window.setTimeout(function () {
        setShown(true);
      }, delayMs);
      return function () {
        window.clearTimeout(timer);
      };
    },
    [active, delayMs],
  );
  return active && shown;
}

/**
 * Auto-dismiss timer for transient notifications (Toast).
 */
export function useAutoDismissTimer(React: typeof ReactNamespace, holdMs: number, onDone: () => void): void {
  const onDoneRef = useLatest(React, onDone);
  React.useEffect(
    function () {
      const timer = window.setTimeout(function () {
        onDoneRef.current();
      }, holdMs);
      return function () {
        window.clearTimeout(timer);
      };
    },
    [holdMs],
  );
}

/**
 * Schedules a debounced background task whenever `key` changes while `enabled`
 * is true, automatically cancelling pending timers on change or unmount.
 */
export function useDebouncedKeyTask(
  React: typeof ReactNamespace,
  key: string,
  delayMs: number,
  enabled: boolean,
  task: () => void,
): void {
  const taskRef = useLatest(React, task);
  React.useEffect(
    function () {
      if (!enabled) return undefined;
      if (delayMs <= 0) {
        taskRef.current();
        return undefined;
      }
      const timer = window.setTimeout(function () {
        taskRef.current();
      }, delayMs);
      return function () {
        window.clearTimeout(timer);
      };
    },
    [key, delayMs, enabled],
  );
}

/**
 * Minimal lazy-chunk loader state hook used by the cold-boot shell (`client.js`).
 */
export function useLazyChunkReady(
  React: typeof ReactNamespace,
  isReady: () => boolean,
  load: () => Promise<unknown>,
): { error: string | null; retry: () => void } {
  const [, setTick] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(
    function () {
      if (isReady()) return undefined;
      let cancelled = false;
      load().then(
        function () {
          if (!cancelled)
            setTick(function (n) {
              return n + 1;
            });
        },
        function (err: unknown) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        },
      );
      return function () {
        cancelled = true;
      };
    },
    [error],
  );
  return {
    error,
    retry: function () {
      setError(null);
    },
  };
}
