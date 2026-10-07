<script lang="ts">
  import { onMount, setContext, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { LibrarySync, type SyncStatus } from '#lib/library/sync.ts';
  import BookCard from '#lib/components/BookCard.svelte';
  import BookSection from '#lib/components/BookSection.svelte';
  import FolderTile from '#lib/components/FolderTile.svelte';
  import LibraryToolbar from '#lib/components/LibraryToolbar.svelte';
  import LibraryEmptyState from '#lib/components/LibraryEmptyState.svelte';
  import AudioPlayer from '#lib/components/AudioPlayer.svelte';
  import { androidAudio, isAndroidApp } from '#lib/library/androidAudio.ts';
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
    isNativeApp,
    isNativeFile,
    chooseNativeLibrary,
    refreshNativeLibrary,
    checkNativeAccess
  } from '#lib/library/native.ts';
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
    NativeLibrary,
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
  let native = $state(false);
  let sync: LibrarySync | undefined;
  let syncStatus = $state<SyncStatus>({
    account: null,
    busy: false,
    connected: false,
    message: '',
    lastSynced: null
  });
  let playback = $state<Playback | null>(null);
  let player = $state<{ flush: () => void | Promise<void> }>();
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
    return sync?.get(book).progress ?? null;
  }

  function hydrate(book: Book) {
    const state = sync?.get(book);
    const saved = state?.progress;
    book.started = !!saved;
    book.progress = saved ? Math.min(100, Math.max(0, Math.round(saved.p * 100))) : 0;
    book.liked = state?.liked ?? false;
    book.read = state?.read ?? false;
    return book;
  }

  function syncChanged() {
    for (const book of books) hydrate(book);
  }

  function startBook(book: Book, index: number, startTime = 0, autoplay = true) {
    if (index < 0 || index >= book.files.length) return;
    player?.flush();
    playback = {
      bookId: book.id,
      index,
      startTime,
      autoplay,
      token: ++playbackToken
    };
  }

  async function openBook(book: Book) {
    if (!(await ensureLibraryAccess())) return;
    await player?.flush();
    const saved = savedProgress(book);
    startBook(book, saved?.i ?? 0, saved?.t ?? 0);
  }

  async function closePlayer() {
    const closing = playback;
    await player?.flush();
    if (playback !== closing) return;
    playback = null;
    if (isAndroidApp())
      await androidAudio.stop().catch(() => {
        error =
          'The Android player could not be stopped. Use the media notification to pause playback.';
      });
  }

  function saveProgress(book: Book, position: BookProgress) {
    sync?.progress(book, position);
    store.set('last', book.key);
  }

  function finishBook(book: Book) {
    sync?.finish(book);
    store.set('last', book.key);
    playback = {
      bookId: book.id,
      index: 0,
      startTime: 0,
      autoplay: false,
      token: ++playbackToken
    };
  }

  function toggleMark(id: string, kind: 'liked' | 'read') {
    const book = books.find((item) => item.id === id);
    if (!book) return;
    if (playback?.bookId !== book.id) {
      const saved = savedProgress(book);
      startBook(book, saved?.i ?? 0, saved?.t ?? 0, false);
    }
    sync?.mark(book, kind, !book[kind]);
  }

  function loadBooks(catalog: Book[], name: string, canRead = true) {
    player?.flush();
    playback = null;
    coverLoader.dispose();
    coverLoader = new CoverLoader(canRead);
    sync?.migrate(catalog);
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

  async function openNativeLibrary(refresh = false) {
    const token = ++scanToken;
    loading = true;
    error = '';
    try {
      const library: NativeLibrary | null = await (refresh
        ? refreshNativeLibrary()
        : chooseNativeLibrary());
      if (!library || token !== scanToken) return;
      const files = libraryFiles(library.files);
      const catalog = buildLibrary(files);
      const saved = await saveLibrary(
        null,
        {
          name: library.name,
          files: files.map((file) => ({ file, path: file.webkitRelativePath }))
        },
        catalog
      );
      if (token !== scanToken) return;
      savedHandle = null;
      accessNeeded = false;
      connectLibraryFiles(null);
      if (isAndroidApp()) await androidAudio.stop();
      if (token !== scanToken) return;
      loadBooks(catalog, library.name);
      if (!saved) error = 'Your library is open, but could not be remembered on this device.';
    } catch {
      if (token === scanToken)
        error =
          'This folder could not be opened. Check that it is available, then choose it again.';
    } finally {
      if (token === scanToken) loading = false;
    }
  }

  async function chooseFolder() {
    error = '';
    if (isNativeApp()) {
      await openNativeLibrary();
      return;
    }
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
        files: files.map((file) => ({
          file,
          path: file.webkitRelativePath || file.name
        }))
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
      error = 'Choose your folder again to play its original files.';
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
      if (isNativeApp()) await openNativeLibrary(true);
      else if (savedHandle) await openHandle(savedHandle);
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
    if (native && document.visibilityState === 'visible' && libraryName && !loading) {
      const token = scanToken;
      try {
        const granted = await checkNativeAccess();
        if (token !== scanToken || accessNeeded === !granted) return;
        accessNeeded = !granted;
        coverLoader.dispose();
        coverLoader = new CoverLoader(granted);
        for (const book of books) book.coverUrl = undefined;
      } catch {
        if (token === scanToken) accessNeeded = true;
      }
      return;
    }
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
    native = isNativeApp();
    const savedView = store.get<LibraryView>('view', 'series');
    view = ['series', 'folders', 'az'].includes(savedView) ? savedView : 'series';
    sync = new LibrarySync(
      syncChanged,
      (status) => {
        syncStatus = status;
      },
      async () => {
        await closePlayer();
        await tick();
      }
    );
    sync.start();
    ready = true;
    // Run independently so storage permission cannot delay catalogue restoration.
    void requestPersistentStorage();
    document.addEventListener('visibilitychange', checkFolderAccess);
    const token = scanToken;
    void (async () => {
      const [{ handle, catalog, legacy }, nativePlayback] = await Promise.all([
        readSavedLibrary(),
        isAndroidApp() ? androidAudio.status().catch(() => null) : Promise.resolve(null)
      ]);
      if (token !== scanToken) return;
      savedHandle = handle ?? null;
      connectLibraryFiles(savedHandle);
      accessNeeded = catalog ? catalog.version === 2 : !!handle;
      if (native && catalog?.books.some((book) => book.files.some(isNativeFile))) {
        try {
          accessNeeded = !(await checkNativeAccess());
        } catch {
          accessNeeded = true;
        }
        if (token !== scanToken) return;
      }
      if (catalog) sync?.migrate(catalog.books);
      if (catalog && nativePlayback?.bookKey) {
        const book = catalog.books.find((item) => item.key === nativePlayback.bookKey);
        const index = nativePlayback.index ?? 0;
        const position = nativePlayback.position ?? 0;
        if (
          book &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < book.files.length &&
          Number.isFinite(position) &&
          position >= 0
        ) {
          sync?.recover(
            book,
            {
              i: index,
              t: position,
              p:
                (index +
                  ((nativePlayback.duration ?? 0) > 0
                    ? Math.min(1, position / nativePlayback.duration!)
                    : 0)) /
                book.files.length
            },
            nativePlayback.updatedAt ?? 0,
            !!nativePlayback.ended
          );
        }
      }
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
      sync?.dispose();
      document.removeEventListener('visibilitychange', checkFolderAccess);
      ++scanToken;
      coverLoader.dispose();
    };
  });
</script>

<svelte:head>
  <meta name="description" content="Audiobook Library" />
</svelte:head>

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
    syncStatus={syncStatus}
    onconnect={() => {
      void sync?.connect();
    }}
    onsync={() => {
      void sync?.syncNow();
    }}
    ondisconnect={() => {
      void sync?.disconnect();
    }}
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
            : 'Choose your audiobook folder. Audio files in its subfolders are included; your files stay on your device.'}
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
      onplay={() => {
        void openBook(selectedBook);
      }}
      onclose={closePlayer}
      onaccess={ensureLibraryAccess}
    />
  {/if}
</div>

<style>
  .library {
    min-height: 100dvh;
    padding-bottom: calc(32px + var(--safe-area-bottom));
  }
  .with-player {
    padding-bottom: calc(120px + var(--safe-area-bottom));
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px var(--gutter-right) 28px var(--gutter-left);
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
      padding-bottom: calc(150px + var(--safe-area-bottom));
    }
    .library-heading {
      margin-bottom: 24px;
      align-items: flex-start;
    }
  }
</style>
