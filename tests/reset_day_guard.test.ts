// The monotonic non-decreasing clamp on Sim.resetDay (masterwrought Phase 18
// hardening): the host calendar feeds the daily-reset window key per tick
// (server/sim_calendar_feed.ts, src/game/utc_day.ts), and every daily gate
// rolls its window the moment the key CHANGES, so a backwards realm-calendar
// read (an NTP step, a zone reconfiguration, a corrected realm clock) used to
// re-open every spent daily gate for a second payout that day. The setter now
// holds the highest key it has ever been fed: a backwards read serves the
// held day (self-healing when the calendar catches up), and losing the
// calendar ('' fed after a known day) never lowers it either, which also
// closes the ''-bounce variant (known day, '', then an older day). ISO
// 'YYYY-MM-DD' keys order lexicographically, so the clamp is one comparison.

import { describe, expect, it } from 'vitest';
import { refreshWyrmfallDaily } from '../src/sim/professions/masterwrought_materials';
import { type PlayerMeta, Sim } from '../src/sim/sim';

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
}

describe('Sim.resetDay is monotonic non-decreasing', () => {
  it('holds the newest day across a backwards read and a calendar loss', () => {
    const sim = makeSim();
    expect(sim.resetDay).toBe('');
    sim.resetDay = '2026-08-30';
    expect(sim.resetDay).toBe('2026-08-30');
    // The backwards realm-calendar read: held, never served.
    sim.resetDay = '2026-08-29';
    expect(sim.resetDay).toBe('2026-08-30');
    // Forward reads keep flowing (self-healing).
    sim.resetDay = '2026-08-31';
    expect(sim.resetDay).toBe('2026-08-31');
    // The ''-bounce: losing the calendar never lowers the held key, so a
    // later stale day cannot sneak under it through the unknown state.
    sim.resetDay = '';
    expect(sim.resetDay).toBe('2026-08-31');
    sim.resetDay = '2026-08-25';
    expect(sim.resetDay).toBe('2026-08-31');
    // The seam view serves the same clamped value the gates read.
    expect(sim.ctx.resetDay).toBe('2026-08-31');
  });

  it('a backwards read cannot re-open a spent daily gate', () => {
    // Driven through a REAL gate consumer: the wyrmfall daily rolls its
    // window whenever ctx.resetDay differs from the stored date, so before
    // the clamp a backwards read emptied the spent-sources set and re-armed
    // the day's payout. Every other daily gate (craftDaily, delveDaily, the
    // battleground first-win, honor DR) reads the same ctx.resetDay, so the
    // one clamp at the source covers them all.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId) as PlayerMeta;
    sim.resetDay = '2026-08-30';
    refreshWyrmfallDaily(sim.ctx, meta);
    meta.wyrmfallDaily.sources.add('emberfall_depths:heroic');
    // The realm clock steps back a day; the gate must stay spent.
    sim.resetDay = '2026-08-29';
    refreshWyrmfallDaily(sim.ctx, meta);
    expect(meta.wyrmfallDaily.date).toBe('2026-08-30');
    expect(meta.wyrmfallDaily.sources.has('emberfall_depths:heroic')).toBe(true);
    // And the genuine next day still rolls the window over.
    sim.resetDay = '2026-08-31';
    refreshWyrmfallDaily(sim.ctx, meta);
    expect(meta.wyrmfallDaily.date).toBe('2026-08-31');
    expect(meta.wyrmfallDaily.sources.size).toBe(0);
  });
});
