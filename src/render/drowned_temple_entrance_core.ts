// The Moon Stair's cosmetic plan (pure, Three-free): the Drowned Temple's
// world entrance (door (-70, 792), Thornpeak Heights). ONE clock drives
// everything: the MOONRISE. The Court's scrying house still keeps its hours:
// every so often the moon the pool holds climbs toward its surface, and its
// light comes up out of the mirror at the stair's drowned foot, climbs the
// flight's silver inlays one by one, runs up both flanks of the moongate
// through the moon's phases to the full moon on the keystone, and for a few
// seconds the gate's film blazes and a pale shaft stands over its horns.
// Between risings the inlays only ember and the film turns slowly.
//
// This module holds: that clock; the three faces of the liquid moonlight the
// painter draws in one mesh (the POOL, whose water shows a full moon deep
// under its surface with true parallax; the gate's FILM, layers of cold light
// turning at their own depths behind the ring; the MIRROR, the still water the
// weir holds at the stair's foot, which reflects the sky and the gate); the
// mist's puffs; and the additive sprites (the halo on every live inlay, the
// flare and the shaft at the crown, the motes, the glints on the wet treads,
// the falls at the weir's notches). src/render/drowned_temple_entrance.ts is
// the thin painter and its shaders evaluate THESE formulas on the GPU. Every
// value is door-local: lx = x - door.x (+x WEST), lz = z - door.z (+z NORTH),
// y above the door's terrain height. Cosmetic only: nothing here is a
// telegraph, the door stays a click box and a nameplate on every tier, and
// the effects tier only thins the mist, the motes, the glints and the falls.
import { globalDayness } from './day_night_core';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';

/** The static effects tier (src/game/ui_effects_profile.ts resolves it). */
export type TempleEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

const TAU = Math.PI * 2;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function tierRank(tier: TempleEffectsTier): number {
  return tier === 'low' ? 0 : tier === 'medium' ? 1 : tier === 'high' ? 2 : 3;
}

/** How much of the night shows at a day/night phase: 0 through the day,
 *  rising through dusk, 1 at night. */
export function templeNightAmount(phase: number): number {
  return smoothstep(0, 1, (0.62 - globalDayness(phase)) / 0.5);
}

// ---- the set piece's own numbers (from the Blender build) -------------------------

/** The levels: the dais floor, the ring's centre and radii, the sill in the
 *  ring's foot, the mirror's water (src/sim/drowned_temple_entrance.ts). */
export const TEMPLE_GATE = {
  dais: 0.8,
  sill: 1.3,
  centre: 5.6,
  inner: 4.55,
  outer: 5.85,
  water: -5.85,
} as const;

/** The moon pool on the terrace behind the gate. */
export const TEMPLE_POOL = { lx: 0, lz: 13.6, radius: 3.3, water: 4.534, rim: 4.694 } as const;

/** The whole horn's silver tip (lx, y, lz). */
export const TEMPLE_HORN_TIP = [0.95, 15.17, 0] as const;

/** A live inlay: lx, y, lz, its place in the moonrise (0 the stair's drowned
 *  foot, 1 the crown), its radius. */
export type TempleRune = readonly [number, number, number, number, number];

export const TEMPLE_STAIR_RUNES: readonly TempleRune[] = [
  [0, 0.228, -3.33, 0.47, 0.17],
  [0, -0.64, -4.71, 0.411, 0.17],
  [0, -2.374, -7.47, 0.294, 0.17],
  [0, -3.242, -8.85, 0.235, 0.17],
  [0, -4.977, -11.61, 0.117, 0.17],
  [0, -5.844, -12.99, 0.059, 0.17],
  [0, -6.711, -14.37, 0, 0.17],
];

export const TEMPLE_RING_RUNES: readonly TempleRune[] = [
  [4.011, 8.799, -0.798, 0.752, 0.25],
  [2.256, 10.285, -0.851, 0.856, 0.25],
  [0, 10.92, -0.89, 0.96, 0.34],
  [-2.256, 10.285, -0.862, 0.856, 0.25],
  [-4.066, 8.842, -0.796, 0.752, 0.25],
  [-5.07, 6.757, -0.801, 0.52, 0.25],
  [-4.066, 2.358, -0.84, 0.52, 0.25],
  [-2.256, 0.915, -0.865, 0.52, 0.25],
  [2.256, 0.915, -0.817, 0.52, 0.25],
  [4.066, 2.358, -0.84, 0.52, 0.25],
  [5.07, 4.443, -0.811, 0.52, 0.25],
  [0, 1.35, 0, 0.5, 0.36],
];

export const TEMPLE_POOL_RUNES: readonly TempleRune[] = [
  [3.936, 4.68, 13.082, 0.985, 0.16],
  [2.417, 4.68, 10.45, 0.985, 0.16],
  [-0.518, 4.68, 9.664, 0.985, 0.16],
  [-3.936, 4.68, 14.118, 0.985, 0.16],
  [-2.49, 4.62, 16.845, 0.985, 0.16],
  [0.518, 4.68, 17.536, 0.985, 0.16],
  [3.15, 4.68, 16.017, 0.985, 0.16],
];

/** Where the wet stone by the water catches the light (lx, y, lz). */
export const TEMPLE_GLINTS: readonly (readonly [number, number, number])[] = [
  [0.096, -4.973, -11.611],
  [1.541, -4.973, -11.726],
  [-0.196, -4.973, -11.491],
  [-1.001, -5.262, -12.07],
  [1.793, -5.262, -12.147],
  [1.331, -5.262, -12.084],
  [-0.615, -5.551, -12.574],
  [1.021, -5.551, -12.594],
  [-2.921, -5.551, -12.371],
  [-1.069, -5.84, -13.048],
  [1.263, -5.84, -12.96],
  [-1.746, -5.84, -12.886],
  [10.208, -5.6, -16.863],
  [6.525, -5.6, -18.23],
  [-0.458, -5.6, -26.759],
  [-1.773, -5.6, -27.209],
  [-2.915, -5.6, -27.6],
  [-7.069, -5.6, -28.189],
  [-9.558, -5.6, -28.391],
  [-15.762, -5.6, -28.097],
  [-17.241, -5.6, -27.702],
  [-19.982, -5.6, -26.68],
];

/** Where a drop falls from a penitent's plinth into the mirror (lx, y, lz). */
export const TEMPLE_DRIPS: readonly (readonly [number, number, number])[] = [
  [-5.815, -5.13, -15.534],
  [-7.131, -5.13, -14.91],
  [-7.318, -5.13, -16.354],
  [7.318, -5.13, -16.354],
  [7.131, -5.13, -14.91],
  [5.815, -5.13, -15.534],
];

/** A spill at one of the weir's notches: the lip (lx, y, lz), the fall's
 *  height, the outward direction (x, z) and the notch's width. */
export type TempleFall = readonly [number, number, number, number, number, number, number];

export const TEMPLE_FALLS: readonly TempleFall[] = [
  [2.079, -5.92, -26.194, 1.424, 0.692, -0.722, 1.15],
  [-12.017, -5.92, -29.36, 1.365, -0.017, -1, 0.9],
];

/** The mirror's water as runs of squares of TEMPLE_MIRROR_STEP yards, inside
 *  the weir's line: [lz of the run, lx of its first square, how many]. */
export const TEMPLE_MIRROR_STEP = 1.25;
export const TEMPLE_MIRROR_RUNS: readonly (readonly [number, number, number])[] = [
  [-28.75, -16.25, 8],
  [-27.5, -20, 15],
  [-26.25, -21.25, 18],
  [-25, -22.5, 20],
  [-23.75, -23.75, 21],
  [-22.5, -23.75, 22],
  [-21.25, -23.75, 22],
  [-20, -23.75, 23],
  [-18.75, -23.75, 24],
  [-17.5, -23.75, 27],
  [-16.25, -23.75, 31],
  [-15, -16.25, 23],
  [-13.75, -11.25, 17],
  [-12.5, -8.75, 13],
  [-11.25, -6.25, 8],
  [-10, -5, 6],
];

/** The runs as (lx, lz) pairs: the south-east corner of every square. */
export function templeMirrorCells(
  runs: readonly (readonly [number, number, number])[] = TEMPLE_MIRROR_RUNS,
): number[] {
  const out: number[] = [];
  for (const [z, x0, count] of runs) {
    for (let i = 0; i < count; i++) out.push(x0 + i * TEMPLE_MIRROR_STEP, z);
  }
  return out;
}

// ---- the moonrise ------------------------------------------------------------------

export const TEMPLE_MOONRISE = {
  /** Seconds between risings. */
  period: 22,
  /** Fractions of the period: the light leaves the stair's foot, reaches the
   *  crown, the crest ends, and the embers are back to rest. */
  climbStart: 0.3,
  climbEnd: 0.6,
  crestEnd: 0.74,
  fadeEnd: 0.97,
  /** What a live inlay holds between risings. */
  ember: 0.16,
  /** The still values under reduced motion: every inlay evenly lit, the film
   *  and the pool a little over their rest. */
  stillGlow: 0.62,
  stillCrest: 0.4,
} as const;

export interface TempleMoonrise {
  /** How far the light has climbed: an inlay is lit once this passes its order. */
  front: number;
  /** How brightly the lit inlays burn (1 through the climb and the crest). */
  glow: number;
  /** The crest itself, 0 to 1: the film, the shaft, the pool's moon, the light. */
  crest: number;
}

/**
 * The moonrise at a time. The moonwater, the mist, the sprites, the inlays'
 * own material and the point light all read these three values (the shaders
 * run the same formula). motion 0 (reduced motion) holds it still.
 */
export function templeMoonrise(time: number, motion: number, out: TempleMoonrise): TempleMoonrise {
  const m = TEMPLE_MOONRISE;
  const u = fract((time * motion) / m.period);
  const climb = clamp01((u - m.climbStart) / (m.climbEnd - m.climbStart));
  const front = -0.06 + 1.14 * climb;
  const glow = u < m.climbStart ? 0 : 1 - smoothstep(m.crestEnd, m.fadeEnd, u);
  const crest =
    smoothstep(m.climbEnd - 0.04, m.climbEnd + 0.03, u) *
    (1 - smoothstep(m.crestEnd, m.fadeEnd, u));
  out.front = 1.08 + (front - 1.08) * motion;
  out.glow = m.stillGlow + (glow - m.stillGlow) * motion;
  out.crest = m.stillCrest + (crest - m.stillCrest) * motion;
  return out;
}

/** How brightly an inlay of a given order burns: its ember, the steady light
 *  once the front has passed it, and the flash as it passes. */
export function templeRuneGlow(order: number, rise: TempleMoonrise): number {
  const lit = smoothstep(order - 0.035, order + 0.015, rise.front);
  const d = (rise.front - order) / 0.05;
  const flash = rise.front < 1.07 ? Math.exp(-d * d) : 0;
  return (
    TEMPLE_MOONRISE.ember + (1 - TEMPLE_MOONRISE.ember) * lit * rise.glow + 0.7 * flash * rise.glow
  );
}

/** Which fading unit a collider row of the set piece belongs to
 *  (set_piece_occluders.ts): the gate, the flight's east or west flank (its
 *  cheek wall, its columns and its penitent), or the works (the weir and the
 *  pool's stelae). The treads themselves are no solid and never ghost. Every
 *  row belongs to one unit, so every solid is an occluder. */
export function templeOccluderSet(rowName: string): TempleGhostSet {
  if (rowName.startsWith('moongate_')) return 'gate';
  if (rowName.startsWith('weir_') || rowName.startsWith('stela_')) return 'works';
  return /_w(_|$)/.test(rowName) ? 'west' : 'east';
}

/** The fading units, in the order the painter's ghost uniform carries them
 *  (x, y, z, w). A sprite says which one it hangs on by this order plus one;
 *  zero hangs on nothing that fades. */
export const TEMPLE_GHOST_SETS = ['gate', 'east', 'west', 'works'] as const;
export type TempleGhostSet = (typeof TEMPLE_GHOST_SETS)[number];

/** How much of what hangs on a fading unit shows for the alpha that unit is
 *  drawn at (the registry's onFade): all of it while the unit is solid, none
 *  once it is the camera's ghost, so no film stands in an empty ring and no
 *  halo burns in the air where a stone was; it returns with the stone. */
export function templeGhostShown(alpha: number): number {
  if (!(alpha < 1)) return 1;
  const t = (alpha - OCCLUDER_FADE_ALPHA) / (1 - OCCLUDER_FADE_ALPHA);
  return t <= 0 ? 0 : t;
}

/** The film is a solid to the camera too: a thin box across the ring's mouth
 *  (door-local centre, half sizes, top), so the gate and its film ghost
 *  together when the camera looks through the ring at the character. */
export const TEMPLE_FILM_OCCLUDER = {
  lx: 0,
  lz: 0,
  hw: TEMPLE_GATE.inner,
  hd: 0.3,
  top: TEMPLE_GATE.centre + TEMPLE_GATE.inner,
} as const;

/** The single point light: the gate's cold light on the stair's head (a
 *  fire-light sink source, like every world glow light). */
export const TEMPLE_GATE_LIGHT = {
  lx: 0,
  y: TEMPLE_GATE.centre - 0.6,
  lz: -2.4,
  color: 0xa8c8ff,
  rest: 3.2,
  crest: 10,
  distance: 19,
} as const;

export function templeGateLightIntensity(crest: number): number {
  return TEMPLE_GATE_LIGHT.rest + (TEMPLE_GATE_LIGHT.crest - TEMPLE_GATE_LIGHT.rest) * crest;
}

// ---- the liquid moonlight: the pool, the film, the mirror ----------------------------
//
// One mesh, three faces told apart by a per-vertex kind.

export const TEMPLE_WATER_KIND = { pool: 0, film: 1, mirror: 2 } as const;

/** The pool's moon: a disc lying under the surface. It hangs deep at rest and
 *  climbs to just under the water at the crest. */
export const TEMPLE_POOL_MOON = {
  restDepth: 1.5,
  crestDepth: 0.55,
  radius: 1.05,
  stars: 26,
  /** Air to water: the eye's ray bends down as it enters (1 / 1.33), so the
   *  moon keeps inside the kerb from a standing eye. */
  eta: 0.75,
} as const;

export function templePoolMoonDepth(crest: number): number {
  const m = TEMPLE_POOL_MOON;
  return m.restDepth + (m.crestDepth - m.restDepth) * crest;
}

/**
 * Where an eye ray through a point of the pool's surface meets the plane the
 * moon lies on, `depth` under the water (door-local x, z): the SAME projection
 * the fragment shader runs, which is what gives the moon its parallax. A ray
 * that does not look down meets nothing (NaN).
 */
export function templePoolTrace(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  px: number,
  pz: number,
  depth: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const dx = px - eyeX;
  const dy = TEMPLE_POOL.water - eyeY;
  const dz = pz - eyeZ;
  if (dy > -1e-4) {
    out.x = Number.NaN;
    out.z = Number.NaN;
    return out;
  }
  // Snell at the surface: the ray keeps eta of its sideways run and dives
  const len = Math.hypot(dx, dy, dz);
  const eta = TEMPLE_POOL_MOON.eta;
  const down = Math.max(0.3, Math.sqrt(1 - eta * eta * (1 - (dy / len) ** 2)));
  const t = depth / down;
  out.x = px + ((eta * dx) / len) * t;
  out.z = pz + ((eta * dz) / len) * t;
  return out;
}

/** The film's layers of turning light: how deep each lies behind the ring's
 *  plane, how fast it turns (radians a second), how fine its grain is, and
 *  how many arms its whirl has. The arms are a WHOLE number: the whirl is
 *  drawn on the angle about the layer's own heart, and only a whole number
 *  of turns of its phase round the circle closes on itself. (A fraction
 *  leaves a seam along the line where the angle wraps, one a layer, each at
 *  its own height once the eye is off the ring's axis: straight horizontal
 *  tears across the film.) */
export const TEMPLE_FILM_LAYERS: readonly (readonly [number, number, number, number])[] = [
  [0.5, 0.03, 0.42, 2],
  [2.0, -0.02, 0.3, 1],
  [4.6, 0.012, 0.2, 1],
];

/** The film's look: how tightly the whirl winds toward its heart (little: it
 *  is light lying in still water, not a drain), how strong its silver threads
 *  are, how much of them the moon's own disc hides, and how far from a
 *  layer's heart its threads have faded in (so no layer shows an eye). */
export const TEMPLE_FILM_LOOK = { twist: 0.8, threads: 0.8, moonVeil: 0.8, calm: 1.8 } as const;

/**
 * The phase a layer's threads are drawn on at a point `(qx, qy)` from the
 * layer's heart: the SAME expression the fragment shader takes the sine of
 * (before its noise warp). Whole arms make it differ by a whole number of
 * turns across the angle's wrap.
 */
export function templeFilmWhirl(layer: number, qx: number, qy: number, time: number): number {
  const [, spin, grain, arms] = TEMPLE_FILM_LAYERS[layer];
  const r = Math.hypot(qx, qy);
  const ang = Math.atan2(qy, qx) + spin * time + TEMPLE_FILM_LOOK.twist * Math.log(r + 0.35);
  return arms * ang + r * grain * 6;
}

/** The moon seen deep in the film: its depth behind the plane, its radius,
 *  how far over the ring's centre it stands at the crest (`lift`) and how far
 *  under that it hangs at rest, and how bright it is at rest and how much the
 *  crest adds. The ring stands at the head of a climb, so every eye looks UP
 *  through it, and what lies behind a window sinks in it as the eye goes
 *  lower: a moon hung at the ring's own height, and deep, had dropped out of
 *  the ring's foot before the first tread. Hung over the centre and no deeper
 *  than this, it stands whole in the ring from the far shore to the dais, for
 *  a walker's own eye and for the camera that follows a character. */
export const TEMPLE_FILM_MOON = {
  depth: 5,
  radius: 2.1,
  restDrop: 1.6,
  lift: 3.1,
  rest: 0.58,
  crest: 0.7,
} as const;

export function templeFilmMoonHeight(crest: number): number {
  const m = TEMPLE_FILM_MOON;
  return TEMPLE_GATE.centre + m.lift - m.restDrop * (1 - crest);
}

/**
 * Where the film's moon stands in the ring's mouth for an eye (door-local, y
 * above the door's terrain height): its centre's offset from the ring's
 * centre. The SAME projection the fragment shader runs a fragment at a time
 * (its `slide` is the eye's ray through that fragment): the point where the
 * line from the eye to the moon crosses the ring's plane. One limit: the
 * shader holds `slide` at a ray 0.14 off the plane (about eight degrees), so
 * for an eye grazing the film its moon stops sliding and this does not.
 */
export function templeFilmMoonSeen(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  crest: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const depth = TEMPLE_FILM_MOON.depth;
  const away = Math.abs(eyeZ);
  const k = away + depth;
  out.x = (eyeX * depth) / k;
  out.y =
    ((eyeY - TEMPLE_GATE.centre) * depth +
      (templeFilmMoonHeight(crest) - TEMPLE_GATE.centre) * away) /
    k;
  return out;
}

/** The film's own brightness: it never goes out (it must read at noon from
 *  across the mere) and blazes at the crest. */
export function templeFilmLight(crest: number): number {
  return 0.6 + 0.45 * crest;
}

export type TempleMirrorSight = 'film' | 'ring' | 'sky';

/**
 * What a ray reflected off the mirror at (px, pz) sees: the gate's film, the
 * ring's stone, or the sky. The mirror's fragment shader runs the same test,
 * so the gate stands in the water as it would. (rx, ry, rz) is the reflected
 * direction, going up.
 */
export function templeMirrorSight(
  px: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
): TempleMirrorSight {
  if (rz <= 1e-4) return 'sky';
  const t = -pz / rz;
  const hx = px + rx * t;
  const hy = TEMPLE_GATE.water + ry * t;
  const r = Math.hypot(hx, hy - TEMPLE_GATE.centre);
  if (r < TEMPLE_GATE.inner && hy > TEMPLE_GATE.sill) return 'film';
  if (r < TEMPLE_GATE.outer && hy > TEMPLE_GATE.dais) return 'ring';
  return 'sky';
}

/** The mirror's grid as shared vertices: every cell corner once, and two
 *  triangles a cell (wound to face up). Positions are (lx, lz) pairs. */
export function templeMirrorGrid(
  cells: readonly number[] = templeMirrorCells(),
  step: number = TEMPLE_MIRROR_STEP,
): { positions: number[]; index: number[] } {
  const positions: number[] = [];
  const index: number[] = [];
  const seen = new Map<string, number>();
  const vertex = (x: number, z: number): number => {
    const key = `${Math.round(x * 100)},${Math.round(z * 100)}`;
    let i = seen.get(key);
    if (i === undefined) {
      i = positions.length / 2;
      positions.push(x, z);
      seen.set(key, i);
    }
    return i;
  };
  for (let c = 0; c + 1 < cells.length; c += 2) {
    const x = cells[c];
    const z = cells[c + 1];
    const a = vertex(x, z);
    const b = vertex(x + step, z);
    const d = vertex(x + step, z + step);
    const e = vertex(x, z + step);
    index.push(a, e, d, a, d, b);
  }
  return { positions, index };
}

/** Whether the mirror's water covers a point. */
export function templeMirrorCovers(
  lx: number,
  lz: number,
  runs: readonly (readonly [number, number, number])[] = TEMPLE_MIRROR_RUNS,
): boolean {
  const s = TEMPLE_MIRROR_STEP;
  for (const [z, x0, count] of runs) {
    if (lz >= z && lz < z + s && lx >= x0 && lx < x0 + count * s) return true;
  }
  return false;
}

// ---- the mist ----------------------------------------------------------------------

export interface TempleMistField {
  readonly name: string;
  /** Share of the puffs this field takes. */
  readonly share: number;
  /** Where its puffs are born (an ellipse rx by rz about ox, oz). */
  readonly ox: number;
  readonly oz: number;
  readonly rx: number;
  readonly rz: number;
  /** The drift over one life, and how far the lanes fan sideways along it. */
  readonly dx: number;
  readonly dz: number;
  readonly fan: number;
  /** Puff centre above what it lies on, and puff width. */
  readonly y: number;
  readonly size: number;
  /** How much of the moonrise's silver this field takes at the crest. */
  readonly lit: number;
}

/** The mist lies on the mirror and gathers at the drowned stair's foot; it
 *  hangs in the pit over what is left of the mere, spills over the weir, and
 *  a thin breath of it stands on the moon pool. */
export const TEMPLE_MIST_FIELDS: readonly TempleMistField[] = [
  {
    name: 'mirror',
    share: 0.32,
    ox: -7,
    oz: -20.5,
    rx: 12.5,
    rz: 6,
    dx: 2.4,
    dz: 1.2,
    fan: 2,
    y: 0.42,
    size: 4.4,
    lit: 0.35,
  },
  {
    name: 'foot',
    share: 0.22,
    ox: 0,
    oz: -16.2,
    rx: 5.5,
    rz: 2.2,
    dx: 0.4,
    dz: 3.2,
    fan: 3,
    y: 0.4,
    size: 3.4,
    lit: 1,
  },
  {
    name: 'pit',
    share: 0.2,
    ox: 9,
    oz: -30,
    rx: 7,
    rz: 5,
    dx: -2.2,
    dz: -1.6,
    fan: 0,
    y: 0.6,
    size: 4.6,
    lit: 0.1,
  },
  {
    name: 'weir',
    share: 0.12,
    ox: -8,
    oz: -29.6,
    rx: 9,
    rz: 1.2,
    dx: 0.6,
    dz: -3,
    fan: 2,
    y: 0.5,
    size: 3.6,
    lit: 0.15,
  },
  {
    name: 'pool',
    share: 0.14,
    ox: 0,
    oz: 13.6,
    rx: 3,
    rz: 3,
    dx: 1.4,
    dz: 0.8,
    fan: 0,
    y: 0.5,
    size: 2.8,
    lit: 0.9,
  },
];

/** Puff count by the static effects tier (never the FPS governor). */
export function templeMistPuffCount(tier: TempleEffectsTier): number {
  return [16, 28, 42, 56][tierRank(tier)];
}

/** What a puff lies on at a point: the mirror's water where it covers the
 *  shelf, the old mere's own level down in the pit, else the ground. */
export function templeMistSurface(lx: number, lz: number, ground: number): number {
  if (templeMirrorCovers(lx, lz)) return Math.max(ground, TEMPLE_GATE.water);
  if (lz > 6)
    return Math.max(
      ground,
      TEMPLE_POOL.water - 0.3 * clamp01(Math.hypot(lx - TEMPLE_POOL.lx, lz - TEMPLE_POOL.lz) - 3),
    );
  return ground;
}

export interface TempleMistPuff {
  /** The field it belongs to (an index into TEMPLE_MIST_FIELDS). */
  field: number;
  /** Birth place and drift over one life (door-local). */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  /** Life-cycle offset in [0, 1) and life cycles per second. */
  phase: number;
  speed: number;
  /** Width in yards at birth, centre height above its surface, the moonrise's share. */
  size: number;
  y: number;
  lit: number;
}

/** A puff's fixed parameters: golden-ratio spreads, no random stream. */
export function templeMistPuff(index: number, count: number): TempleMistPuff {
  const u = (index + 0.5) / Math.max(1, count);
  let field = 0;
  let acc = 0;
  for (let i = 0; i < TEMPLE_MIST_FIELDS.length; i++) {
    acc += TEMPLE_MIST_FIELDS[i].share;
    field = i;
    if (u < acc) break;
  }
  const f = TEMPLE_MIST_FIELDS[field];
  const g = fract(index * 0.61803398875 + 0.13);
  const h = fract(index * 0.75487766625 + 0.31);
  const k = fract(index * 0.56984029099 + 0.57);
  const angle = g * TAU;
  const radius = Math.sqrt(h);
  const lane = k * 2 - 1;
  return {
    field,
    ox: f.ox + Math.cos(angle) * radius * f.rx,
    oz: f.oz + Math.sin(angle) * radius * f.rz,
    dx: f.dx + lane * f.fan,
    dz: f.dz,
    phase: fract(index * 0.38196601125 + 0.07),
    speed: 0.022 + g * 0.018,
    size: f.size * (0.8 + k * 0.45),
    y: f.y,
    lit: f.lit,
  };
}

export interface TempleMistPose {
  x: number;
  /** Life fraction in [0, 1): the painter rides the surface between the
   *  puff's birth and its end by it. */
  t: number;
  z: number;
  /** Billboard width in yards (the height is 0.42 of it). */
  scale: number;
  alpha: number;
}

/** Where a puff is at a time: the painter's vertex shader runs the same
 *  formula. motion 0 (reduced motion) freezes every puff at its own phase. */
export function templeMistPose(
  puff: TempleMistPuff,
  time: number,
  motion: number,
  out: TempleMistPose,
): TempleMistPose {
  const t = fract(puff.phase + time * puff.speed * motion);
  out.t = t;
  out.x = puff.ox + puff.dx * t + Math.sin(time * 0.17 * motion + puff.phase * TAU) * 0.4;
  out.z = puff.oz + puff.dz * t;
  out.scale = puff.size * (0.75 + 0.8 * t);
  out.alpha = smoothstep(0, 0.2, t) * (1 - smoothstep(0.6, 1, t));
  return out;
}

/** The mist's strength by time of day: it must read at noon from across the
 *  mere, and thickens after dark. */
export function templeMistStrength(night: number): number {
  return 0.6 + 0.4 * night;
}

// ---- the additive sprites ------------------------------------------------------------

export const TEMPLE_SPRITE_KIND = {
  /** The halo on a live inlay: it burns as the moonrise reaches its order. */
  halo: 0,
  /** The flare cradled between the horns at the crest. */
  flare: 1,
  /** The pale shaft that stands over the gate at the crest. */
  shaft: 2,
  /** A mote of light rising off the water or the stair. */
  mote: 3,
  /** A glint on wet stone. */
  glint: 4,
  /** A thread of water falling from a notch of the weir. */
  fall: 5,
  /** The foam where it lands (lies on the ground). */
  foam: 6,
  /** The soft light standing over the pool, and in the gate's mouth. */
  glow: 7,
} as const;
export type TempleSpriteKind = (typeof TEMPLE_SPRITE_KIND)[keyof typeof TEMPLE_SPRITE_KIND];

export interface TempleSprite {
  kind: TempleSpriteKind;
  x: number;
  y: number;
  z: number;
  /** Billboard size in yards (a shaft's width at its foot). */
  size: number;
  phase: number;
  speed: number;
  /** Kind-specific: a halo's order in the moonrise, a shaft's length, a
   *  mote's climb, a fall's height, a glow's share that stands at rest. */
  range: number;
  /** A shaft's or a fall's direction; a foam's ground slope (dy/dx, 0, dy/dz). */
  dx: number;
  dy: number;
  dz: number;
  /** A shaft's width at its tip; a fall's spread across its notch. */
  spread: number;
  /** The fading unit it hangs on (its place in TEMPLE_GHOST_SETS plus one), so
   *  it goes with that unit when the camera ghosts it; 0 hangs on none. */
  hung: number;
}

// The works are ONE fading unit though they stand in two places, the weir
// south of the mirror and the pool's kerb and stelae north of the gate: a
// camera that ghosts a stela also takes the weir's falls, foam and glints some
// forty yards behind it, and the other way round. A fifth set was not worth
// it: the two are never on screen in one occlusion (the gate and the whole
// flight lie between them), and each set is another veil, another fade record
// and another program probe for nothing a player could see.
const HUNG = { none: 0, gate: 1, works: 4 } as const;
/** The halo lists templeSprites takes, in order: the stair's treads never
 *  ghost, the ring's runes are the gate's, the pool's kerb is the works'. */
const RUNE_LIST_HUNG = [HUNG.none, HUNG.gate, HUNG.works] as const;
/** South of this (lz) a glint lies on the weir's coping, not on a wet tread. */
const WEIR_GLINTS_SOUTH_OF = -15.3;

/** Where the motes rise: over the mirror round the stair's foot, up the
 *  flight, round the gate and over the pool (door-local boxes, base height). */
export const TEMPLE_MOTE_FIELDS: readonly {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}[] = [
  { x0: -9, x1: 9, z0: -22, z1: -14, y: TEMPLE_GATE.water + 0.2 },
  { x0: -3, x1: 3, z0: -13, z1: -3, y: -3 },
  { x0: -5, x1: 5, z0: -2.4, z1: -0.6, y: TEMPLE_GATE.dais + 0.3 },
  { x0: -3, x1: 3, z0: 10.8, z1: 16.4, y: TEMPLE_POOL.water + 0.2 },
];

/**
 * The sprite list of a tier. `ground(lx, lz)` is the terrain above the door's
 * own height (the painter passes the sim's terrainHeight). The door's own cues
 * (every inlay's halo, the flare, the shaft, the glow in the gate's mouth)
 * draw on every tier; the tier thins the motes, the glints and the falls and
 * drops the wide outer shaft and the pool's glow on low.
 */
export function templeSprites(
  tier: TempleEffectsTier,
  ground: (lx: number, lz: number) => number,
  runes: readonly (readonly TempleRune[])[] = [
    TEMPLE_STAIR_RUNES,
    TEMPLE_RING_RUNES,
    TEMPLE_POOL_RUNES,
  ],
  glints: readonly (readonly [number, number, number])[] = TEMPLE_GLINTS,
  falls: readonly TempleFall[] = TEMPLE_FALLS,
): TempleSprite[] {
  const rank = tierRank(tier);
  const K = TEMPLE_SPRITE_KIND;
  const out: TempleSprite[] = [];
  const base = { phase: 0, speed: 1, range: 0, dx: 0, dy: 0, dz: 0, spread: 0, hung: HUNG.none };
  let n = 0;
  for (let li = 0; li < runes.length; li++) {
    for (const [x, y, z, order, radius] of runes[li]) {
      out.push({
        ...base,
        kind: K.halo,
        hung: RUNE_LIST_HUNG[li] ?? HUNG.none,
        x,
        y: y + 0.05,
        z: z - 0.05,
        size: radius * 5.5,
        range: order,
        phase: fract(n++ * 0.61803398875),
      });
    }
  }
  const g = TEMPLE_GATE;
  // the gate's mouth never goes dark, and the horns cradle the flare
  out.push({
    ...base,
    kind: K.glow,
    hung: HUNG.gate,
    x: 0,
    y: g.centre,
    z: -1.1,
    size: 13,
    range: 0.4,
    phase: 0.2,
  });
  out.push({
    ...base,
    kind: K.flare,
    hung: HUNG.gate,
    x: 0,
    y: g.centre + g.outer + 2.1,
    z: 0,
    size: 6.5,
    phase: 0.5,
  });
  out.push({
    ...base,
    kind: K.shaft,
    hung: HUNG.gate,
    x: 0,
    y: g.centre + g.outer + 0.6,
    z: 0,
    size: 1.5,
    spread: 3.4,
    range: 26,
    dy: 1,
  });
  if (rank > 0) {
    out.push({
      ...base,
      kind: K.shaft,
      hung: HUNG.gate,
      x: 0,
      y: g.centre + g.outer + 0.2,
      z: 0,
      size: 3.6,
      spread: 9,
      range: 20,
      dy: 1,
      phase: 0.5,
    });
    out.push({
      ...base,
      kind: K.glow,
      x: TEMPLE_POOL.lx,
      y: TEMPLE_POOL.water + 1.4,
      z: TEMPLE_POOL.lz,
      size: 8.5,
      range: 0.25,
      phase: 0.7,
    });
  }
  const motes = [8, 16, 24, 32][rank];
  for (let i = 0; i < motes; i++) {
    const f = TEMPLE_MOTE_FIELDS[i % TEMPLE_MOTE_FIELDS.length];
    const x = f.x0 + fract(i * 0.61803398875 + 0.27) * (f.x1 - f.x0);
    const z = f.z0 + fract(i * 0.75487766625 + 0.44) * (f.z1 - f.z0);
    out.push({
      ...base,
      kind: K.mote,
      x,
      y: Math.max(f.y, ground(x, z) + 0.2),
      z,
      size: 0.08 + fract(i * 0.56984029099) * 0.06,
      phase: fract(i * 0.56984029099 + 0.71),
      speed: 0.06 + fract(i * 0.61803398875 + 0.9) * 0.05,
      range: 2.4 + fract(i * 0.38196601125) * 2.2,
    });
  }
  const step = rank === 0 ? 3 : rank === 1 ? 2 : 1;
  for (let i = 0; i < glints.length; i += step) {
    const [x, y, z] = glints[i];
    out.push({
      ...base,
      kind: K.glint,
      hung: z < WEIR_GLINTS_SOUTH_OF ? HUNG.works : HUNG.none,
      x,
      y: y + 0.03,
      z,
      size: 0.34,
      phase: fract(i * 0.61803398875 + 0.37),
      speed: 0.55 + fract(i * 0.75487766625) * 0.6,
    });
  }
  const threads = [3, 5, 7, 9][rank];
  for (const [x, y, z, fall, nx, nz, width] of falls) {
    for (let i = 0; i < threads; i++) {
      out.push({
        ...base,
        kind: K.fall,
        hung: HUNG.works,
        x,
        y,
        z,
        size: 0.09,
        phase: fract(i * 0.61803398875 + 0.11),
        speed: 0.85 + fract(i * 0.75487766625) * 0.5,
        range: fall,
        dx: nx,
        dz: nz,
        spread: (fract(i * 0.38196601125 + 0.3) - 0.5) * width,
      });
    }
    const fx = x + nx * 0.35;
    const fz = z + nz * 0.35;
    out.push({
      ...base,
      kind: K.foam,
      hung: HUNG.works,
      x: fx,
      y: y - fall + 0.1,
      z: fz,
      size: width * 1.7,
      phase: fract(x * 0.37),
      dx: (ground(fx + 0.4, fz) - ground(fx - 0.4, fz)) / 0.8,
      dz: (ground(fx, fz + 0.4) - ground(fx, fz - 0.4)) / 0.8,
    });
  }
  return out;
}

export interface TempleSpritePose {
  x: number;
  y: number;
  z: number;
  alpha: number;
}

/**
 * Where a point-like sprite is and how bright (the shafts are placed by their
 * own axis in the shader): the painter's vertex shader runs the same formula.
 * night in [0, 1] (templeNightAmount), motion 1 or 0, rise the moonrise of the
 * same instant.
 */
export function templeSpritePose(
  s: TempleSprite,
  time: number,
  night: number,
  motion: number,
  rise: TempleMoonrise,
  out: TempleSpritePose,
): TempleSpritePose {
  const K = TEMPLE_SPRITE_KIND;
  const tm = time * motion;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.alpha = 1;
  switch (s.kind) {
    case K.halo:
      out.alpha = templeRuneGlow(s.range, rise) * (0.3 + 0.7 * night);
      break;
    case K.flare:
      out.alpha = (0.06 + 0.94 * rise.crest) * (0.5 + 0.5 * night);
      break;
    case K.shaft:
      out.alpha = rise.crest * rise.crest * (0.45 + 0.55 * night);
      break;
    case K.glow:
      out.alpha = (s.range + (1 - s.range) * rise.crest) * (0.45 + 0.55 * night);
      break;
    case K.mote: {
      const t = fract(s.phase + tm * s.speed);
      out.y = s.y + s.range * t;
      out.x = s.x + Math.sin(tm * 0.4 + s.phase * TAU) * 0.35;
      out.alpha = smoothstep(0, 0.15, t) * (1 - smoothstep(0.6, 1, t)) * (0.3 + 0.7 * night);
      break;
    }
    case K.glint: {
      const w = Math.max(0, Math.sin(tm * s.speed + s.phase * TAU));
      out.alpha = w ** 10 * (0.75 + 0.25 * night);
      break;
    }
    case K.fall: {
      const t = fract(s.phase + tm * s.speed);
      out.x = s.x - s.dz * s.spread + s.dx * 0.25 * t;
      out.z = s.z + s.dx * s.spread + s.dz * 0.25 * t;
      out.y = s.y - s.range * t * t;
      out.alpha = 0.55 * (1 - smoothstep(0.8, 1, t));
      break;
    }
    default:
      out.alpha = 0.3 + 0.1 * Math.sin(tm * 1.7 + s.phase * TAU);
  }
  return out;
}
