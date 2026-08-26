// Pure, host-agnostic view model for the Maker's Bond unbind window
// (Professions 2.0).
//
// The pure-core half of the pure-core + thin-consumer split (reference
// train_view.ts): it decides which of the viewer's held copies a station
// master's unbind service lists and at what fee. The DOM/i18n side lives in
// unbind_window.ts. DOM-free and i18n-free so tests can drive it directly.
//
// The row predicate mirrors the sim exactly (professions/commission.ts
// resolveUnbind): a row exists iff the viewer holds at least one bound copy
// (instance.boundTo present; the value is never compared, entity ids are not
// stable cross-session identities) of a commission-eligible equipment kind.
// The fee is the sim's own unbindFeeFor over the item DEF, so the listed
// price can never drift from what the resolver charges. Bound copies of
// ineligible kinds (the disenchant reagents) are deliberately
// omitted: the service refuses them (unbind_not_eligible) and an unlisted
// row is the honest rendering. The service is master-independent (any
// station master offers every row), so the view needs no masterNpcId input.

import {
  isCommissionEligible,
  isPerfectingBound,
  type UnbindDenyReason,
  unbindFeeFor,
} from '../../../sim/professions/commission';
import type { InvSlot, ItemDef, ItemInstancePayload } from '../../../sim/types';
import type { TranslationKey } from '../../i18n.catalog';

/** The one reason-to-copy map for the unbindResult deny line (rendered by
 *  the hud's event arm). A total Record, so a reason the sim can emit with no
 *  key here is a type error rather than a silent fallback; the hud arm reads
 *  it through unbindDenyKey below and carries no chain of its own. */
export const UNBIND_DENY_KEY: Readonly<Record<UnbindDenyReason, TranslationKey>> = {
  unbind_not_eligible: 'hudChrome.unbind.notEligible',
  unbind_not_bound: 'hudChrome.unbind.notBound',
  unbind_perfecting: 'hudChrome.unbind.perfecting',
  unbind_out_of_range: 'hudChrome.unbind.outOfRange',
  unbind_no_space: 'hudChrome.unbind.noSpace',
  unbind_cannot_afford: 'hudChrome.unbind.cannotAfford',
};

export function unbindDenyKey(reason: UnbindDenyReason): TranslationKey {
  return UNBIND_DENY_KEY[reason];
}

export interface UnbindRow {
  itemId: string;
  /** The item def when the item table resolves it (display name/icon). */
  item?: ItemDef;
  /** Total bound copies held across all slots (the row unbinds ONE per use). */
  boundCount: number;
  /** The payload of the FIRST bound copy in bag order: the exact copy the
   *  sim's resolver will unbind, so the row tooltip shows its markers. */
  instance?: ItemInstancePayload;
  /** Unbind fee in copper (professions/commission.ts unbindFeeFor). */
  feeCopper: number;
  /** Advisory only; the authoritative unbind path recharges the balance check. */
  affordable: boolean;
}

export interface UnbindView {
  rows: UnbindRow[];
}

export interface UnbindViewDeps {
  /** The viewer's own inventory slots (the self inv mirror is unfiltered in
   *  both hosts, so instance payloads are present). */
  inventory: readonly InvSlot[];
  /** The viewer's copper balance, for the advisory affordability flag. */
  copper: number;
  items: Record<string, ItemDef>;
}

/**
 * Build the unbind view: one row per distinct bound eligible item id, in
 * first-bound-slot bag order (the same earliest-slot order the resolver
 * unbinds in), carrying the total bound count and the DEF-quality fee.
 */
export function buildUnbindView(deps: UnbindViewDeps): UnbindView {
  const byItemId = new Map<string, UnbindRow>();
  for (const slot of deps.inventory) {
    if (slot.instance?.boundTo === undefined) continue;
    // A Perfecting bind (Masterwrought phase 12) is not a Maker's Bond: the
    // resolver refuses it (unbind_perfecting) whatever the station or fee,
    // and an unlisted row is the honest rendering, the ineligible-kind rule.
    if (isPerfectingBound(slot.instance)) continue;
    const def = deps.items[slot.itemId];
    if (!isCommissionEligible(def)) continue;
    const existing = byItemId.get(slot.itemId);
    if (existing) {
      existing.boundCount += slot.count;
      continue;
    }
    const feeCopper = unbindFeeFor(def);
    byItemId.set(slot.itemId, {
      itemId: slot.itemId,
      item: def,
      boundCount: slot.count,
      instance: slot.instance,
      feeCopper,
      affordable: deps.copper >= feeCopper,
    });
  }
  return { rows: [...byItemId.values()] };
}
