// The Summit Roar's blast (the owner's call of 2026-11-17: "no moment makes
// anyone fear the fall"). After the indrawn breath draws the raid in, the
// Roar no longer slides everyone a fixed throw nobody can answer: its wave
// sets a blast on each body (wind_drift.ts WIND_BLAST_AURA), strongest by the
// maw and easing outward. Whoever runs straight back against it at once
// holds; whoever stands is carried off the Cornice; a late start is carried
// far toward the rim. The anchored keep their feet. The blast is the shared
// motion kernel's, so the online client predicts it (no server-driven slide,
// no root, no override: the old throw read jerky online).

import { describe, expect, it } from 'vitest';
import {
  BREATH_AURAS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import { putMarker } from '../src/sim/encounters/smith_heart/fight_kit';
import type { Entity } from '../src/sim/types';
import {
  BLAST_FLOOR,
  blastSpeedAt,
  blastStandingReach,
  WIND_BLAST_AURA,
  windDrift,
} from '../src/sim/wind_drift';
import { breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);

/** Two bearings off the guardian (degrees, sim convention): north-west, a
 *  near side, and north, toward an open lip. */
const NEAR_LIP = 315;
const FAR_LIP = 0;

interface Run {
  /** Yards from the guardian at most, and at the end. */
  max: number;
  end: number;
  /** Carried off the Cornice (in the void, or dead of the fall). */
  fell: boolean;
  /** The blast aura it wore, and a root while it blew (there must be none). */
  blasted: boolean;
  rooted: boolean;
}

/** One player `d` yards from the guardian along `bearing` as the Roar lands;
 *  it runs straight back toward the guardian after `react` seconds (never:
 *  Infinity), or stands in an anchor. */
function roar(
  tier: 'normal' | 'heroic',
  bearing: number,
  d: number,
  react: number,
  anchored = false,
): Run {
  const f = breathFight(1, 23);
  if (tier === 'heroic') expect(f.dev('/dev heart breath heroic')).toBe(true);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.skyTimer = 999;
  st.circleTimer = 999;
  st.blowTimer = 999;
  expect(f.dev('/dev heart breath roar')).toBe(true);
  // Through the indrawn breath; then set the body down where the case wants
  // it while the exhale's bar runs (no wind then).
  f.tick(ticks(T.inhaleCast) + 2);
  expect(st.wind.phase).toBe('exhale');
  const p = f.players[0];
  const g = f.local(f.boss());
  const h = (bearing * Math.PI) / 180;
  f.put(p, g.x + Math.sin(h) * d, g.z + Math.cos(h) * d);
  p.facing = h + Math.PI;
  if (anchored) putMarker(p, BREATH_AURAS.anchor, 'Anchor', 60, f.boss().id);
  const meta = f.sim.players.get(p.id);
  if (!meta) throw new Error('meta');
  const out: Run = { max: d, end: d, fell: false, blasted: false, rooted: false };
  let struck = -1;
  const hp0 = p.hp;
  const blast = BREATH_DIFFICULTY[tier].blastSeconds;
  for (let i = 0; i < ticks(T.gustCast + blast + 3); i++) {
    f.tick(1);
    // Struck: the Roar's damage lands (its blast with it, unless anchored).
    if (struck < 0 && (p.hp < hp0 || p.auras.some((a) => a.id === WIND_BLAST_AURA))) struck = i;
    if (struck >= 0 && (i - struck) / 20 >= react) meta.moveInput.forward = true;
    p.facing = Math.atan2(f.boss().pos.x - p.pos.x, f.boss().pos.z - p.pos.z);
    if (p.auras.some((a) => a.id === WIND_BLAST_AURA)) out.blasted = true;
    if (p.auras.some((a) => a.kind === 'root')) out.rooted = true;
    const at = f.local(p);
    const r = Math.hypot(at.x - g.x, at.z - g.z);
    out.max = Math.max(out.max, r);
    out.end = r;
    if (p.dead || !inBreathArena(at.x, at.z)) out.fell = true;
  }
  return out;
}

describe("the Summit Roar's blast", () => {
  it('eases off with the distance to its floor, as the kernel steps it', () => {
    expect(blastSpeedAt(14, 0)).toBe(14);
    expect(blastSpeedAt(14, 10)).toBeCloseTo(10, 6);
    expect(blastSpeedAt(14, 100)).toBeCloseTo(14 * BLAST_FLOOR, 6);
    const e = {
      pos: { x: 10, y: 0, z: 0 },
      auras: [{ id: WIND_BLAST_AURA, value: 0, value2: 0, value3: 14 }],
    } as unknown as Pick<Entity, 'auras' | 'pos'>;
    const v = { x: 0, z: 0 };
    expect(windDrift(e, v)).toBe(true);
    expect(v.x).toBeCloseTo(10, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('every tier throws no one: the blast carries them (no slide, no root)', () => {
    for (const k of ['normal', 'heroic', 'mythic'] as const)
      expect(BREATH_DIFFICULTY[k].gustThrow).toBe(0);
    const run = roar('heroic', FAR_LIP, 6, 0.25);
    expect(run.blasted).toBe(true);
    expect(run.rooted).toBe(false);
  });

  it('Heroic: a body left standing by the guardian is carried off the Cornice', () => {
    const run = roar('heroic', FAR_LIP, 6, Number.POSITIVE_INFINITY);
    expect(run.fell).toBe(true);
    // Even where the lip lies farthest, it ends by the rim or past it.
    expect(blastStandingReach(14, 6, 6)).toBeGreaterThan(44);
  });

  it('Heroic: one that runs straight back at once holds, even by the near lip', () => {
    const run = roar('heroic', NEAR_LIP, 6, 0.25);
    expect(run.fell).toBe(false);
    expect(run.max).toBeLessThan(19);
  });

  it('Heroic: a late start (two seconds) is carried well past a prompt one', () => {
    const late = roar('heroic', NEAR_LIP, 6, 2);
    const prompt = roar('heroic', NEAR_LIP, 6, 0.25);
    expect(late.max).toBeGreaterThan(prompt.max + 4);
  });

  it('Heroic: the anchored keep their feet', () => {
    const run = roar('heroic', NEAR_LIP, 6, Number.POSITIVE_INFINITY, true);
    expect(run.fell).toBe(false);
    expect(run.blasted).toBe(false);
    expect(run.max).toBeLessThan(6.5);
  });

  it('Normal: softer, yet it shows (a stander carried far, a runner holds close)', () => {
    const stand = roar('normal', FAR_LIP, 6, Number.POSITIVE_INFINITY);
    expect(stand.max).toBeGreaterThan(28);
    const run = roar('normal', NEAR_LIP, 6, 0.25);
    expect(run.fell).toBe(false);
    expect(run.max).toBeLessThan(14);
  });
});
