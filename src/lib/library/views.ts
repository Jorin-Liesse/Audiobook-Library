import type { Book, LibraryFilter, LibraryView } from '#lib/types/library.ts';
import { collator, sortKey } from './files.ts';

export const STARTED_FRACTION = 0.001;

export function hasStarted(fraction: number) {
  return Number.isFinite(fraction) && fraction >= STARTED_FRACTION;
}

export function filterBooks(books: Book[], query: string, filter: LibraryFilter) {
  const term = query.trim().toLowerCase();
  return books.filter((book) => {
    const matchesSearch =
      !term || book.title.toLowerCase().includes(term) || book.series?.toLowerCase().includes(term);
    return (
      matchesSearch &&
      (filter === 'all' ||
        (filter === 'liked' && book.liked) ||
        (filter === 'progress' && book.started && !book.read) ||
        (filter === 'new' && !book.started && !book.read) ||
        (filter === 'read' && book.read))
    );
  });
}

export function groupBooks(books: Book[], view: LibraryView) {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    const letter = sortKey(book.title).charAt(0).toUpperCase();
    const name =
      view === 'series' ? (book.series ?? 'Standalone') : /^[A-Z]$/.test(letter) ? letter : '#';
    const items = groups.get(name);
    if (items) items.push(book);
    else groups.set(name, [book]);
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
          view === 'series' && b.series ? b.title : sortKey(b.title),
        ),
      ),
    }));
}
