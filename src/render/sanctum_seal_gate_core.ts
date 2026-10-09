// The Smith's Seal Gate's cosmetic plan (pure, Three-free): where the rune
// light hangs, where the cold mist film fills the tunnel mouth, the rime fan
// on the plaza, and the cold mist puffs that pour out of the tunnel along the
// ground. src/render/sanctum_seal_gate.ts is the thin painter. Every value is
// door-local: lx = x - door.x (+x WEST), lz = z - door.z (+z NORTH), y above
// the door's terrain height. Cosmetic only: nothing here is a telegraph, and
// the effects tier only thins the puffs.

/** The static effects tier (src/game/ui_effects_profile.ts resolves it). */
export type SealGateEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

/** The single point light: a faint clean blue off the lintel's runes. */
export const SANCTUM_RUNE_LIGHT = {
  lx: 0,
  y: 11.6,
  lz: -2.6,
  color: 0x5ab8ff,
  intensity: 1.4,
  distance: 16,
} as const;

/** The cold mist film across the tunnel mouth, just behind the pylons (the
 *  portal look: the walk-in trigger fires before a player reaches it). */
export const SANCTUM_MIST_FILM = { lz: 2.6, width: 7.4, height: 9.8, centerY: 4.9 } as const;

/** The rime fan: frost on the ground within about 12 yd of the gate, in a fan
 *  that follows the cold coming out of the mouth. */
export const SANCTUM_RIME_FAN = {
  originLz: -1.2,
  radius: 12.5,
  halfAngle: 1.15,
  rows: 12,
  cols: 22,
  lift: 0.05,
} as const;

/** The mist puffs' flow: born in the mouth, carried out over the plaza. */
export const SANCTUM_MIST_FLOW = {
  startLz: 2.0,
  endLz: -13.0,
  startY: 0.8,
  endY: 0.2,
  spread: 9.0,
} as const;

/** Puff count by the static effects tier (never the FPS governor). */
export function sanctumMistPuffCount(tier: SealGateEffectsTier): number {
  switch (tier) {
    case 'low':
      return 6;
    case 'medium':
      return 12;
    case 'high':
      return 18;
    default:
      return 24;
  }
}

export interface MistPuff {
  /** Life-cycle offset in [0, 1). */
  phase: number;
  /** Life cycles per second. */
  speed: number;
  /** Lateral lane in [-1, 1] (the fan widens along the flow). */
  lane: number;
  /** Size multiplier. */
  size: number;
}

/** A puff's fixed parameters: golden-ratio spread, no random stream. */
export function sanctumMistPuff(index: number, count: number): MistPuff {
  const g = (index * 0.61803398875) % 1;
  const h = (index * 0.75487766625 + 0.31) % 1;
  return {
    phase: (index + 0.5) / Math.max(1, count),
    speed: 0.045 + g * 0.03,
    lane: h * 2 - 1,
    size: 0.8 + ((index * 0.38196601125) % 1) * 0.5,
  };
}

export interface MistPose {
  x: number;
  y: number;
  z: number;
  /** Billboard width in yards (the height is half of it). */
  scale: number;
  alpha: number;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Where a puff is at a time: the SAME formula the painter's vertex shader
 * evaluates on the GPU (sanctum_seal_gate.ts, MIST_VERTEX), kept here so a
 * Node test can pin the flow (out of the mouth, widening, fading in and out).
 */
export function sanctumMistPose(puff: MistPuff, time: number, out: MistPose): MistPose {
  const f = SANCTUM_MIST_FLOW;
  const raw = puff.phase + time * puff.speed;
  const t = raw - Math.floor(raw);
  out.x = puff.lane * (0.8 + t * f.spread) + Math.sin(time * 0.3 + puff.phase * Math.PI * 2) * 0.6;
  out.y = f.startY + (f.endY - f.startY) * t;
  out.z = f.startLz + (f.endLz - f.startLz) * t;
  out.scale = (1.6 + t * 3.4) * puff.size;
  out.alpha = smoothstep(0, 0.15, t) * (1 - smoothstep(0.65, 1, t));
  return out;
}

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** The rime fan's grid vertex (row, col) in door-local lx/lz. */
export function rimeFanVertex(row: number, col: number): { lx: number; lz: number } {
  const f = SANCTUM_RIME_FAN;
  const r = 0.4 + (f.radius - 0.4) * (row / f.rows);
  const a = -f.halfAngle + (2 * f.halfAngle * col) / f.cols;
  return { lx: Math.sin(a) * r, lz: f.originLz - Math.cos(a) * r };
}

/** The frost's opacity at a fan vertex: thick by the gate, thinning toward
 *  the rim and the fan's sides, broken into patches. */
export function rimeFanAlpha(row: number, col: number): number {
  const f = SANCTUM_RIME_FAN;
  const radial = 1 - row / f.rows;
  const side = 1 - Math.abs((2 * col) / f.cols - 1);
  const { lx, lz } = rimeFanVertex(row, col);
  const patch = 0.55 + 0.45 * hash2(Math.floor(lx * 0.8), Math.floor(lz * 0.8));
  const a = radial ** 0.8 * smoothstep(0, 0.45, side) * patch;
  return row === f.rows || col === 0 || col === f.cols ? 0 : Math.min(0.85, a);
}

// ---- the spur's Thornpeak rock and the glacier ice --------------------------------
//
// The rock spur the tunnel is cut into and the two rock cheeks of the ice tongue
// are the MOUNTAIN, not the Smith's masonry: they are shaded to the Thornpeak
// terrain's own snow-crusted rock (src/render/sanctum_seal_gate_surface.ts), and
// the ice tongue to weathered glacier ice. Colours are LINEAR albedo (the
// painter feeds them to a lit material, the scene's lights grade them), so the
// set piece answers day, dusk and night exactly as the ground around it does.

/** A linear RGB triple. */
export type LinearRgb = readonly [number, number, number];

/** Rec. 709 luminance of a linear colour. */
export function linearLuma(c: LinearRgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** The mountain's rock and snow, door-local (lx +x west, y up, lz +z north). */
export const SANCTUM_THORNPEAK_ROCK = {
  /** Cool Thornpeak granite, lit faces and the shaded fracture between them. */
  rock: [0.168, 0.168, 0.17] as LinearRgb,
  rockDark: [0.12, 0.12, 0.123] as LinearRgb,
  /** Old snow and rime, the same cold white the terrain's snow cover reads. */
  snow: [0.58, 0.59, 0.6] as LinearRgb,
  /** The Blender build's baked outer-rock luminance (its MOUNTAIN tone after
   *  the band, tone and crack tints, measured over the shipped GLB): the
   *  vertex colour divided by it keeps the carved cracks and ledges as relief
   *  in the new tone. */
  bakedLuma: 0.26,
  /** Snow lies where the surface faces up: the world-normal y (plus a little
   *  noise) where it starts and where it is full. */
  snowLo: 0.45,
  snowHi: 0.8,
  /** Rime plastered on the steep faces, in patches, like the terrain's wall. */
  rimeAmount: 0.26,
  /** Higher up the face the mountain is snowbound (the terrain's snow cover
   *  above the wall): extra snow ramps in between these door-local heights. */
  snowlineLo: 16,
  snowlineHi: 40,
  snowlineBoost: 0.35,
  /** How dark the granite's fracture joints go (a share of the rock tone). */
  jointDarken: 0.38,
  /** Strata ledges across the rock, one every this many yards. */
  strataPeriod: 1.15,
  /** The tunnel's inside, where the builder's own dark slate stays: inside
   *  the tunnel's half width, behind the rock front, and below the roofline
   *  that separates the vault (at most 15.2 yd up at the far end) from the
   *  crest above it (at least 13.3 at the mouth, 22.5 at the far end). The
   *  floor flags in front of the mouth stay too (below floorY). */
  insideHalfWidth: 4.2,
  insideFrontLz: 2.3,
  insideEndLz: 28.5,
  insideFloorY: 1.5,
  roofY0: 11.5,
  roofSlope: 0.25,
  /** Roughness: wet-matte rock, packed snow (the terrain's ROUGH_SNOW). */
  roughRock: 0.86,
  roughSnow: 0.85,
} as const;

/** The glacier ice of the tongue and the lintel's icicles. */
export const SANCTUM_GLACIER_ICE = {
  /** Clear blue body ice, the bubbly white of a winter layer, the deep blue
   *  down a crevasse, the frost and old snow on top, and the bright
   *  thin-edge blue where light scatters through the margins. */
  clear: [0.2, 0.4, 0.56] as LinearRgb,
  bubbly: [0.36, 0.5, 0.62] as LinearRgb,
  deep: [0.05, 0.16, 0.3] as LinearRgb,
  frost: [0.58, 0.62, 0.67] as LinearRgb,
  edge: [0.46, 0.68, 0.8] as LinearRgb,
  /** The icefall's serac steps: one band every stepHeight yards up the
   *  face (the band line wanders by up to stepWander yards), each topped by a
   *  snow cap capDepth of a band deep and split from the next by a crevasse
   *  crevasseWidth of a band wide. */
  stepHeight: 3.6,
  stepWander: 2.6,
  /** The bow of each band line, yards of drop per square yard off the
   *  tongue's centre line (the builder's ICE_CX, lx -18). */
  stepBow: 0.035,
  tongueLx: -18,
  capDepth: 0.26,
  crevasseWidth: 0.09,
  /** Annual layers: one band every this many yards up the face. */
  layerPeriod: 1.2,
  /** Firn and old snow veil most of the tongue: the cover's base share, how
   *  much the macro patches swing it, and how much an upward face adds. Blue
   *  ice shows on the steep snout faces, in the bare patches and down every
   *  crevasse. */
  firnBase: 0.22,
  firnSwing: 1.1,
  firnUp: 0.8,
  /** How far the thin-edge scatter pulls the albedo toward `edge`. */
  edgeAmount: 0.55,
  /** The builder's baked old snow: vertex red above lo starts it, hi is full
   *  (its ICE_WHITE red is 0.64 linear, its glacier blue 0.21). */
  snowLo: 0.3,
  snowHi: 0.58,
  roughClear: 0.32,
  roughFrost: 0.82,
} as const;

/** Is a door-local point inside the rock-cut tunnel (the builder's dark slate
 *  keeps its own colour there) rather than on the mountain's outer rock? The
 *  SAME test the surface shader runs per fragment. */
export function sealGateRockInside(lx: number, y: number, lz: number): boolean {
  const r = SANCTUM_THORNPEAK_ROCK;
  if (Math.abs(lx) >= r.insideHalfWidth || lz >= r.insideEndLz) return false;
  if (lz <= r.insideFrontLz && y >= r.insideFloorY) return false;
  return y < r.roofY0 + r.roofSlope * lz;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Snow cover on the outer rock from the world-normal y and a noise in [0, 1]
 *  (the shader's own formula). */
export function sealGateSnowCover(normalY: number, noise: number): number {
  const r = SANCTUM_THORNPEAK_ROCK;
  return smoothstep(r.snowLo, r.snowHi, normalY + (noise - 0.5) * 0.7);
}

/** The thin-edge scatter weight from the view-normal cosine (0 grazing, 1 head
 *  on): strongest at the silhouette, gone on faces seen head on. */
export function sealGateIceEdge(nDotV: number): number {
  return (1 - clamp01(Math.abs(nDotV))) ** 3;
}
