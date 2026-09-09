import type { RespecPaymentTier } from '../sim/professions/focus';
import type { HarvestAdmissionReason } from '../sim/professions/harvest_admission';
import type { HarvestPreference } from '../sim/professions/harvest_preference';

export type WorldInteractionOutcome = boolean | Promise<boolean>;

// The selected-corpse status contract (Intentional Gathering PR3, corpse-status
// contract.md). `null` means no usable current answer (unknown/pending/stale),
// never permission to harvest; a live `denial: null` means current admission
// accepts. `reservation` carries only a public display name and a
// viewer-relative boolean, never a persisted character id or claim token.
// `tierBonus` is the additional concentration shift over All on this body,
// zero when the preference is unavailable; never a quantity or drop promise.
export interface CorpseHarvestInfo {
  readonly corpseId: number;
  readonly componentTags: readonly string[];
  readonly preference: HarvestPreference | null;
  readonly denial: HarvestAdmissionReason | null;
  readonly reservation: { readonly name: string; readonly self: boolean } | null;
  readonly tierBonus: number;
}

/** A stable authored civic interaction point exposed to presentation without
 * relying on the live entity interest radius. */
export type CivicServiceKind = 'mailbox' | 'noticeboard';

export interface CivicServicePlacement {
  readonly kind: CivicServiceKind;
  readonly x: number;
  readonly z: number;
}

export interface IWorldInteraction {
  /** The civic services that this world actually spawned. */
  readonly civicServicePlacements: readonly CivicServicePlacement[];
  interact(): void;
  lootCorpse(id: number): WorldInteractionOutcome;
  autoLoot(id: number): void;
  // Starts a timed corpse-harvest cast (Intentional Gathering PR3): id only,
  // no per-call component override. What gets extracted resolves entirely
  // from the caller's stored `harvestPreference` (`professions/
  // harvest_preference.ts`) at admission time; there is no town-focus
  // fallback. Returns whether the cast started; the grant itself lands later,
  // on cast completion.
  harvestCorpse(id: number): WorldInteractionOutcome;
  // The cold read behind the corpse popup's Harvest gating (corpse-status
  // contract.md): real facts, never a preview roll. `null` means no usable
  // current answer; a `Promise` on the online world while the correlated
  // `inspectCorpseHarvest` round trip is in flight.
  corpseHarvestInfo(id: number): CorpseHarvestInfo | null | Promise<CorpseHarvestInfo | null>;
  pickUpObject(id: number): WorldInteractionOutcome;
  // #1143: the caller's persistent town focus allocation (component type ->
  // points spent). Empty when unset.
  townFocus: Record<string, number>;
  // Sets the persistent town focus allocation, charged at the #1144 re-spec
  // cost model's chosen payment tier (professions/focus.ts computeRespecCost).
  // Rejected (out of town, malformed, over the point budget, or the tier's
  // coin/material cost unaffordable) server-side; the previous allocation is
  // kept and a toast is shown.
  setTownFocus(allocation: Record<string, number>, tier: RespecPaymentTier): void;
}
