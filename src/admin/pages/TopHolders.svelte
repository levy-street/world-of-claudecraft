<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import {
    readAutoRefreshPreference,
    writeAutoRefreshPreference,
  } from '../auto_refresh_preference';
  import AccountLink from '../components/AccountLink.svelte';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import Badge from '../components/Badge.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper, fmtNumber, fmtRelative } from '../format';
  import { t } from '../i18n';
  import { accountStatusFor } from '../account_status';
  import { auth } from '../state/auth.svelte';
  import type { TopWealthHolderRow } from '../types';

  // The rich list: top accounts by materialised total gold (purse plus mail and
  // market escrow). Economy exploits usually surface here first, so this is the
  // default eyeball view for the p2p market launch. The server refreshes the
  // totals on a ~60s sweep; polling faster only re-reads its cache.
  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_top_holders_auto_refresh';
  const AUTO_REFRESH_MS = 30_000;

  let rows = $state<TopWealthHolderRow[] | null>(null);
  let failed = $state(false);
  let autoRefresh = $state(true);
  let mounted = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<{ rows: TopWealthHolderRow[] }>('/admin/api/wealth/top');
      if (currentRequest !== requestId) return;
      rows = result.rows;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changeAutoRefresh(enabled: boolean): void {
    autoRefresh = enabled;
    writeAutoRefreshPreference(AUTO_REFRESH_STORAGE_KEY, enabled);
    if (enabled) void refresh();
  }

  $effect(() => {
    if (!mounted || !autoRefresh) return;
    const id = setInterval(() => void refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  });

  onMount(() => {
    autoRefresh = readAutoRefreshPreference(AUTO_REFRESH_STORAGE_KEY);
    mounted = true;
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<Panel>
  <div class="page-controls">
    <p class="hint">{t('topHolders.hint')}</p>
    <AutoRefreshToggle
      checked={autoRefresh}
      label={t('topHolders.autoRefresh', { seconds: AUTO_REFRESH_MS / 1000 })}
      onChange={changeAutoRefresh}
    />
  </div>
  {#if failed}
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
                  onChanged={() => void refresh()}
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
