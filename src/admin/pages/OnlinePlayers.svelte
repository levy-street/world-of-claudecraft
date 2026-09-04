<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import {
    readAutoRefreshPreference,
    writeAutoRefreshPreference,
  } from '../auto_refresh_preference';
  import AutoRefreshToggle from '../components/AutoRefreshToggle.svelte';
  import ModerationActionPrompt from '../components/ModerationActionPrompt.svelte';
  import OnlineTable from '../components/OnlineTable.svelte';
  import Pager from '../components/Pager.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtNumber } from '../format';
  import { adminLanguageTag, classLabel, localizeAdminError, t, zoneLabel } from '../i18n';
  import { kickPlayer } from '../moderation_actions';
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
  // The Kick action: the row button picks the target, the prompt collects the
  // reason, kickPlayer shapes the request, and the post lands after confirm. The
  // button is hidden without moderation.act (presentation only, the server
  // re-checks); the outcome line reports the server's answer either way, since
  // the refreshed roster alone cannot tell a kick from a player who left.
  let canKick = $derived(auth.can('moderation.act'));
  let kickTarget = $state<LivePlayer | null>(null);
  let kickOutcome = $state<string | null>(null);

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

  async function confirmKick(values: { reason: string }): Promise<void> {
    const target = kickTarget;
    if (!target) return;
    const built = kickPlayer(target.accountId, target.name, values.reason);
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    try {
      await apiPost(built.pending.endpoint, built.pending.body);
      kickOutcome = t('onlinePlayers.kicked', { name: target.name });
      // Only a success closes the prompt (the AccountModerationActions rule): a
      // refused or failed post keeps the typed reason in front of the operator.
      kickTarget = null;
    } catch (err) {
      if (auth.handleAuthFailure(err)) return;
      kickOutcome = t('onlinePlayers.kickFailed', {
        name: target.name,
        error: err instanceof Error ? localizeAdminError(err.message) : t('alert.actionFailed'),
      });
    }
    void refresh();
  }

  function startKick(player: LivePlayer): void {
    kickOutcome = null;
    kickTarget = player;
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
  {#if kickOutcome}
    <div class="kick-outcome" role="status">{kickOutcome}</div>
  {/if}
  {#if kickTarget}
    <ModerationActionPrompt
      title={t('dialog.confirmKick')}
      rows={[
        { label: t('dialog.character'), value: kickTarget.name },
        { label: t('dialog.account'), value: `#${kickTarget.accountId}` },
        { label: t('dialog.action'), value: t('dialog.actionKick') },
      ]}
      reasonPlaceholder={t('onlinePlayers.kickReasonPlaceholder')}
      danger
      onConfirm={confirmKick}
      onCancel={() => (kickTarget = null)}
    />
  {/if}
  {#if failed}
    <div class="empty">{t('onlinePlayers.loadFailed')}</div>
  {:else if !loaded}
    <div class="empty">{t('onlinePlayers.loading')}</div>
  {:else if players.length > 0 && view.total === 0}
    <div class="empty">{t('onlinePlayers.filteredEmpty')}</div>
  {:else}
    <div class="table-scroll">
      <OnlineTable
        players={view.rows}
        {sort}
        {dir}
        {onSort}
        onKick={canKick ? startKick : undefined}
      />
    </div>
  {/if}
</Panel>

<style>
  .kick-outcome {
    margin-bottom: 12px;
    padding: 8px 12px;
    background: var(--control-bg);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-bright);
  }
</style>
