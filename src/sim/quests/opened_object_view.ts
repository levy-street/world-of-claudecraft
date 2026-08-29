// Per-viewer "this object is spent" read for interact-objective ground
// objects (the wreck line's castaway crates). The sim keeps every object
// alive for sharing (interact_object_credit.ts: the ledger, not the object,
// stops double credit), so a player who already opened a crate used to walk
// back into it, get the "You have already done this one." refusal, and read
// the world as broken. This predicate lets every PRESENTATION surface (the
// renderer's mesh, the coach's beam and bubble, the interact key's target
// scan) treat a credited object as gone FOR THAT PLAYER while everyone else
// still sees and opens it.
//
// Reads the same questLog both hosts expose (the offline Sim's live meta,
// the online ClientWorld's qlog mirror, which carries creditedObjects on the
// wire for exactly this read). src/sim-pure: no DOM/render/ui/game/net
// imports, no wall-clock, no rng.

import { QUESTS } from '../data';
import { interactObjectCreditKey } from './interact_object_credit';

/**
 * The ground-object classes that VANISH for a player who already credited
 * them. Deliberately an opt-in list, not "every interact objective": most
 * interact targets are meant to stay visible after their credit (the three
 * watchbells each stand on their own headland, and a player walking the
 * coast should still see the one they rang). The castaway crates are the
 * exception the playtest asked for: they line one path, they are identical,
 * and an opened one that still glints reads as a bug.
 */
export const OPENED_OBJECT_HIDE_ITEM_IDS: ReadonlySet<string> = new Set(['ps_castaway_crate']);

/** The minimal entity shape the check reads (IWorld.entities values). */
export interface OpenedObjectEntity {
  objectItemId?: string | null;
  pos: { x: number; z: number };
}

/** The minimal quest-log row the check reads: structural on purpose, so the
 *  narrow render/ui reader mirrors (CoachGuideReader and friends) satisfy it
 *  as readily as the full QuestProgress. The quest id comes from the MAP KEY,
 *  never the row, for the same reason. */
export interface OpenedObjectQuestRow {
  state: string;
  creditedObjects?: readonly string[];
}

/**
 * Has THIS viewer already taken interact credit off this ground object?
 * True only while the crediting quest still sits in the log (active or
 * ready): on turn-in or abandon the entry leaves with the quest, and the
 * object reappears, which is right, because a repeat of the quest needs it.
 */
export function isObjectOpenedByViewer(
  entity: OpenedObjectEntity,
  questLog: ReadonlyMap<string, OpenedObjectQuestRow>,
): boolean {
  const itemId = entity.objectItemId;
  if (!itemId || !OPENED_OBJECT_HIDE_ITEM_IDS.has(itemId)) return false;
  for (const [questId, qp] of questLog) {
    if (qp.state !== 'active' && qp.state !== 'ready') continue;
    if (!qp.creditedObjects?.length) continue;
    const quest = QUESTS[questId];
    if (!quest) continue;
    for (let i = 0; i < quest.objectives.length; i++) {
      const objective = quest.objectives[i];
      if (objective.type !== 'interact' || objective.targetObjectItemId !== itemId) continue;
      if (qp.creditedObjects.includes(interactObjectCreditKey(i, entity.pos))) return true;
    }
  }
  return false;
}
