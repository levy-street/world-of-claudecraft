// The one owned item keeps its identity; class/spec choose its live hand, damage,
// attribute profile and held-model identity. No donor item's effects are copied.
import {
  MEMBERSHIP_DEFAULT_PROFILE,
  MEMBERSHIP_PROFILES,
  MEMBERSHIP_SPEC_PROFILE,
  MEMBERSHIP_WEAPON_ID,
} from './content/membership';
import {
  normalizeToStaminaModel,
  primaryStatBudget,
  scaleWeaponDamage,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from './item_budget';
import type { ItemDef, PlayerClass, WeaponHand } from './types';

export function isMembershipWeapon(id: string): boolean {
  return id === MEMBERSHIP_WEAPON_ID;
}

export function membershipWeaponForm(cls: PlayerClass, spec?: string | null) {
  let model = 'gnarled_staff';
  let hand: WeaponHand = 'onehand';
  let speed = 2.9;
  let dagger = false;
  if (cls === 'warrior' || cls === 'paladin') {
    const tank = spec === 'prot' || spec === 'protection';
    const healer = cls === 'paladin' && spec === 'holy';
    model = tank ? 'worn_sword' : healer ? 'training_mace' : 'eastbrook_greatsword';
    hand = tank || healer ? 'onehand' : 'twohand';
    speed = hand === 'twohand' ? 3.4 : 2;
  } else if (cls === 'rogue') {
    dagger = spec !== 'combat';
    model = dagger ? 'rusty_dagger' : 'worn_sword';
    speed = dagger ? 1.8 : 2;
  } else if (cls === 'hunter') {
    // Hunters derive Auto Shot from mainhand damage, while their rig holds the
    // ranged weapon. A two-hand stat stick coexists with the worn quiver.
    model = 'eastbrook_greatsword';
    hand = 'twohand';
    speed = 3.4;
  } else if (cls === 'shaman' && spec === 'enhancement') {
    model = 'training_mace';
    speed = 2;
  } else if (cls === 'druid' && spec === 'feral') {
    hand = 'twohand';
  }
  return { model, hand, speed, dagger };
}

/** Structural projection for shared equip legality (no level or authority needed). */
export function membershipWeaponShape(
  item: ItemDef,
  cls: PlayerClass,
  spec?: string | null,
): ItemDef {
  if (!isMembershipWeapon(item.id) || item.kind !== 'weapon') return item;
  const form = membershipWeaponForm(cls, spec);
  return {
    ...item,
    hand: form.hand,
    weapon: { ...item.weapon, speed: form.speed, dagger: form.dagger },
  };
}

export function membershipWeaponItem(
  item: ItemDef,
  cls: PlayerClass,
  spec: string | null | undefined,
  level: number,
  active: boolean,
): ItemDef {
  const shaped = membershipWeaponShape(item, cls, spec);
  if (!isMembershipWeapon(item.id) || shaped.kind !== 'weapon') return shaped;
  if (!active) return { ...shaped, stats: {}, weapon: { min: 1, max: 2, speed: 2 } };
  const ilvl = Math.max(1, Math.floor(level)) + 5;
  const twohand = shaped.hand === 'twohand';
  const profile = MEMBERSHIP_SPEC_PROFILE[`${cls}_${spec}`] ?? MEMBERSHIP_DEFAULT_PROFILE[cls];
  const budget = Math.round(
    primaryStatBudget(ilvl, 'rare', 'mainhand') * (twohand ? TWOHAND_STAT_MULT : 1),
  );
  const damage = scaleWeaponDamage(
    { min: 2, max: 4, speed: shaped.weapon.speed },
    weaponDpsBudget(ilvl) * (twohand ? TWOHAND_DPS_MULT : 1),
  );
  return {
    ...shaped,
    stats: normalizeToStaminaModel(MEMBERSHIP_PROFILES[profile], budget),
    weapon: { ...shaped.weapon, ...damage },
  };
}

export function membershipWeaponDisplayId(
  id: string | null,
  cls: PlayerClass,
  spec?: string | null,
): string | null {
  return id && isMembershipWeapon(id) ? membershipWeaponForm(cls, spec).model : id;
}
