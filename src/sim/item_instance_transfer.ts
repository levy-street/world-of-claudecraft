// Instanced-transfer rules for the exchange pipes OUTSIDE the face-to-face
// trade: World Market listings and Ravenpost mail (the #1165 completion).
// The one per-copy lock rule is shared here so the two pipes can never
// drift: an ARMED copy (bindOnTrade, not yet stamped) or a bound copy
// (boundTo) never rides an anonymous pipe where no stamp can land (a
// bind-on-trade windfall is not resellable or mail-launderable). trade.ts
// keeps its own per-copy lock, isTradeLocked (boundTo only), so an armed
// copy may still trade in person, where the stamp lands on the recipient.
// trade.ts also carries a def-level exclusion of its own (RIFT_GEAR_ITEMS,
// the three riftbound_band_of_* personal rings); the pipes cover that same
// family through each pipe's def-level rules instead (every RIFT_GEAR_ITEM_IDS
// def carries noMarketList). Rift forge currency (rift_essence, rift_gem_*)
// is a SEPARATE family: not in RIFT_GEAR_ITEM_IDS and not noMarketList, so it
// stays tradeable through every pipe (see content/rift/items.ts).
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock
// (enforced by tests/architecture.test.ts). Pure bookkeeping, zero draws.

import { sanitizeItemInstancePayloadOnLoad } from './item_instance_load';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import { isMaterialItemId, materialItemIds } from './material_ids';
import { countMaterialInventoryForHub } from './material_inventory_hub';
import { applyMaterialInventoryTake, planMaterialInventoryTake } from './material_inventory_take';
import { materialInventoryUnits, materialSourceUnitPayload } from './material_inventory_units';
import { cloneMaterialPayload } from './material_payload_identity';
import {
  normalizeLoadedMaterialSlot,
  preservesMaterialCountOnLoad,
  validateMaterialSlotSourcesOnLoad,
} from './material_slot_load';
import type { MaterialComposition } from './material_sources';
import { normalizeMaterialStack } from './material_stack';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { isTransferLockedInstance } from './transfer_lock';
import {
  cloneItemInstancePayload,
  type InventoryUnit,
  type InvSlot,
  type ItemInstancePayload,
} from './types';

// The per-copy lock predicate lives in its own leaf (transfer_lock.ts, its
// docblock owns the rule) and is re-exported here so every pipe keeps its
// import; this module's Unlocked/Locked helper names refer to that TRANSFER
// lock only.
export { isTransferLockedInstance };

/** The public display projection of a payload, for wire surfaces other players
 *  see (market browse rows, letter attachment chips). The allowlist is the eqi
 *  wire's (server/game.ts identityFields): signer, enchant, rolled, name, and
 *  nothing else, so boundTo / bindOnTrade / charges are excluded BY
 *  CONSTRUCTION, as is any future non-cosmetic field. 2026-08-27: `name` (the
 *  player-chosen legendary name, Masterwrought phase 13) is the FIRST cosmetic
 *  field to JOIN the allowlist since the rule was written; the eqi cross-pin
 *  in tests/item_instance_transfer.test.ts holds the two sites in lockstep.
 *  Deep-copies the mutable rolled maps so a projection never aliases the live
 *  escrowed payload. */
export function publicInstanceView(instance: ItemInstancePayload): ItemInstancePayload {
  const pub: ItemInstancePayload = {};
  if (instance.signer !== undefined) pub.signer = instance.signer;
  if (instance.enchant !== undefined) pub.enchant = instance.enchant;
  if (instance.rolled !== undefined) {
    pub.rolled = {
      ...instance.rolled,
      ...(instance.rolled.stats && { stats: { ...instance.rolled.stats } }),
    };
  }
  if (instance.name !== undefined) pub.name = instance.name;
  return pub;
}

/** How many held units of `itemId` carry a payload structurally equal to
 *  `instance` AND are not transfer-locked. The escrow validation count: the
 *  client names a copy by its payload (never by index, so a bag reshuffle
 *  between staging and submit cannot redirect the escrow), and byte-equal
 *  copies are interchangeable by definition. */
export function countMatchingUnlocked(
  meta: PlayerMeta,
  itemId: string,
  instance: ItemInstancePayload,
): number {
  if (isMaterialItemId(itemId)) {
    return countMaterialInventoryForHub(
      meta.inventory ?? [],
      itemId,
      (payload) =>
        !isTransferLockedInstance(payload) && itemInstancePayloadsEqual(payload, instance),
    );
  }
  let n = 0;
  for (const s of meta.inventory ?? []) {
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance)) continue;
    if (itemInstancePayloadsEqual(s.instance, instance)) n += s.count;
  }
  return n;
}

/** True when the player holds at least one transfer-LOCKED copy whose payload
 *  equals `instance`: the caller distinguishes "that copy is bound" from "you
 *  do not have that copy" in its denial. */
export function holdsMatchingLocked(
  meta: PlayerMeta,
  itemId: string,
  instance: ItemInstancePayload,
): boolean {
  if (isMaterialItemId(itemId)) {
    return (meta.inventory ?? []).some((slot) => {
      if (slot.itemId !== itemId) return false;
      const read = normalizeMaterialStack(slot, materialItemIds());
      if (!read.ok) throw new Error('invalid material source state in escrow selection');
      return (read.value.materialSources ?? []).some(({ source }) => {
        const payload = materialSourceUnitPayload(read.value, source);
        return isTransferLockedInstance(payload) && itemInstancePayloadsEqual(payload, instance);
      });
    });
  }
  for (const s of meta.inventory ?? []) {
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance) && itemInstancePayloadsEqual(s.instance, instance))
      return true;
  }
  return false;
}

/** Escrow removal for one instanced unit: consumes the highest-index unlocked
 *  copy whose payload equals `instance` (removeItem's walk order) and returns
 *  the SLOT'S OWN payload plus its craftedRecipeId marker, never the caller's
 *  needle, so a wire-supplied selector can never mint state: what enters escrow
 *  is exactly what left the bags. Both channels, because a slot can carry both:
 *  a masterwork proc or an enchanted crafted piece is instanced AND crafted,
 *  and returning the payload alone dropped the marker at the escrow boundary.
 *  Clone-on-survival per removeItem's contract: the final unit of a
 *  fully-consumed slot returns the original object (its slot is gone), a
 *  surviving stack's payload is deep-cloned out. Returns null (and removes
 *  nothing) when no matching unlocked copy is held. Fires the same
 *  post-removal quest hook the inventory hub fires. */
export function removeMatchingInstance(
  ctx: SimContext,
  itemId: string,
  instance: ItemInstancePayload,
  pid?: number,
): InventoryUnit | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta } = r;
  // `?? []`: same decoupled-test-ctx contract as the two counters above.
  const inventory = meta.inventory ?? [];
  if (isMaterialItemId(itemId)) {
    const plan = planMaterialInventoryTake({
      inventory,
      itemId,
      count: 1,
      materialIds: materialItemIds(),
      eligibleSource: (source, slot) => {
        const payload = materialSourceUnitPayload(slot, source);
        return !isTransferLockedInstance(payload) && itemInstancePayloadsEqual(payload, instance);
      },
    });
    if (!plan.ok) {
      if (plan.error === 'insufficient') return null;
      throw new Error('invalid material source state in escrow selection');
    }
    const [unit] = materialInventoryUnits(plan.value);
    applyMaterialInventoryTake(inventory, plan.value);
    ctx.onInventoryChangedForQuests?.(meta);
    return unit;
  }
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || !s.instance) continue;
    if (isTransferLockedInstance(s.instance)) continue;
    if (!itemInstancePayloadsEqual(s.instance, instance)) continue;
    const consumed = s.count === 1 ? s.instance : cloneItemInstancePayload(s.instance);
    const craftedRecipeId = s.craftedRecipeId;
    s.count -= 1;
    if (s.count <= 0) inventory.splice(i, 1);
    ctx.onInventoryChangedForQuests?.(meta);
    return { instance: consumed, craftedRecipeId };
  }
  return null;
}

/** The ONE grant the exchange pipes share (market buy/cancel/collect, mail
 *  claim), payload-aware on both arms: an instanced copy routes through
 *  addItemInstance so its payload survives (merging only byte-equal), a plain
 *  count through addItem. The instanced arm always grants a DEEP CLONE:
 *  addItemInstance parks the caller's object in the first bag slot, and while
 *  every current source row is destroyed after the grant, a surviving source
 *  (a future instanced house listing, which never depletes) must never alias
 *  one payload object into every buyer's bags. Capacity is the caller's
 *  pre-check (bags.ts canGrantCopies, this function's twin).
 *
 *  `craftedRecipeId` (bags.ts InvSlot.craftedRecipeId, professions/crafting.ts)
 *  is the plain-stack provenance marker, ORTHOGONAL to `instance` rather than
 *  exclusive with it: a row can carry both, and the shapes that do are exactly
 *  the ones worth protecting (a masterwork proc, or a crafted piece enchanted
 *  while worn). It is threaded into BOTH arms, so a market/mail round trip
 *  never launders a crafted item's provenance and reopens the disenchant
 *  anti-farming gate (professions/enchanting.ts isCraftedDisenchantVictim).
 *  This read used to be "one or the other, never both", which silently dropped
 *  the marker from every instanced-AND-crafted row that rode these pipes. */
export function grantCopies(
  ctx: SimContext,
  pid: number,
  itemId: string,
  count: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
  materialSources?: MaterialComposition,
): void {
  // movement: every pipe that shares this grant hands over copies that already
  // existed in somebody's hands (a market purchase, a cancelled or collected
  // listing coming home, a mail attachment), so none of them is a world-sourced
  // acquisition for the Reliquary tally. Discovery still fires as it always has.
  if (instance)
    ctx.addItemInstance(itemId, cloneItemInstancePayload(instance), pid, count, {
      craftedRecipeId,
      movement: true,
      ...(materialSources === undefined ? {} : { materialSources }),
    });
  else
    ctx.addItem(itemId, count, pid, {
      craftedRecipeId,
      movement: true,
      ...(materialSources === undefined ? {} : { materialSources }),
    });
}

/** Rebuild a persisted exchange-escrow slot (market collection item, mail
 *  attachment): unknown ids stay dormant recoverable data, counts clamp to
 *  what identical-payload merges or an in-place whole-stack lock could
 *  legitimately have built (the character load's instancedCountCap rule), and
 *  payloads deep-clone so a loaded book never aliases the raw save object.
 *  `cap` is instancedCountCap(def, instance) from bags.ts, passed in so this
 *  module stays free of the ITEMS table. */
export function sanitizeEscrowSlot(raw: InvSlot, cap: number, dropped?: string[]): InvSlot {
  validateMaterialSlotSourcesOnLoad(raw);
  const count = preservesMaterialCountOnLoad(raw)
    ? raw.count
    : Math.min(Math.max(1, raw.count | 0), cap);
  const out: InvSlot = {
    itemId: raw.itemId,
    count,
    ...(raw.materialSources === undefined ? {} : { materialSources: raw.materialSources }),
  };
  if (raw.instance && typeof raw.instance === 'object') {
    const clone =
      raw.materialSources === undefined
        ? cloneItemInstancePayload(raw.instance)
        : cloneMaterialPayload(raw.instance);
    const { payload, dropped: drops } = sanitizeItemInstancePayloadOnLoad(clone);
    if (dropped) for (const d of drops) dropped.push(`${raw.itemId}.${d}`);
    if (payload) out.instance = payload;
  }
  return normalizeLoadedMaterialSlot(out);
}
