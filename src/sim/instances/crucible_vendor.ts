// The Crucible Quartermaster: the sigil-redemption vendor for the Ignivar raid
// set pieces (src/sim/content/ignivar_loot.ts). Server-authoritative on the
// Heroic Quartermaster pattern (instances/heroic_vendor.ts): the client only
// sends intent, everything re-validates here. Two deliberate divergences from
// the marks shop: the price is ONE slot-and-group-matched sigil (an inventory
// item, debited from the buyer's bags), and the stock is class-gated, so a
// buyer only redeems pieces their class can wear (the per-spec choice moment
// the plan authored: one token serves three classes).
//
// `src/sim`-pure (no DOM/Three, no wall-clock, draws no rng).

import { bagsFullError } from '../bags';
import { CRUCIBLE_VENDOR_STOCK } from '../content/ignivar_loot';
import { ITEMS, NPCS } from '../data';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from '../types';

// Same reach as the marks shop: the buyer must be standing at a quartermaster.
// Flag-driven (NpcDef.crucibleVendor) rather than id-keyed, per the
// warfareVendor precedent, so a second placement needs no constant widened.
export function crucibleVendorInRange(ctx: SimContext, p: Entity): boolean {
  return [...ctx.entities.values()].some(
    (e) =>
      e.kind === 'npc' &&
      !!NPCS[e.templateId ?? '']?.crucibleVendor &&
      dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2,
  );
}

export function buyCrucibleVendorItem(ctx: SimContext, itemId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  const entry = CRUCIBLE_VENDOR_STOCK.find((s) => s.itemId === itemId);
  if (!entry) {
    ctx.error(meta.entityId, 'That item is not sold here.');
    return;
  }
  const def = ITEMS[itemId];
  const sigil = ITEMS[entry.sigilId];
  if (!def || !sigil) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!crucibleVendorInRange(ctx, p)) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  // Class gate: the shop only redeems pieces the buyer's class can wear, so a
  // sigil can never turn into a set piece for another class (the shared-group
  // sigil makes the cross-class conversion reachable without this). Below the
  // range check to match buyHeroicVendorItem's refusal ladder. The refusal
  // reuses the established equip-gate line (error.cannotEquip in sim_i18n.ts).
  if (def.requiredClass && !def.requiredClass.includes(meta.cls)) {
    ctx.error(meta.entityId, 'You cannot equip that.');
    return;
  }
  if (ctx.countItem(entry.sigilId, meta.entityId) < 1) {
    ctx.error(meta.entityId, `You need a ${sigil.name} to buy ${def.name}.`);
    return;
  }
  // Check space BEFORE the debit so a full-bags refusal never eats the sigil.
  if (!ctx.canAddItem(itemId, 1, meta.entityId)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  ctx.removeItem(entry.sigilId, 1, meta.entityId);
  ctx.addItem(itemId, 1, meta.entityId);
  // Feedback rides the 'vendor' event (the shop window re-renders), matching
  // buyHeroicVendorItem: no raw English log emitted from the sim.
  ctx.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
}
