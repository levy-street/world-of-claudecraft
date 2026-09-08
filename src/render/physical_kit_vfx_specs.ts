import type { PhysicalChoreography, PhysicalShape } from './ability_vfx/physical_choreography_core';
import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxArchetype, AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

type Entry = PhysicalChoreography & { archetype?: AbilityVfxArchetype; color?: string };
function action(
  shape: PhysicalShape,
  reach: number,
  width: number,
  lift: number,
  tilt: number,
  weight: number,
  material: PhysicalChoreography['material'] = 'steel',
  weapon?: 0 | 1 | 'both',
  beats: readonly number[] = [0],
): Entry {
  return { shape, reach, width, lift, tilt, weight, material, weapon, beats };
}

/** Rogue blades are close punctures and extraction cuts; Wildfang follows paw
 * and jaw anatomy; Fieldcraft has sparse steel and thrown fragments. */
export const PHYSICAL_KIT_CHOREOGRAPHY: Readonly<Record<string, Entry>> = {
  sinister_strike: action('cut', 1.9, 0.1, 0.9, -0.8, 0.85, 'steel', 0),
  backstab: action('thrust', 2.1, 0.1, 1, 0.1, 1.1, 'blood', 0),
  ambush: action('plunge', 2.5, 0.17, 0.55, -0.7, 1.6, 'blood', 0),
  gouge: action('jab', 0.9, 0.045, 1.55, 0.2, 0.4),
  sap: action('jab', 0.6, 0.04, 1.5, -0.7, 0.35, 'air'),
  cheap_shot: action('jab', 0.8, 0.06, 0.6, -0.3, 0.65, 'air'),
  kidney_shot: action('jab', 1.15, 0.08, 0.7, 0.4, 0.85, 'air'),
  kick: action('jab', 1.2, 0.065, 0.4, -0.2, 0.55, 'air'),
  blind: action('breath', 1.9, 0.035, 1, 0.35, 0.65, 'air'),
  eviscerate: action('cut', 2.8, 0.2, 0.65, -0.2, 1.7, 'blood', 0),
  rupture: action('cut', 1.45, 0.08, 0.6, 0.6, 0.8, 'blood', 0),
  hemorrhage: action('reap', 1.65, 0.075, 0.75, -0.7, 0.85, 'blood', 0),
  expose_armor: action('cut', 1.1, 0.075, 1.15, 0.9, 0.7, 'steel', 0),
  body_blow: action('jab', 1.7, 0.16, 0.95, -0.5, 1.35, 'steel', 0),
  knockout_blow: action('rise', 2.3, 0.2, 0.5, 1.4, 1.7, 'air'),
  venomrend: action('claw', 1.75, 0.13, 0.55, -1.1, 1.3, 'venom', 0, [0, 0.23]),
  flurry_of_knives: {
    ...action('scatter', 4.4, 0.055, 0.9, 0.3, 0.85, 'steel', undefined, [0, 0.12, 0.25]),
    archetype: 'nova',
  },
  venom_dart: { ...action('dart', 1.8, 0.035, 1.25, 0.1, 0.5, 'venom'), archetype: 'strike' },
  melting_acid: {
    ...action('venom', 1.1, 0.11, 0.65, 0.3, 0.75, 'venom', undefined, [0, 0.2]),
    archetype: 'strike',
    anchor: 'target',
  },
  nightshade_coating: {
    ...action('venom', 0.85, 0.065, 0.9, -0.2, 0.6, 'venom'),
    archetype: 'strike',
    color: '#5f8973',
    anchor: 'target',
  },
  crippling_poison: { ...action('venom', 0.9, 0.055, 0.25, 0.2, 0.45, 'venom'), anchor: 'target' },
  thieves_chorus: {
    ...action('breath', 3.1, 0.035, 1.5, 0.2, 0.55, 'air', undefined, [0, 0.22]),
    archetype: 'shout',
  },
  claw: action('claw', 1.35, 0.075, 0.15, 0.8, 0.6, 'blood'),
  rake: action('claw', 1.85, 0.065, 0.12, -0.85, 0.7, 'blood', undefined, [0, 0.12]),
  rip: action('claw', 1.55, 0.095, 0.1, 1.15, 0.95, 'blood'),
  ferocious_bite: action('jaw', 1.3, 0.095, 0.55, 0.1, 1.1, 'blood'),
  pounce: action('claw', 1.65, 0.065, 0.15, 0.35, 0.8, 'blood'),
  maul: action('plunge', 1.75, 0.15, 0.12, -0.55, 1.2, 'stone'),
  swipe: action('claw', 2.7, 0.1, 0.25, 2.4, 0.95, 'blood'),
  bash: action('jab', 1.25, 0.1, 0.7, -0.8, 1, 'stone'),
  skull_bash: action('jab', 0.6, 0.095, 1.1, 0.1, 1, 'air'),
  growl: action('breath', 2.1, 0.065, 0.55, -0.1, 0.65, 'air'),
  demoralizing_roar: action('breath', 4.3, 0.1, 0.6, -0.4, 1, 'air', undefined, [0, 0.2]),
  challenging_roar: {
    ...action('breath', 5.4, 0.12, 0.7, 0.15, 1.3, 'air', undefined, [0, 0.12, 0.32]),
    archetype: 'shout',
  },
  redharvest: action('claw', 2.7, 0.17, 0.15, -2, 1.45, 'blood', undefined, [0, 0.25]),
  marrowbreak: action('plunge', 2, 0.19, 0.05, 0.7, 1.5, 'stone'),
  raptor_strike: action('cut', 1.8, 0.08, 0.7, -1.1, 0.75, 'steel', 0),
  wing_clip: action('reap', 1.75, 0.06, 0.2, -0.15, 0.55, 'blood', 0),
  mongoose_bite: action('rise', 2, 0.095, 0.2, 1.2, 0.95, 'blood', 0),
  pack_command: action('jaw', 1.15, 0.065, 0.5, 0.2, 0.75, 'blood'),
  unleash_beast: action('claw', 2.4, 0.12, 0.15, -0.5, 1.3, 'stone', undefined, [0, 0.15, 0.32]),
  trailbreak: { ...action('retreat', 1.8, 0.035, 0.2, 0.1, 0.55, 'air'), archetype: 'dash' },
  feral_charge: {
    ...action('inward', 1.7, 0.07, 0.45, 0.3, 0.85, 'blood', undefined, [0, 0.2, 0.4]),
    archetype: 'buff',
  },
  bloodhook: { ...action('rush', 2, 0.06, 0.45, 0.2, 0.85, 'blood'), archetype: 'dash' },
  shrapnel_charge: {
    ...action('scatter', 3.7, 0.065, 0.5, 0.8, 1.1, 'steel', undefined, [0, 0.12, 0.31]),
    archetype: 'strike',
    anchor: 'target',
  },
};

export const PHYSICAL_KIT_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {};
export const PHYSICAL_KIT_SPECS: Record<string, AbilityVfxSpec> = {};
for (const [id, physical] of Object.entries(PHYSICAL_KIT_CHOREOGRAPHY)) {
  const base = ABILITY_VFX_ART_PROFILES[id];
  const palette =
    physical.material === 'venom' ? 'venom' : physical.material === 'blood' ? 'blood' : 'physical';
  const color =
    physical.color ??
    (palette === 'venom' ? '#769c32' : palette === 'blood' ? '#ae353a' : '#bacbd0');
  const full: AbilityVfxFullSpec = {
    ...base,
    archetype: physical.archetype ?? base?.archetype ?? 'strike',
    palette,
    physical,
    power: base?.power ?? physical.weight,
    accent: palette === 'venom' ? '#daff9e' : palette === 'blood' ? '#ffd0b7' : '#effaff',
    tint: color,
    windup: 0,
    windupStyle: 'none',
    chargeStreams: 1,
    motifs: [],
    motifEvery: 0,
    spirit: null,
    barrier: false,
    decal: undefined,
    screenFx: false,
    impact: {
      ...base?.impact,
      ring: false,
      vRing: false,
      flipbook: false,
      sparks: 0,
      light: 0.2,
      trail: undefined,
    },
    buff: base?.buff
      ? { ...base.buff, orbit: 'none', shellDur: undefined, ceremony: undefined }
      : undefined,
    debuff: undefined,
  };
  PHYSICAL_KIT_FULL_SPECS[id] = full;
  PHYSICAL_KIT_SPECS[id] = {
    c: color,
    p: palette,
    a: full.archetype,
    pw: full.power,
    sp: 5,
    rg: 0,
    li: 0.2,
    bo: 'none',
  };
}
