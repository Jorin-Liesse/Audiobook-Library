export type LibraryView = 'series' | 'folders' | 'az';
export type LibraryFilter = 'all' | 'liked' | 'progress' | 'new' | 'read';

export interface StoredFile {
  storageKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  webkitRelativePath: string;
}

export type LibraryFile = File | StoredFile;

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

export interface BookProgress {
  i: number;
  t: number;
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
