// Choose-one quest rewards (QuestDef.choiceRewards): the classic "choose one of
// these" list, shown in the quest dialog and settled at turn-in.
//
// The ONE resolver every consumer reads, the same single-source rule
// questRewardItem (../data.ts) follows for the fixed per-class reward: the
// turn-in grant and its bag gate (quest_commands.ts), the quest dialog, the
// quest log, and the icon prewarm all call these, so what a player is offered
// is exactly what the server will accept and grant. Pure: no SimContext, no
// rng.
//
// A player is offered only the choices their class can wear (armor type,
// weapon proficiency, class locks; equipment_rules.ts canEquipItem). A quest
// whose whole list is out of the class's reach falls back to the full list, so
// a choice quest never turns into a quest with no reward at all.
//
// The default pick (a turn-in that names no choice: the interact key, the RL
// env, the dev completer, a client from before the picker) is the offered item
// that best fits the player's spec, scored with the same per-spec stat weights
// the dev kit uses (content/dev_kit_roles.ts). Before a spec is chosen, each
// class reads its usual leveling spec.

import { DEV_KIT_ROLES, devKitRole } from '../content/dev_kit_roles';
import { ITEMS } from '../data';
import { canEquipItem } from '../equipment_rules';
import type { ItemDef, PlayerClass, QuestDef } from '../types';

// The spec a class levels as before it picks one (talents open at level 5).
const LEVELING_SPEC: Readonly<Record<PlayerClass, string>> = {
  warrior: 'arms',
  paladin: 'retribution',
  hunter: 'beast_mastery',
  rogue: 'combat',
  priest: 'shadow',
  shaman: 'enhancement',
  mage: 'frost',
  warlock: 'affliction',
  druid: 'balance',
};

// Armor breaks a stat tie in favor of the heavier piece the class can wear.
const ARMOR_TIEBREAK = 0.001;

export function questRewardChoices(quest: QuestDef, cls: PlayerClass): readonly string[] {
  const all = (quest.choiceRewards ?? []).filter((id) => ITEMS[id] !== undefined);
  const wearable = all.filter((id) => canEquipItem(cls, ITEMS[id]));
  return wearable.length > 0 ? wearable : all;
}

export function questHasRewardChoice(quest: QuestDef, cls: PlayerClass): boolean {
  return questRewardChoices(quest, cls).length > 0;
}

function specFitScore(item: ItemDef, cls: PlayerClass, spec: string | null | undefined): number {
  const role =
    (spec ? devKitRole(cls, spec) : null) ??
    devKitRole(cls, LEVELING_SPEC[cls]) ??
    DEV_KIT_ROLES[cls][0];
  let score = 0;
  for (const [stat, weight] of Object.entries(role.weights)) {
    score += (weight ?? 0) * (item.stats?.[stat as keyof typeof role.weights] ?? 0);
  }
  return score + (item.stats?.armor ?? 0) * ARMOR_TIEBREAK;
}

/** The pick a turn-in that names no choice takes: the offered item that best fits the spec. */
export function defaultRewardChoice(
  quest: QuestDef,
  cls: PlayerClass,
  spec?: string | null,
): string | undefined {
  let best: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of questRewardChoices(quest, cls)) {
    const score = specFitScore(ITEMS[id], cls, spec);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

export type RewardChoiceResult =
  | { readonly ok: true; readonly itemId: string | undefined }
  | { readonly ok: false; readonly reason: 'not_offered' };

// Settle a turn-in's pick: no pick takes the spec default, a pick must be one of
// the offered items, and a quest without choices ignores whatever was sent.
export function resolveRewardChoice(
  quest: QuestDef,
  cls: PlayerClass,
  picked: string | undefined,
  spec?: string | null,
): RewardChoiceResult {
  const offered = questRewardChoices(quest, cls);
  if (offered.length === 0) return { ok: true, itemId: undefined };
  if (picked === undefined) return { ok: true, itemId: defaultRewardChoice(quest, cls, spec) };
  if (!offered.includes(picked)) return { ok: false, reason: 'not_offered' };
  return { ok: true, itemId: picked };
}
