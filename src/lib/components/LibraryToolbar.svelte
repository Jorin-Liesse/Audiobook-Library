<script lang="ts">
  import { resolve } from '$app/paths';
  import type { LibraryFilter, LibraryView } from '#lib/types/library.ts';
  import type { SyncStatus } from '#lib/library/sync.ts';
  import DriveSync from './DriveSync.svelte';
  import Icon from './Icon.svelte';

  let {
    query = $bindable(''),
    view = $bindable('series'),
    filter = $bindable('all'),
    onchoose,
    onrefresh,
    onrescan,
    canRefresh = false,
    busy = false,
    syncStatus,
    onconnect,
    onsync,
    ondisconnect,
  }: {
    query?: string;
    view?: LibraryView;
    filter?: LibraryFilter;
    onchoose: () => void;
    onrefresh: () => void;
    onrescan: () => void;
    canRefresh?: boolean;
    busy?: boolean;
    syncStatus: SyncStatus;
    onconnect: () => void;
    onsync: () => void;
    ondisconnect: () => void;
  } = $props();
  let menuOpen = $state(false);
  let menuRoot: HTMLDivElement;
  let menuButton: HTMLButtonElement;
  const views: { value: LibraryView; label: string }[] = [
    { value: 'series', label: 'Series' },
    { value: 'folders', label: 'Folders' },
    { value: 'az', label: 'A–Z' },
  ];
</script>

<svelte:window
  onclick={(event) => {
    if (menuOpen && event.target instanceof Node && !menuRoot.contains(event.target))
      menuOpen = false;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
      menuButton.focus();
    }
  }}
/>

{#snippet layoutTabs()}
  <div class="tabs" role="group" aria-label="Layout">
    {#each views as item (item.value)}
      <button
        class:active={view === item.value}
        aria-pressed={view === item.value}
        onclick={() => {
          view = item.value;
          menuOpen = false;
        }}>{item.label}</button
      >
    {/each}
  </div>
{/snippet}

{#snippet filterSelect()}
  <div class="filter-select">
    <select bind:value={filter} aria-label="Show books">
      <option value="all">All</option><option value="liked">Liked</option>
      <option value="progress">In progress</option><option value="new">Not started</option>
      <option value="read">Read</option>
    </select>
  </div>
{/snippet}

<header class="toolbar">
  <div class="inner">
    <label class="search"
      ><Icon name="search" size={18} /><input
        type="search"
        bind:value={query}
        placeholder="Search title or series"
        aria-label="Search title or series"
      /></label
    >
    <div class="desktop">{@render layoutTabs()}</div>
    <div class="desktop">{@render filterSelect()}</div>
    <div class="menu-wrap" bind:this={menuRoot}>
      <button
        class="menu-button"
        class:filtered={filter !== 'all'}
        bind:this={menuButton}
        aria-expanded={menuOpen}
        aria-controls="library-options"
        aria-label="More options"
        onclick={() => (menuOpen = !menuOpen)}><Icon name="more" /></button
      >
      {#if menuOpen}
        <div class="menu" id="library-options">
          <div class="mobile">{@render layoutTabs()}</div>
          <div class="mobile filter-row">{@render filterSelect()}</div>
          {#if canRefresh}
            <button
              class="menu-item"
              disabled={busy}
              onclick={() => {
                menuOpen = false;
                onrefresh();
              }}
              ><span>{busy ? 'Scanning library…' : 'Refresh library'}</span><Icon
                name="refresh"
                size={18}
              /></button
            >
            <button
              class="menu-item"
              disabled={busy}
              onclick={() => {
                menuOpen = false;
                onrescan();
              }}
            >
              Rescan audio files
            </button>
          {/if}
          <button
            class="menu-item"
            disabled={busy}
            onclick={() => {
              menuOpen = false;
              onchoose();
            }}><span>Choose folder</span><Icon name="folder" size={18} /></button
          >
          <DriveSync status={syncStatus} {onconnect} {onsync} {ondisconnect} />
          <nav class="legal-links" aria-label="Legal information">
            <a
              class="menu-item"
              href={resolve('/(legal)/privacy')}
              target="_blank"
              rel="noopener noreferrer"
              onclick={() => (menuOpen = false)}>Privacy Policy</a
            >
            <a
              class="menu-item"
              href={resolve('/(legal)/term')}
              target="_blank"
              rel="noopener noreferrer"
              onclick={() => (menuOpen = false)}>Terms of Service</a
            >
          </nav>
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    padding: calc(14px + var(--safe-area-top)) var(--gutter-right) 14px var(--gutter-left);
  }
  .inner {
    max-width: 1320px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    padding: 0 12px;
    flex: 1;
    min-width: 0;
    color: var(--muted);
  }
  .search:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  input {
    width: 100%;
    min-width: 0;
    height: 40px;
    border: 0;
    outline: 0;
    background: none;
    color: var(--ink);
  }
  input::placeholder {
    color: var(--muted);
  }
  .tabs {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
  }
  .tabs button {
    height: 40px;
    padding: 0 16px;
    background: none;
    border: 0;
    color: var(--muted);
    font-weight: 500;
  }
  .tabs button.active {
    background: var(--ink);
    color: var(--bg);
  }
  .tabs button:focus-visible {
    outline-offset: -3px;
  }
  .filter-select {
    position: relative;
  }
  .filter-select::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 14px;
    width: 8px;
    height: 8px;
    border-right: 1.8px solid currentColor;
    border-bottom: 1.8px solid currentColor;
    transform: translateY(-75%) rotate(45deg);
    transition: transform 180ms ease;
    pointer-events: none;
  }
  .filter-select:has(select:open)::after {
    transform: translateY(-75%) rotate(135deg);
  }
  select {
    appearance: none;
    height: 42px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    padding: 0 36px 0 12px;
  }
  .menu-wrap {
    position: relative;
  }
  .menu-button {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    width: 260px;
    max-width: calc(100vw - 24px);
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 8px 24px #0003;
  }
  .menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: none;
    border: 0;
    border-radius: 6px;
    text-align: left;
    font-size: 0.9rem;
  }
  .menu-item:hover:not(:disabled) {
    background: var(--bg);
  }
  .legal-links {
    border-top: 1px solid var(--line);
    margin-top: 6px;
    padding-top: 6px;
  }
  .legal-links a {
    color: inherit;
    text-decoration: none;
  }
  .mobile {
    display: none;
  }
  .filter-row .filter-select,
  .filter-row select {
    width: 100%;
  }
  @media (max-width: 640px) {
    .toolbar {
      padding: calc(8px + var(--safe-area-top)) var(--gutter-right) 8px var(--gutter-left);
    }
    .inner {
      gap: 8px;
    }
    .desktop {
      display: none;
    }
    .mobile {
      display: block;
      padding: 4px;
    }
    .mobile .tabs button {
      flex: 1;
    }
    .filter-row {
      padding: 8px 0;
    }
    .filtered::after {
      content: '';
      position: absolute;
      top: 5px;
      right: 5px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--surface);
    }
  }
</style>
