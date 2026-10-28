# Audiobook Library

A personal audiobook player for desktop, Android, and the web. Choose a local folder, browse your books, and pick up where you left off.

[Open the web app](https://jorin-liesse.github.io/Audiobook-Library/) · [PC demo](https://github.com/user-attachments/assets/34839b14-ed85-4f8e-9f5e-16ebf9bfb1f1) · [Mobile demo](https://github.com/user-attachments/assets/ae3a0afd-8633-4bec-beeb-8ce40cb82efc)

## Features

**Local library.** Load a folder of audiobooks with cover images and chapter files. Play, pause, seek, and resume from your saved position. Refresh the library after adding files. Audio format support depends on your device or browser.

**Search and organize.** Search by title or series. Browse by series, folder, or alphabetical order. Like books, mark them as read, and filter by liked, in progress, not started, or read.

**Google account and Drive sync.** Optionally connect your Google account to sync listening progress, likes, and read status across devices. Sync data stays in the app's hidden Google Drive folder. Keep the same audio files on each device; audio and covers stay local. Local playback works without an account.

**Legal pages.** The [Privacy Policy](https://jorin-liesse.github.io/Audiobook-Library/privacy/) explains data storage and Google access. The [Terms of Service](https://jorin-liesse.github.io/Audiobook-Library/term/) cover use of the app. Both are available from the app menu.

## Run locally

Install Node.js 24, open the repository in your terminal, and run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1420/Audiobook-Library/`. Choose your audiobook folder from the menu, then select a book to play it.

## Build

**Web**

```sh
npm run build
npm run preview
```

The website is generated in `build/` with the base path `/Audiobook-Library`.

**Desktop**

Install Rust and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Run the app during development or build an installer:

```sh
npm run tauri -- dev
npm run tauri -- build
```

Installers are written to `src-tauri/target/release/bundle/`.

**Android**

Install the Tauri Android prerequisites, including Android Studio, SDK, NDK, and Java 21. Set `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` for your installation.

```sh
npm run tauri -- android init
npm run tauri -- android dev
```

To build a debug APK:

```sh
npm run tauri -- android build --debug --apk
```

APKs are written under `src-tauri/gen/android/app/build/outputs/apk/`.

## Google sync setup

Copy `.env.example` to `.env`. Use OAuth clients from the same Google Cloud project with the Drive API enabled and the `drive.appdata` permission configured.

For web builds, set `VITE_GOOGLE_WEB_CLIENT_ID` and register your local or hosted origin. For desktop, set `VITE_GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET` if supplied. Android uses an OAuth registration matching the app package and signing certificate SHA1; the Android client ID in `.env.example` is for reference. Restart or rebuild after changing these settings.

## Working on the repo

The interface uses SvelteKit and TypeScript in `src/`. Tauri, Rust, and native Android code live in `src-tauri/`. Tests and build helpers are in `scripts/`.

Before committing changes, run:

```sh
npm run check
npm run lint
npm test
```

## Made with AI

I made this project with AI tools, using OpenAI Codex in VS Code.

See [LICENSE](LICENSE) for usage and distribution terms.
