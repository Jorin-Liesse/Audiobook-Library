<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, count, children }: { title: string; count: number; children: Snippet } = $props();
</script>

<section data-library-background>
  <h2>{title}<small>{count} {count === 1 ? 'book' : 'books'}</small></h2>
  <div class="book-grid" data-library-background>{@render children()}</div>
</section>

<style>
  section {
    margin-bottom: 36px;
  }
  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 12px;
    font-family: var(--serif);
    font-weight: 700;
    font-size: 1.5rem;
    margin: 0 0 14px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }
  small {
    font-family: 'Instrument Sans', system-ui, sans-serif;
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--muted);
  }
</style>
