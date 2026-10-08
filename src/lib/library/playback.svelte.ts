import type { Book, BookProgress, Playback } from '#lib/types/library.ts';
import { androidAudio, isAndroidApp } from './androidAudio.ts';
import { store } from './storage.ts';
import type { PlayerHandle } from '#lib/types/player.ts';

export function createPlaybackController(options: {
  ensureAccess: () => Promise<boolean>;
  savedProgress: (book: Book) => BookProgress | null;
  progress: (book: Book, position: BookProgress) => void;
  finish: (book: Book) => void;
  error: (message: string) => void;
}) {
  let playback = $state<Playback | null>(null);
  let player = $state<PlayerHandle>();
  let intent = 0;
  let commandToken = 0;

  function restore(book: Book, index: number, startTime = 0, autoplay = false) {
    if (!Number.isInteger(index) || index < 0 || index >= book.files.length) return;
    playback = { bookId: book.id, index, startTime, autoplay, token: ++commandToken };
  }

  async function startBook(book: Book, index: number) {
    const token = ++intent;
    await player?.flush();
    if (token === intent) restore(book, index, 0, true);
  }

  async function openBook(book: Book) {
    const token = ++intent;
    if (!(await options.ensureAccess()) || token !== intent) return;
    await player?.flush();
    if (token !== intent) return;
    const saved = options.savedProgress(book);
    restore(book, saved?.i ?? 0, saved?.t ?? 0, true);
  }

  async function closePlayer() {
    const token = ++intent;
    await player?.flush();
    if (token !== intent) return false;
    if (isAndroidApp()) {
      try {
        await androidAudio.stop();
      } catch {
        options.error(
          'The Android player could not be stopped. Use the media notification to pause playback.',
        );
        return false;
      }
    }
    if (token !== intent) return false;
    playback = null;
    return true;
  }

  function saveProgress(book: Book, position: BookProgress) {
    options.progress(book, position);
    if (store.get<string | null>('last', null) !== book.key) store.set('last', book.key);
  }

  function finishBook(book: Book) {
    ++intent;
    options.finish(book);
    store.set('last', book.key);
    restore(book, 0);
  }

  return {
    get playback() {
      return playback;
    },
    get player() {
      return player;
    },
    set player(value: PlayerHandle | undefined) {
      player = value;
    },
    clear() {
      ++intent;
      playback = null;
    },
    restore,
    startBook,
    openBook,
    closePlayer,
    saveProgress,
    finishBook,
  };
}
