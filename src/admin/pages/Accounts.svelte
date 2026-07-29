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

  type AccountSort =
    | 'id'
    | 'username'
    | 'character_count'
    | 'max_level'
    | 'playtime_seconds'
    | 'created_at'
    | 'last_login';

  const accountModal = getAccountModalController();
  let accounts = $state<Paginated<AccountRow> | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let sort = $state<AccountSort>('id');
  let dir = $state<'asc' | 'desc'>('desc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let requestEpoch = 0;
  let disposed = false;

  async function refresh(): Promise<void> {
    const epoch = ++requestEpoch;
    try {
      const params = new URLSearchParams({ page: String(page), search, sort, dir });
      const next = await apiGet<Paginated<AccountRow>>(`/admin/api/accounts?${params}`);
      if (disposed || epoch !== requestEpoch) return;
      accounts = next;
      failed = false;
    } catch (err) {
      if (disposed || epoch !== requestEpoch || auth.handleAuthFailure(err)) return;
      failed = true;
    }
  }

  function onSearchInput(event: Event): void {
    search = (event.currentTarget as HTMLInputElement).value.trim();
    page = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
  }

  function changeSort(column: AccountSort): void {
    dir = sort === column ? (dir === 'desc' ? 'asc' : 'desc') : column === 'username' ? 'asc' : 'desc';
    sort = column;
    page = 1;
    void refresh();
  }

  function sortArrow(column: AccountSort): string {
    if (sort !== column) return '';
    return dir === 'asc' ? ' ▲' : ' ▼';
  }

  function ariaSort(column: AccountSort): 'ascending' | 'descending' | 'none' {
    if (sort !== column) return 'none';
    return dir === 'asc' ? 'ascending' : 'descending';
  }

  function openAccount(event: MouseEvent, id: number): void {
    const row = event.currentTarget as HTMLTableRowElement;
    row.querySelector<HTMLButtonElement>('.btn-link')?.focus({ preventScroll: true });
    accountModal?.open(id, () => void refresh());
  }

  onMount(() => {
    disposed = false;
    void refresh();
    return () => {
      disposed = true;
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
          <th class="num sortable" aria-sort={ariaSort('id')}>
            <button type="button" onclick={() => changeSort('id')}>
              {t('accounts.colId')}<span aria-hidden="true">{sortArrow('id')}</span>
            </button>
          </th>
          <th class="sortable" aria-sort={ariaSort('username')}>
            <button type="button" onclick={() => changeSort('username')}>
              {t('accounts.colUsername')}<span aria-hidden="true">{sortArrow('username')}</span>
            </button>
          </th>
          <th class="num sortable" aria-sort={ariaSort('character_count')}>
            <button type="button" onclick={() => changeSort('character_count')}>
              {t('accounts.colChars')}<span aria-hidden="true">{sortArrow('character_count')}</span>
            </button>
          </th>
          <th class="num sortable" aria-sort={ariaSort('max_level')}>
            <button type="button" onclick={() => changeSort('max_level')}>
              {t('accounts.colMaxLvl')}<span aria-hidden="true">{sortArrow('max_level')}</span>
            </button>
          </th>
          <th class="num sortable" aria-sort={ariaSort('playtime_seconds')}>
            <button type="button" onclick={() => changeSort('playtime_seconds')}>
              {t('accounts.colPlaytime')}<span aria-hidden="true">{sortArrow('playtime_seconds')}</span>
            </button>
          </th>
          <th class="sortable" aria-sort={ariaSort('created_at')}>
            <button type="button" onclick={() => changeSort('created_at')}>
              {t('accounts.colRegistered')}<span aria-hidden="true">{sortArrow('created_at')}</span>
            </button>
          </th>
          <th class="sortable" aria-sort={ariaSort('last_login')}>
            <button type="button" onclick={() => changeSort('last_login')}>
              {t('accounts.colLastLogin')}<span aria-hidden="true">{sortArrow('last_login')}</span>
            </button>
          </th>
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

<style>
  th.sortable button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }

  th.sortable button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 3px;
  }
</style>
