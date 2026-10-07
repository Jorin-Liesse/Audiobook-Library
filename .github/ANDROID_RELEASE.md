# Android releases

The `Release Android` workflow builds and signs APKs and an Android App Bundle
for all supported architectures, verifies the signatures, and attaches the files
and `SHA256SUMS.txt` to a GitHub release. Signed files are also retained as workflow
artifacts for 14 days.

## Signing setup

Create a signing keystore once, or reuse your existing app signing key. On Windows
with a JDK installed, run this PowerShell command and enter the requested passwords:

```powershell
keytool -genkeypair -v -keystore "$env:USERPROFILE\audiobook-library-release.jks" -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias audiobook-library
```

In the repository's **Settings → Secrets and variables → Actions**, add these
repository secrets:

| Secret                      | Value                                        |
| --------------------------- | -------------------------------------------- |
| `ANDROID_KEY_BASE64`        | Base64-encoded contents of the keystore file |
| `ANDROID_KEY_ALIAS`         | Key alias, such as `audiobook-library`       |
| `ANDROID_KEY_PASSWORD`      | Password for the key inside the keystore     |
| `ANDROID_KEYSTORE_PASSWORD` | Password for the keystore itself             |

Copy the base64 value to your clipboard using PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\audiobook-library-release.jks")) | Set-Clipboard
```

Keep a private backup of the keystore and its passwords. Reuse the same key for
future releases so Android can install updates over previous releases. Keystores
and signing properties are ignored by Git. CI restores the keystore into the
runner's temporary directory and removes it after the build.

The signing configuration follows [Tauri's Android signing guide](https://v2.tauri.app/distribute/sign/android/),
with passwords read directly from environment variables instead of a properties file.

## Publish a release

1. Set the new version in `src-tauri/tauri.conf.json`. Keep `package.json` (and its
   lockfile) and `src-tauri/Cargo.toml` versions aligned with the release.
2. Commit the changes, then create and push a matching tag:

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

The tag must be `v` followed by the Tauri configuration's version. Tags containing
a prerelease suffix, such as `v0.2.0-beta.1`, create GitHub prereleases. For Android
prerelease updates that share the same numeric version, explicitly increase
`bundle.android.versionCode` in the Tauri configuration.

You can also run **Actions → Release Android → Run workflow** and supply an
existing tag. The workflow checks out that tag and replaces its Android release
assets if the release already exists.

Install the `.apk` on a device. The `.aab` is intended for Google Play upload;
this workflow publishes to GitHub Releases.

## Background audio and media controls

Android playback uses the local `src-tauri/tauri-plugin-native-audio` plugin.
Its Media3 `PlaybackService` owns the player, chapter queue, audio focus and
wake lock. Android supplies the media notification and lock-screen controls.
The service reads the original documents using the persisted folder grant;
audio playback does not depend on WebView timers or the local HTTP server.
The existing network setup remains necessary for cover images.

The plugin's Android manifest is merged into the generated app automatically.
Do not copy its service or permissions into `src-tauri/gen/android` manually.
Both Android workflows build the plugin from source, including on a clean init.

The service saves the current chapter and position every five seconds and on
player state changes. Returning to the app reconnects its UI without restarting
playback. After Android kills the entire process, the app restores the saved
position paused; tap Play to resume. Closing the in-app player stops the service
and removes its notification.

Run `npm run check`, `npm run test:android-audio` (Node 24), and
`npm run build` before building a new APK. The bridge tests cover platform
selection, the native chapter queue, command ordering and recovery after errors;
they do not exercise the Android service itself.

### Device verification

Install a newly built APK over the existing app using the same signing key.

1. Play an audiobook, return to the home screen, and lock the phone for at
   least 30 minutes. Playback should continue and cross a chapter boundary.
2. Use the notification and lock-screen play/pause controls, seek bar and
   chapter buttons. Reopen the app and verify its position and chapter agree.
3. Reopen the activity from Recents and by tapping the notification. Audio
   should continue without reloading or jumping to the old saved position.
4. Disconnect headphones and start another audio app or a phone call. Check
   that audio focus and headphone removal pause/duck playback appropriately.
5. Pause, wait for Android to reclaim the service, then reopen and resume.
   The book should start from the saved position with no competing audio.
6. Close the in-app player. Verify audio stops and the notification disappears.
   Rapidly switch books and close the player while audio is loading; verify
   there is no orphaned playback.
7. Let a short multi-file book finish while the app is in the background. On
   return it should be marked read and reset to the beginning, paused.
8. Repeat on Android 13 or newer with notification permission denied. Media
   session notifications are exempt from the general notification permission.

Reference: [Android background playback](https://developer.android.com/media/media3/session/background-playback)
and [notification permission exemptions](https://developer.android.com/develop/ui/views/notifications/notification-permission#exemptions).
