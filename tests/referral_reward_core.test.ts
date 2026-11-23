import { describe, expect, it } from 'vitest';
import { createReferralCard } from '../src/sim/referral_cards';
import type { ReferralCardsSnapshot } from '../src/sim/referral_contract';
import { ReferralRewardClaims } from '../src/ui/hud/referral_cards/referral_reward_core';

function fixture() {
  const card = createReferralCard(8, 10, 20);
  card.status = 'active';
  Object.assign(card.participants[0], { characterId: 100, characterName: 'Aster', credited: 1 });
  const link = { card, friendName: 'Briar', canMove: false, summonRemainingSeconds: 0 };
  const snapshot: ReferralCardsSnapshot = {
    revision: 1,
    accountId: 10,
    characterId: 100,
    characterName: 'Aster',
    inviteUrl: null,
    links: [link],
    completedFriends: 0,
    rewardedTiers: [],
    notices: [],
  };
  return { card, link, snapshot, claims: new ReferralRewardClaims() };
}

describe('confirmed referral reward claims', () => {
  it('requires explicit local intent and a newer authoritative redeemed bit', () => {
    const f = fixture();
    expect(f.claims.observe(f.snapshot)).toEqual([]);
    f.claims.request(f.snapshot, f.link, 'tutorial');
    expect(f.claims.observe(f.snapshot)).toEqual([]);
    f.card.participants[0].redeemed = 1;
    expect(f.claims.observe(f.snapshot)).toEqual([]);
    f.card.revision++;
    expect(f.claims.observe(f.snapshot)).toEqual([
      expect.objectContaining({
        accountId: 10,
        characterId: 100,
        linkId: 8,
        milestone: 'tutorial',
      }),
    ]);
    expect(f.claims.observe(f.snapshot)).toEqual([]);
  });
  it.each(['account', 'character', 'assignment', 'missing', 'disconnect'] as const)(
    'discards pending requests after %s changes',
    (kind) => {
      const f = fixture();
      f.claims.request(f.snapshot, f.link, 'tutorial');
      if (kind === 'account') f.snapshot.accountId = 20;
      if (kind === 'character') f.snapshot.characterId = 101;
      if (kind === 'assignment') f.card.participants[0].characterId = 101;
      if (kind === 'missing') f.snapshot.links = [];
      expect(f.claims.observe(kind === 'disconnect' ? null : f.snapshot)).toEqual([]);
      f.snapshot.accountId = 10;
      f.snapshot.characterId = 100;
      f.snapshot.links = [f.link];
      f.card.participants[0].characterId = 100;
      f.card.participants[0].redeemed = 1;
      f.card.revision++;
      expect(f.claims.observe(f.snapshot)).toEqual([]);
    },
  );
  it('clear cancels failed requests, and already redeemed rewards cannot register again', () => {
    const f = fixture();
    f.claims.request(f.snapshot, f.link, 'tutorial');
    f.claims.clear();
    f.card.participants[0].redeemed = 1;
    f.card.revision++;
    f.claims.request(f.snapshot, f.link, 'tutorial');
    expect(f.claims.observe(f.snapshot)).toEqual([]);
  });
});
