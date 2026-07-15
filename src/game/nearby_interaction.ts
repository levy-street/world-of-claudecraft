import { dist2d, type Entity, type GatherNodeDef, INTERACT_RANGE } from '../sim/types';
import { corpseLootAvailability } from './corpse_loot_availability';
import { handleGatherNodeInteract } from './gather_node_interact';

export interface NearbyInteractionWorld {
  player: Entity;
  playerId?: number;
  entities: ReadonlyMap<number, Entity>;
  lootCorpse(id: number): void;
  delveInteract(id: number): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
  pickUpObject(id: number): void;
  resurrectAtSpiritHealer(): void;
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): void;
}

export interface NearbyInteractionHud {
  openMailbox(): void;
  openQuestDialog(npcId: number): void;
  openDelveBoard(npcId: number): void;
  showError(text: string): void;
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
): boolean {
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
      corpseLootAvailability(entity, playerId).hasLoot &&
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
    world.lootCorpse(bestCorpse);
    return true;
  }
  if (bestDelve !== null) {
    world.delveInteract(bestDelve);
    return true;
  }
  if (bestObject !== null) {
    const object = world.entities.get(bestObject);
    if (!object) return false;
    if (object.templateId === 'dungeon_door' && object.dungeonId) {
      world.enterDungeon(object.dungeonId);
    } else if (object.templateId === 'dungeon_exit') {
      world.leaveDungeon();
    } else if (object.templateId === 'mailbox') {
      hud.openMailbox();
    } else {
      world.pickUpObject(bestObject);
    }
    return true;
  }
  if (bestNpc !== null) {
    const npc = world.entities.get(bestNpc);
    if (npc?.kind !== 'npc') return false;
    if (npc.templateId === 'spirit_healer') {
      world.resurrectAtSpiritHealer();
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
