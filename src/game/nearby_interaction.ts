import type { FarmPlotView } from '../world_api/farming';
import { handleEscortPress } from './escort_interact';
import { HARVEST_CHOICE_NO_POINTER } from './harvest_body_pick';
import type { InteractionOutcome } from './interaction_autorun';
import {
  type NearbyInteractionScanWorld,
  resolveNearbyInteractionCandidate,
} from './nearby_interaction_core';

// Intentional gathering: the generic nearby press is ORDINARY interaction
// only. It never sends harvestCorpse, harvestNode, or harvestCrop; those are
// explicit actions (node/tool/crop click, the corpse picker) with their own
// entry points. The world slice below therefore names no gathering command.
// The one corpse-harvest thing the press does is OPEN the corpse picker (the
// last rung of the ladder, for a Field Kit carrier on a harvest-only body),
// exactly as the bed press opens the bed sheet: a window, never a harvest.
// The scan half (player, party roster, entities, quest log, garden beds) is
// the shared candidate-resolver slice, so the prompt and the press can never
// read a different world.
export interface NearbyInteractionWorld extends NearbyInteractionScanWorld {
  targetEntity(id: number | null): void;
  interact(): void;
  lootCorpse(id: number): InteractionOutcome;
  delveInteract(id: number): InteractionOutcome;
  enterDungeon(dungeonId: string): InteractionOutcome;
  leaveDungeon(): InteractionOutcome;
  pickUpObject(id: number): InteractionOutcome;
  // The garden-bed arm (Phase 9b). The static bed content rides the scan slice
  // above; this half is the caller's own plots. IWorld satisfies both
  // structurally, so the live call site (main.ts interactKey passing the world
  // object whole) needs no change.
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
  // The corpse popup (Hud.openLoot): the harvest-choice arm opens it with
  // HARVEST_CHOICE_NO_POINTER for both screen coordinates, so it centers
  // instead of anchoring to a cursor the press never had. Opening it is
  // ordinary interaction; the popup's own Harvest control is the ONLY thing
  // that ever sends harvestCorpse.
  openLoot(mobId: number, screenX: number, screenY: number): void;
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
  const candidate = resolveNearbyInteractionCandidate(world, harvestStateReliable, preferNpcId);
  if (candidate?.kind === 'corpse') {
    // Ordinary loot only. Harvesting a corpse is an explicit action with its
    // own entry point (the corpse picker), never a side effect of this press.
    return world.lootCorpse(candidate.id);
  }
  if (candidate?.kind === 'harvest') {
    // Opens the choice only: the popup's Harvest control sends the cast.
    hud.openLoot(candidate.id, HARVEST_CHOICE_NO_POINTER, HARVEST_CHOICE_NO_POINTER);
    return true;
  }
  if (candidate?.kind === 'delve') {
    return world.delveInteract(candidate.id);
  }
  if (candidate?.kind === 'object') {
    const object = candidate.entity;
    if (object.templateId === 'dungeon_door' && object.dungeonId) {
      return world.enterDungeon(object.dungeonId);
    } else if (object.templateId === 'dungeon_exit') {
      return world.leaveDungeon();
    } else if (object.templateId === 'mailbox') {
      hud.openMailbox();
      return true;
    } else {
      return world.pickUpObject(candidate.id);
    }
  }
  if (candidate?.kind === 'npc') {
    const npc = candidate.entity;
    if (npc.templateId === 'spirit_healer') {
      // The scan only picks a spirit healer for a ghost; route the revive
      // through the HUD's confirm gate rather than sending the command
      // directly (it applies The Keeper's Toll).
      hud.requestSpiritHealerResurrect();
    } else if (npc.templateId === 'brother_halven' || npc.templateId === 'brother_halven_marsh') {
      hud.openDelveBoard(candidate.id);
    } else {
      hud.openQuestDialog(candidate.id);
    }
    return true;
  }
  // STARTING an escort sits below the npc arm (an escortee is mob-kind, so the
  // two can never compete). Corpses still win, so looting the ambush wave is
  // never swallowed.
  if (candidate?.kind === 'escort') {
    return handleEscortPress(world, hud, { kind: 'start', entityId: candidate.id }, escortAwayText);
  }
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
  if (candidate?.kind === 'feast') {
    world.consumeFeast(candidate.id);
    return true;
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
  if (candidate?.kind === 'bed') {
    hud.openPlantSheet(candidate.id);
    return true;
  }
  // The away line is a LAST resort that only replaces the generic
  // nothing-to-interact message: an absent escortee must never eat a press that
  // some other arm above could have used.
  if (candidate?.kind === 'escortAway') {
    return handleEscortPress(world, hud, { kind: 'away' }, escortAwayText);
  }
  hud.showError(nothingToInteractText);
  return false;
}
