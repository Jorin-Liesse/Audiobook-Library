import { invoke } from '@tauri-apps/api/core';
import { isNativeApp, isNativeFile } from '#lib/library/native.ts';
import type { Book } from '#lib/types/library.ts';

export const isAndroidApp = () => isNativeApp() && /Android/i.test(navigator.userAgent);

export interface AndroidPlayback {
  active: boolean;
  bookKey?: string;
  index?: number;
  count?: number;
  position?: number;
  duration?: number;
  playing: boolean;
  ended?: boolean;
  error?: string;
  updatedAt?: number;
}

// Keep user commands ordered, including rapid book switches during service startup.
let pending: Promise<unknown> = Promise.resolve();
function command(name: string, args?: Record<string, unknown>): Promise<AndroidPlayback> {
  const result = pending.then(() => invoke<AndroidPlayback>('plugin:native-audio|' + name, args));
  pending = result.catch(() => {});
  return result;
}

export const androidAudio = {
  status: () => command('status'),
  play: () => command('play'),
  pause: () => command('pause'),
  seek: (position: number) => command('seek', { position }),
  stop: () => command('stop'),
  load: (book: Book, index: number, position: number) => {
    const tracks = book.files.map((file) => {
      if (!isNativeFile(file) || file.protocol !== 'library') {
        throw new Error('Choose your audiobook folder again to enable Android playback.');
      }
      return { location: file.location, name: file.name };
    });
    return command('load', {
      request: {
        bookKey: book.key,
        title: book.title,
        author: book.author,
        tracks,
        index,
        position,
      },
    });
  },
};
