import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLibrary, libraryFiles } from '#lib/library/files.ts';
import {
  createLibraryIndex,
  idb,
  loadLibraryFile,
  readSavedLibrary,
  restoreLibraryFiles,
  saveLibrary
} from '#lib/library/storage.ts';
import type { LibraryIndex, SavedLibrary } from '#lib/library/storage.ts';
import type { LibraryDirectory } from '#lib/types/library.ts';

test('restored files retain book keys, chapter order, covers, and playable bytes', async () => {
  const paths = [
    'Audiobooks/Series/Book/02.mp3',
    'Audiobooks/Series/Book/01.mp3',
    'Audiobooks/Series/Book/cover.jpg',
    'Audiobooks/Series/folder.jpg'
  ];
  const original = paths.map((path) => {
    const file = new File([path], path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  // Browser storage preserves File data, but drops custom relative-path properties.
  const library: SavedLibrary = {
    name: 'Audiobooks',
    files: original.map((file, index) => ({
      file: new File([file], file.name, { type: file.type, lastModified: file.lastModified }),
      path: paths[index]
    }))
  };
  const restored = restoreLibraryFiles(library);
  const before = buildLibrary(original);
  const after = buildLibrary(restored);
  assert.equal(after.length, 1);
  assert.equal(after[0].key, before[0].key);
  assert.equal(after[0].series, 'Series');
  assert.deepEqual(
    after[0].files.map((file) => file.name),
    ['01.mp3', '02.mp3']
  );
  assert.equal(after[0].image?.name, 'cover.jpg');
  assert.equal(after[0].parentImage?.name, 'folder.jpg');
  assert.equal(await (await loadLibraryFile(after[0].files[0])).text(), paths[1]);
  assert.deepEqual(
    restored.map((file) => file.webkitRelativePath),
    paths
  );
  const { catalog, files } = createLibraryIndex(library, after, 'generation');
  const savedBook = catalog.books[0];
  assert.equal(savedBook.key, before[0].key);
  assert.deepEqual(
    savedBook.files.map((file) => file.name),
    ['01.mp3', '02.mp3']
  );
  assert.equal(savedBook.image?.name, 'cover.jpg');
  assert.equal(savedBook.parentImage?.name, 'folder.jpg');
  assert.equal(savedBook.files[0] instanceof Blob, false);
  assert.equal(savedBook.image instanceof Blob, false);
  assert.equal(savedBook.parentImage instanceof Blob, false);
  assert.equal(files.size, 4);
});

test('folder imports save audio and artwork without unrelated or hidden files', () => {
  const paths = [
    'Library/book.m4b',
    'Library/cover.jpg',
    'Library/notes.txt',
    'Library/.hidden/a.mp3'
  ];
  const files = paths.map((path) => {
    const file = new File(['data'], path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  assert.deepEqual(
    libraryFiles(files).map((file) => file.name),
    ['book.m4b', 'cover.jpg']
  );
});

test('library saves commit together and roll back on quota and clone errors', async () => {
  // Model transaction completion/abort to verify the app waits for commits and
  // explicitly aborts synchronous failures rather than committing a partial save.
  let values = new Map<string, unknown>();
  let failure: 'quota' | 'clone' | null = null;
  const reads: string[] = [];
  let writes = 0;
  const database = {
    createObjectStore() {},
    transaction() {
      const pending = new Map(values);
      let aborted = false;
      const tx = {
        error: null as DOMException | null,
        oncomplete: () => {},
        onerror: () => {},
        onabort: () => {},
        abort() {
          aborted = true;
          queueMicrotask(() => tx.onabort());
        },
        objectStore() {
          return {
            put(value: unknown, key: string) {
              writes++;
              if (key === 'library-index' && failure === 'clone')
                throw new DOMException('Could not clone files', 'DataCloneError');
              pending.set(key, value);
              return { result: key };
            },
            delete(key: string) {
              writes++;
              pending.delete(key);
              return { result: undefined };
            },
            get(key: string) {
              reads.push(key);
              const request = { result: pending.get(key), onsuccess: () => {} };
              queueMicrotask(() => request.onsuccess());
              return request;
            }
          };
        }
      };
      setImmediate(() => {
        if (aborted) return;
        if (failure === 'quota') {
          tx.error = new DOMException('Storage full', 'QuotaExceededError');
          tx.onabort();
        } else {
          values = pending;
          tx.oncomplete();
        }
      });
      return tx;
    }
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = { result: database, onsuccess: () => {} };
        queueMicrotask(() => request.onsuccess());
        return request;
      }
    }
  });
  try {
    const handle = { name: 'Original' } as LibraryDirectory;
    const audio = new File(['playable audio'], 'book.m4b', { type: 'audio/mp4' });
    const library: SavedLibrary = {
      name: 'Original',
      files: [{ file: audio, path: 'Original/book.m4b' }]
    };
    assert.equal(await saveLibrary(handle, library), true);
    assert.equal(await idb.get('kv', 'root'), handle);
    const catalog = await idb.get<LibraryIndex>('kv', 'library-index');
    assert.ok(catalog);
    assert.equal(catalog.name, 'Original');
    assert.equal(catalog.books.length, 1);
    assert.equal(catalog.books[0].files[0] instanceof Blob, false);
    const written = writes;
    // Reloading must not read audio, invoke folder permissions/scans, or write a
    // fresh cache. Only two small metadata records are read on each launch.
    for (let launch = 0; launch < 3; launch++) {
      reads.length = 0;
      const restored = await readSavedLibrary();
      assert.equal(restored.catalog, catalog);
      assert.equal(restored.handle, handle);
      assert.equal(restored.legacy, undefined);
      assert.deepEqual(reads.sort(), ['library-index', 'root']);
      assert.equal(writes, written);
    }
    reads.length = 0;
    const file = await loadLibraryFile(catalog.books[0].files[0]);
    assert.equal(await file.text(), 'playable audio');
    assert.equal(file.webkitRelativePath, 'Original/book.m4b');
    assert.deepEqual(reads, [catalog.fileKeys[0]]);
    values.set('library', library);

    for (const cause of ['quota', 'clone'] as const) {
      failure = cause;
      assert.equal(await saveLibrary(null, { name: 'Replacement', files: [] }), false);
      assert.equal(values.get('root'), handle);
      assert.equal(values.get('library'), library);
      assert.equal(values.get('library-index'), catalog);
      assert.equal(values.get(catalog.fileKeys[0]), audio);
    }

    failure = null;
    const replacement: SavedLibrary = { name: 'Mobile import', files: [] };
    assert.equal(await saveLibrary(null, replacement), true);
    assert.equal(values.has('root'), false);
    assert.equal(values.has('library'), false);
    assert.equal(values.has(catalog.fileKeys[0]), false);
    assert.equal((await idb.get<LibraryIndex>('kv', 'library-index'))?.name, replacement.name);
    await assert.rejects(loadLibraryFile(catalog.books[0].files[0]), /unavailable/);

    assert.equal(await saveLibrary(handle, null), true);
    assert.equal(await idb.get('kv', 'root'), handle);
    assert.equal(values.has('library'), false);
    assert.equal(values.has('library-index'), false);
    values.set('library', library);
    const legacy = await readSavedLibrary();
    assert.equal(legacy.legacy, library);
    assert.equal(legacy.catalog, undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
