import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLibrary, libraryFiles, walk } from '#lib/library/files.ts';
import { CoverLoader } from '#lib/library/covers.ts';
import {
  createLibraryIndex,
  connectLibraryFiles,
  idb,
  loadLibraryFile,
  readSavedLibrary,
  restoreLibraryFiles,
  saveLibrary
} from '#lib/library/storage.ts';
import type { LibraryIndex, SavedLibrary } from '#lib/library/storage.ts';
import type { LibraryDirectory, LinkedFile } from '#lib/types/library.ts';

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
  const catalog = createLibraryIndex(library, after, true);
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
  assert.equal(catalog.version, 2);
  assert.deepEqual(catalog.fileKeys, []);
  assert.equal((savedBook.files[0] as LinkedFile).source, 'folder');
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
    const audio = new File(['playable audio'], 'book.m4b', { type: 'audio/mp4' });
    let openedFiles = 0;
    const handle = {
      name: 'Original',
      async getFileHandle(name: string) {
        assert.equal(name, 'book.m4b');
        return {
          async getFile() {
            openedFiles++;
            return audio;
          }
        };
      },
      entries() {
        throw new Error('Must not rescan on launch');
      },
      queryPermission() {
        throw new Error('Storage must not prompt');
      },
      requestPermission() {
        throw new Error('Storage must not prompt');
      }
    } as unknown as LibraryDirectory;
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
    assert.equal(catalog.version, 2);
    assert.deepEqual(catalog.fileKeys, []);
    assert.deepEqual([...values.keys()].sort(), ['library-index', 'root']);
    assert.equal(openedFiles, 0);
    const book = catalog.books[0];
    const coverKey =
      book.key +
      ':' +
      JSON.stringify(
        [book.image, ...book.files.slice(0, 2), book.parentImage].map((file) =>
          file ? [file.webkitRelativePath, file.size, file.lastModified] : null
        )
      );
    // Cached misses and cached artwork must work without access to original audio.
    values.set(coverKey, { blob: null });
    const missingCover = new CoverLoader();
    assert.deepEqual(await missingCover.load(book), { url: null, author: undefined });
    missingCover.dispose();
    values.set(coverKey, { blob: new Blob(['artwork']), author: 'Author' });
    const offlineCover = new CoverLoader(false);
    const art = await offlineCover.load(book);
    assert.ok(art.url);
    assert.equal(art.author, 'Author');
    assert.equal(openedFiles, 0);
    offlineCover.dispose();
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
    connectLibraryFiles(handle);
    const file = await loadLibraryFile(catalog.books[0].files[0]);
    assert.equal(await file.text(), 'playable audio');
    assert.equal(file.webkitRelativePath, 'Original/book.m4b');
    assert.deepEqual(reads, []);
    assert.equal(openedFiles, 1);
    values.set('library', library);
    // Old copied libraries remain readable, then their blobs are removed on reimport.
    values.set('old-audio', audio);
    const oldCatalog: LibraryIndex = { ...catalog, version: 1, fileKeys: ['old-audio'] };
    values.set('library-index', oldCatalog);
    const oldFile = {
      storageKey: 'old-audio',
      name: audio.name,
      type: audio.type,
      size: audio.size,
      lastModified: audio.lastModified,
      webkitRelativePath: 'Original/book.m4b'
    };
    assert.equal(await (await loadLibraryFile(oldFile)).text(), 'playable audio');

    for (const cause of ['quota', 'clone'] as const) {
      failure = cause;
      assert.equal(await saveLibrary(null, { name: 'Replacement', files: [] }), false);
      assert.equal(values.get('root'), handle);
      assert.equal(values.get('library'), library);
      assert.equal(values.get('library-index'), oldCatalog);
      assert.equal(values.get('old-audio'), audio);
    }

    failure = null;
    const replacement: SavedLibrary = { name: 'Mobile import', files: [] };
    assert.equal(await saveLibrary(null, replacement), true);
    assert.equal(values.has('root'), false);
    assert.equal(values.has('library'), false);
    assert.equal(values.has('old-audio'), false);
    assert.equal((await idb.get<LibraryIndex>('kv', 'library-index'))?.name, replacement.name);
    await assert.rejects(loadLibraryFile(oldFile), /unavailable/);

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

test('explicit scans read metadata concurrently with a bounded batch and preserve paths', async () => {
  let active = 0;
  let peak = 0;
  const names = Array.from({ length: 19 }, (_, index) => `${index + 1}.mp3`);
  const handle = {
    name: 'Library',
    async *entries() {
      for (const name of [...names, '.hidden.mp3', 'notes.txt']) {
        yield [
          name,
          {
            kind: 'file',
            async getFile() {
              active++;
              peak = Math.max(peak, active);
              await new Promise<void>((resolve) => setImmediate(resolve));
              active--;
              return new File(['audio'], name);
            }
          }
        ];
      }
    }
  } as unknown as FileSystemDirectoryHandle;
  const files = await walk(handle);
  assert.equal(peak, 8);
  assert.equal(active, 0);
  assert.deepEqual(
    files.map((file) => file.webkitRelativePath),
    names.map((name) => 'Library/' + name)
  );
});

test('folder references open only requested files and reuse directories without scans or copies', async () => {
  const opened: string[] = [];
  let denied = true;
  const chapter = new File(['chapter bytes'], '01.mp3');
  const directory = {
    async getFileHandle(name: string) {
      opened.push(name);
      return {
        async getFile() {
          return chapter;
        }
      };
    }
  };
  const handle = {
    name: 'Library',
    async getDirectoryHandle(name: string) {
      opened.push(name);
      if (denied) throw new DOMException('Access denied', 'NotAllowedError');
      return directory;
    },
    entries() {
      throw new Error('Must not enumerate the library');
    }
  } as unknown as LibraryDirectory;
  const reference: LinkedFile = {
    source: 'folder',
    name: '01.mp3',
    type: 'audio/mpeg',
    size: chapter.size,
    lastModified: chapter.lastModified,
    webkitRelativePath: 'Library/Book/01.mp3'
  };
  connectLibraryFiles(handle);
  assert.deepEqual(opened, []);
  await assert.rejects(loadLibraryFile(reference), { name: 'NotAllowedError' });
  denied = false;
  assert.equal(await (await loadLibraryFile(reference)).text(), 'chapter bytes');
  await loadLibraryFile({
    ...reference,
    name: '02.mp3',
    webkitRelativePath: 'Library/Book/02.mp3'
  });
  assert.deepEqual(opened, ['Book', 'Book', '01.mp3', '02.mp3']);
  await assert.rejects(
    loadLibraryFile({ ...reference, webkitRelativePath: 'Other/Book/01.mp3' }),
    /does not belong/
  );
  await assert.rejects(
    loadLibraryFile({ ...reference, webkitRelativePath: 'Library/../01.mp3' }),
    /does not belong/
  );
});

test('file picker catalogues contain no audio copy and require reconnection after restart', async () => {
  const audio = new File(['original bytes'], 'book.m4b');
  Object.defineProperty(audio, 'webkitRelativePath', { value: 'Mobile/book.m4b' });
  const library = { name: 'Mobile', files: [{ file: audio, path: audio.webkitRelativePath }] };
  const catalog = createLibraryIndex(library, buildLibrary([audio]), false);
  const reference = catalog.books[0].files[0];
  assert.equal((reference as LinkedFile).source, 'picker');
  assert.deepEqual(catalog.fileKeys, []);
  connectLibraryFiles(null, [audio]);
  assert.equal(await loadLibraryFile(reference), audio);
  connectLibraryFiles(null);
  await assert.rejects(loadLibraryFile(reference), /Choose your library folder again/);
  connectLibraryFiles(null, [audio]);
  assert.equal(await (await loadLibraryFile(reference)).text(), 'original bytes');
});
