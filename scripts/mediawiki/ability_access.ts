import { CLASSES, ITEMS } from '../../src/sim/data';
import { membershipAbilities } from '../../src/sim/membership_abilities';
import type { AbilityDef } from '../../src/sim/types';

const membershipIds = new Set(membershipAbilities([], true).map(({ def }) => def.id));

/** The action bar borrows an AbilityDef to aim the bomb, but useItem consumes and detonates it. */
export function itemActionSource(def: AbilityDef) {
  const item = ITEMS[def.id];
  return item?.use?.type === 'shockBomb' ? item : undefined;
}

export const MEMBERSHIP_GROUP = 'Membership actions';

export function abilityIndexGroup(def: AbilityDef) {
  if (itemActionSource(def)) return 'Item actions';
  if (membershipIds.has(def.id)) return MEMBERSHIP_GROUP;
  return CLASSES[def.class].name;
}
