# Google Drive sync

The app sends listening positions, likes, read status, and filename/byte-size identities directly to Google Drive. Each Google account has its own hidden appDataFolder, accessible only to this app. There is no hosted backend, shared developer Drive, service account, or audio upload. The only requested Google scope is https://www.googleapis.com/auth/drive.appdata.

## Google Cloud configuration

Use **one Google Cloud project for every platform** so they access the same app-data space.

1. Enable the **Google Drive API** in that project.
2. Configure the Google Auth Platform consent screen (branding, audience, and required privacy information). Add the drive.appdata scope. While the project is in Testing, add every account you test with as a test user. Google may expire testing authorizations; publish the consent configuration when ready for production.
3. Create OAuth clients for the platforms you ship, all inside that project.

Copy `.env.example` to `.env` and fill in your platform client IDs. Both Vite and the desktop Rust build read `.env`; `.env.local` overrides it, and environment variables override the same keys in either file. Restart development or rebuild the native app after changing OAuth settings.

### Browser / PWA

Create a **Web application** OAuth client. Add each exact app origin, including its port, to Authorized JavaScript origins. For local development, use http://localhost:1420 and http://127.0.0.1:1420 if you use both. Production must use HTTPS.

Copy .env.example to .env and set VITE_GOOGLE_WEB_CLIENT_ID to that web client ID, then rebuild/restart Vite. This is a public client ID; do not put a web client secret into the frontend.

Browser authorization uses Google Identity Services' token flow. Tokens stay in memory. Google requires a user gesture to obtain another token, so the app shows **Reconnect** after token expiry or a browser reload. Native Android and desktop builds can renew access automatically. A website cannot guarantee permanent silent Google authorization without a backend or an installed-app identity flow.

### Android

Create an **Android** OAuth client with the generated application's actual applicationId/package name and its SHA-1 signing certificate fingerprint. Check src-tauri/gen/android/app/build.gradle.kts for applicationId; the Tauri identifier is com.sapodillagames.audiobook-library, but the generated Android package can normalize punctuation. Register debug, release, and Google Play signing certificates as appropriate, using clients in the same project.

`VITE_GOOGLE_ANDROID_CLIENT_ID` can be kept in `.env` as a reference to the Android OAuth registration. Google's native AuthorizationClient does not accept an Android client ID parameter: Play Services identifies the installed app by its package name and signing certificate, and selects the matching client registered in Google Cloud. Setting this variable does not replace registering the correct package and SHA-1.

The google-drive Tauri plugin uses Google's native AuthorizationClient and only requests app-data access. Google Play Services handles the account picker, consent, and renewal. No client secret or server authorization code is needed for Android. Test on a device/emulator with Google Play Services. Regenerate/build through Tauri so the new local plugin is included in the Android project.

### Desktop (Windows, macOS, Linux)

Create a **Desktop app** OAuth client. Set these values in the project-root `.env` using its downloaded OAuth configuration:

```dotenv
VITE_GOOGLE_DESKTOP_CLIENT_ID=your-desktop-client-id.apps.googleusercontent.com
GOOGLE_DESKTOP_CLIENT_SECRET=your-desktop-client-secret
```

Include `GOOGLE_DESKTOP_CLIENT_SECRET` if the downloaded desktop configuration contains `client_secret`. Keep the secret without a `VITE_` prefix so it is not exposed to frontend code. The Rust build loads these values automatically for both `npm run tauri -- dev` and `npm run tauri -- build`. It watches `.env`, `.env.local`, and the corresponding environment variables for changes. The legacy `GOOGLE_DESKTOP_CLIENT_ID` is still accepted as a fallback when `VITE_GOOGLE_DESKTOP_CLIENT_ID` is blank or absent. Installed-app credentials are public application identifiers and cannot be treated as a confidential server secret.

Desktop sign-in opens the system browser and uses PKCE, a random state value, and a temporary 127.0.0.1 listener on a random port. The listener shuts down after sign-in or three minutes. Refresh tokens remain in the OS credential store (Windows Credential Manager, macOS Keychain, or Linux Secret Service), outside browser storage. Linux builds need a working Secret Service/DBus environment. Disconnect removes the local desktop refresh credential and stops synchronization; it leaves existing Drive data intact.

The iOS target has no native Google authorization implementation yet.

## Use on two devices

1. Choose the local audiobook folder on each device.
2. Select **Connect Google Drive** and grant access using the same Google account on both devices.
3. Listen, like, or mark a book read. Pending edits are uploaded after up to five seconds while the app is running; other active devices poll every thirty seconds. Returning to the app or coming online also triggers sync. **Sync now** runs it immediately.
4. Open the matching book on the other device to resume at its saved chapter and timestamp.

Each device must grant its own local file permissions. Cloud sync cannot grant access to another device's filesystem. Existing progress and marks are migrated to portable identities. The first account connected receives that device's existing offline state; switching to another account loads a separate cache and does not copy the previous account's state. Disconnect returns to the independent offline library state.

## File matching and conflicts

Files match by **full basename (including extension, Unicode NFC normalized) plus exact byte size**. Paths, parent folders, modification times, and book titles are ignored. This also maps the saved chapter into the other device's local chapter ordering/grouping. Audio files do not need to be read or hashed. Two unrelated files with identical names and byte sizes cannot be distinguished by this rule. Re-encoding or renaming an audiobook creates a different identity.

Each metadata field has a timestamp and writer ID. The latest edit wins per field, including intentional backwards seeks; ties resolve deterministically. Clearing a like/read mark and finishing a book create explicit false/null revisions so older devices cannot resurrect them. Devices retain records for files not currently in their local library. A grouped book is liked when any of its files is liked, and read when all its files are read.

Devices write separate JSON snapshots inside appDataFolder, read all snapshots before writing, and merge field revisions. With Web Locks, tabs on one installation serialize access to a persistent device snapshot. Environments without Web Locks use separate session snapshots to avoid concurrent overwrites. Corrupt or unsupported remote documents block uploads and preserve local edits. Offline edits remain cached under the account that made them and retry while the app runs. Playback itself stays local; sync does not interrupt audio playing on another device.

The app only syncs while running. Android's native audio service checkpoints background playback locally; those checkpoints merge when the app returns. Closing the app before a pending upload finishes can delay that update until the next launch.

## Validation

Run npm run check, npm run test:drive-sync, npm run test:android-audio, and npm run build. Native changes also require a desktop cargo check and an Android build on a configured machine.

For a live test, use the same project and account on desktop and Android, with matching audio filenames/sizes under different folders. Check resume, likes, read/unread, offline edits, backwards seeks, account switching, and token renewal. Confirm that normal Drive UI has no new folder and that consent only requests app-data access. Live OAuth needs real Cloud clients and a signing certificate; mocked tests cannot validate that configuration.

References: [Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata), [Android authorization](https://developer.android.com/identity/authorization), [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [browser token flow](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
