import type { Book } from '#lib/types/library.ts';
import { idb } from './storage.ts';

export const COVER_CONTEXT = Symbol('cover-loader');
export type LoadCover = (book: Book) => Promise<void>;
interface CoverResult {
  url: string | null;
  author?: string;
}

async function readTags(file: File) {
  try {
    const { default: mediaTags } = await import('jsmediatags/dist/jsmediatags.min.js');
    return await new Promise<{ blob: Blob | null; author?: string }>((resolve) => {
      // A damaged tag must not permanently occupy one of the four queue slots.
      const timeout = window.setTimeout(() => resolve({ blob: null }), 15000);
      const finish = (result: { blob: Blob | null; author?: string }) => {
        clearTimeout(timeout);
        resolve(result);
      };
      try {
        mediaTags.read(file, {
          onSuccess: ({ tags }) => {
            const picture = tags.picture;
            finish({
              blob: picture?.data?.length
                ? new Blob([new Uint8Array(picture.data)], { type: picture.format || 'image/jpeg' })
                : null,
              author: tags.artist
            });
          },
          onError: () => finish({ blob: null })
        });
      } catch {
        finish({ blob: null });
      }
    });
  } catch {
    return { blob: null };
  }
}

export class CoverLoader {
  private active = 0;
  private disposed = false;
  private urls = new Set<string>();
  private requests = new WeakMap<Book, Promise<CoverResult>>();
  private queue: { book: Book; resolve: (result: CoverResult) => void }[] = [];

  load(book: Book): Promise<CoverResult> {
    if (this.disposed) return Promise.resolve({ url: null });
    let request = this.requests.get(book);
    if (!request) {
      request = new Promise((resolve) => {
        this.queue.push({ book, resolve });
        this.pump();
      });
      this.requests.set(book, request);
    }
    return request;
  }

  private pump() {
    while (!this.disposed && this.active < 4 && this.queue.length) {
      const { book, resolve } = this.queue.shift()!;
      this.active++;
      this.find(book)
        .then(resolve, () => resolve({ url: null }))
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async find(book: Book): Promise<CoverResult> {
    const cached = !book.image ? await idb.get<Blob>('covers', book.key) : null;
    let blob: Blob | null = book.image || (cached instanceof Blob ? cached : null);
    let author: string | undefined;
    if (!blob) {
      for (const file of book.files.slice(0, 2)) {
        if (this.disposed) return { url: null };
        const tags = await readTags(file);
        author ||= tags.author;
        if (tags.blob) {
          blob = tags.blob;
          void idb.set('covers', book.key, blob);
          break;
        }
      }
    }
    blob ||= book.parentImage;
    if (this.disposed) return { url: null };
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url) this.urls.add(url);
    return { url, author };
  }

  dispose() {
    this.disposed = true;
    this.queue.splice(0).forEach(({ resolve }) => resolve({ url: null }));
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}
