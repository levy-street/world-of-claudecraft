import {
  dist2d,
  type Entity,
  type GatherNodeDef,
  INTERACT_RANGE,
  type QuestProgress,
} from '../sim/types';
import { corpseLootAvailability, localPartyMemberIds } from './corpse_loot_availability';
import { decideEscortPress, handleEscortPress } from './escort_interact';
import { type GatherNodeToolGate, handleGatherNodeInteract } from './gather_node_interact';
import type { InteractionOutcome } from './interaction_autorun';
import { objectInteractionRange } from './interactions';

export interface NearbyInteractionWorld {
  player: Entity;
  playerId?: number;
  // Local party roster for the corpse rights check (IWorld.partyInfo satisfies
  // this structurally); optional so party-less fixtures stay valid.
  partyInfo?: { members: readonly { pid: number }[] } | null;
  entities: ReadonlyMap<number, Entity>;
  // The viewer's quest log, for the escort arm below (an escortee is only
  // startable while its quest is active). Required, not optional: an escort
  // quest has NO other client entry point, so a silently unwired arm would
  // make the quest uncompletable again.
  questLog: ReadonlyMap<string, QuestProgress>;
  targetEntity(id: number | null): void;
  interact(): void;
  lootCorpse(id: number): InteractionOutcome;
  // Fire-and-forget half of the unified corpse press; omitting the
  // components argument selects the caller's town-focus default server-side.
  harvestCorpse(id: number): void;
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

type NearbyGatherNode = Pick<GatherNodeDef, 'id' | 'pos' | 'type' | 'tier'>;

/** Find and dispatch one eligible nearby interaction in stable priority order.
 *  `nodeToolGateFor` (Professions 2.0) resolves the tool-tier access
 *  gate + localized denial line for the node about to be harvested; it sits
 *  with the node list (not trailing) so the live call site (main.ts
 *  interactKey) still closes on the nothing-to-interact string, as pinned by
 *  tests/client_shell.test.ts. `escortAwayText` sits before that same string
 *  for the same reason. */
export function tryNearbyInteraction(
  world: NearbyInteractionWorld,
  hud: NearbyInteractionHud,
  gatherNodes: readonly NearbyGatherNode[],
  nodeToolGateFor: ((node: NearbyGatherNode) => GatherNodeToolGate) | null,
  tooFarText: string,
  notReadyText: string,
  escortAwayText: string,
  nothingToInteractText: string,
  harvestStateReliable = true,
): InteractionOutcome {
  const player = world.player;
  const playerId = world.playerId ?? player.id;
  const partyIds = localPartyMemberIds(world.partyInfo);
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
      corpseLootAvailability(entity, playerId, harvestStateReliable, partyIds).canOpen &&
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
      if (distance <= objectInteractionRange(entity) && distance < bestObjectDistance) {
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
    const corpse = world.entities.get(bestCorpse);
    if (!corpse) return false;
    // Unified press: harvest first, then loot, as two separate
    // commands (processed in receipt order in the same server tick batch).
    // Each half is gated on the availability predicate so a claimed or
    // emptied half is never dispatched (no denial-toast spam); the server
    // still revalidates both authoritatively.
    const availability = corpseLootAvailability(corpse, playerId, harvestStateReliable, partyIds);
    if (availability.harvestable) world.harvestCorpse(bestCorpse);
    if (availability.hasLoot) return world.lootCorpse(bestCorpse);
    return availability.harvestable;
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
  // STARTING an escort sits below the npc arm (an escortee is mob-kind, so the
  // two can never compete) and above gather nodes: an escortee standing in
  // front of you beats the node you happen to be over. Corpses still win, so
  // looting the ambush wave is never swallowed.
  const escort = player.dead
    ? ({ kind: 'none' } as const)
    : decideEscortPress(player.pos, world.entities, world.questLog);
  if (escort.kind === 'start') return handleEscortPress(world, hud, escort, escortAwayText);
  if (bestNode !== null) {
    return handleGatherNodeInteract(
      world,
      hud,
      player.pos,
      bestNode.id,
      bestNode.pos,
      tooFarText,
      notReadyText,
      nodeToolGateFor?.(bestNode),
    );
  }
  // The away line is a LAST resort that only replaces the generic
  // nothing-to-interact message: an absent escortee must never eat a press that
  // some other arm above could have used (a node underfoot at an empty post).
  if (escort.kind === 'away') return handleEscortPress(world, hud, escort, escortAwayText);
  hud.showError(nothingToInteractText);
  return false;
}
