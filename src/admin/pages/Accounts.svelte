<script lang="ts">
  import { onMount } from 'svelte';
  import type { AccountRow, Paginated } from '../types';
  import { apiGet } from '../api';
  import { getAccountModalController } from '../account_modal';
  import { accountStatusFor } from '../account_status';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { t } from '../i18n';
  import { fmtDate, fmtDuration, fmtNumber, fmtRelative } from '../format';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import AccountLink from '../components/AccountLink.svelte';
  import Pager from '../components/Pager.svelte';

  const accountModal = getAccountModalController();
  let accounts = $state<Paginated<AccountRow> | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), search });
      accounts = await apiGet<Paginated<AccountRow>>(`/admin/api/accounts?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onSearchInput(event: Event): void {
    search = (event.currentTarget as HTMLInputElement).value.trim();
    page = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
  }

  function openAccount(event: MouseEvent, id: number): void {
    const row = event.currentTarget as HTMLTableRowElement;
    row.querySelector<HTMLButtonElement>('.btn-link')?.focus({ preventScroll: true });
    accountModal?.open(id, () => void refresh());
  }

  onMount(() => {
    void refresh();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<Panel>
  <div class="controls">
    <input
      id="account-search"
      placeholder={t('accounts.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    {#if accounts}
      <div class="pager">
        <Pager
          total={accounts.total}
          page={accounts.page}
          limit={accounts.limit}
          onPage={(nextPage) => {
            page = nextPage;
            void refresh();
          }}
        />
      </div>
    {/if}
  </div>
  {#if failed}
    <div class="empty">{t('accounts.loadFailed')}</div>
  {:else if accounts && accounts.rows.length === 0}
    <div class="empty">{t('accounts.empty')}</div>
  {:else if accounts}
    <table>
      <thead>
        <tr>
          <th class="num">{t('accounts.colId')}</th>
          <th>{t('accounts.colUsername')}</th>
          <th class="num">{t('accounts.colChars')}</th>
          <th class="num">{t('accounts.colMaxLvl')}</th>
          <th class="num">{t('accounts.colPlaytime')}</th>
          <th>{t('accounts.colRegistered')}</th>
          <th>{t('accounts.colLastLogin')}</th>
        </tr>
      </thead>
      <tbody>
        {#each accounts.rows as account (account.id)}
          {@const status = accountStatusFor(account)}
          <tr class="clickable" onclick={(event) => openAccount(event, account.id)}>
            <td class="num">
              <AccountLink
                accountId={account.id}
                label={fmtNumber(account.id)}
                onChanged={() => void refresh()}
              />
            </td>
            <td>
              {account.username}
              {#if account.isAdmin}<Badge>{t('accounts.badgeAdmin')}</Badge>{/if}
              {#if account.isAi}<Badge variant="neutral">{t('accounts.badgeAi')}</Badge>{/if}
              {#if account.isStreamer}
                <Badge variant="success">{t('accounts.badgeStreamer')}</Badge>
              {/if}
              {#if status === 'banned'}
                <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
              {:else if status === 'suspended'}
                <Badge variant="warn">{t('accounts.badgeSuspended')}</Badge>
              {/if}
            </td>
            <td class="num">{account.characterCount}</td>
            <td class="num">{account.maxLevel}</td>
            <td class="num">{fmtDuration(account.playtimeSeconds)}</td>
            <td>{fmtDate(account.createdAt)}</td>
            <td>{fmtRelative(account.lastLogin)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>
