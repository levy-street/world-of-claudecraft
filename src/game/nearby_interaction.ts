import { isQuestGatedGroundObjectHidden } from '../sim/quest_gated_entity';
import { isObjectOpenedByViewer } from '../sim/quests/opened_object_view';
import {
  dist2d,
  type Entity,
  type GatherNodeDef,
  INTERACT_RANGE,
  type QuestProgress,
} from '../sim/types';
import { corpseLootAvailability, localPartyMemberIds } from './corpse_loot_availability';
import { decideEscortPress, handleEscortPress } from './escort_interact';
import {
  decideGatherNodeAction,
  type GatherEffectConfirmGate,
  type GatherNodeToolGate,
  type GatherNodeVerdict,
  handleGatherNodeInteract,
} from './gather_node_interact';
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
  harvestNode(nodeId: string, confirmEffectUse?: boolean): InteractionOutcome;
}

export interface NearbyInteractionHud {
  openMailbox(): void;
  openQuestDialog(npcId: number): void;
  openDelveBoard(npcId: number): void;
  showError(text: string): void;
  requestSpiritHealerResurrect(): void;
}

export type NearbyGatherNode = Pick<GatherNodeDef, 'id' | 'pos' | 'type' | 'tier'>;

export type NearbyInteractionAnchor =
  | { kind: 'entity'; entityId: number }
  | { kind: 'gatherNode'; nodeId: string };

export type NearbyInteractionNameDiscriminator =
  | {
      kind: 'entity';
      entityKind: Entity['kind'];
      templateId: string;
      objectItemId: string | null;
      dungeonId: string | null;
      sourceName: string;
    }
  | { kind: 'gatherNode'; nodeType: GatherNodeDef['type']; nodeTier: number };

interface NearbyEntityInteractionCandidate {
  anchor: Extract<NearbyInteractionAnchor, { kind: 'entity' }>;
  name: Extract<NearbyInteractionNameDiscriminator, { kind: 'entity' }>;
  eligible: true;
}

export type NearbyInteractionCandidate =
  | (NearbyEntityInteractionCandidate & {
      interactionKind: 'corpse';
      harvestable: boolean;
      hasLoot: boolean;
    })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'delve' })
  | (NearbyEntityInteractionCandidate & {
      interactionKind: 'dungeonEnter';
      dungeonId: string;
    })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'dungeonExit' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'mailbox' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'objectPickup' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'spiritHealer' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'delveBoard' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'npc' })
  | (NearbyEntityInteractionCandidate & { interactionKind: 'escort' })
  | {
      interactionKind: 'gather';
      anchor: Extract<NearbyInteractionAnchor, { kind: 'gatherNode' }>;
      name: Extract<NearbyInteractionNameDiscriminator, { kind: 'gatherNode' }>;
      eligible: boolean;
      verdict: GatherNodeVerdict;
      nodePos: NearbyGatherNode['pos'];
      toolGate?: GatherNodeToolGate;
    }
  | {
      interactionKind: 'escortAway';
      anchor: null;
      name: null;
      eligible: false;
    };

export interface NearbyInteractionTexts {
  tooFar: string;
  notReady: string;
  escortAway: string;
  nothing: string;
}

function entityCandidate(
  entity: Entity,
): Pick<NearbyEntityInteractionCandidate, 'anchor' | 'name' | 'eligible'> {
  return {
    anchor: { kind: 'entity', entityId: entity.id },
    name: {
      kind: 'entity',
      entityKind: entity.kind,
      templateId: entity.templateId,
      objectItemId: entity.objectItemId ?? null,
      dungeonId: entity.dungeonId ?? null,
      sourceName: entity.name,
    },
    eligible: true,
  };
}

/** Resolve the exact winner of the general world-interaction ladder without dispatching it. */
export function resolveNearbyInteraction(
  world: NearbyInteractionWorld,
  gatherNodes: readonly NearbyGatherNode[],
  nodeToolGateFor: ((node: NearbyGatherNode) => GatherNodeToolGate) | null,
  harvestStateReliable = true,
  preferNpcId?: number | null,
): NearbyInteractionCandidate | null {
  const player = world.player;
  const playerId = world.playerId ?? player.id;
  const partyIds = localPartyMemberIds(world.partyInfo);
  let bestCorpse: Entity | null = null;
  let bestCorpseDistance = INTERACT_RANGE;
  let bestObject: Entity | null = null;
  let bestObjectDistance = INTERACT_RANGE;
  let bestNpc: Entity | null = null;
  let bestNpcDistance = INTERACT_RANGE + 1;
  let bestDelve: Entity | null = null;
  let bestDelveDistance = INTERACT_RANGE + 1;
  let bestNode: NearbyGatherNode | null = null;
  let bestNodeDistance = INTERACT_RANGE;

  if (!player.dead) {
    for (const node of gatherNodes) {
      const distance = Math.hypot(player.pos.x - node.pos.x, player.pos.z - node.pos.z);
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
      bestCorpse = entity;
      bestCorpseDistance = distance;
    }
    if (!player.dead && entity.kind === 'object' && entity.templateId?.startsWith('delve_')) {
      if (distance < bestDelveDistance) {
        bestDelve = entity;
        bestDelveDistance = distance;
      }
    } else if (
      !player.dead &&
      entity.kind === 'object' &&
      entity.lootable &&
      !isQuestGatedGroundObjectHidden(entity, world.questLog) &&
      !isObjectOpenedByViewer(entity, world.questLog) &&
      distance <= objectInteractionRange(entity) &&
      distance < bestObjectDistance
    ) {
      bestObject = entity;
      bestObjectDistance = distance;
    }
    const promoted =
      preferNpcId !== undefined &&
      preferNpcId !== null &&
      entity.id === preferNpcId &&
      distance <= INTERACT_RANGE;
    if (entity.kind === 'npc' && (promoted || distance < bestNpcDistance)) {
      const isGhostHealer = entity.templateId === 'spirit_healer' && player.ghost;
      const isLivingNpc = entity.templateId !== 'spirit_healer' && !player.dead;
      if (isGhostHealer || isLivingNpc) {
        bestNpc = entity;
        bestNpcDistance = promoted ? -1 : distance;
      }
    }
  }

  if (bestCorpse) {
    const availability = corpseLootAvailability(
      bestCorpse,
      playerId,
      harvestStateReliable,
      partyIds,
    );
    return {
      interactionKind: 'corpse',
      ...entityCandidate(bestCorpse),
      harvestable: availability.harvestable,
      hasLoot: availability.hasLoot,
    };
  }
  if (bestDelve) return { interactionKind: 'delve', ...entityCandidate(bestDelve) };
  if (bestObject) {
    const base = entityCandidate(bestObject);
    if (bestObject.templateId === 'dungeon_door' && bestObject.dungeonId) {
      return {
        interactionKind: 'dungeonEnter',
        ...base,
        dungeonId: bestObject.dungeonId,
      };
    }
    if (bestObject.templateId === 'dungeon_exit') {
      return { interactionKind: 'dungeonExit', ...base };
    }
    if (bestObject.templateId === 'mailbox') return { interactionKind: 'mailbox', ...base };
    return { interactionKind: 'objectPickup', ...base };
  }
  if (bestNpc) {
    const base = entityCandidate(bestNpc);
    if (bestNpc.templateId === 'spirit_healer') {
      return { interactionKind: 'spiritHealer', ...base };
    }
    if (bestNpc.templateId === 'brother_halven' || bestNpc.templateId === 'brother_halven_marsh') {
      return { interactionKind: 'delveBoard', ...base };
    }
    return { interactionKind: 'npc', ...base };
  }

  const escort = player.dead
    ? ({ kind: 'none' } as const)
    : decideEscortPress(player.pos, world.entities, world.questLog);
  if (escort.kind === 'start') {
    const escortee = world.entities.get(escort.entityId);
    if (escortee) return { interactionKind: 'escort', ...entityCandidate(escortee) };
  }
  if (bestNode) {
    const toolGate = nodeToolGateFor?.(bestNode);
    const verdict = decideGatherNodeAction(
      player.pos,
      bestNode.pos,
      world.nodeHarvestableByMe(bestNode.id),
      toolGate,
    );
    return {
      interactionKind: 'gather',
      anchor: { kind: 'gatherNode', nodeId: bestNode.id },
      name: { kind: 'gatherNode', nodeType: bestNode.type, nodeTier: bestNode.tier },
      eligible: verdict === 'harvest',
      verdict,
      nodePos: bestNode.pos,
      ...(toolGate ? { toolGate } : {}),
    };
  }
  if (escort.kind === 'away') {
    return { interactionKind: 'escortAway', anchor: null, name: null, eligible: false };
  }
  return null;
}

/** Dispatch a previously resolved winner. The world remains authoritative for every command. */
export function dispatchNearbyInteraction(
  candidate: NearbyInteractionCandidate | null,
  world: NearbyInteractionWorld,
  hud: NearbyInteractionHud,
  texts: NearbyInteractionTexts,
  effectConfirm?: GatherEffectConfirmGate,
): InteractionOutcome {
  if (!candidate) {
    hud.showError(texts.nothing);
    return false;
  }
  switch (candidate.interactionKind) {
    case 'corpse':
      if (candidate.harvestable) world.harvestCorpse(candidate.anchor.entityId);
      if (candidate.hasLoot) return world.lootCorpse(candidate.anchor.entityId);
      return candidate.harvestable;
    case 'delve':
      return world.delveInteract(candidate.anchor.entityId);
    case 'dungeonEnter':
      return world.enterDungeon(candidate.dungeonId);
    case 'dungeonExit':
      return world.leaveDungeon();
    case 'mailbox':
      hud.openMailbox();
      return true;
    case 'objectPickup':
      return world.pickUpObject(candidate.anchor.entityId);
    case 'spiritHealer':
      hud.requestSpiritHealerResurrect();
      return true;
    case 'delveBoard':
      hud.openDelveBoard(candidate.anchor.entityId);
      return true;
    case 'npc':
      hud.openQuestDialog(candidate.anchor.entityId);
      return true;
    case 'escort':
      return handleEscortPress(
        world,
        hud,
        { kind: 'start', entityId: candidate.anchor.entityId },
        texts.escortAway,
      );
    case 'gather':
      return handleGatherNodeInteract(
        world,
        hud,
        world.player.pos,
        candidate.anchor.nodeId,
        candidate.nodePos,
        texts.tooFar,
        texts.notReady,
        candidate.toolGate,
        effectConfirm,
      );
    case 'escortAway':
      return handleEscortPress(world, hud, { kind: 'away' }, texts.escortAway);
  }
}

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
  // The R40 per-use effect confirm gate, threaded to the node dispatch.
  effectConfirm?: GatherEffectConfirmGate,
  // The npc the caller means, when it has one in mind. The scan is otherwise
  // nearest-wins, which is right for a keypress aimed by walking up to someone and
  // wrong for a pad, where the player SELECTS an npc and then presses talk: without
  // this, pressing talk answered whoever happened to be standing closer. Only ever
  // promotes an npc the scan would already have accepted, so no rule is bypassed.
  preferNpcId?: number | null,
): InteractionOutcome {
  const candidate = resolveNearbyInteraction(
    world,
    gatherNodes,
    nodeToolGateFor,
    harvestStateReliable,
    preferNpcId,
  );
  return dispatchNearbyInteraction(
    candidate,
    world,
    hud,
    {
      tooFar: tooFarText,
      notReady: notReadyText,
      escortAway: escortAwayText,
      nothing: nothingToInteractText,
    },
    effectConfirm,
  );
}
