// The Jaguar Maw's cosmetic plan (pure, Three-free): the Wildheart Basin's
// world entrance (door (-237, 1093), the Palmreach). ONE clock drives
// everything: the idol's breath. Once a cycle the jaguar spirit behind the
// stone roars without a sound: jade fire takes in the two eyes, the black
// water in the throat lights, a jade breath pours out of the maw and down the
// causeway, the two fire bowls burn jade for a second and the fireflies scatter.
// Between breaths the idol only smoulders.
//
// This module holds: that clock, the virtual flooded throat the door's window
// shader traces (so the water, the rock, the hanging roots and the light at
// its far end keep true parallax), the mist's puffs, and the additive sprites
// (the eyes' glow, their shafts and their flames, the maw's shafts and glow,
// the fire bowls' flames, the drips off the fangs and their rings, the
// fireflies, the glow on the wet steps). src/render/wildheart_basin_entrance.ts
// is the thin painter and its shaders evaluate THESE formulas on the GPU.
// Every value is door-local: lx = x - door.x (+x WEST), lz = z - door.z (+z
// NORTH), y above the door's terrain height. Cosmetic only: nothing here is a
// telegraph, the door stays a click box and a nameplate on every tier, and the
// effects tier only thins the mist, the drips and the fireflies.
import { globalDayness } from './day_night_core';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';

/** The static effects tier (src/game/ui_effects_profile.ts resolves it). */
export type WildheartEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

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

function tierRank(tier: WildheartEffectsTier): number {
  return tier === 'low' ? 0 : tier === 'medium' ? 1 : tier === 'high' ? 2 : 3;
}

/** How much of the night shows at a day/night phase: 0 through the day,
 *  rising through dusk, 1 at night. */
export function wildheartNightAmount(phase: number): number {
  return smoothstep(0, 1, (0.62 - globalDayness(phase)) / 0.5);
}

// ---- the idol's breath -----------------------------------------------------------

export const WILDHEART_BREATH = {
  /** Seconds a breath. */
  period: 16,
  /** The roar's crest (seconds into the cycle), how long the fire takes to
   *  catch before it and how slowly it dies after. */
  crest: 3,
  attack: 1.3,
  decay: 2,
  /** What the idol holds between breaths, and its slow smoulder. */
  rest: 0.1,
  smoulder: 0.035,
  /** The still value under reduced motion. */
  still: 0.4,
} as const;

/**
 * How much of the jaguar spirit's jade stands in the idol at a time, 0 to 1:
 * a low smouldering rest and one crest a breath, quick to catch and slow to
 * die. The throat, the eyes, the maw's shafts, the mist's glow, the fire bowls
 * and the point light all read this one value (the shaders run the same
 * formula). motion 0 (reduced motion) holds it still.
 */
export function wildheartBreathPulse(time: number, motion: number): number {
  const b = WILDHEART_BREATH;
  const tm = time * motion;
  const ph = fract(tm / b.period) * b.period;
  const shape =
    ph < b.crest
      ? smoothstep(b.crest - b.attack, b.crest, ph)
      : Math.exp(-(ph - b.crest) / b.decay);
  const rest = b.rest + b.smoulder * Math.sin(tm * 0.7);
  const live = rest + (1 - rest) * shape;
  return b.still + (live - b.still) * motion;
}

/** Which fading unit a collider row of the set piece belongs to
 *  (set_piece_occluders.ts): the idol with everything on it, or the court
 *  before it (the fire bowls, the tusks, the fallen ear), which ghosts on its
 *  own. Every row belongs to one, so every solid is an occluder. */
export function wildheartOccluderSet(rowName: string): 'idol' | 'court' {
  return rowName === 'head' || rowName.startsWith('muzzle_') ? 'idol' : 'court';
}

/** The idol's highest stone over the door (yards): the tips of its ears,
 *  after its lean. The skull's crown is at 17.2. */
export const WILDHEART_EAR_TOP = 19.6;

/** The top of a collider row's occluder box, over the door. The head's row
 *  stops at the sim's own camera top, which is under the crown and the ears:
 *  a camera drawn back over the head would sit among them with nothing
 *  ghosted. So the head's BOX (never its collider) reaches the ears' tips;
 *  every other row keeps its own top. */
export function wildheartOccluderTop(rowName: string, top: number): number {
  return rowName === 'head' ? Math.max(top, WILDHEART_EAR_TOP) : top;
}

/** The idol's stone that no collider row stands under, as occluder boxes of
 *  the render's own (door-local yards: x west, z north, heights over the
 *  door). Over head height the skull is carved wider than its foot and the
 *  upper jaw hangs out over the way in, so the rows' footprints alone would
 *  leave a camera drawn back under the jaw or beside a cheek inside stone
 *  with nothing ghosted. Each box begins at its `baseY`: a sight line under
 *  the jaw, the plain view of someone walking in, passes. Pinned against the
 *  shipped idol in tests/wildheart_basin_entrance_asset.test.ts. */
export const WILDHEART_OVERHANG_SOLIDS = [
  { name: 'jaw', lx: 0.33, lz: -2.41, hw: 10.92, hd: 3.17, baseY: 4.8, topY: 17.3 },
  { name: 'skull', lx: 0.33, lz: 9.88, hw: 10.92, hd: 9.13, baseY: 4, topY: WILDHEART_EAR_TOP },
] as const;

/** How much of the flooded throat shows for the alpha the idol is drawn at
 *  (the registry's onFade): all of it while the idol is solid, none once the
 *  idol is the camera's ghost, so no lit window is left standing in the air
 *  where the maw was; it returns with the stone. */
export function wildheartThroatGhostFade(alpha: number): number {
  if (!(alpha < 1)) return 1;
  const t = (alpha - OCCLUDER_FADE_ALPHA) / (1 - OCCLUDER_FADE_ALPHA);
  return t <= 0 ? 0 : t;
}

/** The idol leans (the Blender build's LEAN): its crown toward the WEST
 *  (roll) and SOUTH over the causeway (pitch), radians. The throat's window
 *  leans with it. */
export const WILDHEART_LEAN = { roll: 0.04363, pitch: 0.03491 } as const;

/** The point lights (fire-light sink sources, like every world glow light):
 *  the jade in the maw, whose base intensity follows the breath, and the two
 *  fire bowls beside the maw. */
export const WILDHEART_MAW_LIGHT = {
  lx: 0,
  y: 2.1,
  lz: -1.1,
  color: 0x5fe0a0,
  rest: 1.4,
  crest: 11,
  distance: 17,
} as const;

export function wildheartMawLightIntensity(pulse: number): number {
  return WILDHEART_MAW_LIGHT.rest + (WILDHEART_MAW_LIGHT.crest - WILDHEART_MAW_LIGHT.rest) * pulse;
}

/** The fire bowls' coals (lx, y, lz), from the Blender build's stats.json. */
export const WILDHEART_BRAZIERS: readonly (readonly [number, number, number])[] = [
  [4.4, 1.214, -3.4],
  [-4.4, 1.214, -3.4],
];

export const WILDHEART_BRAZIER_LIGHT = {
  color: 0xff9a4d,
  intensity: 5.5,
  distance: 13,
  rise: 0.7,
} as const;

// ---- the flooded throat behind the door ------------------------------------------
//
// The player never walks past the door (the walk-in trigger takes them on the
// last steps) and the knoll behind the idol cannot be cut, so the throat is
// drawn INSIDE one flat window that fills the maw behind the fangs: its shader
// traces each view ray against a virtual rock-cut throat standing in its own
// black water, with a curtain of the fig's roots hanging part way
// down it and the basin's light at its far end. Rays that meet the water are
// reflected and traced once more, so the far light lies on the ripples.

export const WILDHEART_THROAT = {
  /** Half width of the throat at the window. */
  half: 2.5,
  /** The window's plane (lz), inside the lips behind the fangs. */
  z: 1.3,
  /** The last flagstone's top, the water standing just under it (the
   *  throat holds its own: the lagoon lies six yards below the door). */
  kerb: 0.33,
  water: -0.07,
  /** The vault: springing, and a round barrel of the throat's own half width. */
  spring: 3.6,
  /** The far end, where the light is. */
  far: 30,
  /** The hanging roots: their plane, their pitch and half thickness, and how
   *  far the shortest and the longest hang from the vault. */
  roots: 8,
  rootPitch: 0.62,
  rootHalf: 0.07,
  rootMin: 1.1,
  rootVar: 3.4,
  /** The window mesh reaches this far into the masonry round the opening. */
  margin: 0.3,
  /** The eye the throat is drawn for never stands lower than this over the
   *  kerb, so the waterline always shows across the window's lower third. */
  eye: 1.25,
  /** The far light's level between breaths, by day and by night: the basin's
   *  own daylight coming down the throat, a memory of it after dark. */
  restDay: 0.16,
  restNight: 0.06,
} as const;

/** The height (door-local) the throat's rays are cast from for a camera at camY. */
export function wildheartThroatEye(camY: number): number {
  return Math.max(camY, WILDHEART_THROAT.kerb + WILDHEART_THROAT.eye);
}

/** How bright the basin's own light stands at the throat's far end between
 *  breaths, for a night amount. */
export function wildheartThroatRest(night: number): number {
  const t = WILDHEART_THROAT;
  return t.restDay + (t.restNight - t.restDay) * night;
}

export type WildheartThroatHitKind = 'water' | 'wall' | 'vault' | 'far' | 'roots';

export interface WildheartThroatHit {
  kind: WildheartThroatHitKind;
  /** Ray parameter of the hit (yards, the direction is unit). */
  t: number;
  x: number;
  y: number;
  z: number;
}

/** A root's own number in [0, 1) (its length and thickness come from it). */
export function wildheartRootHash(index: number): number {
  return fract(Math.sin(index * 12.9898) * 43758.5453);
}

/** Whether a point of the root curtain's plane is a root or open air. */
export function wildheartRootSolid(x: number, y: number): boolean {
  const t = WILDHEART_THROAT;
  const i = Math.floor(x / t.rootPitch + 0.5);
  const h = wildheartRootHash(i);
  const vault = t.spring + Math.sqrt(Math.max(t.half * t.half - x * x, 0));
  if (y < vault - (t.rootMin + t.rootVar * h)) return false;
  const centre = (i + (h - 0.5) * 0.5) * t.rootPitch + 0.06 * Math.sin(y * 1.7 + i);
  return Math.abs(x - centre) < t.rootHalf * (0.6 + 0.8 * h);
}

/**
 * Trace a ray (origin inside the throat's section, unit direction,
 * door-local) against the virtual throat: the SAME test the window's fragment
 * shader runs. `water` false is the reflected ray's trace (it left the surface
 * going up).
 */
export function wildheartThroatTrace(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  water: boolean,
  out: WildheartThroatHit,
): WildheartThroatHit {
  const p = WILDHEART_THROAT;
  let best = 1e5;
  let kind: WildheartThroatHitKind = 'far';
  if (dz > 1e-4) best = (p.far - oz) / dz;
  if (Math.abs(dx) > 1e-4) {
    const t = ((dx > 0 ? p.half : -p.half) - ox) / dx;
    if (t > 0 && t < best && oy + dy * t <= p.spring) {
      best = t;
      kind = 'wall';
    }
  }
  const a = dx * dx + dy * dy;
  if (a > 1e-6) {
    const b = ox * dx + (oy - p.spring) * dy;
    const c = ox * ox + (oy - p.spring) * (oy - p.spring) - p.half * p.half;
    const disc = b * b - a * c;
    if (disc > 0) {
      const t = (-b + Math.sqrt(disc)) / a;
      if (t > 0 && t < best && oy + dy * t >= p.spring) {
        best = t;
        kind = 'vault';
      }
    }
  }
  if (water && dy < -1e-4) {
    const t = (p.water - oy) / dy;
    if (t > 0 && t < best) {
      best = t;
      kind = 'water';
    }
  }
  if (dz > 1e-4) {
    const t = (p.roots - oz) / dz;
    if (t > 0 && t < best && wildheartRootSolid(ox + dx * t, oy + dy * t)) {
      best = t;
      kind = 'roots';
    }
  }
  out.kind = kind;
  out.t = best;
  out.x = ox + dx * best;
  out.y = oy + dy * best;
  out.z = oz + dz * best;
  return out;
}

/** The far light on a surface of the throat, by how far it lies from the far
 *  end: full at the light, a memory at the door. */
export function wildheartThroatGlow(z: number, light: number): number {
  const d = WILDHEART_THROAT.far - z;
  return (light * 1.6) / (1 + 0.006 * d * d);
}

// ---- the mist --------------------------------------------------------------------

export interface WildheartMistField {
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
  /** Puff centre above the ground (or the lagoon), and puff width. */
  readonly y: number;
  readonly size: number;
  /** How much of the breath's jade this field takes at the crest. */
  readonly lit: number;
}

/** The idol's breath pours out of the maw and down the causeway (its foot
 *  swings east); thinner banks lie on the bank under its west cheek, on the
 *  lagoon behind it, at the bank's foot below the west fire bowl and in the
 *  lee of the knoll. None of it drifts into the ring of columns to the east. */
export const WILDHEART_MIST_FIELDS: readonly WildheartMistField[] = [
  {
    name: 'maw',
    share: 0.36,
    ox: 0,
    oz: -0.4,
    rx: 1.7,
    rz: 0.9,
    dx: -1,
    dz: -9.5,
    fan: 4,
    y: 0.6,
    size: 3.2,
    lit: 1,
  },
  {
    name: 'west_bank',
    share: 0.22,
    ox: 11,
    oz: 5,
    rx: 3.5,
    rz: 5,
    dx: 3.5,
    dz: 2,
    fan: 0,
    y: 0.45,
    size: 3.9,
    lit: 0.25,
  },
  {
    name: 'back_water',
    share: 0.18,
    ox: 5,
    oz: 22,
    rx: 8,
    rz: 2.5,
    dx: 2.5,
    dz: 3,
    fan: 0,
    y: 0.45,
    size: 4.1,
    lit: 0.1,
  },
  {
    name: 'knoll_lee',
    share: 0.14,
    ox: -9.5,
    oz: 13,
    rx: 3,
    rz: 3,
    dx: -2,
    dz: 2.2,
    fan: 0,
    y: 0.5,
    size: 3.3,
    lit: 0.3,
  },
  {
    name: 'bank_foot',
    share: 0.1,
    ox: 7,
    oz: -3,
    rx: 2.4,
    rz: 1.5,
    dx: 2.5,
    dz: -2.6,
    fan: 0,
    y: 0.45,
    size: 3.2,
    lit: 0.6,
  },
];

/** Puff count by the static effects tier (never the FPS governor). */
export function wildheartMistPuffCount(tier: WildheartEffectsTier): number {
  return [18, 34, 52, 70][tierRank(tier)];
}

export interface WildheartMistPuff {
  /** The field it belongs to (an index into WILDHEART_MIST_FIELDS). */
  field: number;
  /** Birth place and drift over one life (door-local). */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  /** Life-cycle offset in [0, 1) and life cycles per second. */
  phase: number;
  speed: number;
  /** Width in yards at birth, centre height above the ground, the breath's share. */
  size: number;
  y: number;
  lit: number;
}

/** A puff's fixed parameters: golden-ratio spreads, no random stream. */
export function wildheartMistPuff(index: number, count: number): WildheartMistPuff {
  const u = (index + 0.5) / Math.max(1, count);
  let field = 0;
  let acc = 0;
  for (let i = 0; i < WILDHEART_MIST_FIELDS.length; i++) {
    acc += WILDHEART_MIST_FIELDS[i].share;
    field = i;
    if (u < acc) break;
  }
  const f = WILDHEART_MIST_FIELDS[field];
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
    speed: 0.03 + g * 0.024,
    size: f.size * (0.8 + k * 0.45),
    y: f.y,
    lit: f.lit,
  };
}

export interface WildheartMistPose {
  x: number;
  /** Life fraction in [0, 1): the painter rides the ground between the
   *  puff's birth and its end by it (the rise falls away from the door). */
  t: number;
  z: number;
  /** Billboard width in yards (the height is 0.46 of it). */
  scale: number;
  alpha: number;
}

/** Where a puff is at a time: the painter's vertex shader runs the same
 *  formula. motion 0 (reduced motion) freezes every puff at its own phase. */
export function wildheartMistPose(
  puff: WildheartMistPuff,
  time: number,
  motion: number,
  out: WildheartMistPose,
): WildheartMistPose {
  const t = fract(puff.phase + time * puff.speed * motion);
  out.t = t;
  out.x = puff.ox + puff.dx * t + Math.sin(time * 0.21 * motion + puff.phase * TAU) * 0.35;
  out.z = puff.oz + puff.dz * t;
  out.scale = puff.size * (0.7 + 1.0 * t);
  out.alpha = smoothstep(0, 0.16, t) * (1 - smoothstep(0.55, 1, t));
  return out;
}

/** A puff the camera stands in is not mist, it is a stack of full-screen
 *  quads: it thins from `full` yards of view depth down to nothing at `start`,
 *  where the painter also collapses its quad. */
export const WILDHEART_MIST_NEAR = { start: 3, full: 9 } as const;

export function wildheartMistNearFade(viewDepth: number): number {
  return smoothstep(WILDHEART_MIST_NEAR.start, WILDHEART_MIST_NEAR.full, viewDepth);
}

// ---- the additive sprites ----------------------------------------------------------

export const WILDHEART_SPRITE_KIND = {
  /** The jade in an eye: a soft disc that never quite goes out. */
  eyeGlow: 0,
  /** A shaft of an eye's light, falling toward the causeway on the breath. */
  eyeShaft: 1,
  /** The breath's light out of the maw, out over the causeway. */
  mawShaft: 2,
  /** A flame: in a fire bowl (always, jade on the breath) or licking up out
   *  of an eye (an ember between breaths). */
  flame: 3,
  /** A drop falling from a fang. */
  drip: 4,
  /** The ring where it lands (lies on the ground). */
  ring: 5,
  /** A firefly beside the causeway and over the bank after dusk. */
  firefly: 6,
  /** The jade pool on the wet steps inside the maw (lies on the ground). */
  pool: 7,
  /** A soft glow of the breath's light: in the maw behind the fangs. */
  glow: 8,
} as const;
export type WildheartSpriteKind =
  (typeof WILDHEART_SPRITE_KIND)[keyof typeof WILDHEART_SPRITE_KIND];

export interface WildheartSprite {
  kind: WildheartSpriteKind;
  x: number;
  y: number;
  z: number;
  /** Billboard size in yards (a shaft's or a flame's width at its foot). */
  size: number;
  phase: number;
  speed: number;
  /** Kind-specific reach: a drip's fall, a shaft's length, a flame's height,
   *  a firefly's wander, a glow's share of the night (0 the same by day, 1
   *  only after dark). */
  range: number;
  /** A shaft's direction, or a ground sprite's slope (dy/dx, 0, dy/dz); for a
   *  glow or a flame, dx is the share of it that stands between breaths, and a
   *  flame's dy is 1 when it hangs on the idol (it goes with the ghost). */
  dx: number;
  dy: number;
  dz: number;
  /** A shaft's width at its tip; a flame's jade (0 fire that turns jade on
   *  the breath, 1 always jade). */
  spread: number;
}

/** The two eyes (lx, y, lz), from the Blender build: a point in each socket,
 *  before the jade and under the brow that overhangs it. */
export const WILDHEART_EYES: readonly (readonly [number, number, number])[] = [
  [4.815, 10.594, -0.371],
  [-3.873, 10.973, -0.371],
];

/** The tips of the upper fangs (lx, y, lz), from the Blender build's
 *  stats.json: the drops fall from the ivory. The upper jaw hangs three yards
 *  out over the causeway, so they fall onto the flagstones before the maw
 *  (each drop's ring lies on the ground straight under its own tip). */
export const WILDHEART_DRIP_SOURCES: readonly (readonly [number, number, number])[] = [
  [2.596, 2.193, -4.233],
  [0.759, 5.681, -4.452],
  [1.661, 5.304, -4.44],
  [-2.395, 2.41, -4.233],
  [-0.261, 5.726, -4.452],
  [-1.192, 5.429, -4.44],
];

/** The maw's shafts: yaw off south (positive west), pitch (the causeway
 *  falls away from the door, so they lie near level, over a walker's head),
 *  length, width at the foot and at the tip, and the foot's lx. Uneven on
 *  purpose, fanned so whoever comes up the causeway sees them from the side. */
export const WILDHEART_MAW_SHAFTS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [-0.5, -0.12, 10, 1.2, 2.8, -0.9],
  [-0.24, 0.04, 12, 1.5, 3.4, -0.4],
  [0.02, -0.06, 9, 1.1, 2.6, 0.1],
  [0.26, 0.08, 11, 1.4, 3.2, 0.5],
  [0.5, -0.14, 8, 1.2, 2.8, 0.9],
];

/** Where the fireflies wander: the bank west of the causeway, the tusk at its
 *  east foot (clear of the ring of columns) and the bank under the idol's
 *  west cheek (door-local boxes). */
export const WILDHEART_FIREFLY_FIELDS: readonly {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}[] = [
  { x0: 3, x1: 14, z0: -12, z1: -2 },
  { x0: -7, x1: -3.5, z0: -17, z1: -10.5 },
  { x0: 9, x1: 17, z0: 0, z1: 12 },
];

/** Gravity of a falling drop, yards per second squared (it only has to look right). */
export const WILDHEART_DRIP_GRAVITY = 16;

/** The time a drop takes to fall `fall` yards. */
export function wildheartDripFallTime(fall: number): number {
  return Math.sqrt((2 * Math.max(0.05, fall)) / WILDHEART_DRIP_GRAVITY);
}

/**
 * The sprite list of a tier. `ground(lx, lz)` is the terrain, or the lagoon
 * where the terrain lies under it, above the door's own height (the painter
 * passes the sim's terrainHeight and WATER_LEVEL), so drops land, rings lie
 * and fireflies fly where the ground really is. The door's own cues (the eyes' glow
 * and flames, the maw's glow, pool and shafts, the fire bowls) draw on every
 * tier; the tier thins the drips and the fireflies and drops the eyes' shafts
 * on low.
 */
export function wildheartSprites(
  tier: WildheartEffectsTier,
  ground: (lx: number, lz: number) => number,
  drips: readonly (readonly [number, number, number])[] = WILDHEART_DRIP_SOURCES,
): WildheartSprite[] {
  const rank = tierRank(tier);
  const K = WILDHEART_SPRITE_KIND;
  const out: WildheartSprite[] = [];
  const base = { phase: 0, speed: 1, range: 0, dx: 0, dy: 0, dz: 0, spread: 0 };
  const slope = (lx: number, lz: number) => ({
    dx: (ground(lx + 0.4, lz) - ground(lx - 0.4, lz)) / 0.8,
    dz: (ground(lx, lz + 0.4) - ground(lx, lz - 0.4)) / 0.8,
  });
  WILDHEART_EYES.forEach(([x, y, z], i) => {
    const phase = fract(i * 0.61803398875 + 0.3);
    out.push({ ...base, kind: K.eyeGlow, x, y, z: z - 0.25, size: 3.4, phase });
    // the fire in the socket: five tongues licking up over the brow
    for (let k = 0; k < 5; k++) {
      const off = Math.abs(k - 2);
      out.push({
        ...base,
        kind: K.flame,
        x: x + (k - 2) * 0.42,
        y: y - 0.4,
        z: z - 0.45,
        size: 1.5 - 0.22 * off,
        range: 3.6 - 0.75 * off + (k % 2) * 0.5,
        phase: fract(phase + k * 0.38196601125),
        dx: 0.1,
        dy: 1,
        spread: 1,
      });
    }
    if (rank > 0) {
      // the eye's light on the breath, falling toward whoever stands on the causeway
      const dx = x * 0.05;
      const dy = -0.5;
      const dz = -0.85;
      const len = Math.hypot(dx, dy, dz);
      out.push({
        ...base,
        kind: K.eyeShaft,
        x,
        y,
        z: z - 0.4,
        size: 0.6,
        spread: 2.2,
        range: 6,
        dx: dx / len,
        dy: dy / len,
        dz: dz / len,
        phase,
      });
    }
  });
  // The maw: the glow behind the fangs and the jade on the wet steps.
  out.push({ ...base, kind: K.glow, x: 0, y: 2.6, z: -0.2, size: 7, phase: 0.1, range: 0.3 });
  out.push({
    ...base,
    kind: K.glow,
    x: 0,
    y: 1.6,
    z: 0.6,
    size: 5.4,
    phase: 0.4,
    range: 0.75,
    dx: 0.5,
  });
  const s0 = slope(0, -0.6);
  out.push({
    ...base,
    kind: K.pool,
    x: 0,
    y: ground(0, -0.6) + 0.22,
    z: -0.6,
    size: 4,
    dx: s0.dx,
    dz: s0.dz,
  });
  for (let i = 0; i < WILDHEART_MAW_SHAFTS.length; i++) {
    const [yaw, pitch, length, foot, tip, ox] = WILDHEART_MAW_SHAFTS[i];
    const cp = Math.cos(pitch);
    out.push({
      ...base,
      kind: K.mawShaft,
      x: ox,
      y: 1.9,
      z: 0.2,
      size: foot,
      spread: tip,
      range: length,
      dx: Math.sin(yaw) * cp,
      dy: Math.sin(pitch),
      dz: -Math.cos(yaw) * cp,
      phase: fract(i * 0.61803398875 + 0.2),
    });
  }
  // The fire bowls: three tongues each, always burning.
  WILDHEART_BRAZIERS.forEach(([x, y, z], i) => {
    for (let k = 0; k < 3; k++) {
      out.push({
        ...base,
        kind: K.flame,
        x: x + (k - 1) * 0.24,
        y: y - 0.1,
        z: z + (k === 1 ? 0 : 0.12),
        size: 0.5 - 0.12 * Math.abs(k - 1),
        range: 1.25 - 0.4 * Math.abs(k - 1),
        phase: fract(i * 0.5 + k * 0.38196601125 + 0.15),
        dx: 0.78,
      });
    }
  });
  // Drips: every other fang on low and medium, all of them above; each with its ring.
  const step = rank < 2 ? 2 : 1;
  for (let i = 0; i < drips.length; i += step) {
    const [x, y, z] = drips[i];
    const g = ground(x, z) + 0.2;
    const fall = Math.max(0.3, y - g);
    const phase = fract(i * 0.61803398875 + 0.37);
    const speed = 1 / (2.6 + fract(i * 0.75487766625) * 3.4);
    out.push({ ...base, kind: K.drip, x, y, z, size: 0.05, phase, speed, range: fall });
    const sl = slope(x, z);
    out.push({
      ...base,
      kind: K.ring,
      x,
      y: g,
      z,
      size: 0.8,
      phase,
      speed,
      range: fall,
      dx: sl.dx,
      dz: sl.dz,
    });
  }
  const flies = [0, 8, 14, 20][rank];
  for (let i = 0; i < flies; i++) {
    const f = WILDHEART_FIREFLY_FIELDS[i % WILDHEART_FIREFLY_FIELDS.length];
    const x = f.x0 + fract(i * 0.61803398875 + 0.27) * (f.x1 - f.x0);
    const z = f.z0 + fract(i * 0.75487766625 + 0.44) * (f.z1 - f.z0);
    out.push({
      ...base,
      kind: K.firefly,
      x,
      y: ground(x, z) + 0.8 + fract(i * 0.38196601125 + 0.6) * 1.6,
      z,
      size: 0.2 + fract(i * 0.56984029099) * 0.1,
      phase: fract(i * 0.56984029099 + 0.71),
      speed: 0.11 + fract(i * 0.61803398875 + 0.9) * 0.09,
      range: 1.5,
    });
  }
  return out;
}

export interface WildheartSpritePose {
  x: number;
  y: number;
  z: number;
  alpha: number;
}

/** How much of a flame stands for a breath pulse: its own share between
 *  breaths, all of it at the crest. */
export function wildheartFlamePower(rest: number, pulse: number): number {
  return rest + (1 - rest) * pulse * pulse;
}

/**
 * Where a point-like sprite is and how bright (the shafts are placed by their
 * own axis and the flames stand on their own base in the shader): the
 * painter's vertex shader runs the same formula. night in [0, 1]
 * (wildheartNightAmount), motion 1 or 0, pulse the breath pulse of the same
 * instant.
 */
export function wildheartSpritePose(
  s: WildheartSprite,
  time: number,
  night: number,
  motion: number,
  pulse: number,
  out: WildheartSpritePose,
): WildheartSpritePose {
  const K = WILDHEART_SPRITE_KIND;
  const tm = time * motion;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.alpha = 1;
  switch (s.kind) {
    case K.eyeGlow:
      out.alpha =
        (0.1 + 0.16 * night) * (0.86 + 0.14 * Math.sin(tm * 0.8 + s.phase * TAU)) +
        0.9 * pulse * pulse;
      break;
    case K.glow:
      out.alpha = (s.dx + (1 - s.dx) * pulse * pulse) * (1 + (night - 1) * s.range);
      break;
    case K.pool:
      out.alpha = pulse * (0.5 + 0.5 * night);
      break;
    case K.flame:
      out.alpha = wildheartFlamePower(s.dx, pulse);
      break;
    case K.drip: {
      const cycle = fract(s.phase + tm * s.speed) / s.speed;
      const fallTime = wildheartDripFallTime(s.range);
      const t = Math.min(cycle, fallTime);
      out.y = s.y - 0.5 * WILDHEART_DRIP_GRAVITY * t * t;
      out.alpha = cycle < fallTime ? 0.85 : 0;
      break;
    }
    case K.ring: {
      const cycle = fract(s.phase + tm * s.speed) / s.speed;
      const age = cycle - wildheartDripFallTime(s.range);
      out.alpha = age > 0 ? Math.exp(-age * 1.6) * (1 - smoothstep(1.2, 2.2, age)) : 0;
      break;
    }
    case K.firefly: {
      const a = tm * s.speed + s.phase * TAU;
      out.x = s.x + Math.sin(a) * s.range;
      out.y = s.y + Math.sin(a * 1.7 + s.phase * 9) * 0.35;
      out.z = s.z + Math.cos(a * 0.8 + s.phase * 4) * s.range;
      out.alpha = night * (0.55 + 0.45 * Math.sin(tm * 2.3 + s.phase * 11));
      break;
    }
    case K.eyeShaft:
      out.alpha = pulse * pulse * (0.35 + 0.65 * night);
      break;
    default:
      // the maw's shafts
      out.alpha = pulse * pulse * pulse * (0.55 + 0.45 * night);
  }
  return out;
}
