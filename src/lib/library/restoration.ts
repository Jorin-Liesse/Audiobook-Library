import { androidAudio, isAndroidApp, type AndroidPlayback } from './androidAudio.ts';
import { checkNativeAccess, isNativeApp, isNativeFile } from './native.ts';
import { readSavedLibrary } from './storage.ts';
import { playbackProgress } from './progress.ts';
import type { LibrarySync } from './sync.ts';
import type { Book } from '#lib/types/library.ts';

export async function readLibraryRestoreState() {
  const [{ handle, catalog, legacy }, playback] = await Promise.all([
    readSavedLibrary(),
    isAndroidApp() ? androidAudio.status().catch(() => null) : Promise.resolve(null),
  ]);
  let canRead = catalog ? catalog.version === 1 : !handle;
  try {
    if (handle) canRead = (await handle.queryPermission({ mode: 'read' })) === 'granted';
    else if (isNativeApp() && catalog?.books.some((book) => book.files.some(isNativeFile)))
      canRead = await checkNativeAccess();
  } catch {
    canRead = false;
  }
  return { handle, catalog, legacy, playback, canRead };
}

export function recoverNativePlayback(
  sync: LibrarySync | undefined,
  books: Book[],
  state: AndroidPlayback | null,
) {
  if (!sync || !state?.bookKey) return;
  const book = books.find((book) => book.key === state.bookKey);
  const chapterIndex = state.index ?? 0;
  const seconds = state.position ?? 0;
  if (
    !book ||
    !Number.isInteger(chapterIndex) ||
    chapterIndex < 0 ||
    chapterIndex >= book.files.length ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return;
  sync.recover(
    book,
    playbackProgress(chapterIndex, seconds, state.duration ?? 0, book.files.length),
    state.updatedAt ?? 0,
    !!state.ended,
  );
}
