# Android release signing from scratch (Windows)

This project already configures signing in `scripts/configure-android-signing.mjs` and builds signed APKs and AABs through `.github/workflows/release-android.yml`. You need to create a private signing key once and add its credentials to GitHub. No paid certificate is required for APK signing.

## 1. Create your key once

Install Android Studio or a Java JDK if neither is installed. Open PowerShell. If `keytool` is available in your terminal, run:

```powershell
$keystore = Join-Path $env:USERPROFILE 'audiobook-library-release.jks'
if (Test-Path -LiteralPath $keystore) { throw 'A keystore already exists here. Reuse it; do not replace it.' }
keytool -genkeypair -v -keystore "$keystore" -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias audiobook-library
```

If PowerShell cannot find `keytool`, replace the last line with this command, adjusting the Android Studio installation path if needed:

```powershell
& 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -genkeypair -v -keystore "$keystore" -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias audiobook-library
```

Choose a strong keystore password and save it in a password manager. Enter your certificate details when asked; these details are public in the signing certificate. At the key password prompt, press Enter to use the same password as the keystore. Keep the alias `audiobook-library`.

The file is created at `C:\Users\<your-user>\audiobook-library-release.jks`, outside this repository. Back up this file and its password securely. Reuse this key for future APK releases: losing it prevents updates to installations signed with it. Do not commit the key, its Base64 encoding, or its passwords, or paste them into chat. Base64 is an encoding, not encryption.

## 2. Add the four GitHub repository secrets

In your GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**. Add repository secrets, not variables:

| Secret name | Value |
| --- | --- |
| `ANDROID_KEY_BASE64` | The Base64 contents of your keystore (copy command below). |
| `ANDROID_KEY_ALIAS` | `audiobook-library` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password you chose. |
| `ANDROID_KEY_PASSWORD` | The same password, if you pressed Enter at the key password prompt. |

Copy the keystore encoding directly to your Windows clipboard without printing it or creating another secret file:

```powershell
$keystore = Join-Path $env:USERPROFILE 'audiobook-library-release.jks'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) | Set-Clipboard
```

Paste the clipboard value into `ANDROID_KEY_BASE64`. After saving the secret, clear your clipboard with `Set-Clipboard -Value ''` and remove any retained clipboard-history entry.

## 3. Build and publish the signed release

The **Build Android** workflow creates debug APKs. Use **Release Android** for release signing.

Commit and push your intended release code first, including the release workflow. The release tag must equal `v` followed by the version in `src-tauri/tauri.conf.json`. The current version is `0.1.0`, so its tag is `v0.1.0`.

If that tag does not already exist, run from this repository:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag automatically starts **Release Android** and publishes a GitHub release with signed APKs, AABs, and checksums. This is a publishing action: use it when the code is ready to release. The workflow verifies APK and AAB signatures before publishing. Download the APK under the repository's **Releases** page when the workflow succeeds.

For an existing tag, open **Actions > Release Android > Run workflow** and enter that tag. The workflow builds the code at the tag, so the tag must already contain the release workflow and the matching Tauri version. A rerun replaces the release assets for that tag. Do not move an already published tag; increment the version and create a new tag for the next release.

Use APKs for direct installation. For Google Play, use the AAB and configure Play App Signing in Play Console.

## 4. Register the release certificate for Google Drive sign-in

Your Android Google OAuth client must match the APK's package name and signing certificate. Display the release certificate fingerprints with:

```powershell
$keystore = Join-Path $env:USERPROFILE 'audiobook-library-release.jks'
keytool -list -v -keystore "$keystore" -alias audiobook-library
```

Use the full Android Studio `keytool.exe` path from step 1 if needed. Register the displayed **SHA1** with an Android OAuth client in the same Google Cloud project as your other clients. Use the actual generated `applicationId` from `src-tauri/gen/android/app/build.gradle.kts`; do not assume the Tauri identifier is identical. For Google Play installations, also register the **app signing certificate** SHA-1 from Play Console, which can differ from this local key. See [Google Drive setup](google-drive-sync.md#android).

An existing debug installation generally cannot be updated with an APK signed by your new release key. Export or sync any important local data before uninstalling the debug app and installing the release APK.

## Optional: build locally

This requires the Tauri Android prerequisites: Rust with Android targets, Java, Android SDK/NDK, and the corresponding environment configuration. The GitHub workflow installs these on its runner for you.

From the repository, initialize Android once if `src-tauri/gen/android` does not exist:

```powershell
npm install
npm run tauri -- android init
```

Set these variables in the same PowerShell session before configuring signing and building:

```powershell
$env:ANDROID_KEYSTORE_PATH = Join-Path $env:USERPROFILE 'audiobook-library-release.jks'
$env:ANDROID_KEY_ALIAS = 'audiobook-library'
$signingPassword = Read-Host 'Keystore password' -AsSecureString
$passwordCredential = [System.Net.NetworkCredential]::new('', $signingPassword)
$env:ANDROID_KEYSTORE_PASSWORD = $passwordCredential.Password
$env:ANDROID_KEY_PASSWORD = $passwordCredential.Password
try {
    node scripts/configure-android-signing.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure Android signing.' }
    npm run tauri -- android build --apk --aab
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally {
    Remove-Item Env:ANDROID_KEYSTORE_PASSWORD, Env:ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable signingPassword, passwordCredential -ErrorAction SilentlyContinue
}
```

This assumes the key and keystore passwords are the same. These are build-time environment variables; putting them in Vite's `.env` does not configure signing. Once the script adds signing configuration, the generated Gradle project expects all four signing variables whenever Gradle configures the app, including debug builds. APK output is under `src-tauri/gen/android/app/build/outputs/apk/`, and AAB output is under `src-tauri/gen/android/app/build/outputs/bundle/`.

References: [Tauri Android signing](https://v2.tauri.app/distribute/sign/android/), [Android app signing and key management](https://developer.android.com/studio/publish/app-signing).
