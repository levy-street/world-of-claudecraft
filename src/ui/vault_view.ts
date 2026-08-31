// Pure view-core for the Materials Vault tab inside the Bank window (#bank),
// the per-character material stockpile read off the IWorld vault mirror.
// DOM/Three/i18n-free: it maps the proximity-gated VaultInfo snapshot (null
// away from a banker, a locked rung-0 shape before the unlock is bought) to a
// flat render model the thin tab painter (vault_window.ts) draws, decides the
// row click action, predicts the server-side deposit-all outcome from ONE
// click-time snapshot, and explains a withdraw shortfall the sim resolves
// silently. Registered in UI_PURE_CORES; unit-tested against both Sim- and
// ClientWorld-shaped inputs in tests/vault_view.test.ts. Sits FLAT beside the
// bank family (bank_view.ts, guild_bank_view.ts): the bank domain is not
// extracted, so no src/ui/hud/bank/ directory exists for it.
//
// Price and capacity numbers ALWAYS come from the wire snapshot
// (nextUpgradeCost, perMaterialCap), never a client price table; the two
// structural constants this file does import (VAULT_BASE_CAP,
// VAULT_UPGRADE_STEP) are ladder geometry, the BANK_EXPANSION_SLOTS precedent,
// not prices.

import { bagPools, countFit } from '../sim/bags';
import { isVaultDepositableSlot, VAULT_BASE_CAP, VAULT_UPGRADE_STEP } from '../sim/materials_vault';
import { baseMaterialFor } from '../sim/professions/material_grades';
import { cloneItemInstancePayload, type InvSlot, type ItemInstancePayload } from '../sim/types';
import type { VaultInfo, VaultSpecialRef } from '../world_api';
import { bagFineMark } from './bag_fine_mark_view';
import { bagQualityKey } from './bags_view';
import type { BankItemLookup } from './bank_view';

/** One stocked material row. Rows are sorted base-grade-adjacent: grouped by
 *  the BASE material id (a fine grade groups under its base, base first, the
 *  release's compareBagStacks tiebreak rule for every other container),
 *  groups and ties in itemId order. Deterministic and locale-independent in
 *  both hosts, which is why the core imposes ANY order at all: VaultInfo.stock
 *  makes no key-order promise (Postgres jsonb reorders online while the
 *  offline Sim keeps insertion order). The pane is materials-only, so the
 *  full clean-up ladder (category/slot/quality) reduces to exactly this
 *  fine-adjacency over the id order; the narrow BankItemLookup cannot feed
 *  the full ladder and does not need to. */
interface VaultRowBase {
  itemId: string;
  /** Count owned by this actionable row. A pooled row owns the fungible
   *  count; a special row owns exactly one identity/provenance stack. */
  count: number;
  /** Total for this material across pooled and special storage. Capacity is
   *  shared, so fill/over-cap decisions always key off this value. */
  storedTotal: number;
  /** Whether the row exposes the explicit partial-withdraw action. The model
   *  owns this eligibility so every painter presents pooled counts alike. */
  canChooseQuantity: boolean;
  /** The click-time ceiling shown by the quantity prompt, null when splitting
   *  a one-count row would have no meaning. Submit still clamps to live stock. */
  partialMax: number | null;
  /** The uniform per-material ceiling (wire perMaterialCap), repeated per row
   *  for the painter's count/cap readout. */
  cap: number;
  /** No deposit headroom left (count >= cap): the painter's full treatment. */
  atCap: boolean;
  /** A tolerated legacy/tampered save may stock past the ceiling; the row is
   *  still rendered (and withdrawable), never truncated. */
  overCap: boolean;
  /** False when this bundle's catalog does not know the id (dormant stock from
   *  a tolerated save): the painter falls back to the raw id and the default
   *  icon, keeping the stock visibly recoverable. */
  known: boolean;
  qualityKey: string; // item quality ?? 'common' (bagQualityKey semantics)
  /** This id is a fine grade (bag_fine_mark_view): the painter composes the
   *  fine seal and rim exactly like the bags/bank/guild-bank cells, the
   *  release's all-surfaces mark-family rule. */
  fine: boolean;
}

/** One compact fungible-count row. */
export interface VaultPooledRowModel extends VaultRowBase {
  kind: 'pooled';
}

/** One identity/provenance-preserving row. The payload is cloned off the wire
 *  snapshot and the exact selector carries its original snapshot index plus
 *  every present identity field. Instance rows are whole/all-or-nothing;
 *  recipe-only rows remain safely splittable. */
export interface VaultSpecialRowModel extends VaultRowBase {
  kind: 'special';
  specialRef: VaultSpecialRef;
  instance?: ItemInstancePayload;
  craftedRecipeId?: string;
}

export type VaultRowModel = VaultPooledRowModel | VaultSpecialRowModel;

/** The upgrade footer: the NEXT rung's copper price from the wire (null once
 *  every rung is bought), the maxed flag, and the ceiling the next rung would
 *  set (null when maxed). */
export interface VaultUpgradeModel {
  currentUpgrades: number;
  nextCost: number | null;
  maxed: boolean;
  nextCap: number | null;
}

/** The whole tab model. 'away' when no banker is in reach (vaultInfo null;
 *  the tab itself collapses, mirroring the guild tab). 'locked' before rung 0
 *  is bought: the wire shape is { stock: {}, upgrades: 0, perMaterialCap: 0,
 *  nextUpgradeCost: <unlock price> } and the unlock offer renders from it.
 *  Otherwise the stocked view. */
export type VaultViewModel =
  | { kind: 'away' }
  | {
      kind: 'locked';
      /** The unlock price from the wire (rung 0's nextUpgradeCost). */
      unlockCost: number | null;
      /** The per-material ceiling the unlock grants (ladder geometry). */
      unlockCap: number;
    }
  | {
      kind: 'vault';
      rows: VaultRowModel[];
      empty: boolean; // no stocked materials
      perMaterialCap: number;
      upgrade: VaultUpgradeModel;
    };

/** Exact command selector for one boundary-cloned special row. Clone the
 *  payload again so rendering state and a later wire send never share a
 *  mutable object. */
export function vaultSpecialRef(index: number, slot: InvSlot): VaultSpecialRef {
  return {
    index,
    ...(slot.instance ? { instance: cloneItemInstancePayload(slot.instance) } : {}),
    ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
  };
}

/** Content signature term for BankWindow's slow repaint band. Canonicalize
 *  nested key order, but preserve array order: the special selector includes
 *  the snapshot index, so a reorder must repaint even when two payload
 *  fingerprints are otherwise identical. */
export function vaultSpecialContentKey(special: readonly InvSlot[]): readonly string[] {
  return special.map(
    (slot) =>
      `${slot.itemId}\u0000${slot.count}\u0000${canonicalJson(slot.instance)}\u0000${slot.craftedRecipeId ?? ''}`,
  );
}

/** Map the proximity-gated vault snapshot to the render model. Stock rows are
 *  sorted base-grade-adjacent (see VaultRowModel); counts and caps ride
 *  through verbatim, over-capacity included. */
export function buildVaultView(info: VaultInfo | null, lookup: BankItemLookup): VaultViewModel {
  if (!info) return { kind: 'away' };
  if (info.upgrades <= 0) {
    return { kind: 'locked', unlockCost: info.nextUpgradeCost, unlockCap: VAULT_BASE_CAP };
  }
  const cap = info.perMaterialCap;
  const storedTotals = new Map<string, number>();
  for (const [itemId, count] of Object.entries(info.stock)) {
    storedTotals.set(itemId, saneStoredCount(count));
  }
  for (const slot of info.special) {
    storedTotals.set(
      slot.itemId,
      Math.min(
        Number.MAX_SAFE_INTEGER,
        (storedTotals.get(slot.itemId) ?? 0) + saneStoredCount(slot.count),
      ),
    );
  }
  // Base-grade-adjacent order (see VaultRowModel): group key is the base id
  // (a fine grade sorts under its base), base leads inside a group, groups
  // and every other tie in plain itemId order.
  const groupKey = (itemId: string): string => baseMaterialFor(itemId) ?? itemId;
  const common = (itemId: string, count: number): VaultRowBase => {
    const item = lookup(itemId);
    const storedTotal = storedTotals.get(itemId) ?? 0;
    return {
      itemId,
      count,
      storedTotal,
      canChooseQuantity: count > 1,
      partialMax: count > 1 ? count : null,
      cap,
      atCap: storedTotal >= cap,
      overCap: storedTotal > cap,
      known: item !== undefined,
      qualityKey: bagQualityKey(item ?? {}),
      fine: bagFineMark(itemId),
    };
  };
  const sortable: Array<{ row: VaultRowModel; identityKey: string }> = [
    ...Object.entries(info.stock).map(([itemId, count]) => ({
      row: { kind: 'pooled' as const, ...common(itemId, count) },
      identityKey: '',
    })),
    ...info.special.map((slot, index) => {
      const instance = slot.instance ? cloneItemInstancePayload(slot.instance) : undefined;
      const specialRef = vaultSpecialRef(index, slot);
      const row: VaultSpecialRowModel = {
        kind: 'special',
        ...common(slot.itemId, slot.count),
        // One instance payload describes the entire row and may never be
        // split into two independently mutable identities.
        canChooseQuantity: instance === undefined && slot.count > 1,
        partialMax: instance === undefined && slot.count > 1 ? slot.count : null,
        specialRef,
        ...(instance === undefined ? {} : { instance }),
        ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
      };
      return {
        row,
        identityKey: `${canonicalJson(slot.instance)}\u0000${slot.craftedRecipeId ?? ''}\u0000${String(index).padStart(10, '0')}`,
      };
    }),
  ];
  const rows = sortable
    .sort((a, b) => {
      const ga = groupKey(a.row.itemId);
      const gb = groupKey(b.row.itemId);
      if (ga !== gb) return ga < gb ? -1 : 1;
      const fa = a.row.fine;
      const fb = b.row.fine;
      if (fa !== fb) return fa ? 1 : -1;
      if (a.row.itemId !== b.row.itemId) return a.row.itemId < b.row.itemId ? -1 : 1;
      if (a.row.kind !== b.row.kind) return a.row.kind === 'pooled' ? -1 : 1;
      return a.identityKey < b.identityKey ? -1 : a.identityKey > b.identityKey ? 1 : 0;
    })
    .map(({ row }) => row);
  return {
    kind: 'vault',
    rows,
    empty: rows.length === 0,
    perMaterialCap: cap,
    upgrade: {
      currentUpgrades: info.upgrades,
      nextCost: info.nextUpgradeCost,
      maxed: info.nextUpgradeCost === null,
      nextCap: info.nextUpgradeCost === null ? null : cap + VAULT_UPGRADE_STEP,
    },
  };
}

/** What a click on a stocked row does: a whole-count withdraw, the split
 *  prompt (shift on a splittable multi-count row), or nothing. The caller
 *  suppresses Shift for an instance row because one payload must move whole.
 *  Affordability and bag fit stay server-decided. */
export type VaultRowAction =
  | { kind: 'withdraw' }
  | { kind: 'withdrawPartial'; max: number }
  | { kind: 'none' };

/** Decide the row click. Shift on a multi-count row opens the partial prompt;
 *  a non-positive count (impossible from a sane snapshot, cheap to refuse) is
 *  a no-op. */
export function vaultRowAction(count: number, shift: boolean): VaultRowAction {
  if (!(count > 0)) return { kind: 'none' };
  if (shift && count > 1) return { kind: 'withdrawPartial', max: count };
  return { kind: 'withdraw' };
}

/** The predicted outcome of the ONE server-side vault_deposit_all command,
 *  computed from a single click-time snapshot (inventory + vault mirror): how
 *  many carried stacks empty out entirely, how many items move in total, and
 *  whether any depositable material is left behind by its ceiling. Drives the
 *  button's summary line; the SERVER'S sweep is the authority and this replay
 *  mirrors its rules exactly (same skip set, same per-material headroom clamp,
 *  same descending order), so at command cadence the two agree unless the
 *  mirror lags a tick, which the bank's deposit-all already tolerates. */
export interface VaultDepositAllPrediction {
  /** Whole-stack empties. NOT read by any painter (the summary counts items,
   *  a recorded decision): this field is the differential test's ORDER probe.
   *  `items` and `full` are order-invariant over a shared headroom, but which
   *  stack empties whole is decided by the descending walk, so the
   *  prediction-vs-real-sweep differential in tests/materials_vault.test.ts
   *  pins `stacks` against the slots that actually disappeared. Do not drop
   *  it as dead: it is the one output that can red on an ordering drift. */
  stacks: number;
  items: number;
  full: boolean;
}

/** Replay the sim's deposit-all sweep on the snapshot WITHOUT mutating it.
 *  The skip set IS the sim's: both sides call the one exported
 *  isVaultDepositableSlot predicate (ids outside the material set and
 *  degenerate corrupt-save counts), so a future rule change cannot silently
 *  desynchronize the summary from the authoritative outcome. Identity and
 *  provenance rows are included and counted against the shared ceiling;
 *  instance rows remain whole/all-or-nothing. Materials whose headroom is
 *  exhausted are skipped here with the same clamp, and a partial fill moves
 *  what fits and flags `full`. `materialIds` is the caller-supplied honest set
 *  (vaultMaterialIds()), a parameter so tests drive the replay with a small
 *  fixture set. */
export function predictVaultDepositAll(
  inventory: readonly InvSlot[],
  info: Pick<VaultInfo, 'stock' | 'special' | 'upgrades' | 'perMaterialCap'>,
  materialIds: ReadonlySet<string>,
): VaultDepositAllPrediction {
  if (info.upgrades <= 0) return { stacks: 0, items: 0, full: false };
  // A Map, not a spread: a tolerated save can stock a dormant own '__proto__'
  // row, which a record rebuild would drop into the prototype setter.
  const held = new Map(Object.entries(info.stock));
  for (const slot of info.special) {
    held.set(
      slot.itemId,
      Math.min(Number.MAX_SAFE_INTEGER, (held.get(slot.itemId) ?? 0) + saneStoredCount(slot.count)),
    );
  }
  let stacks = 0;
  let items = 0;
  let full = false;
  for (let i = inventory.length - 1; i >= 0; i--) {
    const slot = inventory[i];
    if (!isVaultDepositableSlot(slot, materialIds)) continue;
    const have = held.get(slot.itemId) ?? 0;
    const headroom = Math.max(0, info.perMaterialCap - have);
    if (headroom <= 0) {
      full = true;
      continue;
    }
    // One instance payload describes the whole row. The authoritative sweep
    // leaves it carried when the entire count cannot fit; predicting a partial
    // move would claim items were stored when the sim moved none.
    if (slot.instance !== undefined && headroom < slot.count) {
      full = true;
      continue;
    }
    const moved = Math.min(slot.count, headroom);
    if (moved < slot.count) full = true;
    else stacks += 1;
    items += moved;
    held.set(slot.itemId, have + moved);
  }
  return { stacks, items, full };
}

/** True when the carried inventory holds at least one stack the deposit-all
 *  sweep would consider, including identity/provenance materials: the
 *  button's enabled state. Deliberately ignores headroom, like the bank's
 *  hasDepositableMaterials: a full vault still enables the button and the
 *  summary explains the outcome. */
export function hasVaultDepositable(
  inventory: readonly InvSlot[],
  materialIds: ReadonlySet<string>,
): boolean {
  return inventory.some((s) => isVaultDepositableSlot(s, materialIds));
}

/** The three deposit-all summary lines, as t() keys so the painter stays a
 *  thin consumer and the arm CHOICE is unit-pinned here. */
export type VaultDepositAllSummaryKey =
  | 'hudChrome.bank.vaultDepositAllNone'
  | 'hudChrome.bank.vaultDepositAllFull'
  | 'hudChrome.bank.vaultDepositAllDone';

/** Which transient summary a finished deposit-all earns. Exactly one of three
 *  arms: nothing moved (every candidate ceiling-blocked) -> None; some moved
 *  but a ceiling held something back -> Full; everything moved -> Done. */
export function vaultDepositAllSummaryKey(
  p: Pick<VaultDepositAllPrediction, 'items' | 'full'>,
): VaultDepositAllSummaryKey {
  if (p.items === 0) return 'hudChrome.bank.vaultDepositAllNone';
  if (p.full) return 'hudChrome.bank.vaultDepositAllFull';
  return 'hudChrome.bank.vaultDepositAllDone';
}

/** How many of a withdraw request would actually fit in the bags, modelled
 *  with the sim's OWN countFit + bagPools (the #2139 rule: a pre-check that
 *  models the grant differently re-opens the overflow class). The sim resolves
 *  a partial fit SILENTLY (phase 01's recorded open call), so the UI owns the
 *  explanation, computed from the same click-time snapshot the request used. */
export function vaultWithdrawFit(
  inventory: readonly InvSlot[],
  bags: readonly (string | null)[],
  itemId: string,
  want: number,
  instance?: ItemInstancePayload,
  craftedRecipeId?: string,
): number {
  const fit = countFit(inventory, bagPools(bags), itemId, want, instance, craftedRecipeId);
  return instance !== undefined && fit < want ? 0 : fit;
}

function saneStoredCount(count: number): number {
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** Canonical JSON for deterministic special-row ordering across a JSONB wire
 *  hop that may reorder payload object keys. The snapshot index is only the
 *  final equal-payload tiebreak and remains the exact command selector. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/** The withdraw shortfall notice decision: 'none' when everything fits or when
 *  NOTHING fits (the sim emits its own bags-full line for that arm; a second
 *  client line would double-speak), else the partial explanation with the
 *  fitting count. */
export type VaultWithdrawNotice = { kind: 'none' } | { kind: 'short'; fit: number };

/** Decide the notice from the click-time fit prediction. */
export function vaultWithdrawNotice(fit: number, want: number): VaultWithdrawNotice {
  if (fit <= 0 || fit >= want) return { kind: 'none' };
  return { kind: 'short', fit };
}
