// The Assist pet stance: the pet fights only what its owner is fighting.
//
// An assisting pet attacks the enemy its owner last cast an ability on, and
// only while that enemy is still the owner's active target. It never answers
// an enemy that attacks the owner or the pet (unlike defensive), and never
// picks a fight on its own (unlike aggressive). Switching target without
// casting stands it down until the owner casts on the new target. The cast lasts
// for the fight it opened: once the owner has been out of combat (and not
// casting) for 2 sec the record is forgotten, so a fresh fight, even on the same
// boss after a wipe, needs a fresh cast.
//
// The owner's half is recorded at the one point a cast becomes certain
// (casting_lifecycle.castAbility, after every refusal has cleared) and expired by
// the sim's per-player engaged pass; the pet's half is read by pet_ai
// (petPickTarget and updatePet's target retention).
// `src/sim`-pure and rng-free.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type PetMode } from '../types';

/** How long a cast stays valid before its fight registers combat: covers an
 *  opener's projectile still in flight. */
const PET_ASSIST_OPENER_GRACE_TICKS = Math.round(2 / DT);

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
  ctx: Pick<SimContext, 'isHostileTo' | 'tickCount'>,
  caster: Entity,
  meta: Pick<PlayerMeta, 'petAssistTargetId' | 'petAssistCastTick'>,
  target: Entity | null,
): void {
  if (!target || target.id === caster.id || target.dead) return;
  if (!ctx.isHostileTo(caster, target)) return;
  meta.petAssistTargetId = target.id;
  meta.petAssistCastTick = ctx.tickCount;
}

/** Forget the recorded cast once its fight is over. Run once per player per tick
 *  from the sim's engaged pass, right after `inCombat` is settled, so it never
 *  depends on a pet ticking (a dead, dismissed or crowd-controlled pet skips
 *  updatePet). While the owner is in combat or casting the record stays live; it
 *  is dropped after PET_ASSIST_OPENER_GRACE_TICKS of neither, counted from the
 *  later of the cast and the last live tick, which covers an opener still in
 *  flight after its cast bar ends. A world boss resets on a wipe without dying and
 *  keeps its id, so a record that outlived the fight let a plain reselect send the
 *  pet in. */
export function expireStalePetAssistCast(
  owner: Pick<Entity, 'inCombat' | 'castingAbility'>,
  meta: Pick<PlayerMeta, 'petAssistTargetId' | 'petAssistCastTick' | 'petAssistLiveTick'>,
  tickCount: number,
): void {
  if (meta.petAssistTargetId == null) return;
  if (owner.inCombat || owner.castingAbility) {
    meta.petAssistLiveTick = tickCount;
    return;
  }
  const lastLive = Math.max(meta.petAssistCastTick ?? 0, meta.petAssistLiveTick ?? 0);
  if (tickCount - lastLive > PET_ASSIST_OPENER_GRACE_TICKS) meta.petAssistTargetId = null;
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
