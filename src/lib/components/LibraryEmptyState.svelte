<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    title,
    message,
    actionLabel,
    onaction
  }: { title: string; message: string; actionLabel?: string; onaction?: () => void } = $props();
</script>

<div class="empty">
  <div class="symbol"><Icon name="headphones" size={30} /></div>
  <h2>{title}</h2>
  <p>{message}</p>
  {#if actionLabel && onaction}<button onclick={onaction}>{actionLabel}</button>{/if}
</div>

<style>
  .empty {
    max-width: 460px;
    margin: 12vh auto;
    text-align: center;
  }
  .symbol {
    color: var(--muted);
    margin-bottom: 16px;
  }
  h2 {
    font-family: var(--serif);
    font-size: 1.8rem;
    line-height: 1.25;
    margin-bottom: 8px;
  }
  p {
    color: var(--muted);
  }
  button {
    margin-top: 20px;
    background: var(--accent);
    color: var(--accent-ink);
    border: 0;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 600;
  }
</style>
