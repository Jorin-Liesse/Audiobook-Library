import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLibrary, libraryFiles } from '#lib/library/files.ts';
import { idb, restoreLibraryFiles, saveLibrary } from '#lib/library/storage.ts';
import type { SavedLibrary } from '#lib/library/storage.ts';
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
  assert.equal(await after[0].files[0].text(), paths[1]);
  assert.deepEqual(
    restored.map((file) => file.webkitRelativePath),
    paths
  );
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
              if (key === 'library' && failure === 'clone')
                throw new DOMException('Could not clone files', 'DataCloneError');
              pending.set(key, value);
              return { result: key };
            },
            delete(key: string) {
              pending.delete(key);
              return { result: undefined };
            },
            get(key: string) {
              return { result: pending.get(key) };
            }
          };
        }
      };
      queueMicrotask(() => {
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
    const library: SavedLibrary = { name: 'Original', files: [] };
    assert.equal(await saveLibrary(handle, library), true);
    assert.equal(await idb.get('kv', 'root'), handle);
    assert.equal(await idb.get('kv', 'library'), library);

    for (const cause of ['quota', 'clone'] as const) {
      failure = cause;
      assert.equal(await saveLibrary(null, { name: 'Replacement', files: [] }), false);
      assert.equal(values.get('root'), handle);
      assert.equal(values.get('library'), library);
    }

    failure = null;
    const replacement: SavedLibrary = { name: 'Mobile import', files: [] };
    assert.equal(await saveLibrary(null, replacement), true);
    assert.equal(values.has('root'), false);
    assert.equal(await idb.get('kv', 'library'), replacement);

    assert.equal(await saveLibrary(handle, null), true);
    assert.equal(await idb.get('kv', 'root'), handle);
    assert.equal(values.has('library'), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
