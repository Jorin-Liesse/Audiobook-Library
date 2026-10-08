import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import { compileModule } from 'svelte/compiler';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function load(file, mocks = {}, globals = {}) {
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
        modules.set(specifier, new SyntheticModule([], function () {}, { context }));
      return modules.get(specifier);
    }
    const url = new URL(specifier, referencing?.identifier ?? new URL('../', import.meta.url));
    if (modules.has(url.href)) return modules.get(url.href);
    let source = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
    if (url.pathname.endsWith('.svelte.ts'))
      source = compileModule(source, { filename: url.pathname, generate: 'server' }).js.code;
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

async function coverFixture(read) {
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
