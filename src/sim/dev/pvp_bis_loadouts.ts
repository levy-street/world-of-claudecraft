// Level-20 PvP best-in-slot loadouts for every kit: the `/dev bis pvp` kit,
// beside the Nythraxis (parse_bis_loadouts.ts) and Forge (forge_bis_loadouts.ts)
// tiers. Draws no rng; pure derivation from the Warfare content tables.
//
// The rules (owner call, 2026-11-26):
//   - Season 2 ("Vanguard", content/pvp_honor_season2.ts) everywhere it
//     reaches: the spec's five-piece set (helmet, shoulders, chest, legs,
//     gloves), its weapon and its role's neck and two rings. Cat and bear wear
//     the feral set, Galeheart and Stonebound the enhancement set.
//   - Season 1 (Warfare entry tier, content/pvp_honor.ts) fills the belt and
//     boots, which Season 2 does not make: the role's line in the kit's armor
//     type. The feral kits take the one physical leather line (Ashstalker).
//   - The trinket is the Season 1 Medallion of Defiance, the PvP trinket.
//   - A shield or quiver has no Warfare version, so those kits keep the off
//     hand of their Nyth kit.
// The enchant plan (bis_enchants.ts) gives every piece Stamina or the main
// stat, and the weapons the Forge raid formulas.

import { DEV_KIT_ROLES } from '../content/dev_kit_roles';
import { SEASON2_SETS } from '../content/pvp_honor_season2';
import type { EquipSlot, PlayerClass } from '../types';
import { resolveDevBisKit } from './bis_kits';
import { parseBisGearFor } from './parse_bis_loadouts';

type PvpGear = Readonly<Partial<Record<EquipSlot, string>>>;
type Role = 'might' | 'precision' | 'focus' | 'mending';

const GREATSWORD = 'vanguard_verdict_greatsword';
const ONE_HAND = 'vanguard_oath_blade';
const DAGGER = 'vanguard_fang_dagger';
const STAFF = 'vanguard_warstaff';
const FERAL_STAFF = 'vanguard_feral_staff';
/** Marks an off hand taken from the kit's Nyth loadout (shield or quiver). */
const NYTH_OFFHAND = 'nyth';

// The Season 2 weapon per kit. A two-hander leaves the off hand empty, except
// fury, the one spec that wields two (equipment_rules.ts canDualWieldTwoHand).
const WEAPONS: Readonly<Record<string, { mainhand: string; offhand?: string }>> = {
  'warrior/arms': { mainhand: GREATSWORD },
  'warrior/fury': { mainhand: GREATSWORD, offhand: GREATSWORD },
  'warrior/prot': { mainhand: ONE_HAND, offhand: NYTH_OFFHAND },
  'paladin/holy': { mainhand: STAFF },
  'paladin/protection': { mainhand: ONE_HAND, offhand: NYTH_OFFHAND },
  'paladin/retribution': { mainhand: GREATSWORD },
  'hunter/beast_mastery': { mainhand: DAGGER, offhand: NYTH_OFFHAND },
  'hunter/marksmanship': { mainhand: DAGGER, offhand: NYTH_OFFHAND },
  'hunter/survival': { mainhand: DAGGER, offhand: NYTH_OFFHAND },
  'rogue/assassination': { mainhand: DAGGER, offhand: DAGGER },
  'rogue/combat': { mainhand: DAGGER, offhand: DAGGER },
  'rogue/subtlety': { mainhand: DAGGER, offhand: DAGGER },
  'priest/discipline': { mainhand: STAFF },
  'priest/holy': { mainhand: STAFF },
  'priest/shadow': { mainhand: STAFF },
  'shaman/elemental': { mainhand: STAFF },
  'shaman/enhancement': { mainhand: ONE_HAND, offhand: ONE_HAND },
  'shaman/stonebound': { mainhand: ONE_HAND, offhand: NYTH_OFFHAND },
  'shaman/restoration': { mainhand: STAFF },
  'mage/arcane': { mainhand: STAFF },
  'mage/fire': { mainhand: STAFF },
  'mage/frost': { mainhand: STAFF },
  'warlock/affliction': { mainhand: STAFF },
  'warlock/demonology': { mainhand: STAFF },
  'warlock/destruction': { mainhand: STAFF },
  'druid/balance': { mainhand: STAFF },
  'druid/feral': { mainhand: FERAL_STAFF },
  'druid/bear': { mainhand: FERAL_STAFF },
  'druid/restoration': { mainhand: STAFF },
};

// Season 1 belt and boots per armor type and role.
const WAIST_FEET: Readonly<Record<string, readonly [string, string]>> = {
  'mail/might': ['furyforged_girdle', 'furyforged_sabatons'],
  'mail/focus': ['stormbound_waistguard', 'stormbound_greaves'],
  'mail/mending': ['stormbound_waistguard', 'stormbound_greaves'],
  'leather/might': ['ashstalker_waistband', 'ashstalker_treads'],
  'leather/precision': ['ashstalker_waistband', 'ashstalker_treads'],
  'leather/focus': ['thornhide_cinch', 'thornhide_boots'],
  'leather/mending': ['thornhide_cinch', 'thornhide_boots'],
  'cloth/focus': ['cinderweave_cord', 'cinderweave_slippers'],
  'cloth/mending': ['cinderweave_cord', 'cinderweave_slippers'],
};

const TRINKET = 'medallion_of_defiance';

function roleFor(cls: PlayerClass, spec: string): Role {
  const role = DEV_KIT_ROLES[cls]?.find((r) => r.spec === spec);
  if (role?.healer) return 'mending';
  if (cls === 'druid' && spec === 'feral') return 'might';
  if (role?.weights.int) return 'focus';
  return cls === 'rogue' || cls === 'hunter' ? 'precision' : 'might';
}

/** The PvP kit for a kit key (a spec id or a variant such as 'bear'), or
 *  null when the class has no such kit. */
export function pvpBisGearFor(cls: PlayerClass, kit: string): PvpGear | null {
  const resolved = resolveDevBisKit(cls, kit);
  const weapons = WEAPONS[`${cls}/${resolved?.kit ?? ''}`];
  const set = SEASON2_SETS.find((s) => s.cls === cls && s.spec === resolved?.spec);
  if (!resolved || !weapons || !set) return null;
  const role = roleFor(cls, resolved.spec);
  const waistFeet = WAIST_FEET[`${set.armorType}/${role}`];
  if (!waistFeet) return null;
  const gear: Partial<Record<EquipSlot, string>> = { mainhand: weapons.mainhand };
  if (weapons.offhand === NYTH_OFFHAND) {
    const offhand = parseBisGearFor(cls, resolved.kit)?.offhand;
    if (offhand) gear.offhand = offhand;
  } else if (weapons.offhand) {
    gear.offhand = weapons.offhand;
  }
  for (const id of set.itemIds) {
    const slot = id.slice(id.lastIndexOf('_') + 1) as EquipSlot;
    gear[slot] = id;
  }
  gear.waist = waistFeet[0];
  gear.feet = waistFeet[1];
  gear.neck = `vanguard_pendant_of_${role}`;
  gear.ring1 = `vanguard_band_of_${role}`;
  gear.ring2 = `vanguard_band_of_${role}`;
  gear.trinket = TRINKET;
  return Object.freeze(gear);
}
