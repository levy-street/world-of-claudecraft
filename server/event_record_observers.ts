// The per-event database RECORD observers of the game loop's event drain,
// extracted from game.ts (the monolith ratchet): the arms that turn one sim
// event into a fire-and-forget audit or analytics row and nothing else. Each
// arm resolves the recipient session by the event's pid, refuses a missing
// session (a logged-out player's late event writes nothing), and hands the
// row to its writer module. No wire side effects, no metrics, no Discord: the
// significant-activity chain stays in activity_detect.ts and the level-up arm
// stays in game.ts beside the metrics and link-change work it is coupled to.
//
// Arms:
// - questAccepted / questDone -> progress_events.ts recordFtueQuest
//   (ftue_events, level-gated at write time: skipped when the entity is gone
//   rather than defaulting the level, so the growth gate never fails open).
// - death of a connected player -> progress_events.ts recordFtueDeath.
// - craftRoll -> craft_roll_events.ts recordCraftRoll (craft_roll_events, the
//   chance-based crafting outcome audit).

import type { Entity, SimEvent } from '../src/sim/types';
import { type CraftRollWho, recordCraftRoll } from './craft_roll_events';
import { recordFtueDeath, recordFtueQuest } from './progress_events';

/** The session fields the record writers read (progress_events.ts
 *  ProgressEventWho and craft_roll_events.ts CraftRollWho are the same
 *  shape); game.ts's ClientSession satisfies it structurally. */
export type EventRecordWho = CraftRollWho;

/** The one sim read the FTUE arms need: the live entity map (the player's
 *  level). Structural so a test passes a bare Map without building a Sim. */
export interface EventRecordSimView {
  readonly entities: Map<number, Entity>;
}

/** Route one drained sim event to its database record writer, if it has
 *  one. Positional arguments on purpose: the drain loop calls this once per
 *  event, so no deps object is allocated per call, and the common no-match
 *  path is a few type compares. */
export function observeEventRecords<S extends EventRecordWho>(
  ev: SimEvent,
  sim: EventRecordSimView,
  clients: ReadonlyMap<number, S>,
): void {
  if ((ev.type === 'questAccepted' || ev.type === 'questDone') && ev.pid !== undefined) {
    const s = clients.get(ev.pid);
    const entity = sim.entities.get(ev.pid);
    if (s && entity)
      recordFtueQuest(
        s,
        ev.type === 'questAccepted' ? 'quest_accepted' : 'quest_done',
        ev.questId,
        entity.level,
      );
    return;
  }
  if (ev.type === 'death') {
    const s = clients.get(ev.entityId);
    if (s) recordFtueDeath(s, sim, ev.entityId, ev.killerId);
    return;
  }
  if (ev.type === 'craftRoll' && ev.pid !== undefined) {
    const s = clients.get(ev.pid);
    if (s) recordCraftRoll(s, ev);
  }
}
