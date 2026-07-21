import type { QuestDef } from './types';

// Quest item fallback.
//
// Some quests need a quest item that the player obtained during earlier
// progression rather than during the quest itself (the canonical case is the
// Crypt Keystone: rewarded by "The Abandoned Crypt", then used at the ritual
// circle in the follow-up "The Bound Guardian"). If that item is no longer in
// the player's inventory when they accept the quest (dropped, discarded, or the
// quest was abandoned and re-accepted), the player is permanently blocked: the
// item is no longer obtainable, so the objective can never be met.
//
// A QuestDef declares such items via `requiredItems`. On accept, the Sim
// re-grants any the player is missing, which keeps the quest completable. This
// generalizes what used to be a single hardcoded special case in `acceptQuest`.
//
// Pure and host-agnostic (no Sim/DOM/Rng): the caller supplies a `hasItem`
// predicate so inventory access stays on the Sim side, and gets back the
// de-duplicated list of item ids to grant.
export function questFallbackGrants(
  quest: QuestDef,
  hasItem: (itemId: string) => boolean,
): string[] {
  const required = quest.requiredItems;
  if (!required || required.length === 0) return [];
  const grants: string[] = [];
  for (const itemId of required) {
    if (!hasItem(itemId) && !grants.includes(itemId)) grants.push(itemId);
  }
  return grants;
}
