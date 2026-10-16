import type { ReferralCardState, ReferralParticipant } from '../sim/referral_cards';
import type {
  ReferralCardsSnapshot,
  ReferralLinkSnapshot,
  ReferralNotice,
  ReferralUiReason,
} from '../sim/referral_contract';

const REASONS: readonly ReferralUiReason[] = [
  'notParticipant',
  'staleRevision',
  'invalidCharacters',
  'notTogether',
  'levelTooHigh',
  'tutorialCompleted',
  'alreadyStarted',
  'notPending',
  'declinePending',
  'declineNotConfirmed',
  'notActive',
  'wrongCharacter',
  'locked',
  'sameCharacter',
  'invalidMilestone',
  'notEarned',
  'alreadyRedeemed',
  'previousRewardRequired',
  'confirmationRequired',
  'newAccountsOnly',
  'unavailable',
];
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const reason = (v: unknown): v is ReferralUiReason => REASONS.includes(v as ReferralUiReason);
function participant(v: unknown): v is ReferralParticipant {
  return (
    record(v) &&
    integer(v.accountId, 1) &&
    (v.characterId === null || integer(v.characterId, 1)) &&
    text(v.characterName) &&
    integer(v.credited) &&
    v.credited <= 31 &&
    integer(v.redeemed) &&
    v.redeemed <= 31 &&
    (v.redeemed & v.credited) === v.redeemed &&
    typeof v.locked === 'boolean'
  );
}
function card(v: unknown): v is ReferralCardState {
  if (
    !record(v) ||
    !integer(v.linkId, 1) ||
    !integer(v.revision) ||
    !['idle', 'pending', 'active'].includes(v.status as string) ||
    typeof v.declined !== 'boolean' ||
    !Array.isArray(v.participants) ||
    v.participants.length !== 2 ||
    !v.participants.every(participant) ||
    v.participants[0].accountId === v.participants[1].accountId ||
    !Array.isArray(v.accepted) ||
    v.accepted.length !== 2 ||
    !v.accepted.every((a) => typeof a === 'boolean')
  )
    return false;
  if (
    v.declineAccountId !== undefined &&
    !v.participants.some((p) => p.accountId === v.declineAccountId)
  )
    return false;
  const lock = v.lockConfirmation;
  return (
    lock === undefined ||
    (record(lock) &&
      v.participants.some((p) => p.accountId === lock.accountId) &&
      (lock.stage === 1 || lock.stage === 2) &&
      integer(lock.revision))
  );
}
function link(v: unknown): v is ReferralLinkSnapshot {
  return (
    record(v) &&
    card(v.card) &&
    text(v.friendName) &&
    typeof v.canMove === 'boolean' &&
    typeof v.summonRemainingSeconds === 'number' &&
    Number.isFinite(v.summonRemainingSeconds) &&
    v.summonRemainingSeconds >= 0 &&
    ['startReason', 'moveReason', 'summonReason'].every((k) => v[k] === undefined || reason(v[k]))
  );
}
function notice(v: unknown): v is ReferralNotice {
  if (!record(v) || !text(v.id, 256) || v.id.length === 0) return false;
  switch (v.type) {
    case 'start':
    case 'move':
      return integer(v.linkId, 1);
    case 'reason':
      return reason(v.reason);
    case 'completed':
      return text(v.friendName);
    case 'declined':
      return true;
    case 'summon':
      return text(v.requestId, 256) && v.requestId.length > 0 && text(v.friendName);
    default:
      return false;
  }
}
/** A malformed or future incompatible frame never replaces the last valid snapshot. */
export function decodeReferralCardsSnapshot(value: unknown): ReferralCardsSnapshot | null {
  if (
    !record(value) ||
    !integer(value.revision) ||
    !integer(value.accountId, 1) ||
    !integer(value.characterId, 1) ||
    !text(value.characterName) ||
    !(
      value.inviteUrl === null ||
      (text(value.inviteUrl, 2048) && /^https?:\/\//.test(value.inviteUrl))
    ) ||
    !Array.isArray(value.links) ||
    value.links.length > 50 ||
    !value.links.every(link) ||
    !value.links.every((l) => l.card.participants.some((p) => p.accountId === value.accountId)) ||
    new Set(value.links.map((l) => l.card.linkId)).size !== value.links.length ||
    !integer(value.completedFriends) ||
    !Array.isArray(value.rewardedTiers) ||
    value.rewardedTiers.length > 5 ||
    !value.rewardedTiers.every((t) => integer(t, 1) && t <= 5) ||
    !Array.isArray(value.notices) ||
    value.notices.length > 50 ||
    !value.notices.every(notice) ||
    !(
      value.nextCursor === undefined ||
      value.nextCursor === null ||
      integer(value.nextCursor, 1)
    ) ||
    !(value.titleOwned === undefined || typeof value.titleOwned === 'boolean')
  )
    return null;
  // Copy so callers cannot mutate wire objects retained by a transport implementation.
  return structuredClone(value) as unknown as ReferralCardsSnapshot;
}
