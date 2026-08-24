import { playerAttackResolution } from '../../../sim/combat/directional_attack';
import type { AbilityDef, AbilityEffect, Entity } from '../../../sim/types';
import { MELEE_RANGE } from '../../../sim/types';

export interface AimPoint {
  x: number;
  z: number;
}

export interface GroundAimState {
  activeAbilityId: string | null;
  activeSlot: number | null;
}

export const DEFAULT_GROUND_AOE_RADIUS = 6;

export type AbilityPreviewKind = 'circle' | 'area' | 'meleeCone' | 'directionLine';

/** Visual geometry keyed from the same resolver category the server applies. */
export function abilityPreviewKind(ability: AbilityDef): AbilityPreviewKind {
  const resolution = playerAttackResolution(ability);
  if (resolution === 'meleeCone') return 'meleeCone';
  if (resolution === 'ballisticProjectile' || resolution === 'directionalHitscan') {
    return 'directionLine';
  }
  if (resolution === 'selfArea') return 'area';
  return 'circle';
}

/** Melee follows character facing; ranged guides follow the live combat aim. */
export function abilityPreviewAngle(
  kind: AbilityPreviewKind,
  caster: Pick<Entity, 'pos' | 'facing'>,
  aim: AimPoint | null,
): number {
  if (kind === 'meleeCone' || !aim) return caster.facing;
  const dx = aim.x - caster.pos.x;
  const dz = aim.z - caster.pos.z;
  return Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : caster.facing;
}

/** Touch normally keeps instant target-feet casting, but Meteor needs an
 * explicit terrain tap so it never falls on the caster merely for lacking a
 * selected target. Desktop remains governed by the player's reticle setting. */
export function shouldUseGroundAim(
  abilityId: string,
  mobileTouch: boolean,
  desktopPreference: boolean,
): boolean {
  return mobileTouch ? abilityId === 'meteor' : desktopPreference;
}

/** Desktop combat skills enter a confirmable prepared state. Touch keeps its
 * existing direct-cast controls, apart from authored ground placement. */
export function shouldPrepareAbility(
  ability: Pick<AbilityDef, 'id' | 'targetMode' | 'selfCentered'>,
  mobileTouch: boolean,
  groundPlacementEnabled: boolean,
): boolean {
  if (mobileTouch) {
    return ability.targetMode === 'position' && !ability.selfCentered && groundPlacementEnabled;
  }
  if (ability.targetMode === 'position' && !ability.selfCentered) {
    return groundPlacementEnabled;
  }
  return true;
}

export function createGroundAimState(): GroundAimState {
  return { activeAbilityId: null, activeSlot: null };
}

export function enterGroundAim(
  state: GroundAimState,
  abilityId: string,
  slot: number,
): GroundAimState {
  return { ...state, activeAbilityId: abilityId, activeSlot: slot };
}

export function cancelGroundAim(state: GroundAimState): GroundAimState {
  if (state.activeAbilityId === null && state.activeSlot === null) return state;
  return { ...state, activeAbilityId: null, activeSlot: null };
}

export function commitGroundAim(state: GroundAimState): {
  state: GroundAimState;
  abilityId: string | null;
} {
  const abilityId = state.activeAbilityId;
  return { state: cancelGroundAim(state), abilityId };
}

export function clampAimToRange(
  caster: Pick<Entity, 'pos'>,
  point: AimPoint,
  range: number,
): {
  point: AimPoint;
  clamped: boolean;
} {
  const maxRange = range > 0 ? range : 5;
  const dx = point.x - caster.pos.x;
  const dz = point.z - caster.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxRange || d === 0) return { point: { x: point.x, z: point.z }, clamped: false };
  return {
    point: {
      x: caster.pos.x + (dx / d) * maxRange,
      z: caster.pos.z + (dz / d) * maxRange,
    },
    clamped: true,
  };
}

export function abilityAoeRadius(res: {
  def?: Pick<AbilityDef, 'impactArea'>;
  effects: readonly AbilityEffect[];
}): number {
  return explicitAbilityAoeRadius(res) ?? DEFAULT_GROUND_AOE_RADIUS;
}

export function explicitAbilityAoeRadius(res: {
  def?: Pick<AbilityDef, 'impactArea'>;
  effects: readonly AbilityEffect[];
}): number | null {
  if (res.def?.impactArea) return res.def.impactArea.radius;
  const effect = res.effects.find(
    (eff) =>
      eff.type === 'aoeDamage' || eff.type === 'groundAoE' || eff.type === 'temporalHourglass',
  );
  if (effect?.type === 'temporalHourglass') return effect.captureRadius;
  return effect && 'radius' in effect ? effect.radius : null;
}

/** Radius of the player-centered maximum-range guide for a prepared skill. */
export function abilityPreviewRange(res: {
  def: Pick<AbilityDef, 'range' | 'requiresTarget' | 'selfCentered' | 'impactArea'>;
  effects: readonly AbilityEffect[];
}): number {
  if (res.def.range > 0) return res.def.range;
  const authoredArea = explicitAbilityAoeRadius(res);
  if (authoredArea !== null) return authoredArea;
  return res.def.requiresTarget ? MELEE_RANGE : 0;
}
