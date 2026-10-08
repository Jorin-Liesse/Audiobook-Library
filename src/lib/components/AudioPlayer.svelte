<script lang="ts">
  import type { PlayerProps, PlayerHandle } from '#lib/types/player.ts';
  import { isAndroidApp } from '#lib/library/androidAudio.ts';
  import AndroidAudioPlayer from './AndroidAudioPlayer.svelte';
  import WebAudioPlayer from './WebAudioPlayer.svelte';

  let props: PlayerProps = $props();
  const Player = isAndroidApp() ? AndroidAudioPlayer : WebAudioPlayer;
  let player: PlayerHandle | undefined = $state();
  export function flush() {
    return player?.flush();
  }
</script>

<Player {...props} bind:this={player} />
