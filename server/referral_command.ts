import { REFERRAL_MILESTONES, type ReferralMilestone } from '../src/sim/referral_cards';
import type { ReferralCardsAction } from '../src/sim/referral_contract';

const integer = (value: unknown, min: number): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= 2_147_483_647;
const token = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Construct a fresh closed action. Client account, party, quest and reward
 * fields never cross this boundary, including unexpected spread properties. */
export function decodeReferralAction(value: unknown): ReferralCardsAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (action.type === 'page')
    return action.after === undefined
      ? { type: 'page' }
      : integer(action.after, 0)
        ? { type: 'page', after: action.after }
        : null;
  if (action.type === 'acknowledgeNotice')
    return token(action.noticeId) ||
      (typeof action.noticeId === 'string' && /^completed:[1-9][0-9]{0,9}$/.test(action.noticeId))
      ? { type: action.type, noticeId: action.noticeId }
      : null;
  if (action.type === 'answerSummon')
    return token(action.requestId) && typeof action.accept === 'boolean'
      ? { type: action.type, requestId: action.requestId, accept: action.accept }
      : null;
  if (!integer(action.linkId, 1) || !integer(action.expectedRevision, 0)) return null;
  const link = { linkId: action.linkId, expectedRevision: action.expectedRevision };
  switch (action.type) {
    case 'start':
    case 'summon':
      return { ...link, type: action.type };
    case 'move':
      return integer(action.characterId, 1)
        ? { ...link, type: 'move', characterId: action.characterId }
        : null;
    case 'respond':
      return typeof action.accept === 'boolean' &&
        (action.confirmDecline === undefined || typeof action.confirmDecline === 'boolean')
        ? {
            ...link,
            type: 'respond',
            accept: action.accept,
            ...(action.confirmDecline === undefined
              ? {}
              : { confirmDecline: action.confirmDecline }),
          }
        : null;
    case 'redeem':
      if (
        !REFERRAL_MILESTONES.some((m) => m.id === action.milestone) ||
        (action.confirmation !== undefined &&
          action.confirmation !== 'understand' &&
          action.confirmation !== 'confirm')
      )
        return null;
      return {
        ...link,
        type: 'redeem',
        milestone: action.milestone as ReferralMilestone,
        ...(action.confirmation === undefined ? {} : { confirmation: action.confirmation }),
      };
    default:
      return null;
  }
}
