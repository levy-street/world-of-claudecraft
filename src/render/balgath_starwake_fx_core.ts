// Pure planning math for Wake of the Fallen Star (see balgath_starwake_fx.ts for the Three
// half, and src/sim/mob/boss_starwake.ts for the mechanic).
//
// Three/DOM/i18n-free and deterministic: the caller passes elapsed seconds and lifetimes,
// never a clock read of its own, so a Vitest drives every curve directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers the file.
//
// What is actionable and what is not, which every curve below respects:
//  - The fissure strips, the geyser circles and the molten pools are HAZARDS. They are
//    drawn on every graphics preset, at full strength until the moment they stop hurting,
//    and their fills carry the timer even with reduced motion.
//  - The star's glow, the eruption spouts, the flung chunks, the dust and the shake are
//    the payoff. Only these scale with the quality knob.

/**
 * The cue ids, agreed with the sim rather than imported from it: mob/boss_starwake.ts is a
 * SimContext consumer, and importing it here would drag the simulation into the render
 * bundle for three strings. tests/balgath_starwake_fx_core.test.ts welds each to the sim.
 */
export const BALGATH_STARWAKE_WAKE_ABILITY = 'mob_balgath_starwake_wake';
export const BALGATH_STARWAKE_FISSURE_ABILITY = 'mob_balgath_starwake_fissure';
export const BALGATH_STARWAKE_GEYSER_ABILITY = 'mob_balgath_starwake_geyser';
/** The eruption's meteor shower (mob/boss_starwake_meteors.ts): the template's
 *  `starwake.meteors.name`, the `ability` on every Star Debris meteorFall / meteorImpact.
 *  The meteors themselves are Ignivar's (mage_ground_fx.ts draws them unchanged); this
 *  layer only rides them: the star spews while they are called, the ground jolts as they
 *  land. */
export const BALGATH_STARWAKE_METEOR_ABILITY = 'Star Debris';
/** A Star Debris meteor's circle radius, yards: Ignivar's IGNIVAR_METEOR_RADIUS. */
export const BALGATH_STARWAKE_METEOR_RADIUS = 2.4;
/** His cast bar's id while the star wakes: the template's `starwake.name`. */
export const BALGATH_STARWAKE_CAST_ID = 'Wake of the Fallen Star';

/** Seconds the fissures take to crawl to their tips (the template's `crawl`). */
export const STARWAKE_CRAWL_SECONDS = 2;
/** Half a fissure strip's width, yards (the template's `fissures.halfWidth`). */
export const STARWAKE_FISSURE_HALF_WIDTH = 2.5;

/** Camera trauma: a rumble while the star wakes, a jolt per fissure and per geyser. */
export const STARWAKE_WAKE_TRAUMA = 0.1;
export const STARWAKE_FISSURE_TRAUMA = 0.2;
export const STARWAKE_GEYSER_TRAUMA = 0.26;
/** A Star Debris meteor landing: a third of a geyser's, since two or three land a wave. */
export const STARWAKE_METEOR_TRAUMA = 0.09;
/** Seconds the star keeps spewing after the last wave of the shower is called. */
export const STARWAKE_SPEW_LINGER = 0.8;
/** How fast the star's per-wave flare dies away, per second. */
export const STARWAKE_FLARE_DECAY = 3.5;

/** How long an eruption spout or a geyser column stands, seconds. */
export const STARWAKE_SPOUT_SECONDS = 0.9;
export const STARWAKE_COLUMN_SECONDS = 1.2;
/** How long the cooling scar a fissure leaves stays on the ground, seconds. */
export const STARWAKE_SCAR_SECONDS = 1.6;
/** How long the flung lava chunks fly, seconds. */
export const STARWAKE_CHUNK_SECONDS = 1.3;
/** How long the star keeps glowing after the eruption before it sleeps again, seconds. */
export const STARWAKE_STAR_AFTERGLOW = 1.8;
/** Seconds between the star's shockwave pulses at the start of the wind-up. */
export const STARWAKE_PULSE_EVERY = 0.9;
/** Yards between eruption spouts down a fissure. */
export const STARWAKE_SPOUT_SPACING = 6;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How far down its path a fissure's glowing fill has crawled, 0..1, `elapsed` seconds
 * after it was laid. Eases out, so the crack visibly races away from its origin and
 * settles into the tip: the moment it touches the tip is the moment the path is final.
 */
export function crawlFraction(elapsed: number, crawl = STARWAKE_CRAWL_SECONDS): number {
  const t = clamp01(elapsed / Math.max(1e-3, crawl));
  return 1 - (1 - t) * (1 - t);
}

/**
 * The fissure's heat, 0..1, over the whole telegraph: low while it crawls, then climbing
 * through the hold to full on the eruption, so a strip about to go looks it.
 */
export function fissureHeat(
  elapsed: number,
  total: number,
  crawl = STARWAKE_CRAWL_SECONDS,
): number {
  if (elapsed <= crawl) return 0.35 * clamp01(elapsed / Math.max(1e-3, crawl));
  const hold = Math.max(1e-3, total - crawl);
  const t = clamp01((elapsed - crawl) / hold);
  return 0.35 + 0.65 * t * t;
}

/**
 * The star's glow, 0..1: kindles over the first 0.6 s, breathes on a beat that quickens as
 * the eruption nears, peaks on it, then dies away over the afterglow. `reducedMotion`
 * swaps the beat for its mean so the star still reads as lit.
 */
export function starGlow(elapsed: number, total: number, reducedMotion: boolean, spew = 0): number {
  if (elapsed < 0) return 0;
  // The shower: the star stays blazing while the sky it opened is still coming down.
  if (spew > 0 && elapsed > total && elapsed <= total + spew) {
    if (reducedMotion) return 0.95;
    return 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(elapsed * 17));
  }
  if (elapsed > total) {
    const t = clamp01((elapsed - total - Math.max(0, spew)) / STARWAKE_STAR_AFTERGLOW);
    return (1 - t) * (1 - t);
  }
  const kindle = clamp01(elapsed / 0.6);
  const progress = clamp01(elapsed / Math.max(1e-3, total));
  const base = 0.45 + 0.4 * progress;
  if (reducedMotion) return kindle * (base + 0.075);
  const rate = 5 + 13 * progress;
  const beat = 0.5 + 0.5 * Math.sin(elapsed * rate);
  return kindle * Math.min(1, base + 0.15 * beat);
}

/** Whether a shockwave pulse leaves the star between `prev` and `next` elapsed seconds. */
export function starPulseDue(prev: number, next: number, total: number): boolean {
  if (next > total) return false;
  // Quickening: the gap shrinks to a third of itself by the eruption.
  const at = (t: number): number => {
    let n = 0;
    let clock = 0;
    while (clock <= t) {
      const gap = STARWAKE_PULSE_EVERY * (1 - (2 / 3) * clamp01(clock / Math.max(1e-3, total)));
      clock += Math.max(0.2, gap);
      n++;
    }
    return n;
  };
  return at(next) > at(prev);
}

/**
 * A rising-then-collapsing spout, as (height, width) multipliers at `t` seconds into a
 * `life`-second spout: shoots up in the first fifth, holds with a wobble, then falls back
 * into the ground (height and width both shrink, so it drains rather than vanishes).
 */
export interface SpoutShape {
  height: number;
  width: number;
}

/** Writes into `out` (the painter's own scratch, so the frame loop allocates nothing). */
export function spoutShape(t: number, life: number, out: SpoutShape): SpoutShape {
  const x = clamp01(t / Math.max(1e-3, life));
  if (x < 0.2) {
    const k = x / 0.2;
    const up = 1 - (1 - k) * (1 - k) * (1 - k);
    out.height = up;
    out.width = 0.55 + 0.45 * up;
    return out;
  }
  if (x < 0.55) {
    out.height = 1;
    out.width = 1;
    return out;
  }
  const k = (x - 0.55) / 0.45;
  out.height = 1 - k * k;
  out.width = 1 - 0.55 * k;
  return out;
}

/** Seconds a spent pool takes to fade out AFTER its life (its last burn lands at `life`). */
export const STARWAKE_POOL_FADE = 0.3;

/**
 * A molten pool's strength, 0..1, `elapsed` seconds into a `life`-second pool: spreads in
 * over 0.3 s, then holds at FULL through the whole life, because the sim's last burn lands
 * on the tick the pool runs out and a hazard must never look spent while it still hurts.
 * Only then does it fade, over STARWAKE_POOL_FADE.
 */
export function poolStrength(elapsed: number, life: number): number {
  if (elapsed <= 0) return 0;
  const spread = clamp01(elapsed / 0.3);
  if (elapsed <= life) return spread;
  return spread * clamp01(1 - (elapsed - life) / STARWAKE_POOL_FADE);
}

/** How far the pool has spread, 0..1 of its radius (grows with the first 0.3 s). */
export function poolSpread(elapsed: number): number {
  const t = clamp01(elapsed / 0.3);
  return 0.35 + 0.65 * (1 - (1 - t) * (1 - t));
}

/** Where a fissure's eruption spouts stand, as distances down it, origin first. */
export function spoutDistances(length: number, spacing = STARWAKE_SPOUT_SPACING): number[] {
  const out: number[] = [];
  const n = Math.max(1, Math.floor(length / spacing));
  const step = length / n;
  for (let i = 0; i < n; i++) out.push(step * (i + 0.5));
  return out;
}

/**
 * How many of those spouts a quality level keeps (cosmetic): every one at full quality,
 * never fewer than half (and never fewer than two), so the eruption always reads as the
 * whole crack going up, never as a lone puff.
 */
export function spoutBudget(count: number, quality: number): number {
  const keep = Math.round(count * (0.5 + 0.5 * clamp01(quality)));
  return Math.max(Math.min(count, 2), Math.min(count, keep));
}

/** Lava chunks a geyser flings at a quality level (cosmetic; two at the floor). */
export function chunkBudget(quality: number): number {
  return Math.max(2, Math.round(7 * clamp01(quality)));
}

/**
 * The seconds a spout at distance `d` down a fissure waits before it goes, so the eruption
 * runs from the origin to the tip like a fuse instead of all at once.
 */
export function spoutDelay(d: number, length: number): number {
  return 0.28 * clamp01(d / Math.max(1e-3, length));
}

/**
 * A deterministic lateral wobble in [-1, 1] for the jagged crack drawn down a fissure's
 * centre (`i` is the vertex row, `salt` separates fissures). Pure hash, no rng: the same
 * fissure always draws the same crack.
 */
export function crackJag(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  const f = s - Math.floor(s);
  // Low-pass: blend with the neighbour so the crack zigzags rather than buzzes.
  const s2 = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  const f2 = s2 - Math.floor(s2);
  return (f * 0.65 + f2 * 0.35) * 2 - 1;
}

/**
 * The ballistic position of a flung chunk `t` seconds after launch from (x, y, z) with
 * velocity (vx, vy, vz), under a light gravity, clamped at the ground it lands on. Writes
 * into `out` (the painter's scratch, so the frame loop allocates nothing).
 */
export function chunkPosition(
  t: number,
  origin: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  groundY: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const g = 22;
  const y = origin.y + v.y * t - 0.5 * g * t * t;
  out.x = origin.x + v.x * t;
  out.y = Math.max(groundY, y);
  out.z = origin.z + v.z * t;
  return out;
}
