import type { Book, LibraryDirectory, LibraryFile } from '#lib/types/library.ts';
import { buildLibrary, libraryFiles } from './files.ts';
import { fingerprintFiles, reuseFingerprints } from './fingerprints.ts';

export interface LibraryImport {
  name: string;
  files: LibraryFile[];
  handle: LibraryDirectory | null;
}

export async function prepareLibrary(
  input: LibraryImport,
  previous: Book[],
  current: () => boolean,
  reuse = false,
) {
  const files = libraryFiles(input.files);
  if (reuse)
    reuseFingerprints(
      files,
      previous.flatMap((book) => book.files),
    );
  await fingerprintFiles(files, current);
  if (!current()) return null;
  return { ...input, files, books: buildLibrary(files) };
}
