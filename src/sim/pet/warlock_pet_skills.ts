// Signature Warlock-pet utility kept outside the general pet dispatcher.
// The data lives on MobTemplate; this module owns the movement-authority and
// boss-immunity boundary for Gloomshade's anti-kite chain.

import { MOBS } from '../data';
import { PLAYER_BODY_RADIUS } from '../pathfind';
import type { SimContext } from '../sim_context';
import { type Aura, dist2d, type Entity } from '../types';

type RangedPetSkill = {
  range: number;
  school: Aura['school'];
  ability?: string;
  name?: string;
  spellVuln?: { amp: number; duration: number };
  jet?: {
    total: number;
    duration: number;
    interval: number;
    slow: number;
    cooldown: number;
  };
  active?: { cooldown: number };
};

export type PetRangedSkillLauncher = (
  ctx: SimContext,
  pet: Entity,
  target: Entity,
  ranged: RangedPetSkill,
) => void;

function canChainPull(target: Entity): boolean {
  if (target.kind !== 'mob' || target.ownerId !== null || target.aiState === 'evade') return false;
  const template = MOBS[target.templateId];
  return template?.boss !== true && template?.ccImmune !== true && target.ccImmune !== true;
}

function useAbyssalChain(ctx: SimContext, pet: Entity, target: Entity): boolean {
  const chain = MOBS[pet.templateId]?.petChainPull;
  if (!chain || !canChainPull(target)) return false;

  const distance = dist2d(pet.pos, target.pos);
  if (distance <= chain.triggerRange || distance > chain.maxRange) return false;
  if (!ctx.hasLineOfSight(pet, target)) return false;

  // Stop on the same side of the pet rather than snapping through its body.
  const dx = target.pos.x - pet.pos.x;
  const dz = target.pos.z - pet.pos.z;
  const length = Math.hypot(dx, dz) || 1;
  const desiredX = pet.pos.x + (dx / length) * chain.pullRange;
  const desiredZ = pet.pos.z + (dz / length) * chain.pullRange;
  const pulled = ctx.resolveMove(
    target.pos.x,
    target.pos.z,
    desiredX,
    desiredZ,
    PLAYER_BODY_RADIUS,
    target,
  );

  ctx.emit({
    type: 'spellfx',
    sourceId: pet.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'beam',
    ability: chain.ability,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: pet.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'tick',
    ability: chain.ability,
  });

  target.prevPos = { ...target.pos };
  target.pos = ctx.groundPos(pulled.x, pulled.z);
  target.vx = 0;
  target.vy = 0;
  target.vz = 0;
  ctx.rebucket(target);
  pet.facing = Math.atan2(dx, dz);
  pet.petSkillTimer = chain.cooldown;
  return true;
}

function useRangedActive(
  ctx: SimContext,
  pet: Entity,
  target: Entity,
  launchRanged: PetRangedSkillLauncher,
): boolean {
  const ranged = MOBS[pet.templateId]?.petRanged;
  if (!ranged?.active || !ranged.ability || !ranged.name) return false;
  if (target.dead || !ctx.isHostileTo(pet, target)) return false;
  if (dist2d(pet.pos, target.pos) > ranged.range || !ctx.hasLineOfSight(pet, target)) return false;
  pet.facing = Math.atan2(target.pos.x - pet.pos.x, target.pos.z - pet.pos.z);
  launchRanged(ctx, pet, target, ranged);
  pet.petSkillTimer = ranged.active.cooldown;
  return true;
}

/** Uses the current template's pet-bar signature skill against an explicit
 *  target. Shared by the manual command and the AI autocast path. */
export function useWarlockPetSkill(
  ctx: SimContext,
  pet: Entity,
  target: Entity,
  launchRanged: PetRangedSkillLauncher,
): boolean {
  if ((pet.petSkillTimer ?? 0) > 0) return false;
  return useAbyssalChain(ctx, pet, target) || useRangedActive(ctx, pet, target, launchRanged);
}

/** Attempts the current pet template's armed signature autocast. Returns true
 *  when the skill consumed this AI tick. */
export function tryUseWarlockPetSkill(
  ctx: SimContext,
  pet: Entity,
  target: Entity,
  launchRanged: PetRangedSkillLauncher,
): boolean {
  return pet.petAutoSkill === true && useWarlockPetSkill(ctx, pet, target, launchRanged);
}
