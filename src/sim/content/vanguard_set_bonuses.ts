// Warfare Season 2 ("Vanguard") set bonuses: the engine payloads for all 27
// spec sets, merged into SET_ENGINE_BONUSES (content/ignivar_set_bonuses.ts)
// so set_bonus_mods.ts folds them exactly like the raid tier. Split in two
// class groups so each stays a readable data table.

import type { SetEngineBonusTier } from './ignivar_set_bonuses';
import { PVP_CASTER_SET_2PC_PUSHBACK_REDUCTION } from './item_sets';
import { VANGUARD_BONUSES_A } from './vanguard_set_bonuses_a';
import { VANGUARD_BONUSES_B } from './vanguard_set_bonuses_b';

// The caster Season 2 sets (Intellect, Spell Power, and Healing Power pieces):
// their 2-piece also grants immunity to damage cast pushback, the rider the
// Season 1 caster WARFARE sets carry (content/item_sets.ts). It rides the
// generic global knob, max-combined into Entity.castPushbackReduction like the
// Crucible healer 2pc, and is not PvP-gated.
export const VANGUARD_CASTER_SET_IDS: readonly string[] = [
  'vanguard_paladin_holy',
  'vanguard_priest_discipline',
  'vanguard_priest_holy',
  'vanguard_priest_shadow',
  'vanguard_shaman_elemental',
  'vanguard_shaman_restoration',
  'vanguard_mage_arcane',
  'vanguard_mage_fire',
  'vanguard_mage_frost',
  'vanguard_warlock_affliction',
  'vanguard_warlock_demonology',
  'vanguard_warlock_destruction',
  'vanguard_druid_balance',
  'vanguard_druid_restoration',
];

function withCasterPushback(tiers: readonly SetEngineBonusTier[]): readonly SetEngineBonusTier[] {
  return tiers.map((tier) =>
    tier.pieces === 2
      ? {
          ...tier,
          effect: {
            ...tier.effect,
            global: {
              ...tier.effect.global,
              castPushbackReduction: PVP_CASTER_SET_2PC_PUSHBACK_REDUCTION,
            },
          },
        }
      : tier,
  );
}

const VANGUARD_AUTHORED: Record<string, readonly SetEngineBonusTier[]> = {
  ...VANGUARD_BONUSES_A,
  ...VANGUARD_BONUSES_B,
};

export const VANGUARD_SET_ENGINE_BONUSES: Record<string, readonly SetEngineBonusTier[]> =
  Object.fromEntries(
    Object.entries(VANGUARD_AUTHORED).map(([setId, tiers]) => [
      setId,
      VANGUARD_CASTER_SET_IDS.includes(setId) ? withCasterPushback(tiers) : tiers,
    ]),
  );
