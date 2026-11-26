// The /dev bis enchant plan and the /dev enchant applier. Pure selection plus
// one dev-only payload write; draws no rng.
//
// Rules (owner call, 2026-11-25):
//   - PvP kits (pvp_bis_loadouts.ts) use the same armor plan and the Forge
//     weapon formulas, the best in the game.
//   - Every enchantable slot takes the spec's main stat: Strength, Agility or
//     Intellect, with Stamina where the slot offers nothing on that axis and
//     for tanks. Spirit is never chosen (nothing in the game spends it).
//   - Nyth weapons run the ordinary stat ladder's top rung (Lucent Might /
//     Lucent Spellpower, the plain Agility rune for agility lines).
//   - Forge weapons run the raid-tier formulas: Piston Drive on two-handers,
//     Lastflame Zeal on strength one-handers, Riftwalker's Grace for rogues,
//     Dawnfire Etching for damage casters and Dawn's Benediction for healers.
//     A spell-power weapon on a melee line (Stonebound's dual wands) takes
//     the caster weapon enchant. Hunters keep the Agility rune on both tiers: Riftwalker's Grace and Zeal
//     never trigger from ranged attacks, and a hunter's damage is ranged.
//   - Every pick must fit the item the kit wears there (the item's own slot
//     and, for Piston Drive, its two-hand grip), the same gates a real
//     enchant applies; a slot with no fitting candidate stays bare.

import { DEV_KIT_ROLES } from '../content/dev_kit_roles';
import { ENCHANTS } from '../content/enchants';
import { ITEMS } from '../data';
import { recalcPlayerStats } from '../entity';
import {
  enchantAdmitsWeaponHand,
  enchantedPayloadFor,
  isEnchantedInstance,
  replacedEnchantPayloadFor,
} from '../professions/enchanting';
import { refreshModsForEquipmentChange } from '../progression/talents';
import type { SimContext } from '../sim_context';
import type { EquipSlot, PlayerClass } from '../types';

export type DevEnchantTier = 'nyth' | 'forge' | 'pvp';
type Line = 'str' | 'agi' | 'tank' | 'caster' | 'healer';

// Candidates per line and slot, best first. 'weapon' covers any weapon worn in
// either hand. Ids are checked against ENCHANTS by tests/dev_bis_enchants.test.ts.
type SlotKey =
  | 'weapon'
  | 'offhand'
  | Exclude<EquipSlot, 'mainhand' | 'offhand' | 'ring1' | 'ring2'>
  | 'ring';
const ARMOR: Record<Line, Partial<Record<SlotKey, readonly string[]>>> = {
  str: {
    offhand: ['enchant_offhand_stamina'],
    helmet: ['enchant_helmet_greater_fortitude'],
    neck: ['enchant_neck_agility'],
    shoulder: ['enchant_shoulder_strength'],
    chest: ['enchant_chest_lucent_stamina'],
    waist: ['enchant_waist_strength'],
    legs: ['enchant_legs_greater_stamina'],
    gloves: ['enchant_gloves_strength'],
    feet: ['enchant_feet_strength'],
    ring: ['enchant_ring_strength'],
  },
  tank: {
    offhand: ['enchant_offhand_stamina'],
    helmet: ['enchant_helmet_greater_fortitude'],
    neck: ['enchant_neck_agility'],
    shoulder: ['enchant_shoulder_strength'],
    chest: ['enchant_chest_lucent_stamina'],
    waist: ['enchant_waist_strength'],
    legs: ['enchant_legs_greater_stamina'],
    gloves: ['enchant_gloves_strength'],
    feet: ['enchant_feet_stamina'],
    ring: ['enchant_ring_strength'],
  },
  agi: {
    offhand: ['enchant_offhand_stamina'],
    helmet: ['enchant_helmet_greater_fortitude'],
    neck: ['enchant_neck_agility'],
    shoulder: ['enchant_shoulder_agility'],
    chest: ['enchant_chest_lucent_stamina'],
    waist: ['enchant_waist_agility'],
    legs: ['enchant_legs_runed_hide'],
    gloves: ['enchant_gloves_greater_agility'],
    feet: ['enchant_feet_lucent_agility'],
    ring: ['enchant_ring_agility'],
  },
  caster: {
    offhand: ['enchant_offhand_stamina'],
    helmet: ['enchant_helmet_intellect'],
    neck: ['enchant_neck_intellect'],
    shoulder: ['enchant_shoulder_intellect'],
    chest: ['enchant_chest_lucent_stamina'],
    waist: ['enchant_waist_stamina'],
    legs: ['enchant_legs_intellect'],
    gloves: ['enchant_gloves_intellect'],
    feet: ['enchant_feet_stamina'],
    ring: ['enchant_ring_intellect'],
  },
  healer: {},
};
ARMOR.healer = ARMOR.caster;

const WEAPON: Record<'nyth' | 'forge', Record<Line, readonly string[]>> = {
  nyth: {
    str: ['enchant_weapon_lucent_might'],
    tank: ['enchant_weapon_lucent_might'],
    agi: ['enchant_weapon_agility'],
    caster: ['enchant_weapon_lucent_spellpower'],
    healer: ['enchant_weapon_lucent_spellpower'],
  },
  forge: {
    str: ['enchant_weapon_piston_drive', 'enchant_weapon_lastflame_zeal'],
    tank: ['enchant_weapon_lastflame_zeal'],
    agi: ['enchant_weapon_riftwalkers_grace'],
    caster: ['enchant_weapon_dawnfire_etching'],
    healer: ['enchant_weapon_dawns_benediction'],
  },
};

/** Every enchant id the plan can name, for the content pin test. */
export function devBisEnchantCandidates(): readonly string[] {
  const ids = new Set<string>();
  const lists = [
    ...Object.values(ARMOR).flatMap((line) => Object.values(line)),
    ...Object.values(WEAPON).flatMap((tier) => Object.values(tier)),
  ];
  for (const list of lists) for (const id of list ?? []) ids.add(id);
  return [...ids];
}

function lineFor(cls: PlayerClass, kit: string): Line {
  // The tank variants (bis_gear.ts resolveDevBisKit) and the cat default.
  if (kit === 'bear' || kit === 'stonebound') return 'tank';
  if (cls === 'druid' && kit === 'feral') return 'str';
  const role = DEV_KIT_ROLES[cls]?.find((r) => r.spec === kit);
  if (role?.healer) return 'healer';
  if (role?.weights.int) return 'caster';
  if (role?.tank) return 'tank';
  return cls === 'rogue' || cls === 'hunter' ? 'agi' : 'str';
}

/** Whether `enchantId` may sit on `itemId`: the item's own slot and grip. */
export function enchantFitsItem(enchantId: string, itemId: string): boolean {
  const enchant = ENCHANTS[enchantId];
  const item = ITEMS[itemId];
  if (!enchant || !item) return false;
  return item.slot === enchant.itemSlot && enchantAdmitsWeaponHand(enchant, item);
}

/** The enchant per worn slot for a kit (a spec id or a variant kit key such
 *  as 'bear') on the given tier. */
export function devBisEnchantsFor(
  cls: PlayerClass,
  kit: string,
  tier: DevEnchantTier,
  gear: Readonly<Partial<Record<EquipSlot, string>>>,
): Partial<Record<EquipSlot, string>> {
  const line = lineFor(cls, kit);
  // Hunters shoot: ranged attacks never trigger the Forge melee procs.
  // PvP kits take the best (Forge) weapon formulas.
  const weapons = WEAPON[tier === 'nyth' ? 'nyth' : 'forge'];
  const weaponList = cls === 'hunter' ? WEAPON.nyth.agi : weapons[line];
  const out: Partial<Record<EquipSlot, string>> = {};
  for (const [slot, itemId] of Object.entries(gear) as [EquipSlot, string][]) {
    const item = ITEMS[itemId];
    if (!item) continue;
    const key: SlotKey =
      item.kind === 'weapon'
        ? 'weapon'
        : slot === 'ring1' || slot === 'ring2'
          ? 'ring'
          : (slot as SlotKey);
    // A spell-power weapon takes the caster rune; a weapon whose def slot is
    // the offhand falls through to the offhand enchants.
    const spellWeaponOnMelee = (item.spellPower ?? 0) > 0 && line !== 'caster' && line !== 'healer';
    const handList = spellWeaponOnMelee ? weapons.caster : weaponList;
    const list =
      key === 'weapon' ? [...handList, ...(ARMOR[line].offhand ?? [])] : (ARMOR[line][key] ?? []);
    const pick = list.find((id) => enchantFitsItem(id, itemId));
    if (pick) out[slot] = pick;
  }
  return out;
}

export type DevEnchantResult = 'ok' | 'empty_slot' | 'unknown_enchant' | 'wrong_slot';

/** The /dev enchant applier: bakes `enchantId` into the copy worn in `slot`
 *  exactly as a real apply mints it (replacing an enchant already there),
 *  with no recipe, skill or reagent gate. Dev-only (ALLOW_DEV_COMMANDS). */
export function applyDevEnchant(
  ctx: SimContext,
  pid: number,
  slot: EquipSlot,
  enchantId: string,
): DevEnchantResult {
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  const itemId = meta?.equipment[slot];
  if (!meta || !player || !itemId) return 'empty_slot';
  const enchant = ENCHANTS[enchantId];
  if (!enchant) return 'unknown_enchant';
  if (!enchantFitsItem(enchantId, itemId)) return 'wrong_slot';
  const worn = meta.equipmentInstance[slot];
  meta.equipmentInstance[slot] =
    worn && isEnchantedInstance(worn) && (worn.enchant === undefined || ENCHANTS[worn.enchant])
      ? replacedEnchantPayloadFor(worn, enchant)
      : enchantedPayloadFor(worn, enchant);
  refreshModsForEquipmentChange(ctx, meta);
  recalcPlayerStats(player, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  return 'ok';
}
