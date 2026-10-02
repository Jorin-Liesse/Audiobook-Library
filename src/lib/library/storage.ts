import type { Book, LibraryDirectory, LibraryFile, StoredFile } from '#lib/types/library.ts';
import { buildLibrary } from './files.ts';

export interface SavedLibrary {
  name: string;
  files: { file: File; path: string }[];
}

export interface LibraryIndex {
  version: 1;
  name: string;
  fileKeys: string[];
  books: Book[];
}

export function createLibraryIndex(library: SavedLibrary, books: Book[], generation: string) {
  const files = new Map<string, File>();
  const references = new Map<File, StoredFile>();
  library.files.forEach(({ file, path }, index) => {
    const storageKey = `library-file:${generation}:${index}`;
    files.set(storageKey, file);
    references.set(file, {
      storageKey,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      webkitRelativePath: path
    });
  });
  const reference = (file: LibraryFile): StoredFile => {
    if (!(file instanceof File) || !references.has(file))
      throw new Error('An imported file is missing from the library');
    return references.get(file)!;
  };
  const catalog: LibraryIndex = {
    version: 1,
    name: library.name,
    fileKeys: [...files.keys()],
    books: books.map((book) => ({
      id: book.id,
      key: book.key,
      title: book.title,
      author: book.author,
      series: book.series,
      treePath: [...book.treePath],
      files: book.files.map(reference),
      image: book.image ? reference(book.image) : null,
      parentImage: book.parentImage ? reference(book.parentImage) : null,
      chapters: book.chapters,
      cover: { ...book.cover },
      progress: 0,
      started: false,
      liked: false,
      read: false
    }))
  };
  return { catalog, files };
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

// Replace the catalog, folder, and file records atomically in the existing store.
// Keeping the database version avoids blocking startup on another open PWA tab.
export async function saveLibrary(
  handle: LibraryDirectory | null,
  library: SavedLibrary | null,
  books?: Book[]
) {
  try {
    const prepared = library
      ? createLibraryIndex(
          library,
          books ?? buildLibrary(restoreLibraryFiles(library)),
          crypto.randomUUID()
        )
      : null;
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      const previous = kv.get('library-index');
      previous.onsuccess = () => {
        try {
          const old = previous.result as LibraryIndex | undefined;
          for (const key of old?.fileKeys ?? []) kv.delete(key);
          if (handle) kv.put(handle, 'root');
          else kv.delete('root');
          if (prepared) {
            for (const [key, file] of prepared.files) kv.put(file, key);
            kv.put(prepared.catalog, 'library-index');
          } else kv.delete('library-index');
          kv.delete('library');
        } catch (failure) {
          tx.abort();
          reject(failure);
        }
      };
    });
    return true;
  } catch {
    return false;
  }
}

export async function readSavedLibrary() {
  const [handle, catalog] = await Promise.all([
    idb.get<LibraryDirectory>('kv', 'root'),
    idb.get<LibraryIndex>('kv', 'library-index')
  ]);
  // Read the old whole-library copy only for a one-time migration.
  const legacy = catalog?.version === 1 ? undefined : await idb.get<SavedLibrary>('kv', 'library');
  return { handle, catalog: catalog?.version === 1 ? catalog : undefined, legacy };
}

export async function loadLibraryFile(file: LibraryFile): Promise<File> {
  if (file instanceof File) return file;
  const saved = await idb.get<File>('kv', file.storageKey);
  if (!(saved instanceof File)) throw new Error('The saved audio file is unavailable');
  Object.defineProperty(saved, 'webkitRelativePath', {
    value: file.webkitRelativePath,
    configurable: true
  });
  return saved;
}

export function restoreLibraryFiles(library: SavedLibrary) {
  return library.files.map(({ file, path }) => {
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
    return file;
  });
}
