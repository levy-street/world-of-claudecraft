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

import { addStacked, bagsFullError, equipBag as equipBagCmd } from './bags';
import { ITEMS } from './data';
import { recalcPlayerStats } from './entity';
import { canEquipItem } from './equipment_rules';
import { formatMoney } from './format_money';
import { meetsLevelRequirement, requiredLevelFor } from './item_level_req';
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
  POTION_COOLDOWN,
} from './types';
import { vendorStackSize } from './vendor_stack';

const VENDOR_BUYBACK_LIMIT = 12;

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
  ctx.removeItem(itemId, discardCount, meta.entityId);
  ctx.emit({
    type: 'log',
    // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
    text: `Discarded ${def.name}${discardCount > 1 ? ' x' + discardCount : ''}.`,
    color: '#999',
    pid: meta.entityId,
  });
}

export function equipItem(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const def = ITEMS[itemId];
  if (!def?.slot || (def.kind !== 'weapon' && def.kind !== 'armor')) return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) return;
  if (!canEquipItem(meta.cls, def)) {
    ctx.error(meta.entityId, 'You cannot equip that.');
    return;
  }
  if (!meetsLevelRequirement(p.level, def)) {
    ctx.error(meta.entityId, `You must be level ${requiredLevelFor(def)} to equip that.`);
    return;
  }
  const slot = def.slot;
  const old = meta.equipment[slot];
  ctx.removeItem(itemId, 1, meta.entityId);
  if (old) addItemSilent(old, 1, meta);
  meta.equipment[slot] = itemId;
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
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
  delete meta.equipment[slot];
  // addItemSilent (not addItem): returning a piece you already owned to bags is
  // not a fresh acquisition, so it must not fire collect-quest credit. No quest
  // today keys on an unequip, so there is nothing to award here regardless.
  addItemSilent(itemId, 1, meta);
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
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
    ctx.removeItem(itemId, 1, meta.entityId);
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
  if (!def?.buyValue) {
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
  const cost = def.buyValue * qty;
  if (meta.copper < cost) {
    ctx.error(meta.entityId, 'Not enough money.');
    return;
  }
  if (!ctx.canAddItem(itemId, qty, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  meta.copper -= cost;
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
  if (def.noVendorSell) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  if (def.kind === 'quest') {
    ctx.error(meta.entityId, 'You cannot sell quest items.');
    return;
  }
  ctx.removeItem(itemId, sellCount, meta.entityId);
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
        !!def && def.quality === 'poor' && def.kind !== 'quest' && !def.noVendorSell && s.count > 0
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
