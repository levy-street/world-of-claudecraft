// Pure plan of the Guardian of the Quench's frost pass on the bodies
// (quench_frost_fx.ts paints it; docs/design/raid/smith_heart.md section 7.3,
// the team's pass of 2026-11-04):
//  - the icy aura round a cold body: a shell of rime climbing it with the bar,
//    brighter past three quarters, flaring when a splash lands, and BITING
//    (jagged veins racing over it) while the body hides in an immunity: the
//    cold still bites;
//  - the breath vapour off a cold body (its rate with the cold);
//  - the huddle's ring: each group of warm bodies one ring of warm light
//    linking them (its middle and its reach);
//  - the freeze's ice spikes round the encased, the shatter's tumbling
//    chunks, the splash's shards flying to each struck ally.
//
// Readability (binding): the shell is the cold, so it draws on EVERY tier;
// only the vapour, the chunks' count and the motes thin.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { QUENCH_TUNING as T } from '../../sim/encounters/smith_heart/quench_ids';
import { fightHash } from './quench_fight_fx_core';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The pools. */
export const QUENCH_FROST_POOLS = {
  /** Shells (one per cold body). */
  shells: 14,
  /** Huddle rings at once. */
  rings: 6,
  /** Splash shards in flight. */
  bolts: 18,
  /** Tumbling chunks of shattered ice. */
  chunks: 130,
  /** Chunks one shatter throws (the low tier throws half). */
  chunksPer: 24,
  /** Ice spikes round one encased body. */
  spikesPer: 12,
  /** Rime crystals on one cold body's shoulders. */
  shoulderPer: 6,
  frozen: 10,
} as const;

/** Seconds a splash shard flies from the shattered to the struck. */
export const SPLASH_FLIGHT_SECONDS = 1.25;
/** Seconds a struck body's shell flares after its shard lands. */
export const SPLASH_FLARE_SECONDS = 0.9;
/** Seconds a shatter's chunks tumble. */
export const CHUNK_SECONDS = 1.25;

// ---- the shell ----------------------------------------------------------------------

export interface ShellLook {
  /** How high the rime climbs (share of the shell, 0..1). */
  height: number;
  /** Its light (0..~1.6). */
  glow: number;
  /** The urgent pulse past three quarters (0..1). */
  pulse: number;
  /** The bite through an immunity (0 or 1). */
  bite: number;
  /** Overall opacity (0..1). */
  alpha: number;
}

/**
 * The icy aura at `cold` (0..100) at clock `t`: none below a sliver, the rime
 * climbing with the bar, the pulse past three quarters, `flare` (0..1, a
 * splash just landed) lighting it, `warded` biting through.
 */
export function shellLook(
  cold: number,
  warded: boolean,
  flare: number,
  t: number,
  out: ShellLook = { height: 0, glow: 0, pulse: 0, bite: 0, alpha: 0 },
): ShellLook {
  const c = clamp01(cold / T.coldMax);
  out.height = 0.08 + 0.92 * smooth(c * 1.05);
  out.pulse = c >= 0.75 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  out.bite = warded ? 1 : 0;
  const f = clamp01(flare);
  out.glow = 0.35 + 0.65 * c + out.pulse * 0.35 + f * 0.8 + out.bite * 0.3;
  // A body barely touched by cold wears almost nothing; a sealed or flaring
  // one always shows.
  out.alpha = Math.max(clamp01((c - 0.04) * 2.2), f, out.bite * 0.85);
  return out;
}

/** Breath vapour puffs a second off a body at `cold`. */
export function vaporRate(cold: number): number {
  const c = clamp01(cold / T.coldMax);
  return c < 0.12 ? 0 : 0.8 + 5 * c;
}

// ---- the huddle's ring -------------------------------------------------------------

export interface HuddleBody {
  id: number;
  x: number;
  z: number;
}

export interface HuddleRing {
  x: number;
  z: number;
  /** Reaches every member plus a margin. */
  radius: number;
  members: number;
}

/**
 * The huddles among the warm bodies: groups joined within `reach` of one
 * another (union-find, `bodies` order), each a ring at its middle reaching
 * its farthest member plus 1.4 yd. Writes into `out` (reused records), at
 * most `cap`; returns how many. Groups under 3 draw no ring (a huddle is
 * three).
 */
/** The root of `i` in a union-find `parent` (no closure: called per frame). */
function rootOf(parent: Int16Array, i: number): number {
  let k = i;
  while (parent[k] !== k) k = parent[k];
  return k;
}

export function huddleRings(
  bodies: readonly HuddleBody[],
  out: HuddleRing[],
  cap: number,
  reach: number = T.warmR,
  parent: Int16Array = new Int16Array(bodies.length),
): number {
  const n = Math.min(bodies.length, parent.length);
  for (let i = 0; i < n; i++) parent[i] = i;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(bodies[i].x - bodies[j].x, bodies[i].z - bodies[j].z) > reach + 1e-9) continue;
      const a = rootOf(parent, i);
      const b = rootOf(parent, j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  let count = 0;
  for (let root = 0; root < n && count < cap; root++) {
    if (rootOf(parent, root) !== root) continue;
    let sx = 0;
    let sz = 0;
    let m = 0;
    for (let i = 0; i < n; i++)
      if (rootOf(parent, i) === root) {
        sx += bodies[i].x;
        sz += bodies[i].z;
        m++;
      }
    if (m < 3) continue;
    const cx = sx / m;
    const cz = sz / m;
    let far = 0;
    for (let i = 0; i < n; i++)
      if (rootOf(parent, i) === root)
        far = Math.max(far, Math.hypot(bodies[i].x - cx, bodies[i].z - cz));
    let r = out[count];
    if (!r) {
      r = { x: 0, z: 0, radius: 0, members: 0 };
      out[count] = r;
    }
    r.x = cx;
    r.z = cz;
    r.radius = far + 1.4;
    r.members = m;
    count++;
  }
  return count;
}

// ---- the splash's shards -----------------------------------------------------------

/**
 * A splash shard `k` (0..1) of the way from the shattered (fx, fz) to the
 * struck (tx, tz): an arc 1.3 yd up from chest height, peaking mid-flight;
 * the floor heights are the caller's. Eased so it leaves fast and strikes
 * hard.
 */
export function shardFlight(
  k: number,
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const c = clamp01(k);
  const e = 1 - (1 - c) * (1 - c);
  out.x = fx + (tx - fx) * e;
  out.z = fz + (tz - fz) * e;
  out.y = 1.25 + Math.sin(Math.PI * e) * (0.9 + 0.08 * Math.hypot(tx - fx, tz - fz));
  return out;
}

// ---- the shatter's chunks ----------------------------------------------------------

export interface ChunkPose {
  x: number;
  y: number;
  z: number;
  /** Tumble angles (radians). */
  rx: number;
  ry: number;
  size: number;
}

/**
 * Chunk `i` of a shatter (seeded `seed`), `elapsed` seconds in: thrown out and
 * up from chest height, falling under gravity onto the ice and skidding,
 * tumbling, shrinking away at its end. Offsets from the shatter's spot (y
 * above its floor); null once gone.
 */
export function chunkPose(
  i: number,
  seed: number,
  elapsed: number,
  out: ChunkPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, size: 0 },
): ChunkPose | null {
  if (elapsed < 0 || elapsed >= CHUNK_SECONDS) return null;
  const a = fightHash(seed, i * 3 + 1) * Math.PI * 2;
  const sp = 5 + fightHash(seed, i * 3 + 2) * 7;
  const up = 3.5 + fightHash(seed, i * 3 + 3) * 5.5;
  const g = 24;
  const tLand = (up + Math.sqrt(up * up + 2 * g * 1.2)) / g;
  const t = Math.min(elapsed, tLand);
  const skid = Math.max(0, elapsed - tLand);
  const d = sp * t + sp * 0.35 * skid * (1 - skid);
  out.x = Math.cos(a) * d;
  out.z = Math.sin(a) * d;
  out.y = Math.max(0.08, 1.2 + up * t - 0.5 * g * t * t);
  out.rx = elapsed * (6 + 8 * fightHash(seed, i + 40));
  out.ry = elapsed * (4 + 6 * fightHash(seed, i + 80)) + a;
  const base = 0.18 + 0.32 * fightHash(seed, i + 120);
  out.size = base * (1 - smooth((elapsed - CHUNK_SECONDS * 0.65) / (CHUNK_SECONDS * 0.35)));
  return out;
}

// ---- the freeze's spikes -----------------------------------------------------------

export interface SpikePose {
  /** Angle round the body, distance out, lean outward, height, width. */
  a: number;
  r: number;
  lean: number;
  h: number;
  w: number;
}

/**
 * Spike `k` round an encased body (seeded by its id) at `grow` (0..1, the
 * freeze's first moments): jagged rime shards jutting from the ice at its
 * foot, leaning out, the tallest near the front.
 */
export function spikePose(
  id: number,
  k: number,
  grow: number,
  out: SpikePose = { a: 0, r: 0, lean: 0, h: 0, w: 0 },
): SpikePose {
  const n = QUENCH_FROST_POOLS.spikesPer;
  out.a = (k / n) * Math.PI * 2 + fightHash(id, k + 7) * 0.5;
  out.r = 0.75 + fightHash(id, k + 11) * 0.45;
  out.lean = 0.3 + fightHash(id, k + 13) * 0.5;
  const g = smooth(grow);
  out.h = (0.9 + fightHash(id, k + 17) * 1.5) * g;
  out.w = (0.2 + fightHash(id, k + 19) * 0.2) * (0.4 + 0.6 * g);
  return out;
}

// ---- the glaze's shape -------------------------------------------------------------

/**
 * Shoulder crystal `k` (0..5; even the left shoulder, odd the right) on a body
 * at `cold`: rime crystals growing out of the shoulders once the bar passes
 * half, longer as it fills; null while too warm for it. The frame: `side`
 * across the body (yards, + right), `up` and `out` its lean, `size` its length.
 */
export function shoulderCrystal(
  k: number,
  cold: number,
  out: { side: number; fwd: number; h: number; lean: number; size: number } = {
    side: 0,
    fwd: 0,
    h: 0,
    lean: 0,
    size: 0,
  },
): typeof out | null {
  const c = clamp01(cold / T.coldMax);
  const start = 0.45 + 0.08 * Math.floor(k / 2);
  const g = smooth((c - start) / 0.25);
  if (g <= 0.01) return null;
  const side = k % 2 === 0 ? -1 : 1;
  out.side = side * (0.3 + 0.06 * fightHash(k, 61));
  out.fwd = (fightHash(k, 67) - 0.5) * 0.24;
  out.h = 0.75 + 0.03 * fightHash(k, 71);
  out.lean = side * (0.55 + 0.35 * fightHash(k, 73));
  out.size = (0.38 + 0.3 * fightHash(k, 79)) * g;
  return out;
}

// ---- the encasement ------------------------------------------------------------------

export interface EncaseLook {
  /** How far up the body the crystal has closed (0..1). */
  grow: number;
  /** Its cracks spreading toward the shatter (0..1). */
  crack: number;
  /** The countdown burning down the ice (0 at the freeze, 1 at the shatter). */
  countdown: number;
  /** The heartbeat of its light: faster as the shatter nears (0..1). */
  beat: number;
}

/** The encasement `elapsed` seconds into a freeze at clock `t`. */
export function encaseLook(
  elapsed: number,
  t: number,
  out: EncaseLook = { grow: 0, crack: 0, countdown: 0, beat: 0 },
): EncaseLook {
  const k = clamp01(elapsed / T.freezeSeconds);
  out.grow = smooth(elapsed / 0.4);
  out.crack = smooth((elapsed - 0.8) / (T.freezeSeconds - 0.8));
  out.countdown = k;
  out.beat = 0.5 + 0.5 * Math.sin(t * (4 + 20 * k * k));
  return out;
}

/**
 * The encasement crystal's vertex `(x, y, z)` (a unit icosphere's) jittered
 * into a faceted, body-shaped shell: taller than wide, flatter front to back,
 * each facet pushed in or out by a hash of where it sits (the same for every
 * copy of a vertex, so the facets stay closed). Writes into `out`.
 */
export function encaseVertex(
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  const q = (v: number) => Math.round(v * 1000);
  const j = 0.84 + 0.32 * fightHash(q(x) * 7 + q(z), q(y) + 11);
  // Shoulders broad, the foot narrower, the crown a crystal point.
  const waist = y > 0.55 ? 0.78 : y < -0.6 ? 0.88 : 1;
  out.x = x * 0.82 * j * waist;
  out.z = z * 0.66 * j * waist;
  out.y = y * (y > 0.7 ? 1.38 : 1.18) * (0.95 + 0.1 * j);
  return out;
}
