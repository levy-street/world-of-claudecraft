// Ported from scripts/asset_pipeline/weapon_vfx.js. This TypeScript module is
// now the canonical copy for the game (the world renderer and preview rigs
// attach it to held weapon models); the offline asset-pipeline viewer keeps
// its own JS copy.
//
// Weapon-inspector VFX layer for the live asset library viewer.
//
// Implements the "needs VFX" half of the WOC Armory Codex: the two magical
// collections get runtime effects layered on top of their (deliberately
// effect-free) GLBs, exactly as the design doc prescribes ("effects aren't
// baked: emissive parts glow via the engine's bloom; particles and trails
// layer at runtime").
//
//   Tier 04  Hoarfrost   (Epic)      glow + sparkle: frozen core, frost vapor
//   Tier 05  Fallen Star (Legendary) glow + sparkle + shimmer: orbiting motes,
//                                    aurora ribbons, cast light. Max spectacle.
//
// Everything is procedural (canvas sprite textures, GPU-animated point
// systems, shader ribbons); no asset files are added. All emitters live in
// WEAPON-LOCAL space (the GLB's canonical origin, blade along +Y), so the same
// rig works standing on the inspector pedestal and attached to a character's
// hand. Scene-level dressing (night-sky dome, ground light pool) rides in a
// separate group the viewer adds beside the weapon.
//
// legendary kit (orbit motes, aurora, spin) or vice versa; the escalation ramp
// is the whole point of the collections.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palettes + tier presets (colors from the Armory Codex swatches)
// ---------------------------------------------------------------------------

const ICE = {
  core: 0x8fecff,
  glow: 0x9fd8ff,
  deep: 0x2a7ec2,
  white: 0xeafaff,
};
const STAR = {
  gold: 0xffb347,
  molten: 0xff8b1e,
  starlight: 0xfff2c8,
  violet: 0xa335ee,
  teal: 0x57e0c8,
};
const EMBER = {
  glow: 0xff7a1e,
  hot: 0xffb45e,
  coal: 0xff5210,
  ash: 0x9a8d80,
};

export type WeaponVfxTierName = 'rare' | 'epic' | 'legendary';
export type WeaponVfxBackdropKind = 'forge' | 'frost' | 'night';

export interface WeaponVfxBloomSpec {
  strength: number;
  radius: number;
  threshold: number;
}

export interface WeaponVfxEmissiveSpec {
  hue: [number, number];
  minS: number;
  minL: number;
  whiteL: number;
  whiteScale: number;
  tint: number;
  intensity: number;
  pulse: number;
  pulseHz: number;
}

export interface WeaponVfxShellSpec {
  color: number;
  strength: number;
  power: number;
}

export interface WeaponVfxLightSpec {
  color: number;
  intensity: number;
  distance: number;
  flicker: number;
  hz: number;
}

export interface WeaponVfxFloatSpec {
  bob: number;
  spin: number;
  lift: number;
}

export interface WeaponVfxPoolSpec {
  color: number;
  radius: number;
  opacity: number;
}

export interface WeaponVfxTier {
  label: string;
  collection: string;
  hex: string;
  dots: number;
  fxNote: string;
  bloom: WeaponVfxBloomSpec;
  background: number;
  backdrop: WeaponVfxBackdropKind;
  emissive: WeaponVfxEmissiveSpec;
  shell: WeaponVfxShellSpec;
  light: WeaponVfxLightSpec;
  float: WeaponVfxFloatSpec;
  sceneDim: number;
  pool: WeaponVfxPoolSpec;
}

export const TIERS: Record<WeaponVfxTierName, WeaponVfxTier> = {
  // Tier 03, the "first true enchantment": a restrained banked-heat glow.
  // Deliberately the lightest magical tier: emissive + bloom with a whisper of
  // embers, no motes, no aurora, no core flare. Keep it visibly BELOW epic.
  rare: {
    label: 'Rare',
    collection: 'Emberwrought',
    hex: '#0070dd',
    dots: 3,
    fxNote: 'subtle glow: banked-ember emissive, faint heat wisps',
    bloom: { strength: 0.55, radius: 0.45, threshold: 0.7 },
    background: 0x0b0705,
    backdrop: 'forge',
    // Ember-orange runes, cracks and coals; hot metal joins in faintly.
    emissive: {
      hue: [8, 52],
      minS: 0.35,
      minL: 0.26,
      whiteL: 0.9,
      whiteScale: 0.12,
      tint: 0xff7a1e,
      intensity: 1.15,
      pulse: 0.22,
      pulseHz: 0.32,
    },
    shell: { color: EMBER.glow, strength: 0.14, power: 3.4 },
    light: { color: 0xff8a3a, intensity: 3.5, distance: 5, flicker: 0.3, hz: 2.1 },
    float: { bob: 0.02, spin: 0, lift: 0.02 },
    sceneDim: 0.68,
    pool: { color: 0xff7a2a, radius: 1.0, opacity: 0.22 },
  },
  epic: {
    label: 'Epic',
    collection: 'Hoarfrost',
    hex: '#a335ee',
    dots: 4,
    fxNote: 'glow + sparkle: frozen core, frost-vapor particles',
    bloom: { strength: 0.9, radius: 0.55, threshold: 0.62 },
    background: 0x060a12,
    backdrop: 'frost',
    // Emissive derivation window: saturated cyan/azure paint is the frozen
    // core; bright desaturated ice picks up a faint residual glow.
    emissive: {
      hue: [150, 245],
      minS: 0.18,
      minL: 0.5,
      whiteL: 0.85,
      whiteScale: 0.4,
      tint: 0x66ccff,
      intensity: 1.0,
      pulse: 0.3,
      pulseHz: 0.55,
    },
    shell: { color: ICE.glow, strength: 0.5, power: 2.6 },
    light: { color: ICE.glow, intensity: 7.5, distance: 7, flicker: 0.12, hz: 0.5 },
    float: { bob: 0.035, spin: 0, lift: 0.05 },
    sceneDim: 0.5,
    pool: { color: 0x63c8f0, radius: 1.5, opacity: 0.4 },
  },
  legendary: {
    label: 'Legendary',
    collection: 'Fallen Star',
    hex: '#ff8000',
    dots: 5,
    fxNote: 'glow + sparkle + shimmer: orbiting motes, aurora, cast light',
    bloom: { strength: 1.1, radius: 0.62, threshold: 0.58 },
    background: 0x050409,
    backdrop: 'night',
    // Molten-gold cracks, veins and cores; hot near-white metal joins in.
    emissive: {
      hue: [12, 68],
      minS: 0.38,
      minL: 0.3,
      whiteL: 0.86,
      whiteScale: 0.2,
      tint: 0xffa73d,
      intensity: 1.6,
      pulse: 0.35,
      pulseHz: 0.8,
    },
    shell: { color: STAR.gold, strength: 0.32, power: 3.1 },
    light: { color: 0xffb050, intensity: 13, distance: 9, flicker: 0.22, hz: 1.6 },
    float: { bob: 0.05, spin: 0.3, lift: 0.22 },
    sceneDim: 0.42,
    pool: { color: 0xff9c3a, radius: 1.7, opacity: 0.5 },
  },
};

// ---------------------------------------------------------------------------
// Live FX tuning channels (the inspector sliders): every channel is a
// MULTIPLIER over the weapon's authored spec value, so 1.0 is always "as
// designed" and the same slider set works for every weapon.
// ---------------------------------------------------------------------------

export interface WeaponVfxTuning {
  glow: number;
  bloom: number;
  light: number;
  core: number;
  motes: number;
  aurora: number;
  mist: number;
  sparkle: number;
  shell: number;
  pool: number;
}

export const DEFAULT_TUNING: WeaponVfxTuning = {
  glow: 1, // derived emissive core intensity
  bloom: 1, // composer bloom strength (applied by the viewer)
  light: 1, // cast point light
  core: 1, // core star sprite
  motes: 1, // orbiting motes
  aurora: 1, // aurora ribbons
  mist: 1, // drift particles (vapor, embers, sparks)
  sparkle: 1, // surface twinkles
  shell: 1, // fresnel rim shell
  pool: 1, // ground light pool
};

const TUNE_KEY_BY_KIND: Record<string, keyof WeaponVfxTuning | undefined> = {
  coreSprite: 'core',
  motes: 'motes',
  aurora: 'aurora',
  drift: 'mist',
  twinkles: 'sparkle',
  shell: 'shell',
  pool: 'pool',
};

// ---------------------------------------------------------------------------
// Scene presets: preview environments for judging the effects under real game
// conditions (the viewer applies them to its display lights / background /
// ground; `bloomThreshold` keeps bright-scene characters out of the bloom).
// Light order matches the viewer rig: [key, fill, rim, ambient].
// ---------------------------------------------------------------------------

export interface WeaponVfxScenePreset {
  label: string;
  bg?: number;
  ground?: number;
  lights?: [number, number][];
  bloomThreshold?: number;
}

// In-world softening per tier, applied by the game renderer and the armory
// inspect preview (the offline viewer shows the raw authored specs). The
// authored values are showcase-hot; in a lived-in scene the epic and legendary
// glow reads overblown, so those tiers shed the most.
export const WORLD_TUNING: Record<WeaponVfxTierName, Partial<WeaponVfxTuning>> = {
  rare: { glow: 0.8, light: 0.7, core: 0.8, sparkle: 0.8, mist: 0.8, shell: 0.75 },
  epic: { glow: 0.55, light: 0.5, core: 0.65, motes: 0.7, sparkle: 0.65, mist: 0.6, shell: 0.5 },
  legendary: {
    glow: 0.6,
    light: 0.55,
    core: 0.7,
    motes: 0.75,
    aurora: 0.65,
    sparkle: 0.7,
    shell: 0.55,
  },
};

export const SCENE_PRESETS: Record<
  'showcase' | 'day' | 'dusk' | 'night' | 'dungeon' | 'snow',
  WeaponVfxScenePreset
> = {
  showcase: { label: 'Showcase (auto)' },
  day: {
    label: 'Daylight field',
    bg: 0x9cc4e8,
    ground: 0x5a7444,
    lights: [
      [0xfff3d9, 3.0],
      [0xcfe4ff, 1.1],
      [0xffffff, 0.9],
      [0xe8f2ff, 0.9],
    ],
    bloomThreshold: 0.85,
  },
  dusk: {
    label: 'Dusk',
    bg: 0x3a2647,
    ground: 0x453a50,
    lights: [
      [0xff9a55, 1.6],
      [0x7a6bd8, 0.7],
      [0xffc9a0, 0.9],
      [0xa08cc0, 0.45],
    ],
    bloomThreshold: 0.7,
  },
  night: {
    label: 'Moonlit night',
    bg: 0x0a1220,
    ground: 0x1c2733,
    lights: [
      [0xa9c4ec, 1.0],
      [0x44608c, 0.5],
      [0xcfe2ff, 0.7],
      [0x8aa4cc, 0.28],
    ],
    bloomThreshold: 0.6,
  },
  dungeon: {
    label: 'Dungeon torchlight',
    bg: 0x0b0705,
    ground: 0x241d16,
    lights: [
      [0xffa04d, 1.1],
      [0x66351a, 0.5],
      [0xff7a30, 0.55],
      [0xffb066, 0.16],
    ],
    bloomThreshold: 0.6,
  },
  snow: {
    label: 'Snowfield',
    bg: 0xb6c9dd,
    ground: 0xb4c2d2,
    lights: [
      [0xffffff, 1.9],
      [0xbcd8ff, 0.8],
      [0xffffff, 0.65],
      [0xe6f0fa, 0.6],
    ],
    bloomThreshold: 1.15,
  },
};

// ---------------------------------------------------------------------------
// Per-weapon specs. Coordinates are weapon-local; {yF} (0 = bounds bottom,
// 1 = top) resolves against the model's measured bounds, dx/dy/dz are absolute
// native-unit offsets on top. Radii and sizes are native units.
// ---------------------------------------------------------------------------

/** Weapon-local anchor: {yF} (0 = bounds bottom, 1 = top) fractions resolve
 *  against the model's measured bounds, dx/dy/dz are absolute native-unit
 *  offsets on top. */
export interface WeaponVfxAnchor {
  xF?: number;
  yF?: number;
  zF?: number;
  dx?: number;
  dy?: number;
  dz?: number;
}

export interface WeaponVfxCoreSprite {
  kind: 'coreSprite';
  at: WeaponVfxAnchor;
  size: number;
  color: number;
  flare?: number;
  hz?: number;
  opacity?: number;
}

export interface WeaponVfxMotes {
  kind: 'motes';
  at: WeaponVfxAnchor;
  radius: [number, number];
  count: number;
  heroCount?: number;
  size: [number, number];
  heroSize?: number;
  speed: [number, number];
  tilt: number;
  bob?: number;
  colorA: number;
  colorB: number;
  opacity?: number;
}

export interface WeaponVfxAuroraHelix {
  from: WeaponVfxAnchor;
  to: WeaponVfxAnchor;
  radius: number;
  turns: number;
  phase?: number;
}

export interface WeaponVfxAuroraArc {
  center: WeaponVfxAnchor;
  radius: number;
  fromDeg: number;
  toDeg: number;
  axis?: string;
}

export interface WeaponVfxAurora {
  kind: 'aurora';
  helix?: WeaponVfxAuroraHelix;
  arc?: WeaponVfxAuroraArc;
  width: number;
  amp?: number;
  speed?: number;
  opacity?: number;
}

export interface WeaponVfxDrift {
  kind: 'drift';
  line: [WeaponVfxAnchor, WeaponVfxAnchor];
  count: number;
  vel: [number, number, number];
  spread: [number, number, number];
  life: [number, number];
  size: [number, number];
  grow?: number;
  swirl?: number;
  colorA: number;
  colorB: number;
  opacity?: number;
}

export interface WeaponVfxTwinkles {
  kind: 'twinkles';
  surface: { yMinF?: number; count: number };
  size: [number, number];
  rate: [number, number];
  color: number;
  star?: boolean;
}

export type WeaponVfxComponent =
  | WeaponVfxCoreSprite
  | WeaponVfxMotes
  | WeaponVfxAurora
  | WeaponVfxDrift
  | WeaponVfxTwinkles;

export interface WeaponVfxSpec {
  tier: WeaponVfxTierName;
  name: string;
  type: string;
  lore: string;
  hero?: boolean;
  emissive?: Partial<WeaponVfxEmissiveSpec>;
  shell?: Partial<WeaponVfxShellSpec>;
  light?: Partial<WeaponVfxLightSpec> & { at?: WeaponVfxAnchor };
  fx: WeaponVfxComponent[];
}

export const WEAPON_VFX: Record<string, WeaponVfxSpec> = {
  ice_fang: {
    tier: 'epic',
    hero: true,
    name: 'Ice Fang',
    type: 'sword',
    lore: 'Curved blade of pale glacial ice, jagged rime crystals down the spine, a glowing cyan frozen core sealed in the fuller.',
    emissive: { intensity: 1.2 },
    light: { at: { yF: 0.62 } },
    fx: [
      // Frozen core breath: cold light seeping out of the fuller.
      {
        kind: 'coreSprite',
        at: { yF: 0.6 },
        size: 0.3,
        color: ICE.core,
        flare: 0.5,
        hz: 0.55,
        opacity: 0.5,
      },
      // Frost vapor rolling off the blade, drifting down and out.
      {
        kind: 'drift',
        line: [{ yF: 0.32 }, { yF: 0.98 }],
        count: 46,
        vel: [0, -0.14, 0],
        spread: [0.1, 0.05, 0.1],
        life: [2.6, 4.2],
        size: [0.13, 0.26],
        grow: 1.2,
        swirl: 0.06,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.2,
      },
      // Fine ice dust falling slowly around the blade.
      {
        kind: 'drift',
        line: [
          { yF: 0.35, dx: -0.2 },
          { yF: 1.0, dx: 0.2 },
        ],
        count: 34,
        vel: [0, -0.32, 0],
        spread: [0.24, 0.08, 0.2],
        life: [3.0, 5.0],
        size: [0.02, 0.05],
        grow: 0,
        swirl: 0.05,
        colorA: 0xeafaff,
        colorB: 0x9fd8ff,
        opacity: 0.85,
      },
      // Rime crystals glinting on the blade surface.
      {
        kind: 'twinkles',
        surface: { yMinF: 0.28, count: 64 },
        size: [0.028, 0.055],
        rate: [0.5, 1.3],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  glaciersplit: {
    tier: 'epic',
    name: 'Glaciersplit',
    type: 'axe',
    lore: 'A head of translucent glacier-ice, its cracked interior glowing cyan; the haft trails cold vapor.',
    emissive: { intensity: 1.35 },
    light: { at: { yF: 0.82 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.82 },
        size: 0.36,
        color: ICE.core,
        flare: 0.4,
        hz: 0.45,
        opacity: 0.55,
      },
      // Cold pouring out of the cracked head.
      {
        kind: 'drift',
        line: [
          { yF: 0.66, dx: -0.3 },
          { yF: 0.98, dx: 0.3 },
        ],
        count: 44,
        vel: [0, -0.18, 0],
        spread: [0.16, 0.06, 0.1],
        life: [2.4, 4.0],
        size: [0.14, 0.28],
        grow: 1.3,
        swirl: 0.07,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.22,
      },
      // Vapor curling down the haft.
      {
        kind: 'drift',
        line: [{ yF: 0.08 }, { yF: 0.55 }],
        count: 20,
        vel: [0, -0.1, 0],
        spread: [0.05, 0.04, 0.05],
        life: [2.8, 4.4],
        size: [0.1, 0.2],
        grow: 1.3,
        swirl: 0.05,
        colorA: 0x9fd8ff,
        colorB: 0x6fb8e8,
        opacity: 0.26,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.55, count: 56 },
        size: [0.04, 0.08],
        rate: [0.5, 1.2],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  solheim_last_light_of_the_dawn: {
    tier: 'legendary',
    hero: true,
    name: 'Solheim, Last Light of the Dawn',
    type: 'sword',
    lore: 'Greatsword forged from a fallen star: a molten-gold core splits the cosmos-black blade, golden shards orbit the guard, and an aurora ribbon winds the edge.',
    emissive: { intensity: 1.55 },
    light: { at: { yF: 0.55 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.3 },
        size: 0.34,
        color: STAR.gold,
        flare: 0.55,
        hz: 0.8,
        opacity: 0.5,
      },
      // Golden shards orbiting the guard.
      {
        kind: 'motes',
        at: { yF: 0.28 },
        radius: [0.3, 0.46],
        count: 10,
        heroCount: 4,
        size: [0.028, 0.06],
        heroSize: 0.12,
        speed: [0.5, 1.1],
        tilt: 0.4,
        bob: 0.035,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      // Fine stardust ring higher up the blade.
      {
        kind: 'motes',
        at: { yF: 0.72 },
        radius: [0.16, 0.3],
        count: 14,
        heroCount: 0,
        size: [0.015, 0.035],
        speed: [0.7, 1.4],
        tilt: 0.5,
        bob: 0.05,
        colorA: STAR.starlight,
        colorB: STAR.teal,
        opacity: 0.8,
      },
      // The aurora ribbon winding up the blade.
      {
        kind: 'aurora',
        helix: { from: { yF: 0.26 }, to: { yF: 1.0 }, radius: 0.24, turns: 1.6 },
        width: 0.14,
        amp: 0.05,
        speed: 0.55,
        opacity: 0.55,
      },
      // Embers of starlight rising off the molten core.
      {
        kind: 'drift',
        line: [{ yF: 0.35 }, { yF: 0.95 }],
        count: 30,
        vel: [0, 0.22, 0],
        spread: [0.08, 0.05, 0.06],
        life: [1.8, 3.2],
        size: [0.02, 0.05],
        grow: 0.3,
        swirl: 0.05,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.9,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.22, count: 70 },
        size: [0.03, 0.07],
        rate: [0.6, 1.5],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  skyrender_the_firmament_s_wound: {
    tier: 'legendary',
    name: "Skyrender, the Firmament's Wound",
    type: 'axe',
    lore: 'An axe head torn out of the night sky, molten-gold cracks and constellations across it; starlight shards hover in its wake.',
    light: { at: { yF: 0.8 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.8 },
        size: 0.3,
        color: STAR.gold,
        flare: 0.5,
        hz: 0.7,
        opacity: 0.55,
      },
      {
        kind: 'motes',
        at: { yF: 0.8 },
        radius: [0.42, 0.62],
        count: 18,
        heroCount: 3,
        size: [0.024, 0.055],
        heroSize: 0.1,
        speed: [0.4, 0.95],
        tilt: 0.55,
        bob: 0.04,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      // Aurora shimmer trailing the cutting edge.
      {
        kind: 'aurora',
        arc: {
          center: { yF: 0.78 },
          radius: 0.58,
          fromDeg: -55,
          toDeg: 75,
          axis: 'z',
        },
        width: 0.16,
        amp: 0.045,
        speed: 0.5,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [
          { yF: 0.62, dx: -0.35 },
          { yF: 0.95, dx: 0.35 },
        ],
        count: 24,
        vel: [0, 0.16, 0],
        spread: [0.12, 0.06, 0.08],
        life: [2.0, 3.4],
        size: [0.018, 0.045],
        grow: 0.3,
        swirl: 0.05,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.5, count: 72 },
        size: [0.03, 0.065],
        rate: [0.6, 1.6],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  starfall_judgment_of_the_heavens: {
    tier: 'legendary',
    name: 'Starfall, Judgment of the Heavens',
    type: 'mace',
    lore: 'A captive molten-gold star burns inside the head, ringed by orbiting fragments; aurora spills from the seams.',
    emissive: { intensity: 1.3 },
    light: { at: { yF: 0.78 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.78 },
        size: 0.36,
        color: STAR.molten,
        flare: 0.7,
        hz: 1.0,
        opacity: 0.55,
      },
      // The judgment ring: two counter-tilted orbit bands around the head.
      {
        kind: 'motes',
        at: { yF: 0.78 },
        radius: [0.5, 0.62],
        count: 20,
        heroCount: 4,
        size: [0.026, 0.055],
        heroSize: 0.11,
        speed: [0.45, 0.85],
        tilt: 0.28,
        bob: 0.03,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 1.0,
      },
      {
        kind: 'motes',
        at: { yF: 0.78 },
        radius: [0.34, 0.44],
        count: 12,
        heroCount: 0,
        size: [0.016, 0.036],
        speed: [-1.2, -0.7],
        tilt: 0.9,
        bob: 0.04,
        colorA: STAR.starlight,
        colorB: STAR.violet,
        opacity: 0.85,
      },
      // Aurora leaking out of the flange seams.
      {
        kind: 'aurora',
        helix: { from: { yF: 0.62 }, to: { yF: 0.97 }, radius: 0.4, turns: 0.9 },
        width: 0.13,
        amp: 0.05,
        speed: 0.65,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.64 }, { yF: 0.94 }],
        count: 26,
        vel: [0, 0.2, 0],
        spread: [0.2, 0.08, 0.2],
        life: [1.6, 3.0],
        size: [0.02, 0.05],
        grow: 0.3,
        swirl: 0.06,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.9,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.55, count: 60 },
        size: [0.03, 0.065],
        rate: [0.7, 1.7],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  astravyr_fang_of_the_fallen_star: {
    tier: 'legendary',
    name: 'Astravyr, Fang of the Fallen Star',
    type: 'dagger',
    lore: 'A sliver of the fallen star itself: a molten-gold edge on cosmos-black metal, one bright star-mote circling the pommel.',
    light: { at: { yF: 0.55 }, intensity: 11, distance: 6 },
    fx: [
      // THE signature mote: a single bright star circling the pommel.
      {
        kind: 'motes',
        at: { yF: 0.1 },
        radius: [0.16, 0.19],
        count: 5,
        heroCount: 1,
        size: [0.014, 0.03],
        heroSize: 0.1,
        speed: [0.9, 1.2],
        tilt: 0.35,
        bob: 0.025,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 1.0,
      },
      // Thin aurora trail licking off the point.
      {
        kind: 'aurora',
        helix: { from: { yF: 0.45 }, to: { yF: 1.02 }, radius: 0.09, turns: 0.75 },
        width: 0.08,
        amp: 0.03,
        speed: 0.7,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.4 }, { yF: 1.0 }],
        count: 16,
        vel: [0, 0.14, 0],
        spread: [0.04, 0.04, 0.04],
        life: [1.6, 2.8],
        size: [0.014, 0.032],
        grow: 0.3,
        swirl: 0.03,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.3, count: 40 },
        size: [0.025, 0.055],
        rate: [0.7, 1.6],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  cosmarch_spire_of_the_endless_void: {
    tier: 'legendary',
    name: 'Cosmarch, Spire of the Endless Void',
    type: 'staff',
    lore: 'Golden star-cores orbit the void spire in a slow procession; aurora ribbons wind up the constellation-etched shaft.',
    emissive: { intensity: 1.6 },
    light: { at: { yF: 0.88 }, intensity: 18 },
    fx: [
      { kind: 'coreSprite', at: { yF: 0.88 }, size: 0.55, color: STAR.gold, flare: 0.65, hz: 0.7 },
      // The orbiting court of star-cores around the crown.
      {
        kind: 'motes',
        at: { yF: 0.88 },
        radius: [0.5, 0.72],
        count: 22,
        heroCount: 5,
        size: [0.026, 0.06],
        heroSize: 0.12,
        speed: [0.35, 0.8],
        tilt: 0.5,
        bob: 0.05,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 1.0,
      },
      // Twin aurora ribbons winding up the whole shaft.
      {
        kind: 'aurora',
        helix: { from: { yF: 0.06 }, to: { yF: 0.9 }, radius: 0.2, turns: 2.2 },
        width: 0.13,
        amp: 0.05,
        speed: 0.5,
        opacity: 0.5,
      },
      {
        kind: 'aurora',
        helix: { from: { yF: 0.12 }, to: { yF: 0.92 }, radius: 0.2, turns: 2.2, phase: 3.14 },
        width: 0.13,
        amp: 0.05,
        speed: 0.5,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.72 }, { yF: 1.0 }],
        count: 24,
        vel: [0, 0.18, 0],
        spread: [0.25, 0.1, 0.25],
        life: [1.8, 3.2],
        size: [0.02, 0.05],
        grow: 0.3,
        swirl: 0.07,
        colorA: STAR.molten,
        colorB: STAR.teal,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 80 },
        size: [0.03, 0.07],
        rate: [0.5, 1.5],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  emberwish_mote_of_the_dying_sun: {
    tier: 'legendary',
    name: 'Emberwish, Mote of the Dying Sun',
    type: 'wand',
    lore: 'The captive mote of a dying sun burns at the tip, wreathed in orbiting embers; constellations glow along the black shaft.',
    emissive: { intensity: 1.6 },
    light: { at: { yF: 0.92 }, intensity: 13, distance: 7 },
    fx: [
      { kind: 'coreSprite', at: { yF: 0.92 }, size: 0.5, color: STAR.molten, flare: 0.75, hz: 1.1 },
      // Tight, fast ember orbit around the captive mote.
      {
        kind: 'motes',
        at: { yF: 0.92 },
        radius: [0.12, 0.22],
        count: 14,
        heroCount: 2,
        size: [0.016, 0.038],
        heroSize: 0.08,
        speed: [1.1, 2.0],
        tilt: 0.6,
        bob: 0.02,
        colorA: STAR.molten,
        colorB: STAR.gold,
        opacity: 1.0,
      },
      {
        kind: 'aurora',
        helix: { from: { yF: 0.55 }, to: { yF: 1.0 }, radius: 0.12, turns: 1.1 },
        width: 0.09,
        amp: 0.035,
        speed: 0.8,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.82 }, { yF: 0.98 }],
        count: 20,
        vel: [0, 0.16, 0],
        spread: [0.06, 0.04, 0.06],
        life: [1.4, 2.6],
        size: [0.016, 0.04],
        grow: 0.4,
        swirl: 0.04,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.9,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.15, count: 46 },
        size: [0.025, 0.055],
        rate: [0.6, 1.5],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  meteorlatch_the_sky_s_last_judgment: {
    tier: 'legendary',
    name: "Meteorlatch, the Sky's Last Judgment",
    type: 'crossbow',
    lore: 'Meteoric star-metal with a molten-gold core down the tiller; the nocked bolt is pure starfire.',
    light: { at: { yF: 0.6 } },
    fx: [
      // The starfire bolt: a hot elongated core where the bolt sits.
      {
        kind: 'coreSprite',
        at: { yF: 0.72 },
        size: 0.26,
        color: STAR.starlight,
        flare: 0.7,
        hz: 1.3,
        opacity: 0.6,
      },
      { kind: 'coreSprite', at: { yF: 0.5 }, size: 0.26, color: STAR.molten, flare: 0.4, hz: 0.9 },
      {
        kind: 'motes',
        at: { yF: 0.6 },
        radius: [0.3, 0.48],
        count: 16,
        heroCount: 3,
        size: [0.022, 0.05],
        heroSize: 0.09,
        speed: [0.5, 1.0],
        tilt: 0.5,
        bob: 0.035,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      // Starfire sparks streaming off the bolt channel.
      {
        kind: 'drift',
        line: [{ yF: 0.35 }, { yF: 0.95 }],
        count: 30,
        vel: [0, 0.3, 0],
        spread: [0.06, 0.06, 0.05],
        life: [1.2, 2.2],
        size: [0.016, 0.04],
        grow: 0.3,
        swirl: 0.04,
        colorA: STAR.starlight,
        colorB: STAR.molten,
        opacity: 0.95,
      },
      {
        kind: 'aurora',
        helix: { from: { yF: 0.3 }, to: { yF: 0.92 }, radius: 0.16, turns: 1.0 },
        width: 0.1,
        amp: 0.04,
        speed: 0.6,
        opacity: 0.45,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.2, count: 56 },
        size: [0.028, 0.06],
        rate: [0.6, 1.6],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  encore_the_second_falling_star: {
    tier: 'legendary',
    name: 'Encore, the Second Falling Star',
    type: 'bow',
    lore: 'A shoulder cannon that requests a second star, aimed: a molten-gold comet shell burns in the flared bell muzzle, and the cosmos-black barrel is etched with glowing constellations.',
    light: { at: { yF: 0.82 }, intensity: 10 },
    fx: [
      // The comet shell seated in the bell muzzle: the hottest point.
      {
        kind: 'coreSprite',
        at: { yF: 0.88 },
        size: 0.3,
        color: STAR.molten,
        flare: 0.75,
        hz: 1.1,
        opacity: 0.65,
      },
      {
        kind: 'coreSprite',
        at: { yF: 0.62 },
        size: 0.2,
        color: STAR.starlight,
        flare: 0.4,
        hz: 0.85,
      },
      // Star-sparks boiling out of the muzzle and falling back along the barrel.
      {
        kind: 'drift',
        line: [{ yF: 0.7 }, { yF: 0.98 }],
        count: 34,
        vel: [0, 0.45, 0],
        spread: [0.08, 0.08, 0.06],
        life: [1.0, 2.0],
        size: [0.018, 0.045],
        grow: 0.35,
        swirl: 0.05,
        colorA: STAR.molten,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      {
        kind: 'motes',
        at: { yF: 0.8 },
        radius: [0.32, 0.5],
        count: 14,
        heroCount: 3,
        size: [0.022, 0.05],
        heroSize: 0.09,
        speed: [0.5, 0.95],
        tilt: 0.55,
        bob: 0.04,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      {
        kind: 'aurora',
        helix: { from: { yF: 0.25 }, to: { yF: 0.88 }, radius: 0.18, turns: 1.2 },
        width: 0.11,
        amp: 0.045,
        speed: 0.55,
        opacity: 0.45,
      },
      // Constellation etchings glittering down the cosmos-black barrel.
      {
        kind: 'twinkles',
        surface: { yMinF: 0.15, count: 60 },
        size: [0.028, 0.06],
        rate: [0.6, 1.6],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  rude_awakening_sword: {
    tier: 'legendary',
    hero: true,
    name: 'Rude Awakening',
    type: 'sword',
    lore: 'A gunblade forged for the first shot of dawn: six star-rounds spin in its brass cylinder, and the cosmos-black blade splits with molten daybreak.',
    emissive: { intensity: 1.45 },
    light: { at: { yF: 0.42 }, intensity: 11 },
    fx: [
      // The chambered star-round burning inside the cylinder.
      {
        kind: 'coreSprite',
        at: { yF: 0.25 },
        size: 0.16,
        color: STAR.molten,
        flare: 0.55,
        hz: 0.95,
        opacity: 0.5,
      },
      // The cylinder itself: six rounds in a tight, flat, fast ring.
      {
        kind: 'motes',
        at: { yF: 0.25 },
        radius: [0.24, 0.27],
        count: 0,
        heroCount: 6,
        size: [0.03, 0.05],
        heroSize: 0.075,
        speed: [1.5, 1.7],
        tilt: 0.06,
        bob: 0.008,
        colorA: STAR.molten,
        colorB: STAR.gold,
        opacity: 1.0,
      },
      // The dawn court: a grand slow orbit around the blade.
      {
        kind: 'motes',
        at: { yF: 0.62 },
        radius: [0.36, 0.52],
        count: 14,
        heroCount: 3,
        size: [0.024, 0.055],
        heroSize: 0.11,
        speed: [0.4, 0.9],
        tilt: 0.45,
        bob: 0.04,
        colorA: STAR.gold,
        colorB: STAR.starlight,
        opacity: 0.95,
      },
      // Daybreak ribbon winding the blade.
      {
        kind: 'aurora',
        helix: { from: { yF: 0.3 }, to: { yF: 1.02 }, radius: 0.2, turns: 1.4 },
        width: 0.13,
        amp: 0.05,
        speed: 0.6,
        opacity: 0.55,
      },
      // A second shimmer arcing off the cutting edge.
      {
        kind: 'aurora',
        arc: { center: { yF: 0.62 }, radius: 0.5, fromDeg: -40, toDeg: 62, axis: 'z' },
        width: 0.12,
        amp: 0.04,
        speed: 0.5,
        opacity: 0.4,
      },
      // Muzzle starfire streaming from the spine vents.
      {
        kind: 'drift',
        line: [{ yF: 0.45 }, { yF: 0.98 }],
        count: 30,
        vel: [0, 0.32, 0],
        spread: [0.06, 0.06, 0.05],
        life: [1.2, 2.2],
        size: [0.016, 0.042],
        grow: 0.3,
        swirl: 0.04,
        colorA: STAR.starlight,
        colorB: STAR.molten,
        opacity: 0.95,
      },
      // Powder smoke curling off the fired chamber.
      {
        kind: 'drift',
        line: [
          { yF: 0.2, dx: -0.08 },
          { yF: 0.34, dx: 0.08 },
        ],
        count: 12,
        vel: [0, 0.12, 0],
        spread: [0.07, 0.04, 0.06],
        life: [2.2, 3.8],
        size: [0.07, 0.15],
        grow: 1.2,
        swirl: 0.06,
        colorA: 0xc9a066,
        colorB: 0x6a5a48,
        opacity: 0.16,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.15, count: 72 },
        size: [0.03, 0.065],
        rate: [0.6, 1.6],
        color: STAR.starlight,
        star: true,
      },
    ],
  },

  // --- Tier 04 Hoarfrost, the Full Set additions -------------------------

  rimecrusher: {
    tier: 'epic',
    name: 'Rimecrusher',
    type: 'mace',
    lore: 'A cluster of jagged ice crystals around a glowing cyan core; hoarfrost creeps down the silvered haft.',
    emissive: { intensity: 1.3 },
    light: { at: { yF: 0.8 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.8 },
        size: 0.34,
        color: ICE.core,
        flare: 0.4,
        hz: 0.5,
        opacity: 0.55,
      },
      {
        kind: 'drift',
        line: [
          { yF: 0.62, dx: -0.25 },
          { yF: 0.98, dx: 0.25 },
        ],
        count: 40,
        vel: [0, -0.16, 0],
        spread: [0.16, 0.06, 0.16],
        life: [2.4, 4.0],
        size: [0.14, 0.28],
        grow: 1.3,
        swirl: 0.07,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.22,
      },
      // Hoarfrost creeping down the haft: slow falling ice dust.
      {
        kind: 'drift',
        line: [{ yF: 0.1 }, { yF: 0.6 }],
        count: 18,
        vel: [0, -0.24, 0],
        spread: [0.06, 0.06, 0.06],
        life: [2.8, 4.6],
        size: [0.018, 0.045],
        grow: 0,
        swirl: 0.04,
        colorA: 0xeafaff,
        colorB: 0x9fd8ff,
        opacity: 0.8,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.55, count: 60 },
        size: [0.032, 0.062],
        rate: [0.5, 1.3],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  frostbite: {
    tier: 'epic',
    name: 'Frostbite',
    type: 'dagger',
    lore: 'A wickedly thin blade of clear blue ice, a glowing cyan vein down its center, needle frost bristling from the hilt.',
    emissive: { intensity: 1.4 },
    light: { at: { yF: 0.6 }, intensity: 6, distance: 6 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.58 },
        size: 0.22,
        color: ICE.core,
        flare: 0.45,
        hz: 0.6,
        opacity: 0.5,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.35 }, { yF: 1.0 }],
        count: 26,
        vel: [0, -0.12, 0],
        spread: [0.05, 0.04, 0.05],
        life: [2.4, 4.0],
        size: [0.1, 0.2],
        grow: 1.2,
        swirl: 0.05,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.2,
      },
      {
        kind: 'drift',
        line: [
          { yF: 0.3, dx: -0.1 },
          { yF: 1.0, dx: 0.1 },
        ],
        count: 22,
        vel: [0, -0.3, 0],
        spread: [0.12, 0.06, 0.1],
        life: [2.6, 4.4],
        size: [0.015, 0.04],
        grow: 0,
        swirl: 0.05,
        colorA: 0xeafaff,
        colorB: 0x9fd8ff,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.25, count: 46 },
        size: [0.024, 0.05],
        rate: [0.6, 1.4],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  hoarfrost_vigil: {
    tier: 'epic',
    name: 'Hoarfrost Vigil',
    type: 'staff',
    lore: 'A silvered staff crowned with a slowly turning shard of glowing cyan ice, radiating crystals and cold vapor.',
    emissive: { intensity: 1.35 },
    light: { at: { yF: 0.88 }, intensity: 9 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.88 },
        size: 0.42,
        color: ICE.core,
        flare: 0.45,
        hz: 0.4,
        opacity: 0.6,
      },
      // Cold rolling off the crown shard.
      {
        kind: 'drift',
        line: [
          { yF: 0.74, dx: -0.2 },
          { yF: 1.0, dx: 0.2 },
        ],
        count: 38,
        vel: [0, -0.15, 0],
        spread: [0.14, 0.06, 0.14],
        life: [2.6, 4.2],
        size: [0.15, 0.3],
        grow: 1.4,
        swirl: 0.06,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.24,
      },
      // Vapor sliding down the shaft.
      {
        kind: 'drift',
        line: [{ yF: 0.1 }, { yF: 0.7 }],
        count: 20,
        vel: [0, -0.1, 0],
        spread: [0.05, 0.05, 0.05],
        life: [3.0, 4.8],
        size: [0.09, 0.18],
        grow: 1.2,
        swirl: 0.05,
        colorA: 0x9fd8ff,
        colorB: 0x6fb8e8,
        opacity: 0.18,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.6, count: 64 },
        size: [0.034, 0.066],
        rate: [0.45, 1.2],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  shard_of_everwinter: {
    tier: 'epic',
    name: 'Shard of Everwinter',
    type: 'wand',
    lore: 'A single spike of glowing cyan glacier-ice; hoarfrost blooms from the silver collar in a faint cold mist.',
    emissive: { intensity: 1.45 },
    light: { at: { yF: 0.8 }, intensity: 6, distance: 6 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.82 },
        size: 0.26,
        color: ICE.core,
        flare: 0.5,
        hz: 0.55,
        opacity: 0.55,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.4 }, { yF: 1.0 }],
        count: 24,
        vel: [0, -0.11, 0],
        spread: [0.06, 0.04, 0.06],
        life: [2.6, 4.2],
        size: [0.1, 0.2],
        grow: 1.3,
        swirl: 0.05,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.22,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.3, count: 44 },
        size: [0.026, 0.052],
        rate: [0.55, 1.35],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  winterbite: {
    tier: 'epic',
    name: 'Winterbite',
    type: 'bow',
    lore: 'A bow of silvered steel and blue ice, a glowing frozen core in the riser and a nocked arrow of solid ice trailing cold.',
    emissive: { intensity: 1.35 },
    light: { at: { yF: 0.5 }, intensity: 7 },
    fx: [
      // Frozen core in the riser (the grip midpoint).
      {
        kind: 'coreSprite',
        at: { yF: 0.5 },
        size: 0.3,
        color: ICE.core,
        flare: 0.5,
        hz: 0.5,
        opacity: 0.55,
      },
      // Cold vapor sliding off both limbs.
      {
        kind: 'drift',
        line: [{ yF: 0.06 }, { yF: 0.94 }],
        count: 42,
        vel: [0, -0.13, 0],
        spread: [0.1, 0.05, 0.08],
        life: [2.5, 4.2],
        size: [0.12, 0.24],
        grow: 1.3,
        swirl: 0.06,
        colorA: 0xbfeaff,
        colorB: 0x7fd4ff,
        opacity: 0.2,
      },
      // Ice dust drifting from the string plane.
      {
        kind: 'drift',
        line: [
          { yF: 0.15, dz: 0.1 },
          { yF: 0.85, dz: 0.1 },
        ],
        count: 24,
        vel: [0, -0.26, 0],
        spread: [0.08, 0.06, 0.08],
        life: [2.6, 4.4],
        size: [0.016, 0.04],
        grow: 0,
        swirl: 0.05,
        colorA: 0xeafaff,
        colorB: 0x9fd8ff,
        opacity: 0.8,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.05, count: 66 },
        size: [0.028, 0.058],
        rate: [0.5, 1.3],
        color: 0xdff6ff,
        star: true,
      },
    ],
  },

  // --- Tier 03 Emberwrought (Rare): restrained banked heat ----------------
  // The tier presets already carry the look (emissive de-bake, faint shell,
  // small flickering light); each weapon adds only a whisper of embers plus,
  // where the codex names a gem or coal, one small dim core sprite.

  cinderbrand: {
    tier: 'rare',
    name: 'Cinderbrand',
    type: 'sword',
    lore: 'Dark forged steel, the fuller filled with ember-orange runes; a smouldering gem sits in the guard.',
    light: { at: { yF: 0.45 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.24 },
        size: 0.12,
        color: EMBER.coal,
        flare: 0.3,
        hz: 0.35,
        opacity: 0.3,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.3 }, { yF: 0.9 }],
        count: 12,
        vel: [0, 0.12, 0],
        spread: [0.05, 0.04, 0.04],
        life: [2.0, 3.6],
        size: [0.014, 0.032],
        grow: 0.2,
        swirl: 0.04,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.55,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.25, count: 20 },
        size: [0.02, 0.04],
        rate: [0.3, 0.8],
        color: EMBER.hot,
        star: false,
      },
    ],
  },

  emberbite: {
    tier: 'rare',
    name: 'Emberbite',
    type: 'axe',
    lore: 'Blackened iron with ember-orange heat-cracks glowing through the bit; a banked-coal gem breathes in the cheek.',
    light: { at: { yF: 0.78 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.78 },
        size: 0.14,
        color: EMBER.coal,
        flare: 0.3,
        hz: 0.3,
        opacity: 0.3,
      },
      {
        kind: 'drift',
        line: [
          { yF: 0.6, dx: -0.15 },
          { yF: 0.95, dx: 0.15 },
        ],
        count: 12,
        vel: [0, 0.1, 0],
        spread: [0.08, 0.04, 0.05],
        life: [2.2, 3.8],
        size: [0.05, 0.11],
        grow: 0.8,
        swirl: 0.04,
        colorA: 0xff8a3a,
        colorB: 0x7a4a20,
        opacity: 0.16,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.55, count: 18 },
        size: [0.02, 0.04],
        rate: [0.3, 0.75],
        color: EMBER.hot,
        star: false,
      },
    ],
  },

  smoulderfall: {
    tier: 'rare',
    name: 'Smoulderfall',
    type: 'mace',
    lore: 'Dark iron flanges glowing ember-orange along their inner cracks; the head hides a molten-cored gem.',
    light: { at: { yF: 0.8 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.8 },
        size: 0.15,
        color: EMBER.coal,
        flare: 0.3,
        hz: 0.32,
        opacity: 0.32,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.62 }, { yF: 0.96 }],
        count: 12,
        vel: [0, 0.11, 0],
        spread: [0.1, 0.05, 0.1],
        life: [2.0, 3.6],
        size: [0.014, 0.03],
        grow: 0.2,
        swirl: 0.05,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.5,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.55, count: 18 },
        size: [0.02, 0.04],
        rate: [0.3, 0.8],
        color: EMBER.hot,
        star: false,
      },
    ],
  },

  ashspark_shiv: {
    tier: 'rare',
    name: 'Ashspark Shiv',
    type: 'dagger',
    lore: 'A short blackened blade veined with glowing ember-orange; ash drifts from the tiny smouldering gem in the pommel.',
    light: { at: { yF: 0.5 }, intensity: 2.8, distance: 4 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.08 },
        size: 0.09,
        color: EMBER.coal,
        flare: 0.35,
        hz: 0.4,
        opacity: 0.3,
      },
      // Ash falling, embers rising: two small opposed drifts.
      {
        kind: 'drift',
        line: [{ yF: 0.3 }, { yF: 0.95 }],
        count: 10,
        vel: [0, 0.1, 0],
        spread: [0.04, 0.03, 0.03],
        life: [1.8, 3.2],
        size: [0.012, 0.028],
        grow: 0.2,
        swirl: 0.03,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.55,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.2 }, { yF: 0.8 }],
        count: 8,
        vel: [0, -0.08, 0],
        spread: [0.05, 0.04, 0.04],
        life: [2.4, 4.0],
        size: [0.014, 0.03],
        grow: 0.3,
        swirl: 0.04,
        colorA: EMBER.ash,
        colorB: 0x5a5048,
        opacity: 0.4,
      },
    ],
  },

  forgeheart_stave: {
    tier: 'rare',
    name: 'Forgeheart Stave',
    type: 'staff',
    lore: 'An iron-shod staff crowned with a caged, glowing ember core; heat-shimmer rises past ember runes.',
    emissive: { intensity: 1.3 },
    light: { at: { yF: 0.86 }, intensity: 4.5 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.86 },
        size: 0.2,
        color: EMBER.glow,
        flare: 0.35,
        hz: 0.3,
        opacity: 0.4,
      },
      // Rising heat shimmer above the cage.
      {
        kind: 'drift',
        line: [
          { yF: 0.78, dx: -0.08 },
          { yF: 0.95, dx: 0.08 },
        ],
        count: 14,
        vel: [0, 0.14, 0],
        spread: [0.06, 0.04, 0.06],
        life: [1.8, 3.2],
        size: [0.06, 0.13],
        grow: 0.9,
        swirl: 0.05,
        colorA: 0xff8a3a,
        colorB: 0x7a4a20,
        opacity: 0.15,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.8 }, { yF: 0.98 }],
        count: 10,
        vel: [0, 0.12, 0],
        spread: [0.05, 0.04, 0.05],
        life: [2.0, 3.4],
        size: [0.013, 0.03],
        grow: 0.2,
        swirl: 0.04,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.55,
      },
    ],
  },

  emberwrought_wand: {
    tier: 'rare',
    name: 'Emberwrought Wand',
    type: 'wand',
    lore: 'A blackened-metal wand tipped with a glowing ember coal held in iron claws; a warm inner light breathes.',
    emissive: { intensity: 1.3 },
    // The coal tip sits at the canonical model's LOW end (the in-hand grip
    // rotation turns it forward), so the whole rig anchors near yF 0.
    light: { at: { yF: 0.12 }, intensity: 3.2, distance: 4.5 },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.1 },
        size: 0.16,
        color: EMBER.glow,
        flare: 0.4,
        hz: 0.35,
        opacity: 0.42,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.04 }, { yF: 0.3 }],
        count: 9,
        vel: [0, 0.1, 0],
        spread: [0.04, 0.03, 0.04],
        life: [1.8, 3.0],
        size: [0.012, 0.026],
        grow: 0.2,
        swirl: 0.03,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.55,
      },
    ],
  },

  cinderlatch: {
    tier: 'rare',
    name: 'Cinderlatch',
    type: 'crossbow',
    lore: 'A blackened-steel crossbow, ember-orange glow seeping from cracks in the prod; a smouldering coal sits in the tiller.',
    light: { at: { yF: 0.55 } },
    fx: [
      {
        kind: 'coreSprite',
        at: { yF: 0.55 },
        size: 0.13,
        color: EMBER.coal,
        flare: 0.3,
        hz: 0.33,
        opacity: 0.3,
      },
      {
        kind: 'drift',
        line: [{ yF: 0.35 }, { yF: 0.9 }],
        count: 11,
        vel: [0, 0.1, 0],
        spread: [0.06, 0.04, 0.04],
        life: [2.0, 3.4],
        size: [0.013, 0.028],
        grow: 0.2,
        swirl: 0.04,
        colorA: EMBER.coal,
        colorB: EMBER.hot,
        opacity: 0.5,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.3, count: 16 },
        size: [0.018, 0.036],
        rate: [0.3, 0.7],
        color: EMBER.hot,
        star: false,
      },
    ],
  },
};

export interface WeaponVfxAssetRef {
  name?: string;
  category?: string;
  weaponKey?: string | null;
}

/** Resolve the VFX spec key for a library asset (applied weapons + generated
 *  weapon-lane jobs that carry a weaponKey). */
export function vfxSpecFor(
  asset: WeaponVfxAssetRef | null | undefined,
): { key: string; spec: WeaponVfxSpec } | null {
  const key = asset?.category === 'weapons' ? asset.name : (asset?.weaponKey ?? null);
  return key && WEAPON_VFX[key] ? { key, spec: WEAPON_VFX[key] } : null;
}

/** Inspector banner HTML for a VFX weapon (rarity card above the metadata). */
export function bannerHtml(spec: WeaponVfxSpec): string {
  const tier = TIERS[spec.tier];
  const dots = Array.from(
    { length: 5 },
    (_, i) => `<i class="${i < tier.dots ? 'on' : ''}"></i>`,
  ).join('');
  return (
    `<div class="vfxband vfxband-${spec.tier}">` +
    `<div class="vfxband-top"><span class="vfxband-tier">${tier.label} · ${tier.collection}</span>` +
    `<span class="vfxband-dots">${dots}</span></div>` +
    `<div class="vfxband-name">${spec.name}${spec.hero ? ' <span class="vfxband-hero">flagship</span>' : ''}</div>` +
    `<div class="vfxband-lore">${spec.lore}</div>` +
    `<div class="vfxband-fx">${tier.fxNote}</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Procedural sprite textures (cached per page)
// ---------------------------------------------------------------------------

const texCache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (cx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  if (texCache.has(key)) return texCache.get(key) as THREE.CanvasTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d') as CanvasRenderingContext2D, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function softDiscTex() {
  return canvasTexture('disc', 64, (cx, s) => {
    const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, s, s);
  });
}

function starFlareTex() {
  return canvasTexture('star4', 128, (cx, s) => {
    const c = s / 2;
    const core = cx.createRadialGradient(c, c, 0, c, c, s * 0.16);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = core;
    cx.fillRect(0, 0, s, s);
    // 4-point flare arms via elongated gradients.
    for (const rot of [0, Math.PI / 2]) {
      cx.save();
      cx.translate(c, c);
      cx.rotate(rot);
      const arm = cx.createLinearGradient(-c, 0, c, 0);
      arm.addColorStop(0, 'rgba(255,255,255,0)');
      arm.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      arm.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = arm;
      cx.fillRect(-c, -s * 0.018, s, s * 0.036);
      cx.restore();
    }
  });
}

function noiseTex() {
  const tex = canvasTexture('noise', 128, (cx, s) => {
    const img = cx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.floor(Math.random() * 145);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function skyTex(kind: WeaponVfxBackdropKind): THREE.CanvasTexture {
  return canvasTexture(`sky_${kind}`, 1024, (cx, s) => {
    const g = cx.createLinearGradient(0, 0, 0, s);
    if (kind === 'night') {
      g.addColorStop(0, '#0b0a1c');
      g.addColorStop(0.55, '#070610');
      g.addColorStop(1, '#03030a');
    } else if (kind === 'forge') {
      g.addColorStop(0, '#0c0705');
      g.addColorStop(0.6, '#080503');
      g.addColorStop(1, '#120903');
    } else {
      g.addColorStop(0, '#0a1524');
      g.addColorStop(0.55, '#071019');
      g.addColorStop(1, '#04080f');
    }
    cx.fillStyle = g;
    cx.fillRect(0, 0, s, s);
    // Nebula wisps (night) / cold haze (frost): huge ultra-faint radial blobs.
    // Kept inside [r, 1-r] on x so nothing clips at the sphere's texture seam.
    const blobs: [string, number, number, number][] =
      kind === 'night'
        ? [
            ['rgba(120,60,190,0.10)', 0.38, 0.3, 0.33],
            ['rgba(60,170,160,0.08)', 0.72, 0.22, 0.26],
            ['rgba(230,140,40,0.06)', 0.5, 0.6, 0.38],
          ]
        : kind === 'forge'
          ? [
              ['rgba(230,110,30,0.07)', 0.45, 0.78, 0.4],
              ['rgba(255,150,60,0.045)', 0.66, 0.62, 0.28],
            ]
          : [
              ['rgba(110,170,220,0.08)', 0.42, 0.25, 0.36],
              ['rgba(150,210,255,0.05)', 0.68, 0.5, 0.29],
            ];
    for (const [col, bx, by, br] of blobs) {
      const rg = cx.createRadialGradient(bx * s, by * s, 0, bx * s, by * s, br * s);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = rg;
      cx.fillRect(0, 0, s, s);
    }
    // Stars.
    const n = kind === 'night' ? 420 : kind === 'forge' ? 70 : 150;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = Math.random() * (kind === 'night' ? 1.5 : 1.1) + 0.3;
      const a = 0.2 + Math.random() * (kind === 'night' ? 0.35 : 0.5);
      let col = `rgba(255,255,255,${a})`;
      if (kind === 'night' && Math.random() < 0.18) {
        col = Math.random() < 0.5 ? `rgba(255,190,110,${a})` : `rgba(130,225,210,${a * 0.9})`;
      }
      if (kind === 'frost') col = `rgba(205,235,255,${a * 0.8})`;
      if (kind === 'forge') col = `rgba(255,${150 + Math.floor(Math.random() * 60)},60,${a * 0.5})`;
      cx.fillStyle = col;
      cx.beginPath();
      cx.arc(x, y, r, 0, Math.PI * 2);
      cx.fill();
    }
  });
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// All emitter math runs in ROOT-RELATIVE space (the GLB's canonical frame:
// grip at origin, blade along +Y) regardless of how the root is currently
// scaled, posed or parented (pedestal-normalized OR attached to a hand bone),
// so the rig can be built or rebuilt at any time.
function rootRelativeMatrix(root: THREE.Object3D, mesh: THREE.Object3D): THREE.Matrix4 {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  return inv.multiply(mesh.matrixWorld);
}

function localBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const sub = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.userData.__vfx) return;
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    sub.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(rootRelativeMatrix(root, mesh));
    box.union(sub);
  });
  return box;
}

function resolvePoint(b: THREE.Box3, p: WeaponVfxAnchor = {}): THREE.Vector3 {
  const f = (axis: 'x' | 'y' | 'z', frac: number) => {
    const min = b.min[axis];
    const max = b.max[axis];
    return min + (max - min) * frac;
  };
  return new THREE.Vector3(
    f('x', p.xF ?? 0.5) + (p.dx ?? 0),
    f('y', p.yF ?? 0.5) + (p.dy ?? 0),
    f('z', p.zF ?? 0.5) + (p.dz ?? 0),
  );
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Area-weighted random points on the weapon's mesh surfaces, in root-relative
 *  (canonical weapon) space, filtered to y >= yMin. */
function surfacePoints(root: THREE.Object3D, count: number, yMin: number): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const tris: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; cum: number }[] = [];
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position || mesh.userData.__vfx) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const idx = mesh.geometry.index;
    const m = rootRelativeMatrix(root, mesh);
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia).applyMatrix4(m);
      vb.fromBufferAttribute(pos, ib).applyMatrix4(m);
      vc.fromBufferAttribute(pos, ic).applyMatrix4(m);
      if (Math.max(va.y, vb.y, vc.y) < yMin) continue;
      const area = new THREE.Vector3()
        .subVectors(vb, va)
        .cross(new THREE.Vector3().subVectors(vc, va))
        .length();
      if (area <= 0) continue;
      total += area;
      tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone(), cum: total });
    }
  });
  const out: THREE.Vector3[] = [];
  if (!tris.length) return out;
  for (let k = 0; k < count; k++) {
    const target = Math.random() * total;
    let lo = 0;
    let hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tris[mid].cum < target) lo = mid + 1;
      else hi = mid;
    }
    const t = tris[lo];
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const p = new THREE.Vector3()
      .copy(t.a)
      .addScaledVector(new THREE.Vector3().subVectors(t.b, t.a), u)
      .addScaledVector(new THREE.Vector3().subVectors(t.c, t.a), v);
    if (p.y >= yMin) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emissive-map derivation: paint the texture's "magic" pixels into a graded
// emissive map so exactly the painted core/runes/cracks light up and bloom.
// ---------------------------------------------------------------------------

interface EmissiveRestore {
  mat: THREE.MeshStandardMaterial;
  emissive: THREE.Color | null;
  emissiveIntensity: number;
  emissiveMap: THREE.Texture | null;
  map: THREE.Texture | null;
  metalness: number;
  roughness: number;
  metalnessMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

interface EmissiveEntry {
  prev: EmissiveRestore;
  tex: THREE.CanvasTexture | null;
  albedoTex: THREE.CanvasTexture | null;
}

function deriveEmissive(mat: THREE.MeshStandardMaterial, e: WeaponVfxEmissiveSpec): EmissiveEntry {
  const prev: EmissiveRestore = {
    mat,
    emissive: mat.emissive?.clone?.() ?? null,
    emissiveIntensity: mat.emissiveIntensity,
    emissiveMap: mat.emissiveMap ?? null,
    map: mat.map ?? null,
    metalness: mat.metalness,
    roughness: mat.roughness,
    metalnessMap: mat.metalnessMap ?? null,
    roughnessMap: mat.roughnessMap ?? null,
  };
  // Temper the PBR response while the rig owns the material: the generator's
  // metallic map scatters hot metallic texels that explode into blocky glints
  // under bloom. The codex look is flat-shaded stylized anyway.
  mat.metalness = 0;
  mat.roughness = 1;
  mat.metalnessMap = null;
  mat.roughnessMap = null;
  const img = mat.map?.image;
  if (!img || !img.width) {
    mat.emissive = new THREE.Color(e.tint);
    mat.emissiveIntensity = 0.3;
    return { prev, tex: null, albedoTex: null };
  }
  const w = img.width;
  const h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  cx.drawImage(img, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h);
  const d = data.data;
  // Second buffer: the DE-BAKED albedo. The generator paints its "glow" right
  // into the base color, so every texel promoted to emissive is also darkened
  // in the base map; otherwise lighting + emission double up and the core
  // clips to a flat white patch instead of glowing.
  const av = document.createElement('canvas');
  av.width = w;
  av.height = h;
  const ax = av.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ax.drawImage(img, 0, 0, w, h);
  const adata = ax.getImageData(0, 0, w, h);
  const ad = adata.data;
  const tint = new THREE.Color(e.tint);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let hue = 0;
    let s = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      s = dd / (1 - Math.abs(2 * l - 1));
      if (mx === r) hue = 60 * (((g - b) / dd + 6) % 6);
      else if (mx === g) hue = 60 * ((b - r) / dd + 2);
      else hue = 60 * ((r - g) / dd + 4);
    }
    let score = 0;
    if (hue >= e.hue[0] && hue <= e.hue[1] && s >= e.minS && l >= e.minL) {
      score = Math.min(1, 0.45 + (s - e.minS) * 1.4) * Math.min(1, 0.5 + (l - e.minL) * 1.3);
    } else if (l >= e.whiteL && (s < 0.14 || (hue >= e.hue[0] && hue <= e.hue[1]))) {
      score = e.whiteScale * Math.min(1, 0.4 + (l - e.whiteL) * 4);
    }
    if (score <= 0.01) {
      d[i] = d[i + 1] = d[i + 2] = 0;
    } else {
      // Graded: source color pushed toward the tier tint, scaled by score.
      d[i] = Math.round(255 * Math.min(1, (r + (tint.r - r) * 0.62) * score));
      d[i + 1] = Math.round(255 * Math.min(1, (g + (tint.g - g) * 0.62) * score));
      d[i + 2] = Math.round(255 * Math.min(1, (b + (tint.b - b) * 0.62) * score));
      // De-bake: pull the albedo down where the glow now lives.
      const keep = 1 - 0.72 * score;
      ad[i] = Math.round(ad[i] * keep);
      ad[i + 1] = Math.round(ad[i + 1] * keep);
      ad[i + 2] = Math.round(ad[i + 2] * keep);
    }
  }
  cx.putImageData(data, 0, 0);
  ax.putImageData(adata, 0, 0);
  const mkTex = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = false; // match GLTF UV orientation
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = (mat.map as THREE.Texture).wrapS;
    t.wrapT = (mat.map as THREE.Texture).wrapT;
    return t;
  };
  const tex = mkTex(cv);
  const albedoTex = mkTex(av);
  mat.emissiveMap = tex;
  mat.emissive = new THREE.Color(0xffffff);
  mat.emissiveIntensity = e.intensity;
  mat.map = albedoTex;
  mat.needsUpdate = true;
  return { prev, tex, albedoTex };
}

// ---------------------------------------------------------------------------
// Particle / mesh effect builders. Each returns { node, mats?, update? }.
// Point sizes are world units converted in-shader via uScale (device px per
// world unit at distance 1), so sizes hold up at any zoom.
// ---------------------------------------------------------------------------

type VfxMaterial = THREE.Material & { uniforms?: Record<string, THREE.IUniform> };

interface VfxPart {
  node: THREE.Object3D | null;
  mats: VfxMaterial[];
  update?: (t: number) => void;
  extraDispose?: () => void;
  kind?: string;
  baseOpacities?: number[];
  baseStr?: number;
}

interface VfxScenePart extends VfxPart {
  node: THREE.Object3D;
}

const POINT_COMMON = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
};

function makeMotes(b: THREE.Box3, c: WeaponVfxMotes): VfxPart {
  const total = c.count + (c.heroCount ?? 0);
  const center = resolvePoint(b, c.at);
  const pos = new Float32Array(total * 3);
  const aRad = new Float32Array(total);
  const aPhase = new Float32Array(total);
  const aSpeed = new Float32Array(total);
  const aTiltX = new Float32Array(total);
  const aTiltZ = new Float32Array(total);
  const aSize = new Float32Array(total);
  const aMix = new Float32Array(total);
  const aSeed = new Float32Array(total);
  const aBob = new Float32Array(total);
  const aEcc = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const hero = i < (c.heroCount ?? 0);
    pos.set([center.x, center.y, center.z], i * 3);
    aRad[i] = rand(c.radius[0], c.radius[1]) * (hero ? 1.06 : 1);
    aPhase[i] = Math.random() * Math.PI * 2;
    const sp = rand(Math.abs(c.speed[0]), Math.abs(c.speed[1]));
    aSpeed[i] = (c.speed[0] < 0 ? -sp : sp) * (hero ? 0.8 : 1);
    aTiltX[i] = rand(-c.tilt, c.tilt);
    aTiltZ[i] = rand(-c.tilt, c.tilt);
    aSize[i] = hero ? (c.heroSize as number) : rand(c.size[0], c.size[1]);
    aMix[i] = hero ? 0.15 : Math.random();
    aSeed[i] = Math.random();
    aBob[i] = (c.bob ?? 0.03) * rand(0.5, 1.5);
    aEcc[i] = rand(0.82, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRad', new THREE.BufferAttribute(aRad, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  geo.setAttribute('aTiltX', new THREE.BufferAttribute(aTiltX, 1));
  geo.setAttribute('aTiltZ', new THREE.BufferAttribute(aTiltZ, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aMix', new THREE.BufferAttribute(aMix, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aBob', new THREE.BufferAttribute(aBob, 1));
  geo.setAttribute('aEcc', new THREE.BufferAttribute(aEcc, 1));
  const mat = new THREE.ShaderMaterial({
    ...POINT_COMMON,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uMap: { value: starFlareTex() },
      uColorA: { value: new THREE.Color(c.colorA) },
      uColorB: { value: new THREE.Color(c.colorB) },
      uOpacity: { value: c.opacity ?? 1 },
    },
    vertexShader: `
      attribute float aRad; attribute float aPhase; attribute float aSpeed;
      attribute float aTiltX; attribute float aTiltZ; attribute float aSize;
      attribute float aMix; attribute float aSeed; attribute float aBob;
      attribute float aEcc;
      uniform float uTime; uniform float uScale;
      varying float vMix; varying float vTw;
      void main() {
        float a = aPhase + uTime * aSpeed;
        vec3 p = vec3(cos(a) * aRad, 0.0, sin(a) * aRad * aEcc);
        float cx = cos(aTiltX); float sx = sin(aTiltX);
        p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
        float cz = cos(aTiltZ); float sz = sin(aTiltZ);
        p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
        p.y += sin(uTime * 0.9 + aSeed * 6.2831) * aBob;
        vMix = aMix;
        vTw = 0.7 + 0.3 * sin(uTime * (1.5 + aSeed * 2.5) + aSeed * 40.0);
        vec4 mv = modelViewMatrix * vec4(position + p, 1.0);
        gl_PointSize = aSize * uScale / max(0.15, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColorA; uniform vec3 uColorB;
      uniform float uOpacity;
      varying float vMix; varying float vTw;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        vec3 c = mix(uColorA, uColorB, vMix) * vTw;
        gl_FragColor = vec4(c * a * uOpacity, a * uOpacity);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { node: points, mats: [mat] };
}

function makeDrift(b: THREE.Box3, c: WeaponVfxDrift): VfxPart {
  const a0 = resolvePoint(b, c.line[0]);
  const a1 = resolvePoint(b, c.line[1]);
  const n = c.count;
  const pos = new Float32Array(n * 3);
  const aVel = new Float32Array(n * 3);
  const aLife = new Float32Array(n);
  const aPhase = new Float32Array(n);
  const aSize = new Float32Array(n);
  const aSeed = new Float32Array(n);
  const aSwirl = new Float32Array(n);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    tmp.lerpVectors(a0, a1, Math.random());
    pos[i * 3] = tmp.x + rand(-c.spread[0], c.spread[0]);
    pos[i * 3 + 1] = tmp.y + rand(-c.spread[1], c.spread[1]);
    pos[i * 3 + 2] = tmp.z + rand(-c.spread[2], c.spread[2]);
    aVel[i * 3] = c.vel[0] * rand(0.7, 1.3);
    aVel[i * 3 + 1] = c.vel[1] * rand(0.7, 1.3);
    aVel[i * 3 + 2] = c.vel[2] * rand(0.7, 1.3);
    aLife[i] = rand(c.life[0], c.life[1]);
    aPhase[i] = Math.random();
    aSize[i] = rand(c.size[0], c.size[1]);
    aSeed[i] = Math.random();
    aSwirl[i] = (c.swirl ?? 0.05) * rand(0.5, 1.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(aVel, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aSwirl', new THREE.BufferAttribute(aSwirl, 1));
  const mat = new THREE.ShaderMaterial({
    ...POINT_COMMON,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uMap: { value: softDiscTex() },
      uColorA: { value: new THREE.Color(c.colorA) },
      uColorB: { value: new THREE.Color(c.colorB) },
      uOpacity: { value: c.opacity ?? 0.5 },
      uGrow: { value: c.grow ?? 0 },
    },
    vertexShader: `
      attribute vec3 aVel; attribute float aLife; attribute float aPhase;
      attribute float aSize; attribute float aSeed; attribute float aSwirl;
      uniform float uTime; uniform float uScale; uniform float uGrow;
      varying float vFade; varying float vSeed;
      void main() {
        float ft = fract(uTime / aLife + aPhase);
        vec3 p = position + aVel * (ft * aLife);
        float sw = aSwirl * ft;
        p.x += sin(uTime * 0.7 + aSeed * 6.2831 + ft * 4.0) * sw;
        p.z += cos(uTime * 0.6 + aSeed * 4.71 + ft * 3.5) * sw;
        vFade = smoothstep(0.0, 0.22, ft) * (1.0 - smoothstep(0.55, 1.0, ft));
        vSeed = aSeed;
        float size = aSize * (1.0 + uGrow * ft);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * uScale / max(0.15, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColorA; uniform vec3 uColorB;
      uniform float uOpacity;
      varying float vFade; varying float vSeed;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vFade * uOpacity;
        vec3 c = mix(uColorA, uColorB, vSeed);
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { node: points, mats: [mat] };
}

function makeTwinkles(root: THREE.Object3D, b: THREE.Box3, c: WeaponVfxTwinkles): VfxPart | null {
  const yMin = b.min.y + (b.max.y - b.min.y) * (c.surface.yMinF ?? 0);
  const pts = surfacePoints(root, c.surface.count, yMin);
  if (!pts.length) return null;
  const n = pts.length;
  const pos = new Float32Array(n * 3);
  const aSeed = new Float32Array(n);
  const aSize = new Float32Array(n);
  const aRate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([pts[i].x, pts[i].y, pts[i].z], i * 3);
    aSeed[i] = Math.random();
    aSize[i] = rand(c.size[0], c.size[1]);
    aRate[i] = rand(c.rate[0], c.rate[1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aRate', new THREE.BufferAttribute(aRate, 1));
  const mat = new THREE.ShaderMaterial({
    ...POINT_COMMON,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 600 },
      uMap: { value: c.star ? starFlareTex() : softDiscTex() },
      uColor: { value: new THREE.Color(c.color) },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute float aSeed; attribute float aSize; attribute float aRate;
      uniform float uTime; uniform float uScale;
      varying float vI;
      void main() {
        float w = 0.5 + 0.5 * sin(uTime * aRate * 6.2831 + aSeed * 6.2831);
        vI = pow(w, 9.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * (0.55 + 0.45 * vI) / max(0.15, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
      varying float vI;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vI * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { node: points, mats: [mat] };
}

function auroraPoints(b: THREE.Box3, c: WeaponVfxAurora): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  if (c.helix) {
    const from = resolvePoint(b, c.helix.from);
    const to = resolvePoint(b, c.helix.to);
    const seg = 12;
    const phase = c.helix.phase ?? 0;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const ang = phase + t * c.helix.turns * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(from.x, to.x, t) + Math.cos(ang) * c.helix.radius,
          THREE.MathUtils.lerp(from.y, to.y, t),
          THREE.MathUtils.lerp(from.z, to.z, t) + Math.sin(ang) * c.helix.radius,
        ),
      );
    }
  } else if (c.arc) {
    const center = resolvePoint(b, c.arc.center);
    const seg = 12;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const ang = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(c.arc.fromDeg, c.arc.toDeg, t));
      // Arc in the weapon's XY plane (the blade plane for an axe).
      pts.push(
        new THREE.Vector3(
          center.x + Math.sin(ang) * c.arc.radius,
          center.y + Math.cos(ang) * c.arc.radius,
          center.z,
        ),
      );
    }
  }
  return pts;
}

function makeAurora(b: THREE.Box3, c: WeaponVfxAurora): VfxPart | null {
  const ctrl = auroraPoints(b, c);
  if (ctrl.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(ctrl);
  const SEG = 72;
  const frames = curve.computeFrenetFrames(SEG, false);
  const verts = new Float32Array((SEG + 1) * 2 * 3);
  const norms = new Float32Array((SEG + 1) * 2 * 3);
  const uvs = new Float32Array((SEG + 1) * 2 * 2);
  const halfW = c.width / 2;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const p = curve.getPointAt(t);
    const bn = frames.binormals[i];
    const nm = frames.normals[i];
    for (let side = 0; side < 2; side++) {
      const k = (i * 2 + side) * 3;
      const sgn = side === 0 ? -1 : 1;
      verts[k] = p.x + bn.x * halfW * sgn;
      verts[k + 1] = p.y + bn.y * halfW * sgn;
      verts[k + 2] = p.z + bn.z * halfW * sgn;
      norms[k] = nm.x;
      norms[k + 1] = nm.y;
      norms[k + 2] = nm.z;
      const ku = (i * 2 + side) * 2;
      uvs[ku] = t;
      uvs[ku + 1] = side;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('aNorm', new THREE.BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: c.amp ?? 0.04 },
      uSpeed: { value: c.speed ?? 0.5 },
      uOpacity: { value: c.opacity ?? 0.5 },
      uColA: { value: new THREE.Color(STAR.gold) },
      uColB: { value: new THREE.Color(STAR.violet) },
      uColC: { value: new THREE.Color(STAR.teal) },
    },
    vertexShader: `
      attribute vec3 aNorm;
      uniform float uTime; uniform float uAmp; uniform float uSpeed;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position + aNorm * (uAmp * sin(uv.x * 9.0 + uTime * uSpeed * 4.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uOpacity;
      uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC;
      varying vec2 vUv;
      void main() {
        float t = fract(vUv.x * 1.4 - uTime * 0.1);
        float tri = 1.0 - abs(2.0 * t - 1.0);
        vec3 c = tri < 0.5 ? mix(uColA, uColB, tri * 2.0) : mix(uColB, uColC, tri * 2.0 - 1.0);
        float ends = pow(sin(3.14159 * vUv.x), 0.75);
        float edge = pow(1.0 - abs(vUv.y * 2.0 - 1.0), 1.6);
        float shim = 0.72 + 0.28 * sin(uTime * 1.1 + vUv.x * 8.0);
        float a = ends * edge * shim * uOpacity;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

function makeShell(root: THREE.Object3D, shellSpec: WeaponVfxShellSpec): VfxPart {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(shellSpec.color) },
      uStr: { value: shellSpec.strength },
      uPow: { value: shellSpec.power },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStr; uniform float uPow; uniform float uTime;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        float a = f * uStr * (0.85 + 0.15 * sin(uTime * 1.7));
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const shells: { host: THREE.Mesh; shell: THREE.Mesh }[] = [];
  root.traverse((o) => {
    const host = o as THREE.Mesh;
    if (!host.isMesh || !host.geometry || host.userData.__vfx) return;
    const shell = new THREE.Mesh(host.geometry, mat);
    shell.scale.setScalar(1.015);
    shell.frustumCulled = false;
    shell.userData.__vfx = true;
    shells.push({ host, shell });
  });
  for (const { host, shell } of shells) host.add(shell);
  return {
    node: null,
    mats: [mat],
    extraDispose: () => {
      for (const { host, shell } of shells) host.remove(shell);
    },
  };
}

function makeCoreSprite(b: THREE.Box3, c: WeaponVfxCoreSprite): VfxPart {
  const group = new THREE.Group();
  const at = resolvePoint(b, c.at);
  group.position.copy(at);
  const mkSprite = (tex: THREE.Texture, scale: number, opacity: number) => {
    const m = new THREE.SpriteMaterial({
      map: tex,
      color: c.color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity,
    });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(scale);
    return s;
  };
  const op = c.opacity ?? 0.8;
  const glow = mkSprite(softDiscTex(), c.size, op);
  const flare = mkSprite(starFlareTex(), c.size * (1 + (c.flare ?? 0.5)), op * 0.85);
  group.add(glow, flare);
  return {
    node: group,
    mats: [glow.material, flare.material],
    update: (t: number) => {
      const pulse = 0.86 + 0.14 * Math.sin(t * (c.hz ?? 0.7) * Math.PI * 2);
      glow.scale.setScalar(c.size * pulse);
      flare.scale.setScalar(c.size * (1 + (c.flare ?? 0.5)) * (2 - pulse));
      flare.material.rotation = t * 0.22;
    },
  };
}

function makePool(tier: WeaponVfxTier): VfxScenePart {
  const p = tier.pool;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(p.color) },
      uOpacity: { value: p.opacity },
      uNoise: { value: noiseTex() },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        float ca = cos(uTime * 0.1); float sa = sin(uTime * 0.1);
        vec2 ruv = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca) + 0.5;
        float n = texture2D(uNoise, ruv * 1.7 + uTime * 0.008).r;
        float fade = smoothstep(1.0, 0.18, r);
        float a = fade * (0.5 + 0.5 * n) * uOpacity * (0.82 + 0.18 * sin(uTime * 1.2));
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.frustumCulled = false;
  return { node: mesh, mats: [mat] };
}

function makeBackdrop(tier: WeaponVfxTier): VfxScenePart {
  const mat = new THREE.MeshBasicMaterial({
    map: skyTex(tier.backdrop),
    side: THREE.BackSide,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(38, 32, 20), mat);
  dome.renderOrder = -10;
  return {
    node: dome,
    mats: [mat],
    update: (t: number) => {
      dome.rotation.y = t * 0.004;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory: build the full rig for one weapon.
//
// Call with the loaded, UNTRANSFORMED weapon scene (before normalize/attach):
// all emitters are computed in weapon-local space, then travel with the root.
// Returns { group, sceneExtras, light, update(dt), setPixelScale(px),
// dispose() }. `sceneExtras` (backdrop dome + ground pool) go on the SCENE,
// not the weapon; pass grounded=false to skip the ground pool (held mode).
// ---------------------------------------------------------------------------

export interface WeaponVfxHandle {
  group: THREE.Group;
  sceneExtras: THREE.Group;
  light: THREE.PointLight;
  tier: WeaponVfxTier;
  spec: WeaponVfxSpec;
  tuning: WeaponVfxTuning;
  setTuning(next: Partial<WeaponVfxTuning>): void;
  setBackdropVisible(v: boolean): void;
  setPixelScale(devicePxHeight: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createWeaponVfx(
  weaponRoot: THREE.Object3D,
  spec: WeaponVfxSpec,
  { grounded = true }: { grounded?: boolean } = {},
): WeaponVfxHandle {
  const tier = TIERS[spec.tier];
  const b = localBounds(weaponRoot);
  const group = new THREE.Group();
  group.name = 'weapon_vfx';
  const sceneExtras = new THREE.Group();
  sceneExtras.name = 'weapon_vfx_extras';

  const parts: VfxPart[] = [];
  const emissives: EmissiveEntry[] = [];
  let time = 0;

  // 1. Emissive core derived from the painted texture (per unique material).
  const eSpec: WeaponVfxEmissiveSpec = { ...tier.emissive, ...(spec.emissive ?? {}) };
  const seen = new Set<THREE.Material>();
  weaponRoot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material || mesh.userData.__vfx) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      emissives.push(deriveEmissive(m as THREE.MeshStandardMaterial, eSpec));
    }
  });

  // 2. Fresnel rim shell (the "living magic" silhouette glow).
  const shellSpec: WeaponVfxShellSpec = { ...tier.shell, ...(spec.shell ?? {}) };
  const shellPart = makeShell(weaponRoot, shellSpec);
  shellPart.kind = 'shell';
  parts.push(shellPart);

  // 3. Cast light: the weapon really lights its surroundings.
  const lightSpec: WeaponVfxLightSpec & { at?: WeaponVfxAnchor } = {
    ...tier.light,
    ...(spec.light ?? {}),
  };
  const light = new THREE.PointLight(lightSpec.color, lightSpec.intensity, lightSpec.distance, 2);
  // World-rendered weapon lights move with the held model and drive their own
  // flicker. The renderer still ranks them inside its fixed point-light count.
  light.userData.budgetDynamic = true;
  light.position.copy(resolvePoint(b, lightSpec.at ?? { yF: 0.7 }));
  group.add(light);

  // 4. Spec'd particle components.
  for (const c of spec.fx ?? []) {
    let part: VfxPart | null = null;
    if (c.kind === 'motes') part = makeMotes(b, c);
    else if (c.kind === 'drift') part = makeDrift(b, c);
    else if (c.kind === 'twinkles') part = makeTwinkles(weaponRoot, b, c);
    else if (c.kind === 'aurora') part = makeAurora(b, c);
    else if (c.kind === 'coreSprite') part = makeCoreSprite(b, c);
    if (part) {
      if (part.node) part.node.name = `vfx_${c.kind}`;
      part.kind = c.kind;
      parts.push(part);
    }
  }

  // 5. Scene dressing: backdrop always, ground pool only on the pedestal.
  const backdrop = makeBackdrop(tier);
  backdrop.kind = 'backdrop';
  parts.push(backdrop);
  sceneExtras.add(backdrop.node);
  if (grounded) {
    const pool = makePool(tier);
    pool.kind = 'pool';
    parts.push(pool);
    sceneExtras.add(pool.node);
  }

  for (const p of parts) {
    if (p.node && p.node.parent !== sceneExtras) group.add(p.node);
  }
  weaponRoot.add(group);

  const allMats = parts.flatMap((p) => p.mats ?? []);

  // Live FX tuning: per-channel multipliers over the spec values, applied to
  // the running rig (the inspector's fx sliders drive this). Each part's
  // authored strength is captured once as the base; setTuning re-derives from
  // base * multiplier so sliding never compounds.
  const tuning = { ...DEFAULT_TUNING };
  for (const p of parts) {
    p.baseOpacities = (p.mats ?? []).map((m) =>
      m.uniforms?.uOpacity ? m.uniforms.uOpacity.value : (m.opacity ?? 1),
    );
    if (p.kind === 'shell') p.baseStr = (p.mats[0] as THREE.ShaderMaterial).uniforms.uStr.value;
  }
  const applyTuning = () => {
    for (const p of parts) {
      const key = TUNE_KEY_BY_KIND[p.kind as string];
      if (!key) continue;
      const mult = tuning[key] ?? 1;
      if (p.kind === 'shell') {
        (p.mats[0] as THREE.ShaderMaterial).uniforms.uStr.value = (p.baseStr as number) * mult;
        continue;
      }
      (p.mats ?? []).forEach((m, i) => {
        if (m.uniforms?.uOpacity) {
          m.uniforms.uOpacity.value = (p.baseOpacities as number[])[i] * mult;
        } else if ('opacity' in m) {
          m.opacity = (p.baseOpacities as number[])[i] * mult;
        }
      });
      if (p.node) p.node.visible = mult > 0.01;
    }
  };

  return {
    group,
    sceneExtras,
    light,
    tier,
    spec,
    tuning,
    setTuning(next: Partial<WeaponVfxTuning>) {
      Object.assign(tuning, next);
      applyTuning();
    },
    setBackdropVisible(v: boolean) {
      backdrop.node.visible = v;
    },
    setPixelScale(devicePxHeight: number) {
      // Device px per world unit at distance 1 for a 35-degree vertical fov.
      const s = (devicePxHeight * 0.5) / Math.tan((35 * Math.PI) / 360);
      for (const m of allMats) {
        if (m.uniforms?.uScale) m.uniforms.uScale.value = s;
      }
    },
    update(dt: number) {
      time += dt;
      for (const m of allMats) {
        if (m.uniforms?.uTime) m.uniforms.uTime.value = time;
      }
      for (const p of parts) p.update?.(time);
      const e = eSpec;
      const glowPulse = 1 - e.pulse / 2 + (e.pulse / 2) * Math.sin(time * e.pulseHz * Math.PI * 2);
      for (const { prev } of emissives) {
        if (prev.mat.emissiveMap || prev.mat.emissive) {
          prev.mat.emissiveIntensity = e.intensity * glowPulse * tuning.glow;
        }
      }
      const flick =
        1 -
        lightSpec.flicker +
        lightSpec.flicker *
          (0.6 * Math.sin(time * lightSpec.hz * 6.4) + 0.4 * Math.sin(time * lightSpec.hz * 17.3));
      light.intensity = lightSpec.intensity * flick * tuning.light;
    },
    dispose() {
      weaponRoot.remove(group);
      sceneExtras.parent?.remove(sceneExtras);
      for (const p of parts) {
        p.extraDispose?.();
        if (p.node) {
          p.node.traverse?.((o) => {
            (o as THREE.Mesh).geometry?.dispose?.();
          });
        }
      }
      for (const m of allMats) m.dispose();
      for (const { prev, tex, albedoTex } of emissives) {
        tex?.dispose();
        albedoTex?.dispose();
        prev.mat.emissiveMap = prev.emissiveMap;
        prev.mat.map = prev.map;
        prev.mat.metalness = prev.metalness;
        prev.mat.roughness = prev.roughness;
        prev.mat.metalnessMap = prev.metalnessMap;
        prev.mat.roughnessMap = prev.roughnessMap;
        if (prev.emissive) prev.mat.emissive.copy(prev.emissive);
        prev.mat.emissiveIntensity = prev.emissiveIntensity;
        prev.mat.needsUpdate = true;
      }
    },
  };
}
