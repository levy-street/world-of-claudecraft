// Tests for the in-race Gauntlet HUD pure core (hodrics_hud_view.ts): the
// countdown/race/over state machine, the `rank` derivation (place among
// racers, 1-based), and the render-skip signature. DOM-free / i18n-free.

import { describe, expect, it } from 'vitest';
import { buildHcHudView } from '../src/ui/hodrics_hud_view';
import type { HcInfo, HcRacerView } from '../src/world_api';

function racer(over: Partial<HcRacerView> = {}): HcRacerView {
  return {
    name: 'Racer',
    cls: 'warrior',
    bot: false,
    you: false,
    progress: 0,
    finished: false,
    place: null,
    eliminated: false,
    left: false,
    ...over,
  };
}

describe('buildHcHudView', () => {
  it('is hidden when there is no match', () => {
    expect(buildHcHudView(null)).toEqual({ kind: 'hidden' });
    expect(buildHcHudView({ queued: null, standing: null, match: null })).toEqual({
      kind: 'hidden',
    });
  });

  it('is a countdown view during countdown, carrying whole seconds', () => {
    const view = buildHcHudView({
      queued: null,
      standing: null,
      match: {
        state: 'countdown',
        round: 1,
        rounds: 3,
        qualify: 6,
        courseSeed: 777,
        countdown: 3,
        clock: 0,
        timeLeft: 240,
        section: 'start_yard',
        checkpoint: 0,
        finished: false,
        place: null,
        eliminated: false,
        falls: 0,
        racers: [],
      },
    });
    expect(view).toEqual({ kind: 'countdown', round: 1, rounds: 3, seconds: 3, sig: 'c1:3' });
  });

  it('is an over view once the match state is over, won vs placed', () => {
    const base = {
      state: 'over' as const,
      round: 3,
      rounds: 3,
      qualify: 1,
      courseSeed: 777,
      countdown: 0,
      clock: 90,
      timeLeft: 0,
      section: 'finish_keep',
      checkpoint: 4,
      eliminated: false,
      falls: 1,
      racers: [],
    };
    const won = buildHcHudView({
      queued: null,
      standing: null,
      match: { ...base, finished: true, place: 1, eliminated: false },
    });
    expect(won).toEqual({ kind: 'over', place: 1, won: true, sig: 'o1' });
    const placed = buildHcHudView({
      queued: null,
      standing: null,
      match: { ...base, finished: true, place: 4, eliminated: false },
    });
    expect(placed).toEqual({ kind: 'over', place: 4, won: false, sig: 'o4' });
  });

  it('derives rank as 1-based position among racers, in list order', () => {
    const view = buildHcHudView({
      queued: null,
      standing: null,
      match: {
        state: 'active',
        round: 1,
        rounds: 3,
        qualify: 6,
        courseSeed: 777,
        countdown: 0,
        clock: 30,
        timeLeft: 210,
        section: 'axe_walk',
        checkpoint: 2,
        finished: false,
        place: null,
        eliminated: false,
        falls: 0,
        racers: [
          racer({ name: 'Leader', progress: 0.9 }),
          racer({ name: 'Me', you: true, progress: 0.6 }),
          racer({ name: 'Last', progress: 0.1 }),
        ],
      },
    });
    expect(view.kind).toBe('race');
    if (view.kind !== 'race') return;
    expect(view.rank).toBe(2);
    expect(view.fieldSize).toBe(3);
    expect(view.progress).toBeCloseTo(0.6);
    expect(view.section).toBe('axe_walk');
    expect(view.falls).toBe(0);
    expect(view.timeLeft).toBe(210);
  });

  it('rank falls back to 1 if, somehow, no row is flagged "you"', () => {
    const view = buildHcHudView({
      queued: null,
      standing: null,
      match: {
        state: 'active',
        round: 1,
        rounds: 3,
        qualify: 6,
        courseSeed: 777,
        countdown: 0,
        clock: 5,
        timeLeft: 235,
        section: 'start_yard',
        checkpoint: 0,
        finished: false,
        place: null,
        eliminated: false,
        falls: 0,
        racers: [racer({ name: 'A' }), racer({ name: 'B' })],
      },
    });
    expect(view.kind === 'race' && view.rank).toBe(1);
  });

  it('a finished-but-still-racing (match not over) racer keeps their place', () => {
    const view = buildHcHudView({
      queued: null,
      standing: null,
      match: {
        state: 'active',
        round: 1,
        rounds: 3,
        qualify: 6,
        courseSeed: 777,
        countdown: 0,
        clock: 60,
        timeLeft: 180,
        section: 'finish_keep',
        checkpoint: 4,
        finished: true,
        place: 2,
        eliminated: false,
        falls: 0,
        racers: [racer({ you: true, finished: true, place: 2, progress: 1 })],
      },
    });
    expect(view.kind).toBe('race');
    if (view.kind !== 'race') return;
    expect(view.finished).toBe(true);
    expect(view.place).toBe(2);
  });

  it('the render-skip signature is stable for identical input and changes on real change', () => {
    const match: NonNullable<HcInfo['match']> = {
      state: 'active',
      round: 1,
      rounds: 3,
      qualify: 6,
      courseSeed: 777,
      countdown: 0,
      clock: 10,
      timeLeft: 230,
      section: 'rotor_court',
      checkpoint: 1,
      finished: false,
      place: null,
      eliminated: false,
      falls: 0,
      racers: [racer({ you: true, progress: 0.2 })],
    };
    const a = buildHcHudView({ queued: null, standing: null, match });
    const b = buildHcHudView({ queued: null, standing: null, match: { ...match } });
    expect(a.kind === 'race' && b.kind === 'race' && a.sig === b.sig).toBe(true);
    const changed = buildHcHudView({
      queued: null,
      standing: null,
      match: { ...match, falls: 1 },
    });
    expect(a.kind === 'race' && changed.kind === 'race' && a.sig !== changed.sig).toBe(true);
  });
});
