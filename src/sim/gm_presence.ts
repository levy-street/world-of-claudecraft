// Staff invisibility, the sim half of the in-game /visible on|off command
// (server/moderation_service.ts). A hidden GM leaves the world for everyone
// else: the server omits them (and any pet they own) from every other
// player's snapshot (server/game.ts canObserveEntity), so their body, corpse,
// and nameplate never render; mobs never aggro, track, or keep them on a hate
// table; and no other player or pet can target them, hostile or friendly.
//
// The flag lives on the entity, not on an aura, so it survives death and
// release: a GM who dies while hidden leaves no visible corpse. It is never
// persisted (a relog comes back visible) and the offline Sim never sets it.
//
// No rng draws and no per-tick work: the predicates are flag reads, and the
// roster walk below runs only on the toggle.

import type { SimContext } from './sim_context';
import type { Entity } from './types';

// The hidden GM itself, or an entity a hidden GM owns (a pet, a totem).
export function isGmHidden(entities: ReadonlyMap<number, Entity>, e: Entity): boolean {
  if (e.gmHidden) return true;
  if (e.ownerId === null) return false;
  return entities.get(e.ownerId)?.gmHidden === true;
}

// The player an entity acts for: itself, or its owner.
function controllerId(e: Entity): number {
  return e.ownerId ?? e.id;
}

// Whether `target` is hidden from `actor`. A hidden GM and their own pets
// still see and target each other (a GM can heal their own pet).
export function gmHiddenFrom(
  entities: ReadonlyMap<number, Entity>,
  actor: Entity,
  target: Entity,
): boolean {
  return isGmHidden(entities, target) && controllerId(actor) !== controllerId(target);
}

// Hide or reveal a player. Hiding releases every lock anyone else holds on the
// GM or their pets, the same release stealth performs (combat/stealth.ts) but
// unconditional: a mob drops its aggro, target, and taunt lock so its next
// tick re-evaluates (mob/targeting.ts then prunes the GM from its hate table),
// and every other player drops the GM as a target or follow target, friend
// or foe, so no client keeps a frame on someone it can no longer see.
export function setGmHidden(ctx: SimContext, gm: Entity, hidden: boolean): void {
  if (hidden) gm.gmHidden = true;
  else delete gm.gmHidden;
  if (!hidden) return;
  const hiddenIds = new Set<number>([gm.id]);
  for (const e of ctx.entities.values()) {
    if (e.ownerId === gm.id) hiddenIds.add(e.id);
  }
  for (const e of ctx.entities.values()) {
    if (controllerId(e) === gm.id) continue;
    if (e.kind === 'mob') {
      if (e.aggroTargetId !== null && hiddenIds.has(e.aggroTargetId)) e.aggroTargetId = null;
      if (e.targetId !== null && hiddenIds.has(e.targetId)) e.targetId = null;
      if (e.forcedTargetId !== null && hiddenIds.has(e.forcedTargetId)) {
        e.forcedTargetId = null;
        e.forcedTargetTimer = 0;
      }
    } else if (e.kind === 'player') {
      if (e.followTargetId !== null && hiddenIds.has(e.followTargetId)) ctx.stopFollow(e);
      if (e.targetId !== null && hiddenIds.has(e.targetId)) {
        e.targetId = null;
        e.autoAttack = false;
        e.queuedOnSwing = null;
        delete e.queuedOnSwingFree;
        delete e.queuedOnSwingCostMultiplier;
      }
    }
  }
}
