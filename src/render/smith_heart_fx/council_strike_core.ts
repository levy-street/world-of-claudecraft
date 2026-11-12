// Pure plan of the Guardian of the Hammer's two big blows' cast and impact
// look (council_strike_fx.ts paints it), on top of their telegraphs:
//   - Mountain's Wrath (encounters/smith_heart/council_wrath.ts): a 4 s bar
//     (the heir's 3 s), then every player in the Quarry its holder can see is
//     struck and every pillar shatters. Its telegraph is the trash engine's
//     sight field and the real shadows behind the pillars (CouncilFx), drawn
//     on every tier and never touched here;
//   - Mountain's Rush (council_rush.ts): a 5 s bar at a marked player, the
//     wind-up, the charge, the stop. Its telegraph is the lane, the mark and
//     the red arrow over the marked player (council_rush_fx.ts,
//     council_rush_arrow.ts), drawn on every tier and never touched here.
// This look is the power behind them, cosmetic over the telegraphs:
//   - the gather through the bar: light swelling in the caster's two fists,
//     motes of the vein streaming into them off a ring round its feet,
//     cracks of stone light splitting open under it, pebbles lifting off
//     the floor and hanging round it, shivering as the bar ends;
//   - the release: for the Wrath a white flash, a burst of the vein's light
//     out of the fists, the hanging pebbles blasted outward, rock and a dust
//     wall rolling out over the Quarry, shock rings, the camera's thud; for
//     the Rush the fists' flare at the wind-up and a heavier stop (flash,
//     rubble, the cracks bursting open where it stops).
// The low tier keeps every telegraph and draws fewer pebbles, motes and
// rocks; reduced motion drops the thud.
//
// Three-free, DOM-free, deterministic (hashed, never Math.random).

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

export type CouncilStrikeKind = 'wrath' | 'rush';

/** Each blow's palette (linear 0..1): the gather's light and its core. */
export const STRIKE_LOOKS: Readonly<
  Record<
    CouncilStrikeKind,
    { light: readonly [number, number, number]; core: readonly [number, number, number] }
  >
> = {
  // The Hammer vein's stone light, white-gold at its heart.
  wrath: { light: [1.0, 0.68, 0.24], core: [1.0, 0.94, 0.78] },
  // The charge's ember red (the lane's lethal hue), orange at its heart.
  rush: { light: [1.0, 0.3, 0.1], core: [1.0, 0.74, 0.45] },
};

/** The look's numbers (seconds, yards). */
export const STRIKE_FX = {
  /** The pebbles hanging round the caster (fewer on the low tier). */
  pebbles: 20,
  pebblesLow: 8,
  /** Their ring round its feet (yards, at the caster's scale of 1). */
  pebbleInner: 2.2,
  pebbleOuter: 5.2,
  /** How high the highest climbs. */
  pebbleRise: 6,
  /** The release's flash and the pebbles' flight. */
  flashFor: 0.38,
  flungFor: 1.6,
  /** The cracks under the caster after a release, cooling. */
  cracksFor: 2.8,
  /** The cracks' full reach (yards, at the caster's scale of 1). */
  crackReach: 7,
  /** The share of the bar over which the fists' light swells. */
  shiverFrom: 0.85,
} as const;

/** The gather `fill` (0..1) into its bar. */
export interface StrikeGather {
  /** The fists' glow, 0 to 1. */
  glow: number;
  /** Motes streaming in a second (before the tier's density). */
  motes: number;
  /** The cracks under it opening (0..1 of their reach) and their heat. */
  crack: number;
  heat: number;
  /** The pebbles' lift (0..1). */
  lift: number;
  /** The last moments' shiver (0..1; cosmetic). */
  shiver: number;
}

export function newStrikeGather(): StrikeGather {
  return { glow: 0, motes: 0, crack: 0, heat: 0, lift: 0, shiver: 0 };
}

/** The gather's look `fill` (0..1) into its bar (into `out`). */
export function strikeGather(fill: number, out: StrikeGather = newStrikeGather()): StrikeGather {
  const f = clamp01(fill);
  out.glow = 0.2 + 0.8 * f ** 1.4;
  out.motes = 10 + 70 * f;
  out.crack = smooth(f / 0.9);
  out.heat = 0.3 + 0.7 * f;
  out.lift = smooth(f / 0.6);
  out.shiver =
    f > STRIKE_FX.shiverFrom ? (f - STRIKE_FX.shiverFrom) / (1 - STRIKE_FX.shiverFrom) : 0;
  return out;
}

/** After a release, `since` seconds on. */
export interface StrikeRelease {
  /** The flash (0..1; capped under reduced motion). */
  flash: number;
  /** The cracks' heat (0..1), cooling; their reach (0..1). */
  heat: number;
  crack: number;
  /** Anything still to draw. */
  live: boolean;
}

export function newStrikeRelease(): StrikeRelease {
  return { flash: 0, heat: 0, crack: 0, live: false };
}

/** The release's look `since` seconds after it (into `out`). */
export function strikeRelease(
  since: number,
  reduced: boolean,
  out: StrikeRelease = newStrikeRelease(),
): StrikeRelease {
  if (!(since >= 0) || since > STRIKE_FX.cracksFor) {
    out.flash = 0;
    out.heat = 0;
    out.crack = 0;
    out.live = false;
    return out;
  }
  const fl = since < STRIKE_FX.flashFor ? (1 - since / STRIKE_FX.flashFor) ** 2 : 0;
  out.flash = reduced ? fl * 0.35 : fl;
  out.crack = 1;
  out.heat = since < 0.3 ? 1 : (1 - (since - 0.3) / (STRIKE_FX.cracksFor - 0.3)) ** 1.5;
  out.live = true;
  return out;
}

/** A small deterministic hash (0..1) of an index and a salt. */
export function strikeHash(i: number, salt: number): number {
  const s = Math.sin(i * 91.7 + salt * 47.3) * 24634.6345;
  return s - Math.floor(s);
}

/** One pebble: its offset from the caster's feet (yards, at its scale of
 *  1), its height, turn and size (0 hides it). */
export interface StrikePebble {
  x: number;
  y: number;
  z: number;
  spin: number;
  size: number;
}

export function newStrikePebble(): StrikePebble {
  return { x: 0, y: 0, z: 0, spin: 0, size: 0 };
}

/** Pebble `i` of `count` hanging at `lift` (0..1) at render time `t`
 *  (slowly circling, bobbing, shivering when `shiver` > 0). */
export function pebbleHang(
  i: number,
  count: number,
  lift: number,
  t: number,
  shiver: number,
  out: StrikePebble = newStrikePebble(),
): StrikePebble {
  if (count <= 0 || lift <= 0) {
    out.size = 0;
    return out;
  }
  const a0 = ((i + 0.6 * strikeHash(i, 1)) / count) * Math.PI * 2;
  const a = a0 + t * (0.25 + 0.2 * strikeHash(i, 2));
  const r =
    STRIKE_FX.pebbleInner + (STRIKE_FX.pebbleOuter - STRIKE_FX.pebbleInner) * strikeHash(i, 3);
  const high = 0.6 + STRIKE_FX.pebbleRise * strikeHash(i, 4);
  // Each lifts off in its own moment through the gather.
  const own = smooth((lift - 0.3 * strikeHash(i, 5)) / 0.7);
  const jitter = shiver * 0.12 * Math.sin(t * 47 + i * 3.1);
  out.x = Math.sin(a) * r + jitter;
  out.z = Math.cos(a) * r - jitter;
  out.y = own * high + 0.25 * own * Math.sin(t * 2.2 + i);
  out.spin = t * (0.6 + 1.6 * strikeHash(i, 6)) + i;
  out.size =
    own > 0.01 ? (0.22 + 0.4 * strikeHash(i, 7)) * Math.sqrt(STRIKE_FX.pebbles / count) : 0;
  return out;
}

const G = 26;

/** Pebble `i` blasted outward `since` seconds after the release
 *  from where it hung (`from`): flung out and down, gone at its end. */
export function pebbleFlung(
  i: number,
  since: number,
  from: StrikePebble,
  out: StrikePebble = newStrikePebble(),
): StrikePebble {
  if (!(since >= 0) || since >= STRIKE_FX.flungFor || from.size <= 0) {
    out.size = 0;
    return out;
  }
  const len = Math.hypot(from.x, from.z) || 1;
  const speed = 18 + 14 * strikeHash(i, 8);
  const up = 4 + 6 * strikeHash(i, 9);
  out.x = from.x + (from.x / len) * speed * since;
  out.z = from.z + (from.z / len) * speed * since;
  out.y = Math.max(0, from.y + up * since - 0.5 * G * since * since);
  out.spin = from.spin + since * 9;
  out.size = from.size * (1 - smooth((since - 0.9) / (STRIKE_FX.flungFor - 0.9)));
  return out;
}

/** The camera's thud at a release, by how far the local player stands from
 *  it (none under reduced motion). */
export function strikeShake(kind: CouncilStrikeKind, dist: number, reduced: boolean): number {
  if (reduced) return 0;
  const reach = kind === 'wrath' ? 110 : 50;
  if (!(dist < reach)) return 0;
  const top = kind === 'wrath' ? 0.85 : 0.35;
  return top * (1 - dist / reach) ** 1.2 + 0.1;
}
