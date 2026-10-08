import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { webcrypto } from 'node:crypto';

const transpile = (code) => stripTypeScriptTypes(code, { mode: 'transform' });

async function modules(overrides = {}) {
  const context = createContext({
    crypto: webcrypto,
    URLSearchParams,
    AbortSignal,
    Response,
    URL,
    ...overrides,
  });
  const state = new SourceTextModule(
    transpile(await readFile(new URL('../src/lib/library/syncState.ts', import.meta.url), 'utf8')),
    { context },
  );
  await state.link(() => {
    throw Error('Unexpected runtime import');
  });
  await state.evaluate();
  const drive = new SourceTextModule(
    transpile(
      await readFile(new URL('../src/lib/library/googleDrive.ts', import.meta.url), 'utf8'),
    ),
    { context },
  );
  await drive.link(() => state);
  await drive.evaluate();
  return {
    state: state.namespace,
    drive: drive.namespace,
    context,
    stateModule: state,
    driveModule: drive,
  };
}
const file = (name, size = 12345, folder = 'Library/Old') => ({
  name,
  size,
  webkitRelativePath: folder + '/' + name,
  lastModified: 100,
});
const book = (files, key = 'Library/Book') => ({ key, files });
const stamp = (at, by = 'a') => ({ at, by });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('files match by basename and byte length across folder layouts and modification dates', async () => {
  const { state: s } = await modules();
  assert.equal(
    s.fileKey(file('story.m4b', 42, 'Author/Series')),
    s.fileKey({ ...file('story.m4b', 42, 'Downloads'), lastModified: 999 }),
  );
  assert.notEqual(s.fileKey(file('story.m4b', 42)), s.fileKey(file('story.m4b', 43)));
  assert.notEqual(s.fileKey(file('story.m4b', 42)), s.fileKey(file('other.m4b', 42)));
  assert.equal(s.fileKey(file('café.m4b')), s.fileKey(file('cafe\u0301.m4b')));
});

test('resume maps the actual audio file into reordered and regrouped chapters', async () => {
  const { state: s } = await modules();
  const one = file('chapter1.mp3'),
    two = file('chapter2.mp3');
  const source = book([one, two]);
  const saved = s.setProgress(s.emptyState(), source, { i: 1, t: 72, p: 0.75 }, stamp(20));
  assert.deepEqual(plain(s.bookState(saved, book([two, one], 'Downloads/Other')).progress), {
    i: 0,
    t: 72,
    p: 0.25,
  });
  assert.deepEqual(plain(s.bookState(saved, book([two])).progress), {
    i: 0,
    t: 72,
    p: 0.5,
  });
});

test('independent fields survive offline concurrent edits; removals stay removed', async () => {
  const { state: s } = await modules();
  const b = book([file('story.m4b')]);
  const a = s.setProgress(
    s.setMark(s.emptyState(), b, 'liked', true, stamp(10)),
    b,
    { i: 0, t: 50, p: 0.4 },
    stamp(30),
  );
  const other = s.setMark(
    s.setMark(s.emptyState(), b, 'liked', false, stamp(20, 'b')),
    b,
    'read',
    true,
    stamp(40, 'b'),
  );
  const merged = s.mergeState(a, other);
  const result = s.bookState(merged, b);
  assert.equal(result.progress.t, 50);
  assert.equal(result.liked, false);
  assert.equal(result.read, true);
  assert.deepEqual(plain(s.mergeState(other, a)), plain(merged));
  assert.deepEqual(plain(s.mergeState(merged, a)), plain(merged));
});

test('completion clears all chapter positions and a later replay resumes again', async () => {
  const { state: s } = await modules();
  const b = book([file('one.mp3'), file('two.mp3')]);
  const playing = s.setProgress(s.emptyState(), b, { i: 1, t: 12, p: 0.7 }, stamp(20));
  const finished = s.completeBook(playing, b, stamp(30));
  assert.equal(s.bookState(s.mergeState(finished, playing), b).progress, null);
  assert.equal(s.bookState(finished, book([b.files[0]])).read, true);
  const replay = s.setProgress(finished, b, { i: 0, t: 2, p: 0.01 }, stamp(40));
  assert.equal(s.bookState(replay, b).progress.t, 2);
});

test('equal timestamps resolve deterministically and backwards seeks are preserved', async () => {
  const { state: s } = await modules();
  const b = book([file('one.m4b')]);
  const a = s.setProgress(s.emptyState(), b, { i: 0, t: 200, p: 0.8 }, stamp(20, 'a'));
  const rewind = s.setProgress(s.emptyState(), b, { i: 0, t: 10, p: 0.04 }, stamp(20, 'z'));
  assert.equal(s.bookState(s.mergeState(a, rewind), b).progress.t, 10);
  assert.deepEqual(plain(s.mergeState(a, rewind)), plain(s.mergeState(rewind, a)));
});

test('legacy path-based records migrate without resurrecting newer deletions', async () => {
  const { state: s } = await modules();
  const b = book([file('one.m4b')]);
  const deleted = s.setMark(s.emptyState(), b, 'liked', false, stamp(20));
  const migrated = s.migrateLegacy(deleted, [b], {
    progress: { [b.key]: { i: 0, t: 50, p: 0.5 } },
    likes: { [b.key]: 1 },
    read: {},
  });
  assert.equal(s.bookState(migrated, b).liked, false);
  assert.equal(s.bookState(migrated, b).progress.t, 50);
});

test('malformed and future sync documents fail validation', async () => {
  const { state: s } = await modules();
  const key = s.fileKey(file('one.m4b'));
  for (const value of [
    null,
    [],
    { version: 2, files: {} },
    { version: 1, files: [] },
    { version: 1, files: { invalid: {} } },
    {
      version: 1,
      files: { [key]: { liked: { value: 'yes', at: 1, by: 'a' } } },
    },
    {
      version: 1,
      files: {
        [key]: {
          progress: { value: { t: -1, fraction: 0.3 }, at: 1, by: 'a' },
        },
      },
    },
    {
      version: 1,
      files: { [key]: { read: { value: true, at: Infinity, by: 'a' } } },
    },
  ])
    assert.throws(() => s.parseState(value));
});

test('Drive listing uses only appDataFolder, filters its own files and follows pagination', async () => {
  const { drive: d } = await modules();
  const calls = [];
  const api = new d.GoogleDrive('token', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(
      calls.length === 1
        ? {
            nextPageToken: 'page2',
            files: [
              { id: '1', name: d.SNAPSHOT_PREFIX + 'a.json' },
              { id: 'x', name: 'other-app.json' },
            ],
          }
        : { files: [{ id: '2', name: d.SNAPSHOT_PREFIX + 'b.json' }] },
    );
  });
  assert.deepEqual(
    plain(await api.list()).map((f) => f.id),
    ['1', '2'],
  );
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('spaces'), 'appDataFolder');
    assert.equal(call.options.headers.Authorization, 'Bearer token');
  }
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'page2');
});

test('Drive creates hidden app-data JSON and patches existing snapshots', async () => {
  const { drive: d, state: s } = await modules();
  const calls = [];
  const api = new d.GoogleDrive('token', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ id: 'created' });
  });
  const state = s.setMark(s.emptyState(), book([file('one.m4b')]), 'liked', true, stamp(20));
  assert.equal(await api.write(undefined, 'snapshot.json', state), 'created');
  assert.match(calls[0].options.body, /"parents":\["appDataFolder"\]/);
  assert.match(calls[0].options.headers['Content-Type'], /^multipart\/related; boundary=/);
  assert.ok(calls[0].options.body.includes('\r\n'));
  assert.ok(!calls[0].options.body.includes('webkitRelativePath'));
  assert.ok(!calls[0].options.body.includes('lastModified'));
  assert.equal(await api.write('created', 'snapshot.json', state), 'created');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].url.searchParams.get('uploadType'), 'media');
});

test('Drive auth, quota and network errors never report successful sync', async () => {
  const { drive: d } = await modules();
  for (const status of [401, 403, 429, 500]) {
    const api = new d.GoogleDrive('token', async () => new Response('', { status }));
    await assert.rejects(
      api.list(),
      (error) => error instanceof d.DriveError && error.status === status,
    );
  }
});

async function coordinator({
  authorize,
  fetch: request,
  storage = new Map(),
  timers = [],
  failWrites = false,
  changed = () => {},
} = {}) {
  const listeners = new Map();
  const { context, stateModule, driveModule, state, drive } = await modules({
    fetch: request,
    navigator: { onLine: true },
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      removeEventListener(name) {
        listeners.delete(name);
      },
    },
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  });
  const store = {
    keys: (prefix) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
    get: (key, fallback) => (storage.has(key) ? structuredClone(storage.get(key)) : fallback),
    set: (key, value) => {
      if (typeof failWrites === 'function' ? failWrites() : failWrites) return false;
      storage.set(key, structuredClone(value));
      return true;
    },
  };
  const mocks = new SyntheticModule(
    ['store', 'authorizeGoogle', 'forgetGoogle', 'invalidateGoogle', 'prepareGoogleAuth'],
    function () {
      this.setExport('store', store);
      this.setExport(
        'authorizeGoogle',
        authorize ?? (async () => ({ accessToken: 'token', expiresIn: 3600 })),
      );
      this.setExport('invalidateGoogle', async () => {});
      this.setExport('forgetGoogle', async () => {});
      this.setExport('prepareGoogleAuth', async () => {});
    },
    { context },
  );
  const module = new SourceTextModule(
    transpile(await readFile(new URL('../src/lib/library/sync.ts', import.meta.url), 'utf8')),
    { context },
  );
  await module.link((specifier) =>
    specifier.includes('syncState')
      ? stateModule
      : specifier.includes('googleDrive')
        ? driveModule
        : mocks,
  );
  await module.evaluate();
  let status;
  const sync = new module.namespace.LibrarySync(changed, (value) => {
    status = value;
  });
  sync.start();
  return { sync, storage, timers, state, drive, context, listeners, status: () => status };
}

function fakeDrive() {
  const files = new Map();
  let account = 'a';
  let online = true;
  let writes = 0;
  let reads = 0;
  const request = async (input, options) => {
    if (!online) throw Error('offline');
    const url = new URL(input);
    if (url.pathname.endsWith('/about'))
      return Response.json({
        user: { permissionId: account, emailAddress: account + '@example.com' },
      });
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n\r\n');
      const metadata = JSON.parse(parts[1].split('\r\n--')[0]);
      const state = JSON.parse(parts[2].split('\r\n--')[0]);
      const id = String(++writes);
      files.set(id, { id, name: metadata.name, state, account, version: 1 });
      return Response.json({ id });
    }
    const id = url.pathname.split('/').at(-1);
    if (options.method === 'PATCH') {
      files.get(id).state = JSON.parse(options.body);
      files.get(id).version++;
      return Response.json({ id });
    }
    if (url.searchParams.get('alt') === 'media') {
      reads++;
      return files.has(id) ? Response.json(files.get(id).state) : new Response('', { status: 404 });
    }
    return Response.json({
      files: [...files.values()]
        .filter((f) => f.account === account)
        .map(({ id, name, version }) => ({ id, name, version: version?.toString() })),
    });
  };
  return {
    request,
    files,
    reads: () => reads,
    setAccount: (value) => {
      account = value;
    },
    setOnline: (value) => {
      online = value;
    },
  };
}

test('two devices share progress and removals with different local paths, including offline edits', async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const b = await coordinator({ fetch: remote.request });
  const first = book([file('story.m4b', 50, 'Desktop/Series')]);
  const second = book([file('story.m4b', 50, 'Phone/Downloads')], 'Phone/Other title');
  a.sync.progress(first, { i: 0, t: 120, p: 0.25 });
  await a.sync.connect();
  await b.sync.connect();
  assert.equal(b.sync.get(second).progress.t, 120);
  b.sync.mark(second, 'liked', true);
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.sync.get(first).liked, true);
  remote.setOnline(false);
  a.sync.mark(first, 'liked', false);
  await a.sync.syncNow();
  assert.notEqual(a.status().message, 'Synced with Google Drive.');
  remote.setOnline(true);
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.sync.get(second).liked, false);
  assert.equal(remote.files.size, 2);
  a.sync.dispose();
  b.sync.dispose();
});

test("switching Google accounts never uploads the previous account's state", async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const selected = book([file('story.m4b')]);
  a.sync.mark(selected, 'liked', true);
  await a.sync.connect();
  remote.setAccount('b');
  await a.sync.connect();
  assert.equal(a.sync.get(selected).liked, false);
  assert.equal([...remote.files.values()].filter((f) => f.account === 'b').length, 0);
  a.sync.mark(selected, 'read', true);
  await a.sync.syncNow();
  const stored = [...remote.files.values()].find((f) => f.account === 'b');
  assert.equal(stored.state.files[a.state.fileKey(selected.files[0])].liked, undefined);
  remote.setAccount('a');
  await a.sync.connect();
  assert.equal(a.sync.get(selected).liked, true);
  assert.equal(a.sync.get(selected).read, false);
  a.sync.dispose();
});

test('corrupt remote data blocks upload and preserves the local queue', async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const selected = book([file('story.m4b')]);
  a.sync.mark(selected, 'liked', true);
  await a.sync.connect();
  remote.files.set('bad', {
    id: 'bad',
    name: a.drive.SNAPSHOT_PREFIX + 'broken.json',
    account: 'a',
    state: { version: 99, files: {} },
  });
  a.sync.mark(selected, 'read', true);
  await a.sync.syncNow();
  assert.match(a.status().message, /Unsupported sync data/);
  assert.equal(a.sync.get(selected).read, true);
  assert.equal(
    [...remote.files.values()][0].state.files[a.state.fileKey(selected.files[0])].read,
    undefined,
  );
  a.sync.dispose();
});

test('expired browser authorization exposes reconnect and keeps pending edits', async () => {
  const remote = fakeDrive();
  const a = await coordinator({
    fetch: remote.request,
    authorize: async (interactive) => {
      if (!interactive) throw Error('Reconnect Google Drive to continue syncing.');
      return { accessToken: 'token', expiresIn: 1 };
    },
  });
  const selected = book([file('story.m4b')]);
  a.sync.mark(selected, 'liked', true);
  await a.sync.connect();
  assert.equal(a.status().connected, false);
  assert.match(a.status().message, /Reconnect/);
  assert.equal(a.sync.get(selected).liked, true);
  a.sync.dispose();
});

test('a saved Android checkpoint cannot replace a newer remote position', async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const selected = book([file('story.m4b')]);
  a.sync.progress(selected, { i: 0, t: 500, p: 0.5 });
  await a.sync.connect();
  a.sync.recover(selected, { i: 0, t: 20, p: 0.02 }, 100, false);
  assert.equal(a.sync.get(selected).progress.t, 500);
  a.sync.recover(selected, { i: 0, t: 0, p: 0 }, 100, true);
  assert.equal(a.sync.get(selected).progress.t, 500);
  a.sync.dispose();
});

test('sync cannot upload old account data while an account switch is pending', async () => {
  const remote = fakeDrive();
  let release;
  let pending = false;
  const a = await coordinator({
    fetch: remote.request,
    authorize: async () => {
      if (pending)
        await new Promise((resolve) => {
          release = resolve;
        });
      return { accessToken: 'token', expiresIn: 3600 };
    },
  });
  const selected = book([file('story.m4b')]);
  a.sync.mark(selected, 'liked', true);
  await a.sync.connect();
  remote.setAccount('b');
  pending = true;
  const connecting = a.sync.connect();
  await a.sync.syncNow();
  assert.equal([...remote.files.values()].filter((f) => f.account === 'b').length, 0);
  release();
  await connecting;
  assert.equal(a.sync.get(selected).liked, false);
  assert.equal([...remote.files.values()].filter((f) => f.account === 'b').length, 0);
  a.sync.dispose();
});

test('fingerprints isolate colliding basenames and migrate only unambiguous legacy records', async () => {
  const { state: s } = await modules();
  const old = book([file('chapter.mp3', 100)]);
  const a = book([{ ...file('chapter.mp3', 100), fingerprint: 'sample-sha256-v1:aaa' }]);
  const b = book([{ ...file('chapter.mp3', 100), fingerprint: 'sample-sha256-v1:bbb' }]);
  const state = s.setProgress(s.emptyState(), a, { i: 0, t: 12, p: 0.2 }, stamp(5));
  assert.equal(s.bookState(state, b).progress, null);
  const legacy = s.setProgress(s.emptyState(), old, { i: 0, t: 8, p: 0.1 }, stamp(1));
  assert.equal(s.bookState(s.migrateFileIdentities(legacy, [a]), a).progress.t, 8);
  const ambiguous = s.migrateFileIdentities(legacy, [a, b]);
  assert.equal(s.bookState(ambiguous, a).progress, null);
  assert.equal(s.bookState(ambiguous, b).progress, null);
  const current = s.mergeState(legacy, s.completeBook(state, a, stamp(6)));
  assert.equal(s.bookState(s.migrateFileIdentities(current, [a]), a).progress, null);
  assert.doesNotThrow(() => s.parseState(state));
});

test('failed progress persistence exposes an error while retaining the in-memory resume position', async () => {
  const app = await coordinator({ failWrites: true });
  const story = book([file('story.mp3')]);
  app.sync.progress(story, { i: 0, t: 10, p: 0.3 });
  assert.match(app.status().message, /could not be saved/);
  assert.match(app.status().storageError, /could not be saved/);
  assert.equal(app.sync.get(story).progress.t, 10);
  assert.equal(app.storage.has('sync.state.offline'), false);
  app.sync.dispose();
});

test('local edits notify only books sharing the changed file identities', async () => {
  const changes = [];
  const app = await coordinator({ changed: (keys) => changes.push(keys) });
  const story = book([file('story.mp3')]);
  app.sync.progress(story, { i: 0, t: 10, p: 0.3 });
  assert.deepEqual(Array.from(changes.at(-1)), [app.state.fileKey(story.files[0])]);
  app.sync.dispose();
});

test('a legacy identity already claimed by one fingerprint cannot migrate to a different file later', async () => {
  const { state: s } = await modules();
  const old = book([file('chapter.mp3', 100)]);
  const a = book([{ ...file('chapter.mp3', 100), fingerprint: 'sample-sha256-v1:aaa' }]);
  const b = book([{ ...file('chapter.mp3', 100), fingerprint: 'sample-sha256-v1:bbb' }]);
  const legacy = s.setProgress(s.emptyState(), old, { i: 0, t: 8, p: 0.1 }, stamp(1));
  const migrated = s.parseState(s.migrateFileIdentities(legacy, [a]));
  assert.equal(s.bookState(s.migrateFileIdentities(migrated, [b]), b).progress, null);
  assert.equal(s.bookState(migrated, a).progress.t, 8);
});

test('Drive caches unchanged versions and downloads changed snapshots', async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const b = await coordinator({ fetch: remote.request });
  const selected = book([file('cached.m4b')]);
  a.sync.mark(selected, 'liked', true);
  await a.sync.connect();
  await b.sync.connect();
  // Populate both caches, including snapshots written during the previous sync.
  await b.sync.syncNow();
  const reads = remote.reads();
  await b.sync.syncNow();
  assert.equal(remote.reads(), reads);
  a.sync.mark(selected, 'read', true);
  await a.sync.syncNow();
  const beforeChange = remote.reads();
  await b.sync.syncNow();
  assert.equal(remote.reads(), beforeChange + 1);
  assert.equal(b.sync.get(selected).read, true);
  a.sync.dispose();
  b.sync.dispose();
});

test('per-file journals restore legacy snapshots and save only the edited audio record', async () => {
  const storage = new Map();
  const setup = await modules();
  const first = book([file('first.m4b')]);
  const second = book([file('second.m4b')]);
  const snapshot = setup.state.setMark(setup.state.emptyState(), first, 'liked', true, stamp(10));
  storage.set('sync.state.offline', plain(snapshot));
  const a = await coordinator({ storage });
  a.sync.progress(second, { i: 0, t: 42, p: 0.4 });
  assert.deepEqual(storage.get('sync.state.offline'), plain(snapshot));
  const journals = [...storage.keys()].filter((key) => key.startsWith('sync.state.offline.file.'));
  assert.equal(journals.length, 1);
  assert.equal(JSON.stringify(storage.get(journals[0])).includes('first.m4b'), false);
  const b = await coordinator({ storage });
  assert.equal(b.sync.get(first).liked, true);
  assert.equal(b.sync.get(second).progress.t, 42);
  a.sync.dispose();
  b.sync.dispose();
});

test('tabs merge journal fields and notify changes without rewriting other files', async () => {
  const storage = new Map();
  const a = await coordinator({ storage });
  const b = await coordinator({ storage });
  const selected = book([file('shared.m4b')]);
  a.sync.mark(selected, 'liked', true);
  b.sync.mark(selected, 'read', true);
  const key = [...storage.keys()].find((key) => key.includes('.file.'));
  a.listeners.get('storage')({ key: 'abl.' + key });
  assert.equal(a.sync.get(selected).liked, true);
  assert.equal(a.sync.get(selected).read, true);
  a.sync.mark(selected, 'liked', false);
  b.listeners.get('storage')({ key: 'abl.' + key });
  assert.equal(b.sync.get(selected).liked, false);
  assert.equal(b.sync.get(selected).read, true);
  const restored = await coordinator({ storage });
  assert.equal(restored.sync.get(selected).read, true);
  assert.equal(restored.sync.get(selected).liked, false);
  a.sync.dispose();
  b.sync.dispose();
  restored.sync.dispose();
});

test('reconnecting the same account preserves journal checkpoints', async () => {
  const remote = fakeDrive();
  const a = await coordinator({ fetch: remote.request });
  const selected = book([file('resume.m4b')]);
  await a.sync.connect();
  a.sync.progress(selected, { i: 0, t: 120, p: 0.5 });
  await a.sync.connect();
  assert.equal(a.sync.get(selected).progress.t, 120);
  a.sync.dispose();
});

test('failed journal checkpoints are retried with later edits and survive a restart', async () => {
  let failing = true;
  const storage = new Map();
  const a = await coordinator({ storage, failWrites: () => failing });
  const first = book([file('retry.m4b')]);
  const second = book([file('other.m4b')]);
  a.sync.progress(first, { i: 0, t: 90, p: 0.3 });
  assert.ok(a.status().storageError);
  failing = false;
  a.sync.mark(second, 'liked', true);
  assert.equal(a.status().storageError, undefined);
  const restored = await coordinator({ storage });
  assert.equal(restored.sync.get(first).progress.t, 90);
  assert.equal(restored.sync.get(second).liked, true);
  a.sync.dispose();
  restored.sync.dispose();
});
