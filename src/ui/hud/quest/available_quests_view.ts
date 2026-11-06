// Pure: the quest offers a player can pick up nearby, for the Quest Log's
// Available group (menu consolidation step 8). This was the World Map rail's
// "Available Nearby" list; the rule is unchanged (quest givers in the player's
// current zone whose quest reads available, nearest first), and it now also
// carries the giver's position, so the Quest Log's Show on Map has somewhere
// to pan for a quest that is not in the log yet.

import { getActiveWorldContent, QUESTS, type ZoneDef } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { ownEntry } from '../../known_item';

export interface AvailableQuestOffer {
  readonly questId: string;
  readonly zoneId: string;
  /** Yards from the player to the giver. */
  readonly distance: number;
  readonly minLevel: number | null;
  /** The giver's position (Show on Map). */
  readonly x: number;
  readonly z: number;
}

/** How many offers the group lists (the rail showed the same four). */
export const AVAILABLE_QUEST_LIMIT = 4;

/** Yards per step of a rendered distance. A live distance moves every tick
 *  while the player walks; a bucketed one holds still until the reading
 *  really changes, so a repaint signature over it stays quiet. */
export const AVAILABLE_QUEST_DISTANCE_BUCKET = 10;

export function bucketAvailableQuestDistance(distance: number): number {
  return Math.round(distance / AVAILABLE_QUEST_DISTANCE_BUCKET) * AVAILABLE_QUEST_DISTANCE_BUCKET;
}

export function availableQuestOffers(
  world: Pick<IWorld, 'player' | 'questState'>,
  zone: Pick<ZoneDef, 'id' | 'xMin' | 'xMax' | 'zMin' | 'zMax'>,
  limit = AVAILABLE_QUEST_LIMIT,
): AvailableQuestOffer[] {
  const zoneMinX = zone.xMin ?? Number.NEGATIVE_INFINITY;
  const zoneMaxX = zone.xMax ?? Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const offers: AvailableQuestOffer[] = [];
  // The loaded world's NPCs: a Studio map may move or drop a quest giver.
  for (const npc of Object.values(getActiveWorldContent().npcs)) {
    if (
      npc.pos.x < zoneMinX ||
      npc.pos.x >= zoneMaxX ||
      npc.pos.z < zone.zMin ||
      npc.pos.z >= zone.zMax
    )
      continue;
    for (const questId of npc.questIds) {
      if (seen.has(questId) || world.questState(questId) !== 'available') continue;
      const quest = ownEntry(QUESTS, questId);
      if (!quest) continue;
      seen.add(questId);
      offers.push({
        questId,
        zoneId: zone.id,
        distance: Math.hypot(npc.pos.x - world.player.pos.x, npc.pos.z - world.player.pos.z),
        minLevel: quest.minLevel ?? null,
        x: npc.pos.x,
        z: npc.pos.z,
      });
    }
  }
  offers.sort((a, b) => a.distance - b.distance || a.questId.localeCompare(b.questId));
  return offers.slice(0, limit);
}
