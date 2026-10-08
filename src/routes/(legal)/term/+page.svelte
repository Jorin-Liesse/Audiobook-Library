<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Terms of Service | Audiobook Library</title>
  <meta
    name="description"
    content="Terms for using Audiobook Library's local audiobook player and optional Google Drive synchronization."
  />
  <link rel="canonical" href="https://jorin-liesse.github.io/Audiobook-Library/term/" />
</svelte:head>

<h1>Terms of Service</h1>
<p class="updated">
  Last updated: <time datetime="2026-10-08">8 October 2026</time>
</p>

<p>
  These terms cover your use of Audiobook Library, maintained by
  <a href="https://github.com/Jorin-Liesse">Jorin-Liesse</a>, including the web, desktop, and
  Android versions. By using the app, you agree to these terms. If you do not agree, stop using it.
</p>

<h2>Using the app</h2>
<p>
  Audiobook Library organizes and plays audio files from a folder you choose. It does not supply
  audiobooks or grant rights to any content. Only use files you own or are authorized to access, and
  comply with applicable laws and the rights of authors, publishers, and other rights holders. You
  retain your rights to your files. Selecting a folder allows the app to read it to provide library
  and playback features.
</p>

<h2>Google Drive and other services</h2>
<p>
  Google Drive synchronization is optional and requires your authorization. You are responsible for
  your Google account and for deciding which devices may access it. Google's terms apply to its
  services. GitHub's terms apply to its hosting services. These services may change, become
  unavailable, or restrict access independently of Audiobook Library.
</p>
<p>
  Synchronization saves listening metadata; it is not an audio backup service. Matching uses
  filenames and file sizes, and conflicting edits are merged using their timestamps. Matches and
  updates may be incorrect or delayed. Keep your own backups of important files and do not rely on
  synchronization as your only record of progress.
</p>

<h2>Responsible use</h2>
<p>
  Do not use the app to infringe copyright, access someone else's files or account without
  permission, interfere with services, or bypass access controls. Use the app only when you can
  lawfully accept these terms; where required, a parent or guardian must authorize its use.
</p>

<h2>Privacy</h2>
<p>
  The <a href={resolve('/(legal)/privacy')}>Privacy Policy</a> explains local storage, optional Google
  access, third-party services, and how to disconnect or delete saved metadata. You can stop using the
  app and revoke its permissions at any time.
</p>

<h2>Availability and warranties</h2>
<p>
  To the extent permitted by applicable law, the app is provided "as is" and "as available", without
  warranties of merchantability, fitness for a particular purpose, or non-infringement.
  Uninterrupted operation, compatibility with every device or file, and accurate or permanent
  storage of listening progress are not guaranteed. Features may be updated or discontinued.
</p>

<h2>Liability and your legal rights</h2>
<p>
  To the extent permitted by applicable law, the maintainer is not liable for indirect or
  consequential losses, loss of data, or loss arising from unavailable third-party services. Nothing
  in these terms excludes liability that cannot legally be excluded or limits mandatory consumer
  rights or remedies available to you under applicable law.
</p>

<h2>Changes and contact</h2>
<p>
  Revised terms will be posted here with an updated date. Material changes will be communicated
  through the app or its release notes before they take effect. For questions, contact the
  maintainer through <a href="https://github.com/Jorin-Liesse">Jorin-Liesse's GitHub profile</a>.
</p>
