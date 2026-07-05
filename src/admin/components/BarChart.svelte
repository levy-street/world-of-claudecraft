<script lang="ts">
  import type { BarPoint } from '../types';
  import { t } from '../i18n';

  // Hand-rolled SVG bar chart (no chart library), ported from the old charts.ts. Drawn
  // with native Svelte SVG elements rather than an {@html} string, so bar labels and
  // tooltips are auto-escaped and there is no innerHTML surface. Geometry constants and
  // output match the previous barChart() so the charts look identical.
  let { points, valueSuffix = '' }: { points: BarPoint[]; valueSuffix?: string } = $props();

  const WIDTH = 560;
  const HEIGHT = 180;
  const AXIS_HEIGHT = 16;
  const BAR_GAP = 2;
  const MAX_X_LABELS = 10;

  let max = $derived(Math.max(...points.map((p) => p.value), 1));
  let plotHeight = $derived(HEIGHT - AXIS_HEIGHT);
  let barWidth = $derived(Math.max(1, WIDTH / Math.max(1, points.length) - BAR_GAP));
  let labelEvery = $derived(Math.max(1, Math.ceil(points.length / MAX_X_LABELS)));

  let bars = $derived(
    points.map((p, i) => {
      const h = Math.max(1, Math.round((p.value / max) * (plotHeight - 8)));
      const x = (i * WIDTH) / points.length;
      return {
        x,
        y: plotHeight - h,
        h,
        labelX: x + barWidth / 2,
        showLabel: i % labelEvery === 0,
        label: p.label,
        title: p.title ?? `${p.label}: ${p.value}${valueSuffix}`,
      };
    }),
  );
</script>

<div class="chart">
  {#if points.length === 0}
    <div class="empty">{t('charts.noData')}</div>
  {:else}
    <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="xMidYMid meet">
      <text class="axis" x="0" y="10">{max}{valueSuffix}</text>
      {#each bars as b}
        <g>
          <rect class="bar" x={b.x} y={b.y} width={barWidth} height={b.h}>
            <title>{b.title}</title>
          </rect>
          {#if b.showLabel}
            <text class="axis" x={b.labelX} y={HEIGHT - 4} text-anchor="middle">{b.label}</text>
          {/if}
        </g>
      {/each}
    </svg>
  {/if}
</div>
