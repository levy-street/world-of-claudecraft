// "Nobody has eyes on me any more": the targeting half of entering stealth.
//
// Concealment used to change only what a hostile could ACQUIRE, never what it
// was ALREADY holding. A hunter or warlock pet that had the rogue as its
// aggroTargetId kept it across the stealth cast: updatePet only drops a held
// target when petCanSeeTarget fails, and a stealthed player inside the pet's
// detection radius still passes that, so the pet carried on beating on someone
// the owner could no longer see or click. Same shape for a hostile player's own
// selection, which simply stayed pointed at the vanished rogue.
//
// Entering stealth now clears the caster out of every hostile's focus:
//   - mobs and pets lose the hate-table entry, the taunt lock, and the aggro
//     target (dropThreat owns the forcedTargetId release);
//   - hostile players lose the selection, the auto-attack it was feeding, and
//     any swing they had queued onto it.
// Re-acquisition afterwards is unchanged and still goes through the ordinary
// stealth-perception rules (threat.canDetectStealthedTarget), so this removes
// the STALE lock rather than making stealth undetectable.
//
// `src/sim`-pure: no rng, no clock, no DOM. Every mutation is in-place on the
// entities the seam already owns (the module-wide immutability waiver that the
// rest of src/sim/combat runs under).
import type { SimContext } from '../sim_context';
import { dropThreat } from '../threat';
import type { Entity } from '../types';

/**
 * Remove `focusIds` from ONE hostile mob's threat table, taunt lock and aggro
 * target, and settle whatever that leaves behind (an owned pet with nothing to
 * hit leaves combat; a wild mob with an empty table evades home).
 *
 * Per-entity rather than per-world on purpose: the caller owns the single pass
 * over the entity map, so nothing here can turn into a second sweep.
 */
function dropMobFocus(mob: Entity, focusIds: readonly number[]): void {
  let dropped = false;
  for (const id of focusIds) {
    if (mob.threat.has(id) || mob.forcedTargetId === id) dropped = true;
    dropThreat(mob, id);
    if (mob.aggroTargetId === id) {
      mob.aggroTargetId = null;
      dropped = true;
    }
  }
  if (!dropped) return;
  if (mob.ownerId !== null) {
    if (mob.aggroTargetId === null) mob.inCombat = false;
  } else if (mob.threat.size === 0 && mob.aggroTargetId === null) {
    mob.aiState = 'evade';
    mob.inCombat = false;
  }
}

/**
 * Drop the caster out of every hostile's targeting. Hostile players lose the
 * selection, the auto-attack it was feeding, and any swing queued onto it;
 * hostile mobs and pets lose the hate-table entry, the taunt lock and the
 * aggro target. The CASTER's own target is deliberately left alone (a rogue
 * slips into Duskveil precisely to open on what they are already looking at).
 *
 * `alsoDropped` carries any EXTRA ids the same entry must shake loose:
 * Smokestep's combat drop adds the caster's pet, which escapes with its owner.
 *
 * One cast, ONE pass. The mob arm and the player arm settle disjoint entity
 * kinds, and extra ids ride along, so nothing here justifies walking the whole
 * world a second time.
 */
export function clearHostileTargetingOnStealth(
  ctx: SimContext,
  hidden: Entity,
  alsoDropped: readonly number[] = [],
): void {
  const focusIds = alsoDropped.length === 0 ? [hidden.id] : [hidden.id, ...alsoDropped];
  for (const entity of ctx.entities.values()) {
    if (entity.dead) continue;
    if (entity.kind === 'mob') {
      if (ctx.isHostileTo(hidden, entity)) dropMobFocus(entity, focusIds);
      continue;
    }
    if (entity.kind !== 'player' || entity.id === hidden.id) continue;
    if (
      entity.targetId === null ||
      !focusIds.includes(entity.targetId) ||
      !ctx.isHostileTo(hidden, entity)
    )
      continue;
    entity.targetId = null;
    entity.autoAttack = false;
    entity.queuedOnSwing = null;
    delete entity.queuedOnSwingFree;
    delete entity.queuedOnSwingCostMultiplier;
    // combatTimer is deliberately untouched: losing sight of one opponent is
    // not leaving the fight, and forcing it would drop a hostile who is still
    // swinging at somebody else out of combat.
  }
}
