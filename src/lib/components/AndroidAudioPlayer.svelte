<script lang="ts">
  import { onMount } from "svelte";
  import type { Book, BookProgress, Playback } from "#lib/types/library.ts";
  import { stripExt, tidy } from "#lib/library/files.ts";
  import {
    androidAudio,
    type AndroidPlayback,
  } from "#lib/library/androidAudio.ts";
  import BookCover from "./BookCover.svelte";
  import Icon from "./Icon.svelte";

  let {
    book,
    playback,
    onprogress,
    onfinish,
    onclose,
    onaccess,
  }: {
    book: Book;
    playback: Playback;
    onprogress: (book: Book, progress: BookProgress) => void;
    onchapter: (index: number) => void;
    onfinish: (book: Book) => void;
    onclose: () => void;
    onaccess: () => Promise<boolean>;
  } = $props();
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let currentIndex = $state(0);
  let error = $state("");
  let busy = $state(false);
  let snapshot: AndroidPlayback | null = null;
  let generation = 0;
  let finished = false;
  let lastSave = 0;
  const fraction = $derived(
    duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0,
  );
  const chapter = $derived(
    book.files.length > 1
      ? `Chapter ${currentIndex + 1} of ${book.files.length} · ${tidy(stripExt(book.files[currentIndex]?.name ?? ""))}`
      : book.series || "Single file",
  );

  function timeLabel(seconds: number) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const remainder = String(total % 60).padStart(2, "0");
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
      : `${minutes}:${remainder}`;
  }

  function persist(selected: Book, state: AndroidPlayback | null) {
    if (!state || state.bookKey !== selected.key || state.ended) return;
    const index = state.index ?? 0;
    const time = state.position ?? 0;
    const length = state.duration ?? 0;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= selected.files.length ||
      !Number.isFinite(time) ||
      time < 0 ||
      (time === 0 && index === 0)
    )
      return;
    onprogress(selected, {
      i: index,
      t: time,
      p:
        (index + (length > 0 ? Math.min(1, time / length) : 0)) /
        selected.files.length,
    });
  }

  export async function flush() {
    const selected = book;
    persist(selected, snapshot);
    try {
      // Capture the book now; a queued switch may have changed props by the reply.
      persist(selected, await androidAudio.status());
    } catch {
      // The service also checkpoints progress independently of the WebView.
    }
  }

  function apply(state: AndroidPlayback) {
    if (state.bookKey !== book.key) return;
    snapshot = state;
    currentIndex = Math.max(
      0,
      Math.min(book.files.length - 1, state.index ?? 0),
    );
    position = state.position ?? 0;
    duration = state.duration ?? 0;
    playing = state.playing;
    error = state.error
      ? "This audio file could not be played. Check folder access and the audio format."
      : "";
    if (state.ended && !finished) {
      finished = true;
      onfinish(book);
    } else if (!state.ended && Date.now() - lastSave >= 5000) {
      lastSave = Date.now();
      persist(book, state);
    }
  }

  async function refresh() {
    const token = generation;
    if (busy) return;
    try {
      const state = await androidAudio.status();
      if (token === generation) apply(state);
    } catch {
      if (token === generation)
        error =
          "The Android audio service could not be reached. Tap Play to try again.";
    }
  }

  async function resume() {
    if (busy) return;
    const token = generation;
    busy = true;
    try {
      if (!(await onaccess()) || token !== generation) return;
      const state = await androidAudio.status();
      if (token !== generation) return;
      finished = false;
      const result =
        state.active && state.bookKey === book.key && !state.ended
          ? await androidAudio.play()
          : await androidAudio.load(book, currentIndex, position);
      if (token === generation) apply(result);
    } catch (failure) {
      if (token === generation)
        error =
          failure instanceof Error
            ? failure.message
            : "The audiobook could not be opened. Check folder access.";
    } finally {
      if (token === generation) busy = false;
    }
  }

  async function pause() {
    const token = generation;
    try {
      const state = await androidAudio.pause();
      if (token === generation) {
        apply(state);
        flush();
      }
    } catch {
      if (token === generation)
        error = "Playback could not be paused. Try again.";
    }
  }

  async function seek(event: Event) {
    const target =
      (Number((event.currentTarget as HTMLInputElement).value) / 100) *
      duration;
    const token = generation;
    try {
      const state = await androidAudio.seek(target);
      if (token === generation) {
        apply(state);
        flush();
      }
    } catch {
      if (token === generation)
        error = "The playback position could not be changed.";
    }
  }

  $effect(() => {
    const command = playback;
    const selected = book;
    const token = ++generation;
    position = command.startTime;
    currentIndex = command.index;
    duration = 0;
    playing = false;
    error = "";
    busy = true;
    snapshot = null;
    finished = false;
    lastSave = 0;
    void (async () => {
      try {
        const state = await androidAudio.status();
        if (token !== generation) return;
        if (command.autoplay) {
          if (!(await onaccess()) || token !== generation) return;
          const result = await androidAudio.load(
            selected,
            command.index,
            command.startTime,
          );
          if (token === generation) apply(result);
        } else if (state.bookKey === selected.key && !state.ended) {
          // Reattach to a running service without reloading or seeking its audio.
          apply(state);
        } else if (state.active || state.ended) {
          await androidAudio.stop();
        }
      } catch {
        if (token === generation)
          error = "The audiobook could not be opened. Check folder access.";
      } finally {
        if (token === generation) busy = false;
      }
    })();
    return () => {
      ++generation;
    };
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 1000);
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
      else flush();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      flush();
    };
  });
</script>

<svelte:window onpagehide={flush} />
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
          aria-label={playing ? "Pause" : "Play"}
          onclick={() => {
            if (playing) void pause();
            else void resume();
          }}><Icon name={playing ? "pause" : "play"} size={18} /></button
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
    padding: 12px var(--gutter-right) calc(12px + var(--safe-area-bottom))
      var(--gutter-left);
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
