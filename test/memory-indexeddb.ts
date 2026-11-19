export function installMemoryIndexedDb(): Map<string, unknown> {
  const storeData = new Map<string, unknown>();
  const storeNames = new Set<string>();

  const makeIndexedDb = (): IDBFactory =>
    ({
      open(): IDBOpenDBRequest {
        const db = {
          objectStoreNames: {
            contains: (name: string) => storeNames.has(name),
          },
          createObjectStore: (name: string) => {
            storeNames.add(name);
            return {};
          },
          transaction: () => {
            const tx: Record<string, unknown> = {
              error: null,
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              objectStore: () => ({
                put: (value: unknown, key: string) => {
                  storeData.set(key, value);
                  queueMicrotask(() => {
                    const done = tx.oncomplete as (() => void) | null;
                    if (done) done();
                  });
                  return {};
                },
                get: (key: string) => {
                  const req: Record<string, unknown> = {
                    result: storeData.get(key),
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                  };
                  queueMicrotask(() => {
                    const ok = req.onsuccess as (() => void) | null;
                    if (ok) ok();
                  });
                  return req;
                },
              }),
            };
            return tx;
          },
          close: () => {},
        };

        const req: Record<string, unknown> = {
          result: db,
          error: null,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        queueMicrotask(() => {
          if (!storeNames.has('handles')) {
            const upgrade = req.onupgradeneeded as (() => void) | null;
            if (upgrade) upgrade();
          }
          const ok = req.onsuccess as (() => void) | null;
          if (ok) ok();
        });
        return req as unknown as IDBOpenDBRequest;
      },
    }) as unknown as IDBFactory;

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: makeIndexedDb(),
  });
  return storeData;
}
