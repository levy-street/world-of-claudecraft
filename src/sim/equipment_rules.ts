import type { ArmorType, EquipSlot, ItemDef, PlayerClass, WeaponItemDef } from './types';

type WeaponArchetype = 'warrior' | 'caster' | 'rogue';

const MAIL_CLASSES = new Set<PlayerClass>(['warrior', 'paladin', 'shaman']);
const LEATHER_CLASSES = new Set<PlayerClass>(['druid', 'rogue', 'hunter']);
const WARRIOR_WEAPON_CLASSES = new Set<PlayerClass>([
  'warrior',
  'rogue',
  'hunter',
  'shaman',
  'paladin',
]);
const CASTER_WEAPON_CLASSES = new Set<PlayerClass>([
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
]);
const ROGUE_WEAPON_CLASSES = new Set<PlayerClass>(['rogue', 'hunter']);

const ARMOR_RANK: Record<ArmorType, number> = {
  cloth: 0,
  leather: 1,
  mail: 2,
};

// True when `classes` names exactly the members of `allowed` (order-independent).
function sameClassSet(classes: readonly PlayerClass[], allowed: ReadonlySet<PlayerClass>): boolean {
  return classes.length === allowed.size && classes.every((cls) => allowed.has(cls));
}

export function armorTypeForItem(item: ItemDef): ArmorType | null {
  if (item.kind !== 'armor') return null;
  // Jewelry (neck/ring) is kind 'armor' with no armor class.
  return item.armorType ?? null;
}

// Resolve the concrete equipment key an item equips into. Rings declare the
// slot KIND 'ring' and land in whichever ring slot is empty (ring1 first);
// with both full the swap replaces ring1, the classic behavior. Every other
// item names its equipment slot directly. Returns null for slotless items.
export function resolveEquipSlot(
  item: ItemDef,
  equipment: Partial<Record<EquipSlot, string>>,
): EquipSlot | null {
  if (!item.slot) return null;
  if (item.slot !== 'ring') return item.slot;
  if (!equipment.ring1) return 'ring1';
  if (!equipment.ring2) return 'ring2';
  return 'ring1';
}

export function maxArmorTypeForClass(cls: PlayerClass): ArmorType {
  if (MAIL_CLASSES.has(cls)) return 'mail';
  if (LEATHER_CLASSES.has(cls)) return 'leather';
  return 'cloth';
}

// A weapon's `requiredClass` lists exactly the classes that can equip it, i.e. the
// full weapon-proficiency group (weapons are proficiency-based, not class-locked).
// Recover the archetype by matching that list against each group. A weapon with a
// narrower, bespoke class lock (not one of the three groups) has no archetype and
// falls through to the literal `requiredClass` check in canEquipItem, and shows its
// class line on the tooltip.
export function weaponArchetypeForItem(item: ItemDef): WeaponArchetype | null {
  if (item.kind !== 'weapon' || !item.requiredClass) return null;
  if (sameClassSet(item.requiredClass, WARRIOR_WEAPON_CLASSES)) return 'warrior';
  if (sameClassSet(item.requiredClass, CASTER_WEAPON_CLASSES)) return 'caster';
  if (sameClassSet(item.requiredClass, ROGUE_WEAPON_CLASSES)) return 'rogue';
  return null;
}

export function canDualWield(cls: PlayerClass, spec?: string | null): boolean {
  return cls === 'rogue' || (cls === 'warrior' && spec === 'fury');
}

// Titan's Grip (owner decision 2026-07-10): a Fury warrior dual-wields
// two-handers, one in EACH weapon slot (and may mix 2H with 1H). Weapons only:
// a shield still never sits with a two-handed mainhand, for anyone.
export function canDualWieldTwoHand(cls: PlayerClass, spec?: string | null): boolean {
  return cls === 'warrior' && spec === 'fury';
}

export function weaponHand(item: WeaponItemDef): WeaponItemDef['hand'] {
  return item.hand ?? 'onehand';
}

export function canEquipItem(cls: PlayerClass, item: ItemDef): boolean {
  const armorType = armorTypeForItem(item);
  if (armorType) return ARMOR_RANK[armorType] <= ARMOR_RANK[maxArmorTypeForClass(cls)];
  if (item.kind === 'shield' || item.kind === 'held_offhand') {
    if (item.requiredClass) return item.requiredClass.includes(cls);
    return true;
  }
  const weaponArchetype = weaponArchetypeForItem(item);
  if (weaponArchetype === 'warrior') return WARRIOR_WEAPON_CLASSES.has(cls);
  if (weaponArchetype === 'caster') return CASTER_WEAPON_CLASSES.has(cls);
  if (weaponArchetype === 'rogue') return ROGUE_WEAPON_CLASSES.has(cls);
  if (item.requiredClass) return item.requiredClass.includes(cls);
  return true;
}

export function canEquipItemInSlot(
  cls: PlayerClass,
  item: ItemDef,
  slot: EquipSlot,
  spec?: string | null,
): boolean {
  if (!canEquipItem(cls, item)) return false;
  if (item.kind === 'armor') {
    // Rings declare slot 'ring' but bind to either physical ring slot.
    if (item.slot === 'ring') return slot === 'ring1' || slot === 'ring2';
    return item.slot === slot;
  }
  if (item.kind === 'shield' || item.kind === 'held_offhand') return slot === 'offhand';
  if (item.kind !== 'weapon') return item.slot === slot;
  const hand = weaponHand(item);
  if (slot === 'mainhand') return true;
  if (slot !== 'offhand') return false;
  if (!canDualWield(cls, spec)) return false;
  return hand === 'onehand' || (hand === 'twohand' && canDualWieldTwoHand(cls, spec));
}
