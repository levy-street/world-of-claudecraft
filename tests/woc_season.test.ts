// Pure tests for the $WOC season presenter (src/ui/woc_season.ts): exact
// base-units→$WOC formatting and the view-model derivation (none/active/ended,
// countdown, emitted %). No DOM, no clock — nowMs is injected.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  baseToWoc, formatSeasonView, currentSeasonView, setWocSeason, setWocSeasonUiEnabled,
  wocSeasonUiEnabled, onWocSeasonChange, type WocSeasonPayload,
} from '../src/ui/woc_season';

const NOW = Date.parse('2026-06-21T00:00:00.000Z');
const season = (over: Partial<WocSeasonPayload['season'] & object> = {}): WocSeasonPayload => ({
  decimals: 6,
  season: {
    seasonId: 1, label: 'Season 1', status: 'active', openedAt: '2026-06-01T00:00:00.000Z',
    endsAt: null, sinkBase: '0', emissionBase: '0', poolBase: '0', ...over,
  },
});

describe('baseToWoc (exact, no float rounding)', () => {
  it('formats whole and fractional amounts, trimming trailing zeros', () => {
    expect(baseToWoc('2700000000', 6)).toBe('2700');
    expect(baseToWoc('2700500000', 6)).toBe('2700.5');
    expect(baseToWoc('1000000', 6)).toBe('1');
    expect(baseToWoc('999', 6)).toBe('0.000999');
    expect(baseToWoc('0', 6)).toBe('0');
  });
  it('handles amounts beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(baseToWoc('9000000000000000000', 6)).toBe('9000000000000'); // 9e18 base → 9e12 $WOC
  });
  it('handles zero decimals and rejects malformed input', () => {
    expect(baseToWoc('4200', 0)).toBe('4200');
    expect(baseToWoc('not-a-number', 6)).toBe('0');
  });
});

describe('formatSeasonView', () => {
  it('returns the none state for a null payload or a null season', () => {
    expect(formatSeasonView(null, NOW).state).toBe('none');
    expect(formatSeasonView({ season: null, decimals: 6 }, NOW).state).toBe('none');
  });

  it('derives pool/sink/emission as exact $WOC and the emitted percentage', () => {
    const v = formatSeasonView(season({ sinkBase: '4200000000', emissionBase: '1500000000', poolBase: '2700000000' }), NOW);
    expect(v).toMatchObject({ state: 'active', poolWoc: '2700', sinkWoc: '4200', emissionWoc: '1500' });
    expect(v.emittedPct).toBeCloseTo(35.71, 1); // 1500/4200
  });

  it('reports 0% emitted when there are no sinks yet (avoids divide-by-zero)', () => {
    expect(formatSeasonView(season({ sinkBase: '0', emissionBase: '0', poolBase: '0' }), NOW).emittedPct).toBe(0);
  });

  it('computes a countdown for a future end time', () => {
    const v = formatSeasonView(season({ endsAt: '2026-06-24T06:30:00.000Z' }), NOW);
    expect(v.state).toBe('active');
    expect(v.countdown).toEqual({ days: 3, hours: 6, minutes: 30, totalMs: 3 * 86_400_000 + 6 * 3_600_000 + 30 * 60_000 });
  });

  it('treats an open-ended season (null endsAt) as active with no countdown', () => {
    const v = formatSeasonView(season({ endsAt: null }), NOW);
    expect(v.state).toBe('active');
    expect(v.countdown).toBeNull();
  });

  it('marks a season whose end time has passed as ended', () => {
    const v = formatSeasonView(season({ endsAt: '2026-06-20T00:00:00.000Z' }), NOW);
    expect(v.state).toBe('ended');
    expect(v.countdown).toBeNull();
  });

  it('marks a closed/finalized season as ended even if its clock has not run out', () => {
    const v = formatSeasonView(season({ status: 'closed', endsAt: '2099-01-01T00:00:00.000Z' }), NOW);
    expect(v.state).toBe('ended');
    expect(v.countdown).toBeNull();
  });
});

describe('season UI state holder', () => {
  beforeEach(() => {
    setWocSeason(null);
    setWocSeasonUiEnabled(false);
    onWocSeasonChange(() => {}); // detach any prior listener
  });

  it('currentSeasonView reflects the pushed payload, and none when cleared', () => {
    expect(currentSeasonView(NOW).state).toBe('none');
    setWocSeason(season({ sinkBase: '4200000000', emissionBase: '1500000000', poolBase: '2700000000' }));
    const v = currentSeasonView(NOW);
    expect(v.state).toBe('active');
    expect(v.poolWoc).toBe('2700');
    setWocSeason(null);
    expect(currentSeasonView(NOW).state).toBe('none');
  });

  it('toggles the UI-enabled flag', () => {
    expect(wocSeasonUiEnabled()).toBe(false);
    setWocSeasonUiEnabled(true);
    expect(wocSeasonUiEnabled()).toBe(true);
  });

  it('notifies the listener on payload and enabled changes, and stops after unsubscribe', () => {
    const cb = vi.fn();
    const off = onWocSeasonChange(cb);
    setWocSeason(season());
    setWocSeasonUiEnabled(true);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setWocSeason(null);
    expect(cb).toHaveBeenCalledTimes(2); // no further calls after unsubscribe
  });

  it('does not notify when the enabled flag is set to its current value', () => {
    const cb = vi.fn();
    onWocSeasonChange(cb);
    setWocSeasonUiEnabled(false); // already false (reset in beforeEach)
    expect(cb).not.toHaveBeenCalled();
  });
});
