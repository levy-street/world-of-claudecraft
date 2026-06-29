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

  const navigation = getAdminNavigation();
  let data = $state<SharedIpsData | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let onlineOnly = $state(false);
  let requestId = 0;

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const params = new URLSearchParams({ page: String(page) });
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
        {onlineOnly ? t('sharedIps.onlineDescription') : t('sharedIps.description')}
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
      <div class="shared-ip-heading" aria-hidden="true">
        <span>{t('blockedIps.colIp')}</span>
        <span>{t('sharedIps.colAccounts')}</span>
        <span>{t('ipAssociations.colLastSeen')}</span>
      </div>
      <ul class="shared-ip-list">
        {#each data.rows as row (row.ip)}
          <li>
            <a
              class="shared-ip-row"
              href={routeHref({ page: 'ip', ip: row.ip })}
              onclick={(event) => navigation?.navigate(event, { page: 'ip', ip: row.ip })}
            >
              <span class="ip-identity">
                <code>{row.ip}</code>
                {#if row.blocked}
                  <Badge variant="bad">{t('blockedIps.blockedBadge')}</Badge>
                {/if}
              </span>
              <span class="account-count">
                <strong>{fmtNumber(row.accountCount)}</strong>
                <span>{t('sharedIps.colAccounts')}</span>
              </span>
              <span class="last-seen">
                <span class="mobile-label">{t('ipAssociations.colLastSeen')}</span>
                <span>{fmtDate(row.lastSeenAt)}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>

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

  .shared-ip-heading,
  .shared-ip-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 150px 220px;
    align-items: center;
    gap: 18px;
  }

  .shared-ip-heading {
    padding: 3px 12px 6px;
    color: var(--gold-dim);
    font-size: var(--font-size-small);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .shared-ip-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .shared-ip-row {
    min-height: 54px;
    padding: 8px 12px;
    color: var(--text);
    text-decoration: none;
    background: #0c0c12;
    border-top: 1px solid var(--border);
  }

  .shared-ip-row:last-child {
    border-bottom: 1px solid var(--border);
  }

  .shared-ip-row:hover {
    background: var(--row-hover);
  }

  .shared-ip-row:focus-visible {
    position: relative;
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .ip-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .ip-identity code {
    color: var(--gold);
    text-decoration: underline;
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

  .mobile-label {
    display: none;
  }

  @media (max-width: 700px) {
    .shared-ips-intro {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }

    .shared-ip-heading {
      display: none;
    }

    .shared-ip-row {
      grid-template-columns: 1fr auto;
      gap: 8px 12px;
      min-height: 72px;
    }

    .last-seen {
      grid-column: 1 / -1;
    }

    .mobile-label {
      display: inline;
      margin-right: 6px;
      color: var(--gold-dim);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .switch-track span {
      transition: none;
    }
  }
</style>
