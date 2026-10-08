import type { Book, BookProgress } from '#lib/types/library.ts';
import { store } from './storage.ts';
import {
  authorizeGoogle,
  forgetGoogle,
  invalidateGoogle,
  prepareGoogleAuth,
  type GoogleToken,
} from './googleAuth.ts';
import { DriveError, GoogleDrive, SNAPSHOT_PREFIX, type DriveAccount } from './googleDrive.ts';
import {
  bookState,
  completeBook,
  emptyState,
  maxRevision,
  mergeState,
  mergeFileState,
  sameFileState,
  type FileState,
  migrateLegacy,
  migrateFileIdentities,
  fileKey,
  parseState,
  setMark,
  setProgress,
  type SyncState,
} from './syncState.ts';

export interface SyncStatus {
  account: DriveAccount | null;
  busy: boolean;
  message: string;
  connected: boolean;
  lastSynced: number | null;
  storageError?: string;
}
export class LibrarySync {
  private state = emptyState();
  private books: Book[] = [];
  private revision = 0;
  private cachedValue: unknown;
  private cachedKey = '';
  private cachedState = emptyState();
  private storageFailed = false;
  private persisted = new Map<string, FileState>();
  private pendingWrites = new Set<string>();
  private account: DriveAccount | null = null;
  private token: GoogleToken | null = null;
  private expires = 0;
  private epoch = 0;
  private disposed = false;
  private authorizing = false;
  private writer = crypto.randomUUID();
  private fileId: string | undefined;
  private shard: string = this.writer;
  private uploaded = '';
  private snapshots = new Map<string, string>();
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private status: SyncStatus = {
    account: null,
    busy: false,
    message: 'Connect Google Drive to sync your listening across devices.',
    connected: false,
    lastSynced: null,
  };
  constructor(
    private changed: (keys?: ReadonlySet<string>) => void,
    private statusChanged: (status: SyncStatus) => void,
    private beforeAccountChange: () => Promise<void> = async () => {},
  ) {}

  private key() {
    return 'sync.state.' + (this.account?.id ?? 'offline');
  }
  private cached(refresh = false) {
    try {
      const key = this.key();
      const value = store.get<SyncState | null>(key, null);
      if (refresh || key !== this.cachedKey || value !== this.cachedValue) {
        this.cachedState = value ? parseState(value) : emptyState();
        this.persisted = new Map(Object.entries(this.cachedState.files));
        if (key !== this.cachedKey) this.pendingWrites.clear();
        this.cachedKey = key;
        this.cachedValue = value;
        for (const entryKey of store.keys(key + '.file.')) {
          try {
            const identity = decodeURIComponent(entryKey.slice((key + '.file.').length));
            const entry = this.readEntry(identity);
            if (entry)
              this.cachedState.files[identity] = mergeFileState(
                this.cachedState.files[identity],
                entry,
              );
          } catch {
            /* One corrupt journal key must not hide the rest of the library. */
          }
        }
      }
      return this.cachedState;
    } catch {
      return emptyState();
    }
  }
  private publish() {
    if (!this.disposed)
      this.statusChanged({
        ...this.status,
        message: this.storageFailed
          ? 'Changes could not be saved on this device. Free storage space and keep the app open until they sync.'
          : this.status.message,
        storageError: this.storageFailed
          ? 'Your listening progress could not be saved on this device. Free storage space and try again.'
          : undefined,
        account: this.account,
        connected: !!this.token,
      });
  }
  private mergeCached() {
    const cached = this.cached();
    if (cached !== this.cachedStateSeen) {
      this.state = mergeState(this.state, cached);
      this.revision = Math.max(this.revision, maxRevision(this.state));
      this.cachedStateSeen = cached;
    }
  }
  private cachedStateSeen: SyncState | undefined;
  private entryKey(identity: string) {
    return this.key() + '.file.' + encodeURIComponent(identity);
  }
  private readEntry(identity: string) {
    const value = store.get<FileState | null>(this.entryKey(identity), null);
    if (!value) return undefined;
    try {
      const entry = parseState({ version: 1, files: { [identity]: value } }).files[identity];
      this.persisted.set(identity, entry);
      return entry;
    } catch {
      return undefined;
    }
  }
  private persist(keys: Iterable<string> = Object.keys(this.state.files)) {
    for (const key of keys) this.pendingWrites.add(key);
    // Each checkpoint is one small synchronous record, including on pagehide.
    // Old whole-state snapshots remain readable for an upgrade without data loss.
    for (const key of this.pendingWrites) {
      const entry = this.state.files[key];
      if (!entry) {
        this.pendingWrites.delete(key);
        continue;
      }
      if (sameFileState(this.persisted.get(key), entry)) {
        this.pendingWrites.delete(key);
        continue;
      }
      const saved = this.readEntry(key);
      const merged = saved ? mergeFileState(entry, saved) : entry;
      this.state.files[key] = merged;
      if (sameFileState(this.persisted.get(key), merged) || store.set(this.entryKey(key), merged)) {
        this.persisted.set(key, merged);
        this.pendingWrites.delete(key);
      }
    }
    this.storageFailed = this.pendingWrites.size > 0;
  }
  private stamp(book: Book, chapterIndex?: number) {
    this.mergeCached();
    const files =
      chapterIndex === undefined ? book.files : book.files.slice(chapterIndex, chapterIndex + 1);
    for (const file of files) {
      const key = fileKey(file);
      const entry = this.readEntry(key);
      if (entry) {
        this.state.files[key] = mergeFileState(this.state.files[key], entry);
        this.revision = Math.max(
          this.revision,
          maxRevision({ version: 1, files: { [key]: entry } }),
        );
      }
    }
    this.revision = Math.max(Date.now(), this.revision + 1);
    return {
      at: this.revision,
      by: this.writer,
    };
  }
  private edited(patch: SyncState) {
    for (const [key, entry] of Object.entries(patch.files))
      this.state.files[key] = mergeFileState(this.state.files[key], entry);
    this.persist(Object.keys(patch.files));
    this.changed(new Set(Object.keys(patch.files)));
    if (this.account) this.status.message = 'Changes saved on this device; waiting to sync.';
    this.publish();
    this.schedule();
  }
  get(book: Book) {
    return bookState(this.state, book);
  }
  progress(book: Book, position: BookProgress) {
    const stamp = this.stamp(book, position.i);
    this.edited(setProgress(emptyState(), book, position, stamp));
  }
  mark(book: Book, kind: 'liked' | 'read', value: boolean) {
    const stamp = this.stamp(book);
    this.edited(setMark(emptyState(), book, kind, value, stamp));
  }
  recover(book: Book, position: BookProgress, at: number, ended: boolean) {
    if (!Number.isSafeInteger(at) || at <= 0) return;
    const stamp = { at, by: 'android-service' };
    this.mergeCached();
    this.revision = Math.max(this.revision, at);
    this.edited(
      ended
        ? completeBook(emptyState(), book, stamp)
        : setProgress(emptyState(), book, position, stamp),
    );
  }
  finish(book: Book) {
    const stamp = this.stamp(book);
    this.edited(completeBook(emptyState(), book, stamp));
  }
  migrate(books: Book[]) {
    this.books = books;
    this.mergeCached();
    this.state = migrateFileIdentities(this.state, books);
    // Old path-based records belong only to the original account/local library.
    const owner = store.get<string | null>('sync.legacyOwner', null);
    if (this.account && owner !== this.account.id) {
      this.persist();
      this.schedule();
      return;
    }
    this.state = migrateLegacy(this.state, books, {
      progress: store.get('progress', {}),
      likes: store.get('likes', {}),
      read: store.get('read', {}),
    });
    this.persist();
    this.schedule();
  }
  private onStorage = (event: StorageEvent) => {
    const prefix = 'abl.' + this.key() + '.file.';
    if (event.key?.startsWith(prefix)) {
      try {
        const key = decodeURIComponent(event.key.slice(prefix.length));
        const entry = this.readEntry(key);
        if (entry) this.state.files[key] = mergeFileState(this.state.files[key], entry);
        this.changed(new Set([key]));
        this.schedule();
      } catch {
        /* Ignore unrelated or malformed journal keys. */
      }
      return;
    }
    if (event.key !== 'abl.' + this.key()) return;
    this.mergeCached();
    this.state = migrateFileIdentities(this.state, this.books);
    this.changed();
    this.schedule();
  };
  private onResume = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };
  start() {
    this.account = store.get<DriveAccount | null>('sync.account', null);
    if (
      this.account &&
      (typeof this.account.id !== 'string' || typeof this.account.email !== 'string')
    )
      this.account = null;
    this.state = mergeState(emptyState(), this.cached());
    this.cachedStateSeen = this.state;
    this.revision = maxRevision(this.state);
    // Tabs share one device shard when Web Locks can serialize their uploads.
    if (navigator.locks) {
      this.shard = store.get<string>('sync.device', this.writer);
      store.set('sync.device', this.shard);
    }
    this.status.message = this.account ? 'Reconnecting Google Drive…' : this.status.message;
    this.publish();
    void prepareGoogleAuth().catch(() => {});
    window.addEventListener('online', this.onResume);
    window.addEventListener('storage', this.onStorage);
    document.addEventListener('visibilitychange', this.onResume);
    this.poll = setInterval(() => {
      if (document.visibilityState === 'visible') void this.syncNow();
    }, 30_000);
    if (this.account) void this.connect(false);
  }
  async connect(interactive = true) {
    if (this.status.busy) return;
    const epoch = ++this.epoch;
    this.authorizing = true;
    this.status.busy = true;
    this.publish();
    try {
      // Start authorization immediately while the button's user activation exists.
      const token = await authorizeGoogle(interactive, this.account?.email);
      const account = await new GoogleDrive(token.accessToken).account();
      if (this.disposed || epoch !== this.epoch) return;
      if (!interactive && this.account && account.id !== this.account.id)
        throw new Error('Reconnect Google Drive and choose ' + this.account.email + '.');
      if (this.account?.id !== account.id) await this.beforeAccountChange();
      if (this.disposed || epoch !== this.epoch) return;
      const previous = this.account;
      const local = this.state;
      this.account = account;
      this.state =
        previous?.id === account.id ? mergeState(local, this.cached(true)) : this.cached(true);
      if (!store.get<boolean>('sync.hasConnected', false) && !previous) {
        this.state = mergeState(this.state, local);
        store.set('sync.legacyOwner', account.id);
      }
      store.set('sync.hasConnected', true);
      store.set('sync.account', account);
      this.token = token;
      this.expires = Date.now() + Math.max(0, token.expiresIn - 60) * 1000;
      this.fileId = undefined;
      this.uploaded = '';
      this.snapshots.clear();
      this.state = migrateFileIdentities(this.state, this.books);
      this.revision = Math.max(this.revision, maxRevision(this.state));
      this.persist();
      this.changed();
      this.status.message = 'Google Drive connected.';
    } catch (error) {
      if (epoch === this.epoch && !this.disposed)
        this.status.message = error instanceof Error ? error.message : String(error);
    } finally {
      if (epoch === this.epoch) {
        this.authorizing = false;
        this.status.busy = false;
        this.publish();
      }
    }
    if (this.token && epoch === this.epoch) await this.syncNow();
  }
  async disconnect() {
    ++this.epoch;
    this.authorizing = true;
    try {
      await this.beforeAccountChange();
    } catch (error) {
      this.authorizing = false;
      this.status.busy = false;
      this.status.message = error instanceof Error ? error.message : String(error);
      this.publish();
      return;
    }
    this.token = null;
    this.account = null;
    this.fileId = undefined;
    this.uploaded = '';
    this.snapshots.clear();
    this.state = this.cached(true);
    store.set('sync.account', null);
    this.authorizing = false;
    this.status = {
      account: null,
      busy: false,
      message: 'Google Drive disconnected. Your local library is available offline.',
      connected: false,
      lastSynced: null,
    };
    this.changed();
    this.publish();
    try {
      await forgetGoogle();
    } catch {
      /* The account is already detached from local sync. */
    }
  }
  private schedule() {
    if (this.timer || !this.account || this.disposed) return;
    // Throttle ongoing playback rather than postponing sync until playback stops.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow();
    }, 5_000);
  }
  syncNow(): Promise<void> {
    if (this.authorizing) return Promise.resolve();
    if (this.running) return this.running;
    if (!this.account || this.disposed) return Promise.resolve();
    const task = navigator.locks
      ? navigator.locks.request('abl.google-drive-sync', () => this.performSync())
      : this.performSync();
    this.running = task;
    void task.finally(() => {
      if (this.running === task) this.running = undefined;
    });
    return task;
  }
  private async performSync() {
    if (!this.account || this.authorizing || this.disposed) return;
    const epoch = this.epoch;
    const account = this.account!;
    this.status.busy = true;
    this.publish();
    try {
      if (navigator.onLine === false)
        throw new Error('Offline. Changes will sync when your connection returns.');
      if (!this.token || Date.now() >= this.expires) {
        this.token = null;
        const token = await authorizeGoogle(false, account.email);
        const verified = await new GoogleDrive(token.accessToken).account();
        if (verified.id !== account.id)
          throw new Error('Reconnect Google Drive and choose ' + account.email + '.');
        if (epoch !== this.epoch || this.disposed) return;
        this.token = token;
        this.expires = Date.now() + Math.max(0, token.expiresIn - 60) * 1000;
      }
      const drive = new GoogleDrive(this.token.accessToken);
      const files = await drive.list();
      const present = new Set(files.map((file) => file.id));
      for (const id of this.snapshots.keys()) if (!present.has(id)) this.snapshots.delete(id);
      let remote = emptyState();
      const downloadedVersions = new Map<string, string>();
      // Bounded reads keep large libraries from flooding Drive with requests.
      for (let i = 0; i < files.length; i += 5) {
        const batch = await Promise.all(
          files.slice(i, i + 5).map(async (file) => {
            const cached = this.snapshots.get(file.id);
            // Unchanged records are already merged into local state.
            if (file.version && cached === file.version) return emptyState();
            try {
              const state = await drive.read(file.id);
              if (epoch === this.epoch && !this.disposed && file.version)
                downloadedVersions.set(file.id, file.version);
              return state;
            } catch (error) {
              if (error instanceof DriveError && error.status === 404) {
                this.snapshots.delete(file.id);
                return emptyState();
              }
              throw error;
            }
          }),
        );
        for (const state of batch) remote = mergeState(remote, state);
      }
      if (epoch !== this.epoch || this.disposed) return;
      this.mergeCached();
      this.state = migrateFileIdentities(mergeState(this.state, remote), this.books);
      // Publish versions only after every download succeeds and its data is merged.
      for (const [id, version] of downloadedVersions) this.snapshots.set(id, version);
      this.revision = Math.max(this.revision, maxRevision(this.state));
      this.persist();
      this.changed();
      const name = SNAPSHOT_PREFIX + this.shard + '.json';
      this.fileId = files.find((file) => file.name === name)?.id;
      const body = JSON.stringify(this.state);
      if (body !== this.uploaded && Object.keys(this.state.files).length) {
        try {
          this.fileId = await drive.write(this.fileId, name, this.state);
        } catch (error) {
          if (!(error instanceof DriveError && error.status === 404)) throw error;
          this.fileId = await drive.write(undefined, name, this.state);
        }
        if (epoch !== this.epoch || this.disposed) return;
        this.snapshots.delete(this.fileId!);
        this.uploaded = body;
      }
      this.status.lastSynced = Date.now();
      this.status.message = 'Synced with Google Drive.';
      if (body !== JSON.stringify(this.state)) this.schedule();
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      if (error instanceof DriveError && error.status === 401) {
        const invalid = this.token;
        this.token = null;
        if (invalid) void invalidateGoogle(invalid.accessToken).catch(() => {});
      }
      this.status.message = error instanceof Error ? error.message : String(error);
    } finally {
      if (epoch === this.epoch) {
        this.status.busy = false;
        this.publish();
      }
    }
  }
  dispose() {
    this.disposed = true;
    ++this.epoch;
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    window.removeEventListener('online', this.onResume);
    window.removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.onResume);
  }
}
