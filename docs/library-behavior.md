# Library behavior

Books below 0.1% progress appear under **Not started**. At 0.1% they appear under **In progress**. Their saved playback position is retained. Books marked read appear under **Read** regardless of progress.

Liking or marking a book does not select it or interrupt playback. Android progress is captured before the player is stopped during a library refresh or replacement.

File identities use SHA-256 of up to three 64 KiB content samples plus file length. Matching works across folders and file renames without loading complete audiobooks into memory. Sampling reduces accidental filename/size collisions; it is not a full-file integrity checksum. Cached libraries gain fingerprints when file access is available. Legacy progress migrates only when its filename/size identity is unambiguous and has not already been claimed by a different fingerprint. Use the updated app on every device for the new identities to sync consistently.

Progress-save failures appear above the library as well as in sync status. Keep the app open and retry after freeing storage space; unsaved positions remain in memory. Missing covers from successful tag reads are cached for one day. Read errors and timeouts are retried on a later launch or library refresh.

Run npm run check, npm run lint, npm test, and npm run build before release. All build/deploy workflows run the frontend checks and tests using dependencies from the lockfile.
