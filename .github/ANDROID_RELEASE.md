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
