<script lang="ts">
  import type { Book } from '#lib/types/library.ts';
  import BookCover from './BookCover.svelte';
  import Icon from './Icon.svelte';
  let {
    book,
    playing = false,
    index = 0,
    onopen,
    onmark,
  }: {
    book: Book;
    playing?: boolean;
    index?: number;
    onopen: (book: Book) => void;
    onmark: (id: string, kind: 'liked' | 'read') => void;
  } = $props();
</script>

<article
  class="card"
  data-book-id={book.id}
  class:read={book.read}
  class:playing
  style:--enter-delay={`${Math.min(index, 9) * 25}ms`}
>
  <button class="open" onclick={() => onopen(book)} aria-label={`Play ${book.title}`}>
    <div class="cover-wrap"><BookCover {book} /></div>
    <span class="title">{book.title}</span>
  </button>
  <div class="marks">
    <button
      class="mark heart"
      class:on={book.liked}
      onclick={() => onmark(book.id, 'liked')}
      aria-pressed={book.liked}
      aria-label={`${book.liked ? 'Unlike' : 'Like'} ${book.title}`}
      title={book.liked ? 'Remove from liked' : 'Add to liked'}
      ><Icon name="heart" size={17} /></button
    >
    <button
      class="mark check"
      class:on={book.read}
      onclick={() => onmark(book.id, 'read')}
      aria-pressed={book.read}
      aria-label={`Mark ${book.title} as ${book.read ? 'not read' : 'read'}`}
      title={book.read ? 'Mark as not read' : 'Mark as read'}
      ><Icon name="check" size={18} /></button
    >
  </div>
</article>

<style>
  .card {
    position: relative;
    min-width: 0;
    animation: library-enter 360ms var(--motion-ease) var(--enter-delay) backwards;
  }
  .open {
    display: block;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
  }
  .cover-wrap {
    border-radius: 4px;
    transition:
      transform var(--motion-normal) var(--motion-ease),
      opacity var(--motion-normal) ease;
  }
  .open:active .cover-wrap {
    transform: scale(0.98);
  }
  .read .cover-wrap {
    opacity: 0.6;
  }
  .playing .cover-wrap {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .playing .title {
    color: var(--accent);
  }
  .title {
    transition: color var(--motion-fast) ease;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    margin-top: 8px;
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.3;
    min-height: 2.6em;
  }
  .marks {
    position: absolute;
    top: 6px;
    left: 6px;
    right: 6px;
    display: flex;
    justify-content: space-between;
    gap: 4px;
    pointer-events: none;
    transition: gap 0.15s;
  }
  .mark {
    pointer-events: auto;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: #0f1614bf;
    color: white;
    padding: 0;
    transition:
      opacity var(--motion-fast) ease,
      background-color var(--motion-fast) ease,
      transform var(--motion-fast) var(--motion-ease);
  }
  .mark.on :global(svg) {
    animation: mark-pop 320ms var(--motion-ease);
  }
  .check.on {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .heart.on {
    background: #c4455a;
  }
  .heart.on :global(svg) {
    fill: currentColor;
  }
  @media (hover: hover) {
    .marks {
      gap: 0;
    }
    .mark:not(.on) {
      opacity: 0;
      pointer-events: none;
    }
    .card:hover .marks,
    .card:focus-within .marks {
      gap: 4px;
    }
    .card:hover .mark,
    .card:focus-within .mark {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
