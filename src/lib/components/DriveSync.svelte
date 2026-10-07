<script lang="ts">
  import type { SyncStatus } from "#lib/library/sync.ts";
  let {
    status,
    onconnect,
    onsync,
    ondisconnect,
  }: {
    status: SyncStatus;
    onconnect: () => void;
    onsync: () => void;
    ondisconnect: () => void;
  } = $props();
  let expanded = $state(false);
</script>

<section class="drive-sync" aria-label="Google Drive sync">
  <div class="summary">
    <button
      class="details"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      aria-controls="drive-details"
    >
      <span>Google Drive sync</span>
      <small
        >{status.busy
          ? "Syncing…"
          : status.connected
            ? "Connected"
            : status.account
              ? "Reconnect needed"
              : "Off"}</small
      >
    </button>
    {#if !status.connected}
      <button class="action" disabled={status.busy} onclick={onconnect}
        >{status.account ? "Reconnect" : "Connect Google Drive"}</button
      >
    {/if}
  </div>
  {#if expanded}
    <div id="drive-details">
      <p>
        Sync your listening position, likes, and read status using the same
        Google account on each device. Your audio stays on your device. Choose
        its local folder on each device; filenames and file sizes must match.
      </p>
      <p>
        Sync data is private to this app in a hidden folder in your own Drive.
      </p>
      {#if status.account}<p class="account">{status.account.email}</p>{/if}
      {#if status.connected}
        <div class="actions">
          <button class="action" disabled={status.busy} onclick={onsync}
            >Sync now</button
          >
          <button class="action" disabled={status.busy} onclick={ondisconnect}
            >Disconnect</button
          >
        </div>
      {:else if status.account}
        <button class="action" disabled={status.busy} onclick={ondisconnect}
          >Disconnect</button
        >
      {/if}
    </div>
  {/if}
  <p class="status" role="status">{status.message}</p>
</section>

<style>
  .drive-sync {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 24px;
    background: var(--surface);
  }
  .summary,
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .summary {
    justify-content: space-between;
  }
  .details {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    border: 0;
    background: none;
    text-align: left;
    font-weight: 600;
  }
  small,
  .status {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
  }
  p {
    margin: 10px 0 0;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .account {
    overflow-wrap: anywhere;
  }
  .actions {
    margin-top: 12px;
  }
  .action {
    padding: 7px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    font-size: 0.85rem;
  }
  button:disabled {
    opacity: 0.6;
  }
</style>
