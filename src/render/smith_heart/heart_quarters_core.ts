// The Anvil of the World's quarters awake (phase 2K, design doc section 5.21):
// the pure half of heart_quarters.ts. The quarter the Masterless Strength
// stands in (the sim's geometry core, smith_heart_quarters.ts) is the active
// strength: its seams ignite in its vein's colour from the central ring out
// to the rim, its element rises off it and the ridges bordering it glow; the
// other three go dark. A crossing drains the old quarter's light back into
// the ring, floods the new one out of it, and sends a shockwave along the
// ridge the boss crossed. In the central ring in its final phase (the last
// `HEART_FINAL_PHASE_SHARE` of its health, or forced by the dev preview) all
// four wake at once and the ring blazes (the final phase's look); in the ring
// otherwise the room rests: no quarter awake, every quarter's seams
// breathing faintly (phase 2L).
//
//   - The memory (`noteHeartQuarterBoss`): what the final boss's effects
//     (../smith_heart_fx/final_fx.ts, which read the boss from IWorld) saw
//     this frame, keyed like the seal memory; the interior's frame driver,
//     which has no world, reads it (`heartQuarterBoss`).
//   - The state (`newHeartQuartersState`, `stepHeartQuarters`): per quarter a
//     faint base glow and an awake flood with its front (yards from the
//     centre), per ridge its shockwave, the ring's level and blaze. Stepped
//     on the render clock; presentation only, the same online and offline.
//   - The plans of the element's air in each quarter and the ridges' sparks
//     (deterministic seeds inside the quarter, never past its ridges).
//
// Pure and Three-free.

import {
  HEART_ROOM,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  type HeartQuarterZone,
  heartQuarterAt,
  heartQuarterRidges,
  heartRidgeBearingDeg,
  heartRidgeBetween,
  heartRidgeDistance,
} from '../../sim/content/smith_heart_quarters';
import { heartHash } from './heart_plan_core';

// ---- the memory ---------------------------------------------------------------------------

/** What the final boss's effects saw this frame: where it stands
 *  (instance-local), whether a fight is on and whether it is in its final
 *  phase (`heartFinalPhase`: its last share of health). */
export interface HeartQuarterBoss {
  x: number;
  z: number;
  engaged: boolean;
  final: boolean;
}

const memory = new Map<string, HeartQuarterBoss>();

/** The final boss of slot `key` stands at (x, z) (instance-local), or the
 *  heart sleeps, the body is not yet whole or it has fallen (null). */
export function noteHeartQuarterBoss(
  key: string,
  x: number,
  z: number,
  engaged: boolean,
  awake: boolean,
  final = false,
): void {
  if (!awake) {
    memory.delete(key);
    return;
  }
  const m = memory.get(key);
  if (m) {
    m.x = x;
    m.z = z;
    m.engaged = engaged;
    m.final = final;
  } else memory.set(key, { x, z, engaged, final });
}

/** The slot's final boss as last seen, or null. */
export function heartQuarterBoss(key: string): HeartQuarterBoss | null {
  return memory.get(key) ?? null;
}

/** Forget every slot (tests). */
export function clearHeartQuarterMemoryForTest(): void {
  memory.clear();
}

// ---- the look's modes and timings --------------------------------------------------------

/** The room's mode: asleep (before the arrival, or the boss gone), resting
 *  (the boss in the ring outside its final phase: no quarter awake), one
 *  quarter awake, or the final look (all four, the ring blazing). */
export type HeartQuartersMode = 'asleep' | 'rest' | 'quarter' | 'final';

export const HEART_QUARTERS_LOOK = {
  /** The faint glow of a dormant quarter's seams (never fully black: the
   *  room still reads as four quarters). */
  dormant: 0.06,
  /** Every quarter's seams breathing while the room rests (no quarter
   *  awake: a touch over dormant, never a flood). */
  rest: 0.1,
  /** The flood's front, yards per second, out of the ring to the rim. */
  floodSpeed: 26,
  /** The drain's front, yards per second, back into the ring. */
  drainSpeed: 38,
  /** A crossing: the new quarter floods this long after the old one starts
   *  to drain (its light seen passing through the ring). */
  floodDelay: 0.32,
  /** The ridge's shockwave: its speed (yards per second each way) and life. */
  shockSpeed: 30,
  shockLife: 1.6,
  /** The ring's level resting, under one quarter, and blazing. */
  ringRest: 0.5,
  ringQuarter: 0.32,
  /** How fast a base glow, the ring and the blaze ease (per second). */
  ease: 1.8,
} as const;

/** One quarter's light. */
export interface HeartQuarterLight {
  /** The faint glow over the whole quarter (0 to `rest`). */
  base: number;
  /** The flood's strength (0 or 1) and its front (yards from the centre):
   *  lit inside the front. */
  awake: number;
  front: number;
  /** Render time before which a pending flood holds at the ring. */
  holdUntil: number;
  /** Rising (flooding) or falling (draining). */
  rising: boolean;
}

/** One ridge's shockwave: where it started (yards from the centre) and
 *  its age (seconds; negative: none). */
export interface HeartRidgeShock {
  r: number;
  age: number;
}

export interface HeartQuartersState {
  mode: HeartQuartersMode;
  zone: HeartQuarterZone | null;
  quarters: Record<SmithHeartVein, HeartQuarterLight>;
  ridges: HeartRidgeShock[];
  ring: number;
  blaze: number;
  /** A pulse through the ring as the light passes it (0 to 1, decaying). */
  ringPulse: number;
}

export function newHeartQuartersState(): HeartQuartersState {
  const quarters = {} as Record<SmithHeartVein, HeartQuarterLight>;
  for (const v of SMITH_HEART_VEINS)
    quarters[v] = { base: 0, awake: 0, front: HEART_QUARTERS.ringR, holdUntil: 0, rising: false };
  return {
    mode: 'asleep',
    zone: null,
    quarters,
    ridges: [0, 1, 2, 3].map(() => ({ r: 0, age: -1 })),
    ring: 0,
    blaze: 0,
    ringPulse: 0,
  };
}

/** The mode for what the boss's effects saw. */
export function heartQuartersModeOf(boss: HeartQuarterBoss | null): {
  mode: HeartQuartersMode;
  zone: HeartQuarterZone | null;
} {
  if (!boss) return { mode: 'asleep', zone: null };
  const zone = heartQuarterAt(boss.x, boss.z);
  if (zone === 'ring') return { mode: boss.engaged && boss.final ? 'final' : 'rest', zone };
  return { mode: 'quarter', zone };
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/**
 * Step the room's light by `dt` seconds at render time `now`, the boss as
 * `boss` (null: asleep). Deterministic in its inputs (no clock read, no
 * random draw).
 */
export function stepHeartQuarters(
  s: HeartQuartersState,
  boss: HeartQuarterBoss | null,
  now: number,
  dt: number,
): HeartQuartersState {
  const L = HEART_QUARTERS_LOOK;
  const { ringR, rimR } = HEART_QUARTERS;
  const step = Math.max(0, Math.min(0.25, dt));
  const { mode, zone } = heartQuartersModeOf(boss);
  if (zone !== s.zone || mode !== s.mode) {
    const prev = s.zone;
    // A crossing between neighbours: the shockwave along their ridge, from
    // where the boss stands.
    if (prev && zone && boss) {
      const k = heartRidgeBetween(prev, zone);
      if (k !== null) {
        const ridge = s.ridges[k];
        ridge.r = Math.min(
          rimR,
          Math.max(ringR, Math.hypot(boss.x - HEART_ROOM.x, boss.z - HEART_ROOM.z)),
        );
        ridge.age = 0;
      }
    }
    if (prev !== null && prev !== zone) s.ringPulse = 1;
    for (const v of SMITH_HEART_VEINS) {
      const q = s.quarters[v];
      const want = mode === 'final' || (mode === 'quarter' && zone === v);
      if (want && !q.rising) {
        q.rising = true;
        q.awake = 1;
        // A quarter already lit keeps its front; a dark one floods from the
        // ring, after the old light has had a breath to drain into it.
        if (q.front <= ringR + 0.01) {
          q.front = ringR;
          q.holdUntil = prev !== null && prev !== zone ? now + L.floodDelay : now;
        }
      } else if (!want && q.rising) {
        q.rising = false;
      }
    }
    s.mode = mode;
    s.zone = zone;
  }
  for (const v of SMITH_HEART_VEINS) {
    const q = s.quarters[v];
    const baseTarget = mode === 'asleep' ? 0 : mode === 'rest' ? L.rest : L.dormant;
    q.base = approach(q.base, baseTarget, L.ease * step * 0.5);
    if (q.rising) {
      if (now >= q.holdUntil) q.front = Math.min(rimR + 1.5, q.front + L.floodSpeed * step);
    } else if (q.awake > 0) {
      q.front = Math.max(ringR, q.front - L.drainSpeed * step);
      if (q.front <= ringR + 1e-6) q.awake = 0;
    }
  }
  for (const r of s.ridges) {
    if (r.age < 0) continue;
    r.age += step;
    if (r.age > L.shockLife) r.age = -1;
  }
  const ringTarget =
    mode === 'asleep' ? 0 : mode === 'rest' ? L.ringRest : mode === 'final' ? 1 : L.ringQuarter;
  s.ring = approach(s.ring, ringTarget, L.ease * step);
  s.blaze = approach(s.blaze, mode === 'final' ? 1 : 0, L.ease * step * 0.8);
  s.ringPulse = Math.max(0, s.ringPulse - step * 1.4);
  return s;
}

/** How lit a quarter is overall (0 to 1): its flood's share of its depth,
 *  or its base glow. The element's air and the ridges read it. */
export function heartQuarterLit(q: HeartQuarterLight): number {
  const { ringR, rimR } = HEART_QUARTERS;
  const flood = q.awake * Math.max(0, Math.min(1, (q.front - ringR) / (rimR - ringR)));
  return Math.max(q.base, flood);
}

/** A ridge's two neighbours (counter-clockwise, clockwise). */
export function heartRidgeNeighbours(k: number): readonly [SmithHeartVein, SmithHeartVein] {
  return [HEART_QUARTER_ORDER[k], HEART_QUARTER_ORDER[(k + 1) % 4]];
}

// ---- the plans ------------------------------------------------------------------------------

/** One seed of a quarter's air: a point on its floor (instance-local,
 *  inside the quarter, clear of its ridges) and four hashes. */
export interface HeartQuarterSeed {
  x: number;
  z: number;
  r: number;
  h: readonly [number, number, number, number];
}

/** The tunings of each quarter's air: how many of each particle on the
 *  high tier (the low tier keeps about a third). */
export const HEART_QUARTER_AIR = {
  hammer: { grit: 240, dust: 70, chips: 60, stones: 26 },
  breath: { devils: 6, perDevil: 70, streaks: 130, sheets: 30 },
  quench: { mist: 46, crystals: 150, frost: 200 },
  heat: { embers: 300, haze: 30, flames: 44 },
  sparks: 150,
  blaze: 220,
} as const;

/** Each quarter's own light (phase 2L): its colour and the white-hot of its
 *  brightest, its idle life asleep (the Heat smoulders: it reads as fire
 *  even dark), its seams' and its wash's gain, and how far its stones are
 *  dimmed while it sleeps. The Heat is the guardian's hearth's red-orange
 *  (never gold) and the Hammer an earthy sand-amber, apart in hue and in
 *  value; the Breath a storm violet, the Quench an ice blue. */
export const HEART_QUARTER_PALETTE: Readonly<
  Record<
    SmithHeartVein,
    { color: number; hot: number; idle: number; seams: number; wash: number; shade: number }
  >
> = {
  hammer: { color: 0xe0a650, hot: 0xfff0c8, idle: 0.07, seams: 1, wash: 1, shade: 0.44 },
  breath: { color: 0xa98cff, hot: 0xc8fff2, idle: 0.07, seams: 1.35, wash: 1.15, shade: 0.42 },
  quench: { color: 0x6cc8ff, hot: 0xf2fbff, idle: 0.1, seams: 1.4, wash: 1.7, shade: 0.32 },
  heat: { color: 0xff5214, hot: 0xffc23a, idle: 0.3, seams: 1.15, wash: 1, shade: 0.55 },
};

/** The opaque platform's draw order (phase 2L): the floors (the quarters,
 *  the rim's dirt bed, the dais) first, then each ridge's spine drawn with no
 *  depth write and its light over it, then everything else. A floor
 *  telegraph (transparent, depth-tested against the floor) therefore always
 *  shows over a spine, and a body walking over one stands on it. */
export const HEART_PLATFORM_ORDER = { floor: -3, spine: -2, spineGlow: -1 } as const;

/** The low tier's share of the cosmetic air. */
export const HEART_QUARTER_LOW_SHARE = 0.35;

/** `n` (the low tier a share) seeds spread over a quarter's floor,
 *  `clear` yards off its ridges and inside [r0, r1]. Deterministic. */
export function heartQuarterSeeds(
  vein: SmithHeartVein,
  n: number,
  salt: number,
  clear = 2.4,
  r0 = HEART_QUARTERS.ringR + 1.2,
  r1 = HEART_QUARTERS.rimR - 1.5,
): HeartQuarterSeed[] {
  const out: HeartQuarterSeed[] = [];
  const [ka, kb] = heartQuarterRidges(vein);
  const vi = HEART_QUARTER_ORDER.indexOf(vein);
  for (let i = 0, tries = 0; out.length < n && tries < n * 40; tries++, i++) {
    const h = (k: number) => heartHash(salt * 7919 + vi * 131 + i, k);
    // Area-even radius, any bearing across the quarter's sector at that
    // radius (between its two ridges).
    const r = Math.sqrt(r0 * r0 + h(1) * (r1 * r1 - r0 * r0));
    const ba = heartRidgeBearingDeg(ka, r);
    const bb = heartRidgeBearingDeg(kb, r);
    const span = (((bb - ba) % 360) + 360) % 360;
    const b = ((ba + h(2) * span) * Math.PI) / 180;
    const x = HEART_ROOM.x + Math.sin(b) * r;
    const z = HEART_ROOM.z + Math.cos(b) * r;
    if (heartQuarterAt(x, z) !== vein) continue;
    if (heartRidgeDistance(ka, x, z) < clear || heartRidgeDistance(kb, x, z) < clear) continue;
    out.push({ x, z, r, h: [h(3), h(4), h(5), h(6)] });
  }
  return out;
}

/** The sparks a ridge's shockwave throws: seeds along its line from the
 *  ring to the rim. */
export function heartRidgeSparkSeeds(k: number, n: number): HeartQuarterSeed[] {
  const out: HeartQuarterSeed[] = [];
  const { ringR, rimR } = HEART_QUARTERS;
  for (let i = 0; i < n; i++) {
    const h = (j: number) => heartHash(4243 + k * 977 + i, j);
    const r = ringR + 0.4 + ((i + h(1)) / n) * (rimR - ringR - 0.8);
    const b = (heartRidgeBearingDeg(k, r) * Math.PI) / 180;
    out.push({
      x: HEART_ROOM.x + Math.sin(b) * r,
      z: HEART_ROOM.z + Math.cos(b) * r,
      r,
      h: [h(2), h(3), h(4), h(5)],
    });
  }
  return out;
}

/** A count for the static preset (the low tier keeps a share, at least 1). */
export function heartQuarterCount(n: number, lowGfx: boolean): number {
  return lowGfx ? Math.max(1, Math.round(n * HEART_QUARTER_LOW_SHARE)) : n;
}
