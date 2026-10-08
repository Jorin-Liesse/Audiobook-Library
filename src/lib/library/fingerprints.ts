import type { LibraryFile } from '#lib/types/library.ts';
import { AUDIO_RE } from './files.ts';
import { loadLibraryFile } from './storage.ts';
import { isNativeFile, nativeFileUrl } from './native.ts';

const SAMPLE_SIZE = 64 * 1024;

// Read at most 192 KiB per file. Never download a whole native audiobook.
export async function contentFingerprint(
  size: number,
  read: (start: number, end: number) => Promise<ArrayBuffer>,
): Promise<string> {
  const offsets = [
    ...new Set([
      0,
      Math.max(0, Math.floor(size / 2) - SAMPLE_SIZE / 2),
      Math.max(0, size - SAMPLE_SIZE),
    ]),
  ];
  const chunks = [];
  for (const start of offsets) {
    const end = Math.min(size, start + SAMPLE_SIZE);
    const bytes = await read(start, end);
    if (bytes.byteLength !== end - start)
      throw new Error('The audio file changed while it was being scanned. Refresh your library.');
    chunks.push(new Uint8Array(bytes));
  }
  const header = new TextEncoder().encode('sample-sha256-v1:' + size + ':');
  const data = new Uint8Array(header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  data.set(header);
  let offset = header.length;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return (
    'sample-sha256-v1:' + Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}

export async function fingerprintFiles(files: LibraryFile[], current = () => true) {
  const audio = files.filter(
    (file) => !file.fingerprint && (AUDIO_RE.test(file.name) || file.type.startsWith('audio/')),
  );
  let next = 0;
  const fingerprints = new Map<LibraryFile, string>();
  await Promise.all(
    Array.from({ length: Math.min(4, audio.length) }, async () => {
      while (current() && next < audio.length) {
        const file = audio[next++];
        if (isNativeFile(file)) {
          const url = await nativeFileUrl(file);
          const fingerprint = await contentFingerprint(file.size, async (start, end) => {
            if (start === end) return new ArrayBuffer(0);
            const response = await fetch(url, {
              headers: { Range: 'bytes=' + start + '-' + (end - 1) },
              signal: AbortSignal.timeout(15000),
            });
            // Some asset transports do not expose this header to the WebView.
            const range = response.headers.get('Content-Range');
            if (
              response.status !== 206 ||
              (range && range !== 'bytes ' + start + '-' + (end - 1) + '/' + file.size)
            ) {
              await response.body?.cancel();
              throw new Error(
                'The audio file could not be identified. Check folder access and refresh your library.',
              );
            }
            return response.arrayBuffer();
          });
          fingerprints.set(file, fingerprint);
        } else {
          const original = await loadLibraryFile(file);
          const fingerprint = await contentFingerprint(file.size, (start, end) =>
            original.slice(start, end).arrayBuffer(),
          );
          fingerprints.set(file, fingerprint);
        }
      }
    }),
  );
  // Publish together so playback never sees a partly migrated catalogue.
  if (current()) for (const [file, fingerprint] of fingerprints) file.fingerprint = fingerprint;
}

// Reuse only within the same library refresh. Unknown modification times must be reread.
export function reuseFingerprints(files: LibraryFile[], previous: LibraryFile[]) {
  const identity = (file: LibraryFile) =>
    JSON.stringify([
      isNativeFile(file) ? file.location : file.webkitRelativePath || file.name,
      file.size,
      file.lastModified,
    ]);
  const saved = new Map(
    previous
      .filter((file) => file.fingerprint && file.lastModified > 0)
      .map((file) => [identity(file), file.fingerprint!]),
  );
  for (const file of files) {
    if (!file.fingerprint && file.lastModified > 0) file.fingerprint = saved.get(identity(file));
  }
}
