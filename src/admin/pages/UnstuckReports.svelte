<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import Badge from '../components/Badge.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtDate, fmtNumber } from '../format';
  import { adminLanguageTag, t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type {
    UnstuckArea,
    UnstuckOutcome,
    UnstuckPosition,
    UnstuckReportsData,
  } from '../types';

  const REPORT_DAYS = 30;
  const PAGE_LIMIT = 50;

  let data = $state<UnstuckReportsData | null>(null);
  let failed = $state(false);
  let loadingMore = $state(false);
  let loadMoreFailed = $state(false);
  let requestId = 0;

  const coordinateFormatter = new Intl.NumberFormat(adminLanguageTag(), {
    maximumFractionDigits: 1,
    useGrouping: false,
  });

  function coordinate(value: number): string {
    return coordinateFormatter.format(value);
  }

  function areaKind(kind: string): string {
    if (kind === 'overworld') return t('location.kind.overworld');
    if (kind === 'dungeon') return t('location.kind.dungeon');
    if (kind === 'delve') return t('location.kind.delve');
    return t('location.kind.rift');
  }

  function outcomeLabel(outcome: UnstuckOutcome): string {
    if (outcome === 'completed') return t('unstuckReports.outcome.completed');
    if (outcome === 'cancelled') return t('unstuckReports.outcome.cancelled');
    return t('unstuckReports.outcome.failed');
  }

  function outcomeVariant(
    outcome: UnstuckOutcome,
  ): 'success' | 'warn' | 'bad' {
    if (outcome === 'completed') return 'success';
    if (outcome === 'cancelled') return 'warn';
    return 'bad';
  }

  async function loadReports(beforeId: number | null): Promise<void> {
    const append = beforeId !== null;
    const currentRequest = ++requestId;
    if (append) {
      loadingMore = true;
      loadMoreFailed = false;
    } else {
      data = null;
      failed = false;
    }

    try {
      const params = new URLSearchParams({
        days: String(REPORT_DAYS),
        limit: String(PAGE_LIMIT),
      });
      if (beforeId !== null) params.set('beforeId', String(beforeId));
      const result = await apiGet<UnstuckReportsData>(`/admin/api/unstuck-reports?${params}`);
      if (currentRequest !== requestId) return;

      if (append && data !== null) {
        data = {
          ...result,
          reports: [...data.reports, ...result.reports],
          // Hotspots describe the full time window and only ride the first
          // page. Cursor pages must never erase the aggregate already shown.
          hotspots: data.hotspots,
        };
      } else {
        data = result;
      }
      failed = false;
      loadMoreFailed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) {
        if (append) loadMoreFailed = true;
        else failed = true;
      }
    } finally {
      if (currentRequest === requestId) loadingMore = false;
    }
  }

  onMount(() => {
    void loadReports(null);
    return () => {
      requestId += 1;
    };
  });
</script>

{#snippet AreaDetails(area: UnstuckArea)}
  <span class="detail-stack area-details">
    <strong>{t('unstuckReports.areaId', { value: area.id })}</strong>
    <span>{t('location.type', { value: areaKind(area.kind) })}</span>
    {#if area.instanceId}
      <span>{t('location.instance', { value: area.instanceId })}</span>
    {/if}
    {#if area.slot !== null}
      <span>{t('location.slot', { value: fmtNumber(area.slot) })}</span>
    {/if}
  </span>
{/snippet}

{#snippet Coordinates(position: UnstuckPosition)}
  <span class="detail-stack coordinates">
    <strong>
      {t('unstuckReports.localCoordinates', {
        x: coordinate(position.localX),
        y: coordinate(position.localY),
        z: coordinate(position.localZ),
      })}
    </strong>
    <span>
      {t('unstuckReports.worldCoordinates', {
        x: coordinate(position.x),
        y: coordinate(position.y),
        z: coordinate(position.z),
      })}
    </span>
  </span>
{/snippet}

<div class="unstuck-reports-page">
  <p class="description">
    {t('unstuckReports.description', { days: fmtNumber(data?.days ?? REPORT_DAYS) })}
  </p>

  {#if failed}
    <Panel>
      <div class="request-state" role="alert">
        <p>{t('unstuckReports.loadFailed')}</p>
        <button type="button" onclick={() => void loadReports(null)}>
          {t('unstuckReports.retry')}
        </button>
      </div>
    </Panel>
  {:else if data === null}
    <Panel>
      <div class="request-state" role="status">{t('unstuckReports.loading')}</div>
    </Panel>
  {:else}
    <Panel title={t('unstuckReports.hotspotsTitle')} hint={t('unstuckReports.hotspotsHint')}>
      {#if data.hotspots.length === 0}
        <div class="empty">{t('unstuckReports.emptyHotspots')}</div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable table region) -->
        <div
          class="table-scroll"
          role="region"
          aria-label={t('unstuckReports.hotspotsCaption')}
          tabindex="0"
        >
          <table class="hotspots-table">
            <caption>{t('unstuckReports.hotspotsCaption')}</caption>
            <thead>
              <tr>
                <th>{t('unstuckReports.colArea')}</th>
                <th>{t('unstuckReports.colBucket')}</th>
                <th class="num">{t('unstuckReports.colUses')}</th>
                <th class="num">{t('unstuckReports.colCompleted')}</th>
                <th class="num">{t('unstuckReports.colCancelled')}</th>
                <th class="num">{t('unstuckReports.colFailed')}</th>
                <th>{t('unstuckReports.colLastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.hotspots as hotspot (`${hotspot.area.kind}:${hotspot.area.id}:${hotspot.area.instanceId}:${hotspot.area.slot}:${hotspot.bucket.x}:${hotspot.bucket.y}:${hotspot.bucket.z}`)}
                <tr>
                  <td>{@render AreaDetails(hotspot.area)}</td>
                  <td>
                    <strong>
                      {t('unstuckReports.localCoordinates', {
                        x: coordinate(hotspot.bucket.x),
                        y: coordinate(hotspot.bucket.y),
                        z: coordinate(hotspot.bucket.z),
                      })}
                    </strong>
                  </td>
                  <td class="num">{fmtNumber(hotspot.count)}</td>
                  <td class="num">{fmtNumber(hotspot.completed)}</td>
                  <td class="num">{fmtNumber(hotspot.cancelled)}</td>
                  <td class="num">{fmtNumber(hotspot.failed)}</td>
                  <td><time datetime={hotspot.lastUsedAt}>{fmtDate(hotspot.lastUsedAt)}</time></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>

    <Panel title={t('unstuckReports.reportsTitle')} hint={t('unstuckReports.reportsHint')}>
      {#if data.reports.length === 0}
        <div class="empty">{t('unstuckReports.emptyReports')}</div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable table region) -->
        <div
          class="table-scroll"
          role="region"
          aria-label={t('unstuckReports.reportsCaption')}
          tabindex="0"
        >
          <table class="reports-table">
            <caption>{t('unstuckReports.reportsCaption')}</caption>
            <thead>
              <tr>
                <th>{t('unstuckReports.colWhen')}</th>
                <th>{t('unstuckReports.colCharacter')}</th>
                <th>{t('unstuckReports.colArea')}</th>
                <th>{t('unstuckReports.colOrigin')}</th>
                <th>{t('unstuckReports.colDestination')}</th>
                <th>{t('unstuckReports.colOutcome')}</th>
                <th>{t('unstuckReports.colReason')}</th>
                <th>{t('unstuckReports.colResolved')}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.reports as report (report.id)}
                <tr>
                  <td><time datetime={report.invokedAt}>{fmtDate(report.invokedAt)}</time></td>
                  <td>
                    <span class="detail-stack">
                      <strong>{report.characterName ?? t('common.unknown')}</strong>
                      {#if report.characterId !== null}
                        <span>
                          {t('unstuckReports.characterId', { id: fmtNumber(report.characterId) })}
                        </span>
                      {/if}
                    </span>
                  </td>
                  <td>{@render AreaDetails(report.area)}</td>
                  <td>{@render Coordinates(report.origin)}</td>
                  <td>
                    {#if report.destination}
                      {@render Coordinates(report.destination)}
                    {:else}
                      <span class="text-dim">{t('common.emptyValue')}</span>
                    {/if}
                  </td>
                  <td>
                    <Badge variant={outcomeVariant(report.outcome)}>
                      {outcomeLabel(report.outcome)}
                    </Badge>
                  </td>
                  <td class="reason-cell">
                    {#if report.reason}
                      <code>{report.reason}</code>
                    {:else}
                      <span class="text-dim">{t('common.emptyValue')}</span>
                    {/if}
                  </td>
                  <td>
                    {#if report.resolvedAt}
                      <time datetime={report.resolvedAt}>{fmtDate(report.resolvedAt)}</time>
                    {:else}
                      <span class="text-dim">{t('common.emptyValue')}</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if loadMoreFailed || (data.hasMore && data.nextBeforeId !== null)}
          <div class="load-more">
            {#if loadMoreFailed}
              <span role="alert">{t('unstuckReports.loadMoreFailed')}</span>
            {/if}
            {#if data.hasMore && data.nextBeforeId !== null}
              <button
                type="button"
                disabled={loadingMore}
                onclick={() => void loadReports(data?.nextBeforeId ?? null)}
              >
                {loadingMore ? t('unstuckReports.loadingMore') : t('unstuckReports.loadMore')}
              </button>
            {/if}
          </div>
        {/if}
      {/if}
    </Panel>
  {/if}
</div>

<style>
  .unstuck-reports-page {
    display: grid;
    width: min(100%, 1500px);
    gap: 16px;
  }

  .description {
    color: var(--text-soft);
    line-height: 1.5;
  }

  .request-state {
    display: grid;
    justify-items: start;
    gap: 12px;
    padding: 18px;
    color: var(--text-soft);
  }

  caption {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .hotspots-table {
    min-width: 980px;
  }

  .reports-table {
    min-width: 1420px;
  }

  .table-scroll:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .detail-stack {
    display: grid;
    gap: 3px;
    line-height: 1.35;
    white-space: normal;
  }

  .detail-stack span,
  .coordinates span {
    color: var(--text-dim);
    font-size: 11px;
  }

  .area-details {
    min-width: 160px;
  }

  .coordinates {
    min-width: 175px;
  }

  .reason-cell {
    max-width: 220px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .load-more {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 10px 14px;
    color: var(--text-soft);
    border-top: 1px solid var(--border-subtle);
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .load-more {
      flex-direction: column;
    }
  }
</style>
