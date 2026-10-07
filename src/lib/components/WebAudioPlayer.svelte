<script lang="ts">
  import type { Book, BookProgress, Playback } from '#lib/types/library.ts';
  import { stripExt, tidy } from '#lib/library/files.ts';
  import { libraryAudioSource } from '#lib/library/storage.ts';
  import BookCover from './BookCover.svelte';
  import Icon from './Icon.svelte';

  let {
    book,
    playback,
    onprogress,
    onchapter,
    onfinish,
    onclose,
    onaccess
  }: {
    book: Book;
    playback: Playback;
    onprogress: (book: Book, progress: BookProgress) => void;
    onchapter: (index: number) => void;
    onfinish: (book: Book) => void;
    onclose: () => void;
    onaccess: () => Promise<boolean>;
  } = $props();
  let audio = $state<HTMLAudioElement>();
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let error = $state('');
  let active: { book: Book; command: Playback; url: string; ready: boolean } | null = null;
  let lastSave = 0;
  let prepareSource: (() => Promise<void>) | null = null;
  const fraction = $derived(
    duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0
  );
  const chapter = $derived(
    book.files.length > 1
      ? `Chapter ${playback.index + 1} of ${book.files.length} · ${tidy(stripExt(book.files[playback.index].name))}`
      : book.series || 'Single file'
  );

  function timeLabel(seconds: number) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const remainder = String(total % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
      : `${minutes}:${remainder}`;
  }

  export function flush() {
    if (
      !audio ||
      !active?.ready ||
      audio.ended ||
      audio.currentSrc !== active.url ||
      (audio.currentTime <= 0 && active.command.index === 0)
    )
      return;
    const within =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.min(1, audio.currentTime / audio.duration)
        : 0;
    onprogress(active.book, {
      i: active.command.index,
      t: audio.currentTime,
      p: (active.command.index + within) / active.book.files.length
    });
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
<aside class="player" aria-label="Audiobook player">
  <div class="inner">
    <div class="now">
      <div class="artwork">
        {#key book.id}<BookCover {book} mini />{/key}
      </div>
      <div class="now-text">
        <b>{book.title}</b><span>{chapter}</span>
        {#if error}<span class="playback-error" role="alert">{error}</span>{/if}
      </div>
    </div>
    <div class="controls">
      <div class="transport">
        <button
          class="play"
          aria-label={playing ? 'Pause' : 'Play'}
          onclick={() => {
            if (playing) audio?.pause();
            else void resume();
          }}><Icon name={playing ? 'pause' : 'play'} size={18} /></button
        >
        <input
          type="range"
          min="0"
          max="100"
          step="any"
          value={fraction}
          disabled={duration <= 0}
          oninput={seek}
          aria-label="Playback position"
          aria-valuetext={`${timeLabel(position)} of ${timeLabel(duration)}`}
          style:--progress={fraction / 100}
        />
        <span class="position" title="Elapsed time / total file duration"
          >{timeLabel(position)} / {timeLabel(duration)}</span
        >
      </div>
    </div>
    <button
      class="close"
      type="button"
      aria-label="Close player"
      title="Close player"
      onclick={onclose}><Icon name="close" size={20} /></button
    >
  </div>
</aside>

<style>
  .player {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    border-top: 1px solid var(--line);
    background: var(--surface);
    padding: 12px var(--gutter-right) calc(12px + var(--safe-area-bottom)) var(--gutter-left);
  }
  .inner {
    max-width: 1320px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 2fr) auto;
    gap: 24px;
    align-items: center;
  }
  .now {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .artwork {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 4px;
  }
  .now-text {
    min-width: 0;
  }
  .now b {
    display: block;
    font-family: var(--serif);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now-text > span {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .now-text > .playback-error {
    color: var(--accent);
  }
  .now-text > span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0 10px 0 4px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 24px;
  }
  .play {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--ink);
    color: var(--bg);
  }
  .close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }
  .close:hover {
    background: var(--bg);
    color: var(--ink);
  }
  input {
    /* The thumb's center travels between 5px and the track width minus 5px. */
    --position: calc(5px + (100% - 10px) * var(--progress));
    appearance: none;
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(
      to right,
      var(--accent) var(--position),
      var(--line) var(--position)
    );
    flex: 1;
    width: 100%;
    min-width: 25px;
    cursor: pointer;
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 50%;
  }
  input::-moz-range-thumb {
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 50%;
    border: 0;
  }
  .position {
    color: var(--muted);
    font-size: 0.7rem;
    min-width: 3ch;
    flex-shrink: 0;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 640px) {
    .inner {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }
    .now {
      grid-column: 1;
      grid-row: 1;
    }
    .controls {
      grid-column: 1 / -1;
      gap: 6px;
    }
    .close {
      grid-column: 2;
      grid-row: 1;
    }
    .transport {
      gap: 6px;
    }
  }
</style>
