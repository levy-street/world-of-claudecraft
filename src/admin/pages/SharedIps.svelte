<script lang="ts">
  import { onMount } from 'svelte';
  import type { SharedIpsData } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { fmtDate, fmtNumber } from '../format';
  import { t } from '../i18n';
  import { getAdminNavigation, routeHref } from '../navigation';
  import Badge from '../components/Badge.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';

  type SharedIpSort = 'accounts' | 'last_seen';

  const navigation = getAdminNavigation();
  let data = $state<SharedIpsData | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let onlineOnly = $state(false);
  let sort = $state<SharedIpSort>('accounts');
  let dir = $state<'asc' | 'desc'>('desc');
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const params = new URLSearchParams({ page: String(page), sort, dir });
      if (onlineOnly) params.set('online', '1');
      const result = await apiGet<SharedIpsData>(`/admin/api/shared-ips?${params}`);
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changePage(nextPage: number): void {
    page = nextPage;
    void refresh();
  }

  function changeOnlineFilter(event: Event): void {
    onlineOnly = (event.currentTarget as HTMLInputElement).checked;
    page = 1;
    data = null;
    failed = false;
    void refresh();
  }

  function changeSort(column: SharedIpSort): void {
    dir = sort === column && dir === 'desc' ? 'asc' : 'desc';
    sort = column;
    page = 1;
    void refresh();
  }

  function sortArrow(column: SharedIpSort): string {
    if (sort !== column) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  function ariaSort(column: SharedIpSort): 'ascending' | 'descending' | 'none' {
    if (sort !== column) return 'none';
    return dir === 'asc' ? 'ascending' : 'descending';
  }

  onMount(() => {
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<div class="shared-ips-page">
  <Panel>
    <div class="shared-ips-intro">
      <p class="description">
        {onlineOnly ? t('sharedIps.onlineDescription') : t('sharedIps.allDescription')}
      </p>
      <label class="online-filter">
        <input type="checkbox" checked={onlineOnly} onchange={changeOnlineFilter} />
        <span class="switch-track" aria-hidden="true"><span></span></span>
        <span>{t('sharedIps.onlineOnly')}</span>
      </label>
    </div>
    <div class="investigation-note" role="note">{t('sharedIps.warning')}</div>

    {#if failed}
      <div class="empty">{t('sharedIps.loadFailed')}</div>
    {:else if data === null}
      <div class="empty">{t('sharedIps.loading')}</div>
    {:else if data.rows.length === 0}
      <div class="empty">
        {onlineOnly ? t('sharedIps.onlineEmpty') : t('sharedIps.empty')}
      </div>
    {:else}
      <div class="table-scroll">
        <table class="shared-ip-table">
          <colgroup>
            <col />
            <col class="accounts-column" />
            <col class="last-seen-column" />
          </colgroup>
          <thead>
            <tr>
              <th>{t('blockedIps.colIp')}</th>
              <th class="num sortable" aria-sort={ariaSort('accounts')}>
                <button type="button" onclick={() => changeSort('accounts')}>
                  {t('sharedIps.colAccounts')}{sortArrow('accounts')}
                </button>
              </th>
              <th class="sortable" aria-sort={ariaSort('last_seen')}>
                <button type="button" onclick={() => changeSort('last_seen')}>
                  {t('ipAssociations.colLastSeen')}{sortArrow('last_seen')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as row (row.ip)}
              <tr>
                <td>
                  <span class="ip-identity">
                    <a
                      href={routeHref({ page: 'ip', ip: row.ip })}
                      onclick={(event) => navigation?.navigate(event, { page: 'ip', ip: row.ip })}
                    >
                      <code>{row.ip}</code>
                    </a>
                    {#if row.blocked}
                      <Badge variant="bad">{t('blockedIps.blockedBadge')}</Badge>
                    {/if}
                  </span>
                </td>
                <td class="num">
                  <span class="account-count">
                    <strong>{fmtNumber(row.accountCount)}</strong>
                    <span>{t('sharedIps.colAccounts')}</span>
                  </span>
                </td>
                <td class="last-seen">{fmtDate(row.lastSeenAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if data.total > data.limit}
        <Pager
          total={data.total}
          page={data.page}
          limit={data.limit}
          layout="footer"
          onPage={changePage}
        />
      {/if}
    {/if}
  </Panel>
</div>

<style>
  .shared-ips-page {
    width: min(100%, 1100px);
  }

  .description {
    color: var(--text);
    line-height: 1.5;
  }

  .shared-ips-intro {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
  }

  .online-filter {
    position: relative;
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    gap: 8px;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }

  .online-filter input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .switch-track {
    display: inline-flex;
    width: 34px;
    height: 19px;
    align-items: center;
    padding: 2px;
    background: var(--control-bg);
    border: 1px solid var(--control-border);
    border-radius: 999px;
  }

  .switch-track span {
    width: 13px;
    height: 13px;
    background: var(--text-dim);
    border-radius: 50%;
    transition: transform 120ms ease, background 120ms ease;
  }

  .online-filter input:checked + .switch-track {
    background: #17301f;
    border-color: #348b56;
  }

  .online-filter input:checked + .switch-track span {
    background: #7bea9f;
    transform: translateX(15px);
  }

  .online-filter input:focus-visible + .switch-track {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .investigation-note {
    margin: 10px 0 14px;
    padding: 9px 11px;
    color: var(--text-dim);
    background: #14131a;
    border-left: 2px solid var(--gold-dim);
    border-radius: 3px;
    font-size: 12px;
    line-height: 1.45;
  }

  .shared-ip-table {
    min-width: 680px;
    table-layout: fixed;
  }

  .accounts-column {
    width: 150px;
  }

  .last-seen-column {
    width: 220px;
  }

  th.sortable {
    padding: 0;
  }

  th.sortable button {
    width: 100%;
    padding: 7px 10px;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-align: inherit;
    text-transform: inherit;
  }

  th.sortable button:hover {
    color: var(--gold);
  }

  th.sortable button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .ip-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .ip-identity a {
    color: var(--gold);
    text-decoration: underline;
  }

  .ip-identity code {
    color: inherit;
  }

  .account-count {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    width: fit-content;
    padding: 3px 8px;
    color: var(--text-dim);
    background: var(--control-bg-hover);
    border: 1px solid var(--control-border);
    border-radius: 999px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .account-count strong {
    color: var(--gold);
    font-size: 14px;
  }

  .last-seen {
    color: var(--text-dim);
    font-size: 12px;
  }

  @media (max-width: 700px) {
    .shared-ips-intro {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .switch-track span {
      transition: none;
    }
  }
</style>
