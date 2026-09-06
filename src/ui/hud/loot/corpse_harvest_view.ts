// Pure view-core for the corpse popup's harvest STATUS section (Intentional
// Gathering PR3, corpse-status-contract.md). Replaces the retired per-tag
// checkbox picker (#1142): the player has ONE remembered global preference
// (All materials, or one material), and this corpse-local section only shows
// its live status against THIS body (denial, reservation, concentration
// benefit) plus a Change entry into the shared preference picker. DOM/i18n
// free, so a Vitest asserts its shape directly; the thin painter
// (corpse_harvest_window.ts) resolves display names and localized text from
// this model.
//
// Decides no yield, spends no claim, starts no cast: it is a read-only
// projection of the `CorpseHarvestInfo` the corpse popup's controller keeps
// live via the `inspectCorpseHarvest` transport.

import type { HarvestAdmissionReason } from '../../../sim/professions/harvest_admission';
import {
  corpseHarvestPreferenceOptions,
  type HarvestPreference,
} from '../../../sim/professions/harvest_preference';
import type { CorpseHarvestInfo } from '../../../world_api';

/**
 * The corpse popup's live harvest query, as the controller tracks it for ONE
 * open visit: `checking` before any answer has ever arrived, `settled` for
 * every resolved answer since (a `null` info is itself a settled state, never
 * re-shown as `checking` on a later poll that also settles null).
 */
export type CorpseHarvestQueryStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'settled'; readonly info: CorpseHarvestInfo | null };

export interface CorpseHarvestStatusViewModel {
  readonly kind: 'checking' | 'unavailable' | 'ready';
  /** The player's current global preference, or null while unknown
   *  (`checking`/`unavailable`) or malformed. */
  readonly preference: HarvestPreference | null;
  /** null means current admission accepts; only meaningful when `kind` is
   *  'ready'. */
  readonly denial: HarvestAdmissionReason | null;
  readonly reservation: { readonly name: string; readonly self: boolean } | null;
  /** The additional concentration shift over All on this body; zero when the
   *  preference is unavailable or unknown. Never a quantity or drop promise. */
  readonly tierBonus: number;
  /** The component tags actually driving this render: the AUTHORITATIVE
   *  server-confirmed `info.componentTags` once the query has settled with a
   *  real answer, falling back to the caller-supplied (locally known,
   *  possibly stale) tags only while `checking`/`unavailable`. Exposed so a
   *  caller wiring the Change control (which must offer exactly what THIS
   *  body supports) never reaches for the local fallback once a real answer
   *  exists. */
  readonly resolvedComponentTags: readonly string[];
  /** This body's supported material choices (deduplicated item ids), derived
   *  from `resolvedComponentTags`, for describing what IS available when the
   *  stored preference names something else. Never falls back to "All" for a
   *  retired/unavailable material: an unavailable choice stays refused and
   *  named, exactly as `harvest_preference.ts` resolves it. */
  readonly availableMaterialItemIds: readonly string[];
  /** True unless `kind` is 'ready' AND `denial` is null: covers checking,
   *  unavailable, and every active denial (including a malformed
   *  preference). */
  readonly harvestDisabled: boolean;
}

function availableMaterialsFor(componentTags: readonly string[]): readonly string[] {
  const options = corpseHarvestPreferenceOptions(componentTags);
  const ids: string[] = [];
  for (const option of options) {
    if (option.kind === 'material') ids.push(option.itemId);
  }
  return ids;
}

/** The tags this render actually uses: the authoritative `info.componentTags`
 *  once settled with a real answer, the local fallback otherwise. See
 *  `CorpseHarvestStatusViewModel.resolvedComponentTags`. */
function resolveComponentTags(
  status: CorpseHarvestQueryStatus,
  localComponentTags: readonly string[],
): readonly string[] {
  return status.kind === 'settled' && status.info !== null
    ? status.info.componentTags
    : localComponentTags;
}

/**
 * Build the harvest section's render model from the live query status plus
 * this body's carried component tags (known synchronously off the corpse's
 * ordinary loot availability, used only as a fallback until the async status
 * query settles with a real answer; see `resolvedComponentTags`).
 */
export function corpseHarvestStatusView(
  status: CorpseHarvestQueryStatus,
  localComponentTags: readonly string[],
): CorpseHarvestStatusViewModel {
  const resolvedComponentTags = resolveComponentTags(status, localComponentTags);
  const availableMaterialItemIds = availableMaterialsFor(resolvedComponentTags);
  if (status.kind === 'checking') {
    return {
      kind: 'checking',
      preference: null,
      denial: null,
      reservation: null,
      tierBonus: 0,
      resolvedComponentTags,
      availableMaterialItemIds,
      harvestDisabled: true,
    };
  }
  const info = status.info;
  if (info === null) {
    return {
      kind: 'unavailable',
      preference: null,
      denial: null,
      reservation: null,
      tierBonus: 0,
      resolvedComponentTags,
      availableMaterialItemIds,
      harvestDisabled: true,
    };
  }
  return {
    kind: 'ready',
    preference: info.preference,
    denial: info.denial,
    reservation: info.reservation,
    tierBonus: info.tierBonus,
    resolvedComponentTags,
    availableMaterialItemIds,
    harvestDisabled: info.denial !== null,
  };
}

/**
 * A value signature of the rendered state: two statuses with the same
 * signature paint the same section, so the controller's poll-driven refresh
 * can skip a rebuild while it holds (the repaint-signature idiom this HUD
 * uses throughout; see `loot_window_controller.ts`
 * `corpseAvailabilitySignature`). Takes the SAME `localComponentTags` the view
 * builder does and resolves them the identical way, so a change in which tag
 * source is authoritative (or in the tags themselves) is never invisible to
 * the signature the way a componentTags-blind digest would miss it.
 * `JSON.stringify` on the resolved tag array rather than a joined string:
 * an unambiguous serialized tuple, immune to a tag ever containing whatever
 * separator a naive `join` would pick.
 */
export function corpseHarvestStatusSignature(
  status: CorpseHarvestQueryStatus,
  localComponentTags: readonly string[],
): string {
  const tags = JSON.stringify(resolveComponentTags(status, localComponentTags));
  if (status.kind === 'checking') return `checking|${tags}`;
  const info = status.info;
  if (info === null) return `null|${tags}`;
  const preference =
    info.preference === null
      ? 'none'
      : info.preference.kind === 'all'
        ? 'all'
        : `m:${info.preference.itemId}`;
  const reservation = info.reservation ? `${info.reservation.self}:${info.reservation.name}` : '-';
  return `${preference}|${info.denial ?? '-'}|${reservation}|${info.tierBonus}|${tags}`;
}
