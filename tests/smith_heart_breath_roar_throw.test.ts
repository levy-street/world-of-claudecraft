// The Summit Roar's THROW (Jose's playtest of 2026-11-25). The blast of
// 2026-11-17 eased a body away for seconds, so a struck player read as
// walking backwards by itself, slowly, never shoved. Now the wave throws each
// body it reaches a short hard shove straight away from the guardian: the
// tier's gustThrow slid over roarThrowSlide (fast off the blow, settling),
// under an unbreakable root (the online client draws the server's slide, the
// renderer hops the body: never a walk), and NOTHING after it: no blast, no
// lingering drift. Every knockback immunity and resistance holds, the
// anchored keep their feet, a body already sliding is never thrown twice,
// and Normal's throw stops short of every lip.

import { describe, expect, it } from 'vitest';
import {
  BREATH_AURAS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { breathScopeForDev } from '../src/sim/encounters/smith_heart/breath';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import { throwFromRoar } from '../src/sim/encounters/smith_heart/breath_roar';
import { beginShove } from '../src/sim/encounters/smith_heart/breath_shove';
import { putMarker } from '../src/sim/encounters/smith_heart/fight_kit';
import { WIND_BLAST_AURA } from '../src/sim/wind_drift';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s * 20);

/** North-west of the guardian: the rim lies some 42 yd out that way. */
const BEARING = 315;

interface Run {
  /** Yards from the guardian when struck and at the end. */
  start: number;
  end: number;
  /** The most one tick moved the body (yards). */
  maxStep: number;
  /** Seconds from the strike until the body stopped (never: -1). */
  settled: number;
  /** Yards it moved in the two seconds after it settled. */
  drift: number;
  fell: boolean;
  thrownAura: boolean;
  blastAura: boolean;
}

/** One player `d` yards from the guardian along `bearing` as the Roar lands,
 *  standing still (with `prep` run on the fight first). The throw alone:
 *  its follow-through gust is held off here (its own pins:
 *  tests/smith_heart_breath_roar_gust.test.ts). */
function roar(
  tier: 'normal' | 'heroic' | 'mythic',
  d: number,
  prep?: (f: BreathFight) => void,
  bearing = BEARING,
): Run {
  const rules = BREATH_DIFFICULTY[tier] as { roarGustSpeed: number };
  const saved = rules.roarGustSpeed;
  rules.roarGustSpeed = 0;
  try {
    return roarRun(tier, d, prep, bearing);
  } finally {
    rules.roarGustSpeed = saved;
  }
}

function roarRun(
  tier: 'normal' | 'heroic' | 'mythic',
  d: number,
  prep?: (f: BreathFight) => void,
  bearing = BEARING,
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
  expect(st.wind.phase).toBe('exhale');
  const p = f.players[0];
  const g = f.local(f.boss());
  const h = (bearing * Math.PI) / 180;
  f.put(p, g.x + Math.sin(h) * d, g.z + Math.cos(h) * d);
  prep?.(f);
  const out: Run = {
    start: d,
    end: d,
    maxStep: 0,
    settled: -1,
    drift: 0,
    fell: false,
    thrownAura: false,
    blastAura: false,
  };
  const hp0 = p.hp;
  let struck = -1;
  let last = f.local(p);
  let still = 0;
  let settledAt: { x: number; z: number } | null = null;
  for (let i = 0; i < ticks(T.gustCast + 6); i++) {
    f.tick(1);
    const at = f.local(p);
    const step = Math.hypot(at.x - last.x, at.z - last.z);
    last = at;
    if (struck < 0 && p.hp < hp0) struck = i;
    if (p.auras.some((a) => a.id === BREATH_AURAS.thrown)) out.thrownAura = true;
    if (p.auras.some((a) => a.id === WIND_BLAST_AURA)) out.blastAura = true;
    if (p.dead || !inBreathArena(at.x, at.z)) out.fell = true;
    if (struck < 0 || out.fell) continue;
    out.maxStep = Math.max(out.maxStep, step);
    if (out.settled < 0) {
      still = step < 1e-6 ? still + 1 : 0;
      if (still >= 2) {
        out.settled = (i - 1 - struck) / 20;
        settledAt = at;
      }
    } else if (settledAt && (i - struck) / 20 <= out.settled + 2) {
      out.drift = Math.max(out.drift, Math.hypot(at.x - settledAt.x, at.z - settledAt.z));
    }
    out.end = Math.hypot(at.x - g.x, at.z - g.z);
  }
  return out;
}

describe("the Summit Roar's throw", () => {
  it('throws on every tier, slides in its window, and blows no blast after it', () => {
    for (const k of ['normal', 'heroic', 'mythic'] as const) {
      expect(BREATH_DIFFICULTY[k].gustThrow).toBeGreaterThan(0);
      expect(BREATH_DIFFICULTY[k].blastSpeed).toBe(0);
    }
    expect(T.roarThrowSlide).toBeGreaterThanOrEqual(0.6);
    expect(T.roarThrowSlide).toBeLessThanOrEqual(0.9);
  });

  it('Heroic: a strong short shove, slid (no one-tick jump), ended in its window, no drift after', () => {
    const run = roar('heroic', 6);
    const yd = BREATH_DIFFICULTY.heroic.gustThrow;
    expect(run.fell).toBe(false);
    expect(run.thrownAura).toBe(true);
    expect(run.blastAura).toBe(false);
    // The whole throw, straight out.
    expect(run.end - run.start).toBeGreaterThan(yd - 0.6);
    expect(run.end - run.start).toBeLessThan(yd + 0.6);
    // A shove, never a blink: no tick carries a fifth of it...
    expect(run.maxStep).toBeLessThan(yd / 5);
    // ...yet it starts hard: its first ticks run far past a sprint (7 yd/s).
    expect(run.maxStep * 20).toBeGreaterThan(40);
    // Settled inside the slide's window (a tick or two of slack), then still.
    expect(run.settled).toBeGreaterThan(T.roarThrowSlide - 0.15);
    expect(run.settled).toBeLessThan(T.roarThrowSlide + 0.15);
    expect(run.drift).toBeLessThan(0.05);
  });

  it('Normal: a shorter throw that still reads, held short of every lip', () => {
    // East, where the floor runs farthest (the north-west's channel holds a
    // Normal throw short of its lip).
    const run = roar('normal', 6, undefined, 90);
    expect(run.end - run.start).toBeGreaterThan(BREATH_DIFFICULTY.normal.gustThrow - 0.6);
    expect(run.blastAura).toBe(false);
    expect(run.drift).toBeLessThan(0.05);
    // Stood far out by the rim: held back, never thrown off.
    expect(roar('normal', 30).fell).toBe(false);
    expect(roar('normal', 6).end - 6).toBeLessThan(BREATH_DIFFICULTY.normal.gustThrow);
  });

  it('Heroic and Mythic: one stood far out against the pull is thrown off the Cornice', () => {
    expect(roar('heroic', 30).fell).toBe(true);
    expect(roar('mythic', 30).fell).toBe(true);
  });

  it('the anchored keep their feet', () => {
    const run = roar('heroic', 6, (f) =>
      putMarker(f.players[0], BREATH_AURAS.anchor, 'Anchor', 60, f.boss().id),
    );
    expect(run.thrownAura).toBe(false);
    expect(Math.abs(run.end - run.start)).toBeLessThan(0.5);
  });

  it('a full knockback resistance moves no one', () => {
    const run = roar('heroic', 6, (f) => {
      f.players[0].knockbackResistance = 1;
    });
    expect(run.thrownAura).toBe(false);
    expect(Math.abs(run.end - run.start)).toBeLessThan(0.5);
  });

  it('a body already sliding is never thrown twice', () => {
    const f = breathFight(1, 23);
    expect(f.dev('/dev heart breath heroic')).toBe(true);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(2);
    const s = breathScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no fight');
    const p = f.players[0];
    s.st.roar = { x: f.boss().pos.x, z: f.boss().pos.z, r: 0, reach: 99, struck: [], slides: [] };
    // Mid-toss from a loose gale: the Roar's throw does not stack on it.
    const toss = beginShove(s, p, 1, 0, 11, T.galeSlide, 'out', BREATH_AURAS.tossed, 'Gale');
    if (!toss) throw new Error('no toss');
    s.st.galeShoves.push(toss);
    expect(throwFromRoar(s, p, 0, 1)).toBe(0);
    s.st.galeShoves.length = 0;
    // Free again: one throw, and a second one at once is refused.
    expect(throwFromRoar(s, p, 0, 1)).toBeGreaterThan(0);
    expect(throwFromRoar(s, p, 0, 1)).toBe(0);
    expect(s.st.roar.slides.filter((sl) => sl.id === p.id)).toHaveLength(1);
  });
});
