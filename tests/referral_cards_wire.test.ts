import { describe, expect, it } from 'vitest';
import { decodeReferralCardsSnapshot } from '../src/net/referral_cards_wire';
import { createReferralCard } from '../src/sim/referral_cards';
import type { ReferralCardsSnapshot } from '../src/sim/referral_contract';

const snapshot = (): ReferralCardsSnapshot => ({
  revision: 1,
  accountId: 1,
  characterId: 11,
  characterName: 'Player',
  inviteUrl: 'https://example.test/?ref=one',
  links: [
    {
      card: createReferralCard(7, 1, 2),
      friendName: 'Friend',
      canMove: false,
      summonRemainingSeconds: 0,
    },
  ],
  completedFriends: 0,
  rewardedTiers: [],
  notices: [],
});
describe('referral cards snapshot decoder', () => {
  it('decodes and isolates valid two-participant cards', () => {
    const wire = snapshot();
    const decoded = decodeReferralCardsSnapshot(wire);
    expect(decoded).toEqual(wire);
    wire.links[0].card.participants[0].credited = 1;
    expect(decoded?.links[0].card.participants[0].credited).toBe(0);
  });
  it.each([
    null,
    {},
    { ...snapshot(), revision: NaN },
    { ...snapshot(), links: Array(51).fill(snapshot().links[0]) },
    { ...snapshot(), inviteUrl: 'javascript:alert(1)' },
    { ...snapshot(), notices: [{ id: 'n', type: 'reason', reason: 'future' }] },
  ])('rejects malformed boundaries without throwing', (value) => {
    expect(decodeReferralCardsSnapshot(value)).toBeNull();
  });
  it('refuses another account card or impossible reward masks', () => {
    const wrong = snapshot();
    wrong.accountId = 3;
    expect(decodeReferralCardsSnapshot(wrong)).toBeNull();
    const invalid = snapshot();
    invalid.links[0].card.participants[0].redeemed = 4;
    expect(decodeReferralCardsSnapshot(invalid)).toBeNull();
  });
});
