// The Materials Vault's per-slot BODIES: what a deposit moves, what an
// identity-row withdrawal moves, and how one persisted identity row loads.
//
// Extracted so `materials_vault.ts` stays the state, the capacity math and the
// four command shells rather than growing three more decision bodies inside
// them. The split is the plan/apply idiom the rest of the sim uses: every
// export here DECIDES and returns an inert result, and `materials_vault.ts`
// performs the writes. That is deliberate on two counts. The store's own
// mutations stay in one file, which is what keeps the cvault wire's
// "every stock mutation bumps vaultWireRev" enumeration checkable
// (tests/materials_vault.test.ts scans every other module for a write); and a
// refusal here cannot half-apply, because nothing has been written when it is
// decided.
//
// It owns no algebra either. Validation and the exact take are
// `material_stack.ts`'s, the routing and eligibility rules are
// `vault_material_sources.ts`'s, and the LOAD path is `material_slot_load.ts`'s
// shared pre-validate/coerce/normalize triple, the same one the carried bags,
// the vendor buyback list, the personal bank and the guild book run. The only
// thing assembled here is the order those pieces run in, which has to match the
// bank arm exactly or one stored row would read two ways.
//
// The bag FIT arrives injected (`fitFor`) rather than by calling `countFit`
// here, so the withdrawal decision is drivable from a Vitest with an arbitrary
// fit answer and the two-pool budget stays the command shell's business. (The
// load arm does import `bags.ts`, for the one shared tamper ceiling
// `instancedCountCap`, exactly as the bank and guild arms do.)
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now. Draws NO rng.

import { instancedCountCap } from './bags';
import { ITEMS } from './data';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
} from './item_instance_load';
import {
  normalizeLoadedMaterialSlot,
  preservesMaterialCountOnLoad,
  validateMaterialSlotSourcesOnLoad,
} from './material_slot_load';
import type { MaterialSourceCount } from './material_sources';
import {
  type MaterialStackSlot,
  normalizeMaterialStack,
  takeMaterialStack,
} from './material_stack';
import { sanitizeRiftGearInstance } from './rift/progression';
import { cloneInvSlot, type InvSlot } from './types';
import {
  absorbsCompactStock,
  drawableStockUnits,
  needsSourceRow,
  readSourceRows,
} from './vault_material_sources';

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

/**
 * Everything one deposit moves, decided before anything is written. The caller
 * applies it in this order: compact write, compact clear, fold, grant, carried.
 */
export interface VaultDepositPlan {
  /** The compact row's new count, or null when this deposit does not pool. */
  readonly compactCount: number | null;
  /** True when the compact row's units were folded into the identity block. */
  readonly clearsCompact: boolean;
  /** Unattributed units to move out of the compact row and into that block. */
  readonly foldUnits: number;
  /** The identity-collection grant, or null on the compact arm. */
  readonly grant: MaterialStackSlot | null;
  /** The carried remainder, or null when the whole stack moved. */
  readonly remaining: MaterialStackSlot | null;
}

/**
 * Decide a deposit of exactly `moved` units of `slot`, or refuse.
 *
 * `pooled` is the compact row's stored count, read by the caller behind its own
 * own-property guard. Refusal (null) means the shared model cannot read this
 * slot's provenance, or cannot read an EXISTING row of the same material: the
 * packing core refuses a plan it cannot parse, and a throw out of a command body
 * is not a refusal.
 *
 * ROUTING. A stack carrying a payload, a crafted marker or any recorded source
 * joins the identity collection, because the compact count map has nowhere to
 * put a gatherer. Everything else pools, exactly as before.
 *
 * MIGRATE ON TOUCH. When the arriving block can share with plain unattributed
 * units, the compact row folds into the identity collection as the unrecorded
 * stock it is; a plain arrival joins an existing shareable block for the same
 * reason. Both directions exist so one material is never visible twice at once,
 * as a compact chip AND an identity row. The fold moves units between
 * representations and changes no total, so it can neither mint nor clip a
 * tolerated over-cap holding (a holding that far over cap has no headroom and
 * never reaches this body). A corrupt compact count is left exactly where it
 * is: dormant, never folded into a composition that would have to assert a
 * total the row does not state.
 *
 * The units are lifted with the shared EXACT take, so a partial deposit moves
 * the buckets the default spend order really spends and the carried remainder
 * keeps the rest. The taken half is transfer-ready: the owner's bag cell and
 * grouping flag are stripped, which is right, the vault is a different
 * container and has no separation feature of its own.
 */
export function planVaultDeposit(
  special: readonly InvSlot[],
  slot: InvSlot,
  moved: number,
  pooled: number,
  materialIds: ReadonlySet<string>,
  selectedSources?: readonly MaterialSourceCount[],
): VaultDepositPlan | null {
  const normalized = normalizeMaterialStack(slot, materialIds);
  if (!normalized.ok) return null;
  const split = takeMaterialStack(normalized.value, moved, materialIds, selectedSources);
  if (!split.ok) return null;
  const held = readSourceRows(special, slot.itemId, materialIds);
  if (held === null) return null;

  const taken = split.value.taken;
  const remaining = split.value.remaining;
  const shareable = held.some((row) => absorbsCompactStock(row));
  if (!needsSourceRow(taken) && !shareable) {
    return {
      compactCount: pooled + moved,
      clearsCompact: false,
      foldUnits: 0,
      grant: null,
      remaining,
    };
  }
  // A corrupt compact count is NOT foldable: it stays where it is rather than
  // being asserted into a composition whose total it cannot state. Judged by the
  // one shared rule rather than a second copy of it.
  const foldUnits = absorbsCompactStock(taken) ? drawableStockUnits(pooled) : 0;
  return {
    compactCount: null,
    clearsCompact: foldUnits > 0,
    foldUnits,
    grant: taken,
    remaining,
  };
}

// ---------------------------------------------------------------------------
// Identity-row withdrawal
// ---------------------------------------------------------------------------

/** What a withdrawal decided. `refused` is silent (malformed or stale input,
 *  the store's own idiom); `full` is the bags-full line; `move` carries the
 *  exact edit. */
export type VaultRowWithdrawOutcome =
  | { readonly kind: 'refused' }
  | { readonly kind: 'full' }
  | {
      readonly kind: 'move';
      readonly moved: number;
      /** The transfer-ready stack, with its exact buckets. */
      readonly taken: MaterialStackSlot;
      /** What stays in the row, or null when the row empties. */
      readonly remaining: MaterialStackSlot | null;
    };

/**
 * Decide an identity-row withdrawal of up to `want` units.
 *
 * CAPACITY IS DECIDED BEFORE ANY MUTATION and modelled on the stack that would
 * really land: `fitFor` is handed the transfer-ready preview, payload, crafted
 * marker and buckets included, because a fit gate that models the grant
 * differently is what re-opens the overflow class (#2139).
 *
 * A short fit re-takes exactly what fits, in the same order, which is the
 * store's existing partial-payout behavior. An EXPLICIT source selection is
 * all-or-nothing instead: a caller that named descriptors did not ask for some
 * other subset of them, and substituting one is the thing the whole selection
 * API exists to prevent.
 */
export function planVaultRowWithdraw(
  row: InvSlot,
  want: number,
  materialIds: ReadonlySet<string>,
  selectedSources: readonly MaterialSourceCount[] | undefined,
  fitFor: (preview: MaterialStackSlot) => number,
): VaultRowWithdrawOutcome {
  const normalized = normalizeMaterialStack(row, materialIds);
  if (!normalized.ok) return { kind: 'refused' };
  const planned = takeMaterialStack(normalized.value, want, materialIds, selectedSources);
  if (!planned.ok) return { kind: 'refused' };

  const moved = fitFor(planned.value.taken);
  if (moved <= 0 || (row.instance !== undefined && moved !== want)) return { kind: 'full' };
  if (moved === want) {
    return { kind: 'move', moved, taken: planned.value.taken, remaining: planned.value.remaining };
  }
  if (selectedSources !== undefined) return { kind: 'full' };
  // The fit is independent of WHICH buckets ride along (compatibility is
  // decided on the payload and the crafted marker), so a smaller take of the
  // same identity always fits too and needs no second fit call.
  const smaller = takeMaterialStack(normalized.value, moved, materialIds);
  if (!smaller.ok) return { kind: 'refused' };
  return { kind: 'move', moved, taken: smaller.value.taken, remaining: smaller.value.remaining };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load ONE persisted identity row, or skip it (a malformed entry with no item
 * id, the store's existing skip).
 *
 * THROWS through the shared pre-validate when the row's buckets cannot be read.
 * That refuses the WHOLE character load, before anything is registered and
 * before any legacy coercion can erase what the buckets said, and it is the
 * same policy the carried bags, the personal bank and the guild book apply to
 * the identical corruption. There is deliberately no vault-local tolerant arm:
 * a store that quietly kept a row the character save would have refused is how
 * unreadable attribution outlives the save that carried it.
 *
 * The step order matches the bank arm exactly, and the order is the contract:
 *
 * 1. Shared PRE-VALIDATE on the RAW entry, ahead of every coercion below.
 * 2. The shared marker doctrine helper, which reports a bad marker rather than
 *    dropping it silently.
 * 3. The tamper ceiling, with the shared material exemption in front of it, so
 *    a LEGAL legacy over-cap material holding survives instead of being clipped
 *    back to the stack cap and losing units its buckets still account for. A
 *    legacy charge-bearing row with NO buckets still clamps to one, and an
 *    explicit multi-unit charged composition never gets this far (step 1
 *    refuses it).
 * 4. The rift rebuild, then the shared payload bound, both on the clone.
 * 5. The shared NORMALIZE, last, on the already-bounded clone.
 *
 * `materialSeparated` is never read: manual separation is a bank and bags owner
 * flag, this store has no separation feature, and its wire key list does not
 * carry the field.
 */
export function loadVaultSpecialRow(
  entry: unknown,
  localDrops: string[],
  ownerId: number | undefined,
): InvSlot | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const e = entry as {
    itemId?: unknown;
    count?: unknown;
    instance?: unknown;
    craftedRecipeId?: unknown;
    materialSources?: InvSlot['materialSources'];
  };
  if (typeof e.itemId !== 'string' || e.itemId === '') return null;
  validateMaterialSlotSourcesOnLoad(e);
  const hasInstance = !!e.instance && typeof e.instance === 'object' && !Array.isArray(e.instance);
  const instance = hasInstance ? (e.instance as InvSlot['instance']) : undefined;
  const rawMarker: { itemId: string; craftedRecipeId?: unknown } = {
    itemId: e.itemId,
    craftedRecipeId: e.craftedRecipeId,
  };
  boundCraftedRecipeIdOnLoad(rawMarker, localDrops, 'vault');
  const craftedRecipeId = rawMarker.craftedRecipeId as string | undefined;
  const instanceCap = preservesMaterialCountOnLoad({
    itemId: e.itemId,
    materialSources: e.materialSources,
    instance,
  })
    ? Number.MAX_SAFE_INTEGER
    : instancedCountCap(ITEMS[e.itemId], instance);
  const count = Math.min(
    Number.MAX_SAFE_INTEGER,
    instanceCap,
    Math.max(1, Math.floor(Number(e.count)) || 1),
  );
  const slot: InvSlot = instance
    ? { itemId: e.itemId, count, instance }
    : { itemId: e.itemId, count };
  if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
  if (e.materialSources !== undefined) slot.materialSources = e.materialSources;
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
  return normalizeLoadedMaterialSlot(cleaned);
}
