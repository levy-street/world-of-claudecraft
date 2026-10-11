// Equipment cast requirements: a shield in the off hand (Shield Slam, Raised Guard,
// Sunward Disc, Bastion Sweep) and a dagger in the main hand (the requiresBehind
// weaponStrike family: Backstab, Ambush).
//
// A pure leaf shared by the cast gate (combat/casting_lifecycle.ts) and the action
// bar (ui/hud/action_bar/action_bar_view.ts). Both read the WORN item ids, which the
// live Entity and the online ClientWorld mirror carry alike (`equippedItems`, the
// identity wire's `eq`); the derived `weapon.dagger` stat is sim-only, so the dagger
// check re-derives it the way recalcPlayerStats does (an over-level main hand is
// inert and drops its weapon-type flags).
import { ITEMS } from '../data';
import { isShieldItem } from '../equipment_rules';
import { meetsLevelRequirement } from '../item_level_req';
import type { AbilityEffect, EquipSlot } from '../types';

type WornItems = Partial<Record<EquipSlot, string>>;

/** Is a shield worn in the off hand? */
export function shieldEquipped(worn: WornItems): boolean {
  const offhand = worn.offhand;
  return offhand !== undefined && isShieldItem(ITEMS[offhand]);
}

/** Does the worn main hand count as a dagger at this level? Mirrors the
 *  `weapon.dagger` recalcPlayerStats derives for the cast gate. */
export function wieldsDagger(worn: WornItems, level: number): boolean {
  const mainhand = worn.mainhand !== undefined ? ITEMS[worn.mainhand] : undefined;
  return (
    mainhand?.weapon?.dagger === true &&
    mainhand !== undefined &&
    meetsLevelRequirement(level, mainhand)
  );
}

/** Does any of these (rank-resolved) effects need a dagger? */
export function effectsRequireDagger(effects: readonly AbilityEffect[]): boolean {
  for (const effect of effects) {
    if (effect.type === 'weaponStrike' && effect.requiresBehind) return true;
  }
  return false;
}
