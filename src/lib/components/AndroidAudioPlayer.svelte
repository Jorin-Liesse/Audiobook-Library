<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlayerProps } from '#lib/types/player.ts';
  import type { Book } from '#lib/types/library.ts';
  import { stripExt, tidy } from '#lib/library/files.ts';
  import { androidAudio, type AndroidPlayback } from '#lib/library/androidAudio.ts';
  import PlayerControls from './PlayerControls.svelte';
  import { playbackProgress } from '#lib/library/progress.ts';
  import { createLatestTask } from '#lib/library/latestTask.ts';

  let { book, playback, onprogress, onfinish, onplay, onclose, onaccess }: PlayerProps = $props();
  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let currentIndex = $state(0);
  let error = $state('');
  let busy = $state(false);
  let snapshot: AndroidPlayback | null = null;
  let generation = 0;
  let finished = false;
  let attached = false;
  let lastSave = 0;
  let lastSavedPosition = 0;
  let lastSavedIndex = 0;
  const fraction = $derived(
    duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0,
  );
  const chapter = $derived(
    book.files.length > 1
      ? `Chapter ${currentIndex + 1} of ${book.files.length} · ${tidy(stripExt(book.files[currentIndex]?.name ?? ''))}`
      : book.series || 'Single file',
  );

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
      (index === lastSavedIndex && Math.abs(time - lastSavedPosition) < 0.001)
    )
      return;
    lastSavedPosition = time;
    lastSavedIndex = index;
    onprogress(selected, playbackProgress(index, time, length, selected.files.length));
  }

  export async function flush() {
    if (!attached) return;
    await seeks.flush();
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
    currentIndex = Math.max(0, Math.min(book.files.length - 1, state.index ?? 0));
    position = state.position ?? 0;
    duration = state.duration ?? 0;
    playing = state.playing;
    error = state.error
      ? 'This audio file could not be played. Check folder access and the audio format.'
      : '';
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
    if (busy || !attached || seeks.pending) return;
    try {
      const state = await androidAudio.status();
      if (token === generation) apply(state);
    } catch {
      if (token === generation)
        error = 'The Android audio service could not be reached. Tap Play to try again.';
    }
  }

  async function pause() {
    const token = generation;
    await seeks.flush();
    if (token !== generation) return;
    try {
      const state = await androidAudio.pause();
      if (token === generation) {
        apply(state);
        flush();
      }
    } catch {
      if (token === generation) error = 'Playback could not be paused. Try again.';
    }
  }

  const seeks = createLatestTask<{ target: number; token: number }>(async ({ target, token }) => {
    if (token !== generation) return;
    try {
      const state = await androidAudio.seek(target);
      if (token === generation) {
        apply(state);
        persist(book, state);
      }
    } catch {
      if (token === generation) error = 'The playback position could not be changed.';
    }
  });

  function seek(event: Event) {
    position = (Number((event.currentTarget as HTMLInputElement).value) / 100) * duration;
    seeks.schedule({ target: position, token: generation });
  }

  $effect(() => {
    const command = playback;
    const selected = book;
    seeks.cancel();
    const token = ++generation;
    position = command.startTime;
    lastSavedPosition = command.startTime;
    lastSavedIndex = command.index;
    currentIndex = command.index;
    duration = 0;
    playing = false;
    error = '';
    busy = true;
    snapshot = null;
    attached = false;
    finished = false;
    lastSave = 0;
    void (async () => {
      try {
        const state = await androidAudio.status();
        if (token !== generation) return;
        if (command.autoplay) {
          if (!(await onaccess()) || token !== generation) return;
          attached = true;
          const result = await androidAudio.load(selected, command.index, command.startTime);
          if (token === generation) apply(result);
        } else if (state.bookKey === selected.key && state.playing && !state.ended) {
          attached = true;
          // Reattach to a running service without reloading or seeking its audio.
          apply(state);
        } else if (state.active || state.ended) {
          await androidAudio.stop();
        }
      } catch {
        if (token === generation) error = 'The audiobook could not be opened. Check folder access.';
      } finally {
        if (token === generation) busy = false;
      }
    })();
    return () => {
      seeks.cancel();
      ++generation;
    };
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 1000);
    const visibility = () => {
      if (document.visibilityState === 'visible') void refresh();
      else flush();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      flush();
    };
  });
</script>

<svelte:window onpagehide={flush} />
<PlayerControls
  {book}
  {chapter}
  {error}
  {playing}
  {position}
  {duration}
  {fraction}
  {busy}
  {onclose}
  onseek={seek}
  onseekcommit={() => {
    void seeks.flush();
  }}
  ontoggle={() => {
    if (playing) void pause();
    else onplay();
  }}
/>
