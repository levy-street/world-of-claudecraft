// Quenching Breath's blast on the Guardian of the Quench, as numbers (round 2
// of her look, the lead's notes of 2026-11-08): under the Quench's light and
// the renderer's tone curve the round-1 mist and blast (a blue-white pushed
// past 1) came out cream-white, and the blast hid her for a second. Here:
//  - a palette compensated for the Quench grade: a clear ice blue a step
//    deeper and more saturated than it should read, so it lands icy
//    blue-white on screen, never cream (`QUENCH_BREATH_COLORS`);
//  - the blast thin at her and thick down the cone: its mist is born along
//    the cone from a share of the way out (`quenchBreathMistAt`), never in a
//    ball at her mouth, so her silhouette and her blazing heart stay seen;
//  - streaks of freezing wind tearing down the cone (`QUENCH_BREATH_STREAK`,
//    painted by quench_breath_streaks.ts), dense snow and shards.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic.

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Linear 0..1, compensated for the Quench grade (see above). */
export const QUENCH_BREATH_COLORS = {
  /** The blast's mist: a clear ice blue (reads blue-white over the ice). */
  mist: [0.3, 0.56, 0.98] as const,
  /** The snow in it: a pale cold blue, never pure white. */
  snow: [0.62, 0.84, 1.0] as const,
  /** Its shards (additive): bright cyan. */
  shard: [0.45, 0.9, 1.0] as const,
  /** The streaks: a deep blue edge, a cyan core, a white-cyan head. */
  streakDeep: [0.04, 0.2, 0.52] as const,
  streakCore: [0.5, 0.9, 1.0] as const,
  streakHot: [0.86, 0.98, 1.0] as const,
} as const;

/** The streaks of wind: their speed (yards a second), life, length range,
 *  width (yards), the pool, and how far out from her mouth they are born
 *  (yards: never over her face). */
export const QUENCH_BREATH_STREAK = {
  speed: 30,
  life: 0.62,
  length: [3.2, 6.5] as const,
  width: 0.55,
  pool: 40,
  poolLow: 18,
  bornOut: 3,
  /** Streaks loosed a second while the blast is strong. */
  rate: 70,
} as const;

/** A streak's strength over its life `k` (0..1): in fast, out slow. */
export function quenchBreathStreakFade(k: number): number {
  if (k < 0 || k >= 1) return 0;
  return clamp01(k / 0.12) * (1 - k) ** 1.2;
}

/** The blast's strength `age` seconds after it was loosed (0..1; nothing
 *  past `QUENCH_BREATH_BLAST_SECONDS`). */
export const QUENCH_BREATH_BLAST_SECONDS = 0.85;
export function quenchBreathBlast(age: number): number {
  if (age < 0 || age > QUENCH_BREATH_BLAST_SECONDS) return 0;
  return age < 0.4 ? 1 : 1 - (age - 0.4) / (QUENCH_BREATH_BLAST_SECONDS - 0.4);
}

/** Where along the cone (share of its range, from `u` 0..1 a draw) a puff of
 *  the blast's mist is born, and how big and how thick it is: none in the
 *  first fifth (her face and heart stay seen), thickening outward. */
export function quenchBreathMistAt(
  u: number,
  out: { along: number; size: number; alpha: number } = { along: 0, size: 0, alpha: 0 },
): { along: number; size: number; alpha: number } {
  // Biased outward: more of the mist far down the cone.
  const along = 0.22 + 0.78 * Math.sqrt(clamp01(u));
  out.along = along;
  out.size = 1.6 + 5.2 * along;
  out.alpha = 0.1 + 0.26 * along;
  return out;
}
