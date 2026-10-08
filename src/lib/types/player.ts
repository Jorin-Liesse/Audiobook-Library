import type { Book, BookProgress, Playback } from './library.ts';

export interface PlayerHandle {
  flush: () => void | Promise<void>;
}

export interface PlayerProps {
  book: Book;
  playback: Playback;
  onprogress: (book: Book, progress: BookProgress) => void;
  onchapter: (index: number) => void;
  onfinish: (book: Book) => void;
  onplay: () => void;
  onclose: () => void;
  onaccess: () => Promise<boolean>;
}
