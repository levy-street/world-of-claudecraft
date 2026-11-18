// Pure plan of the Masterless Strength's woken stars' look (final_stars_fx.ts
// paints it; the owner's rework of 2026-11-18, design doc 7.5). Presentation
// only: every radius, reach and line is read off the sim's own tuning and the
// objects' templates (encounters/smith_heart/final_ids.ts), never tuned here.
//
//   - a lightning bolt's jagged path out of the sky, with its forks
//     (`boltPath`), and its flicker (`boltFlash`);
//   - a ring of light racing out over the floor (`ringWave`: Arcing Stone's
//     ring, the strike's flash, the shatter's frost);
//   - a Crossing Blade's pose: hovering upright at its rise, turning to its
//     line, then flying it point first on an eased curve (`bladeFlight`);
//   - a line's warning fill off its mark's own aura (`laneFill`);
//   - a Storm-Charged pillar's crawling arcs (`chargedArc`);
//   - the palette and the fixed pools.
//
// Three-free, DOM-free, deterministic (a seed in, the same bolt out).

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A small deterministic hash to 0..1. */
export function starHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

// ---- the palette ---------------------------------------------------------------------

/** The stars' light. A Sky Strike is a colder, whiter storm than Leaping
 *  Bolt's violet (the two Breath mechanics read apart); a charged pillar
 *  burns violet-white (the owner's call of 2026-11-18). */
export const STAR_COLORS = {
  boltCore: [0.93, 0.97, 1.0] as const,
  boltGlow: [0.55, 0.62, 1.0] as const,
  charged: [0.82, 0.7, 1.0] as const,
  chargedHex: 0xd6c4ff,
  strikeHex: 0xe8f0ff,
  arcHex: 0xc9b2ff,
  frost: [0.72, 0.9, 1.0] as const,
  frostHex: 0xbfe6ff,
  iceCore: [0.55, 0.85, 1.0] as const,
  stone: [0.62, 0.5, 0.32] as const,
} as const;

/** The fixed pools (allocated at build). */
export const STAR_POOLS = {
  /** Bolts at once (strikes, Arcing Stone's radial forks, charged pulses). */
  bolts: 28,
  /** Segments a bolt draws (its trunk and its forks). */
  boltSegments: 14,
  /** Floor rings racing out at once. */
  rings: 10,
  /** Crossing Blades and their lines at once (a Heroic round is two). */
  blades: 3,
  /** Wake columns at once. */
  columns: 4,
} as const;

// ---- the bolt ------------------------------------------------------------------------

/** One bolt's path: `n` points from the sky (`top` yards up) down to (0, 0),
 *  the trunk zig-zagging round the straight drop, plus one fork from a
 *  middle point, all as offsets from the strike's foot. Writes `out` (3 per
 *  point: x, y, z); returns how many points the trunk takes (the rest the
 *  fork). Deterministic from `seed`. */
export function boltPath(
  seed: number,
  top: number,
  out: Float32Array,
  trunk = 10,
  fork = 4,
  spread = 2.6,
): number {
  for (let i = 0; i < trunk; i++) {
    const t = i / (trunk - 1);
    const jag = i === 0 || i === trunk - 1 ? 0 : spread * (1 - t * 0.4);
    out[i * 3] = (starHash(seed, i * 3) - 0.5) * 2 * jag;
    out[i * 3 + 1] = top * (1 - t);
    out[i * 3 + 2] = (starHash(seed, i * 3 + 1) - 0.5) * 2 * jag;
  }
  // The fork leaves the trunk a third of the way down and stops short.
  const from = Math.max(1, Math.floor(trunk / 3));
  const fx = out[from * 3];
  const fy = out[from * 3 + 1];
  const fz = out[from * 3 + 2];
  const a = starHash(seed, 97) * Math.PI * 2;
  for (let k = 0; k < fork; k++) {
    const i = trunk + k;
    const t = (k + 1) / fork;
    out[i * 3] = fx + Math.cos(a) * t * spread * 2.2 + (starHash(seed, i) - 0.5) * spread;
    out[i * 3 + 1] = fy - t * fy * 0.55;
    out[i * 3 + 2] = fz + Math.sin(a) * t * spread * 2.2 + (starHash(seed, i + 50) - 0.5) * spread;
  }
  return trunk;
}

/** A bolt's brightness `age` seconds after it falls over a `life`: a hard
 *  flash, a second re-strike, then out. */
export function boltFlash(age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const k = age / life;
  const restrike = k > 0.35 && k < 0.5 ? 0.85 : 0;
  return Math.max((1 - k) ** 2, restrike * (1 - k));
}

// ---- a floor ring ----------------------------------------------------------------------

/** A ring of light racing out to `radius` over `seconds`: its front and
 *  its strength `age` in (the strength fades as it spreads). */
export function ringWave(
  age: number,
  radius: number,
  seconds: number,
): { front: number; alpha: number } {
  if (age < 0 || age >= seconds) return { front: 0, alpha: 0 };
  const k = age / seconds;
  return { front: radius * (1 - (1 - k) ** 3), alpha: (1 - k) ** 1.4 };
}

// ---- the blade ------------------------------------------------------------------------

/** How long a flight is drawn over (the sim's own bladeFly). */
export interface BladePose {
  /** Along its line, 0 (at its rise) to 1 (the far rim). */
  along: number;
  /** 0 upright (point down, hovering) to 1 flat (point first along the line). */
  tilt: number;
  /** Height of its middle over the floor. */
  lift: number;
  /** Its glow, 0..1. */
  glow: number;
}

/** The sim's own eased flight (off its mark, fastest mid-line, settling). */
export function bladeEase(k: number): number {
  const t = clamp01(k);
  return t * t * (3 - 2 * t);
}

/** A blade's pose: aiming (`flying` false, `aim` 0..1 of its warning, the
 *  `locked` tell) or flying (`fly` 0..1 of its flight). */
export function bladeFlight(
  t: number,
  flying: boolean,
  aim: number,
  locked: boolean,
  fly: number,
  out: BladePose,
): BladePose {
  if (!flying) {
    out.along = 0;
    // It tips toward its line as the lock nears.
    out.tilt = locked ? 0.35 : 0.12 * clamp01(aim);
    out.lift = 4.6 + 0.35 * Math.sin(t * 2.2);
    out.glow = locked ? 0.85 + 0.15 * Math.sin(t * 40) : 0.35 + 0.4 * clamp01(aim);
    return out;
  }
  const k = clamp01(fly);
  out.along = bladeEase(k);
  out.tilt = 1;
  out.lift = 2.4;
  out.glow = 1;
  return out;
}

// ---- the line ------------------------------------------------------------------------

/** A line's fill: its mark's aura run down (warn), whole once it has locked,
 *  and a bright flash through its flight. */
export function laneFill(
  state: 'warn' | 'lock' | 'fly',
  markRemaining: number,
  markDuration: number,
): number {
  if (state !== 'warn') return 1;
  if (!(markDuration > 0)) return 0.5;
  return clamp01(1 - markRemaining / markDuration);
}

// ---- the charged pillar ---------------------------------------------------------------

/** A Storm-Charged pillar's crawling arc at render time `t` (`n` arcs a
 *  pillar): which one is lit now, its start round the pillar (radians), its
 *  height span (0..1 of the pillar) and its brightness. */
export function chargedArc(
  t: number,
  id: number,
  k: number,
): { angle: number; from: number; to: number; on: number } {
  const step = Math.floor(t * 9 + k * 3.7 + id);
  const angle = starHash(id * 31 + k, step) * Math.PI * 2;
  const from = 0.05 + starHash(id + k, step * 3) * 0.55;
  const to = Math.min(1, from + 0.25 + starHash(id, step * 7 + k) * 0.45);
  const on = starHash(id * 7 + k, step * 11) < 0.6 ? 1 : 0;
  return { angle, from, to, on };
}
