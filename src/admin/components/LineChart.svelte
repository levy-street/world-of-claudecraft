<script lang="ts">
  import type { LinePoint } from '../types';
  import { t } from '../i18n';

  let { points, valueSuffix = '' }: { points: LinePoint[]; valueSuffix?: string } = $props();

  const WIDTH = 560;
  const HEIGHT = 180;
  const AXIS_HEIGHT = 16;
  const MAX_X_LABELS = 10;

  let max = $derived(
    Math.max(...points.flatMap((point) => [point.value, point.secondaryValue ?? 0]), 1),
  );
  let plotHeight = $derived(HEIGHT - AXIS_HEIGHT);
  let labelEvery = $derived(Math.max(1, Math.ceil(points.length / MAX_X_LABELS)));
  const xFor = (index: number): number =>
    points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH;
  const yFor = (value: number): number =>
    plotHeight - Math.max(1, Math.round((value / max) * (plotHeight - 8)));

  let chartPoints = $derived(
    points.map((point, index) => ({
      x: xFor(index),
      y: yFor(point.value),
      secondaryY:
        point.secondaryValue === undefined ? undefined : yFor(point.secondaryValue),
      showLabel: index % labelEvery === 0,
      label: point.label,
      title: point.title ?? `${point.label}: ${point.value}${valueSuffix}`,
    })),
  );
  let primary = $derived(chartPoints.map((point) => `${point.x},${point.y}`).join(' '));
  let secondary = $derived(
    chartPoints.every((point) => point.secondaryY !== undefined)
      ? chartPoints.map((point) => `${point.x},${point.secondaryY}`).join(' ')
      : '',
  );
</script>

<div class="chart">
  {#if points.length === 0}
    <div class="empty">{t('charts.noData')}</div>
  {:else}
    <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="xMidYMid meet">
      <text class="axis" x="0" y="10">{max}{valueSuffix}</text>
      {#if secondary}
        <polyline class="line secondary" points={secondary} />
      {/if}
      <polyline class="line primary" points={primary} />
      {#each chartPoints as point}
        <circle class="line-hit" cx={point.x} cy={point.y} r="5">
          <title>{point.title}</title>
        </circle>
        {#if point.showLabel}
          <text class="axis" x={point.x} y={HEIGHT - 4} text-anchor="middle">
            {point.label}
          </text>
        {/if}
      {/each}
    </svg>
  {/if}
</div>
