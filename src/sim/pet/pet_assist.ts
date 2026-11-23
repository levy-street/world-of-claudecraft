// The Assist pet stance: the pet fights only what its owner is fighting.
//
// An assisting pet attacks the enemy its owner last cast an ability on, and
// only while that enemy is still the owner's active target. It never answers
// an enemy that attacks the owner or the pet (unlike defensive), and never
// picks a fight on its own (unlike aggressive). Switching target without
// casting stands it down until the owner casts on the new target.
//
// The owner's half is recorded at the one point a cast becomes certain
// (casting_lifecycle.castAbility, after every refusal has cleared); the pet's
// half is read by pet_ai (petPickTarget and updatePet's target retention).
// `src/sim`-pure and rng-free.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, PetMode } from '../types';

/** Every pet stance, in pet-bar menu order. */
export const PET_MODES: readonly PetMode[] = ['passive', 'defensive', 'aggressive', 'assist'];

const PET_MODE_SET: ReadonlySet<string> = new Set(PET_MODES);

/** Guards an untrusted wire value (the `pet_mode` command) before it reaches the sim. */
export function isPetMode(value: unknown): value is PetMode {
  return typeof value === 'string' && PET_MODE_SET.has(value);
}

/** Record the enemy a committed cast is aimed at. A friendly or self cast leaves
 *  the previous one in place, so a heal between two strikes does not stand the
 *  pet down. */
export function notePetAssistCast(
  ctx: Pick<SimContext, 'isHostileTo'>,
  caster: Entity,
  meta: Pick<PlayerMeta, 'petAssistTargetId'>,
  target: Entity | null,
): void {
  if (!target || target.id === caster.id || target.dead) return;
  if (!ctx.isHostileTo(caster, target)) return;
  meta.petAssistTargetId = target.id;
}

/** The owner's active target, when it is the enemy they last cast on: the only
 *  unit an assisting pet may acquire. Liveness and visibility stay pet_ai's. */
export function petAssistTargetId(
  owner: Pick<Entity, 'targetId'>,
  meta: Pick<PlayerMeta, 'petAssistTargetId'> | undefined,
): number | null {
  const targetId = owner.targetId;
  if (targetId === null || !meta || meta.petAssistTargetId !== targetId) return null;
  return targetId;
}

/** An assisting pet keeps a target only while it is the owner's active one. This
 *  also covers a target the Pet Attack command handed it. */
export function petAssistKeepsTarget(owner: Pick<Entity, 'targetId'>, target: Entity): boolean {
  return owner.targetId === target.id;
}
