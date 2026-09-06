// The Materials Vault's SOURCE-AWARE half: which of the store's two
// representations a deposit belongs in, which stored units an automatic craft
// draw may spend, and the exact atomic edits both answers imply.
//
// A pure leaf. Everything arrives as a parameter (the compact count record, the
// identity collection, the material set), so there is no content-table import,
// no SimContext, no global cache, and a Vitest imports it directly. It owns no
// algebra of its own either: validation is `normalizeMaterialStack`'s, the spend
// order is `compareMaterialSpendOrder`'s, every split is the shared take
// planner's. Nothing here rounds, clamps, substitutes a source, invents one, or
// grants a premium benefit.
//
// THE TWO STORES, and why the routing decision exists at all. The compact
// record maps an item id to a bare count: it has nowhere to put a gatherer, a
// signer, a payload or a crafted marker. So the moment a stack carries real
// provenance it must live in the identity collection instead, beside the
// instanced and recipe-marked rows that were already there. That is the whole
// feature, and it is why a plainly unattributed material still lands in the
// compact record exactly as before: the compact form is not legacy debt, it is
// the correct representation for stock nobody recorded anything about.
//
// THE AUTOMATIC-DRAW RULE, restated so it cannot be re-derived loosely. Before
// per-unit provenance existed, NO identity row was ever auto-drawable, and the
// reason was never "it sits in that collection": it was that every row there
// was premium-signed, quality-rolled, bound, locked or recipe-marked, and none
// of those was ever spendable by an unattended craft. Plainly gathered material
// is none of those things, so it stays drawable after the representation moved
// under it, and a premium bucket stays undrawable, INCLUDING inside a mixed
// row: the row exposes its eligible count rather than refusing whole. A row
// that keeps ANY per-copy identity after normalization (a surviving payload, a
// crafted marker) contributes nothing, whatever its buckets say. Recording a
// gatherer therefore grants no new benefit and unlocks no new units; it is
// provenance, not power.
//
// THE LOAD PATH IS NOT HERE, deliberately. An earlier cut of this module owned
// its own tolerant reader that RETAINED an unreadable composition as dormant
// data. That was a second policy for one corruption: `material_slot_load.ts` is
// the ONE pre-validate/normalize pair the carried bags, the personal bank, the
// guild book and this store all run, and it REFUSES the whole character load
// rather than keeping a row it cannot read. Keeping a competing
// dormant-malformed format here is exactly how a store ends up holding
// provenance a character save would have refused outright.
//
// FAIL CLOSED ON UNREADABLE PROVENANCE nonetheless, because a row can still be
// unreadable at RUNTIME (a live mutation by a future bug, a hand-built test
// fixture): if any row of one item id carries a composition this model cannot
// read, that id contributes ZERO from the identity collection and no draw may
// touch it. The compact record keeps paying, because it is a separate
// representation nothing about the bad row can corrupt.
//
// READ AND SPEND AGREE BY CONSTRUCTION, not by argument. `planVaultDraw`
// refuses anything past the SAME per-id total `drawableVaultProjection`
// publishes, computed through the same two helpers, so no arm can be more
// permissive than the other in either direction.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now. Draws NO rng, mutates nothing, and every value it returns is freshly
// built so no caller aliases a stored bucket.

import { type MaterialTakePlan, planMaterialInventoryTake } from './material_inventory_take';
import {
  compareMaterialSpendOrder,
  isPremiumMaterialSource,
  type MaterialComposition,
  type MaterialSource,
  type MaterialSourceCount,
  materialSourceKey,
} from './material_sources';
import { type MaterialStackSlot, normalizeMaterialStack } from './material_stack';
import type { InvSlot } from './types';

/**
 * The fields every routing and eligibility rule below reads off a stack, and
 * nothing else. A `MaterialStackSlot` satisfies it structurally, so callers
 * hand over the whole normalized stack; the narrow shape is what lets the
 * vault's own public `isVaultSpecialSlot` predicate share one definition with
 * these rules instead of keeping a second, drifting copy.
 */
export type MaterialStackFacets = Pick<
  MaterialStackSlot,
  'instance' | 'craftedRecipeId' | 'materialSources'
>;

/** Two drawable counts combined, or 0 when the sum leaves the safe integer
 *  range. FAIL CLOSED rather than saturating: a projection that promised more
 *  units than the store can pay would let a craft's admission approve a draw
 *  the consumption cannot perform, which is the mint the whole read/spend
 *  agreement exists to prevent. Unreachable with real holdings (the deposit cap
 *  bounds every legal count); it is the tampered-save arm. */
function combineDrawable(left: number, right: number): number {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : 0;
}

/**
 * The drawable rule for ONE compact-record count: the count itself when it is a
 * positive integer inside float precision, else 0.
 *
 * The bound restated for a path with no player at a counter to see a refusal:
 * the load path floors and clamps what it reads, but a hand-edited or
 * future-shaped save can still present zero, a negative, NaN, Infinity, a
 * fraction or a past-precision 1e21. A craft that planned against any of those
 * would either destroy stock (a Math.min against a degenerate count) or MINT
 * items (a decrement against a past-precision count is a float no-op while the
 * grant is real), so such a row stays DORMANT: never counted, never spent,
 * never deleted.
 *
 * `materials_vault.ts drawableVaultCount` is the record-facing entry every
 * caller uses; it adds the own-property guard and delegates the RULE here, so
 * the rule keeps exactly one definition as more consumers land.
 */
export function drawableStockUnits(held: unknown): number {
  if (typeof held !== 'number') return 0;
  return Number.isInteger(held) && held > 0 && held <= Number.MAX_SAFE_INTEGER ? held : 0;
}

/**
 * True when a NORMALIZED stack carries something the compact count record has
 * nowhere to put: a surviving payload, a crafted marker, or any bucket that
 * names a gatherer or a signer.
 *
 * Judged on the NORMALIZED stack deliberately. A legacy signed slot carries its
 * signer in the payload before normalization and in a bucket after, and both
 * readings must route it to the identity collection; asking the raw slot would
 * make the answer depend on which side of the projection the caller stood.
 *
 * `materialSeparated` is deliberately NOT an arm. Manual separation is a BANK
 * and bags owner flag: the vault has no separation feature, its wire key list
 * (src/net/vault_snapshot_wire.ts SPECIAL_KEY_LIST) does not carry the field,
 * and a deposit strips it with the rest of the owner's container metadata. A
 * routing arm for it here would be support for something nothing can produce.
 */
export function needsSourceRow(normalized: MaterialStackFacets): boolean {
  if (normalized.instance !== undefined) return true;
  if (normalized.craftedRecipeId !== undefined) return true;
  for (const bucket of normalized.materialSources ?? []) {
    if (bucket.source.gatherer !== undefined || bucket.source.signer !== undefined) return true;
  }
  return false;
}

/**
 * True when a NORMALIZED row may absorb plain unattributed units off the
 * compact record.
 *
 * The migrate-on-touch rule the deposit path applies: once one material has an
 * identity row, leaving its unattributed units in the compact record too would
 * show the player the same material twice under two representations. Folding
 * them in as unrecorded buckets is lossless (they ARE unrecorded stock) and
 * moves no units, so it can neither mint nor clip a tolerated over-cap holding.
 *
 * A row with a payload or a crafted marker refuses the fold: those plain units
 * never had that identity and must not inherit it.
 */
export function absorbsCompactStock(normalized: MaterialStackFacets): boolean {
  return normalized.instance === undefined && normalized.craftedRecipeId === undefined;
}

/** True when a NORMALIZED row is the KIND an automatic draw may reach into at
 *  all: no surviving payload (rolled, bound, locked, charged, named) and no
 *  crafted marker. Which of its UNITS may be spent is the bucket question
 *  below; a row that fails here exposes none of them.
 *
 *  Identical to `absorbsCompactStock` by coincidence of the current rule set,
 *  and kept SEPARATE on purpose: one answers "may plain units join this block",
 *  the other "may an unattended craft spend from it". They would diverge the
 *  moment either question gained an arm the other did not, and collapsing them
 *  now is what would make that divergence silent. */
export function autoDrawableRow(normalized: MaterialStackFacets): boolean {
  return normalized.instance === undefined && normalized.craftedRecipeId === undefined;
}

/** Units of a NORMALIZED row an automatic draw may spend: every non-premium
 *  bucket, or none at all when the row keeps per-copy identity. */
export function autoDrawableUnits(normalized: MaterialStackFacets): number {
  if (!autoDrawableRow(normalized)) return 0;
  let units = 0;
  for (const bucket of normalized.materialSources ?? []) {
    if (isPremiumMaterialSource(bucket.source)) continue;
    units = combineDrawable(units, bucket.count);
  }
  return units;
}

/**
 * Every identity row holding `itemId`, normalized, or null when ANY of them is
 * unreadable (or the id is not a material this model owns).
 *
 * All-or-nothing on purpose, and it is what keeps the read and the spend in
 * agreement: the shared take planner validates every same-item stack in scope
 * and refuses the whole request when one fails, so a projection that counted
 * around a bad row would promise units the spend could never deliver.
 */
export function readSourceRows(
  special: readonly InvSlot[],
  itemId: string,
  materialIds: ReadonlySet<string>,
): readonly MaterialStackSlot[] | null {
  if (!materialIds.has(itemId)) return null;
  const rows: MaterialStackSlot[] = [];
  for (const slot of special) {
    if (slot.itemId !== itemId) continue;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok) return null;
    rows.push(normalized.value);
  }
  return rows;
}

/**
 * Auto-drawable units per item id held in the identity collection.
 *
 * An id with an unreadable row answers NOTHING at all, even for its readable
 * siblings, and stays refused for the rest of the walk however the rows are
 * ordered. Ids the material set does not own are skipped rather than refused:
 * a reagent id is whatever content declares, and a dormant non-material row was
 * never drawable in the first place.
 */
export function sourceRowDrawableUnits(
  special: readonly InvSlot[],
  materialIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  const refused = new Set<string>();
  for (const slot of special) {
    const itemId = slot.itemId;
    if (refused.has(itemId) || !materialIds.has(itemId)) continue;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok) {
      refused.add(itemId);
      totals.delete(itemId);
      continue;
    }
    const units = autoDrawableUnits(normalized.value);
    if (units <= 0) continue;
    const next = (totals.get(itemId) ?? 0) + units;
    // An unsafe running total REFUSES the id outright rather than folding to
    // zero and letting the next row start a fresh partial sum: a partial answer
    // would be neither the truth nor the fail-closed zero, and the spend side
    // computes its ceiling the same way, so both must refuse identically.
    if (!Number.isSafeInteger(next)) {
      refused.add(itemId);
      totals.delete(itemId);
      continue;
    }
    totals.set(itemId, next);
  }
  return totals;
}

/** The identity-collection half for ONE item id, or null when the id refuses
 *  (an unreadable same-item row, or a total that leaves the safe range). The
 *  spend side's ceiling, computed exactly the way the projection above computes
 *  its per-id entry, so the two cannot drift. */
function identityDrawableUnits(rows: readonly MaterialStackSlot[]): number | null {
  let units = 0;
  for (const row of rows) {
    const next = units + autoDrawableUnits(row);
    if (!Number.isSafeInteger(next)) return null;
    units = next;
  }
  return units;
}

/**
 * The whole drawable projection: the compact record's drawable rows plus the
 * identity collection's eligible units, one entry per item id.
 *
 * Built through `Object.fromEntries` over an own-key walk, never keyed
 * assignment onto a `{}` literal: the source record can carry a dormant own
 * '__proto__' row (the load path defines one rather than dropping it, so
 * tolerated corrupt stock stays recoverable), and copying it with `clone[id] =
 * n` would reach the inherited prototype setter instead of defining a row.
 */
export function drawableVaultProjection(
  stock: Readonly<Record<string, number>>,
  special: readonly InvSlot[],
  materialIds: ReadonlySet<string>,
): Record<string, number> {
  const fromRows = sourceRowDrawableUnits(special, materialIds);
  const rows: [string, number][] = [];
  for (const itemId of Object.keys(stock)) {
    if (!Object.hasOwn(stock, itemId)) continue;
    const total = combineDrawable(drawableStockUnits(stock[itemId]), fromRows.get(itemId) ?? 0);
    if (total > 0) rows.push([itemId, total]);
  }
  for (const [itemId, units] of fromRows) {
    if (Object.hasOwn(stock, itemId) || units <= 0) continue;
    rows.push([itemId, units]);
  }
  return Object.fromEntries(rows);
}

/**
 * Do these two compositions describe the same units?
 *
 * Compared as descriptor-to-count maps rather than position by position, so a
 * stored row that predates canonical ordering still matches the canonical form
 * a caller quotes back. An absent composition equals only the empty one.
 *
 * This is the EXACTNESS half of the identity-row selector: a stale displayed
 * index may only be recovered onto a row whose provenance matches in full, and
 * NEVER onto a differently sourced row that merely shares a payload. Two blocks
 * of one material can legitimately differ by nothing but their gatherers, and
 * withdrawing the wrong one would hand the player somebody else's units.
 *
 * TOTAL over untrusted input: the left side is whatever a stored row holds,
 * which on a dormant unreadable row is arbitrary retained data. Anything that is
 * not a well-formed bucket list simply does not match, which is the fail-closed
 * direction (a row nothing can read is a row nothing may select).
 */
export function sameMaterialComposition(
  left: MaterialComposition | undefined,
  right: MaterialComposition | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const entry of a) {
    if (entry === null || typeof entry !== 'object') return false;
    const { source, count } = entry as { source?: unknown; count?: unknown };
    if (source === null || typeof source !== 'object' || typeof count !== 'number') return false;
    const key = materialSourceKey(source as MaterialSource);
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  for (const entry of b) {
    const key = materialSourceKey(entry.source);
    const held = counts.get(key);
    if (held === undefined) return false;
    const rest = held - entry.count;
    if (rest < 0) return false;
    if (rest === 0) counts.delete(key);
    else counts.set(key, rest);
  }
  return counts.size === 0;
}

/** The two halves of an automatic draw. `fromRows` is the shared take planner's
 *  inert edit over the identity collection, or null when the compact record
 *  covered the whole request on its own. */
export interface VaultDrawPlan {
  /** Units to take off the compact record's row. */
  readonly fromStock: number;
  /** The identity-collection edit, applied with `applyMaterialInventoryTake`. */
  readonly fromRows: MaterialTakePlan | null;
}

/**
 * The explicit non-premium selection an automatic draw spends, coalesced by
 * descriptor: unrecorded material first, then other plain material, premium
 * NEVER. Null when the eligible buckets cannot cover `owed`.
 *
 * The selection names descriptors and counts, never rows, which is exactly
 * right: two rows holding the same descriptor are interchangeable for
 * conservation, and the planner satisfies each descriptor from its own
 * deterministic candidate order.
 */
function chooseNonPremiumUnits(
  rows: readonly MaterialStackSlot[],
  owed: number,
): MaterialSourceCount[] | null {
  const candidates: { source: MaterialSource; count: number }[] = [];
  for (const row of rows) {
    if (!autoDrawableRow(row)) continue;
    for (const bucket of row.materialSources ?? []) {
      if (isPremiumMaterialSource(bucket.source)) continue;
      candidates.push({ source: bucket.source, count: bucket.count });
    }
  }
  candidates.sort((a, b) => compareMaterialSpendOrder(a.source, b.source));
  const chosen = new Map<string, MaterialSourceCount>();
  let remaining = owed;
  for (const candidate of candidates) {
    if (remaining === 0) break;
    const spend = Math.min(remaining, candidate.count);
    const key = materialSourceKey(candidate.source);
    const held = chosen.get(key);
    chosen.set(key, { source: candidate.source, count: (held?.count ?? 0) + spend });
    remaining -= spend;
  }
  return remaining === 0 ? [...chosen.values()] : null;
}

/**
 * Plan an automatic draw of `count` units, or refuse. Nothing is written: the
 * caller applies both halves or discards the plan, which is what lets a
 * capacity or availability gate use it as a predictor.
 *
 * The compact record pays FIRST, because its units ARE unrecorded stock and the
 * shared spend order puts unrecorded material ahead of everything else. Only
 * the remainder reaches the identity collection, where the selection above
 * keeps premium buckets untouched.
 *
 * THE CEILING IS THE PROJECTION'S OWN ANSWER, not an independently argued one:
 * the same compact rule and the same per-id identity total the projection
 * publishes, combined the same way, and anything past it refuses. That is what
 * makes "the read and the spend agree" structural. Without it the two could
 * drift in the permissive direction on the fail-closed arms alone (an id the
 * projection refuses whole would still have been paid out of its compact row).
 *
 * Every refusal arm answers null with the caller's data untouched: a count that
 * is not a positive safe integer, a count past the drawable total, an unreadable
 * same-item row, eligible buckets that cannot cover the remainder, or a planner
 * refusal.
 */
export function planVaultDraw(
  stock: Readonly<Record<string, number>>,
  special: readonly InvSlot[],
  itemId: string,
  count: number,
  materialIds: ReadonlySet<string>,
): VaultDrawPlan | null {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  const stockUnits = Object.hasOwn(stock, itemId) ? drawableStockUnits(stock[itemId]) : 0;
  // `rows` is null for a non-material id AND for an id with an unreadable row.
  // Both contribute nothing from the identity collection in the projection, so
  // both contribute nothing here; the compact row keeps paying either way.
  const rows = readSourceRows(special, itemId, materialIds);
  const identityUnits = rows === null ? 0 : identityDrawableUnits(rows);
  const drawable = identityUnits === null ? 0 : combineDrawable(stockUnits, identityUnits);
  if (count > drawable) return null;

  const fromStock = Math.min(count, stockUnits);
  const owed = count - fromStock;
  if (owed === 0) return { fromStock, fromRows: null };

  if (rows === null) return null;
  const selection = chooseNonPremiumUnits(rows, owed);
  if (selection === null) return null;
  const plan = planMaterialInventoryTake({
    inventory: special,
    itemId,
    count: owed,
    materialIds,
    // The SAME predicate the projection counted through, so a row that
    // contributed nothing can never be spent from.
    eligibleSlot: (slot) => {
      const normalized = normalizeMaterialStack(slot, materialIds);
      return normalized.ok && autoDrawableRow(normalized.value);
    },
    selectedSources: selection,
  });
  if (!plan.ok) return null;
  // Belt and braces against a future planner that learns to under-deliver: a
  // short take would spend real units for a draw the caller reports as whole.
  if (plan.value.takenCount !== owed) return null;
  return { fromStock, fromRows: plan.value };
}

// ---------------------------------------------------------------------------
// The load path is material_slot_load.ts's, not this module's
// ---------------------------------------------------------------------------
//
// `validateMaterialSlotSourcesOnLoad` / `preservesMaterialCountOnLoad` /
// `normalizeLoadedMaterialSlot` are the ONE pre-validate/coerce/normalize triple
// every container runs: the carried bags, the vendor buyback list, the personal
// bank, the guild book and this store. They REFUSE the whole character load on
// a row whose buckets the shared model cannot read, rather than keeping it.
//
// An earlier cut of this module owned a tolerant reader that RETAINED an
// unreadable composition as dormant data and traced it. That was a second
// policy for one corruption, and a competing dormant-malformed format is
// exactly how a store ends up holding attribution a character save would have
// refused outright. Nothing vault-specific survives here.
