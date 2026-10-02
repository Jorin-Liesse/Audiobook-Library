import type { Book } from '#lib/types/library.ts';

export const AUDIO_RE = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav|wma|webm)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');
export const tidy = (name: string) => name.replace(/_/g, ' ').trim();
export const sortKey = (title: string) => title.replace(/^(the|a|an)\s+/i, '');
const pathOf = (file: File) => file.webkitRelativePath || file.name;
const dirOf = (file: File) => pathOf(file).split('/').slice(0, -1).join('/');

export function libraryFiles(allFiles: File[]) {
  return allFiles.filter(
    (file) =>
      (file.type.startsWith('audio/') || AUDIO_RE.test(file.name) || IMAGE_RE.test(file.name)) &&
      !pathOf(file)
        .split('/')
        .some((part) => part.startsWith('.'))
  );
}

function hue(title: string) {
  let value = 0;
  for (const character of title) value = (value * 31 + character.charCodeAt(0)) % 360;
  return value;
}

// Match the grouping rules of the supplied standalone HTML.
export function buildLibrary(allFiles: File[]): Book[] {
  const files = libraryFiles(allFiles);
  const audio = files.filter((file) => file.type.startsWith('audio/') || AUDIO_RE.test(file.name));
  const images = new Map<string, File[]>();
  for (const file of files.filter((file) => IMAGE_RE.test(file.name))) {
    const directory = dirOf(file);
    images.set(directory, [...(images.get(directory) ?? []), file]);
  }
  const directories = new Map<string, File[]>();
  for (const file of audio) {
    const directory = dirOf(file);
    directories.set(directory, [...(directories.get(directory) ?? []), file]);
  }
  const books: Book[] = [];
  const pickImage = (list: File[], stem?: string) =>
    (stem && list.find((file) => stripExt(file.name).toLowerCase() === stem.toLowerCase())) ||
    list.find((file) => /cover|folder|front|art/i.test(file.name)) ||
    list[0] ||
    null;
  const add = (
    title: string,
    treePath: string[],
    files: File[],
    image: File | null,
    parentImage: File | null
  ) => {
    const baseKey = treePath.join('/') + '/' + tidy(title);
    const key = books.some((book) => book.key === baseKey)
      ? baseKey + '/' + files[0].name
      : baseKey;
    const colorHue = hue(title);
    const motifs = ['orbit', 'mountain', 'arch', 'waves'] as const;
    books.push({
      id: key,
      key,
      title: tidy(title),
      author: '',
      treePath,
      series: treePath.length > 1 ? tidy(treePath[treePath.length - 1]) : undefined,
      files: files.sort((a, b) => collator.compare(pathOf(a), pathOf(b))),
      image,
      parentImage,
      chapters: files.length,
      progress: 0,
      started: false,
      liked: false,
      read: false,
      cover: { color: `hsl(${colorHue} 32% 30%)`, accent: '#e5dcc4', motif: motifs[colorHue % 4] }
    });
  };
  for (const [directory, files] of directories) {
    const parts = directory ? directory.split('/') : [];
    const name = parts.at(-1) || 'Library';
    const singles = files.filter((file) => /\.m4b$/i.test(file.name) || files.length === 1);
    const chapters = files.filter((file) => !singles.includes(file));
    const inDirectory = images.get(directory) ?? [];
    const parentImages = parts.length > 1 ? (images.get(parts.slice(0, -1).join('/')) ?? []) : [];
    if (chapters.length)
      add(name, parts.slice(0, -1), chapters, pickImage(inDirectory), pickImage(parentImages));
    for (const file of singles) {
      if (singles.length === 1 && !chapters.length && parts.length > 1) {
        add(
          name,
          parts.slice(0, -1),
          [file],
          pickImage(inDirectory, stripExt(file.name)),
          pickImage(parentImages)
        );
      } else {
        const matched =
          inDirectory.find(
            (image) => stripExt(image.name).toLowerCase() === stripExt(file.name).toLowerCase()
          ) ?? null;
        add(stripExt(file.name), parts, [file], matched, null);
      }
    }
  }
  return books;
}

export async function walk(
  directory: FileSystemDirectoryHandle,
  prefix = directory.name + '/',
  output: File[] = []
) {
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    if (handle.kind === 'directory') {
      await walk(handle, prefix + name + '/', output);
    } else if (AUDIO_RE.test(name) || IMAGE_RE.test(name)) {
      const file = await handle.getFile();
      Object.defineProperty(file, 'webkitRelativePath', { value: prefix + name });
      output.push(file);
    }
  }
  return output;
}

interface FolderNode {
  name: string;
  folders: Map<string, FolderNode>;
  books: Book[];
}

export function folderContents(books: Book[], savedPath: string[]) {
  const make = (name: string): FolderNode => ({ name, folders: new Map(), books: [] });
  const root = make('Library');
  for (const book of books) {
    let node = root;
    for (const part of book.treePath) {
      if (!node.folders.has(part)) node.folders.set(part, make(part));
      node = node.folders.get(part)!;
    }
    node.books.push(book);
  }
  const passThrough = (node: FolderNode) => !node.books.length && node.folders.size === 1;
  const allBooks = (node: FolderNode): Book[] => [
    ...node.books,
    ...[...node.folders.values()].flatMap(allBooks)
  ];
  let node = root;
  const path: string[] = [];
  for (const part of savedPath) {
    const next = node.folders.get(part);
    if (!next) break;
    node = next;
    path.push(part);
  }
  while (passThrough(node)) {
    const [name, next] = [...node.folders][0];
    path.push(name);
    node = next;
  }
  const crumbs = [];
  if (!passThrough(root)) crumbs.push({ label: 'Library', path: [] as string[] });
  let current = root;
  path.forEach((part, index) => {
    current = current.folders.get(part)!;
    if (!passThrough(current)) crumbs.push({ label: tidy(part), path: path.slice(0, index + 1) });
  });
  return {
    crumbs,
    books: [...node.books].sort((a, b) => collator.compare(a.title, b.title)),
    folders: [...node.folders]
      .sort(([a], [b]) => collator.compare(a, b))
      .map(([name, child]) => ({
        name: tidy(name),
        path: [...path, name],
        subfolders: child.folders.size,
        books: allBooks(child).sort((a, b) => collator.compare(a.title, b.title))
      }))
  };
}
