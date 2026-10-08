<script lang="ts">
  import { getContext } from 'svelte';
  import { COVER_CONTEXT, type CoverAccess } from '#lib/library/covers.ts';
  import type { Book } from '#lib/types/library.ts';
  import { observeNearViewport } from '#lib/library/visibility.ts';
  let { book, mini = false }: { book: Book; mini?: boolean } = $props();
  const covers = getContext<CoverAccess>(COVER_CONTEXT);
  let element: HTMLDivElement;
  $effect(() => covers.retain(book));
  $effect(() => {
    const item = book;
    if (item.coverUrl !== undefined || !element) return;
    return observeNearViewport(element, () => {
      void covers.load(item);
    });
  });
</script>

<div
  class="cover"
  class:mini
  class:has-image={!!book.coverUrl}
  bind:this={element}
  style:--cover-color={book.cover.color}
  style:--cover-accent={book.cover.accent}
>
  {#if book.coverUrl}<img src={book.coverUrl} alt="" decoding="async" />{:else}
    <svg class="art" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      {#if book.cover.motif === 'orbit'}
        <circle cx="100" cy="93" r="46" fill="currentColor" opacity=".13" />
        <circle cx="100" cy="93" r="33" stroke="currentColor" />
        <ellipse
          cx="100"
          cy="93"
          rx="76"
          ry="23"
          transform="rotate(-35 100 93)"
          stroke="currentColor"
        />
        <circle cx="145" cy="50" r="4" fill="currentColor" />
        <path d="M100 17v12M94 23h12M42 136h6M45 133v6" stroke="currentColor" />
      {:else if book.cover.motif === 'mountain'}
        <circle cx="145" cy="52" r="17" fill="currentColor" opacity=".5" />
        <path d="m0 150 65-102 44 70 28-45 63 77" fill="currentColor" opacity=".18" />
        <path
          d="m0 150 65-102 44 70 28-45 63 77M46 78l19 8 13-17M121 99l16 8 11-15"
          stroke="currentColor"
        />
        <path d="M12 157h176M28 165h144" stroke="currentColor" opacity=".4" />
      {:else if book.cover.motif === 'arch'}
        <path
          d="M49 162V76a51 51 0 0 1 102 0v86M63 162V77a37 37 0 0 1 74 0v85M79 162V79a21 21 0 0 1 42 0v83"
          stroke="currentColor"
        />
        <circle cx="100" cy="88" r="10" fill="currentColor" opacity=".6" />
        <path d="M35 162h130M41 170h118" stroke="currentColor" opacity=".5" />
      {:else}
        <circle cx="100" cy="58" r="24" fill="currentColor" opacity=".3" />
        {#each [91, 109, 127, 145, 163] as y (y)}
          <path d={`M-10 ${y}q27-25 55 0t55 0t55 0t55 0`} stroke="currentColor" />
        {/each}
      {/if}
    </svg>
  {/if}
  {#if !mini}
    {#if !book.coverUrl}<div class="lettering">
        <span class="author">{book.author}</span><span class="title">{book.title}</span>
      </div>{/if}
    {#if book.progress > 0 && !book.read}
      <div class="progress"><span style:width={`${book.progress}%`}></span></div>
    {/if}
  {/if}
</div>

<style>
  .cover {
    aspect-ratio: 1;
    position: relative;
    overflow: hidden;
    border-radius: 4px;
    background: var(--cover-color);
    color: var(--cover-accent);
    box-shadow: 0 1px 0 var(--line);
  }
  .cover::after {
    content: '';
    position: absolute;
    inset: 7px;
    border: 1px solid currentColor;
    opacity: 0.2;
    pointer-events: none;
  }
  .has-image::after {
    display: none;
  }
  img {
    animation: library-enter var(--motion-normal) var(--motion-ease);
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art {
    position: absolute;
    width: 100%;
    height: 100%;
    inset: 0;
    opacity: 0.8;
  }
  .lettering {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 17px 15px;
    background: linear-gradient(transparent 42%, var(--cover-color) 94%);
  }
  .author {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.55rem;
    text-align: center;
  }
  .title {
    font-family: var(--serif);
    font-size: clamp(0.95rem, 1.35vw, 1.2rem);
    font-weight: 700;
    line-height: 1.12;
    text-align: center;
    text-wrap: balance;
  }
  .progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: #0005;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--motion-normal) ease;
  }
  .mini {
    border-radius: 0;
    box-shadow: none;
  }
</style>
