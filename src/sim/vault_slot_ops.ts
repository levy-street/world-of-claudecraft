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
import { isMergeableInstancePayload } from './item_instance_merge';
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
import { type MaterialAddPlan, planMaterialStackAdd } from './material_stack_packing';
import { sanitizeRiftGearInstance } from './rift/progression';
import { cloneInvSlot, type InvSlot, type ItemInstancePayload } from './types';
import {
  absorbsCompactStock,
  drawableStockUnits,
  needsSourceRow,
  readSourceRows,
} from './vault_material_sources';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** An identity row holds one material identity WHOLE. The vault has no bag
 *  cells, so a row is bounded by the per-material ceiling the command shells
 *  enforce, never by the carried stack size: eighty units of one herb are one
 *  row of eighty, not four rows of twenty. */
export const VAULT_ROW_STACK_SIZE = Number.MAX_SAFE_INTEGER;

/** Whether a row's payload pins it to whole moves. A charge-bearing or
 *  player-locked payload is one identity per unit (item_instance_merge.ts,
 *  the bags' one-per-slot stacking rule), so it deposits and withdraws whole:
 *  stricter than the bank's material arm (material_container_move.ts), which
 *  splits any material stack, and stricter is the safe side. Every other
 *  payload (a signer, a bind-on-trade mark) already rides counted stacks in
 *  the bags, where a split simply clones it onto both halves, so the vault
 *  splits it the same way. vaultDeposit, vaultDepositAll and the withdraw
 *  planner all read this one predicate, and so does the vault_view.ts row
 *  model for its chosen-quantity action and its deposit-all replay. */
export function vaultRowMovesWhole(instance: ItemInstancePayload | undefined): boolean {
  return instance !== undefined && !isMergeableInstancePayload(instance);
}

/** Decide adding `grant` to the identity rows: the compatible row tops up,
 *  else one fresh row opens, at the vault's row size. Null when the shared
 *  model cannot read the grant or an existing same-item row. */
export function planVaultRowAdd(
  special: readonly InvSlot[],
  grant: MaterialStackSlot,
  materialIds: ReadonlySet<string>,
): MaterialAddPlan | null {
  const plan = planMaterialStackAdd({
    inventory: special,
    incoming: grant,
    materialIds,
    stackSize: VAULT_ROW_STACK_SIZE,
    maxNewSlots: grant.count,
  });
  return plan.ok ? plan.value : null;
}

/** The rows with a row-add plan applied, as a NEW array: the caller commits
 *  it in one assignment, so a later refusal in the same deposit leaves the
 *  live rows untouched. */
export function appliedVaultRowAdd(special: readonly InvSlot[], plan: MaterialAddPlan): InvSlot[] {
  const out = special.slice();
  for (const replacement of plan.replacements) out[replacement.index] = replacement.slot;
  for (const fresh of plan.appended) out.push(fresh);
  return out;
}

/** Fold rows that share one identity into one row each: the load-path repack
 *  for saves written while a row was capped at the bag stack size (four rows
 *  of twenty read as one row of eighty). A row nothing folds into, a row the
 *  shared model cannot read, a dormant non-material id, and a whole-move
 *  payload row all stay exactly as they are, in place and by reference. A row
 *  that DOES fold is rebuilt through the shared normalize, so two legacy
 *  signer-payload rows come back as one row whose signer sits in a source
 *  bucket with no payload: the shape the deposit path already stores. Null
 *  when nothing folded, and a load with no two rows of one id never reads a
 *  row at all (the steady state costs nothing). */
export function coalesceVaultRows(
  special: readonly InvSlot[],
  materialIds: ReadonlySet<string>,
): InvSlot[] | null {
  const ids = new Set<string>();
  let shared = false;
  for (const row of special) {
    if (ids.has(row.itemId)) {
      shared = true;
      break;
    }
    ids.add(row.itemId);
  }
  if (!shared) return null;
  const out: InvSlot[] = [];
  let folded = false;
  for (const row of special) {
    const plan =
      materialIds.has(row.itemId) && !vaultRowMovesWhole(row.instance)
        ? planMaterialStackAdd({
            inventory: out,
            incoming: row,
            materialIds,
            stackSize: VAULT_ROW_STACK_SIZE,
            maxNewSlots: 1,
          })
        : null;
    if (plan === null || !plan.ok || plan.value.replacements.length === 0) {
      out.push(row);
      continue;
    }
    folded = true;
    for (const replacement of plan.value.replacements) out[replacement.index] = replacement.slot;
    for (const fresh of plan.value.appended) out.push(fresh);
  }
  return folded ? out : null;
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

/**
 * Everything one deposit moves, decided before anything is written. The caller
 * (materials_vault.ts applyVaultDeposit) plans the fold and the grant onto a
 * COPY of the rows first (planVaultRowAdd), and only then commits: the compact
 * write, the compact clear, the rows, the carried remainder.
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
  if (moved <= 0 || (vaultRowMovesWhole(row.instance) && moved !== want)) return { kind: 'full' };
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
