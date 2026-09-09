// Commission order board chat-line model (issue #1298): maps a text-free
// commissionOrderResult event to the resolved item display name, the
// hudChrome key + params it interpolates, and the professions log tone,
// extracted from Hud.handleEvents (the tool_effect_result_view.ts precedent).
// ONE chat line either way (the trainResult single-surface rule: no toast, no
// extra sound cue); a deny with no reason renders nothing, so the model
// returns null rather than a line.
//
// DOM/Three-free, covered by architecture.test.ts's remainder sweep (it
// touches no browser global, so it needs no explicit registration).

import { ITEMS } from '../../../sim/data';
import type { SimEvent } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import type { TranslationKey } from '../../i18n';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from './profession_log_tones';

type CommissionOrderResultEvent = Extract<SimEvent, { type: 'commissionOrderResult' }>;
export type CommissionOrderDenyReason = NonNullable<CommissionOrderResultEvent['reason']>;

export interface CommissionOrderResultLine {
  key: TranslationKey;
  params: Record<string, string>;
  /** PROF_LOG_GRANT on success, PROF_LOG_DENY on a refusal. */
  tone: string;
}

const DENY_NO_SPACE: TranslationKey = 'hudChrome.commissionBoard.denyNoSpace';

/** Every deny reason's key, as an EXHAUSTIVE Record (the tool_effect_result_view
 *  shape): a reason added to the wire union fails tsc HERE until it gets a line.
 *  Kept exhaustive for the KNOWN union; an unrecognized reason (a widened wire,
 *  or a wire-shaped string that collides with an Object.prototype member such
 *  as 'toString') is resolved through `denyKeyFor` below, never a direct
 *  index, which would silently answer a prototype member for such a key. */
const DENY_KEY_BY_REASON: Record<CommissionOrderDenyReason, TranslationKey> = {
  unknown_recipe: 'hudChrome.commissionBoard.denyUnknownRecipe',
  not_commission_eligible: 'hudChrome.commissionBoard.denyNotCommissionEligible',
  unknown_crafter: 'hudChrome.commissionBoard.denyUnknownCrafter',
  self_crafter: 'hudChrome.commissionBoard.denySelfCrafter',
  too_many_open: 'hudChrome.commissionBoard.denyTooManyOpen',
  unknown_order: 'hudChrome.commissionBoard.denyUnknownOrder',
  order_not_open: 'hudChrome.commissionBoard.denyOrderNotOpen',
  self_order: 'hudChrome.commissionBoard.denySelfOrder',
  not_eligible_crafter: 'hudChrome.commissionBoard.denyNotEligibleCrafter',
  not_your_order: 'hudChrome.commissionBoard.denyNotYourOrder',
  order_not_accepted: 'hudChrome.commissionBoard.denyOrderNotAccepted',
  not_your_acceptance: 'hudChrome.commissionBoard.denyNotYourAcceptance',
  not_crafted: 'hudChrome.commissionBoard.denyNotCrafted',
  deliver_out_of_range: 'hudChrome.commissionBoard.denyOutOfRange',
  no_space: DENY_NO_SPACE,
};

/** The historical ternary's fallback rule, preserved exactly: an unknown or
 *  off-vocabulary reason (a newer deploy widening the wire, or a malformed
 *  wire string) reads as denyNoSpace, the chain's final `:` arm. The
 *  Object.hasOwn check is what makes that safe against a wire-shaped string
 *  that collides with an Object.prototype member (e.g. reason: 'toString'):
 *  a bare index would resolve the inherited function instead of falling
 *  through to the no-space line. */
function denyKeyFor(reason: string): TranslationKey {
  return Object.hasOwn(DENY_KEY_BY_REASON, reason)
    ? DENY_KEY_BY_REASON[reason as CommissionOrderDenyReason]
    : DENY_NO_SPACE;
}

/** The chat-line model for one commissionOrderResult, or null when the event
 *  is a deny carrying no reason (the historical no-op: the board/bag refresh
 *  still runs in the caller, only the chat line is skipped). */
export function commissionOrderResultLine(
  ev: Pick<CommissionOrderResultEvent, 'action' | 'ok' | 'itemId' | 'requesterName' | 'reason'>,
): CommissionOrderResultLine | null {
  const item = ev.itemId ? ITEMS[ev.itemId] : undefined;
  const itemName = item ? itemDisplayName(item) : (ev.itemId ?? '');
  if (ev.ok) {
    const key: TranslationKey =
      ev.action === 'open'
        ? 'hudChrome.commissionBoard.opened'
        : ev.action === 'cancel'
          ? 'hudChrome.commissionBoard.cancelled'
          : ev.action === 'accept'
            ? 'hudChrome.commissionBoard.accepted'
            : 'hudChrome.commissionBoard.delivered';
    return {
      key,
      params: {
        item: itemName,
        // Only 'deliver' interpolates {name}, and it names the REQUESTER
        // (who receives the item), not ev.pid (the acting crafter): resolve
        // off the event's own requesterName, never the crafter's own entity
        // name.
        name: ev.action === 'deliver' ? (ev.requesterName ?? '') : '',
      },
      tone: PROF_LOG_GRANT,
    };
  }
  if (!ev.reason) return null;
  return { key: denyKeyFor(ev.reason), params: {}, tone: PROF_LOG_DENY };
}
