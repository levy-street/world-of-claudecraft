<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import { buildCalibrationExport } from '../calibration_export';
  import BarChart from '../components/BarChart.svelte';
  import Panel from '../components/Panel.svelte';
  import { estimateQuantile, histogramBarPoints } from '../histogram_stats';
  import { adminLanguageTag, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import { LIVE_REFRESH_MS } from '../state/poll';
  import type { CalibrationHistogram, DetectionCalibrationData } from '../types';

  const AUTO_REFRESH_STORAGE_KEY = 'claudecraft_admin_calibration_auto_refresh';

  let data = $state<DetectionCalibrationData | null>(null);
  let failed = $state(false);
  let autoRefresh = $state(true);
  let mounted = $state(false);
  let requestId = 0;

  function fmt(value: number | null): string {
    if (value === null) return '-';
    return new Intl.NumberFormat(adminLanguageTag(), {
      maximumFractionDigits: 1,
    }).format(value);
  }

  function stats(h: CalibrationHistogram): { labelKey: string; value: string }[] {
    return [
      { labelKey: 'calibration.statMin', value: fmt(h.min) },
      { labelKey: 'calibration.statP50', value: fmt(estimateQuantile(h, 0.5)) },
      { labelKey: 'calibration.statP95', value: fmt(estimateQuantile(h, 0.95)) },
      { labelKey: 'calibration.statP99', value: fmt(estimateQuantile(h, 0.99)) },
      { labelKey: 'calibration.statMax', value: fmt(h.max) },
      { labelKey: 'calibration.statMean', value: fmt(h.count > 0 ? h.sum / h.count : null) },
    ];
  }

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<DetectionCalibrationData>('/admin/api/detection-calibration');
      if (currentRequest !== requestId) return;
      data = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function changeAutoRefresh(event: Event): void {
    autoRefresh = (event.currentTarget as HTMLInputElement).checked;
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, autoRefresh ? '1' : '0');
    if (autoRefresh) void refresh();
  }

  function downloadJson(): void {
    if (data === null) return;
    const file = buildCalibrationExport(data);
    const url = URL.createObjectURL(
      new Blob([file.contents], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  }

  $effect(() => {
    if (!mounted || !autoRefresh) return;
    const id = setInterval(() => void refresh(), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  });

  onMount(() => {
    autoRefresh = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) !== '0';
    mounted = true;
    void refresh();
    return () => {
      requestId += 1;
    };
  });
</script>

<div class="calibration-page">
  <Panel>
    <div class="page-controls">
      <p class="description">{t('calibration.description')}</p>
      <div class="control-actions">
        <button type="button" disabled={data === null} onclick={downloadJson}>
          {t('calibration.downloadJson')}
        </button>
        <label class="auto-refresh">
          <input type="checkbox" checked={autoRefresh} onchange={changeAutoRefresh} />
          <span class="switch-track" aria-hidden="true"><span></span></span>
          <span>
            {t('calibration.autoRefresh', { seconds: LIVE_REFRESH_MS / 1000 })}
          </span>
        </label>
      </div>
    </div>

    {#if failed}
      <div class="empty">{t('calibration.loadFailed')}</div>
    {:else if data === null}
      <div class="empty">{t('calibration.loading')}</div>
    {:else if data.histograms.length === 0}
      <div class="empty">{t('calibration.empty')}</div>
    {:else}
      <div class="histograms">
        {#each data.histograms as histogram (histogram.id)}
          <section class="histogram">
            <header>
              <code>{histogram.id}</code>
              <span class="samples">
                {t('calibration.samples', { count: fmt(histogram.count) })}
              </span>
            </header>
            <BarChart points={histogramBarPoints(histogram)} />
            <dl class="stats">
              {#each stats(histogram) as stat}
                <div class="stat">
                  <dt>{t(stat.labelKey)}</dt>
                  <dd>{stat.value}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
    {/if}
  </Panel>
</div>

<style>
  .calibration-page {
    width: 100%;
  }

  .description {
    color: var(--text);
    line-height: 1.5;
  }

  .page-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 14px;
  }

  .control-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
  }

  .auto-refresh {
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

  .auto-refresh input {
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

  .auto-refresh input:checked + .switch-track {
    background: #17301f;
    border-color: #348b56;
  }

  .auto-refresh input:checked + .switch-track span {
    background: #7bea9f;
    transform: translateX(15px);
  }

  .auto-refresh input:focus-visible + .switch-track {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .histograms {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(min(560px, 100%), 1fr));
  }

  .histogram {
    padding: 12px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-soft);
    border-radius: 3px;
  }

  .histogram header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .histogram code {
    color: var(--gold-dim);
    overflow-wrap: anywhere;
  }

  .samples {
    color: var(--text-dim);
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 8px 0 0;
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .stat dt {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .stat dd {
    margin: 0;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 700px) {
    .page-controls {
      align-items: flex-start;
      flex-direction: column;
    }

    .control-actions {
      flex-wrap: wrap;
    }
  }
</style>
