<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Privacy Policy | Audiobook Library</title>
  <meta
    name="description"
    content="How Audiobook Library handles local files, listening progress, and optional Google Drive synchronization."
  />
  <link rel="canonical" href="https://jorin-liesse.github.io/Audiobook-Library/privacy/" />
</svelte:head>

<h1>Privacy Policy</h1>
<p class="updated">
  Last updated: <time datetime="2026-10-08">8 October 2026</time>
</p>

<p>
  Audiobook Library is maintained by <a href="https://github.com/Jorin-Liesse">Jorin-Liesse</a>.
  This policy covers the web app and its native desktop and Android versions. The app plays
  audiobooks from a folder you choose and can optionally synchronize listening progress through your
  Google Drive account.
</p>

<h2>Files and information on your device</h2>
<p>
  The app reads the folder you select to find audio files, chapters, cover images, and embedded
  metadata. It stores a library index, file references or folder permissions, cached covers,
  preferences, listening positions, likes, and read status on your device. The web app uses local
  storage and IndexedDB; native versions also use platform storage and file permissions. The current
  app stores references to your audio files rather than importing an audio copy. Your audio and
  cover images are not uploaded by the app.
</p>
<p>
  You can use local playback without connecting a Google account. The app has no developer-operated
  backend for collecting your library or listening history, and does not include advertising,
  analytics, or tracking cookies.
</p>

<h2>Optional Google Drive synchronization</h2>
<p>
  When you select Connect Google Drive and grant permission, the app requests access to its own
  hidden application-data folder using the <code>drive.appdata</code> permission. It does not request
  access to your other Drive documents. The app reads and writes synchronization snapshots directly between
  your device and Google Drive, in your own account.
</p>
<ul>
  <li>
    <strong>Account information:</strong> Google Drive provides your account identifier, email address,
    and display name. These are cached on your device to identify the connected account and keep each
    account's saved state separate.
  </li>
  <li>
    <strong>Synced information:</strong> audio filenames and exact file sizes, playback positions and
    progress, likes, read status, edit timestamps, and randomly generated device or session identifiers
    used to merge updates. Filenames may reveal the audiobooks you listen to. Folder paths, audio content,
    and cover images are not included in these snapshots.
  </li>
  <li>
    <strong>Purpose:</strong> restore and synchronize your listening state across devices. When you connect
    an account for the first time on a device, its existing offline listening state is included in synchronization.
  </li>
</ul>
<p>
  Google user data is used only to provide these visible account and synchronization features. It is
  not sold, used for advertising, or used to train AI models. The developer does not receive copies
  of your synchronization snapshots. Audiobook Library's use and transfer of information received
  from Google APIs adheres to the
  <a href="https://developers.google.com/terms/api-services-user-data-policy"
    >Google API Services User Data Policy</a
  >, including its Limited Use requirements.
</p>

<h2>Authorization and security</h2>
<p>
  Google handles sign-in and consent; the app does not receive your Google password. Browser access
  tokens are kept in memory. Desktop refresh tokens are stored in the operating system's credential
  store. Android authorization is handled by Google Play Services. Communication with Google's
  services uses HTTPS. Local app data relies on your device and browser protections; the app does
  not add its own encryption to listening metadata.
</p>

<h2>Third-party services</h2>
<p>
  GitHub Pages hosts the website and may process technical request information, such as your IP
  address and browser details, under the
  <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
    >GitHub Privacy Statement</a
  >. The web app loads Google's sign-in library when the library app starts, which contacts Google
  even before you choose to connect. Google also processes authorization and Drive requests when you
  use synchronization, under the
  <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. These providers may
  process information outside your country.
</p>

<h2>Retention, disconnection, and deletion</h2>
<p>
  Saved library and synchronization metadata has no automatic expiry in the app. Local caches,
  including caches for previously connected accounts, can remain until you clear the app's data.
  Drive snapshots remain in your Google account until you delete them. Removing a book from your
  local folder does not automatically remove its saved listening metadata.
</p>
<ol>
  <li>
    <strong>Stop syncing:</strong> select Disconnect in the app on each connected device. Disconnecting
    stops synchronization and removes the local desktop refresh credential. It does not delete cached
    listening data or Drive snapshots, or revoke Google's authorization.
  </li>
  <li>
    <strong>Revoke permission:</strong> remove Audiobook Library's access in your
    <a href="https://myaccount.google.com/connections">Google Account connections</a>.
  </li>
  <li>
    <strong>Delete cloud metadata:</strong> in Google Drive's settings, open Manage apps, find Audiobook
    Library, and use its Options menu to delete hidden app data. Disconnect all your devices first so
    saved local metadata is not uploaded again when you reconnect.
  </li>
  <li>
    <strong>Delete local metadata:</strong> clear this website's site data in your browser, or clear the
    native app's stored data using your operating system. Clear all devices' caches before reconnecting
    if you also want to prevent old listening state from being restored. This does not delete the original
    audiobooks in your chosen folder.
  </li>
</ol>

<h2>Your choices and contact</h2>
<p>
  You control folder access and whether to enable synchronization. Depending on applicable law, you
  may have rights to access, correct, delete, or restrict use of personal data and to contact your
  local data protection authority. For privacy questions or requests, contact the maintainer through <a
    href="https://github.com/Jorin-Liesse">Jorin-Liesse's GitHub profile</a
  >. Avoid posting account details or other personal information in public discussions.
</p>

<h2>Policy changes</h2>
<p>
  Updates will appear on this page with a revised date. If Google data is to be used for a new
  purpose, the app will provide notice and request consent before that new use begins. See also the <a
    href={resolve('/(legal)/term')}>Terms of Service</a
  >.
</p>
