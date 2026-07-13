// Inventory items + vendor: the player-facing equip/use/discard and buy/sell/buyback
// command bodies. Extracted from sim.ts (session W2) as a pure MOVE behind SimContext,
// exactly as PR #943 did for market.ts / loot/loot_roll.ts, and aligned to the
// IWorldInventory facet (src/world_api/inventory.ts). Each command is a free function
// `fn(ctx, ...args)`; the private vendor helpers (vendorInRange / recordVendorBuyback)
// and the side-effect-free addItemSilent are module-local. Sim keeps thin same-named
// delegates so the IWorld surface, server/game.ts, and the tests resolve unchanged.
//
// The inventory HUB (addItem/removeItem/countItem) and maybeAutoEquip STAY on Sim and
// are consumed through SimContext; `copper` stays a cross-facet economy field on Sim's
// PlayerMeta and is mutated here only through the resolved meta. recalcPlayerStats is
// the SOLE stat derivation (imported from entity.ts, never reimplemented). The
// immutability waiver applies: meta.copper / vendorBuyback / inventory / equipment are
// mutated in place verbatim, statements and order preserved.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). This region draws NO rng.

import { addStacked, bagCapacity, bagsFullError, equipBag as equipBagCmd } from './bags';
import { ITEMS } from './data';
import { recalcPlayerStats } from './entity';
import { canEquipItem, resolveEquipSlot, slotAcceptsItem } from './equipment_rules';
import { formatMoney } from './format_money';
import { moveStackToCell } from './inventory_order';
import { meetsLevelRequirement, requiredLevelFor } from './item_level_req';
import { battlefieldExperienceTrickle } from './professions/battlefield_xp';
import type { ItemUseResult, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  CONSUME_DURATION,
  CONSUME_TICKS,
  dist2d,
  type Entity,
  type EquipSlot,
  FISHING_CAST_ID,
  INTERACT_RANGE,
  type ItemInstancePayload,
  POTION_COOLDOWN,
} from './types';
import { vendorStackSize } from './vendor_stack';

const VENDOR_BUYBACK_LIMIT = 12;

// Fungible-preferring removal: consumes plain (non-instanced) copies first and
// only reaches for an instanced copy (an enchanted or otherwise signed/rolled
// piece) once no fungible copy remains. removeItem's own ordering (sim.ts) scans
// highest-index-first, which is exactly where applyEnchant's addItemInstance
// pushes a freshly-enchanted copy (professions/enchanting.ts), so a plain
// ctx.removeItem there would eat the enchanted copy first when both exist.
// sellItem/discardItem below and trade.ts's drop arm route through this instead
// so "sell/discard/trade one" prefers the plain copy a player almost always means.
export function removePreferFungible(
  ctx: SimContext,
  itemId: string,
  count: number,
  pid?: number,
): ItemInstancePayload[] {
  const fungibleAvailable = ctx.countFungibleItem(itemId, pid);
  const fungibleTake = Math.min(fungibleAvailable, count);
  if (fungibleTake > 0) ctx.removeFungibleItem(itemId, fungibleTake, pid);
  const remaining = count - fungibleTake;
  if (remaining <= 0) return [];
  return ctx.removeItem(itemId, remaining, pid);
}

export function discardItem(ctx: SimContext, itemId: string, count = 1, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const def = ITEMS[itemId];
  const available = ctx.countItem(itemId, meta.entityId);
  if (!def || available <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  if (def.noDiscard) return;
  const discardCount = Number.isFinite(count) ? Math.min(Math.floor(count), available) : 0;
  if (discardCount <= 0) return;
  removePreferFungible(ctx, itemId, discardCount, meta.entityId);
  ctx.emit({
    type: 'log',
    // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
    text: `Discarded ${def.name}${discardCount > 1 ? ' x' + discardCount : ''}.`,
    color: '#999',
    pid: meta.entityId,
  });
}

// Manual bag arrangement: the player dragged the stack at inventory index `from` onto
// bag CELL `to`. An empty cell parks the stack there (leaving a hole behind it, which is
// the point of fixed cells); an occupied one trades cells with its stack. The arrangement
// rides on each stack (InvSlot.slot) and is serialized with the character, so it
// persists. Authoritative like every other inventory command: moveStackToCell
// re-validates both ends against the live bag and refuses anything illegal.
export function moveInventoryItem(ctx: SimContext, from: number, to: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  moveStackToCell(meta.inventory, from, to, bagCapacity(meta.bags));
}

// `targetSlot` names the exact equipment key the player aimed at (the paperdoll
// drop target). It is a REQUEST, never a bypass: the sim re-validates it against
// the item's declared slot (slotAcceptsItem), so a hand-crafted packet cannot put
// a helm on a ring finger. Omitted (the click path), the slot resolves as before.
export function equipItem(
  ctx: SimContext,
  itemId: string,
  pid?: number,
  targetSlot?: EquipSlot,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const def = ITEMS[itemId];
  if (!def?.slot || (def.kind !== 'weapon' && def.kind !== 'armor')) return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) return;
  if (targetSlot && !slotAcceptsItem(def, targetSlot)) {
    ctx.error(meta.entityId, 'That does not go in that slot.');
    return;
  }
  if (!canEquipItem(meta.cls, def)) {
    ctx.error(meta.entityId, 'You cannot equip that.');
    return;
  }
  if (!meetsLevelRequirement(p.level, def)) {
    ctx.error(meta.entityId, `You must be level ${requiredLevelFor(def)} to equip that.`);
    return;
  }
  // Rings declare slot 'ring'; with no aimed slot the resolver picks ring1/ring2
  // (empty-first). An aimed slot is honored verbatim once validated above, so
  // dropping a ring on the ring2 socket fills ring2 even while ring1 is free.
  const slot = targetSlot ?? resolveEquipSlot(def, meta.equipment);
  if (!slot) return;
  const old = meta.equipment[slot];
  const oldInstance = meta.equipmentInstance?.[slot];
  // removeItem scans from the highest inventory index down (sim.ts), so a
  // freshly-enchanted copy (pushed onto the end by addItemInstance,
  // src/sim/professions/enchanting.ts applyEnchant) is what this picks up first
  // when both a plain and an enchanted copy of the same item exist and nothing
  // else has been looted since. That only holds while the enchanted copy stays
  // the highest-index match: loot another plain copy afterward and the plain
  // one gets equipped instead. Deterministic, acceptable for v1, but a future
  // picker UI should not assume the enchanted copy is always favored.
  const consumed = ctx.removeItem(itemId, 1, meta.entityId);
  if (old) {
    // Return the piece that was worn: if it carried an enchant, give it back
    // its own instanced slot (never merge it into a plain stack, which would
    // silently drop the enchant), same non-merge rule addItemInstance follows.
    if (oldInstance) meta.inventory.push({ itemId: old, count: 1, instance: oldInstance });
    else addItemSilent(old, 1, meta);
  }
  meta.equipment[slot] = itemId;
  if (consumed[0]) {
    meta.equipmentInstance ??= {};
    meta.equipmentInstance[slot] = consumed[0];
  } else if (meta.equipmentInstance) {
    delete meta.equipmentInstance[slot];
  }
  // The all-slots deed reads equipment, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  ctx.emit({ type: 'log', text: `Equipped ${def.name}.`, color: '#8f8', pid: meta.entityId });
}

// Remove the piece in `slot` back to the bags, leaving the slot empty. Unlike
// equipItem (which only swaps in a replacement) this is the way to fully
// unequip. Bags are capacity-capped, so the returned piece needs a free slot;
// with none the unequip is refused (nothing is ever force-dropped).
export function unequipItem(ctx: SimContext, slot: EquipSlot, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  const itemId = meta.equipment[slot];
  if (!itemId) return false;
  if (!ctx.canAddItem(itemId, 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return false;
  }
  const instance = meta.equipmentInstance?.[slot];
  delete meta.equipment[slot];
  if (meta.equipmentInstance) delete meta.equipmentInstance[slot];
  // The all-slots deed reads equipment, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
  // addItemSilent (not addItem): returning a piece you already owned to bags is
  // not a fresh acquisition, so it must not fire collect-quest credit. No quest
  // today keys on an unequip, so there is nothing to award here regardless. An
  // enchanted piece gets its own instanced slot instead, so its enchant survives.
  if (instance) meta.inventory.push({ itemId, count: 1, instance });
  else addItemSilent(itemId, 1, meta);
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  const def = ITEMS[itemId];
  ctx.emit({
    type: 'log',
    text: `Unequipped ${def?.name ?? itemId}.`,
    color: '#8f8',
    pid: meta.entityId,
  });
  return true;
}

export function useItem(ctx: SimContext, itemId: string, pid?: number): ItemUseResult | undefined {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const def = ITEMS[itemId];
  if (!def) return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  if (def.use?.type === 'fishing') {
    ctx.startFishing(p, meta);
    return;
  }
  if (def.use?.type === 'mechChroma') {
    return ctx.unlockMechChromaFromItem(meta, itemId, def.use.chromaId);
  }
  if (def.use?.type === 'skinSelect') {
    ctx.openSkinSelect(meta, def.use.catalog ?? 'class', itemId);
    return;
  }
  if (p.castingAbility === FISHING_CAST_ID) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (p.dead) return;
  if (def.kind === 'food' || def.kind === 'drink') {
    if (p.inCombat) {
      ctx.error(meta.entityId, "You can't do that while in combat.");
      return;
    }
    if (ctx.isSwimming(p)) {
      ctx.error(meta.entityId, "You can't do that while swimming.");
      return;
    }
    ctx.removeItem(itemId, 1, meta.entityId);
    p.sitting = true;
    // food and drink occupy separate slots, so you can do both at once
    const slot = def.kind === 'food' ? 'eating' : 'drinking';
    p[slot] = {
      itemId,
      kind: def.kind,
      hpPer2s: def.foodHp ? Math.round(def.foodHp / CONSUME_TICKS) : 0,
      manaPer2s: def.drinkMana ? Math.round(def.drinkMana / CONSUME_TICKS) : 0,
      remaining: CONSUME_DURATION,
    };
    ctx.emit({
      type: 'log',
      text: def.kind === 'food' ? 'You sit down to eat.' : 'You sit down to drink.',
      color: '#999',
      pid: meta.entityId,
    });
  } else if (def.kind === 'potion') {
    // instant, usable in combat, on a shared 2-minute cooldown (#103)
    if (ctx.time < p.potionCooldownUntil) {
      ctx.error(meta.entityId, 'That potion is not ready yet.');
      return;
    }
    const restoresMana =
      (def.potionMana ?? 0) > 0 && p.resourceType === 'mana' && p.resource < p.maxResource;
    const restoresHp = (def.potionHp ?? 0) > 0 && p.hp < p.maxHp;
    if (!restoresHp && !restoresMana) {
      ctx.error(
        meta.entityId,
        p.hp >= p.maxHp && (def.potionMana ?? 0) === 0
          ? 'You are already at full health.'
          : 'Nothing to restore.',
      );
      return;
    }
    // #1149 Battlefield Experience: credit the instance removeItem actually
    // consumed (PR #1281 review, High: a self-signed instance sitting
    // untouched at a different slot must never be credited for a plain copy
    // drunk instead; addItemInstance appends to the end of `inventory` while
    // removeItem consumes from the end backward, so an EARLIER signed slot
    // and a LATER plain stack of the same itemId can silently diverge). A
    // cheap gate inside battlefieldExperienceTrickle short-circuits
    // everything below rare tier, so this is a no-op for every plain/common/
    // uncommon potion, exactly as before this issue.
    const [drunkInstance] = ctx.removeItem(itemId, 1, meta.entityId);
    if (drunkInstance) {
      const granted = battlefieldExperienceTrickle(meta.craftSkills, {
        itemId,
        instance: drunkInstance,
        observerName: meta.name,
        observerActiveArchetype: meta.archetype.activeArchetype,
        observerPairedMajor: meta.archetype.pairedMajor,
      });
      // A nonzero trickle changed a craft skill (returns 0 on every
      // short-circuit), so the craft-skill deeds re-check this player.
      if (granted > 0) ctx.markDeedsDirty(meta.entityId);
    }
    p.potionCooldownUntil = ctx.time + POTION_COOLDOWN;
    p.potionCdRemaining = POTION_COOLDOWN; // materialized remaining for the action-bar swipe
    if (restoresHp) {
      const heal = Math.min(Math.round(def.potionHp! * ctx.healingTakenMult(p)), p.maxHp - p.hp);
      p.hp += heal;
      ctx.emit({ type: 'heal', targetId: p.id, amount: heal });
    }
    if (restoresMana) {
      p.resource = Math.min(p.maxResource, p.resource + def.potionMana!);
    }
    ctx.emit({ type: 'log', text: `You quaff ${def.name}.`, color: '#c9f', pid: meta.entityId });
  } else if (def.kind === 'elixir') {
    // Battle elixir: grant a temporary stat-buff aura. Usable in combat (classic),
    // no shared potion cooldown; re-quaffing refreshes the buff via applyAura.
    const elx = def.elixir;
    if (!elx) return;
    ctx.removeItem(itemId, 1, meta.entityId);
    ctx.applyAura(p, {
      id: `elixir_${itemId}`,
      name: elx.aura,
      kind: elx.kind,
      remaining: elx.duration,
      duration: elx.duration,
      value: elx.value,
      sourceId: p.id,
      school: 'nature',
    });
    ctx.emit({ type: 'log', text: `You quaff ${def.name}.`, color: '#c9f', pid: meta.entityId });
  } else if (def.kind === 'weapon' || def.kind === 'armor') {
    equipItem(ctx, itemId, meta.entityId);
  } else if (def.kind === 'bag') {
    equipBagCmd(ctx, itemId, undefined, meta.entityId);
  }
}

export function buyItem(ctx: SimContext, npcId: number, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const npc = ctx.entities.get(npcId);
  const def = ITEMS[itemId];
  if (npc?.kind !== 'npc' || npc.vendorItems.length === 0) {
    ctx.error(meta.entityId, 'That merchant is not available.');
    return;
  }
  if (!npc.vendorItems.includes(itemId)) {
    ctx.error(meta.entityId, 'That item is not sold here.');
    return;
  }
  const copperUnitPrice =
    def?.buyValue !== undefined && Number.isFinite(def.buyValue) && def.buyValue > 0
      ? def.buyValue
      : 0;
  const honorPrice =
    def?.priceHonor !== undefined && Number.isFinite(def.priceHonor) && def.priceHonor > 0
      ? Math.floor(def.priceHonor)
      : 0;
  const hasCopperPrice = copperUnitPrice > 0;
  const hasHonorPrice = honorPrice > 0;
  if (!def || (!hasCopperPrice && !hasHonorPrice)) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  // Dead players (released ghosts included) cannot buy, matching the rest of
  // the vendor family (sellItem / sellAllJunk / buyBackItem below).
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (dist2d(p.pos, npc.pos) > INTERACT_RANGE + 2) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  // Food and drink are handed over in a stack (vendorStackSize); the player pays
  // the per-unit buyValue for every unit, so the per-unit price stays classic and
  // vendor buy price stays above the per-unit sell value (no buy-low/sell-high loop).
  const qty = vendorStackSize(def);
  const copperCost = copperUnitPrice * qty;
  const honorCost = honorPrice;
  if (meta.copper < copperCost) {
    ctx.error(meta.entityId, 'Not enough money.');
    return;
  }
  if (meta.honor < honorCost) {
    ctx.error(meta.entityId, 'Not enough honor.');
    return;
  }
  if (!ctx.canAddItem(itemId, qty, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  meta.copper -= copperCost;
  meta.honor -= honorCost;
  ctx.addItem(itemId, qty, meta.entityId);
  ctx.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
}

function vendorInRange(ctx: SimContext, p: Entity): boolean {
  return [...ctx.entities.values()].some(
    (e) =>
      e.kind === 'npc' && e.vendorItems.length > 0 && dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2,
  );
}

function recordVendorBuyback(meta: PlayerMeta, itemId: string, count: number): void {
  const existingIndex = meta.vendorBuyback.findIndex((s) => s.itemId === itemId);
  if (existingIndex >= 0) {
    const [existing] = meta.vendorBuyback.splice(existingIndex, 1);
    existing.count += count;
    meta.vendorBuyback.unshift(existing);
  } else {
    meta.vendorBuyback.unshift({ itemId, count });
  }
  while (meta.vendorBuyback.length > VENDOR_BUYBACK_LIMIT) meta.vendorBuyback.pop();
}

export function sellItem(ctx: SimContext, itemId: string, count = 1, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const def = ITEMS[itemId];
  const available = ctx.countItem(itemId, meta.entityId);
  if (!def || available <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const sellCount = Number.isFinite(count) ? Math.min(Math.floor(count), available) : 0;
  if (sellCount <= 0) return;
  if (!vendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'There is no merchant nearby.');
    return;
  }
  if (def.noVendorSell || def.soulbound) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  if (def.kind === 'quest') {
    ctx.error(meta.entityId, 'You cannot sell quest items.');
    return;
  }
  removePreferFungible(ctx, itemId, sellCount, meta.entityId);
  recordVendorBuyback(meta, itemId, sellCount);
  const payout = def.sellValue * sellCount;
  meta.copper += payout;
  ctx.emit({ type: 'vendor', action: 'sell', itemId, pid: meta.entityId });
  ctx.emit({
    type: 'loot',
    // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
    text: `Sold ${def.name}${sellCount > 1 ? ' x' + sellCount : ''} for ${formatMoney(payout)}.`,
    pid: meta.entityId,
  });
}

// Bulk-sell every gray (poor-quality) item in the bags in one action, applying the
// same rules as the per-item sellItem path: quest items and noVendorSell items are
// left untouched and each sold stack is recorded for buyback. One summary loot line
// is emitted instead of one per stack.
export function sellAllJunk(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!vendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'There is no merchant nearby.');
    return;
  }
  const junk = meta.inventory
    .filter((s) => {
      const def = ITEMS[s.itemId];
      return (
        !!def &&
        def.quality === 'poor' &&
        def.kind !== 'quest' &&
        !def.noVendorSell &&
        !def.soulbound &&
        s.count > 0
      );
    })
    .map((s) => ({ itemId: s.itemId, count: s.count }));
  if (junk.length === 0) return; // nothing gray to sell; the vendor UI keeps the button disabled here
  let total = 0;
  let soldCount = 0;
  for (const { itemId, count } of junk) {
    const def = ITEMS[itemId]!;
    ctx.removeItem(itemId, count, meta.entityId);
    recordVendorBuyback(meta, itemId, count);
    total += def.sellValue * count;
    soldCount += count;
  }
  meta.copper += total;
  ctx.emit({ type: 'vendor', action: 'sell', pid: meta.entityId });
  ctx.emit({
    type: 'loot',
    text: `Sold ${soldCount} junk item${soldCount === 1 ? '' : 's'} for ${formatMoney(total)}.`,
    pid: meta.entityId,
  });
}

export function buyBackItem(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const def = ITEMS[itemId];
  const slot = meta.vendorBuyback.find((s) => s.itemId === itemId);
  if (!def || !slot || slot.count <= 0) {
    ctx.error(meta.entityId, 'That item is not available for buyback.');
    return;
  }
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!vendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'There is no merchant nearby.');
    return;
  }
  if (meta.copper < def.sellValue) {
    ctx.error(meta.entityId, 'Not enough money.');
    return;
  }
  if (!ctx.canAddItem(itemId, 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  meta.copper -= def.sellValue;
  slot.count -= 1;
  if (slot.count <= 0) meta.vendorBuyback = meta.vendorBuyback.filter((s) => s !== slot);
  addItemSilent(itemId, 1, meta);
  // The silent add bypasses the inventory hub, so credit the discovery
  // ledger here (an acquisition like any other; the mark is idempotent).
  ctx.markItemDiscovered(meta, itemId);
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({ type: 'vendor', action: 'buyback', itemId, pid: meta.entityId });
  ctx.emit({
    type: 'loot',
    text: `Bought back ${def.name} for ${formatMoney(def.sellValue)}.`,
    pid: meta.entityId,
  });
}

function addItemSilent(itemId: string, count: number, meta: PlayerMeta): void {
  addStacked(meta.inventory, itemId, count);
}
