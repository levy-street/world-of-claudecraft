// The Materials Vault: the per-character material stockpile that stands beside
// the slot-based bank (bank.ts) at the same banker counter. Where the bank pools
// SLOTS over a list of item stacks, the vault gives every material id one
// shared count ceiling: rung 0 unlocks it for 2 gold and every further rung
// widens that ceiling by 40, so the ladder reads 40/80/120/160/200. Ordinary
// auto-craftable material remains pooled in a compact id-to-count map.
// Identity-bearing material lives beside it in a full InvSlot collection,
// preserving instance glyphs and crafted provenance without flattening. Both
// representations consume the same per-item headroom.
//
// Shape follows bank.ts exactly: free functions `fn(ctx, ...)` behind
// SimContext, backing state on PlayerMeta.vault (persisted INSIDE the character
// save, like inventory/bags/bank), thin same-named delegates on Sim, and ONE
// entry point per op, where the banker-proximity gate (nearBanker) lives. Item
// safety is the first law of this feature: every op conserves counts exactly,
// every refusal is a no-op (the whole outcome is decided before anything
// mutates), the load path never destroys stock, and the upgrade price is always
// this module's table lookup, never a client-supplied value.
//
// This module is the state, the capacity math, and the four command bodies.
// The vault UI landed in phase 03 (src/ui/vault_view.ts + vault_window.ts).
//
// The two-pool crafting mechanic (bags first, then vault) landed in phase 04.
// Its read/apply pair lives at the bottom of this file (drawableVaultCount /
// consumeVaultStock / craftVaultStockFor), the carried-first ORDER lives in
// professions/reagent_sources.ts, and the question of where a draw is allowed
// at all lives in vault_craft_gate.ts. Every op below is still banker-gated;
// the craft draw deliberately is not, which is exactly why it carries its own
// place gate.
//
// DELIBERATELY no onBankerBusinessForDeeds credit and no nearBankerTemplateId
// use, mirroring guild_bank.ts, the other second store at the same NPCs. The
// real reasoning, not just the precedent: the banker-business ledger marks
// (the Gilded Strongbox visit deed and the consecutive-Saul-talk streak reset)
// are credited by the banker INTERACT itself (interaction.ts), which is how
// the vault UI is reached, so crediting here would double-fire them for a
// player and invent credit for a raw wire command.
//
// Phase 04 CHANGED THE ARGUMENT AND NOT THE VERDICT, so read this rather than
// the old one-liner. It used to rest on "every vault op is nearBanker-gated,
// so no vault path bypasses the interact". That premise is now false: the
// craft-consumption path (drawableVaultCount / consumeVaultStock /
// craftVaultStockFor) is the ONE deliberate non-banker vault path, because
// spending stockpiled material is meant to work out in the world. The verdict
// survives on stronger ground. That path never touches the banker interact at
// all, so there is no mark to double-fire and nothing for it to credit; it is
// READ AND CONSUME ONLY, so it can neither add stock nor move any into the
// bags; and every op that DOES move items between the vault and the bags
// (deposit, deposit-all, withdraw, and the rung purchase) stays nearBanker
// -gated exactly as before. What replaces the proximity gate on the craft path
// is a PLACE gate of its own, vault_craft_gate.ts, which is about which
// contexts may draw at all rather than about standing at a counter.
//
// The material set arrives through material_ids.ts, the eager immutable
// registry shared with the two-pool bag capacity math and UI taxonomy.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). This module draws NO rng.

import type { VaultInfo, VaultSpecialRef } from '../world_api';

export type { VaultSpecialRef } from '../world_api';

import { addStacked, bagPools, bagsFullError, countFit, instancedCountCap } from './bags';
import { nearBanker } from './bank';
import { ITEMS } from './data';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
  warnDroppedInstanceKeys,
} from './item_instance_load';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import { materialItemIds } from './material_ids';
import { sanitizeRiftGearInstance } from './rift/progression';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type InvSlot, type ItemInstancePayload } from './types';
import { vaultDrawBlocked, vaultDrawStock } from './vault_craft_gate';

/** Per-material ceiling the first (unlocking) rung grants. */
export const VAULT_BASE_CAP = 40;
/** Extra per-material ceiling each rung past the unlock adds. */
export const VAULT_UPGRADE_STEP = 40;
/** Copper cost of each successive vault rung, cheapest first: index 0 is the
 *  2 gold UNLOCK, the rest widen the ceiling. The entry count is the purchase
 *  cap, so the ladder tops out at 200 per material. Data-as-code: the price is
 *  always this table lookup, never a client-supplied value, so it is inherently
 *  overflow-safe. These are the compiled sim defaults; the server-side override
 *  seam is a later phase. */
export const VAULT_UPGRADE_PRICES: readonly number[] = [20000, 50000, 100000, 200000, 400000];

/** GEOMETRY, not a price: the rung count client code may import (the client
 *  price-table guard bans VAULT_UPGRADE_PRICES itself from the client trees).
 *  The resolved override ladder is length-stable by construction, so this is
 *  the one true rung count under every price configuration. */
export const VAULT_UPGRADE_RUNGS = VAULT_UPGRADE_PRICES.length;

/** The persisted Materials Vault shape. `special` is additive and omitted
 *  while empty so every pre-identity save and every unchanged empty vault
 *  stays byte-identical. Runtime state always materializes it as an array. */
export interface SavedMaterialsVaultState {
  stock: Record<string, number>;
  special?: InvSlot[];
  upgrades: number;
}

/** A character's runtime Materials Vault. Ordinary fungible materials stay in
 *  the compact count map. A material whose slot carries an instance payload or
 *  crafted provenance stays in `special`, preserving every per-copy visual and
 *  rule-bearing field. The two stores share one per-item capacity ceiling. */
export interface MaterialsVaultState extends SavedMaterialsVaultState {
  special: InvSlot[];
}

/** Sim delegate/server-host argument tuple. Keeping the overload fold here
 *  lets the monolithic Sim remain a two-line forwarding seam. */
export type VaultWithdrawArgs = [
  itemId: string,
  count?: number,
  specialOrPid?: VaultSpecialRef | number,
  pid?: number,
];

/** Persistence boundary: deep-clone every special payload, strip its advisory
 *  carried-bag cell, and preserve pre-feature byte shape while the list is empty. */
export function savedVaultState(state: MaterialsVaultState): SavedMaterialsVaultState {
  return {
    stock: { ...state.stock },
    ...(state.special.length > 0
      ? {
          special: state.special.map((slot) => {
            const clone = cloneInvSlot(slot);
            delete clone.slot;
            return clone;
          }),
        }
      : {}),
    upgrades: state.upgrades,
  };
}

/** True when a carried slot must retain its full identity in the vault. */
export function isVaultSpecialSlot(slot: Pick<InvSlot, 'instance' | 'craftedRecipeId'>): boolean {
  return slot.instance !== undefined || slot.craftedRecipeId !== undefined;
}

function safeStoredCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

/** Total stored units for one id across the compact and identity-preserving
 *  stores. Capacity is shared, so every deposit decision uses this answer. */
export function vaultStoredCount(state: MaterialsVaultState, itemId: string): number {
  let total = Object.hasOwn(state.stock, itemId) ? safeStoredCount(state.stock[itemId]) : 0;
  for (const slot of state.special) {
    if (slot.itemId === itemId) total += safeStoredCount(slot.count);
  }
  return Math.min(Number.MAX_SAFE_INTEGER, total);
}

function specialRefMatches(slot: InvSlot, itemId: string, ref: VaultSpecialRef): boolean {
  return (
    slot.itemId === itemId &&
    itemInstancePayloadsEqual(slot.instance, ref.instance) &&
    slot.craftedRecipeId === ref.craftedRecipeId
  );
}

/** Resolve an exact special-row selector. The advertised index is tried first;
 *  when it has gone stale, only a complete fingerprint match may recover it.
 *  There is deliberately no item-id-only fallback. */
export function resolveVaultSpecialIndex(
  special: readonly InvSlot[],
  itemId: string,
  ref: VaultSpecialRef,
): number {
  if (!Number.isSafeInteger(ref.index) || ref.index < 0) return -1;
  const indexed = special[ref.index];
  if (indexed && specialRefMatches(indexed, itemId, ref)) return ref.index;
  return special.findIndex((slot) => specialRefMatches(slot, itemId, ref));
}

/** How many of ONE material the vault can hold: nothing while locked, then
 *  40/80/120/160/200 as the rungs are bought. */
export function vaultCapacityPerMaterial<T extends { upgrades: number }>(state: T): number {
  if (state.upgrades <= 0) return 0;
  return VAULT_BASE_CAP + VAULT_UPGRADE_STEP * (state.upgrades - 1);
}

/** Every item id the vault accepts: the SAME honest material set the bags/bank
 *  chip and the deposit-all sweep show the player, derived from the one shared
 *  rule set rather than approximated by kind (kind 'junk' over-includes the
 *  vendor trash and the trophies the taxonomy settlement deliberately excluded).
 *  This export stays as the vault's public surface over the canonical view. */
export function vaultMaterialIds(): ReadonlySet<string> {
  return materialItemIds();
}

function bumpVaultWireRev(meta: Pick<PlayerMeta, 'vaultWireRev'>): void {
  meta.vaultWireRev++;
}

/** Deposit a carried material into the vault. Ordinary fungible stacks join
 *  `stock`; identity-bearing stacks join `special` with their payload and
 *  provenance intact. Recipe-only stacks may partially fill the remaining
 *  headroom. An instanced stack moves whole or not at all, matching the bank's
 *  per-copy transfer rule. */
export function vaultDeposit(
  ctx: SimContext,
  slotIndex: number,
  count?: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= meta.inventory.length) return;
  const slot = meta.inventory[slotIndex];
  if (!vaultMaterialIds().has(slot.itemId)) {
    ctx.error(meta.entityId, 'Only materials can be stored in the Materials Vault.');
    return;
  }
  // moveBetweenContainers' count normalization: undefined takes the whole stack,
  // and an out-of-range count is malformed input (cheat/desync), refused
  // silently BEFORE the emitting gates below. The bank precedent covers the
  // headroom half (moveBetweenContainers validates the count ahead of the fit
  // check); running it ahead of the locked gate too is this module's own rule
  // (a bank is never locked), so a malformed count never leaks the locked line.
  // (The material refusal above still emits for a malformed count: that line
  // is about the slot's taxonomy, not the count.)
  //
  // The stored count itself gets the shared count-sanity rule
  // (isVaultDepositableSlot's arm), applied FIRST and silently: the want
  // validations below cannot catch a corrupt stored count. The whole-stack arm
  // adopts it verbatim (want = slot.count), and against NaN the explicit-count
  // range check is a false comparison (want > NaN), so a NaN stack would take
  // deposits forever while its count never drops; a past-precision stack
  // (1e21, Infinity) turns the decrement into a float no-op that MINTS items;
  // and a FRACTIONAL stack (2.5) deposits whole only for the sanitizer to
  // floor the stock one relog later (the delayed destruction the wire-count
  // floor already refuses on the explicit-count path).
  if (!Number.isInteger(slot.count) || slot.count <= 0 || slot.count > Number.MAX_SAFE_INTEGER)
    return;
  const want = count === undefined ? slot.count : Math.floor(count);
  if (!(want > 0) || want > slot.count) return;
  const special = isVaultSpecialSlot(slot);
  // One instance payload describes the whole counted stack. Splitting it would
  // manufacture two independently mutable copies of that identity, so only the
  // exact whole-stack request is valid. Recipe-only provenance is immutable and
  // remains safely splittable.
  if (slot.instance !== undefined && want !== slot.count) return;
  const vault = meta.vault;
  if (vault.upgrades <= 0) {
    ctx.error(meta.entityId, 'You have not unlocked the Materials Vault.');
    return;
  }
  // hasOwn, not a plain index: the id passed the material set, whose members are
  // proven disjoint from every inherited Object.prototype name (the set-scan pin
  // in tests/materials_vault.test.ts), but the guard keeps the read's safety
  // local instead of resting on that content proof from another file.
  const held = vaultStoredCount(vault, slot.itemId);
  // An over-capacity stock (tolerated by the load path, never truncated) simply
  // has no headroom, so it blocks new deposits instead of losing anything.
  const headroom = Math.max(0, vaultCapacityPerMaterial(vault) - held);
  if (headroom <= 0) {
    ctx.error(meta.entityId, 'Your vault cannot hold any more of that material.');
    return;
  }
  if (slot.instance !== undefined && headroom < want) {
    ctx.error(meta.entityId, 'Your vault cannot hold any more of that material.');
    return;
  }
  const moved = Math.min(want, headroom);
  // Atomic: the outcome above is fully decided, so the take and the grant commit
  // together and the item count is conserved exactly.
  if (moved >= slot.count) meta.inventory.splice(slotIndex, 1);
  else slot.count -= moved;
  if (special) {
    // addStacked owns compatible-payload merging and deep-clones every fresh
    // instance, so the vault never aliases the removed carried row.
    addStacked(vault.special, slot.itemId, moved, slot.instance, slot.craftedRecipeId);
  } else {
    const pooled = Object.hasOwn(vault.stock, slot.itemId) ? vault.stock[slot.itemId] : 0;
    // A plain assignment is safe here (unlike the load path's fromEntries): the
    // id passed the content-derived material set, which contains no '__proto__'.
    vault.stock[slot.itemId] = pooled + moved;
  }
  bumpVaultWireRev(meta);
  ctx.onInventoryChangedForQuests(meta);
}

/** The ONE eligibility predicate the deposit-all sweep and its UI replay
 *  share (src/ui/vault_view.ts predictVaultDepositAll / hasVaultDepositable):
 *  an honest material with a count the vault's arithmetic can move exactly: a positive INTEGER
 *  inside float precision. The count arm is the covenant guard: the carried
 *  inventory's load path applies NO bound at all to a plain slot's count
 *  (sim.ts addPlayer clamps only instanced slots; instancedCountCap returns
 *  Infinity for the rest), so a corrupt save can carry zero, negative, NaN,
 *  Infinity, a fraction, or a past-precision 1e21 here. Math.min against a
 *  degenerate count would DESTROY stock; a past-precision count is worse, a
 *  MINT (the headroom's worth lands in the vault while the decrement is a
 *  float no-op and the corrupt stack never drops, the exact dupe class
 *  sanitizeVaultState's MAX_SAFE_INTEGER clamp closes on the withdraw side);
 *  and a FRACTION is a delayed destruction (2.5 deposits whole, then the
 *  load-path sanitizer floors the stock to 2 one relog later: the same
 *  covenant sin the wire-count floor already refuses on the explicit-count
 *  path). Integerhood also rejects NaN and Infinity outright.
 *  One exported source so the player-facing summary can never silently
 *  desynchronize from the authoritative outcome; the targeted vaultDeposit
 *  keeps its own emitting material arm and applies this count-sanity rule
 *  silently in its own body. */
export function isVaultDepositableSlot(
  slot: Pick<InvSlot, 'itemId' | 'count' | 'instance' | 'craftedRecipeId'>,
  materialIds: ReadonlySet<string>,
): boolean {
  return (
    materialIds.has(slot.itemId) &&
    Number.isInteger(slot.count) &&
    slot.count > 0 &&
    slot.count <= Number.MAX_SAFE_INTEGER
  );
}

/** Deposit EVERY depositable carried material in one command: the server-side
 *  batched sweep (Bank Storage Phase 03). One command, not a client-side loop
 *  of vaultDeposit sends: at the phase 05 catalog's ceiling of 112 carried
 *  slots (the 16-slot backpack plus four 24-slot materials satchels; carried
 *  general tops out lower, at 80, but a sweep walks MATERIAL slots, so the
 *  total is what bounds it) a send-per-slot replay exceeds the command lane
 *  burst and silently drops the tail, and per-send ledger observation
 *  multiplies writes against the append-only bank_ledger; the ruling is
 *  recorded in the packet's state.md Phase 03 constraints.
 *
 *  Per-slot rules are vaultDeposit's. The sweep and the UI replay route the
 *  eligibility dimensions through the ONE shared predicate
 *  (isVaultDepositableSlot): only vaultMaterialIds() members and a corrupt-save
 *  count outside (0, MAX_SAFE_INTEGER] is skipped. Identity-bearing rows are
 *  admitted into the special collection without flattening. The targeted op
 *  does NOT call the predicate: it keeps its own emitting material arm and
 *  applies the same count-sanity rule silently in its own body, so the two bodies
 *  agree rule for rule (the differential test in
 *  tests/materials_vault.test.ts pins that equivalence). Each material fills
 *  only up to its remaining headroom (the vault's own partial-fill rule). The
 *  sweep SKIPS silently where the targeted op refuses aloud: a sweep is an
 *  offer over the whole inventory, not a claim about one slot, so per-slot
 *  chatter would spam a refusal per ineligible stack; the UI summarizes the
 *  outcome from its own click-time replay (src/ui/vault_view.ts). The dead
 *  and too-far and locked gates keep the targeted ops' exact behavior.
 *
 *  Iteration is DESCENDING by index: a whole-stack move splices the slot out,
 *  which only shifts indices ABOVE the one removed, all already visited. Each
 *  per-slot move is the same decided-before-mutating commit vaultDeposit
 *  makes, so the sweep conserves counts exactly and a mid-list ineligible
 *  slot leaves everything else untouched. Draws NO rng, emits NO success
 *  text; ONE quest-inventory recompute at the end covers every moved stack. */
export function vaultDepositAll(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  const vault = meta.vault;
  if (vault.upgrades <= 0) {
    ctx.error(meta.entityId, 'You have not unlocked the Materials Vault.');
    return;
  }
  const cap = vaultCapacityPerMaterial(vault);
  const materials = vaultMaterialIds();
  let movedAny = false;
  for (let i = meta.inventory.length - 1; i >= 0; i--) {
    const slot = meta.inventory[i];
    if (!isVaultDepositableSlot(slot, materials)) continue;
    // hasOwn, not a plain index: vaultDeposit's own guard, for the same reason.
    const held = vaultStoredCount(vault, slot.itemId);
    // An over-capacity stock (tolerated by the load path) has no headroom, so
    // it blocks new deposits instead of losing anything.
    const headroom = Math.max(0, cap - held);
    if (headroom <= 0) continue;
    const special = isVaultSpecialSlot(slot);
    // An instanced row cannot be split across two containers. If the whole
    // stack does not fit, leave it carried and continue the sweep.
    if (slot.instance !== undefined && headroom < slot.count) continue;
    const moved = Math.min(slot.count, headroom);
    // Atomic per slot: the outcome above is fully decided, so the take and the
    // grant commit together and the item count is conserved exactly.
    if (moved >= slot.count) meta.inventory.splice(i, 1);
    else slot.count -= moved;
    if (special) {
      addStacked(vault.special, slot.itemId, moved, slot.instance, slot.craftedRecipeId);
    } else {
      const pooled = Object.hasOwn(vault.stock, slot.itemId) ? vault.stock[slot.itemId] : 0;
      // A plain assignment is safe here (unlike the load path's fromEntries): the
      // id passed the content-derived material set, which contains no '__proto__'.
      vault.stock[slot.itemId] = pooled + moved;
    }
    movedAny = true;
  }
  if (movedAny) {
    bumpVaultWireRev(meta);
    ctx.onInventoryChangedForQuests(meta);
  }
}

/** Withdraw a material back into the carried inventory, gated by bag capacity.
 *  Deliberately NOT gated on the unlock rung or on the material set: a tolerated
 *  save (stock held while locked, or an id the taxonomy no longer calls a
 *  material) must always be recoverable, so nothing the vault holds can ever be
 *  trapped there. A counted fungible returning to the bags must re-credit any
 *  collect quest, so success pokes the quest-inventory recompute. */
export function vaultWithdraw(
  ctx: SimContext,
  itemId: string,
  count?: number,
  specialOrPid?: VaultSpecialRef | number,
  pid?: number,
): void {
  const specialRef = typeof specialOrPid === 'number' ? undefined : specialOrPid;
  const resolvedPid = typeof specialOrPid === 'number' ? specialOrPid : pid;
  const r = ctx.resolve(resolvedPid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (typeof itemId !== 'string' || itemId === '') return;
  const vault = meta.vault;
  // Both payout representations return to the same carried two-pool budget.
  // Bind it once so the special and compact branches cannot drift onto
  // different capacity models.
  const carriedPools = bagPools(meta.bags);
  if (specialRef !== undefined) {
    const index = resolveVaultSpecialIndex(vault.special, itemId, specialRef);
    if (index < 0) return;
    const slot = vault.special[index];
    const held = safeStoredCount(slot.count);
    if (held <= 0) return;
    const requested = count === undefined ? held : Math.floor(count);
    if (!(requested > 0)) return;
    const want = Math.min(requested, held);
    // An instance payload is one identity for the whole stack. Never split it
    // into two independently mutable rows; recipe-only provenance is immutable
    // and may withdraw partially.
    if (slot.instance !== undefined && want !== held) return;
    const moved = countFit(
      meta.inventory,
      carriedPools,
      itemId,
      want,
      slot.instance,
      slot.craftedRecipeId,
    );
    if (moved <= 0 || (slot.instance !== undefined && moved !== want)) {
      bagsFullError(ctx, meta.entityId);
      return;
    }
    if (moved >= held) vault.special.splice(index, 1);
    else slot.count = held - moved;
    addStacked(meta.inventory, itemId, moved, slot.instance, slot.craftedRecipeId);
    bumpVaultWireRev(meta);
    ctx.onInventoryChangedForQuests(meta);
    return;
  }
  // hasOwn, not a plain index: withdraw is un-gated on the material set, so a
  // prototype-named itemId ('constructor', 'toString') would otherwise read an
  // inherited function here. The NaN gate below happens to refuse those too, but
  // the guard makes the refusal local instead of a coincidence, the same call
  // deeds.ts markItemDiscovered makes for its hostile-key reads. (The read-only
  // boolean arm in quests/quest_item_presence.ts deliberately keeps the plain
  // index and documents why; a WRITE path a few lines from the read holds itself
  // to the stricter form.) A dormant OWN '__proto__' row still passes: hasOwn
  // sees own data keys, so tolerated corrupt stock stays recoverable.
  const held = Object.hasOwn(vault.stock, itemId) ? vault.stock[itemId] : 0;
  // Nothing stocked under that id: malformed or stale input (cheat/desync), the
  // bank's silent-refusal idiom, no player line.
  if (!(held > 0)) return;
  const want = count === undefined ? held : Math.min(Math.floor(count), held);
  if (!(want > 0)) return;
  // countFit models the bags exactly the way addStacked below fills them (#2139:
  // a capacity pre-check that models the grant differently re-opens the overflow
  // class) and already caps its answer at the requested count.
  const moved = countFit(meta.inventory, carriedPools, itemId, want);
  if (moved <= 0) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  // Atomic, like the deposit: the take and the grant commit together.
  if (moved >= held) delete vault.stock[itemId];
  else vault.stock[itemId] = held - moved;
  addStacked(meta.inventory, itemId, moved);
  bumpVaultWireRev(meta);
  ctx.onInventoryChangedForQuests(meta);
}

/** How many units of `itemId` a vault stock record can actually pay out: the
 *  own-row count when it is a positive integer inside float precision, else 0.
 *
 *  The read half of the two-pool crafting mechanic, and the ONE place the
 *  drawable rule lives. The bound is `vaultWithdraw`'s covenant restated for a
 *  path with no player at a banker to see a refusal: sanitizeVaultState floors
 *  and clamps what it loads, but a hand-edited or future-shaped save can still
 *  present zero, a negative, NaN, Infinity, a fraction, or a past-precision
 *  1e21 here. A craft that planned against any of those would either destroy
 *  stock (a Math.min against a degenerate count) or MINT items (the decrement
 *  against a past-precision count is a float no-op while the grant is real).
 *
 *  So a CORRUPT ROW STAYS DORMANT: never counted, never spent, never deleted.
 *  It keeps sitting in the vault, visible and recoverable through
 *  `vaultWithdraw` exactly as it is today, which is the never-destroy half of
 *  the same covenant.
 *
 *  No nearBanker gate and no dead gate, like its two siblings below: a pure
 *  read primitive, gated where it matters by `vaultDrawBlocked` and by the
 *  craft/enchant commands' own while-dead refusal.
 *
 *  hasOwn, not a plain index: this read is un-gated on the material set (a
 *  reagent id is whatever content declares), so a prototype-named itemId
 *  ('constructor', 'toString') would otherwise read an inherited function
 *  here. Same call `vaultWithdraw` makes, for the same reason. A dormant OWN
 *  '__proto__' row still passes the guard and is then judged on its count like
 *  any other row. */
export function drawableVaultCount(
  stock: Readonly<Record<string, number>> | undefined,
  itemId: string,
): number {
  if (!stock || !Object.hasOwn(stock, itemId)) return 0;
  const held = stock[itemId];
  if (!Number.isInteger(held) || held <= 0 || held > Number.MAX_SAFE_INTEGER) return 0;
  return held;
}

/** The null-or-counter adapter every vault-tier planner consumes: a nullable
 *  stock record becomes a nullable per-id counting callback (the
 *  planReagentSourceDraw vaultCount shape), preserving null so a blocked
 *  location keeps the byte-identical carried-only path. ONE implementation on
 *  the rule of three: the craft planner, the enchant planner, and the
 *  crafting-window projection all consume it, and drawableVaultCount
 *  re-applies the drawable rule per read either way. */
export function drawableCounterFor(
  stock: Readonly<Record<string, number>> | null,
): ((itemId: string) => number) | null {
  return stock === null ? null : (itemId: string) => drawableVaultCount(stock, itemId);
}

/** Apply a PLANNED vault draw: spend exactly `count` units of `itemId`.
 *
 *  Returns false and mutates NOTHING unless the draw is one the row can pay in
 *  full: a positive integer no larger than `drawableVaultCount`. Partial
 *  spends do not exist here, because the caller already decided the whole
 *  reagent line against the same drawable read (professions/reagent_sources.ts
 *  plans, this applies); a half-spent line would be the partial-consumption
 *  defect the craft path denies precisely to avoid.
 *
 *  Reaching zero DELETES the key rather than writing a 0 row. The load path
 *  skips rows that coerce to zero, so a 0 row would vanish on the next relog
 *  anyway, and nothing may depend on that: the vault's own withdraw already
 *  deletes at zero, so the in-memory shape and the reloaded shape stay
 *  identical. The keyed write on the surviving-row branch is safe for the same
 *  reason vaultWithdraw's is: a drawable count proves an OWN data row exists
 *  under that id, so assignment writes that row rather than reaching the
 *  inherited '__proto__' setter.
 *
 *  UNGATED ON PURPOSE, in three separate ways, none of them an omission. No
 *  RUNG gate, mirroring `vaultWithdraw`: a tolerated save can hold stock while
 *  locked, and material the vault holds must always be spendable rather than
 *  trapped. No NEARBANKER gate, breaking this module's "one entry point per
 *  op, where the banker-proximity gate lives" rule on purpose, because
 *  spending stockpiled material is meant to work out in the world; the gate
 *  that replaces it is vault_craft_gate.ts, about WHICH CONTEXT the player is
 *  in rather than which counter they are standing at (see the header). No DEAD
 *  gate either: this is a primitive, not a command, and the craft and enchant
 *  paths that call it are already behind `dead_gate.ts refusedWhileDead` on
 *  the Sim wrappers, so re-checking here would duplicate a refusal that has
 *  already been made and emitted. */
export function consumeVaultStock(
  vault: MaterialsVaultState,
  itemId: string,
  count: number,
): boolean {
  const held = drawableVaultCount(vault.stock, itemId);
  if (!Number.isInteger(count) || count <= 0 || count > held) return false;
  // Byte-for-byte `vaultWithdraw`'s write shape (delete at zero, else
  // decrement), and that is a requirement rather than a coincidence: it is the
  // only other path that removes a row, and the audit's diffVaultOp reads
  // delete-at-zero as "the row is gone" rather than "the row holds nothing".
  // The keyed write needs no hasOwn guard of its own for the reason the
  // deposit side cannot use: deposits are justified by material-set
  // membership, while this writes ONLY to a key that already exists, since a
  // drawable count above zero proves an own data row under that id. So even a
  // dormant '__proto__' row is decremented as data rather than reaching the
  // inherited setter.
  if (count >= held) delete vault.stock[itemId];
  else vault.stock[itemId] = held - count;
  return true;
}

/** Apply a planned draw to a LIVE player vault and advance its wire revision
 *  immediately after the decrement. Scratch batch simulation keeps calling
 *  consumeVaultStock directly, so planning remains side-effect free. */
export function consumePlayerVaultStock(meta: PlayerMeta, itemId: string, count: number): boolean {
  if (!consumeVaultStock(meta.vault, itemId, count)) return false;
  bumpVaultWireRev(meta);
  return true;
}

/** Emit the personal `vaultCraftConsume` event for a completed craft or
 *  enchant that drew reagent units from the vault, AFTER the decrement.
 *
 *  The event is the LEDGER RECORD for a tick-driven consumption: the craft
 *  resolves inside sim.tick(), several ticks after its command dispatch, so
 *  the server has no before/after bracket to diff. The old server observer
 *  was retired for the reservation journal (the rows are written through the
 *  pre-reserved consumption admission now), and the server DROPS this event
 *  from the client relay (server/game.ts routeEvents: no client consumer
 *  exists). The EMIT stays regardless: it is the conservation sweep's
 *  expectation source (tests/audit_conservation_vault.test.ts derives what
 *  must have left the vault from exactly these events). Offline and headless
 *  hosts emit it too and simply have no observer; it is text-free, so no
 *  i18n matcher rule applies.
 *
 *  Takes are AGGREGATED per material id and emitted in sorted id order (the
 *  diffVaultOp row discipline: row order is a function of the ids alone,
 *  never of plan or object-key iteration order), and the rung rides along
 *  because the ledger's purchased_slots_after column is NOT NULL and the
 *  observer must not re-read state the tick may have moved on from. */
export function emitVaultCraftConsume(
  ctx: SimContext,
  meta: PlayerMeta,
  draws: readonly { itemId: string; count: number }[],
): void {
  if (draws.length === 0) return;
  const totals = new Map<string, number>();
  for (const take of draws) totals.set(take.itemId, (totals.get(take.itemId) ?? 0) + take.count);
  const takes = [...totals.keys()]
    .sort()
    .map((itemId) => ({ itemId, count: totals.get(itemId) ?? 0 }));
  ctx.emit({ type: 'vaultCraftConsume', pid: meta.entityId, takes, upgrades: meta.vault.upgrades });
}

/** The vault stock a craft may draw from for `pid`, as a FRESH boundary clone
 *  holding only the drawable rows: null when the player is unresolvable, holds
 *  no vault, or stands somewhere vault draw is refused (vault_craft_gate.ts).
 *
 *  This is the read for consumers that must not touch the live record: the
 *  Create All batch simulation spends it as a throwaway scratch vault, and the
 *  IWorld member the crafting window's availability projection reads is built
 *  on it. It is THE boundary shape: `vaultDrawStock` (vault_craft_gate.ts)
 *  hands back the live record and is sim-internal, so anything crossing the
 *  IWorld seam comes through here instead.
 *
 *  Carries no nearBanker gate and no dead gate, deliberately and for the same
 *  reasons `consumeVaultStock` carries neither: it is a read primitive rather
 *  than one of this module's commands, the place gate that does apply is
 *  `vaultDrawBlocked`, and the craft and enchant callers sit behind the
 *  while-dead refusal already.
 *
 *  Built through a NULL-PROTOTYPE accumulator and `Object.fromEntries`, never
 *  keyed assignment onto a `{}` literal. The source record can carry a dormant
 *  own '__proto__' row (sanitizeVaultState defines one rather than dropping
 *  it, so tolerated corrupt stock stays recoverable), and copying that row with
 *  `clone[id] = n` onto a plain object would reach the inherited prototype
 *  setter instead of defining a row: the count would silently disappear from
 *  the clone, and on a hostile value it would re-parent the clone itself.
 *  fromEntries DEFINES each key, so the row survives the copy as inert data
 *  and is then judged drawable (or not) on its count like any other.
 *
 *  The Object.keys walk below IS object-key iteration order, and that is safe
 *  here precisely because the result is a keyed RECORD: consumers look rows up
 *  by id, nothing walks the clone, and no decision depends on the order the
 *  rows were copied in. The one place order decides anything is the removal
 *  walk, and that takes its order from an explicit id list
 *  (professions/material_grades.ts materialGradeIds), never from a record. */
export function craftVaultStockFor(ctx: SimContext, pid: number): Record<string, number> | null {
  const stock = vaultDrawStock(ctx, pid);
  if (!stock) return null;
  const rows: [string, number][] = [];
  for (const itemId of Object.keys(stock)) {
    const drawable = drawableVaultCount(stock, itemId);
    if (drawable > 0) rows.push([itemId, drawable]);
  }
  return Object.fromEntries(rows);
}

/** Gate-only probe for the cvault wire signature: the GATE HALF of the
 *  predicate craftVaultStockFor answers null through (blocked implies null;
 *  the meta-less `?? null` arm above is the defensive other half), without
 *  paying its projection clone. The server probes this every snapshot beside
 *  vaultWireRevFor, so the pair (rev, blocked) fully determines whether the
 *  projection could have changed (every stock mutation bumps the rev; the
 *  gate is a pure function of position and membership). */
export function craftVaultDrawBlockedFor(ctx: SimContext, pid: number): boolean {
  return vaultDrawBlocked(ctx, pid);
}

/** Buy the next vault rung for exact copper, non-refundable: rung 0 unlocks the
 *  vault, the rest widen every material's ceiling. Blocked at the purchase cap
 *  (the resolved table's length, equal to VAULT_UPGRADE_PRICES.length by
 *  construction) and when the player cannot afford the table price; neither
 *  refusal mutates anything. */
export function vaultBuyUpgrade(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  const vault = meta.vault;
  // The boot-resolved table (defaults to VAULT_UPGRADE_PRICES), never client-supplied.
  if (vault.upgrades >= ctx.storagePrices.vaultUpgrades.length) {
    ctx.error(meta.entityId, 'Your vault cannot be upgraded further.');
    return;
  }
  const price = ctx.storagePrices.vaultUpgrades[vault.upgrades];
  if (meta.copper < price) {
    ctx.error(meta.entityId, 'You cannot afford that vault upgrade.');
    return;
  }
  const unlocking = vault.upgrades === 0;
  meta.copper -= price;
  vault.upgrades += 1;
  bumpVaultWireRev(meta);
  // Two emit sites rather than one with a ternary, so each line stays a literal
  // the client matcher and the S3 drift guard can both see.
  if (unlocking) ctx.notice(meta.entityId, 'You unlock the Materials Vault.');
  else ctx.notice(meta.entityId, 'You upgrade the Materials Vault.');
  // A purchase changes persisted trigger inputs, so re-check this player's
  // deeds, the same beat bankBuySlots ends on.
  ctx.markDeedsDirty(meta.entityId);
}

/** The proximity-gated vault snapshot the IWorld seam exposes (the bankInfoFor
 *  pattern): null unless the player stands within reach of a banker NPC, else a
 *  boundary-cloned view of PlayerMeta.vault. A pure read: it draws NO rng and
 *  never hands out the live stock record. `nextUpgradeCost` is the copper price
 *  of the NEXT rung, null once every rung has been bought. */
function vaultViewerFor(ctx: SimContext, pid: number): PlayerMeta | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta, e: p } = r;
  if (!nearBanker(ctx, p)) return null;
  return meta;
}

/** Cheap proximity signature for the owner-only vault wire. */
export function vaultInfoWireRevFor(ctx: SimContext, pid: number): number | null {
  return vaultViewerFor(ctx, pid)?.vaultWireRev ?? null;
}

/** Cheap ungated revision for the craft-from-vault wire. */
export function vaultWireRevFor(ctx: SimContext, pid: number): number | null {
  return ctx.players.get(pid)?.vaultWireRev ?? null;
}

export function vaultInfoFor(ctx: SimContext, pid: number): VaultInfo | null {
  const meta = vaultViewerFor(ctx, pid);
  if (!meta) return null;
  const vault = meta.vault;
  return {
    stock: { ...vault.stock },
    special: vault.special.map((slot) => {
      const clone = cloneInvSlot(slot);
      delete clone.slot;
      return clone;
    }),
    upgrades: vault.upgrades,
    perMaterialCap: vaultCapacityPerMaterial(vault),
    nextUpgradeCost:
      vault.upgrades >= ctx.storagePrices.vaultUpgrades.length
        ? null
        : ctx.storagePrices.vaultUpgrades[vault.upgrades],
  };
}

/** The ONE load path for persisted vault state, tolerant exactly like
 *  sanitizeBankState. Stock is NEVER destroyed: an id this build's catalog does
 *  not know stays as dormant recoverable stock (the mail/bank precedent), and an
 *  over-capacity count is kept as-is (capacity only blocks new deposits, it
 *  never truncates). The honest growth bound is therefore "whatever keys the
 *  blob carries", not the 55-material deposit gate. A count coercing to zero or
 *  less is a row holding nothing and is skipped (keeping it would mint stock);
 *  an unparseable count keeps the never-destroy floor of 1, clamped to
 *  MAX_SAFE_INTEGER so withdraw arithmetic stays exact, and
 *  `upgrades` clamps into the purchasable range so the price indexing stays
 *  coherent. A malformed JSON-shaped save loads; it never throws (both hosts
 *  deliver saves through JSON.parse, which cannot produce the exotic values,
 *  a Symbol or a throwing valueOf, that could trip Number()).
 *
 *  PURE aside from the droppedSink trace: this function builds and returns a
 *  fresh record and never touches live player state, so a dry-run caller can
 *  sanitize without side effects. Installing the result onto a live player is
 *  restoreVaultStateOnLoad's job, and the vaultWireRev bump an install owes
 *  lives THERE, the one installer, so there is exactly one bumping surface. */
export function sanitizeVaultState(
  raw: unknown,
  owner?: string,
  droppedSink?: string[],
  ownerId?: number,
): MaterialsVaultState {
  if (!raw || typeof raw !== 'object') return { stock: {}, special: [], upgrades: 0 };
  const r = raw as { stock?: unknown; special?: unknown; upgrades?: unknown };
  const rows: [string, number][] = [];
  const localDrops = droppedSink ?? [];
  // A present-but-wrong-shaped stock (an array is the likely wrong guess: the
  // bank's slot-list shape) is dropped WHOLESALE below. That is the ONE shape
  // where "stock is never destroyed" cannot hold, so it must leave a trace
  // (the sanitizeBankState owner/droppedSink idiom) instead of vanishing
  // silently: into the caller's aggregating sink when one is passed, else a
  // direct warn (bank.ts's local fallback, so no caller can make the drop
  // silent by simply not passing a sink). A whole-vault non-object `raw`
  // stays traceless on purpose: it carries no stock rows to lose. No legal
  // writer produces either shape.
  if (r.stock != null && (typeof r.stock !== 'object' || Array.isArray(r.stock))) {
    const shape = `vault.stock:${Array.isArray(r.stock) ? 'array' : typeof r.stock}`;
    if (droppedSink) droppedSink.push(shape);
    else console.warn(`[load] dropped malformed vault stock for ${owner ?? 'vault'}: ${shape}`);
  }
  if (r.stock && typeof r.stock === 'object' && !Array.isArray(r.stock)) {
    for (const [itemId, value] of Object.entries(r.stock as Record<string, unknown>)) {
      if (itemId === '') continue; // malformed key, the bank's empty-itemId skip
      const coerced = Number(value);
      // A count that COERCES to zero or less states "no items": the row holds
      // nothing, so skipping it creates nothing and destroys nothing. The bank
      // floors to 1 instead, but a bank row is a slot holding a real item;
      // lifting a bare vault count of 0 would MINT stock from nothing, which
      // the item-safety covenant forbids ahead of any tolerance rule.
      if (coerced <= 0) continue;
      // An UNPARSEABLE count (NaN) sits on a row that did hold something, so
      // it keeps the bank's never-destroy floor of 1. The MAX_SAFE_INTEGER
      // clamp closes a dupe vector, not a tolerance gap: a non-finite or
      // past-precision count (Infinity, 1e21) survives the subtraction in
      // vaultWithdraw unchanged, granting items while the stock never drops.
      // No legitimate save can exceed it (deposits are capped), so no real
      // item count is ever truncated by the clamp.
      // No Math.max(1, ...) floor is needed: coerced is NaN or > 0 here, and
      // `Math.floor(coerced) || 1` lifts both NaN and a sub-1 fraction to 1
      // (a positive fractional claim keeps the never-destroy floor).
      rows.push([itemId, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(coerced) || 1)]);
    }
  }
  // fromEntries DEFINES each key, so a hostile row key ('__proto__') stays
  // dormant data instead of disappearing into the prototype setter a plain
  // assignment would reach.
  const stock = Object.fromEntries(rows);
  const special: InvSlot[] = [];
  if (r.special != null && !Array.isArray(r.special)) {
    localDrops.push(`vault.special:${typeof r.special}`);
  }
  if (Array.isArray(r.special)) {
    for (const entry of r.special) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as {
        itemId?: unknown;
        count?: unknown;
        instance?: unknown;
        craftedRecipeId?: unknown;
      };
      if (typeof e.itemId !== 'string' || e.itemId === '') continue;
      const hasInstance =
        !!e.instance && typeof e.instance === 'object' && !Array.isArray(e.instance);
      const rawMarker: { itemId: string; craftedRecipeId?: unknown } = {
        itemId: e.itemId,
        craftedRecipeId: e.craftedRecipeId,
      };
      boundCraftedRecipeIdOnLoad(rawMarker, localDrops, 'vault');
      const craftedRecipeId = rawMarker.craftedRecipeId as string | undefined;
      const instance = hasInstance ? (e.instance as ItemInstancePayload) : undefined;
      const count = Math.min(
        Number.MAX_SAFE_INTEGER,
        instancedCountCap(ITEMS[e.itemId], instance),
        Math.max(1, Math.floor(Number(e.count)) || 1),
      );
      const slot: InvSlot = instance
        ? { itemId: e.itemId, count, instance }
        : { itemId: e.itemId, count };
      if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
      const cleaned = cloneInvSlot(slot);
      delete cleaned.slot;
      if (cleaned.instance?.rift && ownerId !== undefined) {
        const rebuilt = sanitizeRiftGearInstance(cleaned.itemId, cleaned.instance, ownerId);
        if (rebuilt) cleaned.instance = rebuilt;
        else delete cleaned.instance;
      }
      if (cleaned.instance) {
        const { payload, dropped } = sanitizeItemInstancePayloadOnLoad(cleaned.instance);
        for (const path of dropped) localDrops.push(`vault.${cleaned.itemId}.${path}`);
        if (payload) cleaned.instance = payload;
        else delete cleaned.instance;
      }
      // Even when sanitization removes the only identity marker, retain the row
      // in the special collection. Folding it into stock would silently merge a
      // corrupt/tolerated row with ordinary material and erase its audit identity.
      special.push(cleaned);
    }
  }
  // Deliberately the COMPILED table, not a resolved override: this load path
  // has no ctx, and the resolver guarantees every override keeps the compiled
  // length, so the clamp is length-stable under any override.
  // AND THE FUTURE HAZARD, recorded here rather than rediscovered: this clamp is
  // ceiling-shaped, so a later release that LENGTHENS the table makes a rollback
  // ACROSS that release destructive, because the old binary clamps the raised
  // value on load and then persists the loss. That is the professions cap-raise
  // class DEPLOY.md already names; the release that lengthens the table owes its
  // own caveat there.
  const upgrades = Math.max(
    0,
    Math.min(VAULT_UPGRADE_PRICES.length, Math.floor(Number(r.upgrades)) || 0),
  );
  if (!droppedSink) warnDroppedInstanceKeys(owner ?? 'vault', localDrops);
  return { stock, special, upgrades };
}

/** The load-path install: sanitize `raw` and REPLACE `meta.vault` with the
 *  result, in one move that cannot forget the wire-rev bump. This module owns
 *  the whole-record replacement the same way it owns every field write, so the
 *  rev-bump enumeration guard in tests/materials_vault.test.ts stays a
 *  one-file story; Sim.addPlayer is a thin caller.
 *
 *  The bump is the ONE bumping surface for an install (sanitizeVaultState
 *  stays pure), and it is UNCONDITIONAL per call: the installer never sees
 *  the previous vault, so it cannot distinguish a no-op rebuild from a
 *  rewrite, and the fail-safe direction is one spurious re-send. It is
 *  defence in depth against a future re-install on a live session: on the
 *  shipped server every addPlayer pairs with a fresh session whose lastSent
 *  is empty and resumeSession wipes lastSent, so no reachable path serves a
 *  stale cvault today; the cvault wire elides on the raw (vaultWireRev,
 *  blocked) signature with no cadence backstop, so a live re-install that
 *  kept the rev WOULD stick until the next real write.
 *
 *  Why the bank twin (sim.ts `meta.bank = sanitizeBankState(...)`) carries no
 *  bump: bankInfoWireRevFor is banker-proximity gated (null away from a
 *  banker) and the load path always pairs with an empty lastSent, so a fresh
 *  session resends regardless; the vault got the bump because vaultWireRevFor
 *  returns the raw counter. */
export function restoreVaultStateOnLoad(
  meta: Pick<PlayerMeta, 'name' | 'vault' | 'vaultWireRev'>,
  raw: unknown,
  droppedSink: string[],
  ownerId: number,
): void {
  bumpVaultWireRev(meta);
  meta.vault = sanitizeVaultState(raw, meta.name, droppedSink, ownerId);
}
