import type { Book, BookProgress, LibraryFile } from '#lib/types/library.ts';

export interface Stamp<T> {
  value: T;
  at: number;
  by: string;
}
export interface FileState {
  legacyKey?: string;
  progress?: Stamp<{ t: number; fraction: number } | null>;
  liked?: Stamp<boolean>;
  read?: Stamp<boolean>;
}
export interface SyncState {
  version: 1;
  files: Record<string, FileState>;
}
export const emptyState = (): SyncState => ({ version: 1, files: {} });

// Content samples match across devices, folder layouts and file renames.
export const legacyFileKey = (file: Pick<LibraryFile, 'name' | 'size'>) =>
  JSON.stringify([file.name.normalize('NFC'), file.size]);
export const fileKey = (file: Pick<LibraryFile, 'name' | 'size' | 'fingerprint'>) =>
  file.fingerprint ? JSON.stringify([file.fingerprint, file.size]) : legacyFileKey(file);
export const newer = (a: Stamp<unknown>, b?: Stamp<unknown>) =>
  !b || a.at > b.at || (a.at === b.at && a.by > b.by);

export function parseState(value: unknown): SyncState {
  if (!value || typeof value !== 'object') throw new Error('Invalid sync data.');
  const state = value as SyncState;
  if (
    state.version !== 1 ||
    !state.files ||
    typeof state.files !== 'object' ||
    Array.isArray(state.files)
  )
    throw new Error('Unsupported sync data. Update the app on all devices.');
  const result = emptyState();
  for (const [key, fields] of Object.entries(state.files)) {
    const identity: unknown = JSON.parse(key);
    if (
      !Array.isArray(identity) ||
      identity.length !== 2 ||
      typeof identity[0] !== 'string' ||
      !Number.isSafeInteger(identity[1]) ||
      identity[1] < 0 ||
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields)
    )
      throw new Error('Invalid synced file identity.');
    const entry: FileState = {};
    if (fields.legacyKey !== undefined) {
      const legacy: unknown = JSON.parse(fields.legacyKey);
      if (
        !Array.isArray(legacy) ||
        legacy.length !== 2 ||
        typeof legacy[0] !== 'string' ||
        !Number.isSafeInteger(legacy[1]) ||
        legacy[1] < 0
      )
        throw new Error('Invalid legacy file identity.');
      entry.legacyKey = fields.legacyKey;
    }
    for (const field of ['progress', 'liked', 'read'] as const) {
      const stamp = fields[field];
      if (stamp === undefined) continue;
      if (
        !stamp ||
        !Number.isSafeInteger(stamp.at) ||
        stamp.at < 0 ||
        typeof stamp.by !== 'string' ||
        !stamp.by
      )
        throw new Error('Invalid sync revision.');
      const v = stamp.value;
      if (field === 'progress') {
        if (
          v !== null &&
          (typeof v !== 'object' ||
            !v ||
            !('t' in v) ||
            !('fraction' in v) ||
            typeof v.t !== 'number' ||
            !Number.isFinite(v.t) ||
            v.t < 0 ||
            typeof v.fraction !== 'number' ||
            !Number.isFinite(v.fraction) ||
            v.fraction < 0 ||
            v.fraction > 1)
        )
          throw new Error('Invalid synced playback position.');
      } else if (typeof v !== 'boolean') throw new Error('Invalid synced book mark.');
      Object.assign(entry, {
        [field]: { value: v, at: stamp.at, by: stamp.by },
      });
    }
    result.files[key] = entry;
  }
  return result;
}

// Independent fields merge independently. False/null revisions preserve removals.
export function mergeState(a: SyncState, b: SyncState): SyncState {
  const result: SyncState = { version: 1, files: { ...a.files } };
  for (const [key, incoming] of Object.entries(b.files)) {
    const fields = { ...result.files[key] };
    if (!fields.legacyKey && incoming.legacyKey) fields.legacyKey = incoming.legacyKey;
    for (const field of ['progress', 'liked', 'read'] as const) {
      const stamp = incoming[field];
      if (stamp && newer(stamp, fields[field])) Object.assign(fields, { [field]: stamp });
    }
    result.files[key] = fields;
  }
  return result;
}

export function maxRevision(state: SyncState) {
  let at = 0;
  for (const entry of Object.values(state.files))
    for (const stamp of Object.values(entry))
      if (stamp && typeof stamp === 'object') at = Math.max(at, stamp.at);
  return at;
}

export function bookState(state: SyncState, book: Book) {
  const entries = book.files.map((file) => state.files[fileKey(file)]);
  let latest: Stamp<{ t: number; fraction: number } | null> | undefined;
  let index = 0;
  entries.forEach((entry, i) => {
    if (entry?.progress && newer(entry.progress, latest)) {
      latest = entry.progress;
      index = i;
    }
  });
  const progress: BookProgress | null = latest?.value
    ? {
        i: index,
        t: latest.value.t,
        p: (index + latest.value.fraction) / book.files.length,
      }
    : null;
  return {
    progress,
    revision: latest,
    liked: entries.some((entry) => entry?.liked?.value === true),
    read: entries.length > 0 && entries.every((entry) => entry?.read?.value === true),
  };
}

export function setProgress(
  state: SyncState,
  book: Book,
  position: BookProgress,
  stamp: Omit<Stamp<never>, 'value'>,
) {
  const file = book.files[position.i];
  if (
    !file ||
    !Number.isInteger(position.i) ||
    !Number.isFinite(position.t) ||
    position.t < 0 ||
    !Number.isFinite(position.p)
  )
    return state;
  const key = fileKey(file);
  return mergeState(state, {
    version: 1,
    files: {
      [key]: {
        progress: {
          ...stamp,
          value: {
            t: position.t,
            fraction: Math.max(0, Math.min(1, position.p * book.files.length - position.i)),
          },
        },
      },
    },
  });
}

export function setMark(
  state: SyncState,
  book: Book,
  kind: 'liked' | 'read',
  value: boolean,
  stamp: Omit<Stamp<never>, 'value'>,
) {
  const files: Record<string, FileState> = {};
  for (const file of book.files) files[fileKey(file)] = { [kind]: { ...stamp, value } };
  return mergeState(state, { version: 1, files });
}

export function completeBook(state: SyncState, book: Book, stamp: Omit<Stamp<never>, 'value'>) {
  const files: Record<string, FileState> = {};
  for (const file of book.files)
    files[fileKey(file)] = {
      progress: { ...stamp, value: null },
      read: { ...stamp, value: true },
    };
  return mergeState(state, { version: 1, files });
}

export function migrateLegacy(
  state: SyncState,
  books: Book[],
  legacy: {
    progress: Record<string, BookProgress>;
    likes: Record<string, number>;
    read: Record<string, number>;
  },
) {
  let result = emptyState();
  const stamp = { at: 1, by: 'legacy' };
  for (const book of books) {
    const position = legacy.progress[book.key];
    if (position) result = setProgress(result, book, position, stamp);
    if (legacy.likes[book.key]) result = setMark(result, book, 'liked', true, stamp);
    if (legacy.read[book.key]) result = setMark(result, book, 'read', true, stamp);
  }
  return mergeState(result, state);
}

// Copy old identities only when they identify one distinct file in this catalogue.
export function migrateFileIdentities(state: SyncState, books: Book[]) {
  const candidates = new Map<string, Set<string>>();
  for (const book of books)
    for (const file of book.files) {
      const oldKey = legacyFileKey(file);
      const keys = candidates.get(oldKey) ?? new Set<string>();
      keys.add(fileKey(file));
      candidates.set(oldKey, keys);
    }
  const owners = new Map<string, Set<string>>();
  for (const [key, entry] of Object.entries(state.files)) {
    if (!entry.legacyKey) continue;
    const claims = owners.get(entry.legacyKey) ?? new Set<string>();
    claims.add(key);
    owners.set(entry.legacyKey, claims);
  }
  const migrated = emptyState();
  for (const [oldKey, keys] of candidates) {
    if (keys.size !== 1 || !state.files[oldKey]) continue;
    const [key] = keys;
    const claims = owners.get(oldKey);
    if (claims && (claims.size !== 1 || !claims.has(key))) continue;
    if (key !== oldKey) migrated.files[key] = { ...state.files[oldKey], legacyKey: oldKey };
  }
  return mergeState(migrated, state);
}
