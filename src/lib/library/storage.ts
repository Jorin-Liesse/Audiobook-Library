import type { LibraryDirectory } from '#lib/types/library.ts';

export interface SavedLibrary {
  name: string;
  files: { file: File; path: string }[];
}

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

// Commit the folder and its local copy together so switching libraries cannot
// leave a remembered folder pointing at another library's files.
export async function saveLibrary(handle: LibraryDirectory | null, library: SavedLibrary | null) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      try {
        if (handle) kv.put(handle, 'root');
        else kv.delete('root');
        if (library) kv.put(library, 'library');
        else kv.delete('library');
      } catch (failure) {
        // A synchronous clone error must also roll back preceding writes.
        tx.abort();
        reject(failure);
      }
    });
    return true;
  } catch {
    return false;
  }
}

export function restoreLibraryFiles(library: SavedLibrary) {
  return library.files.map(({ file, path }) => {
    // Custom File properties are not preserved by IndexedDB's structured clone.
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
    return file;
  });
}
