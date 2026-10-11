import type { ReferralCardError, ReferralCardState, ReferralMilestone } from './referral_cards';

export type ReferralUiReason = ReferralCardError | 'newAccountsOnly' | 'unavailable';

/** Server-projected link data. Eligibility is explanatory; every action is revalidated. */
export interface ReferralLinkSnapshot {
  card: ReferralCardState;
  friendName: string;
  startReason?: ReferralUiReason;
  moveReason?: ReferralUiReason;
  canMove: boolean;
  summonRemainingSeconds: number;
  summonReason?: ReferralUiReason;
}

export type ReferralNotice =
  | { id: string; type: 'start' | 'move'; linkId: number }
  | { id: string; type: 'reason'; reason: ReferralUiReason }
  | { id: string; type: 'completed'; friendName: string }
  | { id: string; type: 'declined' }
  | { id: string; type: 'summon'; requestId: string; friendName: string };

export interface ReferralCardsSnapshot {
  /** Changes whenever any displayed value changes, including rounded cooldown seconds. */
  revision: number;
  accountId: number;
  characterId: number;
  characterName: string;
  inviteUrl: string | null;
  links: readonly ReferralLinkSnapshot[];
  /** Last link id in this bounded page; null when no next page exists. */
  nextCursor?: number | null;
  completedFriends: number;
  /** Authoritatively awarded referrer tiers; the UI never grants these itself. */
  rewardedTiers: readonly number[];
  /** Current character owns the tutorial title, independent of the links page. */
  titleOwned?: boolean;
  /** Current-character unclaimed stamps across all links, independent of pagination. */
  readyCount?: number;
  notices: readonly ReferralNotice[];
}

type LinkAction = { linkId: number; expectedRevision: number };
export type ReferralLinkActionPayload =
  | { type: 'start' }
  | { type: 'respond'; accept: boolean; confirmDecline?: boolean }
  | { type: 'move'; characterId: number }
  | {
      type: 'redeem';
      milestone: ReferralMilestone;
      confirmation?: 'understand' | 'confirm';
    }
  | { type: 'summon' };
export type ReferralCardsAction =
  | (LinkAction & ReferralLinkActionPayload)
  | { type: 'acknowledgeNotice'; noticeId: string }
  | { type: 'page'; after?: number }
  | { type: 'answerSummon'; requestId: string; accept: boolean };
