// Visibility of ground-spawn quest objects. A ground quest object is an
// `object` entity carrying an objectItemId whose item def has a questId; it is
// shown only to a viewer whose gating quest is 'active' or 'ready'. Everyone
// else must not see it (server drops it from the snapshot; offline render skips
// the view), and the sim's interact() scan ignores it for them.
//
// Visibility is deliberately tied to the quest being active/ready, NOT to how
// many of the item the viewer has already collected: nearby world-spawn quest
// items must not vanish the moment a player has enough. They stay visible until
// the quest is turned in.
//
// `src/sim`-pure: imports only content data + types, draws no rng, no DOM.

import { ITEMS } from './data';
import type { Entity, QuestProgress } from './types';

/** The gating quest id for a ground object, or null if it is not quest-gated. */
export function questGateQuestId(e: Entity): string | null {
  if (e.kind !== 'object' || !e.objectItemId) return null;
  return ITEMS[e.objectItemId]?.questId ?? null;
}

/**
 * Whether a viewer with the given quest log may see the object.
 * Non-quest-gated entities are always visible. A quest-gated object is visible
 * iff its gating quest is 'active' or 'ready' in the viewer's log.
 */
export function questObjectVisibleTo(questLog: Map<string, QuestProgress>, e: Entity): boolean {
  const questId = questGateQuestId(e);
  if (questId === null) return true;
  const state = questLog.get(questId)?.state;
  return state === 'active' || state === 'ready';
}
