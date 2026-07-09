<script lang="ts">
  import { onMount } from 'svelte';
  import type { PerfCaptureStatus, PerfPhaseStats } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { poll } from '../state/poll';
  import { adminLanguageTag, t } from '../i18n';
  import { fmtNumber, fmtRelative } from '../format';
  import Panel from '../components/Panel.svelte';

  // Server tick-loop profiler. Triggers an on-demand capture (the detailed sub-phase
  // timing runs only for the window), then renders the frozen per-phase breakdown.
  // ops.perf gated (admin/superadmin); the server re-checks every call.
  const DURATION_OPTIONS = [10, 20, 30] as const;
  const LOOP_PHASES = [
    'total',
    'tick',
    'broadcast',
    'bcastGrid',
    'bcastSelf',
    'events',
    'antibot',
    'stale',
    'social',
  ];
  const TICK_BUDGET_MS = 50;
  const POLL_MS = 1_000;

  let status = $state<PerfCaptureStatus | null>(null);
  let durationSeconds = $state<number>(10);
  let starting = $state(false);

  const msFormatter = new Intl.NumberFormat(adminLanguageTag(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const ms = (value: number): string => t('tickPerf.ms', { value: msFormatter.format(value) });

  const remaining = $derived(
    status?.capturing && status.endsAt
      ? Math.max(0, Math.ceil((status.endsAt - Date.now()) / 1000))
      : 0,
  );

  const loopRows = $derived.by(() => {
    const phases = status?.last?.profile.phases ?? {};
    return LOOP_PHASES.filter((name) => phases[name]).map((name) => ({
      name,
      stats: phases[name],
    }));
  });

  // sim.tick() internal phases, sorted by mean cost so the phase eating the average
  // leads (the same read that localized the broadcast bottleneck).
  const simRows = $derived.by(() => {
    const phases = status?.last?.profile.phases ?? {};
    return Object.entries(phases)
      .filter(([name]) => name.startsWith('sim.'))
      .map(([name, stats]) => ({ name: name.slice(4), stats: stats as PerfPhaseStats }))
      .sort((a, b) => b.stats.mean - a.stats.mean);
  });

  const overBudget = $derived((status?.last?.profile.phases.total?.p95 ?? 0) > TICK_BUDGET_MS);

  async function refresh(): Promise<void> {
    try {
      status = await apiGet<PerfCaptureStatus>('/admin/api/perf/tick');
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('tick perf refresh failed:', err);
    }
  }

  async function capture(): Promise<void> {
    if (starting || status?.capturing) return;
    starting = true;
    try {
      status = await apiPost<PerfCaptureStatus>('/admin/api/perf/tick/capture', {
        durationMs: durationSeconds * 1000,
      });
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        console.error('tick perf capture failed:', err);
        alert(t('tickPerf.captureFailed'));
      }
    } finally {
      starting = false;
    }
  }

  onMount(() => poll(refresh, POLL_MS));
</script>

<Panel title={t('tickPerf.title')} hint={t('tickPerf.budgetNote')}>
  <p class="intro">{t('tickPerf.intro')}</p>

  <div class="controls" role="group" aria-label={t('tickPerf.durationLabel')}>
    <span class="label">{t('tickPerf.durationLabel')}</span>
    {#each DURATION_OPTIONS as seconds (seconds)}
      <button
        type="button"
        class:selected={durationSeconds === seconds}
        aria-pressed={durationSeconds === seconds}
        disabled={status?.capturing}
        onclick={() => (durationSeconds = seconds)}
      >
        {t('tickPerf.durationSeconds', { seconds })}
      </button>
    {/each}
    <button type="button" class="capture" disabled={starting || status?.capturing} onclick={capture}>
      {t('tickPerf.capture')}
    </button>
  </div>

  <p class="status" aria-live="polite">
    {#if status?.capturing}
      {t('tickPerf.capturing', { seconds: remaining })}
    {:else if status?.last}
      {t('tickPerf.capturedAt', { when: fmtRelative(new Date(status.last.capturedAt).toISOString()) })}
      &middot; {t('tickPerf.contextOnline', { online: fmtNumber(status.last.online) })}
      &middot; {t('tickPerf.contextEntities', { entities: fmtNumber(status.last.simEntities) })}
      &middot; {t('tickPerf.contextWindow', {
        seconds: Math.round(status.last.durationMs / 1000),
        samples: fmtNumber(status.last.profile.samples),
      })}
      {#if overBudget}<strong class="over">{t('tickPerf.overBudget')}</strong>{/if}
    {:else}
      {t('tickPerf.noCapture')}
    {/if}
  </p>

  {#if status?.last}
    <h3>{t('tickPerf.loopHeading')}</h3>
    <table>
      <thead>
        <tr>
          <th>{t('tickPerf.colPhase')}</th>
          <th class="num">{t('tickPerf.colMean')}</th>
          <th class="num">{t('tickPerf.colP95')}</th>
          <th class="num">{t('tickPerf.colP99')}</th>
          <th class="num">{t('tickPerf.colMax')}</th>
        </tr>
      </thead>
      <tbody>
        {#each loopRows as row (row.name)}
          <tr class:total-row={row.name === 'total'}>
            <td>{row.name}</td>
            <td class="num">{ms(row.stats.mean)}</td>
            <td class="num">{ms(row.stats.p95)}</td>
            <td class="num">{ms(row.stats.p99)}</td>
            <td class="num">{ms(row.stats.max)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if simRows.length > 0}
      <h3>{t('tickPerf.simHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('tickPerf.colPhase')}</th>
            <th class="num">{t('tickPerf.colMean')}</th>
            <th class="num">{t('tickPerf.colP95')}</th>
            <th class="num">{t('tickPerf.colP99')}</th>
            <th class="num">{t('tickPerf.colMax')}</th>
          </tr>
        </thead>
        <tbody>
          {#each simRows as row (row.name)}
            <tr>
              <td>{row.name}</td>
              <td class="num">{ms(row.stats.mean)}</td>
              <td class="num">{ms(row.stats.p95)}</td>
              <td class="num">{ms(row.stats.p99)}</td>
              <td class="num">{ms(row.stats.max)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</Panel>

<style>
  .intro {
    margin: 0 0 1rem;
    color: var(--text-soft);
    max-width: 60ch;
  }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .controls .label {
    color: var(--text-soft);
    margin-right: 0.25rem;
  }
  .controls button.selected {
    border-color: var(--text-bright);
    color: var(--text-bright);
  }
  .controls button.capture {
    margin-left: auto;
  }
  .status {
    margin: 0 0 1rem;
    color: var(--text-soft);
  }
  .status .over {
    color: var(--color-danger);
    margin-left: 0.25rem;
  }
  h3 {
    margin: 1.25rem 0 0.5rem;
    font-size: var(--font-size-table);
    color: var(--text-soft);
  }
  tr.total-row td {
    font-weight: 600;
    color: var(--text-bright);
  }
</style>
