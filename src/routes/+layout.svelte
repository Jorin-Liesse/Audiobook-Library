<script lang="ts">
  import { asset } from '$app/paths';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
</script>

<svelte:head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Audiobook Library" />
  <meta name="text-scale" content="scale" />

  <link rel="icon" type="image/svg+xml" href={asset('/favicon.svg')} />

  <title>Audiobook Library</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />

  <link
    href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<style></style>
