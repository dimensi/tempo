export function indexedDBDriver() {
  const data = new Map<string, Map<IDBValidKey, unknown>>();
  let failPut: string | undefined;
  const db = {
    objectStoreNames: { contains: (name: string) => data.has(name) },
    createObjectStore: (name: string) => data.set(name, new Map()),
    close() {},
    transaction(names: string[]) {
      const draft = new Map(
        names.map((name) => [name, new Map(data.get(name))]),
      );
      let pending = 0;
      let stopped = false;
      const tx = {
        oncomplete: undefined as undefined | (() => void),
        onabort: undefined as undefined | (() => void),
        error: null as null | { name: string },
        abort() {
          stopped = true;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name: string) {
          const store = draft.get(name)!;
          function request(value: () => unknown) {
            const result = {
              result: undefined as unknown,
              onsuccess: undefined as undefined | (() => void),
            };
            pending++;
            queueMicrotask(() => {
              if (stopped) return;
              result.result = value();
              result.onsuccess?.();
              pending--;
              queueMicrotask(() => {
                if (!stopped && pending === 0) {
                  stopped = true;
                  for (const [name, rows] of draft) data.set(name, rows);
                  tx.oncomplete?.();
                }
              });
            });
            return result;
          }
          return {
            get: (key: IDBValidKey) => request(() => store.get(key)),
            getAll: () => request(() => [...store.values()]),
            put(value: unknown, key: IDBValidKey) {
              return request(() => {
                if (failPut === name) {
                  failPut = undefined;
                  tx.error = { name: 'QuotaExceededError' };
                  tx.abort();
                  return;
                }
                store.set(key, value);
              });
            },
            clear: () => request(() => store.clear()),
            delete: (key: IDBValidKey) => request(() => store.delete(key)),
            openCursor() {
              const keys = [...store.keys()];
              let index = 0;
              const result = {
                result: undefined as unknown,
                onsuccess: undefined as undefined | (() => void),
              };
              function next() {
                const current = request(() =>
                  index < keys.length
                    ? {
                        key: keys[index]!,
                        value: store.get(keys[index]!),
                        delete: () => store.delete(keys[index]!),
                        continue: () => {
                          index++;
                          next();
                        },
                      }
                    : null,
                );
                current.onsuccess = () => {
                  result.result = current.result;
                  result.onsuccess?.();
                };
              }
              next();
              return result;
            },
          };
        },
      };
      return tx;
    },
  };
  const factory = {
    open() {
      const request = {
        result: db,
        onupgradeneeded: undefined as undefined | (() => void),
        onsuccess: undefined as undefined | (() => void),
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return {
    factory: factory as unknown as IDBFactory,
    data,
    failFilesPut: () => {
      failPut = 'files';
    },
  };
}
