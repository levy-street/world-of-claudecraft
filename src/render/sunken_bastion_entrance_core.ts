// The Drowned Gate Tower's cosmetic plan (pure, Three-free): the Sunken
// Bastion's world entrance (door (45, 515), Mirefen Marsh). ONE clock drives
// everything: the Fogbeacon's turn. Somewhere inside the drowned keep the
// beacon still sweeps; once a turn its light comes down the flooded passage
// behind the door, and for a second the black water lights, a green shaft
// pours out through the portcullis bars, the fog on the causeway glows and
// the beam passes over the towers. Between turns the gate only breathes.
//
// This module holds: that clock, the virtual flooded passage the door's
// window shader traces (so the water, its walls, the drowned inner grille and
// the far light keep true parallax), the marsh fog's puffs, and the additive
// sprites (the rosette's pale core and its shafts, the gate shaft, the sky
// beam, the drips and their rings, the marsh lights, the glow on the wet
// threshold). src/render/sunken_bastion_entrance.ts is the thin painter and
// its shaders evaluate THESE formulas on the GPU. Every value is door-local:
// lx = x - door.x (+x WEST), lz = z - door.z (+z NORTH), y above the door's
// terrain height. Cosmetic only: nothing here is a telegraph, the door stays
// a click box and a nameplate on every tier, and the effects tier only thins
// the fog, the drips and the marsh lights.
import { globalDayness } from './day_night_core';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';

/** The static effects tier (src/game/ui_effects_profile.ts resolves it). */
export type BastionEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

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

function tierRank(tier: BastionEffectsTier): number {
  return tier === 'low' ? 0 : tier === 'medium' ? 1 : tier === 'high' ? 2 : 3;
}

/** How much of the night shows at a day/night phase: 0 through the day,
 *  rising through dusk, 1 at night. */
export function bastionNightAmount(phase: number): number {
  return smoothstep(0, 1, (0.62 - globalDayness(phase)) / 0.5);
}

// ---- the Fogbeacon's turn ---------------------------------------------------------

export const BASTION_BEACON = {
  /** Seconds a turn. */
  period: 14,
  /** Half width (radians of bearing) of the moment the light is in the gate. */
  gateWidth: 0.42,
  /** What the gate holds between turns, and its slow breath. */
  rest: 0.14,
  breath: 0.04,
  /** The still value under reduced motion. */
  still: 0.45,
  /** The sky beam's foot, hidden behind the knoll north of the gate, its
   *  climb, its reach and its width at foot and tip. */
  lx: -5,
  y: -4,
  lz: 44,
  pitch: 0.3,
  length: 170,
  width0: 1.6,
  width1: 9,
} as const;

/** The beam's bearing at a time (radians, 0 pointing SOUTH down the road at
 *  whoever climbs it, turning by way of the west). */
export function bastionBeaconBearing(time: number, motion: number): number {
  return TAU * fract((time * motion) / BASTION_BEACON.period);
}

/** The beam's unit direction (door-local x, y, z) at a bearing. */
export function bastionBeaconDirection(
  bearing: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const c = Math.cos(BASTION_BEACON.pitch);
  out.x = Math.sin(bearing) * c;
  out.y = Math.sin(BASTION_BEACON.pitch);
  out.z = -Math.cos(bearing) * c;
  return out;
}

/**
 * How much of the beacon's light stands in the gate at a time, 0 to 1: a low
 * breathing rest and one crest a turn, when the beam bears south down the
 * passage. The window, the gate shaft, the fog's glow, the threshold's pool and
 * the point light all read this one value (the shaders run the same formula).
 * motion 0 (reduced motion) holds it still.
 */
export function bastionGatePulse(time: number, motion: number): number {
  const b = BASTION_BEACON;
  const tm = time * motion;
  const turn = fract(tm / b.period);
  const d = Math.min(turn, 1 - turn) * TAU;
  const sweep = Math.exp(-(d * d) / (2 * b.gateWidth * b.gateWidth));
  const rest = b.rest + b.breath * Math.sin(tm * 0.7);
  const live = rest + (1 - rest) * sweep;
  return b.still + (live - b.still) * motion;
}

/** Which fading unit a collider row of the set piece belongs to
 *  (set_piece_occluders.ts): the gatehouse with everything on it, or the
 *  ruins round it (the curtain wall and the fallen blocks), which ghost on
 *  their own. Every row belongs to one, so every solid is an occluder. */
export function bastionOccluderSet(rowName: string): 'gate' | 'ruins' {
  return rowName.startsWith('curtain_') || rowName === 'fallen_stones' ? 'ruins' : 'gate';
}

/** How much of the flooded passage shows for the alpha the gatehouse is
 *  drawn at (the registry's onFade): all of it while the gate is solid, none
 *  once the gate is the camera's ghost, so no lit window is left standing in
 *  the air where the wall was; it returns with the wall. */
export function bastionPassageGhostFade(alpha: number): number {
  if (!(alpha < 1)) return 1;
  const t = (alpha - OCCLUDER_FADE_ALPHA) / (1 - OCCLUDER_FADE_ALPHA);
  return t <= 0 ? 0 : t;
}

/** The single point light: the beacon's green in the gate court, in front of
 *  the door (a fire-light sink source, like every world glow light). Its base
 *  intensity follows the pulse. */
export const BASTION_PULSE_LIGHT = {
  lx: 0,
  y: 1.9,
  lz: -0.75,
  color: 0x4dff9a,
  rest: 3,
  crest: 9.5,
  distance: 15,
} as const;

export function bastionPulseLightIntensity(pulse: number): number {
  return BASTION_PULSE_LIGHT.rest + (BASTION_PULSE_LIGHT.crest - BASTION_PULSE_LIGHT.rest) * pulse;
}

// ---- the flooded passage behind the door -----------------------------------------
//
// The player never walks past the door (the walk-in trigger takes them in the
// court) and the knoll behind it cannot be cut, so the passage is drawn INSIDE
// one flat window that fills the inner arch: its shader traces each view ray
// against a virtual barrel-vaulted passage standing in black water, with a
// second, drowned portcullis part way down it and the beacon's light at its
// far end. Rays that meet the water are reflected and traced once more, so
// the far light lies on the ripples the way it would.

export const BASTION_PASSAGE = {
  /** Half width of the passage (the door lane). */
  half: 1.25,
  /** The window's plane (lz), in the inner arch's reveal behind the sill. */
  z: 0.5,
  /** The flood sill's top, the water standing just under it. */
  kerb: 0.72,
  water: 0.55,
  /** The vault: springing, and a round barrel of the passage's own half width. */
  spring: 2.75,
  /** The far end, where the light is. */
  far: 34,
  /** The drowned grille: its plane, how far it stands out of the water, its
   *  crooked tilt, the bars' pitch and half thickness. */
  grille: 9.5,
  grilleRise: 1.75,
  grilleTilt: 0.12,
  barPitch: 0.42,
  barHalf: 0.055,
  /** The window mesh reaches this far into the masonry round the opening. */
  margin: 0.3,
  /** The eye the passage is drawn for never stands lower than this over the
   *  kerb: the door is at the top of a steep road, and from below the water
   *  would be hidden behind its own sill. A viewer under it sees the passage
   *  as if it ran a little downhill, with the waterline across its lower third. */
  eye: 1.25,
  /** The far light never goes out: its level between turns. */
  restGlow: 0.34,
} as const;

/** The height (door-local) the passage's rays are cast from for a camera at camY. */
export function bastionPassageEye(camY: number): number {
  return Math.max(camY, BASTION_PASSAGE.kerb + BASTION_PASSAGE.eye);
}

/** How bright the far light stands for a gate pulse: a steady dim glow at
 *  rest (the water always has something to mirror), full at the crest. */
export function bastionPassageLight(pulse: number): number {
  return BASTION_PASSAGE.restGlow + (1 - BASTION_PASSAGE.restGlow) * pulse;
}

export type BastionPassageHitKind = 'water' | 'wall' | 'vault' | 'far' | 'grille';

export interface BastionPassageHit {
  kind: BastionPassageHitKind;
  /** Ray parameter of the hit (yards, the direction is unit). */
  t: number;
  x: number;
  y: number;
  z: number;
}

/** Whether a point of the grille's plane is iron (a bar, a rail) or open. */
export function bastionGrilleSolid(x: number, y: number): boolean {
  const p = BASTION_PASSAGE;
  const top = p.water + p.grilleRise + p.grilleTilt * x;
  if (y >= top) return false;
  const bar = Math.abs(fract(x / p.barPitch + 0.5) - 0.5) * p.barPitch < p.barHalf;
  const rail = Math.abs(y - (top - 0.22)) < 0.08 || Math.abs(y - (top - 1.05)) < 0.06;
  return bar || rail;
}

/**
 * Trace a ray (origin inside the passage's section, unit direction,
 * door-local) against the virtual passage: the SAME test the window's
 * fragment shader runs. `water` false is the reflected ray's trace (it left
 * the surface going up).
 */
export function bastionPassageTrace(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  water: boolean,
  out: BastionPassageHit,
): BastionPassageHit {
  const p = BASTION_PASSAGE;
  let best = 1e5;
  let kind: BastionPassageHitKind = 'far';
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
    const t = (p.grille - oz) / dz;
    if (t > 0 && t < best && bastionGrilleSolid(ox + dx * t, oy + dy * t)) {
      best = t;
      kind = 'grille';
    }
  }
  out.kind = kind;
  out.t = best;
  out.x = ox + dx * best;
  out.y = oy + dy * best;
  out.z = oz + dz * best;
  return out;
}

/** The beacon's light on a surface of the passage, by how far it lies from
 *  the far end: full at the light, a memory at the door. */
export function bastionPassageGlow(z: number, pulse: number): number {
  const d = BASTION_PASSAGE.far - z;
  return (pulse * 1.6) / (1 + 0.0045 * d * d);
}

// ---- the marsh fog -----------------------------------------------------------------

export interface BastionFogField {
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
  /** Puff centre above the ground, and puff width. */
  readonly y: number;
  readonly size: number;
  /** How much of the beacon's green this field takes when the light is in the gate. */
  readonly lit: number;
}

/** The fog pours out of the court through the outer arch and runs down the
 *  causeway; thinner banks lie in the hollows under each tower, against the
 *  gate front's foot and on the knoll behind. */
export const BASTION_FOG_FIELDS: readonly BastionFogField[] = [
  {
    name: 'gate',
    share: 0.4,
    ox: 0,
    oz: -1.6,
    rx: 1.3,
    rz: 0.9,
    dx: -5.6,
    dz: -12.5,
    fan: 5.5,
    y: 0.5,
    size: 3.2,
    lit: 1,
  },
  {
    name: 'west_hollow',
    share: 0.2,
    ox: 10.6,
    oz: -5.2,
    rx: 3.2,
    rz: 2.6,
    dx: 2.2,
    dz: -3.0,
    fan: 0,
    y: 0.5,
    size: 3.6,
    lit: 0.25,
  },
  {
    name: 'east_hollow',
    share: 0.2,
    ox: -11.5,
    oz: -6.5,
    rx: 3.6,
    rz: 2.6,
    dx: -2.4,
    dz: -2.6,
    fan: 0,
    y: 0.5,
    size: 3.4,
    lit: 0.3,
  },
  {
    name: 'front_foot',
    share: 0.12,
    ox: 0,
    oz: -5.0,
    rx: 5.5,
    rz: 1.2,
    dx: -1.0,
    dz: -2.2,
    fan: 0,
    y: 0.4,
    size: 3.0,
    lit: 0.6,
  },
  {
    name: 'knoll',
    share: 0.08,
    ox: -1.5,
    oz: 8.0,
    rx: 5.0,
    rz: 2.5,
    dx: 1.5,
    dz: 1.0,
    fan: 0,
    y: 0.45,
    size: 3.4,
    lit: 0.1,
  },
];

/** Puff count by the static effects tier (never the FPS governor). */
export function bastionFogPuffCount(tier: BastionEffectsTier): number {
  return [18, 34, 52, 70][tierRank(tier)];
}

export interface BastionFogPuff {
  /** The field it belongs to (an index into BASTION_FOG_FIELDS). */
  field: number;
  /** Birth place and drift over one life (door-local). */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  /** Life-cycle offset in [0, 1) and life cycles per second. */
  phase: number;
  speed: number;
  /** Width in yards at birth, centre height above the ground, the beacon's share. */
  size: number;
  y: number;
  lit: number;
}

/** A puff's fixed parameters: golden-ratio spreads, no random stream. */
export function bastionFogPuff(index: number, count: number): BastionFogPuff {
  const u = (index + 0.5) / Math.max(1, count);
  let field = 0;
  let acc = 0;
  for (let i = 0; i < BASTION_FOG_FIELDS.length; i++) {
    acc += BASTION_FOG_FIELDS[i].share;
    field = i;
    if (u < acc) break;
  }
  const f = BASTION_FOG_FIELDS[field];
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

export interface BastionFogPose {
  x: number;
  /** Life fraction in [0, 1): the painter rides the ground between the
   *  puff's birth and its end by it (the knoll is steep). */
  t: number;
  z: number;
  /** Billboard width in yards (the height is 0.46 of it). */
  scale: number;
  alpha: number;
}

/** Where a puff is at a time: the painter's vertex shader runs the same
 *  formula. motion 0 (reduced motion) freezes every puff at its own phase. */
export function bastionFogPose(
  puff: BastionFogPuff,
  time: number,
  motion: number,
  out: BastionFogPose,
): BastionFogPose {
  const t = fract(puff.phase + time * puff.speed * motion);
  out.t = t;
  out.x = puff.ox + puff.dx * t + Math.sin(time * 0.21 * motion + puff.phase * TAU) * 0.35;
  out.z = puff.oz + puff.dz * t;
  out.scale = puff.size * (0.7 + 1.0 * t);
  out.alpha = smoothstep(0, 0.16, t) * (1 - smoothstep(0.55, 1, t));
  return out;
}

/** A puff the camera stands in is not fog, it is a stack of full-screen
 *  quads: it thins from `full` yards of view depth down to nothing at `start`,
 *  where the painter also collapses its quad. */
export const BASTION_FOG_NEAR = { start: 3, full: 9 } as const;

export function bastionFogNearFade(viewDepth: number): number {
  return smoothstep(BASTION_FOG_NEAR.start, BASTION_FOG_NEAR.full, viewDepth);
}

/** The fog's strength by time of day: it must read at noon from down the
 *  road, and thickens after dark. */
export function bastionFogStrength(night: number): number {
  return 0.62 + 0.38 * night;
}

// ---- the additive sprites ------------------------------------------------------------

export const BASTION_SPRITE_KIND = {
  /** The rosette's pale core: a soft disc that never goes out. */
  roseCore: 0,
  /** A shaft through the rosette's broken glass (dusk and night). */
  roseShaft: 1,
  /** The beacon's light through the gate, cut by the portcullis bars. */
  gateShaft: 2,
  /** The beam over the towers. */
  skyBeam: 3,
  /** A drop falling from the portcullis or an arch. */
  drip: 4,
  /** The ring where it lands (lies on the ground). */
  ring: 5,
  /** A marsh light drifting over the mud after dusk. */
  marshLight: 6,
  /** The green pool on the wet threshold (lies on the ground). */
  pool: 7,
  /** A glow of the beacon's light seen down its own length: in the door's
   *  mouth behind the bars, and over the knoll when the beam bears on the road. */
  mouth: 8,
} as const;
export type BastionSpriteKind = (typeof BASTION_SPRITE_KIND)[keyof typeof BASTION_SPRITE_KIND];

export interface BastionSprite {
  kind: BastionSpriteKind;
  x: number;
  y: number;
  z: number;
  /** Billboard size in yards (a shaft's width at its foot). */
  size: number;
  phase: number;
  speed: number;
  /** Kind-specific reach: a drip's fall, a shaft's length, a light's wander,
   *  a glow's share of the night (0 the same by day, 1 only after dark). */
  range: number;
  /** A shaft's direction, or a ground sprite's slope (dy/dx, 0, dy/dz); for a
   *  glow, dx is the share of it that stands between turns. */
  dx: number;
  dy: number;
  dz: number;
  /** A shaft's width at its tip; a glow's rays (0 a plain glow, 1 rayed). */
  spread: number;
}

/** The gate shafts: yaw off south (negative east, the way the road falls),
 *  pitch, length, width at the foot and at the tip, and the foot's lx. Uneven
 *  on purpose, and fanned off the road's own line so a climber sees them from
 *  the side, as shafts in the haze, never as a disc of rays. */
export const BASTION_GATE_SHAFTS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [-0.58, -0.3, 11, 1.1, 2.6, -0.5],
  [-0.4, -0.42, 13, 1.5, 3.6, -0.2],
  [-0.22, -0.22, 9, 0.9, 2.2, 0.1],
  [-0.06, -0.5, 12, 1.3, 3.2, -0.3],
  [0.12, -0.3, 8, 1.0, 2.4, 0.4],
  [0.34, -0.44, 10.5, 1.4, 3.0, 0.2],
  [0.52, -0.36, 7, 1.2, 2.8, 0],
];

/** The rosette (lx, y, lz of its face, radius), from the Blender build. */
export const BASTION_ROSETTE = { lx: 0, y: 6.95, lz: -3.75, radius: 1.0 } as const;

/** Every spike of the jammed portcullis and the winch chain's pulley (lx, y,
 *  lz), from the Blender build's stats.json: the drops fall from the iron. */
export const BASTION_DRIP_SOURCES: readonly (readonly [number, number, number])[] = [
  [-1.917, 2.157, -3.2],
  [-1.446, 1.991, -3.2],
  [-0.959, 2.104, -3.2],
  [-0.487, 1.937, -3.2],
  [0, 2.05, -3.2],
  [0.471, 1.883, -3.2],
  [0.959, 1.996, -3.2],
  [1.43, 1.83, -3.2],
  [1.917, 1.943, -3.2],
  [2.08, 5.2, -2.17],
];

/** The standing water at the wall foot (lx, y, lz, radius), from the build. */
export const BASTION_PUDDLES: readonly (readonly [number, number, number, number])[] = [
  [-3.7, -1.78, -4.55, 0.62],
  [3.3, -3.101, -4.75, 0.7],
  [-11.6, 0.248, -4.2, 0.6],
  [9.6, -1.761, 3.4, 0.55],
];

/** Where the marsh lights wander: the hollows either side of the causeway
 *  and the knoll behind (door-local boxes). */
export const BASTION_MARSH_FIELDS: readonly {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}[] = [
  { x0: 4, x1: 15, z0: -13, z1: -4 },
  { x0: -17, x1: -5, z0: -15, z1: -5 },
  { x0: -8, x1: 8, z0: 6, z1: 13 },
];

/** Gravity of a falling drop, yards per second squared (it only has to look right). */
export const BASTION_DRIP_GRAVITY = 16;

/** The time a drop takes to fall `fall` yards. */
export function bastionDripFallTime(fall: number): number {
  return Math.sqrt((2 * Math.max(0.05, fall)) / BASTION_DRIP_GRAVITY);
}

/**
 * The sprite list of a tier. `ground(lx, lz)` is the terrain above the door's
 * own height (the painter passes the sim's terrainHeight), so drops land and
 * rings lie where the ground really is. The door's own cues (the core, the
 * mouth glow, the pool, the gate shaft) draw on every tier; the tier thins
 * the drips and the marsh lights and drops the sky beam and the rosette's
 * shafts on low.
 */
export function bastionSprites(
  tier: BastionEffectsTier,
  ground: (lx: number, lz: number) => number,
  drips: readonly (readonly [number, number, number])[] = BASTION_DRIP_SOURCES,
  puddles: readonly (readonly [number, number, number, number])[] = BASTION_PUDDLES,
): BastionSprite[] {
  const rank = tierRank(tier);
  const K = BASTION_SPRITE_KIND;
  const out: BastionSprite[] = [];
  const base = { phase: 0, speed: 1, range: 0, dx: 0, dy: 0, dz: 0, spread: 0 };
  const slope = (lx: number, lz: number) => ({
    dx: (ground(lx + 0.4, lz) - ground(lx - 0.4, lz)) / 0.8,
    dz: (ground(lx, lz + 0.4) - ground(lx, lz - 0.4)) / 0.8,
  });
  const r = BASTION_ROSETTE;
  out.push({ ...base, kind: K.roseCore, x: r.lx, y: r.y, z: r.lz - 0.15, size: 1.5, phase: 0.3 });
  // The door's mouth and the wet threshold in front of it.
  const p = BASTION_PASSAGE;
  out.push({
    ...base,
    kind: K.mouth,
    x: 0,
    y: 2.3,
    z: -2.6,
    size: 5.6,
    phase: 0.1,
    range: 0.3,
  });
  // The court never goes quite dark: a low glow behind the portcullis, so
  // its bars and the arch stand against it from the road between turns.
  out.push({
    ...base,
    kind: K.mouth,
    x: 0,
    y: 1.3,
    z: -1.5,
    size: 5.4,
    phase: 0.4,
    range: 0.75,
    dx: 0.5,
  });
  const s0 = slope(0, -1.5);
  out.push({
    ...base,
    kind: K.pool,
    x: 0,
    y: ground(0, -1.5) + 0.12,
    z: -1.5,
    size: 3.6,
    dx: s0.dx,
    dz: s0.dz,
  });
  // The gate shaft: from the door's mouth out under the portcullis and down
  // the road, three shafts fanned a little.
  for (let i = 0; i < BASTION_GATE_SHAFTS.length; i++) {
    const [yaw, pitch, length, foot, tip, ox] = BASTION_GATE_SHAFTS[i];
    const cp = Math.cos(pitch);
    out.push({
      ...base,
      kind: K.gateShaft,
      x: ox,
      y: p.kerb + 1.25,
      z: -0.4,
      size: foot,
      spread: tip,
      range: length,
      dx: Math.sin(yaw) * cp,
      dy: Math.sin(pitch),
      dz: -Math.cos(yaw) * cp,
      phase: fract(i * 0.61803398875 + 0.2),
    });
  }
  if (rank > 0) {
    // Shafts through the rosette's three empty panes, falling toward the road.
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.45;
      const dx = Math.sin(a) * 0.55;
      const dy = -0.85;
      const dz = -0.42;
      const len = Math.hypot(dx, dy, dz);
      out.push({
        ...base,
        kind: K.roseShaft,
        x: r.lx + (i - 1) * 0.35,
        y: r.y - 0.1,
        z: r.lz - 0.2,
        size: 0.45,
        spread: 1.5,
        range: 4.4,
        dx: dx / len,
        dy: dy / len,
        dz: dz / len,
        phase: fract(i * 0.38196601125 + 0.5),
      });
    }
    out.push({
      ...base,
      kind: K.skyBeam,
      x: BASTION_BEACON.lx,
      y: BASTION_BEACON.y,
      z: BASTION_BEACON.lz,
      size: BASTION_BEACON.width0,
      spread: BASTION_BEACON.width1,
      range: BASTION_BEACON.length,
    });
    // The beam end on: the sky over the knoll flares when it bears on the road.
    out.push({
      ...base,
      kind: K.mouth,
      x: BASTION_BEACON.lx,
      y: 9,
      z: 16,
      size: 26,
      phase: 0.6,
      range: 0.85,
      spread: 0,
    });
  }
  // Drips: every other source on low, all of them above; each with its ring.
  const step = rank === 0 ? 3 : rank === 1 ? 2 : 1;
  for (let i = 0; i < drips.length; i += step) {
    const [x, y, z] = drips[i];
    const g = ground(x, z) + 0.06;
    const fall = Math.max(0.3, y - g);
    const phase = fract(i * 0.61803398875 + 0.37);
    const speed = 1 / (2.6 + fract(i * 0.75487766625) * 3.4);
    out.push({ ...base, kind: K.drip, x, y, z, size: 0.045, phase, speed, range: fall });
    // every third drop is heavy enough to leave a ring on the wet stone
    if (i % (3 * step) !== 0) continue;
    const sl = slope(x, z);
    out.push({
      ...base,
      kind: K.ring,
      x,
      y: g,
      z,
      size: 0.75,
      phase,
      speed,
      range: fall,
      dx: sl.dx,
      dz: sl.dz,
    });
  }
  // Slow rings on the standing water at the wall foot.
  if (rank > 0) {
    puddles.forEach(([x, y, z, radius], i) => {
      out.push({
        ...base,
        kind: K.ring,
        x: x + (fract(i * 0.61803398875) - 0.5) * radius * 0.6,
        y: y + 0.02,
        z: z + (fract(i * 0.75487766625) - 0.5) * radius * 0.6,
        size: radius * 1.5,
        phase: fract(i * 0.38196601125 + 0.11),
        speed: 1 / (4.5 + i),
        range: 0,
      });
    });
  }
  const lights = [0, 5, 9, 13][rank];
  for (let i = 0; i < lights; i++) {
    const f = BASTION_MARSH_FIELDS[i % BASTION_MARSH_FIELDS.length];
    const x = f.x0 + fract(i * 0.61803398875 + 0.27) * (f.x1 - f.x0);
    const z = f.z0 + fract(i * 0.75487766625 + 0.44) * (f.z1 - f.z0);
    out.push({
      ...base,
      kind: K.marshLight,
      x,
      y: ground(x, z) + 0.7 + fract(i * 0.38196601125 + 0.6) * 0.9,
      z,
      size: 0.24 + fract(i * 0.56984029099) * 0.12,
      phase: fract(i * 0.56984029099 + 0.71),
      speed: 0.09 + fract(i * 0.61803398875 + 0.9) * 0.07,
      range: 1.3,
    });
  }
  return out;
}

export interface BastionSpritePose {
  x: number;
  y: number;
  z: number;
  alpha: number;
}

/**
 * Where a point-like sprite is and how bright (the shafts and the beam are
 * placed by their own axis in the shader): the painter's vertex shader runs
 * the same formula. night in [0, 1] (bastionNightAmount), motion 1 or 0, pulse
 * the gate pulse of the same instant.
 */
export function bastionSpritePose(
  s: BastionSprite,
  time: number,
  night: number,
  motion: number,
  pulse: number,
  out: BastionSpritePose,
): BastionSpritePose {
  const K = BASTION_SPRITE_KIND;
  const tm = time * motion;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.alpha = 1;
  switch (s.kind) {
    case K.roseCore:
      out.alpha =
        (0.14 + 0.2 * night) * (0.86 + 0.14 * Math.sin(tm * 0.8 + s.phase * TAU)) +
        0.2 * pulse * pulse;
      break;
    case K.mouth:
      out.alpha = (s.dx + (1 - s.dx) * pulse * pulse) * (1 + (night - 1) * s.range);
      break;
    case K.pool:
      out.alpha = pulse * (0.5 + 0.5 * night);
      break;
    case K.drip: {
      const cycle = fract(s.phase + tm * s.speed) / s.speed;
      const fallTime = bastionDripFallTime(s.range);
      const t = Math.min(cycle, fallTime);
      out.y = s.y - 0.5 * BASTION_DRIP_GRAVITY * t * t;
      out.alpha = cycle < fallTime ? 0.85 : 0;
      break;
    }
    case K.ring: {
      const cycle = fract(s.phase + tm * s.speed) / s.speed;
      const age = cycle - bastionDripFallTime(s.range);
      out.alpha = age > 0 ? Math.exp(-age * 1.6) * (1 - smoothstep(1.2, 2.2, age)) : 0;
      break;
    }
    case K.marshLight: {
      const a = tm * s.speed + s.phase * TAU;
      out.x = s.x + Math.sin(a) * s.range;
      out.y = s.y + Math.sin(a * 1.7 + s.phase * 9) * 0.35;
      out.z = s.z + Math.cos(a * 0.8 + s.phase * 4) * s.range;
      out.alpha = night * (0.55 + 0.45 * Math.sin(tm * 0.6 + s.phase * 11));
      break;
    }
    case K.roseShaft:
      out.alpha = night * (0.7 + 0.3 * Math.sin(tm * 0.5 + s.phase * TAU));
      break;
    case K.gateShaft:
      out.alpha = pulse * pulse * pulse * (0.55 + 0.45 * night);
      break;
    default:
      out.alpha = 0.3 + 0.7 * night;
  }
  return out;
}
