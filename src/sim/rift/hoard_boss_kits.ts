import { HOARD_BAT_BOSS_TEMPLATE } from './hoard_bat_core';
import { HOARD_MIMIC_BOSS_TEMPLATE, MIMIC } from './hoard_mimic_core';
import { HOARD_MOLE_BOSS_TEMPLATE, MOLE } from './hoard_mole_core';
import { HOARD_MUSHROOM_BOSS_TEMPLATE, MUSHROOM } from './hoard_mushroom_core';
import { ORBITAL_LIGHTNING } from './hoard_orbital_lightning_core';
import type { HoardBossCueVariant } from './types';

/** Broodmother Vysska's clutch: encounter scenery, never an enemy. Lives here
 *  (an import-free module) so the nameplate view core can name it cheaply. */
export const HOARD_BROOD_EGG_TEMPLATE = 'hoard_brood_egg';

export type HoardBossKit =
  | 'frost'
  | 'ember'
  | 'brood'
  | 'bone-legion'
  | 'brute'
  | 'arcane'
  | 'storm'
  | 'tide'
  | 'mushroom'
  | 'mole'
  | 'bat'
  | 'mimic';

export interface HoardSweepSpec {
  variant: HoardBossCueVariant;
  radius: number;
  halfAngle: number;
  windup: number;
  damageFraction: number;
  school: 'physical' | 'fire' | 'frost' | 'arcane' | 'nature';
  knockback: number;
  ability: string;
}

export interface HoardMarkSpec {
  variant: HoardBossCueVariant;
  radius: number;
  innerRadius?: number;
  windup: number;
  impactFraction: number;
  hazardDuration: number;
  pulseFraction: number;
  pulseEvery: number;
  school: 'physical' | 'fire' | 'frost' | 'arcane' | 'nature';
  ability: string;
}

/** Grask's frontals: quick enough to demand a reaction, each a touch wider than
 *  it looks safe to hug. WORKING RULES from the owner's playtest. */
export const HOARD_BRUTE_WINDUP_SEC = 1.5;

export const HOARD_BRUTE_COMBO: readonly HoardSweepSpec[] = [
  {
    variant: 'brute-wide',
    radius: 8,
    halfAngle: Math.PI * 0.43,
    windup: HOARD_BRUTE_WINDUP_SEC,
    damageFraction: 0.12,
    school: 'physical',
    knockback: 0,
    ability: 'Grask Widebreaker',
  },
  {
    variant: 'brute-medium',
    radius: 12,
    halfAngle: Math.PI * 0.29,
    windup: HOARD_BRUTE_WINDUP_SEC,
    damageFraction: 0.15,
    school: 'physical',
    knockback: 0,
    ability: 'Grask Cleaver',
  },
  {
    variant: 'brute-long',
    radius: 18,
    halfAngle: Math.PI * 0.17,
    windup: HOARD_BRUTE_WINDUP_SEC,
    damageFraction: 0.2,
    school: 'physical',
    knockback: 1.5,
    ability: 'Grask Skullsplitter',
  },
] as const;

/** Alternate left, right, then center around the opening aim. Each cue locks its own aim. */
export const HOARD_BRUTE_FACING_OFFSETS = [-0.7, 0.7, 0] as const;

/** The cave bosses' frontals (their modules lay them; the boss engine resolves
 *  them like any sweep). */
export const HOARD_CAVE_SWEEPS: readonly HoardSweepSpec[] = [
  {
    variant: 'mole-swipe',
    radius: MOLE.swipeRadius,
    halfAngle: MOLE.swipeHalfAngle,
    windup: MOLE.swipeWindupSec,
    damageFraction: MOLE.swipeDamageFraction,
    school: 'physical',
    knockback: 0,
    ability: 'Claw Rake',
  },
  {
    variant: 'mimic-bite',
    radius: MIMIC.biteRadius,
    halfAngle: MIMIC.biteHalfAngle,
    windup: MIMIC.biteWindupSec,
    damageFraction: MIMIC.biteDamageFraction,
    school: 'physical',
    knockback: 0,
    ability: 'Voracious Bite',
  },
];

export const HOARD_FROST_GUST: HoardSweepSpec = {
  variant: 'frost-gust',
  radius: 20,
  halfAngle: Math.PI * 0.3,
  windup: 2.4,
  damageFraction: 0.1,
  school: 'frost',
  knockback: 2.5,
  ability: 'Whiteout Gust',
};

export const HOARD_TIDE_WAVE: HoardSweepSpec = {
  variant: 'tide-wave',
  radius: 28,
  halfAngle: Math.PI * 0.42,
  windup: 4.2,
  damageFraction: 0.3,
  school: 'frost',
  knockback: 2.2,
  ability: 'Crashing Tide',
};

export const HOARD_TIDE_WAVE_HALF_SPAN = 15;
export const HOARD_TIDE_WAVE_HALF_GAP = 2.5;
export const HOARD_TIDE_WAVE_HALF_DEPTH = 1.15;
export const HOARD_TIDE_WAVE_LEAD_SEC = 1;

/** Center of the traveling wave measured along its authored facing. */
export function hoardTideWaveCenter(
  radius: number,
  remaining: number,
  total: number,
  lead = HOARD_TIDE_WAVE_LEAD_SEC,
): number {
  const elapsed = Math.max(0, total - remaining);
  if (elapsed < lead) return -radius * 0.5;
  const travelDuration = Math.max(0.05, total - lead);
  const progress = Math.max(0, Math.min(1, (elapsed - lead) / travelDuration));
  return -radius * 0.5 + progress * radius;
}

/** Two broad foam lanes cross the arena with a stable central escape gap. */
export function pointInHoardTideWave(
  origin: { x: number; z: number },
  facing: number,
  point: { x: number; z: number },
  radius: number,
  remaining: number,
  total: number,
  gap = 0,
  span = HOARD_TIDE_WAVE_HALF_SPAN,
  lead = HOARD_TIDE_WAVE_LEAD_SEC,
): boolean {
  if (total - remaining < lead || remaining <= 0) return false;
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const along = dx * Math.sin(facing) + dz * Math.cos(facing);
  const lateral = dx * Math.cos(facing) - dz * Math.sin(facing);
  const center = hoardTideWaveCenter(radius, remaining, total, lead);
  return (
    Math.abs(along - center) <= HOARD_TIDE_WAVE_HALF_DEPTH &&
    Math.abs(lateral) <= span &&
    Math.abs(lateral - gap) >= HOARD_TIDE_WAVE_HALF_GAP
  );
}

/** Tempest Judgment's charged ground. Large on purpose: the fight is about
 *  dragging Vharok OUT of it (see HOARD_STORM_SURGE below). */
export const HOARD_STORM_FIELD_RADIUS = 12;
export const HOARD_STORM_FIELD_SEC = 9;
/** Storm Surge: while Vharok stands in his own charged ground he gains a stack
 *  every HOARD_STORM_SURGE_EVERY_SEC, each worth +damage and +size, up to the
 *  cap; out of it the stacks bleed off one by one. */
export const HOARD_STORM_SURGE_EVERY_SEC = 1.5;
export const HOARD_STORM_SURGE_DECAY_SEC = 2.5;
export const HOARD_STORM_SURGE_MAX_STACKS = 8;
export const HOARD_STORM_SURGE_DAMAGE_PER_STACK = 0.08;
export const HOARD_STORM_SURGE_SCALE_PER_STACK = 0.05;

/** Event Horizon burns everything out to this radius except the eye; the
 *  Collapse that follows is wider than the eye, so standing still is never safe. */
/** Small enough that a player anywhere in it can run clear in the windup, out or
 *  into the eye: at 30 the far edge was 24 yards from the eye (playtest). */
export const HOARD_EVENT_HORIZON_RADIUS = 16;
export const HOARD_EVENT_HORIZON_EYE_RADIUS = 5.5;
export const HOARD_COLLAPSE_RADIUS = 9.5;

export function hoardBossKit(templateId: string): HoardBossKit {
  switch (templateId) {
    case 'rift_boss_frost':
      return 'frost';
    case 'rift_boss_ember':
      return 'ember';
    case 'rift_boss_venom':
      return 'brood';
    case 'rift_boss_necro':
      return 'bone-legion';
    case 'rift_boss_brute':
      return 'brute';
    case 'rift_boss_arcane':
      return 'arcane';
    case 'rift_boss_storm':
      return 'storm';
    case 'rift_boss_tide':
      return 'tide';
    case HOARD_MUSHROOM_BOSS_TEMPLATE:
      return 'mushroom';
    case HOARD_MOLE_BOSS_TEMPLATE:
      return 'mole';
    case HOARD_BAT_BOSS_TEMPLATE:
      return 'bat';
    case HOARD_MIMIC_BOSS_TEMPLATE:
      return 'mimic';
    default:
      return 'ember';
  }
}

export function pointInHoardAnnulus(
  center: { x: number; z: number },
  point: { x: number; z: number },
  innerRadius: number,
  outerRadius: number,
): boolean {
  const distanceSq = (point.x - center.x) ** 2 + (point.z - center.z) ** 2;
  return distanceSq >= innerRadius * innerRadius && distanceSq <= outerRadius * outerRadius;
}

export function hoardMarkSpec(variant: HoardBossCueVariant): HoardMarkSpec {
  switch (variant) {
    case 'frost-ice':
      return {
        variant,
        radius: 3.8,
        windup: 1.6,
        impactFraction: 0.06,
        hazardDuration: 5,
        pulseFraction: 0.015,
        pulseEvery: 0.6,
        school: 'frost',
        ability: 'Treacherous Ice',
      };
    case 'ember-fire':
      return {
        variant,
        radius: 3,
        windup: 2.1,
        impactFraction: 0.18,
        hazardDuration: 2,
        pulseFraction: 0.03,
        pulseEvery: 0.5,
        school: 'fire',
        ability: 'Emberfall',
      };
    case 'frost-blizzard':
      return {
        variant,
        radius: 7.5,
        windup: 1.8,
        impactFraction: 0.08,
        hazardDuration: 5.5,
        pulseFraction: 0.035,
        pulseEvery: 0.75,
        school: 'frost',
        ability: 'Howling Blizzard',
      };
    case 'frost-ring':
      return {
        variant,
        radius: 8.5,
        innerRadius: 4.5,
        windup: 2.2,
        impactFraction: 0.12,
        hazardDuration: 0,
        pulseFraction: 0,
        pulseEvery: 1,
        school: 'frost',
        ability: 'Ring of Frost',
      };
    // Archon Nyxaris. Voidfall is the steady pressure; Event Horizon into
    // Singularity Collapse is the dance: the whole room burns EXCEPT the eye at
    // its centre, then the eye itself detonates, so the party runs in, then out.
    case 'arcane-voidfall':
      return {
        variant,
        radius: 3.2,
        windup: 1.7,
        impactFraction: 0.16,
        hazardDuration: 4,
        pulseFraction: 0.02,
        pulseEvery: 0.7,
        school: 'arcane',
        ability: 'Voidfall',
      };
    case 'arcane-horizon':
      return {
        variant,
        radius: HOARD_EVENT_HORIZON_RADIUS,
        innerRadius: HOARD_EVENT_HORIZON_EYE_RADIUS,
        windup: 3.4,
        impactFraction: 0.32,
        hazardDuration: 0,
        pulseFraction: 0,
        pulseEvery: 1,
        school: 'arcane',
        ability: 'Event Horizon',
      };
    case 'arcane-collapse':
      return {
        variant,
        radius: HOARD_COLLAPSE_RADIUS,
        windup: 2.2,
        impactFraction: 0.3,
        hazardDuration: 0,
        pulseFraction: 0,
        pulseEvery: 1,
        school: 'arcane',
        ability: 'Singularity Collapse',
      };
    case 'storm-charge':
      return {
        variant,
        radius: HOARD_STORM_FIELD_RADIUS,
        windup: 3.2,
        impactFraction: 0.34,
        hazardDuration: HOARD_STORM_FIELD_SEC,
        pulseFraction: 0.03,
        pulseEvery: 0.75,
        school: 'nature',
        ability: 'Tempest Judgment',
      };
    case 'storm-orbital-impact':
      return {
        variant,
        radius: ORBITAL_LIGHTNING.impactRadius,
        windup: ORBITAL_LIGHTNING.summonDuration + ORBITAL_LIGHTNING.chargeDuration,
        impactFraction: ORBITAL_LIGHTNING.damageFraction,
        hazardDuration: ORBITAL_LIGHTNING.residualDuration,
        pulseFraction: 0,
        pulseEvery: 1,
        school: 'nature',
        ability: 'Orbital Lightning',
      };
    case 'storm-field':
      return {
        variant,
        radius: HOARD_STORM_FIELD_RADIUS,
        windup: 0,
        impactFraction: 0,
        hazardDuration: HOARD_STORM_FIELD_SEC,
        pulseFraction: 0.03,
        pulseEvery: 0.75,
        school: 'nature',
        ability: 'Charged Ground',
      };
    // The Mother of Mushrooms' spore clouds (hoard_mushroom.ts).
    case 'mushroom-spore':
      return {
        variant,
        radius: MUSHROOM.sporeRadius,
        windup: MUSHROOM.sporeWarningSec,
        impactFraction: MUSHROOM.sporeImpactFraction,
        hazardDuration: MUSHROOM.sporeHazardSec,
        pulseFraction: MUSHROOM.sporePulseFraction,
        pulseEvery: MUSHROOM.sporePulseEverySec,
        school: 'nature',
        ability: 'Spore Cloud',
      };
    // Deeprake's falling rocks and the Voracious Chest's cursed coins.
    case 'mole-rock':
      return {
        variant,
        radius: MOLE.rockRadius,
        windup: MOLE.rockWindupSec,
        impactFraction: MOLE.rockDamageFraction,
        hazardDuration: 0,
        pulseFraction: 0,
        pulseEvery: 1,
        school: 'physical',
        ability: 'Falling Rock',
      };
    case 'mimic-coins':
      return {
        variant,
        radius: MIMIC.coinRadius,
        windup: MIMIC.coinWindupSec,
        impactFraction: MIMIC.coinImpactFraction,
        hazardDuration: MIMIC.coinHazardSec,
        pulseFraction: MIMIC.coinPulseFraction,
        pulseEvery: MIMIC.coinPulseEverySec,
        school: 'fire',
        ability: 'Cursed Coins',
      };
    default:
      return {
        variant: 'buried-mark',
        radius: 3,
        windup: 2.1,
        impactFraction: 0.18,
        hazardDuration: 2,
        pulseFraction: 0.03,
        pulseEvery: 0.5,
        school: 'physical',
        ability: 'Buried Mark',
      };
  }
}
