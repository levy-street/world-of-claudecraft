import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../../item_budget';
import type { ItemDef, WeaponInfo } from '../../types';
import { PROCEDURAL_ITEM_BASES } from './bases';
import type { ProceduralItemBase } from './types';

function sourceWeapon(base: ProceduralItemBase): WeaponInfo | undefined {
  if (!base.baseWeapon) return undefined;
  const dps = weaponDpsBudget(base.sourceLevel) * (base.hand === 'twohand' ? TWOHAND_DPS_MULT : 1);
  const average = dps * base.baseWeapon.speed;
  return {
    min: Math.max(1, Math.round(average * (1 - base.baseWeapon.damageSpread))),
    max: Math.max(1, Math.round(average * (1 + base.baseWeapon.damageSpread))),
    speed: base.baseWeapon.speed,
    ...(base.dagger && { dagger: true }),
  };
}

function itemDefinition(base: ProceduralItemBase): ItemDef {
  const shared = {
    id: base.id,
    name: base.name,
    slot: base.slot,
    quality: 'common' as const,
    sellValue: Math.max(1, Math.round(base.sourceLevel * base.slotMultiplier * 12)),
    ...(base.requiredClass && {
      requiredClass: [...base.requiredClass],
    }),
  };
  if (base.kind === 'weapon') {
    const weapon = sourceWeapon(base);
    if (!weapon) throw new Error(`procedural weapon base ${base.id} has no weapon data`);
    if (base.slot !== 'mainhand')
      throw new Error(`procedural weapon base ${base.id} must use the mainhand item slot`);
    return {
      ...shared,
      kind: 'weapon',
      slot: 'mainhand',
      ...(base.hand && { hand: base.hand }),
      weapon,
    };
  }
  if (base.kind === 'held_offhand') {
    return { ...shared, kind: 'held_offhand', slot: 'offhand' };
  }
  if (base.slot === 'ring' || base.slot === 'neck') {
    return { ...shared, kind: 'armor', slot: base.slot };
  }
  if (base.shield) {
    if (base.slot !== 'offhand' || !base.armorType || base.baseBlockValue === undefined)
      throw new Error(`procedural shield base ${base.id} has invalid shield data`);
    return {
      ...shared,
      kind: 'armor',
      slot: 'offhand',
      armorType: base.armorType,
      shield: true,
      blockValue: base.baseBlockValue,
      ...(base.baseArmor !== undefined && { stats: { armor: base.baseArmor } }),
    };
  }
  if (
    base.slot === 'mainhand' ||
    base.slot === 'offhand' ||
    base.slot === 'ring1' ||
    base.slot === 'ring2'
  )
    throw new Error(`procedural armor base ${base.id} has invalid item slot ${base.slot}`);
  return {
    ...shared,
    kind: 'armor',
    slot: base.slot,
    armorType: base.armorType ?? 'cloth',
    ...(base.baseArmor !== undefined && { stats: { armor: base.baseArmor } }),
  };
}

export const PROCEDURAL_BASE_ITEMS: Record<string, ItemDef> = Object.fromEntries(
  Object.values(PROCEDURAL_ITEM_BASES).map((base) => [base.id, itemDefinition(base)]),
);
