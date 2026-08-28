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
   *  permanently binds it (a craft-proc head-start copy at rank 1 is still
   *  unbound and binds exactly the same way, so the predicate is bound-ness,
   *  not rank). Also the confirm-step predicate: the attempt button's use on
   *  such a copy goes through an explicit confirm. */
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
 *  the tests: an unbound, unperfected, unpromoted copy binds permanently on
 *  its next resolved attempt. */
export function perfectingBindWarning(info: PerfectingInfoView): boolean {
  return !info.bound && !info.perfected && !info.promoted;
}

/**
 * Build the whole view. `requested` is the painter-held selection (null before
 * any pick); a request that no longer names a candidate falls back to the
 * first candidate, so a copy that left the bags mid-session never strands the
 * detail pane on a ghost.
 */
export function buildPerfectingView(
  reads: PerfectingWorldReads,
  requested: PerfectItemRef | null,
): PerfectingViewModel {
  const refs = walkCandidateRefs(reads);
  const infos = new Map<{ ref: PerfectItemRef; worn: boolean }, PerfectingInfoView>();
  for (const entry of refs) {
    const info = reads.perfectingInfo(entry.ref);
    if (info) infos.set(entry, info);
  }
  const live = [...infos.keys()];
  const selectedEntry =
    live.find((entry) => samePerfectRef(entry.ref, requested)) ?? live[0] ?? null;
  const candidates: PerfectingCandidate[] = live.map((entry) => {
    const info = infos.get(entry) as PerfectingInfoView;
    return {
      ref: entry.ref,
      itemId: info.itemId,
      worn: entry.worn,
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
