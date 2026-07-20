import { dist2d, type Entity, type GatherNodeDef, INTERACT_RANGE } from '../sim/types';
import { corpseLootAvailability } from './corpse_loot_availability';
import { handleGatherNodeInteract } from './gather_node_interact';
import type { InteractionOutcome } from './interaction_autorun';

export interface NearbyInteractionWorld {
  player: Entity;
  playerId?: number;
  entities: ReadonlyMap<number, Entity>;
  lootCorpse(id: number): InteractionOutcome;
  delveInteract(id: number): InteractionOutcome;
  enterDungeon(dungeonId: string): InteractionOutcome;
  leaveDungeon(): InteractionOutcome;
  pickUpObject(id: number): InteractionOutcome;
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): InteractionOutcome;
}

export interface NearbyInteractionHud {
  openMailbox(): void;
  openQuestDialog(npcId: number): void;
  openDelveBoard(npcId: number): void;
  showError(text: string): void;
  requestSpiritHealerResurrect(): void;
}

type NearbyGatherNode = Pick<GatherNodeDef, 'id' | 'pos'>;

/** Find and dispatch one eligible nearby interaction in stable priority order. */
export function tryNearbyInteraction(
  world: NearbyInteractionWorld,
  hud: NearbyInteractionHud,
  gatherNodes: readonly NearbyGatherNode[],
  tooFarText: string,
  notReadyText: string,
  nothingToInteractText: string,
  harvestStateReliable = true,
): InteractionOutcome {
  const player = world.player;
  const playerId = world.playerId ?? player.id;
  let bestCorpse: number | null = null;
  let bestCorpseDistance = INTERACT_RANGE;
  let bestObject: number | null = null;
  let bestObjectDistance = INTERACT_RANGE;
  let bestNpc: number | null = null;
  let bestNpcDistance = INTERACT_RANGE + 1;
  let bestDelve: number | null = null;
  let bestDelveDistance = INTERACT_RANGE + 1;
  let bestNode: NearbyGatherNode | null = null;
  let bestNodeDistance = INTERACT_RANGE;

  if (!player.dead) {
    for (const node of gatherNodes) {
      const distance = dist2d(player.pos, {
        x: node.pos.x,
        y: player.pos.y,
        z: node.pos.z,
      });
      if (distance < bestNodeDistance) {
        bestNode = node;
        bestNodeDistance = distance;
      }
    }
  }

  for (const entity of world.entities.values()) {
    const distance = dist2d(player.pos, entity.pos);
    if (
      !player.dead &&
      entity.kind === 'mob' &&
      entity.dead &&
      entity.lootable &&
      corpseLootAvailability(entity, playerId, harvestStateReliable).hasLoot &&
      distance < bestCorpseDistance
    ) {
      bestCorpse = entity.id;
      bestCorpseDistance = distance;
    }
    if (!player.dead && entity.kind === 'object' && entity.templateId?.startsWith('delve_')) {
      if (distance < bestDelveDistance) {
        bestDelve = entity.id;
        bestDelveDistance = distance;
      }
    } else if (!player.dead && entity.kind === 'object' && entity.lootable) {
      if (distance < bestObjectDistance) {
        bestObject = entity.id;
        bestObjectDistance = distance;
      }
    }
    if (entity.kind === 'npc' && distance < bestNpcDistance) {
      const isGhostHealer = entity.templateId === 'spirit_healer' && player.ghost;
      const isLivingNpc = entity.templateId !== 'spirit_healer' && !player.dead;
      if (isGhostHealer || isLivingNpc) {
        bestNpc = entity.id;
        bestNpcDistance = distance;
      }
    }
  }

  if (bestCorpse !== null) {
    return world.lootCorpse(bestCorpse);
  }
  if (bestDelve !== null) {
    return world.delveInteract(bestDelve);
  }
  if (bestObject !== null) {
    const object = world.entities.get(bestObject);
    if (!object) return false;
    if (object.templateId === 'dungeon_door' && object.dungeonId) {
      return world.enterDungeon(object.dungeonId);
    } else if (object.templateId === 'dungeon_exit') {
      return world.leaveDungeon();
    } else if (object.templateId === 'mailbox') {
      hud.openMailbox();
      return true;
    } else {
      return world.pickUpObject(bestObject);
    }
  }
  if (bestNpc !== null) {
    const npc = world.entities.get(bestNpc);
    if (npc?.kind !== 'npc') return false;
    if (npc.templateId === 'spirit_healer') {
      // The scan only picks a spirit healer for a ghost; route the revive
      // through the HUD's confirm gate rather than sending the command
      // directly (it applies The Keeper's Toll).
      hud.requestSpiritHealerResurrect();
    } else if (npc.templateId === 'brother_halven' || npc.templateId === 'brother_halven_marsh') {
      hud.openDelveBoard(bestNpc);
    } else {
      hud.openQuestDialog(bestNpc);
    }
    return true;
  }
  if (bestNode !== null) {
    return handleGatherNodeInteract(
      world,
      hud,
      player.pos,
      bestNode.id,
      bestNode.pos,
      tooFarText,
      notReadyText,
    );
  }
  hud.showError(nothingToInteractText);
  return false;
}
