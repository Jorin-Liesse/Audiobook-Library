<script lang="ts">
  import { resolve } from "$app/paths";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="legal">
  <header>
    <a class="brand" href={resolve("/")}>Audiobook Library</a>
    <nav aria-label="Legal pages">
      <a href={resolve("/(legal)/privacy")}>Privacy</a>
      <a href={resolve("/(legal)/term")}>Terms</a>
    </nav>
  </header>
  <main>
    <article>{@render children()}</article>
  </main>
  <footer><a href={resolve("/")}>Return to your library</a></footer>
</div>

<style>
  .legal {
    max-width: 840px;
    margin: 0 auto;
    padding: calc(24px + var(--safe-area-top)) var(--gutter-right)
      calc(32px + var(--safe-area-bottom)) var(--gutter-left);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-family: var(--serif);
    font-size: 1.3rem;
    font-weight: 700;
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: 24px;
  }
  main {
    padding: 40px 0;
  }
  .legal :global(a) {
    color: var(--ink);
    text-underline-offset: 4px;
    overflow-wrap: anywhere;
  }
  .legal :global(a:hover) {
    color: var(--accent);
  }
  article :global(h1) {
    font-family: var(--serif);
    font-size: clamp(2rem, 6vw, 3rem);
    line-height: 1.15;
    margin-bottom: 12px;
  }
  article :global(h2) {
    font-family: var(--serif);
    font-size: 1.4rem;
    line-height: 1.3;
    margin: 32px 0 12px;
  }
  article :global(p),
  article :global(ul),
  article :global(ol) {
    margin: 0 0 16px;
    line-height: 1.75;
  }
  article :global(ul),
  article :global(ol) {
    padding-left: 24px;
  }
  article :global(li) {
    margin-bottom: 8px;
  }
  article :global(.updated) {
    color: var(--muted);
    font-size: 0.9rem;
    margin-bottom: 24px;
  }
  footer {
    border-top: 1px solid var(--line);
    padding-top: 24px;
  }
</style>
