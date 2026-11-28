// The Summit Roar's follow-through gust (Jose's call of 2026-11-25): the
// moment a body's throw settles, a strong steady wind blows it on the way it
// was thrown, out toward the rim, for the tier's seconds (wind_drift.ts
// WIND_GUST_AURA, steered to the walk). Walk straight back against it and you
// hold; stand and you are carried: off the Cornice on Heroic and Mythic, let
// go short of the lip on Normal. The anchored keep their feet.

import { describe, expect, it } from 'vitest';
import {
  BREATH_AURAS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import { roarGustShare } from '../src/sim/encounters/smith_heart/breath_roar_gust';
import { putMarker } from '../src/sim/encounters/smith_heart/fight_kit';
import { WIND_GUST_AURA } from '../src/sim/wind_drift';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);

interface Run {
  fell: boolean;
  /** Yards from the guardian as the gust began and at the end. */
  landed: number;
  end: number;
  gusted: boolean;
  /** The gust's speeds seen, in order (its ramp). */
  speeds: number[];
  /** Its heading against the throw's way out (cosine). */
  along: number;
}

/** One player `d` yards out along `bearing` as the Roar lands: it stands, or
 *  walks straight back at the guardian from the strike on. */
function roar(
  tier: 'normal' | 'heroic' | 'mythic',
  bearing: number,
  walk: boolean,
  prep?: (f: BreathFight) => void,
  d = 6,
): Run {
  const f = breathFight(1, 23);
  if (tier !== 'normal') expect(f.dev(`/dev heart breath ${tier}`)).toBe(true);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.skyTimer = 999;
  st.circleTimer = 999;
  st.blowTimer = 999;
  expect(f.dev('/dev heart breath roar')).toBe(true);
  f.tick(ticks(T.inhaleCast) + 2);
  const p = f.players[0];
  const g = f.local(f.boss());
  const h = (bearing * Math.PI) / 180;
  f.put(p, g.x + Math.sin(h) * d, g.z + Math.cos(h) * d);
  prep?.(f);
  const meta = f.sim.players.get(p.id);
  if (!meta) throw new Error('meta');
  const out: Run = { fell: false, landed: -1, end: d, gusted: false, speeds: [], along: 0 };
  const hp0 = p.hp;
  let struck = false;
  const rules = BREATH_DIFFICULTY[tier];
  for (let i = 0; i < ticks(T.gustCast + T.roarThrowSlide + rules.roarGustSeconds + 3); i++) {
    f.tick(1);
    if (!struck && p.hp < hp0) struck = true;
    if (struck && walk) meta.moveInput.forward = true;
    p.facing = Math.atan2(f.boss().pos.x - p.pos.x, f.boss().pos.z - p.pos.z);
    const at = f.local(p);
    const r = Math.hypot(at.x - g.x, at.z - g.z);
    const a = p.auras.find((x) => x.id === WIND_GUST_AURA);
    if (a) {
      if (!out.gusted) {
        out.landed = r;
        out.along = Math.sin(a.value) * Math.sin(h) + Math.cos(a.value) * Math.cos(h);
      }
      out.gusted = true;
      const v = a.value2 ?? 0;
      if (out.speeds[out.speeds.length - 1] !== v) out.speeds.push(v);
    }
    if (p.dead || !inBreathArena(at.x, at.z)) out.fell = true;
    if (!out.fell) out.end = r;
  }
  return out;
}

const BEARINGS = [0, 90, 180, 315];

describe("the Summit Roar's follow-through gust", () => {
  it('blows a little slower than a run, longer and harder on Heroic and Mythic', () => {
    const n = BREATH_DIFFICULTY.normal;
    const h = BREATH_DIFFICULTY.heroic;
    expect(n.roarGustSpeed).toBeLessThan(7);
    expect(h.roarGustSpeed).toBeLessThan(7);
    expect(h.roarGustSpeed * h.roarGustSeconds).toBeGreaterThan(
      n.roarGustSpeed * n.roarGustSeconds,
    );
    expect(BREATH_DIFFICULTY.mythic.roarGustSpeed).toBe(h.roarGustSpeed);
    expect(n.roarGustSeconds).toBeGreaterThanOrEqual(3);
    expect(h.roarGustSeconds).toBeLessThanOrEqual(4);
    // Its ramp: half, whole, half again at the end (a gust, not a wall).
    expect(roarGustShare(0, 3)).toBe(0.5);
    expect(roarGustShare(1, 3)).toBe(1);
    expect(roarGustShare(2.95, 3)).toBe(0.5);
  });

  it('follows the throw: outward, ramped in, then whole', () => {
    const run = roar('heroic', 90, true);
    expect(run.gusted).toBe(true);
    expect(run.along).toBeGreaterThan(0.99);
    const full = BREATH_DIFFICULTY.heroic.roarGustSpeed;
    expect(run.speeds[0]).toBeCloseTo(full / 2, 6);
    expect(run.speeds).toContain(full);
  });

  it('Heroic and Mythic: walking straight back holds; standing through it is carried off', () => {
    for (const tier of ['heroic', 'mythic'] as const) {
      for (const b of BEARINGS) expect(roar(tier, b, true).fell, `${tier} ${b} walk`).toBe(false);
      for (const b of [0, 180, 315])
        expect(roar(tier, b, false).fell, `${tier} ${b} stand`).toBe(true);
    }
  });

  it('Normal: walking back holds, and even standing through it from a typical landing survives', () => {
    for (const b of BEARINGS) {
      expect(roar('normal', b, true).fell, `walk ${b}`).toBe(false);
      const stand = roar('normal', b, false);
      expect(stand.fell, `stand ${b}`).toBe(false);
      // Carried out toward the rim all the same where the floor runs on (the
      // east); by a near lip the throw already set it down at the margin.
      if (b === 90) expect(stand.end - stand.landed).toBeGreaterThan(4);
      else expect(stand.end).toBeGreaterThanOrEqual(stand.landed - 0.5);
    }
  });

  it('the anchored feel none', () => {
    const run = roar('heroic', 315, false, (f) =>
      putMarker(f.players[0], BREATH_AURAS.anchor, 'Anchor', 60, f.boss().id),
    );
    expect(run.gusted).toBe(false);
    expect(run.fell).toBe(false);
  });

  it('is deterministic', () => {
    const a = roar('heroic', 90, false);
    const b = roar('heroic', 90, false);
    expect(a).toEqual(b);
  });
});
