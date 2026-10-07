<script lang="ts">
  import type { Book, BookProgress, Playback } from "#lib/types/library.ts";
  import { isAndroidApp } from "#lib/library/androidAudio.ts";
  import AndroidAudioPlayer from "./AndroidAudioPlayer.svelte";
  import WebAudioPlayer from "./WebAudioPlayer.svelte";

  let props: {
    book: Book;
    playback: Playback;
    onprogress: (book: Book, progress: BookProgress) => void;
    onchapter: (index: number) => void;
    onfinish: (book: Book) => void;
    onclose: () => void;
    onaccess: () => Promise<boolean>;
  } = $props();
  const Player = isAndroidApp() ? AndroidAudioPlayer : WebAudioPlayer;
  let player: { flush: () => void | Promise<void> } | undefined = $state();
  export function flush() {
    return player?.flush();
  }
</script>

<Player {...props} bind:this={player} />
