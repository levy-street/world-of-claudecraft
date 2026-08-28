// Pure, host-agnostic view model for the Perfecting window (Masterwrought
// phase 14): the window that walks an apex (masterwrought-flagged) copy up the
// rank track to Perfected and, once Perfected, through the orange promotion.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md;
// the crafting_view.ts sibling). It owns every decision the painter would
// otherwise have to make: which owned copies are candidates (the worn walk
// then the bag walk), which candidate is selected (a stale pick falls back to
// the first candidate, the resolveSelectedCraft rule), what the detail pane's
// action is and whether it is enabled, the R2 bind-warning predicate, and the
// VALUE signature the cold painter's 1 Hz clock compares so an unchanged
// world never repaints. DOM-free and i18n-free so tests drive it directly
// against BOTH a Sim-shaped and a ClientWorld-shaped reads stub.
//
// CONTRACTS HONORED HERE (written on PerfectingInfoView, perfecting.ts):
//  - the skill line is gated on the crafting-identity mirror's `synced` flag
//    (all-zero before the first cprof frame lands online), so the view says
//    'syncing' rather than painting a false "skill unmet" at startup (the
//    crafting_view comboReason 'syncing' precedent);
//  - the promote affordance gates on `info.equipBlocked`, the view's
//    pre-answered copy of the promotion's own equip-legality deny arm, never
//    a re-derivation of the equip rules;
//  - the materials rows render whichever rows arrive (the attempt bill, the
//    Deed of Making, or none once promoted); nothing here re-picks the bill.

import {
  craftForApexItem,
  type PerfectItemRef,
  type PerfectingInfoView,
} from '../../../sim/professions/perfecting';
import {
  ALL_EQUIP_SLOTS,
  type EquipSlot,
  type InvSlot,
  type ItemInstancePayload,
} from '../../../sim/types';

/** The reads the view builder needs, satisfied structurally by both hosts
 *  through IWorld (equipment/equipmentInstances/inventory are the inventory
 *  facet, identitySynced is craftingIdentity.synced, perfectingInfo is the
 *  professions facet member). Plain data plus one read function so the core
 *  stays host-agnostic. */
export interface PerfectingWorldReads {
  equipment: Readonly<Partial<Record<EquipSlot, string>>>;
  equipmentInstances: Readonly<Partial<Record<EquipSlot, ItemInstancePayload>>>;
  inventory: readonly InvSlot[];
  identitySynced: boolean;
  perfectingInfo(ref: PerfectItemRef): PerfectingInfoView | null;
}

/** One candidate's coarse track state, for the row's status text. */
export type PerfectingTrackState = 'track' | 'perfected' | 'promoted';

export interface PerfectingCandidate {
  ref: PerfectItemRef;
  itemId: string;
  worn: boolean;
  /** A stable copy identity for the painter's focus carry: a worn slot, or
   *  the item id plus the copy's ordinal among same-id bagged candidates,
   *  which survives the bag shift the cell index does not (the same identity
   *  the selection anchor follows). */
  identity: string;
  selected: boolean;
  state: PerfectingTrackState;
  /** Mid-track rank in [0, ranks - 1]; meaningful only for state 'track'. */
  rank: number;
  ranks: number;
  /** The promoted legend's player-chosen name (raw; the painter esc()s it),
   *  null off the promoted state or when the payload carries none. */
  chosenName: string | null;
}

export type PerfectingAction = 'attempt' | 'promote' | 'done';

export interface PerfectingDetail {
  ref: PerfectItemRef;
  itemId: string;
  worn: boolean;
  info: PerfectingInfoView;
  chosenName: string | null;
  state: PerfectingTrackState;
  /** True while the crafting-identity mirror has not synced: the skill line
   *  says 'syncing' and no action is promised (never a false "skill unmet"). */
  syncing: boolean;
  action: PerfectingAction;
  /** Whether the action button is enabled. The sim re-validates everything;
   *  this is the affordance rule only (a view promises nothing the path
   *  refuses on the facts it can see). */
  actionEnabled: boolean;
  /** Every material row satisfied (vacuously true on an empty bill). */
  materialsMet: boolean;
  /** The R2 warning: the copy is unbound and unperfected, so the NEXT attempt
   *  binds it (a craft-proc head-start copy at rank 1 is still unbound and
   *  binds exactly the same way, so the predicate is bound-ness, not rank;
   *  the bind's permanence is perfectingBindWarning's contract below). Also
   *  the confirm-step predicate: the attempt button's use on such a copy
   *  goes through an explicit confirm. */
  bindWarning: boolean;
}

export interface PerfectingViewModel {
  candidates: PerfectingCandidate[];
  /** Null exactly when there is no candidate. */
  detail: PerfectingDetail | null;
}

/** Two refs name the same copy: same worn slot, or same bag cell + item id. */
export function samePerfectRef(a: PerfectItemRef | null, b: PerfectItemRef | null): boolean {
  if (a === null || b === null) return a === b;
  if ('slot' in a) return 'slot' in b && a.slot === b.slot;
  return 'bag' in b && a.bag === b.bag && a.itemId === b.itemId;
}

/** The candidate walk: worn equipment first (ALL_EQUIP_SLOTS order), then bag
 *  cells in bag order. A candidate is a copy whose item is on the Perfecting
 *  track at all (craftForApexItem non-null, content-derived). */
function walkCandidateRefs(reads: PerfectingWorldReads): { ref: PerfectItemRef; worn: boolean }[] {
  const out: { ref: PerfectItemRef; worn: boolean }[] = [];
  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = reads.equipment[slot];
    if (itemId && craftForApexItem(itemId) !== null) out.push({ ref: { slot }, worn: true });
  }
  reads.inventory.forEach((cell, index) => {
    if (craftForApexItem(cell.itemId) !== null) {
      out.push({ ref: { bag: index, itemId: cell.itemId }, worn: false });
    }
  });
  return out;
}

function trackState(info: PerfectingInfoView): PerfectingTrackState {
  if (info.promoted) return 'promoted';
  return info.perfected ? 'perfected' : 'track';
}

function chosenNameFor(reads: PerfectingWorldReads, ref: PerfectItemRef): string | null {
  const payload =
    'slot' in ref
      ? reads.equipmentInstances[ref.slot]
      : reads.inventory[ref.bag]?.itemId === ref.itemId
        ? reads.inventory[ref.bag]?.instance
        : undefined;
  return payload?.name ?? null;
}

/** The R2 bind-warning predicate, exported for the painter's confirm step and
 *  the tests: an unbound, unperfected, unpromoted copy binds on its next
 *  resolved attempt (a craft-proc head-start copy at rank 1 is still unbound
 *  and binds exactly the same way, so the predicate is bound-ness, not rank).
 *  The bind holds for good once the copy carries Perfecting progress or the
 *  Perfected stamp; a FAILED first attempt leaves a bound rank-0 copy the
 *  Maker's Bond unbind can still clear (the recorded rank-0 shape). */
export function perfectingBindWarning(info: PerfectingInfoView): boolean {
  return !info.bound && !info.perfected && !info.promoted;
}

/** Where a BAGGED copy sits among the bagged candidates of its item id
 *  (`ordinal`, bag order) and how many there are (`count`). A splice of some
 *  other stack (a resolved attempt exhausting a material) shifts every later
 *  cell but never reorders same-id siblings, so this pair identifies the copy
 *  across the shift where its cell index cannot; a sale, deposit, trade, or
 *  destroy of a same-id copy moves `count`, which is the signal to stop
 *  guessing. Null for a worn ref or a ref that names no candidate. */
export interface PerfectingSelectionAnchor {
  ordinal: number;
  count: number;
}

/** Whether the copy selected at the previous paint (its ref plus the anchor
 *  latched with it) is the copy resolved now. The ONE spelling of the
 *  re-target rule the view and the window's answer-edge gate share: two
 *  bagged refs of one item id with anchors are the same copy exactly when
 *  the anchors agree (same-id count unchanged, same ordinal), the cell being
 *  no witness (the adjacent sibling can sit on the old cell after a splice);
 *  everything else (worn refs, a ref without an anchor) is cell identity. */
export function sameSelectedCopy(
  prev: { ref: PerfectItemRef; anchor: PerfectingSelectionAnchor | null },
  ref: PerfectItemRef,
  anchor: PerfectingSelectionAnchor | null,
): boolean {
  if ('slot' in prev.ref || 'slot' in ref) return samePerfectRef(prev.ref, ref);
  if (prev.ref.itemId !== ref.itemId) return false;
  if (prev.anchor === null || anchor === null) return samePerfectRef(prev.ref, ref);
  return prev.anchor.count === anchor.count && prev.anchor.ordinal === anchor.ordinal;
}

export function baggedCopyOrdinal(
  candidates: ReadonlyArray<{ ref: PerfectItemRef; worn: boolean }>,
  ref: PerfectItemRef | null,
): PerfectingSelectionAnchor | null {
  if (ref === null || 'slot' in ref) return null;
  const siblings = candidates.filter(
    (c) => !c.worn && 'bag' in c.ref && c.ref.itemId === ref.itemId,
  );
  const ordinal = siblings.findIndex((c) => samePerfectRef(c.ref, ref));
  return ordinal === -1 ? null : { ordinal, count: siblings.length };
}

/**
 * Build the whole view. `requested` is the painter-held selection (null before
 * any pick). A request that no longer names a candidate is first re-targeted
 * through `anchor` (the painter-latched baggedCopyOrdinal of that selection):
 * when the same-id bagged count is unchanged, the copy at the same ordinal IS
 * the selected copy one or more cells over, so the selection follows it (a
 * resolved attempt that exhausted a lower stack, the common shape) instead of
 * jumping to the first candidate (a worn piece, whose action button would then
 * spend the next ember on a copy the player never picked). Only when the count
 * moved, or there is no anchor, does the request fall back to the first
 * candidate, so a copy that left the bags mid-session never strands the detail
 * pane on a ghost. Every array mutation the sim performs on the bag is a
 * splice or a push at the end (a drag rewrites cell HINTS, never the array,
 * inventory_order.ts), so same-id siblings keep their order, and a resolving
 * anchor outranks the exact cell match (the adjacent sibling slides onto the
 * old cell after a splice). The one shape the anchor cannot see is a same-id
 * copy LEAVING and another ARRIVING inside one poll window (a sale plus a
 * pickup, or equipping a bagged copy while a same-id worn copy is benched),
 * where the count holds and the ordinal names a different copy: the recorded
 * same-id class.
 */
export function buildPerfectingView(
  reads: PerfectingWorldReads,
  requested: PerfectItemRef | null,
  anchor: PerfectingSelectionAnchor | null = null,
): PerfectingViewModel {
  const refs = walkCandidateRefs(reads);
  const infos = new Map<{ ref: PerfectItemRef; worn: boolean }, PerfectingInfoView>();
  for (const entry of refs) {
    const info = reads.perfectingInfo(entry.ref);
    if (info) infos.set(entry, info);
  }
  const live = [...infos.keys()];
  // A RESOLVING anchor outranks the exact cell match: after a splice the
  // adjacent same-id sibling can slide onto the selected copy's old cell, so
  // the cell would name the sibling while the ordinal still names the copy.
  // When a same-id copy departed or arrived the count moves, the anchor
  // stands down by itself, and the exact match takes over.
  const followed =
    requested !== null && 'bag' in requested && anchor !== null
      ? (() => {
          const siblings = live.filter(
            (entry) => !entry.worn && 'bag' in entry.ref && entry.ref.itemId === requested.itemId,
          );
          return siblings.length === anchor.count ? (siblings[anchor.ordinal] ?? null) : null;
        })()
      : null;
  const exact = live.find((entry) => samePerfectRef(entry.ref, requested)) ?? null;
  const selectedEntry = followed ?? exact ?? live[0] ?? null;
  const candidates: PerfectingCandidate[] = live.map((entry) => {
    const info = infos.get(entry) as PerfectingInfoView;
    const ordinal = baggedCopyOrdinal(live, entry.ref);
    return {
      ref: entry.ref,
      itemId: info.itemId,
      worn: entry.worn,
      identity:
        'slot' in entry.ref
          ? `s:${entry.ref.slot}`
          : `b:${entry.ref.itemId}:${ordinal ? ordinal.ordinal : entry.ref.bag}`,
      selected: entry === selectedEntry,
      state: trackState(info),
      rank: info.rank,
      ranks: info.ranks,
      chosenName: info.promoted ? chosenNameFor(reads, entry.ref) : null,
    };
  });
  let detail: PerfectingDetail | null = null;
  if (selectedEntry) {
    const info = infos.get(selectedEntry) as PerfectingInfoView;
    const state = trackState(info);
    const syncing = !reads.identitySynced;
    const materialsMet = info.materials.every((row) => row.have >= row.required);
    const action: PerfectingAction =
      state === 'promoted' ? 'done' : state === 'perfected' ? 'promote' : 'attempt';
    const actionEnabled =
      action === 'done'
        ? false
        : !syncing &&
          info.skillMet &&
          materialsMet &&
          // The promote affordance gates on the view's pre-answered equip
          // verdict, never a re-derivation (the PerfectingInfoView contract).
          (action !== 'promote' || !info.equipBlocked);
    detail = {
      ref: selectedEntry.ref,
      itemId: info.itemId,
      worn: selectedEntry.worn,
      info,
      chosenName: chosenNameFor(reads, selectedEntry.ref),
      state,
      syncing,
      action,
      actionEnabled,
      materialsMet,
      bindWarning: perfectingBindWarning(info),
    };
  }
  return { candidates, detail };
}

/** VALUE signature of one copy's Perfecting facts: everything the detail pane
 *  renders off PerfectingInfoView. The painter clears its in-flight send when
 *  this moves under it (the attempt path emits no event; the inv/einst
 *  mirrors re-diffing are the answer). */
export function perfectingInfoSignature(info: PerfectingInfoView | null): string {
  if (info === null) return 'none';
  const mats = info.materials.map((row) => `${row.itemId}:${row.required}:${row.have}`).join(',');
  return [
    info.itemId,
    info.rank,
    info.ranks,
    info.perfected ? 1 : 0,
    info.promoted ? 1 : 0,
    info.bound ? 1 : 0,
    info.equipBlocked ? 1 : 0,
    info.skillMet ? 1 : 0,
    mats,
  ].join('|');
}

/** VALUE signature of the whole view: candidate identity + per-row state +
 *  the selected copy's full info signature + the sync gate. Text-independent
 *  BY DESIGN (ids, counts, booleans), which is why the window needs a
 *  relocalize() arm in the Hud language fan-out. */
export function perfectingViewSignature(view: PerfectingViewModel, syncing: boolean): string {
  const rows = view.candidates
    .map(
      (c) =>
        `${'slot' in c.ref ? `s:${c.ref.slot}` : `b:${c.ref.bag}:${c.ref.itemId}`}=` +
        `${c.state}:${c.rank}:${c.selected ? 1 : 0}:${c.chosenName ?? ''}`,
    )
    .join(';');
  return `${syncing ? 'sync' : 'ok'}|${rows}|${perfectingInfoSignature(view.detail?.info ?? null)}`;
}
