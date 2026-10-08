/** The size a held weapon draws at for the ITEM that puts it in the hand.
 *
 * A weapon MODEL has one size (weapon_grip.ts WEAPON_GRIP_OVERRIDES). But the plain "field"
 * models are shared across three rarities: a rare weapon is a common shape in another paint
 * (src/ui/weapon_variants.ts). So a rule about rarity cannot live on the model: it reads the
 * item.
 *
 * The owner's rule: a common or uncommon weapon draws a fifth smaller than the same shape
 * does at rare and above, "so it feels like you are progressing in the game" (a tenth at
 * first, then "even smaller just by another 10%"). Weapons only:
 * a shield or a held off-hand (orb, tome) keeps its size, and so does a weapon skin, which
 * is a model the player chose, not the item's own.
 *
 * Node-only (RENDER_PURE_CORES): no three.js, no DOM.
 */
import { ITEMS } from '../../sim/data';

/** How large a common or uncommon weapon draws against the same model at rare and above. */
export const LOW_TIER_WEAPON_SIZE = 0.8;

/** The size the held model of `itemId` draws at, about the hand: 1 is the model's own size
 *  (an item with no quality is a common one, as its name colour is). */
export function heldWeaponSize(itemId: string | null | undefined): number {
  const item = itemId ? ITEMS[itemId] : undefined;
  if (item?.kind !== 'weapon') return 1;
  const quality = item.quality ?? 'common';
  return quality === 'poor' || quality === 'common' || quality === 'uncommon'
    ? LOW_TIER_WEAPON_SIZE
    : 1;
}
