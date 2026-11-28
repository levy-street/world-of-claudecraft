// The Guardian of the Breath after the team's review of 2026-11-17: a MUCH
// stronger wind on a longer warning and a longer calm, the indrawn breath more
// often, lightning falling from the sky in both halves (breath_sky.ts), and a
// faster, longer, stronger Storm Lance.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT } from '../src/sim/types';
import { breathFight } from './helpers/breath_fight';
import { hitsOf } from './helpers/council_fight';

const ticks = (s: number) => Math.round(s / DT);

describe('the Breath after the review of 2026-11-17', () => {
  it('blows hard enough to carry an idle body off the Cornice from its middle, with a long warning and calm', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const drift = BREATH_DIFFICULTY[tier].windSpeed * T.blowSeconds;
      // Past the Cornice's short half-axis (40 yd) from its middle.
      expect(drift, tier).toBeGreaterThan(BREATH.cornice.rz - 2);
      // A run (7 yd a second) into it still gains ground.
      expect(BREATH_DIFFICULTY[tier].windSpeed, tier).toBeLessThan(7);
    }
    expect(T.gatherSeconds).toBeGreaterThanOrEqual(5);
    expect(T.calmMin).toBeGreaterThan(T.gatherSeconds);
  });

  it('draws breath (the suction and the roar) more often', () => {
    expect(T.inhaleFirst).toBeLessThanOrEqual(25);
    expect(T.inhaleEvery).toBeLessThanOrEqual(30);
  });

  it('Storm Lance: faster, longer, stronger', () => {
    const line = SMITH_HEART_MOBS.heart_breath_guardian.trashKit?.line;
    expect(line?.castTime).toBeLessThan(2);
    expect(line?.length).toBeGreaterThanOrEqual(60);
    expect(line?.min).toBeGreaterThan(280);
    expect(line?.max).toBeGreaterThan(line?.min ?? 0);
  });

  it('sky strikes fall in the Wind on their clock, warned on the floor, and hurt who stays', () => {
    const f = breathFight(4, 23);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.half).toBe('wind');
    st.wind.phase = 'calm';
    st.wind.remaining = 999;
    st.inhaleTimer = 999;
    st.skyTimer = 0.05;
    f.tick(2);
    const strikes = f.objects(BREATH_OBJECTS.strikePrefix);
    expect(strikes.length).toBe(T.skyMarks + T.skySpots);
    // One lies under a marked player: they stand in it; it lands on its warning.
    const marked = f.players.find((p) =>
      strikes.some((s) => Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) < 0.5),
    );
    expect(marked).toBeDefined();
    const ev = f.tick(ticks(T.skyWarn) + 2);
    expect(f.objects(BREATH_OBJECTS.strikePrefix).length).toBe(0);
    expect(hitsOf(ev, BREATH_NAMES.strike, marked?.id).length).toBe(1);
    // And again on its clock.
    expect(st.skyTimer).toBeGreaterThan(T.skyEvery - T.skyWarn - 1);
  });

  it('sky strikes fall in the Storm too, never while it breaks', () => {
    const f = breathFight(4, 23);
    f.dev('/dev heart breath pull');
    f.tick(2);
    f.dev('/dev heart breath phase2');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.skyTimer = 0.05;
    f.tick(2);
    // The break holds the sky's clock.
    expect(st.half).toBe('break');
    expect(st.skyTimer).toBeCloseTo(0.05, 5);
    const before = st.skyVolleys;
    f.tick(ticks(T.stormCast + T.barrageSeconds) + 4);
    expect(st.half).toBe('storm');
    expect(st.skyVolleys).toBe(before + 1);
  });
});
