import { ENCHANTS, type EnchantDef } from '../content/enchants';
import { consumeSelectedInventorySlot, selectedInventorySlot } from '../item_copy_ref';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { RecipeItemDef } from '../types';

/** Ordinary enchants keep their free discovery; drop formulas require knowledge. */
export function isEnchantKnown(
  enchant: EnchantDef,
  known: ReadonlySet<string> | readonly string[] | undefined,
): boolean {
  if (enchant.acquisition !== 'drop') return true;
  return !!known && ('has' in known ? known.has(enchant.id) : known.includes(enchant.id));
}

/** A physical formula teaches an enchant, never a craftable surrogate item. */
export function useEnchantFormula(
  ctx: SimContext,
  itemId: string,
  def: RecipeItemDef,
  meta: PlayerMeta,
  slotIndex?: number,
): void {
  const enchant = def.teachesEnchantId ? ENCHANTS[def.teachesEnchantId] : undefined;
  if (!enchant || enchant.acquisition !== 'drop' || def.teachesRecipeId !== enchant.id) return;
  if (!meta.inventory.some((slot) => slot.itemId === itemId && slot.count > 0)) return;
  if (slotIndex !== undefined && selectedInventorySlot(meta.inventory, itemId, slotIndex) === null)
    return;
  if (isEnchantKnown(enchant, meta.knownRecipes)) {
    ctx.error(meta.entityId, 'You already know that recipe.');
    return;
  }
  const skill = meta.craftSkills.enchanting ?? 0;
  if (!Number.isFinite(skill) || skill < (enchant.skillReq ?? 0)) {
    ctx.error(meta.entityId, 'Your skill is too low to learn that pattern.');
    return;
  }
  const taken = consumeSelectedInventorySlot(meta.inventory, itemId, slotIndex);
  if (taken === null) return;
  meta.knownRecipes = new Set([...meta.knownRecipes, enchant.id]);
  if (taken === undefined) ctx.removeItem(itemId, 1, meta.entityId);
  else ctx.onInventoryChangedForQuests?.(meta);
  ctx.emit({ type: 'trainResult', pid: meta.entityId, recipeId: enchant.id, ok: true });
}
