// The ONE presentation pattern for a profession action refused with a reason
// (the Masterwrought phase 14 unification). Before this module, crafting and
// farming each carried their own shape for the same player moment: crafting's
// craftDenyMessage returned key + ready-made params while farming's
// farmDeniedToast returned key + a raw number the consumer formatted, so the
// two families could drift in structure and tone with nothing to stop them.
//
// The pattern, stated once so both families are held to it:
// - the event is TEXT-FREE; the reason resolves client-side through an
//   exhaustive per-reason table (craft_denial_line_view.ts's Record, or
//   farming_view.ts's union-derived template key), so a new reason fails tsc
//   rather than falling through silently;
// - the presentation plan is a ProfessionDenialLine: the t() key plus its
//   params ALREADY SPELLED through the shared formatters, so no consumer
//   re-formats or re-decides anything;
// - the refusal lands on exactly ONE surface, with no sound cue: crafting's
//   denial is a chat line in the family's deny tone
//   (profession_log_tones.ts PROF_LOG_DENY), farming's is an error toast
//   (the gatherDenied parity rule). The surface per family is a preserved
//   behavior; the shape and tone source are what this module owns.
//
// Consumers: crafting_deny_core.ts (its CraftDenyMessage extends the plan
// shape), farm_event_feedback.ts (renders farmDenialLine below through
// showError).
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { formatNumber } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import { type FarmDeniedReason, farmDeniedToast } from './farming_view';

/** One refusal, ready to render: the key plus fully spelled t() params. */
export interface ProfessionDenialLine {
  key: TranslationKey;
  /** Ready-made t() params; every value already went through the shared
   *  formatters, so consumers interpolate and never re-format. Absent when
   *  the line carries no token. */
  params?: Record<string, string>;
}

/** The farming refusal's presentation plan: farming_view.ts's pure toast
 *  resolution (which stays formatter-free by design) with its tier spelled
 *  here, so the thin consumer renders it exactly like a crafting denial:
 *  t(line.key, line.params), nothing re-decided at the call site. */
export function farmDenialLine(
  reason: FarmDeniedReason,
  cropId: string | undefined,
): ProfessionDenialLine {
  const toast = farmDeniedToast(reason, cropId);
  if (toast.params === undefined) return { key: toast.key };
  return {
    key: toast.key,
    params: { tier: formatNumber(toast.params.tier, { maximumFractionDigits: 0 }) },
  };
}
