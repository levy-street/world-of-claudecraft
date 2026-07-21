<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    Activity,
    BarPoint,
    LinePoint,
    LivePlayer,
    OnlineHistory,
    OnlineHistoryRange,
    Overview,
  } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { ACTIVITY_REFRESH_MS, LIVE_REFRESH_MS, poll } from '../state/poll';
  import { classLabel, t } from '../i18n';
  import {
    fmtBytes,
    fmtChartBucket,
    fmtDuration,
    fmtNumber,
  } from '../format';
  import Panel from '../components/Panel.svelte';
  import StatCard from '../components/StatCard.svelte';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import OnlineTable from '../components/OnlineTable.svelte';

  // Operational overview: live stats and online players (5s), plus activity charts
  // (60s). Account and character browsers live on their dedicated Players pages.
  const ONLINE_HISTORY_RANGES: OnlineHistoryRange[] = ['24h', '7d', '30d'];

  let overview = $state<Overview | null>(null);
  let online = $state<LivePlayer[]>([]);
  let activity = $state<Activity | null>(null);
  let onlineHistory = $state<OnlineHistory | null>(null);
  let onlineHistoryRange = $state<OnlineHistoryRange>('24h');

  const dayLabel = (day: string) => day.slice(5); // YYYY-MM-DD -> MM-DD
  let registrationPoints = $derived<BarPoint[]>((activity?.registrations ?? []).map((p) => ({ label: dayLabel(p.day), value: p.count })));
  let sessionPoints = $derived<BarPoint[]>(
    (activity?.sessions ?? []).map((p) => ({
      label: dayLabel(p.day),
      value: p.sessions,
      title: t('charts.sessionsTooltip', { day: p.day, sessions: p.sessions, accounts: p.uniqueAccounts, played: fmtDuration(p.playtimeSeconds) }),
    })),
  );
  let classPoints = $derived<BarPoint[]>((activity?.classes ?? []).map((p) => ({ label: classLabel(p.key), value: p.count })));
  let levelPoints = $derived<BarPoint[]>((activity?.levels ?? []).map((p) => ({ label: p.key, value: p.count })));
  let onlinePoints = $derived<LinePoint[]>(
    (onlineHistory?.points ?? []).map((point) => ({
      label: fmtChartBucket(point.bucketStart, onlineHistory?.bucket ?? 'hour'),
      value: point.peakSiteUsers,
      secondaryValue: point.peakPlayers,
      title: t('charts.onlineTooltip', {
        bucket: fmtChartBucket(point.bucketStart, onlineHistory?.bucket ?? 'hour'),
        siteUsers: fmtNumber(point.peakSiteUsers),
        players: fmtNumber(point.peakPlayers),
        accounts: fmtNumber(point.peakAccounts),
      }),
    })),
  );

  async function refreshLive(): Promise<void> {
    try {
      const [ov, on] = await Promise.all([
        apiGet<Overview>('/admin/api/overview'),
        apiGet<{ players: LivePlayer[] }>('/admin/api/online'),
      ]);
      overview = ov;
      online = on.players;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('live refresh failed:', err);
    }
  }

  async function refreshActivity(): Promise<void> {
    try {
      const [nextActivity, nextOnlineHistory] = await Promise.all([
        apiGet<Activity>('/admin/api/activity'),
        apiGet<OnlineHistory>(`/admin/api/online-history?range=${onlineHistoryRange}`),
      ]);
      activity = nextActivity;
      onlineHistory = nextOnlineHistory;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('activity refresh failed:', err);
    }
  }

  function selectOnlineHistoryRange(range: OnlineHistoryRange): void {
    onlineHistoryRange = range;
    void refreshActivity();
  }

  onMount(() => {
    const stopLive = poll(refreshLive, LIVE_REFRESH_MS);
    const stopActivity = poll(refreshActivity, ACTIVITY_REFRESH_MS);
    return () => {
      stopLive();
      stopActivity();
    };
  });
</script>

<section id="stats">
  {#if overview}
    <StatCard value={fmtNumber(overview.server.online)} label={t('stats.onlineNow')} />
    <StatCard value={fmtNumber(overview.server.onlineAccounts)} label={t('stats.onlineAccounts')} />
    <StatCard value={fmtNumber(overview.siteUsersNow)} label={t('stats.siteUsersNow')} />
    <StatCard value={fmtNumber(overview.peakOnlineToday)} label={t('stats.peakOnlineToday')} />
    <StatCard value={fmtNumber(overview.peakOnlineAllTime)} label={t('stats.peakOnlineAllTime')} />
    <StatCard value={fmtNumber(overview.activeAccountsToday)} label={t('stats.activeAccounts24h')} />
    <StatCard value={fmtNumber(overview.activeAccountsWeek)} label={t('stats.activeAccounts7d')} />
    <StatCard value={fmtNumber(overview.activeAccountsMonth)} label={t('stats.activeAccounts30d')} />
    <StatCard value={fmtNumber(overview.accountsToday)} label={t('stats.newAccounts24h')} />
    <StatCard value={fmtNumber(overview.returningAccountsToday)} label={t('stats.returningAccounts24h')} />
    <StatCard value={fmtDuration(overview.avgPlaytimeSeconds)} label={t('stats.avgPlaytimePerAccount')} />
    <StatCard value={fmtNumber(overview.accounts)} label={t('stats.accounts')} />
    <StatCard value={fmtNumber(overview.characters)} label={t('stats.characters')} />
    <StatCard value={fmtNumber(overview.sessionsToday)} label={t('stats.sessions24h')} />
    <StatCard value={fmtDuration(overview.server.uptimeSeconds)} label={t('stats.uptime')} />
    <StatCard value={`${fmtNumber(overview.server.tickMsAvg)} ms`} label={t('stats.avgTick')} />
    <StatCard value={fmtBytes(overview.server.rssBytes)} label={t('stats.serverRss')} />
  {/if}
</section>

<Panel title={t('online.title')} hint={t('online.refreshHint')}>
  <OnlineTable players={online} />
</Panel>

<section id="charts">
  <Panel
    title={t('charts.onlineHistory', {
      range: t(`charts.range.${onlineHistory?.range ?? onlineHistoryRange}`),
    })}
  >
    <div class="range-tabs">
      {#each ONLINE_HISTORY_RANGES as range}
        <button
          type="button"
          class:active={onlineHistoryRange === range}
          class="range-tab"
          aria-pressed={onlineHistoryRange === range}
          onclick={() => selectOnlineHistoryRange(range)}
        >
          {t(`charts.range.${range}`)}
        </button>
      {/each}
    </div>
    <LineChart points={onlinePoints} />
  </Panel>
  <Panel title={t('charts.registrations', { days: activity?.days ?? 0 })}>
    <BarChart points={registrationPoints} />
  </Panel>
  <Panel title={t('charts.sessions', { days: activity?.days ?? 0 })}>
    <BarChart points={sessionPoints} />
  </Panel>
  <Panel title={t('charts.classDistribution')}>
    <BarChart points={classPoints} />
  </Panel>
  <Panel title={t('charts.levelDistribution')}>
    <BarChart points={levelPoints} />
  </Panel>
</section>
