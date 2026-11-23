// The Heroic Quartermaster: the marks-currency vendor for the heroic-dungeon
// jewelry (src/sim/content/heroic_vendor.ts). Server-authoritative like the
// delve shop (delves/runs.ts delveBuyShopItem): the client only sends intent,
// everything re-validates here. Like Delve Marks, Heroic Marks are a
// PlayerMeta counter (src/sim/heroic_marks.ts), so the price debits the
// buyer's balance, never their bags.
//
// `src/sim`-pure (no DOM/Three, no wall-clock, draws no rng).

import { bagsFullError } from '../bags';
import { HEROIC_VENDOR_NPC_ID, HEROIC_VENDOR_STOCK } from '../content/heroic_vendor';
import { ITEMS } from '../data';
import { spendHeroicMarks } from '../heroic_marks';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from '../types';

// Same reach as the copper-vendor family (items.ts vendorInRange): the buyer
// must be standing at the quartermaster NPC.
export function heroicVendorInRange(ctx: SimContext, p: Entity): boolean {
  return [...ctx.entities.values()].some(
    (e) =>
      e.kind === 'npc' &&
      e.templateId === HEROIC_VENDOR_NPC_ID &&
      dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2,
  );
}

export function buyHeroicVendorItem(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const entry = HEROIC_VENDOR_STOCK.find((s) => s.itemId === itemId);
  if (!entry) {
    ctx.error(meta.entityId, 'That item is not sold here.');
    return;
  }
  const def = ITEMS[itemId];
  if (!def) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!heroicVendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (meta.heroicMarks < entry.marks) {
    ctx.error(meta.entityId, `You need ${entry.marks} Heroic Marks to buy ${def.name}.`);
    return;
  }
  // Check space BEFORE the debit so a full-bags refusal never eats the marks.
  if (!ctx.canAddItem(itemId, 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId, itemId);
    return;
  }
  // The debit gates the grant, so no reordering above can ever hand out the item free.
  if (!spendHeroicMarks(meta, entry.marks)) return;
  ctx.addItem(itemId, 1, meta.entityId, { source: 'vendor' });
  // Feedback rides the 'vendor' event (the shop window re-renders), matching
  // buyItem and delveBuyShopItem: no raw English log emitted from the sim.
  ctx.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
}
