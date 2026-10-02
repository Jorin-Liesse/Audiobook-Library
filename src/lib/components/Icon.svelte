<script lang="ts">
  let {
    name,
    size = 20
  }: {
    name:
      | 'search'
      | 'more'
      | 'heart'
      | 'check'
      | 'folder'
      | 'play'
      | 'pause'
      | 'previous'
      | 'next'
      | 'close'
      | 'headphones';
    size?: number;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'search'}
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
  {:else if name === 'more'}
    <circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle
      cx="12"
      cy="12"
      r="1.3"
      fill="currentColor"
    /><circle cx="19" cy="12" r="1.3" fill="currentColor" />
  {:else if name === 'heart'}
    <path
      d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
    />
  {:else if name === 'check'}
    <path d="m5 12 4.5 4.5L19 7" />
  {:else if name === 'folder'}
    <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  {:else if name === 'play'}
    <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />
  {:else if name === 'pause'}
    <path d="M8 5v14M16 5v14" stroke-width="4" />
  {:else if name === 'previous'}
    <path d="M5 5v14m14-14L8 12l11 7Z" />
  {:else if name === 'next'}
    <path d="M19 5v14M5 5l11 7-11 7Z" />
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'headphones'}
    <path
      d="M4 14v-3a8 8 0 0 1 16 0v3M4 13h3v8H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 1-2Zm16 0h-3v8h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-1-2Z"
    />
  {/if}
</svg>
