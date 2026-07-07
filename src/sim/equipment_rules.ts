import type { ArmorType, EquipSlot, ItemDef, PlayerClass } from './types';

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
const OLD_WARRIOR_WEAPON_ARCHETYPE = new Set<PlayerClass>(['warrior', 'paladin', 'shaman']);
const OLD_CASTER_WEAPON_ARCHETYPE = new Set<PlayerClass>(['mage', 'priest', 'warlock', 'druid']);

const ARMOR_RANK: Record<ArmorType, number> = {
  cloth: 0,
  leather: 1,
  mail: 2,
};

function subsetOf(classes: readonly PlayerClass[], allowed: ReadonlySet<PlayerClass>): boolean {
  return classes.length > 0 && classes.every((cls) => allowed.has(cls));
}

export function armorTypeForItem(item: ItemDef): ArmorType | null {
  if (item.kind !== 'armor') return null;
  // Jewelry (neck/ring) is kind 'armor' with no armor class.
  return item.armorType ?? null;
}

// Resolve the concrete equipment key an item equips into. Rings declare the
// slot KIND 'ring' and land in whichever ring slot is empty (ring1 first);
// with both full the swap replaces ring1, the classic behavior. Rings are
// UNIQUE-EQUIPPED: a second copy of a ring already worn in either slot never
// equips (returns null; the equip command surfaces the classic error, the
// auto-equip path skips silently). Every other item names its equipment slot
// directly. Returns null for slotless items.
export function resolveEquipSlot(
  item: ItemDef,
  equipment: Partial<Record<EquipSlot, string>>,
): EquipSlot | null {
  if (!item.slot) return null;
  if (item.slot !== 'ring') return item.slot;
  if (equipment.ring1 === item.id || equipment.ring2 === item.id) return null;
  if (!equipment.ring1) return 'ring1';
  if (!equipment.ring2) return 'ring2';
  return 'ring1';
}

export function maxArmorTypeForClass(cls: PlayerClass): ArmorType {
  if (MAIL_CLASSES.has(cls)) return 'mail';
  if (LEATHER_CLASSES.has(cls)) return 'leather';
  return 'cloth';
}

export function weaponArchetypeForItem(item: ItemDef): WeaponArchetype | null {
  if (item.kind !== 'weapon' || !item.requiredClass) return null;
  if (subsetOf(item.requiredClass, OLD_WARRIOR_WEAPON_ARCHETYPE)) return 'warrior';
  if (subsetOf(item.requiredClass, OLD_CASTER_WEAPON_ARCHETYPE)) return 'caster';
  if (subsetOf(item.requiredClass, ROGUE_WEAPON_CLASSES)) return 'rogue';
  return null;
}

export function canEquipItem(cls: PlayerClass, item: ItemDef): boolean {
  const armorType = armorTypeForItem(item);
  if (armorType) return ARMOR_RANK[armorType] <= ARMOR_RANK[maxArmorTypeForClass(cls)];
  const weaponArchetype = weaponArchetypeForItem(item);
  if (weaponArchetype === 'warrior') return WARRIOR_WEAPON_CLASSES.has(cls);
  if (weaponArchetype === 'caster') return CASTER_WEAPON_CLASSES.has(cls);
  if (weaponArchetype === 'rogue') return ROGUE_WEAPON_CLASSES.has(cls);
  if (item.requiredClass) return item.requiredClass.includes(cls);
  return true;
}
