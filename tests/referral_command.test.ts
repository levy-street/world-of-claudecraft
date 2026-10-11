import { describe, expect, it } from 'vitest';
import { decodeReferralAction } from '../server/referral_command';

describe('referral command authority boundary', () => {
  it('copies only the action contract and excludes forged authority and evidence', () => {
    expect(
      decodeReferralAction({
        type: 'redeem',
        linkId: 3,
        expectedRevision: 2,
        milestone: 'tutorial',
        accountId: 8,
        credited: 31,
        participants: [],
        reward: 'gold',
      }),
    ).toEqual({
      type: 'redeem',
      linkId: 3,
      expectedRevision: 2,
      milestone: 'tutorial',
    });
  });
  it.each([
    null,
    [],
    { type: 'redeem', linkId: 3, expectedRevision: 2, milestone: 'gold' },
    { type: 'move', linkId: 3, expectedRevision: 2, characterId: -1 },
    { type: 'respond', linkId: 3, expectedRevision: 2, accept: 'true' },
    { type: 'page', after: Number.MAX_SAFE_INTEGER },
    { type: 'answerSummon', requestId: 'x'.repeat(129), accept: true },
    {
      type: 'redeem',
      linkId: 3,
      expectedRevision: 2,
      milestone: 'fogbinder',
      confirmation: 'skip',
    },
  ])('rejects malformed actions', (value) => expect(decodeReferralAction(value)).toBeNull());
  it('accepts durable completion notice acknowledgements but rejects malformed count tokens', () => {
    expect(decodeReferralAction({ type: 'acknowledgeNotice', noticeId: 'completed:5' })).toEqual({
      type: 'acknowledgeNotice',
      noticeId: 'completed:5',
    });
    for (const noticeId of [
      'completed:0',
      'completed:-1',
      'completed:1:2',
      'completed:' + '1'.repeat(11),
    ]) {
      expect(decodeReferralAction({ type: 'acknowledgeNotice', noticeId })).toBeNull();
    }
  });
  it('accepts the two exact lock acknowledgements', () => {
    for (const confirmation of ['understand', 'confirm']) {
      expect(
        decodeReferralAction({
          type: 'redeem',
          linkId: 3,
          expectedRevision: 2,
          milestone: 'fogbinder',
          confirmation,
        }),
      ).not.toBeNull();
    }
  });
});
