import type {
  Book,
  LibraryDirectory,
  LibraryFile,
  LinkedFile,
  NativeFile,
} from '#lib/types/library.ts';
import { buildLibrary } from './files.ts';
import { isNativeFile, nativeFileUrl } from './native.ts';

export interface SavedLibrary {
  name: string;
  files: { file: LibraryFile; path: string }[];
}

export interface LibraryIndex {
  version: 1 | 2;
  name: string;
  fileKeys: string[];
  books: Book[];
}

export function createLibraryIndex(library: SavedLibrary, books: Book[], hasFolder: boolean) {
  const references = new Map<LibraryFile, LinkedFile>();
  library.files.forEach(({ file, path }) => {
    if (isNativeFile(file) || 'source' in file || 'storageKey' in file) return;
    references.set(file, {
      source: hasFolder ? 'folder' : 'picker',
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      fingerprint: (file as LibraryFile).fingerprint,
      webkitRelativePath: path,
    });
  });
  const reference = (file: LibraryFile): LinkedFile | NativeFile => {
    if (isNativeFile(file)) return { ...file };
    if ('source' in file) return { ...file };
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
      read: false,
    })),
  };
  return catalog;
}

const parsedValues = new Map<string, { raw: string; value: unknown }>();

export const store = {
  keys(prefix: string) {
    const keys: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith('abl.' + prefix)) keys.push(key.slice(4));
      }
    } catch {
      /* Unavailable storage is reported by the next write. */
    }
    return keys;
  },
  get<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem('abl.' + key);
      if (value === null) return fallback;
      const cached = parsedValues.get(key);
      const parsed: unknown = cached?.raw === value ? cached.value : JSON.parse(value);
      parsedValues.set(key, { raw: value, value: parsed });
      if (
        fallback !== null &&
        (parsed === null ||
          typeof parsed !== typeof fallback ||
          Array.isArray(parsed) !== Array.isArray(fallback))
      )
        return fallback;
      return parsed as T;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      const raw = JSON.stringify(value);
      localStorage.setItem('abl.' + key, raw);
      parsedValues.set(key, { raw, value });
      return true;
    } catch {
      return false;
    }
  },
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
  action: (store: IDBObjectStore) => IDBRequest<T>,
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
  },
};

// Keep the newest artwork within both limits. Existing database stores need no upgrade.
let pruningCovers: Promise<void> | undefined;
export function pruneCoverCache(maxEntries = 500, maxBytes = 64 * 1024 * 1024) {
  if (pruningCovers) return pruningCovers;
  const task = (async () => {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('covers', 'readwrite');
        const covers = tx.objectStore('covers');
        const entries: { key: IDBValidKey; at: number; bytes: number }[] = [];
        const cursor = covers.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) {
            entries.push({
              key: item.key,
              at: item.value.checkedAt ?? 0,
              bytes: item.value.blob?.size ?? 0,
            });
            item.continue();
          } else {
            entries.sort((a, b) => b.at - a.at);
            let bytes = 0;
            let count = 0;
            for (const entry of entries) {
              if (count < maxEntries && bytes + entry.bytes <= maxBytes) {
                count++;
                bytes += entry.bytes;
              } else covers.delete(entry.key);
            }
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } catch {
      /* Artwork can always be regenerated from the library. */
    }
  })();
  pruningCovers = task;
  void task.then(() => {
    if (pruningCovers === task) pruningCovers = undefined;
  });
  return task;
}

// Save only metadata and the original folder handle, never audio bytes.
// Keeping the database version avoids blocking startup on another open PWA tab.
export async function saveLibrary(
  handle: LibraryDirectory | null,
  library: SavedLibrary | null,
  books?: Book[],
) {
  try {
    const prepared = library
      ? createLibraryIndex(
          library,
          books ?? buildLibrary(restoreLibraryFiles(library)),
          handle !== null,
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
    idb.get<LibraryIndex>('kv', 'library-index'),
  ]);
  // Read the old whole-library copy only for a one-time migration.
  const supported = catalog?.version === 1 || catalog?.version === 2;
  const legacy = supported ? undefined : await idb.get<SavedLibrary>('kv', 'library');
  return { handle, catalog: supported ? catalog : undefined, legacy };
}

let root: LibraryDirectory | null = null;
let pickedFiles = new Map<string, File>();
let directories = new Map<string, Promise<FileSystemDirectoryHandle>>();

export function connectLibraryFiles(handle: LibraryDirectory | null, files: LibraryFile[] = []) {
  root = handle;
  pickedFiles = new Map(
    files
      .filter((file) => file instanceof File)
      .map((file) => [file.webkitRelativePath || file.name, file]),
  );
  directories = new Map();
}

export async function loadLibraryFile(file: LibraryFile): Promise<File> {
  if (file instanceof File) return file;
  if (isNativeFile(file)) {
    const response = await fetch(await nativeFileUrl(file));
    if (!response.ok)
      throw new Error('The original file is unavailable. Choose your folder again.');
    const original = new File([await response.blob()], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    Object.defineProperty(original, 'webkitRelativePath', {
      value: file.webkitRelativePath,
    });
    return original;
  }
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
      configurable: true,
    });
    return original;
  }
  const saved = await idb.get<File>('kv', file.storageKey);
  if (!(saved instanceof File)) throw new Error('The saved audio file is unavailable');
  Object.defineProperty(saved, 'webkitRelativePath', {
    value: file.webkitRelativePath,
    configurable: true,
  });
  return saved;
}

export function restoreLibraryFiles(library: SavedLibrary) {
  return library.files.map(({ file, path }) => {
    if (isNativeFile(file)) return { ...file, webkitRelativePath: path };
    Object.defineProperty(file, 'webkitRelativePath', {
      value: path,
      configurable: true,
    });
    return file;
  });
}

export async function libraryAudioSource(file: LibraryFile) {
  if (isNativeFile(file)) return { url: await nativeFileUrl(file), release: () => {} };
  const url = URL.createObjectURL(await loadLibraryFile(file));
  return { url, release: () => URL.revokeObjectURL(url) };
}
