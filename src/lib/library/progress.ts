import type { BookProgress } from '#lib/types/library.ts';

// Keep the compact persisted schema at this boundary; calculations use descriptive names.
export function playbackProgress(
  chapterIndex: number,
  seconds: number,
  duration: number,
  chapterCount: number,
): BookProgress {
  const fraction =
    Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0;
  return { i: chapterIndex, t: seconds, p: (chapterIndex + fraction) / chapterCount };
}
