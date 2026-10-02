import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLibrary, folderContents, walk } from '../src/lib/library/files.ts';
import { CoverLoader } from '../src/lib/library/covers.ts';
import { store } from '../src/lib/library/storage.ts';

function file(path: string, contents: BlobPart[] = ['audio'], type = '') {
  const result = new File(contents, path.split('/').at(-1)!, { type });
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

test('empty and unsupported folders produce no books', () => {
  assert.deepEqual(buildLibrary([]), []);
  assert.deepEqual(buildLibrary([file('Library/readme.txt'), file('Library/cover.jpg')]), []);
});

test('chapter files become one book with natural ordering and the parent series', () => {
  const cover = file('Library/Series/Book_One/cover.jpg');
  const [book] = buildLibrary([
    file('Library/Series/Book_One/10.mp3'),
    file('Library/Series/Book_One/2.mp3'),
    file('Library/Series/Book_One/1.mp3'),
    cover
  ]);
  assert.equal(book.title, 'Book One');
  assert.equal(book.series, 'Series');
  assert.deepEqual(book.treePath, ['Library', 'Series']);
  assert.deepEqual(
    book.files.map((item) => item.name),
    ['1.mp3', '2.mp3', '10.mp3']
  );
  assert.equal(book.image, cover);
  assert.equal(book.chapters, 3);
});

test('several m4b files are separate books and only use matching covers', () => {
  const matched = file('Library/Series/First.JPG');
  const books = buildLibrary([
    file('Library/Series/First.m4b'),
    file('Library/Series/Second.m4b'),
    matched,
    file('Library/Series/cover.jpg')
  ]);
  assert.equal(books.length, 2);
  assert.equal(books[0].title, 'First');
  assert.equal(books[0].image, matched);
  assert.equal(books[1].image, null);
  assert.equal(books[1].parentImage, null);
});

test('one file in a nested book folder uses the folder title and parent cover fallback', () => {
  const parentCover = file('Library/Series/front.png');
  const [book] = buildLibrary([file('Library/Series/Book_Name/recording.m4b'), parentCover]);
  assert.equal(book.title, 'Book Name');
  assert.equal(book.series, 'Series');
  assert.equal(book.image, null);
  assert.equal(book.parentImage, parentCover);
});

test('mixed m4b and chapter files follow the supplied grouping rules', () => {
  const books = buildLibrary([
    file('Library/Series/1.mp3'),
    file('Library/Series/2.mp3'),
    file('Library/Series/Other.m4b')
  ]);
  assert.deepEqual(
    books.map((book) => [book.title, book.files.length]),
    [
      ['Series', 2],
      ['Other', 1]
    ]
  );
});

test('hidden files and hidden subfolders are ignored; MIME audio is accepted', () => {
  const books = buildLibrary([
    file('Library/._junk.mp3'),
    file('Library/.hidden/Book.m4b'),
    file('Library/Story.xyz', ['data'], 'audio/mpeg')
  ]);
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Story');
});

test('folder navigation skips single-child levels and keeps books beside subfolders', () => {
  const books = buildLibrary([
    file('Library/Fantasy/Series/First.m4b'),
    file('Library/Fantasy/Series/Second.m4b'),
    file('Library/Fantasy/Standalone.m4b'),
    file('Library/Fantasy/Standalone2.m4b'),
    file('Library/Fiction/Other.m4b'),
    file('Library/Fiction/Another.m4b')
  ]);
  const root = folderContents(books, []);
  assert.deepEqual(
    root.folders.map((folder) => folder.name),
    ['Fantasy', 'Fiction']
  );
  const fantasy = folderContents(books, root.folders[0].path);
  assert.deepEqual(
    fantasy.crumbs.map((crumb) => crumb.label),
    ['Library', 'Fantasy']
  );
  assert.equal(fantasy.books[0].title, 'Standalone');
  assert.equal(fantasy.folders[0].name, 'Series');
  assert.equal(fantasy.folders[0].books.length, 2);
  const series = folderContents(books, fantasy.folders[0].path);
  assert.equal(series.books.length, 2);
  // Filtering can remove the saved branch without breaking navigation.
  const filtered = books.filter((book) => book.treePath.includes('Fiction'));
  assert.deepEqual(
    folderContents(filtered, fantasy.folders[0].path).books.map((book) => book.title),
    ['Another', 'Other']
  );
});

test('keys stay stable when the picker returns files in a different order', () => {
  const files = [file('Library/Series/Book/2.mp3'), file('Library/Series/Book/1.mp3')];
  assert.equal(buildLibrary(files)[0].key, buildLibrary([...files].reverse())[0].key);
});

test('directory handle scanning recurses and only reads supported non-hidden files', async () => {
  const accessed: string[] = [];
  const directory = (name: string, children: object[]) => ({
    name,
    kind: 'directory',
    async *entries() {
      for (const child of children) yield [(child as { name: string }).name, child];
    }
  });
  const handle = (name: string) => ({
    name,
    kind: 'file',
    async getFile() {
      accessed.push(name);
      return new File(['data'], name);
    }
  });
  const root = directory('Library', [
    directory('Series', [handle('book.m4b'), handle('cover.jpg'), handle('notes.txt')]),
    directory('.hidden', [handle('ignored.mp3')]),
    handle('._junk.mp3')
  ]);
  const files = await walk(root as unknown as FileSystemDirectoryHandle);
  assert.deepEqual(accessed, ['book.m4b', 'cover.jpg']);
  assert.deepEqual(
    files.map((item) => item.webkitRelativePath),
    ['Library/Series/book.m4b', 'Library/Series/cover.jpg']
  );
});

// Exercise the actual browser metadata bundle with a minimal FileReader adapter.
Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout } });
Object.defineProperty(globalThis, 'FileReader', {
  configurable: true,
  value: class {
    result: ArrayBuffer | null = null;
    onloadend?: () => void;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  }
});

const picture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
function taggedAudio(path: string) {
  const frame = (name: string, data: Buffer) => {
    const header = Buffer.alloc(10);
    header.write(name);
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  };
  const frames = Buffer.concat([
    frame('TPE1', Buffer.from('\0Recorded Author')),
    frame('APIC', Buffer.concat([Buffer.from('\0image/png\0\x03\0'), picture]))
  ]);
  const header = Buffer.from([
    73,
    68,
    51,
    3,
    0,
    0,
    (frames.length >> 21) & 127,
    (frames.length >> 14) & 127,
    (frames.length >> 7) & 127,
    frames.length & 127
  ]);
  return file(path, [header, frames, Buffer.alloc(256)], 'audio/mpeg');
}

test('cover lookup prefers a folder image, shares requests, and revokes URLs on disposal', async () => {
  const image = file('Library/Book/cover.png', [picture], 'image/png');
  const [book] = buildLibrary([taggedAudio('Library/Book/audio.mp3'), image]);
  const loader = new CoverLoader();
  const first = loader.load(book);
  assert.equal(first, loader.load(book));
  const result = await first;
  assert.ok(result.url);
  assert.deepEqual(Buffer.from(await (await fetch(result.url)).arrayBuffer()), picture);
  loader.dispose();
  await assert.rejects(fetch(result.url));
  assert.equal((await loader.load(book)).url, null);
});

test('embedded art in the second chapter wins over an image in the parent folder', async () => {
  const [book] = buildLibrary([
    file('Library/Series/Book/1.mp3', [Buffer.alloc(256)]),
    taggedAudio('Library/Series/Book/2.mp3'),
    file('Library/Series/cover.jpg', ['parent image'])
  ]);
  const loader = new CoverLoader();
  const result = await loader.load(book);
  assert.ok(result.url);
  assert.equal(result.author, 'Recorded Author');
  const response = await fetch(result.url);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture);
  loader.dispose();
});

test('parent cover is the last fallback when audio has no art', async () => {
  const [book] = buildLibrary([
    file('Library/Series/Book/1.mp3', [Buffer.alloc(256)]),
    file('Library/Series/cover.jpg', ['parent image'])
  ]);
  const loader = new CoverLoader();
  const result = await loader.load(book);
  assert.ok(result.url);
  assert.equal(await (await fetch(result.url)).text(), 'parent image');
  loader.dispose();
});

test('disposing a loader before a read finishes prevents stale object URLs', async () => {
  const [book] = buildLibrary([taggedAudio('Library/Book/recording.mp3')]);
  const loader = new CoverLoader();
  const pending = loader.load(book);
  loader.dispose();
  assert.equal((await pending).url, null);
});

test('settings round-trip and gracefully handle corrupt data or blocked storage', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
  store.set('view', 'folders');
  assert.equal(store.get('view', 'series'), 'folders');
  store.set('progress', { book: { i: 1, t: 12.5, p: 0.4 } });
  assert.deepEqual(store.get('progress', {}), { book: { i: 1, t: 12.5, p: 0.4 } });
  values.set('abl.progress', 'null');
  assert.deepEqual(store.get('progress', {}), {});
  values.set('abl.progress', '[]');
  assert.deepEqual(store.get('progress', {}), {});
  values.set('abl.view', 'broken JSON');
  assert.equal(store.get('view', 'series'), 'series');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    }
  });
  assert.equal(store.get('view', 'series'), 'series');
  assert.doesNotThrow(() => store.set('view', 'az'));
});
