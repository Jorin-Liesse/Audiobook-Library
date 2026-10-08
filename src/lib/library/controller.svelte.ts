import { onMount, setContext, tick } from 'svelte';
import { LibrarySync, type SyncStatus } from '#lib/library/sync.ts';
import { androidAudio, isAndroidApp } from '#lib/library/androidAudio.ts';
import { buildLibrary, folderContents, libraryFiles, walk } from '#lib/library/files.ts';
import { COVER_CONTEXT, CoverLoader, type LoadCover } from '#lib/library/covers.ts';
import {
  isNativeApp,
  isNativeFile,
  chooseNativeLibrary,
  refreshNativeLibrary,
  checkNativeAccess,
} from '#lib/library/native.ts';
import {
  connectLibraryFiles,
  readSavedLibrary,
  requestPersistentStorage,
  restoreLibraryFiles,
  saveLibrary,
  store,
} from '#lib/library/storage.ts';
import type {
  Book,
  LibraryDirectory,
  LibraryFilter,
  LibraryView,
  NativeLibrary,
} from '#lib/types/library.ts';

import { createPlaybackController } from '#lib/library/playback.svelte.ts';
import { fileKey } from '#lib/library/syncState.ts';
import { fingerprintFiles } from '#lib/library/fingerprints.ts';
import { filterBooks, groupBooks, hasStarted } from '#lib/library/views.ts';

export function createLibraryController() {
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
    lastSynced: null,
  });
  const playbackManager = createPlaybackController({
    ensureAccess: () => ensureLibraryAccess(),
    savedProgress: (book) => savedProgress(book),
    progress: (book, position) => sync?.progress(book, position),
    finish: (book) => sync?.finish(book),
    error: (message) => {
      error = message;
    },
  });
  const playback = $derived(playbackManager.playback);
  const { startBook, openBook, closePlayer, saveProgress, finishBook } = playbackManager;
  let folderInput: HTMLInputElement;
  let coverLoader = new CoverLoader();
  let scanToken = 0;

  setContext<LoadCover>(COVER_CONTEXT, async (book) => {
    const loader = coverLoader;
    const result = await loader.load(book);
    if (loader !== coverLoader) return;
    book.coverUrl = result.url;
    if (result.author) book.author = result.author;
  });

  const selectedBook = $derived(books.find((book) => book.id === playback?.bookId));
  const visibleBooks = $derived(filterBooks(books, query, filter));
  const sections = $derived(groupBooks(visibleBooks, view));
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
    book.started = hasStarted(saved?.p ?? 0);
    book.progress = saved ? Math.min(100, Math.max(0, Math.round(saved.p * 100))) : 0;
    book.liked = state?.liked ?? false;
    book.read = state?.read ?? false;
    return book;
  }

  let booksByFile = new Map<string, Set<Book>>();
  function indexBooks() {
    booksByFile = new Map();
    for (const book of books)
      for (const file of book.files) {
        const key = fileKey(file);
        const matches = booksByFile.get(key) ?? new Set<Book>();
        matches.add(book);
        booksByFile.set(key, matches);
      }
  }
  function syncChanged(keys?: ReadonlySet<string>) {
    if (!keys) {
      for (const book of books) hydrate(book);
      return;
    }
    const affected = new Set<Book>();
    for (const key of keys) for (const book of booksByFile.get(key) ?? []) affected.add(book);
    for (const book of affected) hydrate(book);
  }

  function toggleMark(id: string, kind: 'liked' | 'read') {
    const book = books.find((item) => item.id === id);
    if (!book) return;
    sync?.mark(book, kind, !book[kind]);
  }

  async function loadBooks(catalog: Book[], name: string, canRead = true, restoring = false) {
    if (!restoring && !(await closePlayer())) return;
    playbackManager.clear();
    coverLoader.dispose();
    coverLoader = new CoverLoader(canRead);
    sync?.migrate(catalog);
    books = catalog.map(hydrate);
    indexBooks();
    folderPath = [];
    libraryName = name;
    const last = store.get<string | null>('last', null);
    const book = books.find((item) => item.key === last);
    if (book) {
      const saved = savedProgress(book);
      playbackManager.restore(book, saved?.i ?? 0, saved?.t ?? 0);
    }
  }

  async function openHandle(handle: LibraryDirectory) {
    const token = ++scanToken;
    loading = true;
    error = '';
    try {
      const files = await walk(handle);
      if (token !== scanToken) return;

      await fingerprintFiles(files, () => token === scanToken);
      if (token !== scanToken) return;
      const catalog = buildLibrary(files);
      const saved = await saveLibrary(
        handle,
        {
          name: handle.name,
          files: files.map((file) => ({ file, path: file.webkitRelativePath })),
        },
        catalog,
      );
      if (token !== scanToken) return;
      savedHandle = handle;
      accessNeeded = false;
      connectLibraryFiles(handle);
      await loadBooks(catalog, handle.name);
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
      await fingerprintFiles(files, () => token === scanToken);
      if (token !== scanToken) return;
      const catalog = buildLibrary(files);
      const saved = await saveLibrary(
        null,
        {
          name: library.name,
          files: files.map((file) => ({ file, path: file.webkitRelativePath })),
        },
        catalog,
      );
      if (token !== scanToken) return;
      savedHandle = null;
      accessNeeded = false;
      connectLibraryFiles(null);
      await loadBooks(catalog, library.name);
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
    await fingerprintFiles(files, () => token === scanToken);
    if (token !== scanToken) return;
    const catalog = buildLibrary(files);
    const saved = await saveLibrary(
      null,
      {
        name,
        files: files.map((file) => ({
          file,
          path: file.webkitRelativePath || file.name,
        })),
      },
      catalog,
    );
    if (token !== scanToken) return;
    savedHandle = null;
    accessNeeded = false;
    connectLibraryFiles(null, files);
    await loadBooks(catalog, name);
    loading = false;
    if (!saved) error = 'Your library is open, but could not be remembered on this device.';
  }

  async function ensureLibraryAccess() {
    if (!accessNeeded) {
      try {
        await upgradeFingerprints();
        return true;
      } catch {
        error = 'Some audio files could not be read. Check folder access and refresh your library.';
        return false;
      }
    }
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
      await upgradeFingerprints();
      coverLoader.dispose();
      coverLoader = new CoverLoader();
      for (const book of books) book.coverUrl = undefined;
      return true;
    } catch {
      error = 'The remembered folder is unavailable. Please choose the folder again.';
      return false;
    }
  }

  let upgradePending: { token: number; catalog: Book[]; task: Promise<void> } | undefined;
  function upgradeFingerprints(catalog = books, name = libraryName) {
    if (upgradePending?.token === scanToken && upgradePending.catalog === catalog)
      return upgradePending.task;
    const task = updateFingerprints(catalog, name);
    upgradePending = { token: scanToken, catalog, task };
    void task.then(
      () => {
        if (upgradePending?.task === task) upgradePending = undefined;
      },
      () => {
        if (upgradePending?.task === task) upgradePending = undefined;
      },
    );
    return task;
  }

  async function updateFingerprints(catalog: Book[], name: string) {
    const files = [...new Set(catalog.flatMap((book) => book.files))];
    if (!files.some((file) => !file.fingerprint)) return;
    const token = scanToken;
    await fingerprintFiles(files, () => token === scanToken);
    if (token !== scanToken) return;
    sync?.migrate(catalog);
    indexBooks();
    syncChanged();
    const allFiles = [
      ...new Set(
        catalog
          .flatMap((book) => [...book.files, book.image, book.parentImage])
          .filter((file): file is NonNullable<typeof file> => !!file),
      ),
    ];
    const saved = await saveLibrary(
      savedHandle,
      { name, files: allFiles.map((file) => ({ file, path: file.webkitRelativePath })) },
      catalog,
    );
    if (token === scanToken && !saved)
      error = 'Your library is open, but its updated file identities could not be remembered.';
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
        if (!(await closePlayer()))
          throw new Error('Playback could not be stopped. Try again before switching accounts.');
        await tick();
      },
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
        isAndroidApp() ? androidAudio.status().catch(() => null) : Promise.resolve(null),
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
      if (handle) {
        try {
          accessNeeded = (await handle.queryPermission({ mode: 'read' })) !== 'granted';
        } catch {
          accessNeeded = true;
        }
      }
      if (token !== scanToken) return;
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
                book.files.length,
            },
            nativePlayback.updatedAt ?? 0,
            !!nativePlayback.ended,
          );
        }
      }
      if (catalog) {
        await loadBooks(catalog.books, catalog.name, !accessNeeded, true);
        if (!accessNeeded) {
          try {
            await upgradeFingerprints();
          } catch {
            error = 'Some file identities could not be updated. Refresh your library to retry.';
          }
        }
      } else if (legacy) {
        const files = restoreLibraryFiles(legacy);
        connectLibraryFiles(null, files);
        accessNeeded = false;
        await fingerprintFiles(files, () => token === scanToken);
        if (token !== scanToken) return;
        await loadBooks(buildLibrary(files), legacy.name, true, true);
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
    })().catch(() => {
      if (token === scanToken)
        error = 'Your saved library could not be restored. Choose your folder again.';
    });
    return () => {
      sync?.dispose();
      document.removeEventListener('visibilitychange', checkFolderAccess);
      ++scanToken;
      coverLoader.dispose();
    };
  });

  return {
    get books() {
      return books;
    },
    get visibleBooks() {
      return visibleBooks;
    },
    get sections() {
      return sections;
    },
    get folders() {
      return folders;
    },
    get selectedBook() {
      return selectedBook;
    },
    get savedHandle() {
      return savedHandle;
    },
    get libraryName() {
      return libraryName;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get syncStatus() {
      return syncStatus;
    },
    get playback() {
      return playback;
    },
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get filter() {
      return filter;
    },
    set filter(value: typeof filter) {
      filter = value;
    },
    get query() {
      return query;
    },
    set query(value: typeof query) {
      query = value;
    },
    get folderInput() {
      return folderInput;
    },
    set folderInput(value: typeof folderInput) {
      folderInput = value;
    },
    get player() {
      return playbackManager.player;
    },
    set player(value: typeof playbackManager.player) {
      playbackManager.player = value;
    },
    openBook,
    toggleMark,
    chooseFolder,
    loadPickedFiles,
    refreshLibrary,
    reopenFolder,
    clearFilters,
    navigateFolder,
    startBook,
    saveProgress,
    finishBook,
    closePlayer,
    ensureLibraryAccess,
    connect: () => sync?.connect(),
    syncNow: () => sync?.syncNow(),
    disconnect: () => sync?.disconnect(),
  };
}
