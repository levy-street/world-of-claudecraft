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
// A choice quest that also authors a per-class GEAR reward (QuestDef.itemRewards,
// via questRewardItem) offers that piece as one more card in the same list, so
// the player picks one reward rather than receiving the authored piece AND a
// choice; a non-gear authored reward (a quest item a later quest needs) stays a
// fixed grant beside the choice. questFixedReward is the one read of which.
//
// The default pick (a turn-in that names no choice: the interact key, the RL
// env, the dev completer, a client from before the picker) is the offered item
// that best fits the player's spec, by the stat weights below plus weapon damage
// for the weapon-using specs. Before a spec is chosen, each class reads its
// usual leveling spec.

import { ITEMS, questRewardItem } from '../data';
import { canEquipItem } from '../equipment_rules';
import { WEAPON_DPS_WEIGHT } from '../item_level';
import type { CoreStats, ItemDef, PlayerClass, QuestDef } from '../types';

type StatWeights = Partial<Record<'str' | 'agi' | 'int' | 'spi', number>>;

// What each spec's output actually scales with, read off the stat derivation
// (entity.ts recalcPlayerStats: melee AP is 2 per Strength for warrior, paladin,
// shaman and druid, Strength plus Agility for rogue and hunter; hunter ranged AP
// is 2 per Agility; spell power is 0.5 per Intellect; Agility otherwise adds
// 0.05% crit per point) and measured on the leveling bench (+30 of one stat at
// levels 12 and 20, 2026-10-06): an enhancement shaman gained +19.7 DPS from
// Strength and +6.2 from Agility, a feral cat +23.7 from Strength and nothing
// from Agility, every caster spec only from Intellect. Healers weigh Spirit for
// regen. The dev kit's role weights (content/dev_kit_roles.ts) are not used:
// they read enhancement and feral as Agility specs.
const STR_MELEE: StatWeights = { str: 1, agi: 0.15 };
const STR_HYBRID: StatWeights = { str: 1, agi: 0.4, int: 0.4 };
const AGI_MELEE: StatWeights = { agi: 1, str: 0.8 };
const AGI_RANGED: StatWeights = { agi: 1, str: 0.1 };
const CASTER: StatWeights = { int: 1, spi: 0.2 };
const HEALER: StatWeights = { int: 1, spi: 0.5 };

export const QUEST_REWARD_SPEC_WEIGHTS: Readonly<
  Record<PlayerClass, Readonly<Record<string, StatWeights>>>
> = {
  warrior: { arms: STR_MELEE, fury: STR_MELEE, prot: STR_MELEE },
  paladin: { holy: HEALER, protection: STR_MELEE, retribution: STR_HYBRID },
  hunter: { beast_mastery: AGI_RANGED, marksmanship: AGI_RANGED, survival: AGI_RANGED },
  rogue: { assassination: AGI_MELEE, combat: AGI_MELEE, subtlety: AGI_MELEE },
  priest: { discipline: HEALER, holy: HEALER, shadow: CASTER },
  shaman: { elemental: CASTER, enhancement: STR_HYBRID, restoration: HEALER },
  mage: { arcane: CASTER, fire: CASTER, frost: CASTER },
  warlock: { affliction: CASTER, demonology: CASTER, destruction: CASTER },
  druid: { balance: CASTER, feral: STR_MELEE, restoration: HEALER },
};

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

export function specStatWeights(cls: PlayerClass, spec: string | null | undefined): StatWeights {
  const table = QUEST_REWARD_SPEC_WEIGHTS[cls];
  return (spec ? table[spec] : undefined) ?? table[LEVELING_SPEC[cls]];
}

function isGear(id: string | undefined): id is string {
  return id !== undefined && ITEMS[id]?.slot !== undefined;
}

/** The authored reward granted beside the choice: the whole authored reward on a
 *  quest without choices, only a non-gear one on a quest with them (gear joins
 *  the choice list instead). */
export function questFixedReward(quest: QuestDef, cls: PlayerClass): string | undefined {
  const authored = questRewardItem(quest, cls);
  if (!quest.choiceRewards?.length) return authored;
  return isGear(authored) ? undefined : authored;
}

export function questRewardChoices(quest: QuestDef, cls: PlayerClass): readonly string[] {
  const generated = (quest.choiceRewards ?? []).filter((id) => ITEMS[id] !== undefined);
  if (generated.length === 0) return [];
  const authored = questRewardItem(quest, cls);
  const all =
    isGear(authored) && !generated.includes(authored) ? [authored, ...generated] : generated;
  const wearable = all.filter((id) => canEquipItem(cls, ITEMS[id]));
  return wearable.length > 0 ? wearable : all;
}

export function questHasRewardChoice(quest: QuestDef, cls: PlayerClass): boolean {
  return questRewardChoices(quest, cls).length > 0;
}

function specFitScore(item: ItemDef, cls: PlayerClass, spec: string | null | undefined): number {
  const weights = specStatWeights(cls, spec);
  let score = 0;
  for (const [stat, weight] of Object.entries(weights)) {
    score += (weight ?? 0) * (item.stats?.[stat as keyof CoreStats] ?? 0);
  }
  // A weapon-using spec (its main stat is Strength or Agility) values a weapon's
  // damage at the realized-power weight item_level.ts uses (itemScore).
  const physical = (weights.str ?? 0) >= 1 || (weights.agi ?? 0) >= 1;
  if (physical && item.weapon) {
    score += WEAPON_DPS_WEIGHT * ((item.weapon.min + item.weapon.max) / 2 / item.weapon.speed);
  }
  return score + (item.stats?.armor ?? 0) * ARMOR_TIEBREAK;
}

const PRIMARY_OFFENSE = ['str', 'agi', 'int', 'spi'] as const;

/** Every primary stat the item carries (stamina aside) is one the spec uses. */
export function isOnRoleForSpec(
  item: ItemDef,
  cls: PlayerClass,
  spec: string | null | undefined,
): boolean {
  const weights = specStatWeights(cls, spec);
  return PRIMARY_OFFENSE.every(
    (stat) => (item.stats?.[stat] ?? 0) <= 0 || (weights[stat] ?? 0) > 0,
  );
}

/** The pick a turn-in that names no choice takes: the offered item that best fits
 *  the spec. Only on-role pieces are preselected (a feral cat is never handed the
 *  caster staff its archetype authored, though the staff stays on offer); a list
 *  with none falls back to the best of everything. */
export function defaultRewardChoice(
  quest: QuestDef,
  cls: PlayerClass,
  spec?: string | null,
): string | undefined {
  const offered = questRewardChoices(quest, cls);
  const onRole = offered.filter((id) => isOnRoleForSpec(ITEMS[id], cls, spec));
  let best: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of onRole.length > 0 ? onRole : offered) {
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
