// Tests for the pure CLAUDIUM supply view core: the disabled/empty state when
// the economy service is off, the projection of service totals, and the chart
// geometry built from the service curve. Same-input-same-output, no DOM.

import { describe, expect, it } from 'vitest';
import {
  buildClaudiumSupplyModel,
  type ClaudiumSupplyInput,
  type ClaudiumSupplyPointInput,
  type ClaudiumSupplyRange,
  claudiumSupplyQuery,
} from '../src/ui/claudium_supply_view';

const NOW = 1_720_000_000_000;
const HOUR = 3_600_000;

const LIVE: ClaudiumSupplyInput = {
  circulating: 96_697,
  issued: 120_000,
  sunk: 23_303,
  holders: 412,
  usdPerClaudium: 0.01,
  atMs: NOW,
};

const OFFLINE: ClaudiumSupplyInput = {
  circulating: null,
  issued: null,
  sunk: null,
  holders: null,
  usdPerClaudium: null,
  atMs: null,
};

function points(...pairs: Array<[number, number]>): ClaudiumSupplyPointInput[] {
  return pairs.map(([atMs, circulating]) => ({ atMs, circulating }));
}

/** The window the SERVICE would echo for a range, as the payload carries it. */
function win(range: ClaudiumSupplyRange): { sinceMs: number; untilMs: number } {
  const q = claudiumSupplyQuery(range, NOW);
  return { sinceMs: q.sinceMs, untilMs: q.untilMs };
}

describe('claudium supply view: availability', () => {
  it('renders a clean empty state when the service is off, never a crash', () => {
    const m = buildClaudiumSupplyModel({
      supply: OFFLINE,
      points: [],
      range: '7d',
      serviceWindow: win('7d'),
    });
    expect(m.available).toBe(false);
    expect(m.circulating).toBeNull();
    expect(m.circulatingUsd).toBeNull();
    expect(m.chart).toBeNull();
    expect(m.changeInWindow).toBeNull();
    // The range row still renders, so the panel keeps its shape while offline.
    expect(m.rangeOptions.map((r) => r.id)).toEqual(['24h', '7d', '30d']);
  });

  it('distinguishes a real zero total from an unreachable service', () => {
    const zero = buildClaudiumSupplyModel({
      supply: { ...LIVE, circulating: 0, issued: 0, sunk: 0, holders: 0 },
      points: [],
      range: '7d',
      serviceWindow: win('7d'),
    });
    expect(zero.available).toBe(true);
    expect(zero.circulating).toBe(0);
    // Both have a null chart, but only one is "available": the painter must be
    // able to tell "nothing exists yet" from "we cannot say".
    expect(zero.chart).toBeNull();
  });

  it('ignores stale points when the service reports totals as null', () => {
    const m = buildClaudiumSupplyModel({
      supply: OFFLINE,
      points: points([NOW - HOUR, 100], [NOW, 200]),
      range: '24h',
      serviceWindow: win('24h'),
    });
    expect(m.chart).toBeNull();
  });
});

describe('claudium supply view: totals projection', () => {
  it('carries service totals through verbatim and converts USD at the service peg', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: [],
      range: '7d',
      serviceWindow: win('7d'),
    });
    expect(m.circulating).toBe(96_697);
    expect(m.issued).toBe(120_000);
    expect(m.sunk).toBe(23_303);
    expect(m.holders).toBe(412);
    expect(m.circulatingUsd).toBeCloseTo(966.97, 6);
  });

  it('uses the peg the service sent, never a hardcoded one', () => {
    const m = buildClaudiumSupplyModel({
      supply: { ...LIVE, circulating: 1000, usdPerClaudium: 0.25 },
      points: [],
      range: '7d',
      serviceWindow: win('7d'),
    });
    expect(m.circulatingUsd).toBe(250);
  });

  it('reports a null USD value when the service omitted the peg', () => {
    const m = buildClaudiumSupplyModel({
      supply: { ...LIVE, usdPerClaudium: null },
      points: [],
      range: '7d',
      serviceWindow: win('7d'),
    });
    expect(m.circulating).toBe(96_697);
    expect(m.circulatingUsd).toBeNull();
  });

  it('marks exactly one range as selected', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: [],
      range: '30d',
      serviceWindow: win('30d'),
    });
    expect(m.rangeOptions.filter((r) => r.selected).map((r) => r.id)).toEqual(['30d']);
  });
});

describe('claudium supply view: query windows', () => {
  it('derives each range window from the injected clock', () => {
    expect(claudiumSupplyQuery('24h', NOW)).toEqual({
      sinceMs: NOW - 86_400_000,
      untilMs: NOW,
      bucketMs: 600_000,
    });
    expect(claudiumSupplyQuery('7d', NOW).sinceMs).toBe(NOW - 7 * 86_400_000);
    expect(claudiumSupplyQuery('30d', NOW).sinceMs).toBe(NOW - 30 * 86_400_000);
  });

  it('pairs a coarser bucket with a longer window', () => {
    const a = claudiumSupplyQuery('24h', NOW).bucketMs;
    const b = claudiumSupplyQuery('7d', NOW).bucketMs;
    const c = claudiumSupplyQuery('30d', NOW).bucketMs;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe('claudium supply view: chart geometry', () => {
  const range = '24h' as const;
  const since = NOW - 86_400_000;

  it('normalizes x by timestamp and flips y so 0 is the top of the plot', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 100], [NOW - 43_200_000, 200], [NOW, 300]),
      range,
      serviceWindow: win(range),
    });
    const chart = m.chart;
    expect(chart).not.toBeNull();
    if (!chart) return;

    expect(chart.points[0].x).toBeCloseTo(0, 6);
    expect(chart.points[1].x).toBeCloseTo(0.5, 6);
    expect(chart.points[2].x).toBeCloseTo(1, 6);
    // Highest value sits nearest the top (smallest y).
    expect(chart.points[2].y).toBeLessThan(chart.points[1].y);
    expect(chart.points[1].y).toBeLessThan(chart.points[0].y);
  });

  it('keeps every normalized coordinate inside the unit box', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 5], [since + HOUR, 90_000], [NOW, 42]),
      range,
      serviceWindow: win(range),
    });
    expect(m.chart).not.toBeNull();
    expect(m.chart?.points.length).toBeGreaterThan(0);
    for (const p of m.chart?.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('positions by timestamp so an inactive gap stays flat and wide', () => {
    // Two points 12h apart. Index-based x would place the second at 1.0; only
    // timestamp-based x puts it at the halfway mark where it belongs.
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 100], [since + 43_200_000, 100]),
      range,
      serviceWindow: win(range),
    });
    expect(m.chart?.points[1].x).toBeCloseTo(0.5, 6);
  });

  it('draws a constant supply as a centered horizontal line, not a divide by zero', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 5000], [since + HOUR, 5000], [NOW, 5000]),
      range,
      serviceWindow: win(range),
    });
    const chart = m.chart;
    expect(chart).not.toBeNull();
    if (!chart) return;
    for (const p of chart.points) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeCloseTo(0.5, 6);
    }
    expect(chart.maxCirculating).toBeGreaterThan(chart.minCirculating);
  });

  it('handles an all-zero flat series without collapsing', () => {
    const m = buildClaudiumSupplyModel({
      supply: { ...LIVE, circulating: 0 },
      points: points([since, 0], [NOW, 0]),
      range,
      serviceWindow: win(range),
    });
    expect(m.chart).not.toBeNull();
    expect(m.chart?.points.length).toBeGreaterThan(0);
    for (const p of m.chart?.points ?? []) expect(Number.isFinite(p.y)).toBe(true);
  });

  it('pads the bounds so the stroke never rides the plot edge', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 100], [NOW, 200]),
      range,
      serviceWindow: win(range),
    });
    const chart = m.chart;
    if (!chart) throw new Error('expected a chart');
    expect(chart.minCirculating).toBeLessThan(100);
    expect(chart.maxCirculating).toBeGreaterThan(200);
  });

  it('emits ascending time labels and descending-position value labels', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 100], [NOW, 200]),
      range,
      serviceWindow: win(range),
    });
    const chart = m.chart;
    if (!chart) throw new Error('expected a chart');

    expect(chart.valueLabels).toHaveLength(5);
    expect(chart.timeLabels).toHaveLength(4);
    // Value labels run bottom (at=1) to top (at=0), values ascending.
    expect(chart.valueLabels[0].at).toBeCloseTo(1, 6);
    expect(chart.valueLabels[4].at).toBeCloseTo(0, 6);
    for (let i = 1; i < chart.valueLabels.length; i++) {
      expect(chart.valueLabels[i].value).toBeGreaterThan(chart.valueLabels[i - 1].value);
    }
    // Time labels run left to right across the requested window.
    expect(chart.timeLabels[0].value).toBe(since);
    expect(chart.timeLabels[3].value).toBe(NOW);
  });

  it('keeps the first point even though its bucket floor precedes the window', () => {
    // The real shape from the service: points carry their BUCKET FLOOR, and
    // sinceMs is never bucket-aligned, so point one is normally a little older
    // than the requested start. It is the curve's left anchor and one end of
    // the period delta, so it must survive rather than be filtered away.
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since - 12 * 60_000, 77_900], [since + HOUR, 80_000], [NOW, 96_697]),
      range,
      serviceWindow: win(range),
    });
    expect(m.chart?.points).toHaveLength(3);
    expect(m.chart?.points[0].circulating).toBe(77_900);
    // The domain stretches back to that point, so x stays inside the unit box.
    expect(m.chart?.points[0].x).toBeCloseTo(0, 6);
    for (const p of m.chart?.points ?? []) expect(p.x).toBeGreaterThanOrEqual(0);
    // The delta spans the whole curve, first to last.
    expect(m.changeInWindow).toBe(96_697 - 77_900);
  });

  it('plots against the service window, so a later repaint cannot shed points', () => {
    // Same data, but the caller repaints much later. A window re-derived from a
    // fresh clock would slide forward and drop the older points; plotting
    // against the service's echoed window keeps the chart stable.
    const pts = points([since, 100], [since + HOUR, 200], [NOW, 300]);
    const atFetch = buildClaudiumSupplyModel({
      supply: LIVE,
      points: pts,
      range,
      serviceWindow: win(range),
    });
    const muchLater = buildClaudiumSupplyModel({
      supply: LIVE,
      points: pts,
      range,
      serviceWindow: win(range), // the payload's window does not move with the clock
    });
    expect(muchLater.chart?.points).toHaveLength(3);
    expect(muchLater.chart?.points).toEqual(atFetch.chart?.points);
    expect(muchLater.changeInWindow).toBe(200);
  });

  it('renders no chart when the service sent no window', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 100], [NOW, 200]),
      range,
      serviceWindow: null,
    });
    expect(m.available).toBe(true);
    expect(m.chart).toBeNull();
    expect(m.changeInWindow).toBeNull();
  });

  it('returns no chart when the service sent no points', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: [],
      range,
      serviceWindow: win(range),
    });
    expect(m.chart).toBeNull();
  });
});

describe('claudium supply view: window delta', () => {
  const range = '7d' as const;
  const since = NOW - 7 * 86_400_000;

  it('reports last minus first across the plotted window', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 77_900], [since + 24 * HOUR, 82_600], [NOW, 96_697]),
      range,
      serviceWindow: win(range),
    });
    expect(m.changeInWindow).toBe(96_697 - 77_900);
  });

  it('reports a negative delta when supply contracted', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([since, 500], [NOW, 300]),
      range,
      serviceWindow: win(range),
    });
    expect(m.changeInWindow).toBe(-200);
  });

  it('needs two points: a single point yields no delta', () => {
    const m = buildClaudiumSupplyModel({
      supply: LIVE,
      points: points([NOW, 100]),
      range,
      serviceWindow: win(range),
    });
    expect(m.changeInWindow).toBeNull();
  });
});

describe('claudium supply view: purity', () => {
  it('is same-input-same-output across repeated calls', () => {
    const input = {
      supply: LIVE,
      points: points([NOW - 2 * HOUR, 100], [NOW - HOUR, 150], [NOW, 220]),
      range: '24h' as const,
      serviceWindow: win('24h'),
    };
    expect(buildClaudiumSupplyModel(input)).toEqual(buildClaudiumSupplyModel(input));
  });

  it('does not mutate the input points', () => {
    const pts = points([NOW - HOUR, 100], [NOW, 200]);
    const snapshot = JSON.parse(JSON.stringify(pts));
    buildClaudiumSupplyModel({
      supply: LIVE,
      points: pts,
      range: '24h',
      serviceWindow: win('24h'),
    });
    expect(pts).toEqual(snapshot);
  });
});
