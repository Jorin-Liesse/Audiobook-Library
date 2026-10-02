import type { Book, LibraryDirectory, LibraryFile, LinkedFile } from '#lib/types/library.ts';
import { buildLibrary } from './files.ts';

export interface SavedLibrary {
  name: string;
  files: { file: File; path: string }[];
}

export interface LibraryIndex {
  version: 1 | 2;
  name: string;
  fileKeys: string[];
  books: Book[];
}

export function createLibraryIndex(library: SavedLibrary, books: Book[], hasFolder: boolean) {
  const references = new Map<File, LinkedFile>();
  library.files.forEach(({ file, path }) => {
    references.set(file, {
      source: hasFolder ? 'folder' : 'picker',
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      webkitRelativePath: path
    });
  });
  const reference = (file: LibraryFile): LinkedFile => {
    if (!(file instanceof File) || !references.has(file))
      throw new Error('An imported file is missing from the library');
    return references.get(file)!;
  };
  const catalog: LibraryIndex = {
    version: 2,
    name: library.name,
    fileKeys: [],
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
  return catalog;
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

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    // Protect the catalogue and saved handles from eviction. Folder permissions
    // are granted separately through FileSystemHandle.requestPermission().
    return await storage.persist();
  } catch {
    // Unsupported or refused persistence must not interrupt opening the library.
    return false;
  }
}

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

// Save only metadata and the original folder handle, never audio bytes.
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
          handle !== null
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
            kv.put(prepared, 'library-index');
          } else kv.delete('library-index');
          kv.delete('library');
        } catch (failure) {
          tx.abort();
          reject(failure);
        }
      };
    });
    void requestPersistentStorage();
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
  const supported = catalog?.version === 1 || catalog?.version === 2;
  const legacy = supported ? undefined : await idb.get<SavedLibrary>('kv', 'library');
  return { handle, catalog: supported ? catalog : undefined, legacy };
}

let root: LibraryDirectory | null = null;
let pickedFiles = new Map<string, File>();
let directories = new Map<string, Promise<FileSystemDirectoryHandle>>();

export function connectLibraryFiles(handle: LibraryDirectory | null, files: File[] = []) {
  root = handle;
  pickedFiles = new Map(files.map((file) => [file.webkitRelativePath || file.name, file]));
  directories = new Map();
}

export async function loadLibraryFile(file: LibraryFile): Promise<File> {
  if (file instanceof File) return file;
  if ('source' in file) {
    const picked = pickedFiles.get(file.webkitRelativePath);
    if (picked) return picked;
    if (file.source === 'picker' || !root)
      throw new Error('Choose your library folder again to access the original audio files.');
    // Resolve only this path, without enumerating the rest of the library.
    const parts = file.webkitRelativePath.split('/');
    if (parts.shift() !== root.name || parts.some((part) => !part || part === '..' || part === '.'))
      throw new Error('The saved file path does not belong to this library.');
    const name = parts.pop();
    if (!name) throw new Error('The saved file path is invalid.');
    let directory: FileSystemDirectoryHandle = root;
    let path = root.name;
    for (const part of parts) {
      path += '/' + part;
      let pending = directories.get(path);
      if (!pending) {
        pending = directory.getDirectoryHandle(part);
        directories.set(path, pending);
      }
      try {
        directory = await pending;
      } catch (failure) {
        directories.delete(path);
        throw failure;
      }
    }
    const original = await (await directory.getFileHandle(name)).getFile();
    Object.defineProperty(original, 'webkitRelativePath', {
      value: file.webkitRelativePath,
      configurable: true
    });
    return original;
  }
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
