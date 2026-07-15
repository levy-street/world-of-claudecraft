// SwordMaster dual-weapon ability resolution. The module owns selection order
// and paired-hit order while all combat authority stays behind SimContext.

import type { SimContext } from '../sim_context';
import { type AbilityEffect, angleTo, type Entity, MELEE_ARC, normAngle } from '../types';

type DualStrike = Extract<AbilityEffect, { type: 'dualWeaponStrike' }>;
type DualAoe = Extract<AbilityEffect, { type: 'dualWeaponAoe' }>;

interface StrikeOptions {
  threatFlat: number;
  threatMult: number;
  forceCrit: boolean;
}

function squaredDistance(a: Entity, b: Entity): number {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  return dx * dx + dz * dz;
}

/**
 * Return a stable target list before any damage mutates the world. Distance is
 * the primary key and entity id is the exact tie-break, so grid insertion order
 * cannot change RNG draw order or which target survives a cap.
 */
export function orderedSwordmasterTargets(
  ctx: SimContext,
  attacker: Entity,
  effect: DualAoe,
): Entity[] {
  const candidates = ctx
    .hostilesInRadius(attacker, attacker.pos, effect.radius)
    .filter((target) => {
      if (!ctx.hasLineOfSight(attacker, target)) return false;
      if (!effect.frontal) return true;
      const facingDiff = Math.abs(normAngle(angleTo(attacker.pos, target.pos) - attacker.facing));
      return facingDiff <= MELEE_ARC;
    });
  candidates.sort(
    (a, b) => squaredDistance(attacker, a) - squaredDistance(attacker, b) || a.id - b.id,
  );
  return effect.maxTargets === undefined ? candidates : candidates.slice(0, effect.maxTargets);
}

/** Resolve main hand first, then the live off hand. Returns connected hit count. */
export function strikeWithBothWeapons(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  abilityName: string,
  effect: DualStrike | DualAoe,
  options: StrikeOptions,
): number {
  if (target.dead) return 0;
  let connected = 0;
  if (
    ctx.meleeSwing(attacker, target, 0, abilityName, {
      weaponMult: effect.mainhandMult,
      threatFlat: options.threatFlat,
      threatMult: options.threatMult,
      forceCrit: options.forceCrit,
    })
  ) {
    connected++;
  }
  const offhand = attacker.offhandWeapon;
  if (!offhand || target.dead) return connected;
  if (
    ctx.meleeSwing(attacker, target, 0, abilityName, {
      weapon: offhand,
      weaponMult: effect.offhandMult,
      apSwingSpeed: offhand.speed,
      threatMult: options.threatMult,
      forceCrit: options.forceCrit,
    })
  ) {
    connected++;
  }
  return connected;
}

export function resolveSwordmasterDualAoe(
  ctx: SimContext,
  attacker: Entity,
  abilityName: string,
  effect: DualAoe,
  options: StrikeOptions,
): number {
  const targets = orderedSwordmasterTargets(ctx, attacker, effect);
  if (targets.length > 0) {
    ctx.emit({
      type: 'spellfx',
      sourceId: attacker.id,
      targetId: attacker.id,
      school: 'physical',
      fx: 'nova',
    });
  }
  let connected = 0;
  for (const target of targets) {
    connected += strikeWithBothWeapons(ctx, attacker, target, abilityName, effect, options);
  }
  return connected;
}
