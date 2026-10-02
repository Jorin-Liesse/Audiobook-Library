<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import BookCard from '#lib/components/BookCard.svelte';
  import BookSection from '#lib/components/BookSection.svelte';
  import FolderTile from '#lib/components/FolderTile.svelte';
  import LibraryToolbar from '#lib/components/LibraryToolbar.svelte';
  import LibraryEmptyState from '#lib/components/LibraryEmptyState.svelte';
  import AudioPlayer from '#lib/components/AudioPlayer.svelte';
  import {
    buildLibrary,
    collator,
    folderContents,
    libraryFiles,
    sortKey,
    walk
  } from '#lib/library/files.ts';
  import { COVER_CONTEXT, CoverLoader, type LoadCover } from '#lib/library/covers.ts';
  import {
    connectLibraryFiles,
    readSavedLibrary,
    requestPersistentStorage,
    restoreLibraryFiles,
    saveLibrary,
    store
  } from '#lib/library/storage.ts';
  import type {
    Book,
    BookProgress,
    LibraryDirectory,
    LibraryFilter,
    LibraryView,
    Playback
  } from '#lib/types/library.ts';

  let books = $state<Book[]>([]);
  let view = $state<LibraryView>('series');
  let filter = $state<LibraryFilter>('all');
  let query = $state('');
  let folderPath = $state<string[]>([]);
  let savedHandle = $state<LibraryDirectory | null>(null);
  let accessNeeded = $state(false);
  let libraryName = $state('');
  let loading = $state(false);
  let error = $state('');
  let ready = $state(false);
  let progress = $state<Record<string, BookProgress>>({});
  let likes = $state<Record<string, number>>({});
  let read = $state<Record<string, number>>({});
  let playback = $state<Playback | null>(null);
  let player = $state<{ flush: () => void }>();
  let folderInput: HTMLInputElement;
  let coverLoader = new CoverLoader();
  let scanToken = 0;
  let playbackToken = 0;

  setContext<LoadCover>(COVER_CONTEXT, async (book) => {
    const loader = coverLoader;
    const result = await loader.load(book);
    if (loader !== coverLoader) return;
    book.coverUrl = result.url;
    if (result.author) book.author = result.author;
  });

  const selectedBook = $derived(books.find((book) => book.id === playback?.bookId));
  const visibleBooks = $derived(
    books.filter((book) => {
      const term = query.trim().toLowerCase();
      const matchesSearch =
        !term ||
        book.title.toLowerCase().includes(term) ||
        book.series?.toLowerCase().includes(term);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'liked' && book.liked) ||
        (filter === 'progress' && book.started && !book.read) ||
        (filter === 'new' && !book.started && !book.read) ||
        (filter === 'read' && book.read);
      return matchesSearch && matchesFilter;
    })
  );

  function groupBooks(list: Book[]) {
    const groups = new SvelteMap<string, Book[]>();
    for (const book of list) {
      const letter = sortKey(book.title).charAt(0).toUpperCase();
      const name =
        view === 'series' ? (book.series ?? 'Standalone') : /^[A-Z]$/.test(letter) ? letter : '#';
      groups.set(name, [...(groups.get(name) ?? []), book]);
    }
    return [...groups]
      .sort(([a], [b]) => {
        if (a === b) return 0;
        if (view === 'series' && a === 'Standalone') return 1;
        if (view === 'series' && b === 'Standalone') return -1;
        return collator.compare(sortKey(a), sortKey(b));
      })
      .map(([name, items]) => ({
        name,
        books: items.sort((a, b) =>
          collator.compare(
            view === 'series' && a.series ? a.title : sortKey(a.title),
            view === 'series' && b.series ? b.title : sortKey(b.title)
          )
        )
      }));
  }
  const sections = $derived(groupBooks(visibleBooks));
  const folders = $derived(folderContents(visibleBooks, folderPath));

  $effect(() => {
    if (ready) store.set('view', view);
  });

  function savedProgress(book: Book) {
    const saved = progress[book.key];
    if (
      !saved ||
      !Number.isInteger(saved.i) ||
      saved.i < 0 ||
      saved.i >= book.files.length ||
      !Number.isFinite(saved.t) ||
      saved.t < 0
    )
      return null;
    return saved;
  }

  function hydrate(book: Book) {
    const saved = savedProgress(book);
    book.started = !!saved;
    book.progress = saved
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((Number.isFinite(saved.p) ? saved.p : saved.i / book.files.length) * 100)
          )
        )
      : 0;
    book.liked = !!likes[book.key];
    book.read = !!read[book.key];
    return book;
  }

  function startBook(book: Book, index: number, startTime = 0, autoplay = true) {
    if (index < 0 || index >= book.files.length) return;
    player?.flush();
    playback = { bookId: book.id, index, startTime, autoplay, token: ++playbackToken };
  }

  async function openBook(book: Book) {
    if (!(await ensureLibraryAccess())) return;
    player?.flush();
    const saved = savedProgress(book);
    startBook(book, saved?.i ?? 0, saved?.t ?? 0);
  }

  function closePlayer() {
    player?.flush();
    playback = null;
  }

  function saveProgress(book: Book, position: BookProgress) {
    progress[book.key] = position;
    store.set('progress', progress);
    store.set('last', book.key);
    book.started = true;
    book.progress = Math.max(1, Math.min(100, Math.round(position.p * 100)));
  }

  function finishBook(book: Book) {
    delete progress[book.key];
    read[book.key] = 1;
    book.started = false;
    book.progress = 0;
    book.read = true;
    store.set('progress', progress);
    store.set('read', read);
    store.set('last', book.key);
    playback = { bookId: book.id, index: 0, startTime: 0, autoplay: false, token: ++playbackToken };
  }

  function toggleMark(id: string, kind: 'liked' | 'read') {
    const book = books.find((item) => item.id === id);
    if (!book) return;
    if (playback?.bookId !== book.id) {
      const saved = savedProgress(book);
      startBook(book, saved?.i ?? 0, saved?.t ?? 0, false);
    }
    const map = kind === 'liked' ? likes : read;
    if (map[book.key]) delete map[book.key];
    else map[book.key] = 1;
    book[kind] = !!map[book.key];
    store.set(kind === 'liked' ? 'likes' : 'read', map);
  }

  function loadBooks(catalog: Book[], name: string, canRead = true) {
    player?.flush();
    playback = null;
    coverLoader.dispose();
    coverLoader = new CoverLoader(canRead);
    books = catalog.map(hydrate);
    folderPath = [];
    libraryName = name;
    const last = store.get<string | null>('last', null);
    const book = books.find((item) => item.key === last);
    if (book) {
      const saved = savedProgress(book);
      playback = {
        bookId: book.id,
        index: saved?.i ?? 0,
        startTime: saved?.t ?? 0,
        autoplay: false,
        token: ++playbackToken
      };
    }
  }

  async function openHandle(handle: LibraryDirectory) {
    const token = ++scanToken;
    loading = true;
    error = '';
    try {
      const files = await walk(handle);
      if (token !== scanToken) return;

      const catalog = buildLibrary(files);
      const saved = await saveLibrary(
        handle,
        {
          name: handle.name,
          files: files.map((file) => ({ file, path: file.webkitRelativePath }))
        },
        catalog
      );
      if (token !== scanToken) return;
      savedHandle = handle;
      accessNeeded = false;
      connectLibraryFiles(handle);
      loadBooks(catalog, handle.name);
      if (!saved) error = 'Your library is open, but could not be remembered on this device.';
    } catch {
      if (token === scanToken)
        error =
          'This folder could not be read. Check that it is still available, then choose it again.';
    } finally {
      if (token === scanToken) loading = false;
    }
  }

  async function chooseFolder() {
    error = '';
    const picker = (
      window as Window & {
        showDirectoryPicker?: (options: { mode: 'read' }) => Promise<LibraryDirectory>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      folderInput.value = '';
      folderInput.click();
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'read' });
      await openHandle(handle);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError'))
        error = 'The folder picker could not open. Please try again.';
    }
  }

  async function loadPickedFiles(event: Event) {
    const files = libraryFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []));
    if (!files.length) return;
    const token = ++scanToken;
    loading = true;
    error = '';
    const name = files[0]?.webkitRelativePath.split('/')[0] || 'Library';
    const catalog = buildLibrary(files);
    const saved = await saveLibrary(
      null,
      {
        name,
        files: files.map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      },
      catalog
    );
    if (token !== scanToken) return;
    savedHandle = null;
    accessNeeded = false;
    connectLibraryFiles(null, files);
    loadBooks(catalog, name);
    loading = false;
    if (!saved) error = 'Your library is open, but could not be remembered on this device.';
  }

  async function ensureLibraryAccess() {
    if (!accessNeeded) return true;
    if (!savedHandle) {
      error = 'This browser needs you to choose the folder again to play its original files.';
      await chooseFolder();
      return false;
    }
    const handle = savedHandle;
    const token = scanToken;
    error = '';
    try {
      // Called directly from a book/play click, while user activation is available.
      if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') {
        error = 'Folder access was not granted. Tap a book to try again or choose another folder.';
        return false;
      }
      if (token !== scanToken) return false;
      void requestPersistentStorage();
      accessNeeded = false;
      coverLoader.dispose();
      coverLoader = new CoverLoader();
      for (const book of books) book.coverUrl = undefined;
      return true;
    } catch {
      error = 'The remembered folder is unavailable. Please choose the folder again.';
      return false;
    }
  }

  async function reopenFolder() {
    if (await ensureLibraryAccess()) {
      if (!libraryName && savedHandle) await openHandle(savedHandle);
    }
  }

  async function refreshLibrary() {
    if (await ensureLibraryAccess()) {
      if (savedHandle) await openHandle(savedHandle);
      else await chooseFolder();
    }
  }

  function navigateFolder(path: string[]) {
    folderPath = path;
    window.scrollTo(0, 0);
  }
  function clearFilters() {
    query = '';
    filter = 'all';
  }

  async function checkFolderAccess() {
    if (document.visibilityState !== 'visible' || !savedHandle || loading) return;
    // Returning from the background can expire a browser's one-time grant.
    if (
      !books.some((book) => book.files.some((file) => 'source' in file && file.source === 'folder'))
    )
      return;
    const handle = savedHandle;
    const token = scanToken;
    try {
      const granted = (await handle.queryPermission({ mode: 'read' })) === 'granted';
      if (token !== scanToken || handle !== savedHandle || accessNeeded === !granted) return;
      accessNeeded = !granted;
      coverLoader.dispose();
      coverLoader = new CoverLoader(granted);
      for (const book of books) book.coverUrl = undefined;
    } catch {
      if (token === scanToken) accessNeeded = true;
    }
  }

  onMount(() => {
    const savedView = store.get<LibraryView>('view', 'series');
    view = ['series', 'folders', 'az'].includes(savedView) ? savedView : 'series';
    progress = store.get('progress', {});
    likes = store.get('likes', {});
    read = store.get('read', {});
    ready = true;
    // Run independently so storage permission cannot delay catalogue restoration.
    void requestPersistentStorage();
    document.addEventListener('visibilitychange', checkFolderAccess);
    const token = scanToken;
    void (async () => {
      const { handle, catalog, legacy } = await readSavedLibrary();
      if (token !== scanToken) return;
      savedHandle = handle ?? null;
      connectLibraryFiles(savedHandle);
      accessNeeded = catalog ? catalog.version === 2 : !!handle;
      if (catalog) loadBooks(catalog.books, catalog.name, !accessNeeded);
      else if (legacy) {
        const files = restoreLibraryFiles(legacy);
        connectLibraryFiles(null, files);
        accessNeeded = false;
        loadBooks(buildLibrary(files), legacy.name);
      }
      try {
        if (handle && (await handle.queryPermission({ mode: 'read' })) === 'granted') {
          if (token !== scanToken) return;
          accessNeeded = false;
          if (catalog) {
            coverLoader.dispose();
            coverLoader = new CoverLoader();
            for (const book of books) book.coverUrl = undefined;
          } else if (!legacy) await openHandle(handle);
        }
      } catch {
        // The cached catalogue stays usable; permission can be granted when playing.
      }
    })();
    return () => {
      document.removeEventListener('visibilitychange', checkFolderAccess);
      ++scanToken;
      coverLoader.dispose();
    };
  });
</script>

{#snippet bookCard(book: Book)}
  <BookCard {book} playing={selectedBook?.id === book.id} onopen={openBook} onmark={toggleMark} />
{/snippet}

<input
  class="sr-only"
  type="file"
  tabindex="-1"
  aria-label="Audiobook folder"
  bind:this={folderInput}
  multiple
  {...{ webkitdirectory: true }}
  onchange={loadPickedFiles}
/>
<div class="library" class:with-player={selectedBook !== undefined}>
  <LibraryToolbar
    bind:query
    bind:view
    bind:filter
    onchoose={chooseFolder}
    onrefresh={refreshLibrary}
    canRefresh={!!libraryName}
    busy={loading}
  />
  <main>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if loading && !books.length}
      <LibraryEmptyState
        title="Scanning your library…"
        message="Finding audiobooks in your folder and its subfolders."
      />
    {:else if books.length === 0}
      {#if savedHandle && !libraryName}
        <LibraryEmptyState
          title="Welcome back"
          message={`Your library ${savedHandle.name} is remembered. Reopen it to grant access to your files.`}
          actionLabel="Reopen library"
          onaction={reopenFolder}
        />
      {:else}
        <LibraryEmptyState
          title={libraryName ? 'No audiobooks found' : 'Your next story starts here'}
          message={libraryName
            ? 'Choose a folder containing audio files to fill your library.'
            : 'Choose your audiobook folder. Audio files in its subfolders are included; your files stay on your computer.'}
          actionLabel="Choose folder"
          onaction={chooseFolder}
        />
      {/if}
    {:else if visibleBooks.length === 0}
      <LibraryEmptyState
        title="No matches"
        message="Try another title or series name, or change the filter."
        actionLabel="Clear search and filters"
        onaction={clearFilters}
      />
    {:else if view === 'folders'}
      <nav class="crumbs" aria-label="Folder path">
        {#each folders.crumbs as crumb, index (crumb.path.join('/'))}
          {#if index > 0}<span class="divider">/</span>{/if}
          {#if index === folders.crumbs.length - 1}<span aria-current="page">{crumb.label}</span>
          {:else}<button onclick={() => navigateFolder(crumb.path)}>{crumb.label}</button>{/if}
        {/each}
      </nav>
      {#if folders.folders.length}
        <div class="folder-group">
          {#if folders.books.length}<h2 class="folder-heading">Folders</h2>{/if}
          <div class="book-grid">
            {#each folders.folders as folder (folder.path.join('/'))}
              <FolderTile
                name={folder.name}
                books={folder.books}
                subfolders={folder.subfolders}
                onopen={() => navigateFolder(folder.path)}
              />
            {/each}
          </div>
        </div>
      {/if}
      {#if folders.books.length}
        {#if folders.folders.length}<h2 class="folder-heading">Books</h2>{/if}
        <div class="book-grid">
          {#each folders.books as book (book.id)}{@render bookCard(book)}{/each}
        </div>
      {/if}
    {:else}
      {#each sections as group (group.name)}
        <BookSection title={group.name} count={group.books.length}
          >{#each group.books as book (book.id)}{@render bookCard(book)}{/each}</BookSection
        >
      {/each}
    {/if}
  </main>
  {#if selectedBook && playback}
    <AudioPlayer
      bind:this={player}
      book={selectedBook}
      {playback}
      onprogress={saveProgress}
      onchapter={(index) => startBook(selectedBook, index)}
      onfinish={finishBook}
      onclose={closePlayer}
      onaccess={ensureLibraryAccess}
    />
  {/if}
</div>

<style>
  .library {
    min-height: 100dvh;
    padding-bottom: 32px;
  }
  .with-player {
    padding-bottom: 120px;
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px var(--gutter);
  }
  .library-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 32px;
  }
  .error {
    color: var(--accent);
    margin-bottom: 16px;
  }
  .access-note {
    color: var(--muted);
    margin-bottom: 16px;
  }
  .folder-group {
    margin-bottom: 36px;
  }
  .folder-heading {
    font-family: var(--serif);
    font-size: 1.5rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 6px;
    margin-bottom: 14px;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 20px;
  }
  .crumbs button {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .crumbs [aria-current] {
    font-family: var(--serif);
    font-size: 1.25rem;
    font-weight: 700;
  }
  .divider {
    color: var(--muted);
  }
  @media (max-width: 640px) {
    main {
      padding-top: 20px;
    }
    .with-player {
      padding-bottom: 150px;
    }
    .library-heading {
      margin-bottom: 24px;
      align-items: flex-start;
    }
  }
</style>
