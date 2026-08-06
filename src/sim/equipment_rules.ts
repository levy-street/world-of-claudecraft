import {
  ALL_CLASSES,
  ALL_EQUIP_SLOTS,
  type ArmorItemDef,
  type ArmorType,
  type EquipSlot,
  type ItemDef,
  type PlayerClass,
  type WeaponItemDef,
} from './types';

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

export function isShieldItem(item: ItemDef | undefined): item is ArmorItemDef {
  return item?.kind === 'armor' && item.slot === 'offhand' && item.shield === true;
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

// Whether a concrete equipment key can structurally hold `item`, i.e. whether an
// aimed slot (a paperdoll drop target) is legal for the dragged piece. Rings
// declare the slot KIND 'ring' and accept either finger. One-hand and two-hand
// weapons declare 'mainhand' as their default slot but may also target offhand;
// canEquipItemInSlot applies the class/spec rule afterward. Slotless items
// (consumables, materials) accept nothing. This is the ONE structural rule the
// equip path and HUD drop target share, so their validation cannot disagree.
export function slotAcceptsItem(item: ItemDef, slot: EquipSlot): boolean {
  if (!item.slot) return false;
  if (item.slot === 'ring') return slot === 'ring1' || slot === 'ring2';
  if (item.kind === 'weapon' && slot === 'offhand') return weaponHand(item) !== 'mainhand';
  return item.slot === slot;
}

// Every legendary item is unique-equipped: a character wears at most one copy
// of a given legendary at a time. Derived from quality rather than a per-item
// flag so a new legendary can never forget to opt in.
export function isUniqueEquipped(item: ItemDef): boolean {
  return item.quality === 'legendary';
}

// The uniqueness KEY. A heroic upgrade variant (content/heroic_variants.ts,
// `heroicOf`) is the same item at a higher tier, so it shares its base item's
// family: Thronebane plus heroic Thronebane is still two Thronebanes, both
// firing their procs, which is exactly what the rule exists to stop.
export function uniqueEquipFamily(item: ItemDef): string {
  return item.heroicOf ?? item.id;
}

// The worn slot that would break the unique-equipped rule if `item` were
// equipped now, or null when the equip is legal. `ignoreSlots` names the slots
// this equip empties or overwrites (the target slot itself, plus a slot the
// swap displaces, e.g. the offhand a two-hander benches), which therefore
// cannot conflict with the incoming copy. `lookup` resolves a worn id to its
// def (the sim passes ITEMS; injected so this leaf stays data-free).
export function uniqueEquipConflictSlot(
  item: ItemDef,
  equipment: Partial<Record<EquipSlot, string>>,
  lookup: (id: string) => ItemDef | undefined,
  ignoreSlots: readonly EquipSlot[],
): EquipSlot | null {
  if (!isUniqueEquipped(item)) return null;
  const family = uniqueEquipFamily(item);
  for (const slot of ALL_EQUIP_SLOTS) {
    if (ignoreSlots.includes(slot)) continue;
    const wornId = equipment[slot];
    if (!wornId) continue;
    const worn = lookup(wornId);
    if (!worn || !isUniqueEquipped(worn)) continue;
    if (uniqueEquipFamily(worn) === family) return slot;
  }
  return null;
}

// The slot an equip into `slot` empties as a side effect (the two-hand/offhand
// exclusion): equipping into the offhand benches a worn two-hand mainhand, and
// equipping a two-hander into the mainhand benches the offhand. Fury's Titan
// Grip exemption is weapon-only: a valid Fury pair may contain one or two
// two-handers, so nothing is displaced. `lookup` resolves an equipped id to its
// def (the sim passes ITEMS; kept injected so this leaf stays data-free). This
// is THE displacement rule equipItem applies; the paperdoll drop feedback
// mirrors it so the two can never disagree.
export function displacedSlotForEquip(
  item: ItemDef,
  slot: EquipSlot,
  equipment: Partial<Record<EquipSlot, string>>,
  lookup: (id: string) => ItemDef | undefined,
  cls: PlayerClass,
  spec?: string | null,
): EquipSlot | null {
  if (slot === 'offhand') {
    const mainhand = equipment.mainhand ? lookup(equipment.mainhand) : undefined;
    const titanPair = item.kind === 'weapon' && canDualWieldTwoHand(cls, spec);
    if (mainhand?.kind === 'weapon' && weaponHand(mainhand) === 'twohand' && !titanPair) {
      return 'mainhand';
    }
    return null;
  }
  if (slot === 'mainhand' && item.kind === 'weapon' && weaponHand(item) === 'twohand') {
    const offhand = equipment.offhand ? lookup(equipment.offhand) : undefined;
    const titanPair = offhand?.kind === 'weapon' && canDualWieldTwoHand(cls, spec);
    if (equipment.offhand && !titanPair) return 'offhand';
  }
  return null;
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

// The full set of classes `canEquipItem` actually admits for a given armor weight,
// i.e. every class whose max armor rank is at least `armorType`'s rank. Used to tell
// a genuinely enforced armor class list (one that names exactly this set, e.g. mail
// naming only warrior/paladin/shaman) apart from `requiredClass` values that are
// narrower loot-targeting metadata `canEquipItem` never reads (armor short-circuits
// on weight before it would reach `requiredClass`).
export function classesThatCanEquipArmorType(armorType: ArmorType): PlayerClass[] {
  const rank = ARMOR_RANK[armorType];
  return ALL_CLASSES.filter((cls) => ARMOR_RANK[maxArmorTypeForClass(cls)] >= rank);
}

export function canDualWield(cls: PlayerClass, spec?: string | null): boolean {
  return cls === 'rogue' || (cls === 'warrior' && spec === 'fury');
}

export function canDualWieldTwoHand(cls: PlayerClass, spec?: string | null): boolean {
  return cls === 'warrior' && spec === 'fury';
}

export function weaponHand(item: WeaponItemDef): WeaponItemDef['hand'] {
  return item.hand ?? 'onehand';
}

export function canEquipItem(cls: PlayerClass, item: ItemDef): boolean {
  if (isShieldItem(item)) {
    return !item.requiredClass || item.requiredClass.includes(cls);
  }
  // Held offhands (caster orbs/tomes) carry no armor class or weapon proficiency:
  // the literal requiredClass list is the whole rule, like shields.
  if (item.kind === 'held_offhand') {
    return !item.requiredClass || item.requiredClass.includes(cls);
  }
  const armorType = armorTypeForItem(item);
  if (armorType) return ARMOR_RANK[armorType] <= ARMOR_RANK[maxArmorTypeForClass(cls)];
  // Rogues may dual wield one-handed weapons, but can never equip a two-hander.
  // Keep this at the equipment boundary so future items cannot bypass it through
  // a missing or overly broad requiredClass list.
  if (cls === 'rogue' && item.kind === 'weapon' && weaponHand(item) === 'twohand') {
    return false;
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
    if (item.slot === 'ring') return slot === 'ring1' || slot === 'ring2';
    return item.slot === slot;
  }
  if (item.kind !== 'weapon') return item.slot === slot;
  const hand = weaponHand(item);
  if (slot === 'mainhand') return true;
  if (slot !== 'offhand' || !canDualWield(cls, spec)) return false;
  return hand === 'onehand' || (hand === 'twohand' && canDualWieldTwoHand(cls, spec));
}
