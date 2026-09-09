// The commission order board chat-line model
// (src/ui/hud/professions/commission_order_feedback.ts): every action's
// success key and every deny reason's key is a hand-written expectation here
// (the tool_effect_result_view suite's shape).
import { describe, expect, it } from 'vitest';
import {
  type CommissionOrderDenyReason,
  commissionOrderResultLine,
} from '../src/ui/hud/professions/commission_order_feedback';
import { PROF_LOG_DENY, PROF_LOG_GRANT } from '../src/ui/hud/professions/profession_log_tones';
import { hasTranslation } from '../src/ui/i18n';

describe('commissionOrderResultLine', () => {
  it('an open success names the item and no requester', () => {
    expect(commissionOrderResultLine({ action: 'open', ok: true, itemId: 'copper_ore' })).toEqual({
      key: 'hudChrome.commissionBoard.opened',
      params: { item: 'Copper Ore', name: '' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('a cancel success names the item and no requester', () => {
    expect(commissionOrderResultLine({ action: 'cancel', ok: true, itemId: 'copper_ore' })).toEqual(
      {
        key: 'hudChrome.commissionBoard.cancelled',
        params: { item: 'Copper Ore', name: '' },
        tone: PROF_LOG_GRANT,
      },
    );
  });

  it('an accept success names the item and no requester', () => {
    expect(commissionOrderResultLine({ action: 'accept', ok: true, itemId: 'copper_ore' })).toEqual(
      {
        key: 'hudChrome.commissionBoard.accepted',
        params: { item: 'Copper Ore', name: '' },
        tone: PROF_LOG_GRANT,
      },
    );
  });

  it('a deliver success names the item AND the requester (not the acting crafter)', () => {
    expect(
      commissionOrderResultLine({
        action: 'deliver',
        ok: true,
        itemId: 'copper_ore',
        requesterName: 'Alara',
      }),
    ).toEqual({
      key: 'hudChrome.commissionBoard.delivered',
      params: { item: 'Copper Ore', name: 'Alara' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('a deliver success with no requesterName interpolates an empty name rather than throwing', () => {
    expect(
      commissionOrderResultLine({ action: 'deliver', ok: true, itemId: 'copper_ore' }),
    ).toEqual({
      key: 'hudChrome.commissionBoard.delivered',
      params: { item: 'Copper Ore', name: '' },
      tone: PROF_LOG_GRANT,
    });
  });

  it('an unknown itemId renders the raw id rather than crashing', () => {
    expect(
      commissionOrderResultLine({ action: 'open', ok: true, itemId: 'not_a_real_item' }),
    ).toEqual({
      key: 'hudChrome.commissionBoard.opened',
      params: { item: 'not_a_real_item', name: '' },
      tone: PROF_LOG_GRANT,
    });
  });

  // Every deny reason's line, hand-written (independent of the module's
  // internal table), covering the WHOLE wire union.
  const DENIALS: [CommissionOrderDenyReason, string][] = [
    ['unknown_recipe', 'hudChrome.commissionBoard.denyUnknownRecipe'],
    ['not_commission_eligible', 'hudChrome.commissionBoard.denyNotCommissionEligible'],
    ['unknown_crafter', 'hudChrome.commissionBoard.denyUnknownCrafter'],
    ['self_crafter', 'hudChrome.commissionBoard.denySelfCrafter'],
    ['too_many_open', 'hudChrome.commissionBoard.denyTooManyOpen'],
    ['unknown_order', 'hudChrome.commissionBoard.denyUnknownOrder'],
    ['order_not_open', 'hudChrome.commissionBoard.denyOrderNotOpen'],
    ['self_order', 'hudChrome.commissionBoard.denySelfOrder'],
    ['not_eligible_crafter', 'hudChrome.commissionBoard.denyNotEligibleCrafter'],
    ['not_your_order', 'hudChrome.commissionBoard.denyNotYourOrder'],
    ['order_not_accepted', 'hudChrome.commissionBoard.denyOrderNotAccepted'],
    ['not_your_acceptance', 'hudChrome.commissionBoard.denyNotYourAcceptance'],
    ['not_crafted', 'hudChrome.commissionBoard.denyNotCrafted'],
    ['deliver_out_of_range', 'hudChrome.commissionBoard.denyOutOfRange'],
    ['no_space', 'hudChrome.commissionBoard.denyNoSpace'],
  ];

  it.each(DENIALS)('denial %s renders %s with no params, in the deny tone', (reason, key) => {
    expect(
      commissionOrderResultLine({ action: 'accept', ok: false, itemId: 'copper_ore', reason }),
    ).toEqual({ key, params: {}, tone: PROF_LOG_DENY });
    expect(hasTranslation(key)).toBe(true);
  });

  it('the hand-written denial list covers the WHOLE reason union', () => {
    const listed = DENIALS.map(([reason]) => reason).sort();
    const union: CommissionOrderDenyReason[] = [
      'unknown_recipe',
      'not_commission_eligible',
      'unknown_crafter',
      'self_crafter',
      'too_many_open',
      'unknown_order',
      'order_not_open',
      'self_order',
      'not_eligible_crafter',
      'not_your_order',
      'order_not_accepted',
      'not_your_acceptance',
      'not_crafted',
      'deliver_out_of_range',
      'no_space',
    ];
    expect(listed).toEqual(union.slice().sort());
  });

  it('a deny with no reason resolves to null (the historical no-op)', () => {
    expect(
      commissionOrderResultLine({ action: 'open', ok: false, itemId: 'copper_ore' }),
    ).toBeNull();
  });

  it('an off-vocabulary reason (a widened wire) falls back to denyNoSpace, the historical ternary fallback', () => {
    const widened = {
      action: 'accept',
      ok: false,
      itemId: 'copper_ore',
      reason: 'lunar_eclipse',
    } as unknown as Parameters<typeof commissionOrderResultLine>[0];
    expect(commissionOrderResultLine(widened)).toEqual({
      key: 'hudChrome.commissionBoard.denyNoSpace',
      params: {},
      tone: PROF_LOG_DENY,
    });
  });

  it('a reason string colliding with an Object.prototype member falls back to denyNoSpace rather than resolving the inherited member', () => {
    const malformed = {
      action: 'accept',
      ok: false,
      itemId: 'copper_ore',
      reason: 'toString',
    } as unknown as Parameters<typeof commissionOrderResultLine>[0];
    expect(commissionOrderResultLine(malformed)).toEqual({
      key: 'hudChrome.commissionBoard.denyNoSpace',
      params: {},
      tone: PROF_LOG_DENY,
    });
  });
});
