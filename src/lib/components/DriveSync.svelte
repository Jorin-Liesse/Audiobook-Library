<script lang="ts">
  import type { SyncStatus } from '#lib/library/sync.ts';
  import Icon from './Icon.svelte';

  let {
    status,
    onconnect,
    onsync,
    ondisconnect
  }: {
    status: SyncStatus;
    onconnect: () => void;
    onsync: () => void;
    ondisconnect: () => void;
  } = $props();
</script>

<section class="drive-sync" aria-label="Google Drive account">
  {#if status.account}
    <p class="account">{status.account.email}</p>
  {/if}
  {#if !status.connected}
    <button class="menu-item" disabled={status.busy} onclick={onconnect}
      >{status.account ? 'Reconnect Google Drive' : 'Sign in with Google'}</button
    >
  {:else}
    <button class="menu-item" disabled={status.busy} onclick={onsync}
      ><span>{status.busy ? 'Syncing…' : 'Sync now'}</span><Icon name="refresh" size={18} /></button
    >
  {/if}
  {#if status.account}
    <button class="menu-item" disabled={status.busy} onclick={ondisconnect}>Sign out</button>
  {/if}
  <p class="status" role="status">{status.message}</p>
</section>

<style>
  .drive-sync {
    border-top: 1px solid var(--line);
    margin-top: 6px;
    padding-top: 6px;
  }
  .account,
  .status {
    margin: 0;
    padding: 6px 12px;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
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
  button:disabled {
    opacity: 0.6;
  }
</style>
