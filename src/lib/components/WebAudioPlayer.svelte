<script lang="ts">
  import type { PlayerProps } from '#lib/types/player.ts';
  import type { Book, Playback } from '#lib/types/library.ts';
  import { stripExt, tidy } from '#lib/library/files.ts';
  import { libraryAudioSource } from '#lib/library/storage.ts';
  import PlayerControls from './PlayerControls.svelte';
  import { playbackProgress } from '#lib/library/progress.ts';

  let { book, playback, onprogress, onchapter, onfinish, onplay, onclose, onaccess }: PlayerProps =
    $props();
  let audio = $state<HTMLAudioElement>();
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let error = $state('');
  let active: {
    book: Book;
    command: Playback;
    url: string;
    ready: boolean;
  } | null = null;
  let lastSave = 0;
  let lastSavedPosition = 0;
  let prepareSource: (() => Promise<void>) | null = null;
  const fraction = $derived(
    duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0,
  );
  const chapter = $derived(
    book.files.length > 1
      ? `Chapter ${playback.index + 1} of ${book.files.length} · ${tidy(stripExt(book.files[playback.index].name))}`
      : book.series || 'Single file',
  );

  export function flush() {
    if (
      !audio ||
      !active?.ready ||
      Math.abs(audio.currentTime - lastSavedPosition) < 0.001 ||
      audio.ended ||
      audio.currentSrc !== active.url
    )
      return;
    lastSavedPosition = audio.currentTime;
    onprogress(
      active.book,
      playbackProgress(
        active.command.index,
        audio.currentTime,
        audio.duration,
        active.book.files.length,
      ),
    );
  }

  async function resume() {
    if (!audio) return;
    const prepare = prepareSource;
    if (!prepare) return;
    let sourceLoaded = false;
    try {
      if (!(await onaccess())) return;
      if (prepare !== prepareSource) return;
      await prepare();
      if (prepare !== prepareSource) return;
      sourceLoaded = true;
      await audio.play();
      error = '';
    } catch (failure) {
      if (prepare !== prepareSource) return;
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      if (sourceLoaded && failure instanceof DOMException && failure.name === 'NotAllowedError')
        return;
      error = 'The audio file could not be opened. Check folder access or refresh your library.';
    }
  }

  $effect(() => {
    const command = playback;
    const selected = book;
    const element = audio;
    if (!element) return;
    const source = selected.files[command.index];
    let url: string | undefined;
    let release: (() => void) | undefined;
    let cancelled = false;
    let pending: Promise<void> | undefined;
    playing = false;
    position = command.startTime;
    lastSavedPosition = command.startTime;
    duration = 0;
    error = '';
    lastSave = 0;
    const attach = (source: Awaited<ReturnType<typeof libraryAudioSource>>) => {
      if (cancelled) {
        source.release();
        return;
      }
      url = source.url;
      release = source.release;
      active = { book: selected, command, url, ready: false };
      element.src = url;
      element.playbackRate = 1;
      element.load();
    };
    prepareSource = () => {
      if (!pending) {
        pending = libraryAudioSource(source)
          .then(attach)
          .catch((failure) => {
            pending = undefined;
            throw failure;
          });
      }
      return pending;
    };
    // A restored, paused player does not open audio until Play is tapped.
    if (command.autoplay) void resume();
    return () => {
      cancelled = true;
      prepareSource = null;
      flush();
      active = null;
      element.pause();
      element.removeAttribute('src');
      element.load();
      release?.();
    };
  });

  function metadataLoaded() {
    if (!audio || !active || audio.currentSrc !== active.url) return;
    updateDuration();
    const startTime = active.command.startTime;
    // A changed or shortened file should still resume at a playable position.
    audio.currentTime = duration > 0 ? Math.min(startTime, Math.max(0, duration - 0.1)) : startTime;
    position = audio.currentTime;
    active.ready = true;
    audio.playbackRate = 1;
  }

  function updateDuration() {
    if (!audio || !active || audio.currentSrc !== active.url) return;
    duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  }

  function updateTime() {
    if (!audio || !active?.ready) return;
    position = audio.currentTime;
    if (Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      flush();
    }
  }

  function seek(event: Event) {
    if (!audio || !active?.ready) return;
    audio.currentTime = (Number((event.currentTarget as HTMLInputElement).value) / 100) * duration;
    position = audio.currentTime;
    flush();
  }

  function ended() {
    if (!active) return;
    if (active.command.index + 1 < active.book.files.length) onchapter(active.command.index + 1);
    else onfinish(active.book);
  }
</script>

<svelte:window onpagehide={flush} />
<audio
  bind:this={audio}
  preload="metadata"
  onloadedmetadata={metadataLoaded}
  ondurationchange={updateDuration}
  ontimeupdate={updateTime}
  onseeked={flush}
  onplay={() => (playing = true)}
  onpause={() => {
    playing = false;
    flush();
  }}
  onended={ended}
  onerror={() => {
    if (active && audio?.getAttribute('src'))
      error = 'This audio file cannot be played. Check folder access and the audio format.';
  }}
></audio>
<PlayerControls
  {book}
  {chapter}
  {error}
  {playing}
  {position}
  {duration}
  {fraction}
  {onclose}
  onseek={seek}
  ontoggle={() => {
    if (playing) audio?.pause();
    else onplay();
  }}
/>
