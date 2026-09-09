<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import AccountLink from '../components/AccountLink.svelte';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import Badge from '../components/Badge.svelte';
  import Panel from '../components/Panel.svelte';
  import PermissionDenied from '../components/PermissionDenied.svelte';
  import { fmtCopper, fmtNumber, fmtRelative } from '../format';
  import { t } from '../i18n';
  import { accountStatusFor } from '../account_status';
  import { createAutoRefresh } from '../state/auto_refresh.svelte';
  import type { TopWealthHolderRow } from '../types';

  // The rich list: top accounts by materialised total gold (purse plus mail and
  // market escrow). Economy exploits usually surface here first, so this is the
  // default eyeball view for the p2p market launch. The server refreshes the
  // totals on a ~60s sweep; polling faster only re-reads its cache.
  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_top_holders_auto_refresh';
  const AUTO_REFRESH_MS = 30_000;

  const surface = createAutoRefresh<{ rows: TopWealthHolderRow[] }>({
    storageKey: AUTO_REFRESH_STORAGE_KEY,
    intervalMs: AUTO_REFRESH_MS,
    load: () => apiGet<{ rows: TopWealthHolderRow[] }>('/admin/api/wealth/top'),
  });
  let rows = $derived(surface.data?.rows ?? null);

  onMount(() => surface.start());
</script>

<Panel>
  <div class="page-controls">
    <p class="hint">{t('topHolders.hint')}</p>
    <AutoRefreshToggle
      checked={surface.enabled}
      label={t('topHolders.autoRefresh', { seconds: AUTO_REFRESH_MS / 1000 })}
      onChange={(enabled) => surface.setEnabled(enabled)}
    />
  </div>
  {#if surface.failure === 'forbidden'}
    <PermissionDenied />
  {:else if surface.failure === 'error'}
    <div class="empty">{t('topHolders.loadFailed')}</div>
  {:else if rows === null}
    <div class="empty">{t('topHolders.loading')}</div>
  {:else if rows.length === 0}
    <div class="empty">{t('topHolders.empty')}</div>
  {:else}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="num">{t('topHolders.colRank')}</th>
            <th>{t('accounts.colUsername')}</th>
            <th class="num">{t('topHolders.colTotal')}</th>
            <th class="num">{t('topHolders.colPurse')}</th>
            <th class="num">{t('topHolders.colMail')}</th>
            <th class="num">{t('topHolders.colMarket')}</th>
            <th class="num">{t('accounts.colMaxLvl')}</th>
            <th>{t('accounts.colLastLogin')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, index (row.accountId)}
            {@const status = accountStatusFor(row)}
            <tr>
              <td class="num">{fmtNumber(index + 1)}</td>
              <td>
                <AccountLink
                  accountId={row.accountId}
                  label={row.username}
                  onChanged={() => surface.refresh()}
                />
                {#if status === 'banned'}
                  <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
                {:else if status === 'suspended'}
                  <Badge variant="warn">{t('accounts.badgeSuspended')}</Badge>
                {/if}
                {#if (row.activeFlagCount ?? 0) > 0}
                  <Badge variant="bad">
                    {t('flags.badgeFlagged', { n: fmtNumber(row.activeFlagCount ?? 0) })}
                  </Badge>
                {/if}
              </td>
              <td class="num">{fmtCopper(row.totalCopper)}</td>
              <td class="num">{fmtCopper(row.purseCopper)}</td>
              <td class="num">{fmtCopper(row.mailCopper)}</td>
              <td class="num">{fmtCopper(row.marketCopper)}</td>
              <td class="num">{row.maxLevel}</td>
              <td>{fmtRelative(row.lastLogin)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

<style>
  .page-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 14px;
  }

  @media (max-width: 700px) {
    .page-controls {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>
