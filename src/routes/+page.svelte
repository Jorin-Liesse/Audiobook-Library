<script lang="ts">
  import BookCard from '#lib/components/BookCard.svelte';
  import BookSection from '#lib/components/BookSection.svelte';
  import FolderTile from '#lib/components/FolderTile.svelte';
  import LibraryToolbar from '#lib/components/LibraryToolbar.svelte';
  import LibraryEmptyState from '#lib/components/LibraryEmptyState.svelte';
  import AudioPlayer from '#lib/components/AudioPlayer.svelte';
  import type { Book } from '#lib/types/library.ts';
  import { createLibraryController } from '#lib/library/controller.svelte.ts';
  import { observeNearViewport } from '#lib/library/visibility.ts';
  const library = createLibraryController();
  const autoLoadSupported = typeof IntersectionObserver !== 'undefined';
  let loadMoreTarget = $state<HTMLDivElement>();

  $effect(() => {
    const renderedCount = library.renderedBooks.length;
    const target = loadMoreTarget;
    if (!autoLoadSupported || !library.hasMore || !target) return;
    return observeNearViewport(target, () => {
      // Ignore repeated notifications until the appended cards have rendered.
      if (library.renderedBooks.length === renderedCount) library.loadMore();
    });
  });
</script>

<svelte:head>
  <meta name="description" content="Audiobook Library" />
</svelte:head>

{#snippet bookCard(book: Book)}
  <BookCard
    {book}
    playing={library.selectedBook?.id === book.id}
    onopen={library.openBook}
    onmark={library.toggleMark}
  />
{/snippet}

<input
  class="sr-only"
  type="file"
  tabindex="-1"
  aria-label="Audiobook folder"
  bind:this={library.folderInput}
  multiple
  {...{ webkitdirectory: true }}
  onchange={library.loadPickedFiles}
/>
<div class="library" class:with-player={library.selectedBook !== undefined}>
  <LibraryToolbar
    bind:query={library.query}
    bind:view={library.view}
    bind:filter={library.filter}
    onchoose={library.chooseFolder}
    onrefresh={() => library.refreshLibrary()}
    onrescan={library.rescanLibrary}
    canRefresh={!!library.libraryName}
    busy={library.loading}
    syncStatus={library.syncStatus}
    onconnect={() => {
      void library.connect();
    }}
    onsync={() => {
      void library.syncNow();
    }}
    ondisconnect={() => {
      void library.disconnect();
    }}
  />
  <main>
    {#if library.error || library.syncStatus.storageError}<p class="error" role="alert">
        {library.error || library.syncStatus.storageError}
      </p>{/if}
    {#if library.loading && !library.books.length}
      <LibraryEmptyState
        title="Scanning your library…"
        message="Finding audiobooks in your folder and its subfolders."
      />
    {:else if library.books.length === 0}
      {#if library.savedHandle && !library.libraryName}
        <LibraryEmptyState
          title="Welcome back"
          message={`Your library ${library.savedHandle.name} is remembered. Reopen it to grant access to your files.`}
          actionLabel="Reopen library"
          onaction={library.reopenFolder}
        />
      {:else}
        <LibraryEmptyState
          title={library.libraryName ? 'No audiobooks found' : 'Your next story starts here'}
          message={library.libraryName
            ? 'Choose a folder containing audio files to fill your library.'
            : 'Choose your audiobook folder. Audio files in its subfolders are included; your files stay on your device.'}
          actionLabel="Choose folder"
          onaction={library.chooseFolder}
        />
      {/if}
    {:else if library.visibleBooks.length === 0}
      <LibraryEmptyState
        title="No matches"
        message="Try another title or series name, or change the filter."
        actionLabel="Clear search and filters"
        onaction={library.clearFilters}
      />
    {:else if library.view === 'folders'}
      <nav class="crumbs" aria-label="Folder path">
        {#each library.folders.crumbs as crumb, index (crumb.path.join('/'))}
          {#if index > 0}<span class="divider">/</span>{/if}
          {#if index === library.folders.crumbs.length - 1}<span aria-current="page"
              >{crumb.label}</span
            >
          {:else}<button onclick={() => library.navigateFolder(crumb.path)}>{crumb.label}</button
            >{/if}
        {/each}
      </nav>
      {#if library.folders.folders.length}
        <div class="folder-group">
          {#if library.folders.books.length}<h2 class="folder-heading">Folders</h2>{/if}
          <div class="book-grid">
            {#each library.folders.folders as folder (folder.path.join('/'))}
              <FolderTile
                name={folder.name}
                books={folder.books}
                count={folder.count}
                subfolders={folder.subfolders}
                onopen={() => library.navigateFolder(folder.path)}
              />
            {/each}
          </div>
        </div>
      {/if}
      {#if library.folders.books.length}
        {#if library.folders.folders.length}<h2 class="folder-heading">Books</h2>{/if}
        <div class="book-grid">
          {#each library.renderedBooks as book (book.id)}{@render bookCard(book)}{/each}
        </div>
      {/if}
    {:else}
      {#each library.sections as group (group.name)}
        <BookSection title={group.name} count={group.books.length}
          >{#each group.books as book (book.id)}{@render bookCard(book)}{/each}</BookSection
        >
      {/each}
    {/if}
    {#if library.hasMore}
      <div class="load-more" bind:this={loadMoreTarget}>
        {#if autoLoadSupported}
          <span class="sr-only">More books load as you scroll.</span>
        {:else}
          <button onclick={library.loadMore}>Load more books</button>
        {/if}
      </div>
    {/if}
  </main>
  {#if library.selectedBook && library.playback}
    <AudioPlayer
      bind:this={library.player}
      book={library.selectedBook}
      playback={library.playback}
      onprogress={library.saveProgress}
      onchapter={(index) => {
        if (library.selectedBook) void library.startBook(library.selectedBook, index);
      }}
      onfinish={library.finishBook}
      onplay={() => {
        if (library.selectedBook) void library.openBook(library.selectedBook);
      }}
      onclose={library.closePlayer}
      onaccess={library.ensureLibraryAccess}
    />
  {/if}
</div>

<style>
  .library {
    min-height: 100dvh;
    padding-bottom: calc(32px + var(--safe-area-bottom));
  }
  .with-player {
    padding-bottom: calc(120px + var(--safe-area-bottom));
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 28px var(--gutter-right) 28px var(--gutter-left);
  }
  .load-more {
    display: flex;
    justify-content: center;
    min-height: 2px;
    margin-top: 24px;
  }
  .load-more button {
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--surface);
    color: inherit;
    padding: 8px 16px;
  }
  .error {
    color: var(--accent);
    margin-bottom: 16px;
  }
  .folder-group {
    margin-bottom: 36px;
  }
  .folder-heading {
    font-family: var(--serif);
    font-size: 1.5rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 6px;
    margin-bottom: 14px;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 20px;
  }
  .crumbs button {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .crumbs [aria-current] {
    font-family: var(--serif);
    font-size: 1.25rem;
    font-weight: 700;
  }
  .divider {
    color: var(--muted);
  }
  @media (max-width: 640px) {
    main {
      padding-top: 20px;
    }
    .with-player {
      padding-bottom: calc(150px + var(--safe-area-bottom));
    }
  }
</style>
