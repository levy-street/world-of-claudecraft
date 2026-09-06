// The body the Professions window's "Harvest a body" entry examines
// (intentional gathering PR1). Tab and pad target cycling skip dead mobs, so a
// keyboard, pad or touch player needs an explicit route to the corpse choice
// popup; this names WHICH body that route opens. It sends nothing: the popup's
// own Harvest control is the only thing that ever harvests.
//
// Pure and DOM-free (the click_move / pointer_pick pattern): an IWorld-shaped
// bag in, an entity id or null out, no clock, no rng. Selection: the viewer's
// targeted body wins when it is eligible and within harvest reach, else the
// nearest eligible body, with a distance tie going to the lower entity id so
// both hosts and repeated presses agree.

import { dist2d, type Entity, INTERACT_RANGE } from '../sim/types';
import { corpseLootAvailability, localPartyMemberIds } from './corpse_loot_availability';

/** The corpse popup's reach, consumed by loot_window_controller.ts as its
 *  CORPSE_POPUP_RANGE: how far the player may drift before an OPEN popup
 *  closes itself. Deliberately WIDER than the reach a harvest needs, and
 *  deliberately NOT this module's gate (see pickHarvestBody): a popup that
 *  survives a step backwards is a courtesy, while an entry that NAMES a body
 *  out of harvest reach is a lie. */
export const HARVEST_BODY_RANGE = 7;

export interface HarvestBodyPickWorld {
  player: Entity;
  playerId?: number;
  partyInfo?: { members: readonly { pid: number }[] } | null;
  entities: ReadonlyMap<number, Entity>;
}

function harvestOpenFor(
  world: HarvestBodyPickWorld,
  entity: Entity,
  viewerId: number,
  partyIds: readonly number[] | null,
): boolean {
  return (
    entity.kind === 'mob' &&
    entity.dead &&
    entity.lootable &&
    dist2d(world.player.pos, entity.pos) <= INTERACT_RANGE &&
    corpseLootAvailability(entity, viewerId, true, partyIds).harvestable
  );
}

/** The body to open the harvest choice for, or null when no body in reach still
 *  has its harvest (the caller shows the nothing-to-interact line). A dead
 *  viewer never examines anything.
 *
 *  The reach is INTERACT_RANGE, the sim's OWN harvest gate (harvestCorpse in
 *  src/sim/interaction.ts refuses "Too far away." past it), NOT the popup's
 *  wider close range. This entry is the keyboard, pad and touch route to a
 *  harvest, so a body it names must be one the command would actually accept:
 *  picking at the popup's reach opened the choice, enabled Harvest, and then
 *  toasted a refusal for every body in the band between the two. The popup
 *  keeps its own wider range for the DRIFT it is for (an already-open choice
 *  surviving a step backwards), which is a different question. */
export function pickHarvestBody(world: HarvestBodyPickWorld): number | null {
  const player = world.player;
  if (player.dead) return null;
  const viewerId = world.playerId ?? player.id;
  const partyIds = localPartyMemberIds(world.partyInfo);
  if (player.targetId !== null) {
    const target = world.entities.get(player.targetId);
    if (target && harvestOpenFor(world, target, viewerId, partyIds)) return target.id;
  }
  let bestId: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of world.entities.values()) {
    if (!harvestOpenFor(world, entity, viewerId, partyIds)) continue;
    const distance = dist2d(player.pos, entity.pos);
    if (
      distance < bestDistance ||
      (distance === bestDistance && bestId !== null && entity.id < bestId)
    ) {
      bestId = entity.id;
      bestDistance = distance;
    }
  }
  return bestId;
}
