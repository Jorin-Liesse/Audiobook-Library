export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem('abl.' + key);
      if (value === null) return fallback;
      const parsed = JSON.parse(value);
      if (
        fallback !== null &&
        (parsed === null ||
          typeof parsed !== typeof fallback ||
          Array.isArray(parsed) !== Array.isArray(fallback))
      )
        return fallback;
      return parsed;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('abl.' + key, JSON.stringify(value));
    } catch {
      // The library still works when browser storage is unavailable or full.
    }
  }
};

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('audiobook-library', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
      request.result.createObjectStore('covers');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}

async function transaction<T>(
  name: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  try {
    const db = await openDatabase();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const request = action(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return undefined;
  }
}

export const idb = {
  get<T>(name: string, key: string) {
    return transaction<T>(name, 'readonly', (store) => store.get(key));
  },
  set(name: string, key: string, value: unknown) {
    return transaction<IDBValidKey>(name, 'readwrite', (store) => store.put(value, key));
  },
  del(name: string, key: string) {
    return transaction<undefined>(name, 'readwrite', (store) => store.delete(key));
  }
};
