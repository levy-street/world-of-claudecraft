// The Breath's blow is a real threat on every tier (Jose's playtest of
// 2026-11-25: on Normal a body left standing stayed on the Cornice blow after
// blow, the bearings swinging nearly opposite and carrying it back to the
// middle). Now the wind wheels round a step at a time (BLOW_BEARINGS: never
// more than about 60 degrees between two blows) and Normal's blow is a little
// harder (6.2 yd/s, still under a run): a body that stands still from any
// usual spot goes off the edge on the first or second blow, while one that
// walks straight into the wind holds. Deterministic.

import { describe, expect, it } from 'vitest';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import {
  BLOW_BEARINGS,
  BREATH_DIFFICULTY,
  blowBearing,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { breathFight } from './helpers/breath_fight';

/** The usual spots (instance-local): the middle, the tank's by the guardian,
 *  melee behind it, ranged out to either side. */
const SPOTS: readonly [number, number][] = [
  [0, 196],
  [0, 188],
  [8, 200],
  [-16, 186],
  [16, 208],
  [22, 184],
];

interface Run {
  fell: boolean;
  /** Blows begun when it fell (or in all). */
  blows: number;
}

/** A body at (x, z) through the wind alone (no tank blow, circle, breath,
 *  strike or ball), the pull's first bearing `start`; it stands still, or
 *  walks straight into each blow. */
function run(
  tier: 'normal' | 'heroic',
  x: number,
  z: number,
  start: number,
  walk: boolean,
  seconds = 70,
): Run {
  const f = breathFight(2, 23);
  if (tier !== 'normal') expect(f.dev(`/dev heart breath ${tier}`)).toBe(true);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.start = start;
  const p = f.players[1];
  const meta = f.sim.players.get(p.id);
  if (!meta) throw new Error('meta');
  f.put(p, x, z);
  let blows = 0;
  let last = '';
  for (let i = 0; i < seconds * 20; i++) {
    st.skyTimer = 999;
    st.circleTimer = 999;
    st.blowTimer = 999;
    st.inhaleTimer = 999;
    st.heartTimer = 999;
    for (const q of f.players) q.hp = q.maxHp;
    const blowing = st.wind.phase === 'blow';
    if (walk) {
      // Straight into the wind (the way it blows FROM).
      const h = (st.wind.bearing * Math.PI) / 180;
      p.facing = h + Math.PI;
      meta.moveInput.forward = blowing;
    }
    f.tick(1);
    if (st.wind.phase !== last) {
      if (st.wind.phase === 'blow') blows++;
      last = st.wind.phase;
    }
    const at = f.local(p);
    if (p.dead || !inBreathArena(at.x, at.z)) return { fell: true, blows };
  }
  return { fell: false, blows };
}

describe("the Breath's blow carries a stander off", () => {
  it('turns a step at a time: no two blows in a row near opposite', () => {
    for (let k = 0; k < BLOW_BEARINGS.length * 2; k++) {
      const a = blowBearing(0, k);
      const b = blowBearing(0, k + 1);
      const d = Math.abs(((b - a + 540) % 360) - 180);
      expect(d, `${a} to ${b}`).toBeLessThanOrEqual(90);
    }
    // Still under a run on every tier: a walk into it gains ground.
    for (const k of ['normal', 'heroic', 'mythic'] as const)
      expect(BREATH_DIFFICULTY[k].windSpeed).toBeLessThan(7);
  });

  it('Normal: standing still from every usual spot falls on the first or second blow', () => {
    for (const start of [0, 2, 4])
      for (const [x, z] of SPOTS) {
        const r = run('normal', x, z, start, false);
        expect(r.fell, `start ${start} at ${x},${z}`).toBe(true);
        expect(r.blows, `start ${start} at ${x},${z}`).toBeLessThanOrEqual(2);
      }
  });

  it('Heroic: standing still falls on the first or second blow too', () => {
    for (const start of [1, 5])
      for (const [x, z] of SPOTS.slice(0, 4)) {
        const r = run('heroic', x, z, start, false);
        expect(r.fell, `start ${start} at ${x},${z}`).toBe(true);
        expect(r.blows).toBeLessThanOrEqual(2);
      }
  });

  it('walking straight into each blow holds, on Normal and Heroic', () => {
    for (const tier of ['normal', 'heroic'] as const)
      for (const [x, z] of [SPOTS[0], SPOTS[3]]) {
        const r = run(tier, x, z, 0, true, 50);
        expect(r.fell, `${tier} at ${x},${z}`).toBe(false);
        expect(r.blows).toBeGreaterThanOrEqual(2);
      }
  });

  it('is deterministic', () => {
    expect(run('normal', 8, 200, 3, false)).toEqual(run('normal', 8, 200, 3, false));
  });
});
