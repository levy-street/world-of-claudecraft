import { isQuestGatedGroundObjectHidden } from '../sim/quest_gated_entity';
import { isObjectOpenedByViewer } from '../sim/quests/opened_object_view';
import { dist2d, type Entity, INTERACT_RANGE, type QuestProgress } from '../sim/types';
import type { FarmPatchDef, FarmPlotView } from '../world_api/farming';
import { corpseLootAvailability, localPartyMemberIds } from './corpse_loot_availability';
import { decideEscortPress, handleEscortPress } from './escort_interact';
import { nearestInteractableBed } from './farm_bed_interact';
import { nearestInteractableFeast } from './feast_interact';
import type { InteractionOutcome } from './interaction_autorun';
import { objectInteractionRange } from './interactions';

// Intentional gathering: the generic nearby press is ORDINARY interaction
// only. It never sends harvestCorpse, harvestNode, or harvestCrop; those are
// explicit actions (node/tool/crop click, the corpse picker) with their own
// entry points. The world slice below therefore names no gathering command.
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
  delveInteract(id: number): InteractionOutcome;
  enterDungeon(dungeonId: string): InteractionOutcome;
  leaveDungeon(): InteractionOutcome;
  pickUpObject(id: number): InteractionOutcome;
  // The garden-bed arm (Phase 9b). Static bed content plus the caller's own
  // plots; IWorld satisfies both structurally, so the live call site
  // (main.ts interactKey passing the world object whole) needs no change.
  farmPatches: readonly FarmPatchDef[];
  myFarmPlots: readonly FarmPlotView[];
  // The shared-feast arm (Phase 12). Required, not optional, the questLog
  // precedent: IWorld satisfies it structurally (main.ts passes the world
  // whole), and a placed feast has NO other client entry point, so a silently
  // unwired arm would strand the eat verb entirely (the (bn) gap class).
  consumeFeast(feastId: number): void;
}

export interface NearbyInteractionHud {
  openMailbox(): void;
  openQuestDialog(npcId: number): void;
  openDelveBoard(npcId: number): void;
  showError(text: string): void;
  requestSpiritHealerResurrect(): void;
  // A garden bed in reach opens the bed sheet (Phase 9b, widened by
  // intentional gathering PR1): a free bed paints the seed-and-knobs planting
  // choice, a bed holding my plot paints harvest mode. Opening a window is
  // ordinary interaction; the sheet's own explicit Harvest control is the
  // ONLY thing that ever sends harvestCrop.
  openPlantSheet(bedId: string): void;
}

/** Find and dispatch one eligible nearby interaction in stable priority order.
 *  `escortAwayText` sits before the nothing-to-interact string so the live
 *  call site (main.ts interactKey) still closes on that string, as pinned by
 *  tests/client_shell.test.ts. */
export function tryNearbyInteraction(
  world: NearbyInteractionWorld,
  hud: NearbyInteractionHud,
  escortAwayText: string,
  nothingToInteractText: string,
  harvestStateReliable = true,
  // The npc the caller means, when it has one in mind. The scan is otherwise
  // nearest-wins, which is right for a keypress aimed by walking up to someone and
  // wrong for a pad, where the player SELECTS an npc and then presses talk: without
  // this, pressing talk answered whoever happened to be standing closer. Only ever
  // promotes an npc the scan would already have accepted, so no rule is bypassed.
  preferNpcId?: number | null,
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

  for (const entity of world.entities.values()) {
    const distance = dist2d(player.pos, entity.pos);
    // A corpse is a target only for the ordinary loot this viewer may take
    // (hasLoot, never canOpen): a harvest-only corpse is no target here, so
    // it cannot swallow an eligible interaction standing behind it.
    if (
      !player.dead &&
      entity.kind === 'mob' &&
      entity.dead &&
      entity.lootable &&
      corpseLootAvailability(entity, playerId, harvestStateReliable, partyIds).hasLoot &&
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
    } else if (
      !player.dead &&
      entity.kind === 'object' &&
      entity.lootable &&
      // Nothing the viewer cannot see may win the press. An off-quest quest
      // collectable is withheld from the scene entirely (the renderer's gate), so
      // selecting it here would spend the interact on an invisible object and let
      // it outrank a visible NPC standing further away. The same rule
      // covers an interact-objective object this player already credited (an
      // opened castaway crate): the renderer hides it for them, so the press
      // must not target it either.
      !isQuestGatedGroundObjectHidden(entity, world.questLog) &&
      !isObjectOpenedByViewer(entity, world.questLog)
    ) {
      if (distance <= objectInteractionRange(entity) && distance < bestObjectDistance) {
        bestObject = entity.id;
        bestObjectDistance = distance;
      }
    }
    // The promotion jumps the nearest-wins order, so it carries a strict reach check
    // of its own; the scan keeps the reach its sentinel has always given it.
    const promoted =
      preferNpcId !== undefined &&
      preferNpcId !== null &&
      entity.id === preferNpcId &&
      distance <= INTERACT_RANGE;
    if (entity.kind === 'npc' && (promoted || distance < bestNpcDistance)) {
      const isGhostHealer = entity.templateId === 'spirit_healer' && player.ghost;
      const isLivingNpc = entity.templateId !== 'spirit_healer' && !player.dead;
      if (isGhostHealer || isLivingNpc) {
        bestNpc = entity.id;
        // Out of reach of anything else, so a nearer npc later in the sweep cannot
        // take the pick back off the one the player actually selected.
        bestNpcDistance = promoted ? -1 : distance;
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
  // STARTING an escort sits below the npc arm (an escortee is mob-kind, so the
  // two can never compete). Corpses still win, so looting the ambush wave is
  // never swallowed.
  const escort = player.dead
    ? ({ kind: 'none' } as const)
    : decideEscortPress(player.pos, world.entities, world.questLog);
  if (escort.kind === 'start') return handleEscortPress(world, hud, escort, escortAwayText);
  // The feast arm sits ABOVE the garden-bed arm (ruling 11b-R3c-1: a PLACED
  // TRANSIENT wins over permanent world furniture; a feast despawns on a
  // timer and is what the player just walked to, so it outranks the bed that
  // is always there). The press just sends the entity id: an already-fed
  // player's press near a feast answers through the sim's own farmDenied
  // feast_eaten line (the (bp) doctrine: the sim is the refusing authority,
  // the client never reads the ledger, which never crosses the wire anyway).
  // Mobile crafting stations are OUTSIDE this ordering by construction: they
  // take no interact press at all (proximity-activated via
  // inRangeStationTypes), so the ruling's station-over-bed half has no arm to
  // order until a station gains a press.
  if (!player.dead) {
    const feastId = nearestInteractableFeast(world.entities, player.pos);
    if (feastId !== null) {
      world.consumeFeast(feastId);
      return true;
    }
  }
  // The garden-bed arm (Phase 9b) sits immediately below the placed feast
  // (11b-R3c-1) and above the escort-away last resort. ANY bed in reach takes
  // the press by OPENING the bed sheet (intentional gathering PR1): a free bed
  // paints the planting choice, a bed holding my plot paints harvest mode with
  // its status and an explicit Harvest control. The press itself never sends
  // harvestCrop, whatever the plot's status, however stale the snapshot, or
  // however many times the key repeats: only that control does, after its own
  // live revalidation (farming_plant_sheet_window.ts). A same-bed re-press
  // while the sheet is up is a repaint that keeps the player's picks and any
  // in-flight send.
  if (!player.dead) {
    const bedId = nearestInteractableBed(world.farmPatches, player.pos);
    if (bedId !== null) {
      hud.openPlantSheet(bedId);
      return true;
    }
  }
  // The away line is a LAST resort that only replaces the generic
  // nothing-to-interact message: an absent escortee must never eat a press that
  // some other arm above could have used.
  if (escort.kind === 'away') return handleEscortPress(world, hud, escort, escortAwayText);
  hud.showError(nothingToInteractText);
  return false;
}
