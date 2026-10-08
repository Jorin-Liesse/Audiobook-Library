<script lang="ts">
  import type { Book } from '#lib/types/library.ts';
  import BookCover from './BookCover.svelte';
  let {
    name,
    books,
    subfolders = 0,
    onopen,
  }: { name: string; books: Book[]; subfolders?: number; onopen: () => void } = $props();
</script>

<button class="tile" onclick={onopen} aria-label={`Open ${name}, ${books.length} books`}>
  <div class="mosaic" class:one={books.length === 1}>
    {#each books.slice(0, 4) as book (book.id)}<BookCover {book} mini />{/each}
  </div>
  <span class="title">{name}</span>
  <span class="meta"
    >{#if subfolders}{subfolders} {subfolders === 1 ? 'folder' : 'folders'} ·
    {/if}{books.length}
    {books.length === 1 ? 'book' : 'books'}</span
  >
</button>

<style>
  .tile {
    display: block;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
  }
  .mosaic {
    aspect-ratio: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 3px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--line);
    box-shadow: 0 0 0 1px var(--line);
  }
  .mosaic.one {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }
  .title {
    display: block;
    margin-top: 8px;
    font-family: var(--serif);
    font-weight: 700;
    font-size: 1rem;
  }
  .meta {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
