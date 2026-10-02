<script lang="ts">
  import { asset } from '$app/paths';
  import type { Snippet } from 'svelte';
  import '#lib/styles/app.css';

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Audiobook Library" />
  <meta name="text-scale" content="scale" />
  <meta name="theme-color" content="#e8ece4" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#151c1a" media="(prefers-color-scheme: dark)" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Audiobooks" />

  <link rel="icon" type="image/svg+xml" href={asset('favicon.svg')} />
  <link rel="manifest" href={asset('manifest.webmanifest')} />
  <link rel="apple-touch-icon" href={asset('icons/apple-touch-icon.png')} />

  <title>Audiobook Library</title>
</svelte:head>

{@render children()}
