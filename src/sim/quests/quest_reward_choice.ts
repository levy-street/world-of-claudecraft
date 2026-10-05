// Choose-one quest rewards (QuestDef.choiceRewards): the classic "choose one of
// these" list, shown in the quest dialog and settled at turn-in.
//
// The ONE resolver every consumer reads, the same single-source rule
// questRewardItem (../data.ts) follows for the fixed per-class reward: the
// turn-in grant and its bag gate (quest_commands.ts), the quest dialog, the
// quest log, and the Loot Explorer all call these, so what a player is offered
// is exactly what the server will accept and grant. Pure: no SimContext, no
// rng.
//
// A player is offered only the choices their class can wear (armor type,
// weapon proficiency, class locks; equipment_rules.ts canEquipItem). A quest
// whose whole list is out of the class's reach falls back to the full list, so
// a choice quest never turns into a quest with no reward at all.

import { ITEMS } from '../data';
import { canEquipItem } from '../equipment_rules';
import type { PlayerClass, QuestDef } from '../types';

export function questRewardChoices(quest: QuestDef, cls: PlayerClass): readonly string[] {
  const all = (quest.choiceRewards ?? []).filter((id) => ITEMS[id] !== undefined);
  const wearable = all.filter((id) => canEquipItem(cls, ITEMS[id]));
  return wearable.length > 0 ? wearable : all;
}

export function questHasRewardChoice(quest: QuestDef, cls: PlayerClass): boolean {
  return questRewardChoices(quest, cls).length > 0;
}

/** The pick a dialog-less path (the interact key, the RL env, the dev completer) takes. */
export function defaultRewardChoice(quest: QuestDef, cls: PlayerClass): string | undefined {
  return questRewardChoices(quest, cls)[0];
}

export type RewardChoiceResult =
  | { readonly ok: true; readonly itemId: string | undefined }
  | { readonly ok: false; readonly reason: 'missing' | 'not_offered' };

// Settle a turn-in's pick: a choice quest needs one of the offered items; a
// quest without choices ignores whatever was sent.
export function resolveRewardChoice(
  quest: QuestDef,
  cls: PlayerClass,
  picked: string | undefined,
): RewardChoiceResult {
  const offered = questRewardChoices(quest, cls);
  if (offered.length === 0) return { ok: true, itemId: undefined };
  if (picked === undefined) return { ok: false, reason: 'missing' };
  if (!offered.includes(picked)) return { ok: false, reason: 'not_offered' };
  return { ok: true, itemId: picked };
}
