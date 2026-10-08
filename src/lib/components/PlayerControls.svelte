<script lang="ts">
  import type { Book } from '#lib/types/library.ts';
  import BookCover from './BookCover.svelte';
  import Icon from './Icon.svelte';
  let {
    book,
    chapter,
    error,
    playing,
    position,
    duration,
    fraction,
    busy = false,
    ontoggle,
    onseek,
    onseekcommit,
    onclose,
  }: {
    book: Book;
    chapter: string;
    error: string;
    playing: boolean;
    position: number;
    duration: number;
    fraction: number;
    busy?: boolean;
    ontoggle: () => void;
    onseek: (event: Event) => void;
    onseekcommit?: () => void;
    onclose: () => void;
  } = $props();
  function timeLabel(seconds: number) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const remainder = String(total % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
      : `${minutes}:${remainder}`;
  }
</script>

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
          disabled={busy}
          aria-label={playing ? 'Pause' : 'Play'}
          onclick={ontoggle}><Icon name={playing ? 'pause' : 'play'} size={18} /></button
        >
        <input
          type="range"
          min="0"
          max="100"
          step="any"
          value={fraction}
          disabled={duration <= 0}
          oninput={onseek}
          onchange={onseekcommit}
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
