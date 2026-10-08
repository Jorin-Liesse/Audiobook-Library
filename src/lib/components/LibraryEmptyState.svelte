<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    title,
    message,
    actionLabel,
    onaction,
    busy = false,
  }: {
    title: string;
    message: string;
    actionLabel?: string;
    onaction?: () => void;
    busy?: boolean;
  } = $props();
</script>

<div class="empty" aria-busy={busy}>
  <div class="symbol" class:busy><Icon name="headphones" size={30} /></div>
  <h2>{title}</h2>
  <p>{message}</p>
  {#if actionLabel && onaction}<button onclick={onaction}>{actionLabel}</button>{/if}
</div>

<style>
  .empty {
    max-width: 460px;
    margin: 12vh auto;
    text-align: center;
    animation: library-enter 360ms var(--motion-ease) backwards;
  }
  .symbol {
    color: var(--muted);
    margin-bottom: 16px;
  }
  .symbol.busy {
    animation: activity-pulse 1.4s ease-in-out infinite;
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
