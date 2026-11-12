// Pure plan of Weight of the Anvil's look (final_anvil_fx.ts paints it;
// encounters/smith_heart/final_hammer.ts is the mechanic): the final boss's
// only group soak. A 6 yd mark is laid where a hashed player stood, a 6 s bar
// runs, and the great anvil falls on it: its whole blow split between
// everyone under it (half as much again each with fewer than three), the
// whole raid struck when nobody stands there.
//
// What the raid acts on, every tier, never thinned:
//   - the mark at the sim's own radius (the shared floor telegraph, painted by
//     FinalKitFx in the soak's gold);
//   - the countdown: six runes round the mark's rim kindling one a second
//     (`anvilRuneLit`), so the bar reads on the floor without the cast bar;
//   - the closing ring over the last fifth (`anvilHang().close`): a bright
//     band sliding in from outside the rim onto it the moment the anvil
//     drops, landing on the rim as it strikes;
//   - the share: the runes burn white-gold once enough stand under it
//     (`anvilSoakReady`, the sim's own minimum), ember red while too few;
//   - the column of heat from the anvil down to its mark (the line it falls).
// What is cosmetic (thinned on the low tier, the shake gone under reduced
// motion): the metal's heat and its seams and runes, the shudder before the
// drop, the fall's streak, the flash, the shock rings past the first, the
// molten splash, the fragments, the dust wall, the scar's cooling cracks.
//
// Three-free, DOM-free, deterministic (hashed, never Math.random).

import { FINAL_TUNING as T } from '../../sim/encounters/smith_heart/final_ids';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The look's numbers (seconds, yards). */
export const ANVIL_FX = {
  /** How high it hangs over its mark while the bar runs (low enough that
   *  the raid's camera, stood round the mark, keeps it in view). */
  hangHigh: 19,
  /** The share of the bar at which it lets go and falls. */
  dropAt: 0.8,
  /** The runes round the mark (one a second of the 6 s bar). */
  runes: 6,
  /** Where the closing ring starts, as a share of the mark's radius. */
  closeFrom: 1.75,
  /** After the strike: the flash, the fragments' flight, the scar's cooling. */
  flashFor: 0.42,
  chunksFor: 2.6,
  scarFor: 6,
  /** The fragments the anvil bursts into (every tier keeps the burst whole;
   *  the low tier draws fewer, larger pieces). */
  chunks: 30,
  chunksLow: 12,
  /** The particles' budgets at the strike (the tier's density thins them). */
  splash: 150,
  sparks: 120,
  dustWall: 64,
} as const;

/** The hanging anvil `fill` (0..1) through its bar. */
export interface AnvilHang {
  /** Yards over its mark. */
  height: number;
  /** The metal's heat, 0 cold stone to 1 white-hot. */
  heat: number;
  /** The countdown's runes lit (0 to ANVIL_FX.runes, continuous). */
  runes: number;
  /** The closing ring's radius as a share of the mark's (0: none). */
  close: number;
  /** The closing ring's strength (0..1). */
  closeAlpha: number;
  /** The column of heat from it to its mark (0..1). */
  column: number;
  /** Its shudder before the drop (radians of wobble at full; cosmetic). */
  shudder: number;
  /** The fall's streak behind it (0..1; cosmetic). */
  streak: number;
}

export function newAnvilHang(): AnvilHang {
  return {
    height: ANVIL_FX.hangHigh,
    heat: 0,
    runes: 0,
    close: 0,
    closeAlpha: 0,
    column: 0,
    shudder: 0,
    streak: 0,
  };
}

/** The hanging anvil's look `fill` (0..1) into its bar (into `out`). */
export function anvilHang(fill: number, out: AnvilHang = newAnvilHang()): AnvilHang {
  const f = clamp01(fill);
  const D = ANVIL_FX.dropAt;
  const fall = f < D ? 0 : ((f - D) / (1 - D)) ** 2;
  // It sinks a little as the bar fills (the weight settling), then drops.
  const settle = 3 * (1 - smooth(f / D));
  out.height = (ANVIL_FX.hangHigh + settle) * (1 - fall);
  // Dull red to white-hot, the last stretch the fastest.
  out.heat = 0.18 + 0.82 * f ** 1.6;
  out.runes = ANVIL_FX.runes * f;
  const c = f < D ? 0 : (f - D) / (1 - D);
  out.close = c > 0 ? 1 + (ANVIL_FX.closeFrom - 1) * (1 - c) ** 1.4 : 0;
  out.closeAlpha = c > 0 ? 0.55 + 0.45 * c : 0;
  out.column = 0.25 + 0.75 * smooth(f / D);
  // A shiver in the last second before it lets go.
  out.shudder = f > D - 0.17 && f < D ? 0.05 * smooth((f - (D - 0.17)) / 0.17) : 0;
  out.streak = fall > 0 ? smooth(c / 0.25) : 0;
  return out;
}

/** How lit rune `i` (0-based round the rim) is at `runes` lit: each kindles
 *  over its own second with a flare as it catches, then burns steady. */
export function anvilRuneLit(i: number, runes: number): number {
  const k = runes - i;
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return smooth(k) * (1 + 0.6 * Math.sin(k * Math.PI));
}

/** How many of `points` (living players' places) stand under the mark at
 *  (x, z) of `radius`: the sim's own test (final_hammer.ts landAnvil:
 *  within the radius, its rim counted). */
export function anvilUnder(
  points: readonly { x: number; z: number; dead?: boolean }[],
  x: number,
  z: number,
  radius: number,
): number {
  let n = 0;
  for (const p of points) if (!p.dead && Math.hypot(p.x - x, p.z - z) <= radius) n++;
  return n;
}

/** Enough stand under it for a full share each (the sim's own minimum). */
export function anvilSoakReady(under: number): boolean {
  return under >= T.anvilMinSoakers;
}

/** After the strike, `since` seconds on. */
export interface AnvilImpact {
  /** The white flash (0..1; capped under reduced motion). */
  flash: number;
  /** The scar's molten glow (0..1), cooling. */
  scar: number;
  /** The scar's cracks' reach as a share of its full spread (0..1). */
  spread: number;
  /** The fragments are still in the air or on the floor. */
  chunks: boolean;
  /** Anything still to draw. */
  live: boolean;
}

export function newAnvilImpact(): AnvilImpact {
  return { flash: 0, scar: 0, spread: 0, chunks: false, live: false };
}

/** The strike's look `since` seconds after it (into `out`). */
export function anvilImpact(
  since: number,
  reduced: boolean,
  out: AnvilImpact = newAnvilImpact(),
): AnvilImpact {
  if (!(since >= 0) || since > ANVIL_FX.scarFor) {
    out.flash = 0;
    out.scar = 0;
    out.spread = 0;
    out.chunks = false;
    out.live = false;
    return out;
  }
  const fl = since < ANVIL_FX.flashFor ? (1 - since / ANVIL_FX.flashFor) ** 2 : 0;
  out.flash = reduced ? fl * 0.35 : fl;
  out.spread = smooth(since / 0.18);
  // White-hot for a breath, then cooling slowly to nothing.
  out.scar = since < 0.6 ? 1 : (1 - (since - 0.6) / (ANVIL_FX.scarFor - 0.6)) ** 1.6;
  out.chunks = since < ANVIL_FX.chunksFor;
  out.live = true;
  return out;
}

/** One fragment of the burst `since` seconds after the strike: its offset
 *  from the strike (yards), height, tumble and size (0 hides it). */
export interface AnvilChunk {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tumble: number;
  size: number;
  /** Its heat (0..1), cooling as it flies and lies. */
  heat: number;
}

export function newAnvilChunk(): AnvilChunk {
  return { x: 0, y: 0, z: 0, yaw: 0, tumble: 0, size: 0, heat: 0 };
}

/** A small deterministic hash (0..1) of an index and a salt. */
export function anvilHash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const G = 30;

/** Fragment `i` of `count` (the pieces fly on fixed bearings round the
 *  strike, so the low tier's fewer pieces still ring it whole). */
export function anvilChunkAt(
  i: number,
  count: number,
  since: number,
  out: AnvilChunk = newAnvilChunk(),
): AnvilChunk {
  if (!(since >= 0) || since >= ANVIL_FX.chunksFor || count <= 0) {
    out.size = 0;
    return out;
  }
  const bearing = ((i + 0.5 * anvilHash(i, 1)) / count) * Math.PI * 2;
  const speed = 7 + 9 * anvilHash(i, 2);
  const lift = 9 + 10 * anvilHash(i, 3);
  // The flight until it lands (y back to 0), then it lies and sinks.
  const flight = (2 * lift) / G;
  const t = Math.min(since, flight);
  const r = 2 + speed * t;
  out.x = Math.sin(bearing) * r;
  out.z = Math.cos(bearing) * r;
  out.y = Math.max(0, lift * t - 0.5 * G * t * t);
  const lying = since - flight;
  if (lying > 0) out.y -= Math.min(1, lying / (ANVIL_FX.chunksFor - flight + 1e-6)) * 0.9;
  out.yaw = bearing + 3 * anvilHash(i, 4);
  out.tumble = (2 + 6 * anvilHash(i, 5)) * t;
  // Bigger when fewer are drawn (the low tier's pieces fill the same burst).
  const base = (0.16 + 0.42 * anvilHash(i, 6)) * Math.sqrt(ANVIL_FX.chunks / count);
  const fade = lying > 0 ? 1 - smooth(lying / (ANVIL_FX.chunksFor - flight + 1e-6)) : 1;
  out.size = base * Math.max(0, fade);
  out.heat = Math.max(0, 1 - since / ANVIL_FX.chunksFor) ** 0.7;
  return out;
}

/** The camera's thud at the strike, by how far the local player stands from
 *  it (none under reduced motion). */
export function anvilShake(dist: number, reduced: boolean): number {
  if (reduced) return 0;
  const reach = 95;
  if (!(dist < reach)) return 0;
  return 1.05 * (1 - dist / reach) ** 1.3 + 0.15;
}

/** Did a timeline cross `at` from `prev` to `now` (forward only)? */
export function anvilCrossed(prev: number, now: number, at: number): boolean {
  return prev < at && now >= at;
}

/** The sound beats the look adds over the fight's own (the bar's warning
 *  and the strike's boom play from game/smith_heart_final_audio_core.ts):
 *  every key an existing sample. `bar` beats at a share of the bar, `after`
 *  beats seconds after the strike. */
export interface AnvilSoundBeat {
  key: string;
  gain: number;
  rate: number;
  bar?: number;
  after?: number;
}

export const ANVIL_SOUNDS: readonly AnvilSoundBeat[] = [
  // The stone groaning as the heat climbs, then the rush of air as it drops.
  { key: 'heart_council_shelter_strain', gain: 0.55, rate: 0.8, bar: 0.5 },
  { key: 'heart_council_rock_fall', gain: 0.85, rate: 0.72, bar: ANVIL_FX.dropAt },
  // The molten splash under the boom, and the scar hissing as it cools.
  { key: 'heart_heat_cinder_burst', gain: 0.7, rate: 0.8, after: 0.06 },
  { key: 'heart_heat_sink', gain: 0.45, rate: 0.9, after: 0.9 },
];
