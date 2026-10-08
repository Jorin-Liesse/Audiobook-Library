export type LibraryView = 'series' | 'folders' | 'az';
export type LibraryFilter = 'all' | 'liked' | 'progress' | 'new' | 'read';

export interface StoredFile {
  fingerprint?: string;
  storageKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  webkitRelativePath: string;
}

export interface LinkedFile {
  fingerprint?: string;
  source: 'folder' | 'picker';
  name: string;
  type: string;
  size: number;
  lastModified: number;
  webkitRelativePath: string;
}

export interface NativeFile extends Omit<LinkedFile, 'source'> {
  source: 'native';
  location: string;
  protocol?: 'asset' | 'library';
}

export interface NativeLibrary {
  root: string;
  name: string;
  files: NativeFile[];
}

export type LibraryFile = (File & { fingerprint?: string }) | StoredFile | LinkedFile | NativeFile;

export interface Book {
  id: string;
  key: string;
  title: string;
  author: string;
  series?: string;
  treePath: string[];
  files: LibraryFile[];
  image: LibraryFile | null;
  parentImage: LibraryFile | null;
  coverUrl?: string | null;
  chapters: number;
  progress: number;
  started: boolean;
  liked: boolean;
  read: boolean;
  cover: {
    color: string;
    accent: string;
    motif: 'orbit' | 'mountain' | 'arch' | 'waves';
  };
}

// Persisted field names are stable across app versions and synced devices.
export interface BookProgress {
  /** Zero-based chapter index. */
  i: number;
  /** Position in seconds within that chapter. */
  t: number;
  /** Fraction of the whole book, from zero to one. */
  p: number;
}

export interface Playback {
  bookId: string;
  index: number;
  startTime: number;
  autoplay: boolean;
  token: number;
}

export interface LibraryDirectory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}
