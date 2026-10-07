// Pure live projections shared by combat and item tooltips. Stored item payloads
// never establish entitlement, level, or specialisation.
import {
  MEMBERSHIP_ARMOUR_SLOTS,
  MEMBERSHIP_DEFAULT_PROFILE,
  MEMBERSHIP_ITEMS,
  MEMBERSHIP_PROFILES,
  MEMBERSHIP_SPEC_PROFILE,
} from './content/membership';
import { SEASON2_ARMOR_FRACTION, SEASON2_ITEMS } from './content/pvp_honor_season2';
import { REFERRAL_ITEMS } from './content/referral';
import { maxArmorTypeForClass } from './equipment_rules';
import {
  casterLaneSpTotal,
  healerLaneHpTotal,
  normalizeToStaminaModel,
  primaryStatBudget,
  SLOT_STAT_MULT,
} from './item_budget';
import type { ArmorItemDef, ItemDef, PlayerClass } from './types';

export function isMembershipArmour(itemId: string): boolean {
  return MEMBERSHIP_ITEMS[itemId]?.kind === 'armor';
}

export function isReferralArmour(itemId: string): boolean {
  return REFERRAL_ITEMS[itemId]?.kind === 'armor';
}
export function isScalingArmour(itemId: string): boolean {
  return isMembershipArmour(itemId) || isReferralArmour(itemId);
}

function isArmourDefinition(item: ItemDef, matches: (id: string) => boolean): item is ArmorItemDef {
  return item.kind === 'armor' && matches(item.id);
}

export function membershipItemLevel(level: number): number {
  return level >= 20 ? 25 : Math.max(1, Math.floor(level));
}

export function membershipArmourItem(
  item: ItemDef,
  cls: PlayerClass,
  spec: string | null | undefined,
  level: number,
  active: boolean,
): ItemDef {
  if (!isArmourDefinition(item, isMembershipArmour)) return item;
  return scalingArmourItem(item, cls, spec, level, active);
}

export function referralArmourItem(
  item: ItemDef,
  cls: PlayerClass,
  spec: string | null | undefined,
  level: number,
  active: boolean,
): ItemDef {
  if (!isArmourDefinition(item, isReferralArmour)) return item;
  return scalingArmourItem(item, cls, spec, level, active);
}

function scalingArmourItem(
  item: ArmorItemDef,
  cls: PlayerClass,
  spec: string | null | undefined,
  level: number,
  active: boolean,
): ItemDef {
  const armorType = maxArmorTypeForClass(cls);
  if (!active) return { ...item, armorType, stats: {}, spellPower: 0, healPower: 0 };
  const profile = MEMBERSHIP_SPEC_PROFILE[`${cls}_${spec}`] ?? MEMBERSHIP_DEFAULT_PROFILE[cls];
  const ilvl = membershipItemLevel(level);
  const stats = normalizeToStaminaModel(
    MEMBERSHIP_PROFILES[profile],
    primaryStatBudget(ilvl, item.quality, item.slot),
  );
  // Price armour from the shipped level-35 Vanguard chest, undoing its PvP
  // discount. Slot shares use the same canonical budget weights as attributes.
  const chest =
    SEASON2_ITEMS[`vanguard_${cls}_${spec}_chest`] ??
    SEASON2_ITEMS[
      armorType === 'mail'
        ? 'vanguard_warrior_arms_chest'
        : armorType === 'leather'
          ? 'vanguard_rogue_combat_chest'
          : 'vanguard_mage_fire_chest'
    ];
  const share = SLOT_STAT_MULT[item.slot];
  stats.armor = Math.round(
    ((((chest?.stats?.armor ?? 0) / SEASON2_ARMOR_FRACTION) * ilvl) / 35) * share,
  );
  // One kit-wide throughput lane, distributed exactly across the seven pieces.
  const lane =
    profile === 'healer'
      ? healerLaneHpTotal(ilvl)
      : profile === 'caster'
        ? casterLaneSpTotal(ilvl)
        : 0;
  const index = (MEMBERSHIP_ARMOUR_SLOTS as readonly string[]).indexOf(item.slot);
  const allowance =
    Math.floor(lane / MEMBERSHIP_ARMOUR_SLOTS.length) +
    (index < lane % MEMBERSHIP_ARMOUR_SLOTS.length ? 1 : 0);
  return {
    ...item,
    armorType,
    stats,
    healPower: profile === 'healer' ? allowance : 0,
    spellPower: profile === 'caster' ? allowance : 0,
  };
}

export function wearsMembershipArmour(equipment: Partial<Record<string, string>>): boolean {
  return MEMBERSHIP_ARMOUR_SLOTS.every((slot) => equipment[slot] === `membership_${slot}`);
}

export function wearsReferralArmour(equipment: Partial<Record<string, string>>): boolean {
  return MEMBERSHIP_ARMOUR_SLOTS.every((slot) => equipment[slot] === `referral_${slot}`);
}
