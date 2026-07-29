// Escort-run interaction: the pure decision for what a click or an Interact
// press near an escortee should do (the escort quests driven by
// src/sim/escort.ts, e.g. "Seeing Wren Home").
//
// Why this core exists: an escortee is a MOB-kind entity, because the escort
// driver walks it and only mobs have locomotion. Both client interaction
// ladders route talkable entities by `kind === 'npc'`, so without this arm
// neither the Interact action (keyboard, gamepad, mobile button) nor a
// right-click could ever reach the escort arm of the sim's interact command,
// and no escort run could be started from any shipped client at all.
//
// The sim stays authoritative: tryStartEscort (src/sim/escort.ts) re-checks
// range, the quest state, and whether a run is already live. This core only
// decides whether to spend the press on an escortee, and what to say when the
// escortee is not at its post, mirroring gather_node_interact.ts.

import { ESCORTS } from '../sim/data';
import { ESCORT_NPC_TEMPLATE_IDS } from '../sim/escort';
import {
  dist2d,
  type Entity,
  type EscortDef,
  INTERACT_RANGE,
  type QuestProgress,
} from '../sim/types';
import type { InteractionOutcome } from './interaction_autorun';

// An idle escortee stands ON def.start (spawnEscortee only resolves ground
// height), so this is a tolerance for that placement, not a search radius: past
// it the escortee is walking a live run.
export const ESCORT_POST_RADIUS = 3;
// How close to an empty post a player must stand to be told the escortee is
// away, instead of falling through to the generic nothing-to-interact line.
// Generous on purpose: the quest text sends players to a landmark, not a pin.
export const ESCORT_POST_HINT_RANGE = 15;

const ESCORT_DEFS: readonly EscortDef[] = Object.values(ESCORTS);

export type EscortPressVerdict =
  // An idle escortee at its post, in interact range, quest active: start the run.
  | { kind: 'start'; entityId: number }
  // The escortee for a quest this player is on is not startable: away on a live
  // run (its own or another player's), or dead and waiting out respawnSeconds.
  | { kind: 'away' }
  // No escort of this player's concern is nearby; the press belongs elsewhere.
  | { kind: 'none' };

/** Whether this entity is an escortee (any escort def's walker), for the hover
 *  cursor. Deliberately quest-blind: an escortee reads as a friendly NPC to
 *  every viewer, exactly as its npc-kind neighbours do. */
export function isEscorteeEntity(e: Entity | undefined): boolean {
  return !!e && e.kind === 'mob' && !e.dead && ESCORT_NPC_TEMPLATE_IDS.has(e.templateId);
}

function isQuestActive(questLog: ReadonlyMap<string, QuestProgress>, questId: string): boolean {
  // Mirrors the sim's own gate in tryStartEscort: only an active quest starts a run.
  return questLog.get(questId)?.state === 'active';
}

function escorteeFor(def: EscortDef, entities: ReadonlyMap<number, Entity>): Entity | null {
  for (const e of entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.templateId === def.npcMobId) return e;
  }
  return null;
}

/** Resolve what an Interact press near an escortee should do. Prefers a
 *  startable escortee over an away-message, so a second escort standing idle
 *  next to a busy one is still startable. */
export function decideEscortPress(
  playerPos: { x: number; y: number; z: number },
  entities: ReadonlyMap<number, Entity>,
  questLog: ReadonlyMap<string, QuestProgress>,
): EscortPressVerdict {
  let away = false;
  let startId: number | null = null;
  let startDistance = INTERACT_RANGE;
  for (const def of ESCORT_DEFS) {
    if (!isQuestActive(questLog, def.questId)) continue;
    const post = { x: def.start.x, y: playerPos.y, z: def.start.z };
    const escortee = escorteeFor(def, entities);
    const atPost = escortee !== null && dist2d(escortee.pos, post) <= ESCORT_POST_RADIUS;
    if (escortee && atPost) {
      // Startable, so the only question is range. Out of range stays silent
      // (walk closer), exactly like every other arm of the ladder: an idle
      // escortee standing right there must never be reported as away.
      const distance = dist2d(playerPos, escortee.pos);
      if (distance <= INTERACT_RANGE && distance < startDistance) {
        startId = escortee.id;
        startDistance = distance;
      }
      continue;
    }
    // Off-post (walking a live run) or missing entirely (dead, waiting out
    // respawnSeconds). Explain it if the player is either standing next to the
    // walker or standing at the post where the quest text sent them, which is
    // the whole reported symptom: an empty spawn and a dead press.
    const atWalker = escortee !== null && dist2d(playerPos, escortee.pos) <= INTERACT_RANGE;
    if (atWalker || dist2d(playerPos, post) <= ESCORT_POST_HINT_RANGE) away = true;
  }
  if (startId !== null) return { kind: 'start', entityId: startId };
  return away ? { kind: 'away' } : { kind: 'none' };
}

export interface EscortInteractWorld {
  targetEntity(id: number | null): void;
  interact(): void;
}

export interface EscortInteractHud {
  showError(text: string): void;
}

/** Thin dispatch for a resolved verdict: start the run, or surface the
 *  localized away line. `awayText` is injected (this module stays i18n-free,
 *  like the rest of the nearby-interaction ladder). */
export function handleEscortPress(
  world: EscortInteractWorld,
  hud: EscortInteractHud,
  verdict: EscortPressVerdict,
  awayText: string,
): InteractionOutcome {
  if (verdict.kind === 'start') {
    // Target first: the sim's interact command resolves an explicit target
    // before its proximity scan, and its escort arm sits after both, so either
    // route reaches tryStartEscort. Targeting also gives the player the unit
    // frame they expect after clicking someone.
    world.targetEntity(verdict.entityId);
    world.interact();
    return true;
  }
  if (verdict.kind === 'away') {
    hud.showError(awayText);
    return false;
  }
  return false;
}
