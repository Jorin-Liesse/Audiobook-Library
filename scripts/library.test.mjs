import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import { compileModule } from 'svelte/compiler';
// eslint-disable-next-line svelte/no-svelte-internal -- Evaluate generated rune modules against their compiler runtime.
import * as svelteServer from 'svelte/internal/server';
// eslint-disable-next-line svelte/no-svelte-internal -- Exercise reactive controller behavior without a browser.
import * as svelteClient from 'svelte/internal/client';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function load(file, mocks = {}, globals = {}, generate = 'server') {
  const context = createContext({
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    Blob,
    File,
    URL,
    AbortSignal,
    Response,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  const modules = new Map();
  async function moduleFor(specifier, referencing) {
    if (Object.hasOwn(mocks, specifier)) {
      if (!modules.has(specifier)) {
        const values = mocks[specifier];
        modules.set(
          specifier,
          new SyntheticModule(
            Object.keys(values),
            function () {
              for (const [key, value] of Object.entries(values)) this.setExport(key, value);
            },
            { context },
          ),
        );
      }
      return modules.get(specifier);
    }
    if (specifier === 'svelte/internal/server') {
      if (!modules.has(specifier))
        modules.set(
          specifier,
          new SyntheticModule(
            Object.keys(svelteServer),
            function () {
              for (const [key, value] of Object.entries(svelteServer)) this.setExport(key, value);
            },
            { context },
          ),
        );
      return modules.get(specifier);
    }
    const url = specifier.startsWith('#lib/')
      ? new URL('../src/lib/' + specifier.slice(5), import.meta.url)
      : new URL(specifier, referencing?.identifier ?? new URL('../', import.meta.url));
    if (modules.has(url.href)) return modules.get(url.href);
    let source = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
    if (url.pathname.endsWith('.svelte.ts'))
      source = compileModule(source, { filename: url.pathname, generate }).js.code;
    const module = new SourceTextModule(source, {
      context,
      identifier: url.href,
      importModuleDynamically: async (name, parent) => {
        const dependency = await moduleFor(name, parent);
        if (dependency.status === 'unlinked') await dependency.link(moduleFor);
        if (dependency.status === 'linked') await dependency.evaluate();
        return dependency;
      },
    });
    modules.set(url.href, module);
    await module.link(moduleFor);
    return module;
  }
  const module = await moduleFor('./' + file);
  await module.evaluate();
  return module.namespace;
}

const native = {
  isNativeFile: (file) => file.source === 'native',
  nativeFileUrl: async () => 'http://media/file',
};
const metadata = {
  name: 'story.mp3',
  type: 'audio/mpeg',
  size: 100,
  lastModified: 1,
  webkitRelativePath: 'Library/story.mp3',
};

test('near-zero progress stays not started, with an exact 0.1% boundary and saved resume intact', async () => {
  const { hasStarted, filterBooks } = await load('src/lib/library/views.ts');
  const values = [0, 0.0001, 0.0005, 0.000999, 0.001, 0.8];
  const books = values.map((p, i) => ({
    id: String(i),
    title: 'Story',
    started: hasStarted(p),
    progress: Math.round(p * 100),
    read: false,
  }));
  assert.deepEqual(
    Array.from(filterBooks(books, '', 'new'), (b) => b.id),
    ['0', '1', '2', '3'],
  );
  assert.deepEqual(
    Array.from(filterBooks(books, '', 'progress'), (b) => b.id),
    ['4', '5'],
  );
  books[0].read = true;
  assert.equal(filterBooks(books, '', 'new').length, 3);
  assert.equal(filterBooks(books, '', 'read').length, 1);
});

test('content fingerprints distinguish equal-size files and stay portable', async () => {
  const { contentFingerprint } = await load('src/lib/library/fingerprints.ts', {
    './storage.ts': { loadLibraryFile: async (file) => file },
    './native.ts': native,
  });
  const first = new Blob([new Uint8Array(500000).fill(1)]);
  const second = new Blob([new Uint8Array(500000).fill(2)]);
  let bytes = 0;
  const fingerprint = await contentFingerprint(first.size, async (start, end) => {
    bytes += end - start;
    return first.slice(start, end).arrayBuffer();
  });
  const copied = await contentFingerprint(first.size, (start, end) =>
    first.slice(start, end).arrayBuffer(),
  );
  const other = await contentFingerprint(second.size, (start, end) =>
    second.slice(start, end).arrayBuffer(),
  );
  assert.equal(fingerprint, copied);
  assert.notEqual(fingerprint, other);
  assert.equal(bytes, 3 * 65536);
  await assert.rejects(
    contentFingerprint(100, async () => new ArrayBuffer(99)),
    /changed/,
  );
});

test('native fingerprinting requires byte ranges and never consumes a whole-file response', async () => {
  let cancelled = false;
  const { fingerprintFiles } = await load(
    'src/lib/library/fingerprints.ts',
    {
      './storage.ts': {
        loadLibraryFile() {
          throw Error('unexpected');
        },
      },
      './native.ts': native,
    },
    {
      fetch: async () => ({
        status: 200,
        headers: new Headers(),
        body: {
          cancel: async () => {
            cancelled = true;
          },
        },
        arrayBuffer() {
          throw Error('whole file consumed');
        },
      }),
    },
  );
  await assert.rejects(
    fingerprintFiles([{ ...metadata, source: 'native', location: 'content://file' }]),
    /could not be identified/,
  );
  assert.equal(cancelled, true);
});

test('a player close waits for the final checkpoint before stopping Android', async () => {
  const calls = [];
  let finishFlush;
  const { createPlaybackController } = await load('src/lib/library/playback.svelte.ts', {
    './androidAudio.ts': {
      isAndroidApp: () => true,
      androidAudio: { stop: async () => calls.push('stop') },
    },
    './storage.ts': { store: { set: () => true } },
  });
  const controller = createPlaybackController({
    ensureAccess: async () => true,
    savedProgress: () => null,
    progress() {},
    finish() {},
    error() {},
  });
  const book = { id: 'a', key: 'a', files: [metadata] };
  controller.restore(book, 0, 4);
  controller.player = {
    flush: () =>
      new Promise((resolve) => {
        finishFlush = () => {
          calls.push('saved');
          resolve();
        };
      }),
  };
  const closing = controller.closePlayer();
  assert.deepEqual(calls, []);
  assert.equal(controller.playback.bookId, 'a');
  finishFlush();
  await closing;
  assert.deepEqual(calls, ['saved', 'stop']);
  assert.equal(controller.playback, null);
});

test('rapid book changes keep the latest request even when permission resolves out of order', async () => {
  const gates = [];
  const { createPlaybackController } = await load('src/lib/library/playback.svelte.ts', {
    './androidAudio.ts': { isAndroidApp: () => false, androidAudio: {} },
    './storage.ts': { store: { set: () => true } },
  });
  const controller = createPlaybackController({
    ensureAccess: () => new Promise((resolve) => gates.push(resolve)),
    savedProgress: () => ({ i: 0, t: 8, p: 0.001 }),
    progress() {},
    finish() {},
    error() {},
  });
  const a = controller.openBook({ id: 'a', key: 'a', files: [metadata] });
  const b = controller.openBook({ id: 'b', key: 'b', files: [metadata] });
  gates[1](true);
  await b;
  gates[0](true);
  await a;
  assert.equal(controller.playback.bookId, 'b');
  assert.equal(controller.playback.startTime, 8);
});

test('storage reports write failure and reuses parsed snapshots until another tab changes them', async () => {
  let raw = '{"value":1}';
  let fail = false;
  const { store } = await load(
    'src/lib/library/storage.ts',
    { './native.ts': native },
    {
      localStorage: {
        getItem: () => raw,
        setItem: (_key, value) => {
          if (fail) throw Error('quota');
          raw = value;
        },
      },
    },
  );
  const first = store.get('key', {});
  assert.equal(store.get('key', {}), first);
  raw = '{"value":2}';
  assert.notEqual(store.get('key', {}), first);
  assert.equal(store.set('key', { value: 3 }), true);
  fail = true;
  assert.equal(store.set('key', { value: 4 }), false);
  assert.equal(store.get('key', {}).value, 3);
});

async function coverFixture(read, globals = {}) {
  const cached = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const { CoverLoader } = await load(
    'src/lib/library/covers.ts',
    {
      './storage.ts': {
        idb: {
          get: async (_store, key) => cached.get(key),
          set: async (_store, key, value) => cached.set(key, value),
        },
        loadLibraryFile: async (file) => file,
        pruneCoverCache: async () => {},
      },
      './native.ts': native,
      'jsmediatags/dist/jsmediatags.min.js': { default: { read } },
    },
    {
      window: {
        setTimeout: (callback) => {
          timers.set(++nextTimer, callback);
          return nextTimer;
        },
      },
      clearTimeout: (id) => timers.delete(id),
      ...globals,
    },
  );
  const book = { key: 'Library/Story', files: [metadata], image: null, parentImage: null };
  return { CoverLoader, book, cached, timers };
}

test('transient cover errors are retried on the next load while confirmed missing art is cached', async () => {
  let calls = 0;
  let failing = true;
  const fixture = await coverFixture((_file, callbacks) => {
    calls++;
    if (failing) callbacks.onError();
    else callbacks.onSuccess({ tags: {} });
  });
  await new fixture.CoverLoader().load(fixture.book);
  assert.equal(fixture.cached.size, 0);
  failing = false;
  await new fixture.CoverLoader().load(fixture.book);
  assert.equal(calls, 2);
  assert.equal(fixture.cached.size, 1);
  await new fixture.CoverLoader().load(fixture.book);
  assert.equal(calls, 2);
});

test('cover tag timeouts release the queue without permanently caching missing artwork', async () => {
  const fixture = await coverFixture(() => {});
  const result = new fixture.CoverLoader().load(fixture.book);
  for (let i = 0; i < 5 && !fixture.timers.size; i++)
    await new Promise((resolve) => setImmediate(resolve));
  for (const expire of fixture.timers.values()) expire();
  assert.equal((await result).url, null);
  assert.equal(fixture.cached.size, 0);
});

test('native and browser files receive the same fingerprint from the same bytes', async () => {
  const bytes = new Uint8Array(100).fill(7);
  const { fingerprintFiles } = await load(
    'src/lib/library/fingerprints.ts',
    { './storage.ts': { loadLibraryFile: async (file) => file }, './native.ts': native },
    {
      fetch: async () => new Response(bytes, { status: 206 }),
    },
  );
  const browserFile = new File([bytes], 'story.mp3', { type: 'audio/mpeg' });
  const nativeFile = { ...metadata, source: 'native', location: 'content://file' };
  await fingerprintFiles([browserFile, nativeFile]);
  assert.equal(browserFile.fingerprint, nativeFile.fingerprint);
});

test('a failed fingerprint batch never publishes partially migrated identities', async () => {
  const { fingerprintFiles } = await load(
    'src/lib/library/fingerprints.ts',
    { './storage.ts': { loadLibraryFile: async (file) => file }, './native.ts': native },
    {
      fetch: async () => new Response('', { status: 404 }),
    },
  );
  const good = new File([new Uint8Array(100)], 'good.mp3', { type: 'audio/mpeg' });
  const bad = { ...metadata, source: 'native', location: 'content://missing' };
  await assert.rejects(fingerprintFiles([good, bad]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(good.fingerprint, undefined);
  assert.equal(bad.fingerprint, undefined);
});

test('a failed Android stop reports an error and retains the player for retry', async () => {
  let error = '';
  const { createPlaybackController } = await load('src/lib/library/playback.svelte.ts', {
    './androidAudio.ts': {
      isAndroidApp: () => true,
      androidAudio: {
        stop: async () => {
          throw Error('service');
        },
      },
    },
    './storage.ts': { store: { set: () => true } },
  });
  const controller = createPlaybackController({
    ensureAccess: async () => true,
    savedProgress: () => null,
    progress() {},
    finish() {},
    error: (value) => {
      error = value;
    },
  });
  controller.restore({ id: 'a', key: 'a', files: [metadata] }, 0);
  assert.equal(await controller.closePlayer(), false);
  assert.equal(controller.playback.bookId, 'a');
  assert.match(error, /could not be stopped/);
});

test('refresh fingerprints are reused only when location, size and modification time match', async () => {
  const { reuseFingerprints } = await load('src/lib/library/fingerprints.ts', {
    './native.ts': native,
    './storage.ts': { loadLibraryFile: async (file) => file },
  });
  const saved = { ...metadata, fingerprint: 'saved' };
  const unchanged = { ...metadata };
  const modified = { ...metadata, lastModified: 2 };
  const resized = { ...metadata, size: 101 };
  const renamed = { ...metadata, webkitRelativePath: 'Other/story.mp3' };
  const unknown = { ...metadata, lastModified: 0 };
  reuseFingerprints([unchanged, modified, resized, renamed, unknown], [saved]);
  assert.equal(unchanged.fingerprint, 'saved');
  for (const file of [modified, resized, renamed, unknown])
    assert.equal(file.fingerprint, undefined);
  const oldNative = { ...saved, source: 'native', location: 'content://old' };
  const newNative = { ...metadata, source: 'native', location: 'content://new' };
  reuseFingerprints([newNative], [oldNative]);
  assert.equal(newNative.fingerprint, undefined);
});

test('folder navigation retains sorted summaries, counts all descendants and recovers invalid paths', async () => {
  const { buildFolderTree, folderContents } = await load('src/lib/library/files.ts');
  const books = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    title: 'Book ' + (12 - index),
    treePath: ['Library', index < 10 ? 'Series' : 'Other'],
  }));
  const tree = buildFolderTree(books);
  const home = folderContents(tree, []);
  assert.equal(home.crumbs[0].label, 'Library');
  const series = home.folders.find((folder) => folder.name === 'Series');
  assert.equal(series.count, 10);
  assert.deepEqual(
    Array.from(series.books, (book) => book.title),
    ['Book 3', 'Book 4', 'Book 5', 'Book 6'],
  );
  const inside = folderContents(tree, series.path);
  assert.equal(inside.books.length, 10);
  assert.equal(inside.books, tree.folders.get('Library').folders.get('Series').books);
  assert.equal(folderContents(tree, [...series.path, 'missing']).books, inside.books);
  assert.equal(home.folders[0].name, 'Other');
});

test('seek coalescing keeps the latest queued position and flush waits for it', async () => {
  const { createLatestTask } = await load('src/lib/library/latestTask.ts');
  const calls = [];
  let release;
  const seeks = createLatestTask(async (position) => {
    calls.push(position);
    if (calls.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
  });
  seeks.schedule(1);
  const flushed = seeks.flush();
  for (let position = 2; position <= 100; position++) seeks.schedule(position);
  assert.deepEqual(calls, [1]);
  release();
  await flushed;
  assert.deepEqual(calls, [1, 100]);
  seeks.schedule(200);
  seeks.cancel();
  await seeks.flush();
  assert.deepEqual(calls, [1, 100]);
});

test('cover URLs survive shared usage and are revoked after the final card releases them', async () => {
  const revoked = [];
  let calls = 0;
  const fixture = await coverFixture(
    (_file, callbacks) => {
      calls++;
      callbacks.onSuccess({ tags: { picture: { data: [1, 2], format: 'image/jpeg' } } });
    },
    { URL: { createObjectURL: () => 'blob:cover', revokeObjectURL: (url) => revoked.push(url) } },
  );
  const loader = new fixture.CoverLoader();
  const releaseCard = loader.retain(fixture.book);
  const releasePlayer = loader.retain(fixture.book);
  await loader.load(fixture.book);
  releaseCard();
  await Promise.resolve();
  assert.deepEqual(revoked, []);
  releasePlayer();
  await Promise.resolve();
  assert.deepEqual(revoked, ['blob:cover']);
  const releaseAgain = loader.retain(fixture.book);
  await loader.load(fixture.book);
  assert.equal(calls, 1, 'Reopening a card reuses its persistent thumbnail');
  releaseAgain();
  loader.dispose();
});

test('thumbnail generation bounds dimensions and releases the decoded bitmap', async () => {
  let dimensions;
  let closed = false;
  const thumbnail = new Blob(['small']);
  const { coverThumbnail } = await load(
    'src/lib/library/thumbnails.ts',
    {},
    {
      createImageBitmap: async () => ({
        width: 2048,
        height: 1024,
        close() {
          closed = true;
        },
      }),
      document: {
        createElement: () => ({
          getContext: () => ({
            drawImage(_image, _x, _y, width, height) {
              dimensions = [width, height];
            },
          }),
          toBlob: (callback) => callback(thumbnail),
        }),
      },
    },
  );
  assert.equal(await coverThumbnail(new Blob(['large'])), thumbnail);
  assert.deepEqual(dimensions, [512, 256]);
  assert.equal(closed, true);
});

test('covers share one visibility observer and disconnect after the final card', async () => {
  const observers = [];
  class Observer {
    targets = new Set();
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const { observeNearViewport } = await load(
    'src/lib/library/visibility.ts',
    {},
    { IntersectionObserver: Observer },
  );
  const first = {},
    second = {};
  let loads = 0;
  const disposeFirst = observeNearViewport(first, () => loads++);
  const disposeSecond = observeNearViewport(second, () => loads++);
  assert.equal(observers.length, 1);
  observers[0].callback([
    { target: first, isIntersecting: true },
    { target: second, isIntersecting: false },
  ]);
  assert.equal(loads, 1);
  disposeFirst();
  assert.equal(observers[0].disconnected, undefined);
  disposeSecond();
  assert.equal(observers[0].disconnected, true);
});

async function libraryController(prepareLibrary, reactive = false) {
  const cover = {
    COVER_CONTEXT: Symbol(),
    CoverLoader: class {
      dispose() {}
    },
  };
  const { createLibraryController } = await load(
    'src/lib/library/controller.svelte.ts',
    {
      'svelte/internal/client': svelteClient,
      svelte: { onMount() {}, setContext() {}, tick: async () => {} },
      '#lib/library/covers.ts': cover,
      '#lib/library/sync.ts': { LibrarySync: class {} },
      '#lib/library/native.ts': {
        ...native,
        isNativeApp: () => false,
        chooseNativeLibrary() {},
        refreshNativeLibrary() {},
        checkNativeAccess() {},
      },
      '#lib/library/restoration.ts': { readLibraryRestoreState() {}, recoverNativePlayback() {} },
      '#lib/library/fingerprints.ts': { fingerprintFiles() {} },
      '#lib/library/imports.ts': { prepareLibrary },
      '#lib/library/playback.svelte.ts': {
        createPlaybackController: () => ({ clear() {}, closePlayer: async () => true }),
      },
      '#lib/library/storage.ts': {
        connectLibraryFiles() {},
        requestPersistentStorage() {},
        restoreLibraryFiles() {},
        saveLibrary: async () => true,
        store: { get: (_key, fallback) => fallback },
      },
    },
    { window: { scrollTo() {} } },
    reactive ? 'client' : 'server',
  );
  if (!reactive) return createLibraryController();
  let controller;
  const dispose = svelteClient.effect_root(() => {
    controller = createLibraryController();
  });
  return Object.assign(controller, { dispose });
}

test('continuous scrolling appends sorted books and resets for search, views, folders and imports', async (t) => {
  const catalog = Array.from({ length: 220 }, (_, index) => ({
    id: String(index),
    key: String(index),
    title: 'Story ' + String(index).padStart(3, '0'),
    series: index % 2 ? 'B' : 'A',
    treePath: [index % 2 ? 'Beta' : 'Alpha'],
    files: [{ ...metadata, name: index + '.mp3' }],
  })).reverse();
  const controller = await libraryController(
    async () => ({ name: 'Library', handle: null, files: [metadata], books: catalog }),
    true,
  );
  t.after(controller.dispose);
  const event = { currentTarget: { files: [{ ...metadata }] } };
  await controller.loadPickedFiles(event);
  assert.equal(controller.error, '');
  const ids = () => Array.from(controller.renderedBooks, (book) => book.id);
  const expected = [
    ...Array.from({ length: 110 }, (_, i) => String(i * 2)),
    ...Array.from({ length: 110 }, (_, i) => String(i * 2 + 1)),
  ];
  assert.deepEqual(ids(), expected.slice(0, 96));
  assert.equal(controller.hasMore, true);
  controller.loadMore();
  assert.deepEqual(ids(), expected.slice(0, 192));
  controller.loadMore();
  assert.deepEqual(ids(), expected);
  assert.equal(controller.hasMore, false);
  controller.loadMore();
  assert.deepEqual(ids(), expected);

  controller.query = 'Story';
  assert.equal(controller.renderedBooks.length, 96);
  controller.loadMore();
  controller.query = 'Story';
  assert.equal(controller.renderedBooks.length, 192);
  controller.view = 'az';
  assert.deepEqual(
    ids(),
    Array.from({ length: 96 }, (_, i) => String(i)),
  );
  controller.loadMore();
  controller.filter = 'new';
  assert.equal(controller.renderedBooks.length, 96);

  controller.view = 'folders';
  controller.navigateFolder(['Alpha']);
  assert.deepEqual(ids(), expected.slice(0, 96));
  controller.loadMore();
  assert.deepEqual(ids(), expected.slice(0, 110));
  assert.equal(controller.hasMore, false);
  controller.navigateFolder(['Beta']);
  assert.deepEqual(ids(), expected.slice(110, 206));
  assert.equal(controller.hasMore, true);
  controller.query = 'missing';
  assert.equal(controller.renderedBooks.length, 0);
  assert.equal(controller.hasMore, false);
  controller.clearFilters();
  assert.equal(controller.renderedBooks.length, 96);

  controller.view = 'series';
  controller.loadMore();
  await controller.loadPickedFiles(event);
  assert.deepEqual(ids(), expected.slice(0, 96));
});

test('fallback import failures clear loading and allow a later retry', async () => {
  let attempts = 0;
  const controller = await libraryController(async () => {
    attempts++;
    throw Error('Unreadable audio');
  });
  const event = { currentTarget: { files: [{ ...metadata }] } };
  await controller.loadPickedFiles(event);
  assert.equal(controller.loading, false);
  assert.match(controller.error, /could not be read/);
  await controller.loadPickedFiles(event);
  assert.equal(attempts, 2);
  assert.equal(controller.loading, false);
});

test('cover cache pruning keeps recent artwork within both count and byte limits', async () => {
  const entries = new Map([
    ['old', { checkedAt: 1, blob: new Blob(['12']) }],
    ['large', { checkedAt: 2, blob: new Blob(['12345']) }],
    ['new', { checkedAt: 3, blob: new Blob(['12']) }],
  ]);
  const db = {
    transaction() {
      const tx = {
        objectStore: () => ({
          delete: (key) => entries.delete(key),
          openCursor() {
            const request = {};
            const items = [...entries];
            let index = 0;
            const next = () =>
              queueMicrotask(() => {
                const item = items[index++];
                request.result = item ? { key: item[0], value: item[1], continue: next } : null;
                request.onsuccess();
                if (!item) queueMicrotask(() => tx.oncomplete());
              });
            next();
            return request;
          },
        }),
      };
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = { result: db };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  const { pruneCoverCache } = await load(
    'src/lib/library/storage.ts',
    { './native.ts': native },
    { indexedDB },
  );
  await pruneCoverCache(2, 4);
  assert.deepEqual([...entries.keys()].sort(), ['new', 'old']);
  await pruneCoverCache(1, 4);
  assert.deepEqual([...entries.keys()], ['new']);
});
