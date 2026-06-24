import { escapeHtml } from './format';
import { t } from './i18n';

// Hand-rolled SVG bar charts — no chart library needed for bars and labels.

export interface BarPoint {
  label: string;
  value: number;
  title?: string;
}

export interface LinePoint {
  label: string;
  value: number;
  secondaryValue?: number;
  title?: string;
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 180;
const AXIS_HEIGHT = 16;
const BAR_GAP = 2;
const MAX_X_LABELS = 10;

export function barChart(points: BarPoint[], opts: { valueSuffix?: string } = {}): string {
  if (points.length === 0) return `<div class="empty">${t('charts.noData')}</div>`;
  const max = Math.max(...points.map((p) => p.value), 1);
  const plotHeight = CHART_HEIGHT - AXIS_HEIGHT;
  const barWidth = Math.max(1, CHART_WIDTH / points.length - BAR_GAP);
  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));

  const bars = points.map((p, i) => {
    const h = Math.max(1, Math.round((p.value / max) * (plotHeight - 8)));
    const x = (i * CHART_WIDTH) / points.length;
    const y = plotHeight - h;
    const title = escapeHtml(p.title ?? `${p.label}: ${p.value}${opts.valueSuffix ?? ''}`);
    const label =
      i % labelEvery === 0
        ? `<text class="axis" x="${x + barWidth / 2}" y="${CHART_HEIGHT - 4}" text-anchor="middle">${escapeHtml(p.label)}</text>`
        : '';
    return `<g><rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${h}"><title>${title}</title></rect>${label}</g>`;
  });

  return `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet">
    <text class="axis" x="0" y="10">${max}${escapeHtml(opts.valueSuffix ?? '')}</text>
    ${bars.join('')}
  </svg>`;
}

export function lineChart(points: LinePoint[], opts: { valueSuffix?: string } = {}): string {
  if (points.length === 0) return `<div class="empty">${t('charts.noData')}</div>`;
  const max = Math.max(...points.flatMap((p) => [p.value, p.secondaryValue ?? 0]), 1);
  const plotHeight = CHART_HEIGHT - AXIS_HEIGHT;
  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const xFor = (i: number) =>
    points.length === 1 ? CHART_WIDTH / 2 : (i / (points.length - 1)) * CHART_WIDTH;
  const yFor = (value: number) =>
    plotHeight - Math.max(1, Math.round((value / max) * (plotHeight - 8)));
  const primary = points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(' ');
  const secondaryPoints = points.filter((p) => p.secondaryValue !== undefined);
  const secondary =
    secondaryPoints.length === points.length
      ? points.map((p, i) => `${xFor(i)},${yFor(p.secondaryValue ?? 0)}`).join(' ')
      : '';
  const labels = points
    .map((p, i) => {
      if (i % labelEvery !== 0) return '';
      return `<text class="axis" x="${xFor(i)}" y="${CHART_HEIGHT - 4}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    })
    .join('');
  const hits = points
    .map((p, i) => {
      const x = xFor(i);
      const title = escapeHtml(p.title ?? `${p.label}: ${p.value}${opts.valueSuffix ?? ''}`);
      return `<circle class="line-hit" cx="${x}" cy="${yFor(p.value)}" r="5"><title>${title}</title></circle>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet">
    <text class="axis" x="0" y="10">${max}${escapeHtml(opts.valueSuffix ?? '')}</text>
    ${secondary ? `<polyline class="line secondary" points="${secondary}" />` : ''}
    <polyline class="line primary" points="${primary}" />
    ${hits}
    ${labels}
  </svg>`;
}

export function chartPanel(title: string, bodyHtml: string): string {
  return `<div class="panel chart"><div class="panel-title">${escapeHtml(title)}</div>${bodyHtml}</div>`;
}
