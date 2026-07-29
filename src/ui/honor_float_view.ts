// The floating text that pops over your OWN character when you gain Honor, and
// the one decision it carries: whether the gain names its reason.
//
// Pure and host-agnostic (the i18n runtime is the only import, which is the
// key/label selection a registered UI core is allowed): the HUD's `case 'honor'`
// resolves the string here and hands it straight to the FCT painter, so the copy
// is unit-testable without a DOM, a Sim, or a painter.
//
// WHICH gains name a reason, and why only those three: the per-kill and per-assist
// drip (src/sim/pvp/honor.ts) is a fast, repeating trickle landing mid-fight, and
// "+5 Honor" alone leaves the player guessing which of the two just paid. The
// first-win-of-the-day bonus is the third, for the opposite reason: it lands in the
// same instant as the ordinary win award, so two unlabelled floats stack over the
// player and neither says which is the once-a-day one they came back for. Every
// other reason is a once-per-match award that already has a louder surface (the
// arena / battleground result banner and its chat line), so it keeps the plain
// float rather than repeating a banner that is on screen at that moment. A reason
// with no short label here is not an error: it falls back to the plain form, which
// is also what keeps a newer server's widened HonorReason from breaking the float.
import type { HonorReason } from '../sim/types';
import { formatNumber, type TranslationKey, t } from './i18n';

/** Short, float-sized labels for the reasons that name themselves. Deliberately
 *  NOT the chat line's `hudChrome.warfare.reasons.*` values: those are lowercase
 *  mid-sentence fragments ("honorable kill") written to sit inside "You gain 5
 *  Honor (...)", and they read as a stutter at floating-text size. */
export const HONOR_FLOAT_REASON_KEYS: Partial<Record<HonorReason, TranslationKey>> = {
  battleground_kill: 'hudChrome.warfare.floatReasons.kill',
  battleground_assist: 'hudChrome.warfare.floatReasons.assist',
  battleground_first_win: 'hudChrome.warfare.floatReasons.firstWin',
};

/** The float's short reason label key, or null when this gain floats plain. */
export function honorFloatReasonKey(reason: HonorReason): TranslationKey | null {
  return HONOR_FLOAT_REASON_KEYS[reason] ?? null;
}

/** The fully localized float text: "+5 Honor (Kill)", or "+120 Honor" for a gain
 *  that does not name its reason. The amount goes through `formatNumber` like
 *  every other player-visible number, so a grouped locale groups it. */
export function honorFloatText(reason: HonorReason, amount: number): string {
  const formatted = formatNumber(amount, { maximumFractionDigits: 0 });
  const reasonKey = honorFloatReasonKey(reason);
  return reasonKey
    ? t('hudChrome.warfare.honorFloatReason', { amount: formatted, reason: t(reasonKey) })
    : t('hudChrome.warfare.honorFloat', { amount: formatted });
}
