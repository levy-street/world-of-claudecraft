import { REFERRAL_MILESTONES, type ReferralMilestone } from '../../../sim/referral_cards';
import { referralOwnParticipant } from './referral_cards_view';
import type { ReferralCardsSnapshot, ReferralLinkSnapshot } from './types';

export interface ReferralRewardClaim {
  accountId: number;
  characterId: number;
  linkId: number;
  revision: number;
  milestone: ReferralMilestone;
  friendName: string;
}

/** Only locally requested claims can celebrate. Server state alone is never an award event. */
export class ReferralRewardClaims {
  private pending = new Map<number, ReferralRewardClaim>();

  request(
    snapshot: ReferralCardsSnapshot,
    link: ReferralLinkSnapshot,
    milestone: ReferralMilestone,
  ): void {
    const own = referralOwnParticipant(link, snapshot.accountId);
    const index = REFERRAL_MILESTONES.findIndex((row) => row.id === milestone);
    if (index < 0 || own?.characterId !== snapshot.characterId || own.redeemed & (1 << index))
      return;
    this.pending.set(link.card.linkId, {
      accountId: snapshot.accountId,
      characterId: snapshot.characterId,
      linkId: link.card.linkId,
      revision: link.card.revision,
      milestone,
      friendName: link.friendName,
    });
  }

  observe(snapshot: ReferralCardsSnapshot | null): ReferralRewardClaim[] {
    const rewards: ReferralRewardClaim[] = [];
    if (!snapshot) {
      this.clear();
      return rewards;
    }
    for (const [linkId, claim] of this.pending) {
      const link = snapshot.links.find((row) => row.card.linkId === linkId);
      const own = link && referralOwnParticipant(link, snapshot.accountId);
      if (
        claim.accountId !== snapshot.accountId ||
        claim.characterId !== snapshot.characterId ||
        own?.characterId !== claim.characterId
      ) {
        this.pending.delete(linkId);
        continue;
      }
      const index = REFERRAL_MILESTONES.findIndex((row) => row.id === claim.milestone);
      if (link!.card.revision > claim.revision && own.redeemed & (1 << index)) {
        rewards.push(claim);
        this.pending.delete(linkId);
      }
    }
    return rewards;
  }

  clear(): void {
    this.pending.clear();
  }
}
