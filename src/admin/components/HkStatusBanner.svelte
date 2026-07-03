<script lang="ts">
  import { localizeHkDiagnostic } from '../housekeeping_errors';
  import { t } from '../i18n';
  import type { HkStatus } from '../types';

  // Housekeeping status strip: a restart-pending banner (saved overrides that
  // the running world has not applied yet) plus any stale saved entries the
  // server dropped while re-validating the stored document.
  let { status }: { status: HkStatus } = $props();
</script>

{#if status.restartPending}
  <div class="hk-banner">
    <strong>{t('housekeeping.restartPending')}</strong>
    <span>{t('housekeeping.restartPendingHint')}</span>
  </div>
{/if}
{#if status.savedErrors.length > 0}
  <div class="hk-banner hk-banner-stale">
    <strong>{t('housekeeping.staleEntries')}</strong>
    <ul>
      {#each status.savedErrors as error (error)}
        <li>{localizeHkDiagnostic(error)}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .hk-banner {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    padding: 10px 14px;
    border: 1px solid var(--gold-dim);
    border-left: 4px solid var(--gold);
    background: var(--surface-sunken);
    color: var(--text-bright);
  }
  .hk-banner-stale {
    border-left-color: var(--color-danger-border);
  }
  .hk-banner ul {
    margin: 0;
    padding-left: 18px;
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }
</style>
