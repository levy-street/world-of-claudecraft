// The Quench's slash gives a fair reaction window (the team's playtest of
// 2026-11-25: "no time to dodge the sword"). The line follows its mark, then
// LOCKS the tier's slashLock before the blade flies (it was 0.8 s on every
// tier, 1.15 s from the lock to the strike); the lock rides the line's own
// template so every client draws and sounds it where the sim takes it, and
// the painter's fill completes the moment the blade flies while the locked
// edge burns.

import { describe, expect, it } from 'vitest';
import { SLASH_LOCK_SNAP, slashLaneLook } from '../src/render/smith_heart_fx/quench_fight_fx_core';
import {
  laneOf,
  laneTemplate,
  QUENCH_DIFFICULTY,
  type QuenchDifficulty,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT } from '../src/sim/types';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);
const TIERS: QuenchDifficulty[] = ['normal', 'heroic', 'mythic'];

/** A pulled fight, two blades awake, at `tier`, no round yet. */
function awake(tier: QuenchDifficulty): QuenchFight {
  const f = quenchFight(4, 31);
  f.dev('/dev heart quench pull');
  f.tick(1);
  if (tier !== 'normal') expect(f.dev(`/dev heart quench ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  f.tick(ticks(T.rimRise + T.wakeCast) + 2);
  st.slashTimer = 999;
  return f;
}

describe('the slash reaction window', () => {
  it('locks long enough on every tier: about 1.5 s to the strike on Normal, never under 1.1 s', () => {
    const total = (t: QuenchDifficulty) => QUENCH_DIFFICULTY[t].slashLock + T.slashFly;
    expect(total('normal')).toBeGreaterThanOrEqual(1.4);
    expect(total('normal')).toBeLessThanOrEqual(1.6);
    expect(total('heroic')).toBeLessThan(total('normal'));
    expect(total('mythic')).toBeLessThanOrEqual(total('heroic'));
    for (const t of TIERS) {
      expect(total(t), t).toBeGreaterThanOrEqual(1.1);
      // The line still follows its mark at least as long as it did (3, 2.5
      // and 2 s of warning less the old 0.8 s lock).
      const follow = QUENCH_DIFFICULTY[t].slashAim - QUENCH_DIFFICULTY[t].slashLock;
      expect(follow, t).toBeGreaterThanOrEqual({ normal: 2.2, heroic: 1.7, mythic: 1.2 }[t] - 1e-9);
    }
  });

  it('the lane template carries the lock, read back exactly', () => {
    const tpl = laneTemplate('warn', 3.4, 31, 1.2);
    expect(laneOf(tpl)).toEqual({ state: 'warn', seconds: 3.4, length: 31, lock: 1.2 });
    // An older template with no lock field reads none.
    expect(laneOf('sh_quench_lane_warn_30_12')?.lock).toBe(0);
    expect(laneOf(laneTemplate('fly', T.slashFly, 20))?.lock).toBe(0);
  });

  for (const tier of TIERS) {
    it(`${tier}: the line follows its mark until the tier's lock, then holds`, () => {
      const f = awake(tier);
      expect(f.dev('/dev heart quench slash')).toBe(true);
      const slash = f.state()?.slash;
      if (!slash) throw new Error('no round');
      const rules = QUENCH_DIFFICULTY[tier];
      expect(slash.lock).toBeCloseTo(rules.slashLock, 6);
      const lane = f.sim.entities.get(slash.laneId);
      if (!lane) throw new Error('no lane');
      expect(laneOf(lane.templateId)?.lock).toBeCloseTo(rules.slashLock, 6);
      const p = f.players.find((e) => e.id === slash.marks[0]);
      if (!p) throw new Error('no mark');
      // A tick before the lock: a step aside still turns the line.
      f.tick(ticks(rules.slashAim - rules.slashLock) - 2);
      let before = lane.facing;
      f.put(p, f.local(p).x + 6, f.local(p).z - 3);
      f.tick(1);
      expect(lane.facing).not.toBeCloseTo(before, 2);
      // Past the lock it holds whatever the mark does, until the blade flies.
      f.tick(3);
      before = lane.facing;
      f.put(p, f.local(p).x - 9, f.local(p).z + 5);
      f.tick(ticks(rules.slashLock) - 5);
      expect(lane.facing).toBe(before);
      expect(laneOf(lane.templateId)?.state).toBe('warn');
      f.tick(5);
      expect(laneOf(lane.templateId)?.state).toBe('fly');
    });
  }
});

describe("the slash line's look", () => {
  it('fills to the strike, snaps its edge alight at the lock, burns through the flight', () => {
    const N = QUENCH_DIFFICULTY.normal;
    const at = (e: number) => slashLaneLook(e, N.slashAim, N.slashLock, null, T.slashFly);
    expect(at(0).fill).toBe(0);
    expect(at(0).lock).toBe(0);
    expect(at(N.slashAim - N.slashLock - 0.05).lock).toBe(0);
    expect(at(N.slashAim - N.slashLock).lock).toBeCloseTo(SLASH_LOCK_SNAP, 6);
    // The fill completes exactly as the blade flies, the edge at full.
    expect(at(N.slashAim).fill).toBe(1);
    expect(at(N.slashAim).lock).toBeCloseTo(1, 6);
    expect(at(N.slashAim - 0.2).fill).toBeLessThan(1);
    // The flight: full, locked, fading as the blade runs down it.
    const fly0 = slashLaneLook(N.slashAim, N.slashAim, N.slashLock, 0, T.slashFly);
    expect(fly0).toMatchObject({ fill: 1, lock: 1, fade: 1 });
    const fly1 = slashLaneLook(N.slashAim, N.slashAim, N.slashLock, T.slashFly, T.slashFly);
    expect(fly1.fade).toBeLessThan(0.5);
    expect(fly1.fade).toBeGreaterThan(0);
  });
});
