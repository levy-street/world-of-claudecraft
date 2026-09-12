import { isQuestGatedGroundObjectHidden } from '../sim/quest_gated_entity';
import { isObjectOpenedByViewer } from '../sim/quests/opened_object_view';
import {
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type InvSlot,
  type QuestProgress,
} from '../sim/types';
import type { FarmPatchDef } from '../world_api/farming';
import { corpseLootAvailability, localPartyMemberIds } from './corpse_loot_availability';
import { decideEscortPress } from './escort_interact';
import { nearestInteractableBed } from './farm_bed_interact';
import { nearestInteractableFeast } from './feast_interact';
import { pickHarvestBody } from './harvest_body_pick';
import { objectInteractionRange } from './interactions';

export interface NearbyInteractionScanWorld {
  player: Entity;
  playerId?: number;
  partyInfo?: { members: readonly { pid: number }[] } | null;
  entities: ReadonlyMap<number, Entity>;
  questLog: ReadonlyMap<string, QuestProgress>;
  farmPatches: readonly FarmPatchDef[];
  /** The viewer's bags, read ONLY by the last-resort corpse harvest-choice arm
   *  (a carried Field Kit is what makes a harvest-only body openable at all,
   *  `harvest_body_pick.ts`). Optional so a scan slice that carries no bags (a
   *  bare fixture, a host with no inventory mirror) simply has no such arm;
   *  IWorld satisfies it structurally. */
  inventory?: readonly Pick<InvSlot, 'itemId' | 'count'>[];
}

export type NearbyInteractionCandidate =
  | { kind: 'corpse'; id: number; entity: Entity }
  /** A harvest-only body the press OPENS the corpse choice for (never harvests):
   *  the keyboard, pad and touch route to the popup's own Harvest control. */
  | { kind: 'harvest'; id: number; entity: Entity }
  | { kind: 'delve'; id: number; entity: Entity }
  | { kind: 'object'; id: number; entity: Entity }
  | { kind: 'npc'; id: number; entity: Entity }
  | { kind: 'escort'; id: number; entity: Entity }
  | { kind: 'feast'; id: number; entity: Entity }
  | { kind: 'bed'; id: string }
  | { kind: 'escortAway'; id: null };

/** Resolve the one eligible nearby interaction dispatch will run, without
 *  running it. This is dispatch's shared candidate resolution: the ladder IS
 *  the press ladder in nearby_interaction.ts, arm for arm, so the two can never
 *  read a different world: corpse (ordinary loot only), delve, ground object,
 *  npc, escort start, placed feast, garden bed, the corpse harvest CHOICE, then
 *  the escort-away last resort. Intentional gathering made the generic press
 *  ORDINARY INTERACTION ONLY, so there is deliberately no gather or
 *  corpse-harvest arm here: those are explicit actions with their own entry
 *  points (node/tool/crop click, the corpse picker, the bed sheet's own
 *  Harvest control). The harvest-choice arm is the bed arm's shape applied
 *  to a body: it OPENS the corpse popup (whose Harvest control is the only
 *  thing that ever sends harvestCorpse) for a Field Kit carrier, and it sits
 *  last so a harvest-only body still never swallows an eligible ordinary
 *  interaction standing behind it. Before v0.42 the press harvested on the
 *  spot; without this rung a keyboard, pad or mobile-button player had no
 *  natural way to reach the popup at all. */
export function resolveNearbyInteractionCandidate(
  world: NearbyInteractionScanWorld,
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

  for (const entity of world.entities.values()) {
    const distance = dist2d(player.pos, entity.pos);
    // A corpse is a candidate only for the ordinary loot this viewer may take
    // (hasLoot, never canOpen): a harvest-only corpse is no candidate here, so
    // it cannot swallow an eligible interaction standing behind it.
    if (
      !player.dead &&
      entity.kind === 'mob' &&
      entity.dead &&
      entity.lootable &&
      corpseLootAvailability(entity, playerId, harvestStateReliable, partyIds).hasLoot &&
      distance < bestCorpseDistance
    ) {
      bestCorpse = entity;
      bestCorpseDistance = distance;
    }
    if (!player.dead && entity.kind === 'object' && entity.templateId.startsWith('delve_')) {
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
    return {
      kind: 'corpse',
      id: bestCorpse.id,
      entity: bestCorpse,
    };
  }
  if (bestDelve) {
    return {
      kind: 'delve',
      id: bestDelve.id,
      entity: bestDelve,
    };
  }
  if (bestObject) {
    return {
      kind: 'object',
      id: bestObject.id,
      entity: bestObject,
    };
  }
  if (bestNpc) {
    return {
      kind: 'npc',
      id: bestNpc.id,
      entity: bestNpc,
    };
  }
  const escort = player.dead
    ? ({ kind: 'none' } as const)
    : decideEscortPress(player.pos, world.entities, world.questLog);
  if (escort.kind === 'start') {
    // TERMINAL, like upstream's own arm: decideEscortPress derives the id from
    // THIS map, so the lookup cannot miss, and a miss must not hand the press
    // down to the feast or bed arms behind it.
    const entity = world.entities.get(escort.entityId);
    return entity
      ? {
          kind: 'escort',
          id: entity.id,
          entity,
        }
      : null;
  }
  // A PLACED TRANSIENT outranks permanent world furniture (ruling 11b-R3c-1):
  // a feast despawns on a timer and is what the player just walked to, so it
  // sits above the garden bed that is always there.
  if (!player.dead) {
    const feastId = nearestInteractableFeast(world.entities, player.pos);
    const feast = feastId === null ? undefined : world.entities.get(feastId);
    if (feast) {
      return {
        kind: 'feast',
        id: feast.id,
        entity: feast,
      };
    }
  }
  // The bed press only OPENS the bed sheet, in either mode: nothing here ever
  // harvests a crop.
  if (!player.dead) {
    const bedId = nearestInteractableBed(world.farmPatches, player.pos);
    if (bedId !== null) {
      return {
        kind: 'bed',
        id: bedId,
      };
    }
  }
  // The corpse harvest CHOICE, last among real actions: only a Field Kit
  // carrier, only a body whose harvest is still open and within harvest
  // reach (pickHarvestBody: the viewer's target first, else the nearest, the
  // Professions entry's own pick). A body that still has ordinary loot for
  // this viewer was already taken by the corpse arm above, so this rung only
  // ever names a harvest-only body. It opens a window; nothing here harvests.
  if (!player.dead) {
    const bodyId = pickHarvestBody({
      player,
      inventory: world.inventory ?? [],
      playerId: world.playerId,
      partyInfo: world.partyInfo,
      entities: world.entities,
    });
    const body = bodyId === null ? undefined : world.entities.get(bodyId);
    if (body) {
      return {
        kind: 'harvest',
        id: body.id,
        entity: body,
      };
    }
  }
  if (escort.kind === 'away') {
    return {
      kind: 'escortAway',
      id: null,
    };
  }
  return null;
}
