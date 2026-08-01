<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import {
    readAutoRefreshPreference,
    writeAutoRefreshPreference,
  } from '../auto_refresh_preference';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import OnlineTable from '../components/OnlineTable.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtNumber } from '../format';
  import { adminLanguageTag, classLabel, t, zoneLabel } from '../i18n';
  import {
    buildOnlinePlayersView,
    type OnlineSortColumn,
    type OnlineSortDirection,
  } from '../online_players_view';
  import { auth } from '../state/auth.svelte';
  import { ONLINE_REFRESH_MS } from '../state/poll';
  import type { LivePlayer } from '../types';

  // Dedicated live roster, moved off the Overview dashboard: same columns, plus
  // search, sortable headers and paging. Auto-refresh is on by default and the
  // operator can switch it off (the preference sticks) and refresh by hand.
  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_online_players_auto_refresh';

  let players = $state<LivePlayer[]>([]);
  let loaded = $state(false);
  let failed = $state(false);
  let search = $state('');
  let sort = $state<OnlineSortColumn>('name');
  let dir = $state<OnlineSortDirection>('asc');
  let page = $state(1);
  let autoRefresh = $state(true);
  let mounted = $state(false);
  let requestId = 0;

  let view = $derived(
    buildOnlinePlayersView(players, {
      query: search,
      sort,
      dir,
      page,
      locale: adminLanguageTag(),
      labels: { class: classLabel, zone: zoneLabel },
    }),
  );

  // The roster count is what the header is about, but with a search on it would sit
  // above a shorter table, so a filtered view says both numbers.
  let count = $derived(
    view.total === players.length
      ? t('onlinePlayers.count', { count: fmtNumber(players.length) })
      : t('onlinePlayers.countFiltered', {
          shown: fmtNumber(view.total),
          total: fmtNumber(players.length),
        }),
  );

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<{ players: LivePlayer[] }>('/admin/api/online');
      if (currentRequest !== requestId) return;
      players = result.players;
      loaded = true;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onSort(column: OnlineSortColumn): void {
    dir = sort === column && dir === 'asc' ? 'desc' : 'asc';
    sort = column;
    page = 1;
  }

  function changeAutoRefresh(enabled: boolean): void {
    autoRefresh = enabled;
    writeAutoRefreshPreference(AUTO_REFRESH_STORAGE_KEY, enabled);
    if (enabled) void refresh();
  }

  $effect(() => {
    if (!mounted || !autoRefresh) return;
    const id = setInterval(() => void refresh(), ONLINE_REFRESH_MS);
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
  <div class="controls">
    <input
      id="online-player-search"
      type="search"
      placeholder={t('onlinePlayers.searchPlaceholder')}
      bind:value={search}
      oninput={() => {
        page = 1;
      }}
      aria-label={t('onlinePlayers.searchLabel')}
    />
    <span class="text-dim">{count}</span>
    <span class="text-dim">{t('onlinePlayers.sortHint')}</span>
    <AutoRefreshToggle
      checked={autoRefresh}
      label={t('onlinePlayers.autoRefresh', { minutes: ONLINE_REFRESH_MS / 60_000 })}
      onChange={changeAutoRefresh}
    />
    <button type="button" onclick={() => void refresh()}>{t('onlinePlayers.refresh')}</button>
    <div class="pager">
      <Pager
        total={view.total}
        page={view.page}
        limit={view.limit}
        onPage={(nextPage) => {
          page = nextPage;
        }}
      />
    </div>
  </div>
  {#if failed}
    <div class="empty">{t('onlinePlayers.loadFailed')}</div>
  {:else if !loaded}
    <div class="empty">{t('onlinePlayers.loading')}</div>
  {:else if players.length > 0 && view.total === 0}
    <div class="empty">{t('onlinePlayers.filteredEmpty')}</div>
  {:else}
    <div class="table-scroll">
      <OnlineTable players={view.rows} {sort} {dir} {onSort} />
    </div>
  {/if}
</Panel>
