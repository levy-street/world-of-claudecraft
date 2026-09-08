import type { PhysicalChoreography, PhysicalShape } from './ability_vfx/physical_choreography_core';
import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

const one = [0] as const;
function motion(
  shape: PhysicalShape,
  reach: number,
  width: number,
  lift: number,
  tilt: number,
  weight: number,
  material: PhysicalChoreography['material'] = 'steel',
  beats: readonly number[] = one,
  weapon?: PhysicalChoreography['weapon'],
): PhysicalChoreography {
  return { shape, reach, width, lift, tilt, weight, material, beats, weapon };
}

/** Each action owns its physical sentence. Shared materials do not imply a
 * shared silhouette, timing, contact height, weapon, or aftermath. */
export const WARRIOR_CHOREOGRAPHY: Readonly<Record<string, PhysicalChoreography>> = {
  heroic_strike: motion('cut', 1.9, 0.085, 0.8, -1.4, 0.7, 'steel', one, 0),
  slam: motion('plunge', 2.25, 0.13, 0.1, 0.22, 1.15, 'stone', one, 0),
  mortal_strike: motion('plunge', 2.75, 0.16, 0.05, -0.5, 1.35, 'steel', one, 0),
  execute: motion('plunge', 3.2, 0.21, 0.02, 0.8, 1.6, 'blood', one, 0),
  breachmaker: motion('thrust', 3.9, 0.17, 1.05, 0.35, 1.6, 'steel', one, 0),
  overpower: motion('rise', 2.1, 0.095, 0.2, -1.7, 0.8, 'steel', one, 0),
  victory_rush: motion('rise', 2.45, 0.12, 0.15, 1.3, 1, 'blood', [0, 0.36], 0),
  raging_gale: motion('cut', 3.15, 0.19, 1, 1.2, 1.4, 'steel', [0, 0.19], 'both'),
  red_harvest: motion('reap', 3.65, 0.24, 0.85, -0.35, 1.9, 'blood', [0, 0.17, 0.34], 'both'),
  bloodthirst: motion('cut', 1.75, 0.105, 0.9, 1.75, 0.95, 'blood', [0, 0.18], 'both'),
  cleave: motion('reap', 3.3, 0.15, 1.1, 0.15, 1, 'steel', one, 0),
  revenge: motion('reap', 8, 0.17, 0.7, -0.65, 1.3, 'steel', one, 0),
  hamstring: motion('cut', 1.5, 0.065, 0.2, 0.25, 0.45, 'blood', one, 0),
  pummel: motion('thrust', 1.1, 0.055, 1.25, -0.25, 0.6, 'air'),
  sunder_armor: motion('cut', 1.3, 0.08, 1.15, -1.1, 0.9, 'steel', one, 0),
  whirlwind: motion('spin', 8, 0.22, 0.85, 0.7, 1, 'blood', [0], 'both'),
  bladestorm: motion('spin', 4.1, 0.16, 0.9, 1.25, 1.35, 'steel', [0, 0.24, 0.5, 0.75], 'both'),
  thunder_clap: motion('fault', 8, 0.15, 0.035, 0.4, 1.5, 'steel', one, 1),
  faultline: motion('fault', 8, 0.18, 0.045, -0.3, 1.9, 'stone', one, 1),
  charge: motion('rush', 5.2, 0.08, 0.18, 0.2, 0.9, 'air', [0, 0.14, 0.3]),
  heroic_leap: motion('fault', 4.6, 0.13, 0.04, 0.5, 1.5, 'stone', [0, 0.13, 0.3]),
  intervene: motion('rush', 4.4, 0.09, 0.8, 0.65, 0.85, 'steel', [0, 0.2]),
  shield_slam: motion('shield', 1.65, 0.15, 0.7, 0.2, 1.3, 'steel', one, 1),
  raised_guard: motion('shield', 1.4, 0.07, 0.6, -0.2, 0.6, 'steel', one, 1),
  iron_resolve: motion('inward', 1.4, 0.09, 0.45, 0, 0.9, 'steel', [0.05]),
  defensive_stance: motion('shield', 0.9, 0.045, 0.55, 0.4, 0.4, 'steel', one, 1),
  die_by_sword: motion('rise', 1.8, 0.08, 0.7, -0.4, 1, 'steel', one, 0),
  battle_shout: motion('breath', 3.3, 0.075, 1.35, 0.15, 0.8, 'air', [0, 0.19]),
  rallying_cry: motion('breath', 4.8, 0.105, 1.1, 0.8, 1, 'air', [0, 0.22, 0.47]),
  emboldening_roar: motion('breath', 3.9, 0.085, 1.6, 0.5, 0.95, 'air', [0, 0.13, 0.31]),
  defiant_bellow: motion('breath', 5.2, 0.13, 0.55, -0.1, 1.25, 'air', [0, 0.28]),
  demoralizing_shout: motion('breath', 4.5, 0.11, 1.2, -0.65, 0.9, 'air', [0, 0.3]),
  intimidating_shout: motion('breath', 4.9, 0.1, 1.45, -0.25, 1.1, 'air', [0, 0.15, 0.48]),
  taunt: motion('breath', 2.3, 0.055, 1.45, 0.02, 0.5, 'air'),
  piercing_howl: motion('breath', 6.1, 0.065, 1.2, -0.1, 1, 'air', [0, 0.13, 0.26]),
  bloodrage: motion('inward', 1.9, 0.09, 0.6, 0.5, 0.75, 'blood'),
  berserker_rage: motion('rise', 2.3, 0.07, 1.05, -0.5, 0.85, 'blood'),
  recklessness: motion('rise', 2.4, 0.1, 0.8, 0.65, 1.2, 'blood'),
  battle_stance: motion('parry', 0.85, 0.035, 0.85, -0.3, 0.35, 'steel', one, 0),
  berserker_stance: motion('cut', 1.1, 0.04, 0.8, 0.7, 0.4, 'blood', [0, 0.22], 'both'),
  avatar: motion('rise', 2.6, 0.13, 0.2, 0.4, 1.4, 'stone'),
  furious_mending: motion('restore', 2.9, 0.2, 1.2, 0.2, 0.9, 'blood', [0]),
  sanguine_aura: motion('inward', 1.1, 0.055, 0.65, 0.6, 0.55, 'blood', [0, 0.25]),
  sweeping_strikes: motion('reap', 2.35, 0.075, 1, -0.1, 0.7, 'steel', [0, 0.24], 'both'),
  storm_bolt: motion('thrust', 2, 0.075, 1.1, -0.2, 0.9, 'steel'),
  measured_fury: motion('quiet', 0.4, 0.025, 0.7, 0.1, 0.2, 'blood'),
  seasoned_soldier: motion('quiet', 0.4, 0.025, 0.3, 0.2, 0.2),
  sudden_death: motion('quiet', 0.5, 0.035, 0.9, 0.3, 0.3, 'blood'),
  diabolical_twinstrike: motion('quiet', 0.5, 0.035, 0.8, 0.4, 0.25, 'blood'),
  cleaving_blows: motion('quiet', 0.4, 0.025, 0.6, 0.5, 0.2),
  deep_wounds: motion('quiet', 0.4, 0.025, 0.5, 0.6, 0.25, 'blood'),
  enrage_passive: motion('quiet', 0.5, 0.03, 1, 0.7, 0.3, 'blood'),
};

export const WARRIOR_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {};
export const WARRIOR_VFX_SPECS: Record<string, AbilityVfxSpec> = {};
for (const [id, physical] of Object.entries(WARRIOR_CHOREOGRAPHY)) {
  const base = ABILITY_VFX_ART_PROFILES[id] ?? { archetype: 'dash', palette: 'physical' };
  const color =
    physical.material === 'blood'
      ? '#a93232'
      : physical.material === 'stone'
        ? '#b39c77'
        : '#c2d3da';
  const full: AbilityVfxFullSpec = {
    ...base,
    tint: color,
    physical,
    windup: 0,
    windupStyle: 'none',
    chargeStreams: 1,
    screenFx: false,
    motifs: [],
    motifEvery: 0,
    spirit: null,
    decal: undefined,
    barrier: false,
    impact: {
      ...base.impact,
      ring: false,
      vRing: false,
      flipbook: false,
      trail: undefined,
      sparks: 0,
      debris: false,
      smoke: false,
      light: 0.25,
    },
    buff: base.buff
      ? { ...base.buff, orbit: 'none', ceremony: undefined, shellDur: undefined }
      : undefined,
    debuff: undefined,
    accent:
      physical.material === 'blood'
        ? '#ffd0ac'
        : physical.material === 'stone'
          ? '#f2d5a1'
          : '#effaff',
  };
  WARRIOR_VFX_FULL_SPECS[id] = full;
  WARRIOR_VFX_SPECS[id] = {
    c: color,
    p: base.palette,
    pw: base.power ?? 1,
    a: base.archetype,
    rg: 0,
    sp: 5,
    li: 0.25,
    bo: 'none',
    spin: base.spin ? 1 : undefined,
    fin: base.finisher ? 1 : undefined,
    b: base.bolt ? { h: 0.6, v: base.bolt.speed } : undefined,
  };
}
