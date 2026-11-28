// Basalt Fist marks TWO players on Heroic and Mythic (Jose's call of
// 2026-11-25; encounters/smith_heart/heat_fist.ts, HEAT_DIFFICULTY
// `fistMarks`): each marked player's spot is slammed and rolls its own three
// Molten Swells, the two spots well apart and never the tank's while anyone
// else stands. Normal stays at one. Deterministic.

import { describe, expect, it } from 'vitest';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { FIST_TWIN_APART } from '../src/sim/encounters/smith_heart/heat_fist';
import {
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_OBJECTS,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { SimEvent } from '../src/sim/types';
import { type HeatFight, heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s * 20);
const cues = (ev: SimEvent[], ability: string) =>
  ev.filter((e) => (e.type === 'spellfxAt' || e.type === 'spellfx') && e.ability === ability);

/** A pulled fight, the raid spread round the shore, the fist due now. */
function due(tier: 'normal' | 'heroic' | 'mythic', seed = 31): HeatFight {
  const f = heatFight(6, seed);
  if (tier !== 'normal') expect(f.dev(`/dev heart heat ${tier}`)).toBe(true);
  expect(f.dev('/dev heart heat pull')).toBe(true);
  f.boss().threat.set(f.players[0].id, 1e6);
  f.tick(2);
  f.players.forEach((p, i) => {
    const a = (i / f.players.length) * Math.PI * 2;
    f.put(p, HEARTH_WELL.x + Math.sin(a) * 18, HEARTH_WELL.z + Math.cos(a) * 18);
  });
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.wheelTimer = 999;
  st.zoneTimer = 999;
  st.seedTimer = 999;
  st.fistTimer = 0.05;
  f.tick(3);
  return f;
}

describe('Basalt Fist marks two on Heroic and Mythic', () => {
  it('rules: one on Normal, two on Heroic and Mythic', () => {
    expect(HEAT_DIFFICULTY.normal.fistMarks).toBe(1);
    expect(HEAT_DIFFICULTY.heroic.fistMarks).toBe(2);
    expect(HEAT_DIFFICULTY.mythic.fistMarks).toBe(2);
  });

  it('Normal: one spot and its three lanes', () => {
    const f = due('normal');
    expect(f.objects(HEAT_OBJECTS.fistPrefix)).toHaveLength(1);
    expect(f.objects(HEAT_OBJECTS.lanePrefix)).toHaveLength(3);
  });

  for (const tier of ['heroic', 'mythic'] as const)
    it(`${tier}: two spots well apart, off the tank, both slammed, six swells`, () => {
      const f = due(tier);
      const fists = f.objects(HEAT_OBJECTS.fistPrefix);
      expect(fists).toHaveLength(2);
      expect(f.objects(HEAT_OBJECTS.lanePrefix)).toHaveLength(6);
      const [a, b] = fists.map((e) => f.local(e));
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(FIST_TWIN_APART);
      const tank = f.local(f.players[0]);
      for (const s of [a, b])
        expect(Math.hypot(s.x - tank.x, s.z - tank.z)).toBeGreaterThan(T.fistR);
      const ev = f.tick(ticks(T.fistCast + 0.3));
      expect(cues(ev, HEAT_CUES.fist)).toHaveLength(2);
      const roll = f.tick(ticks(2));
      expect(cues(roll, HEAT_CUES.swell)).toHaveLength(6);
    });

  it('is deterministic', () => {
    const spots = () =>
      (() => {
        const f = due('heroic', 17);
        return f.objects(HEAT_OBJECTS.fistPrefix).map((e) => f.local(e));
      })();
    expect(spots()).toEqual(spots());
  });
});
