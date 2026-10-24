import { finderActivity } from './content/dungeon_finder';

/** Stable keys and bit positions are persisted; append rather than reorder. */
export const REFERRAL_MILESTONES = [
  { id: 'tutorial', questId: 'q_ps_set_sail', dungeonId: null },
  { id: 'hollow', questId: 'q_hollow', dungeonId: 'hollow_crypt' },
  { id: 'fogbinder', questId: 'q_mistcaller', dungeonId: 'sunken_bastion' },
  { id: 'gravewyrm', questId: 'q_gravewyrm', dungeonId: 'gravewyrm_sanctum' },
  { id: 'raid', questId: null, dungeonId: null },
] as const;

export type ReferralMilestone = (typeof REFERRAL_MILESTONES)[number]['id'];
export interface ReferralCharacter {
  accountId: number;
  characterId: number;
  name: string;
  level: number;
  completedQuestIds: readonly string[];
  partyId: number | null;
}
export interface ReferralParticipant {
  accountId: number;
  characterId: number | null;
  characterName: string;
  credited: number;
  redeemed: number;
  locked: boolean;
}
export interface ReferralCardState {
  linkId: number;
  revision: number;
  status: 'idle' | 'pending' | 'active';
  /** Inviter first, invitee second. One enrollment per account link. */
  participants: [ReferralParticipant, ReferralParticipant];
  accepted: [boolean, boolean];
  /** Suppresses automatic prompts after a confirmed decline; manual start remains available. */
  declined: boolean;
  declineAccountId?: number;
  lockConfirmation?: { accountId: number; stage: 1 | 2; revision: number };
}
export interface ReferralCardContext {
  /** Trusted current characters in inviter/invitee order, never client-provided evidence. */
  characters: readonly [ReferralCharacter, ReferralCharacter];
}
export type ReferralCardCommand = { accountId: number; expectedRevision: number } & (
  | { type: 'start' }
  | { type: 'respond'; accept: boolean; confirmDecline?: boolean }
  | { type: 'move'; characterId: number }
  | { type: 'redeem'; milestone: ReferralMilestone; confirmation?: 'understand' | 'confirm' }
);
export type ReferralCardError =
  | 'notParticipant'
  | 'staleRevision'
  | 'invalidCharacters'
  | 'notTogether'
  | 'levelTooHigh'
  | 'tutorialCompleted'
  | 'alreadyStarted'
  | 'notPending'
  | 'declinePending'
  | 'declineNotConfirmed'
  | 'notActive'
  | 'wrongCharacter'
  | 'locked'
  | 'sameCharacter'
  | 'invalidMilestone'
  | 'notEarned'
  | 'alreadyRedeemed'
  | 'previousRewardRequired'
  | 'confirmationRequired';

/** A successful result is a transaction CANDIDATE, never proof that a reward was delivered.
 * The host atomically commits state with grants/removals under a revision CAS. It must retain
 * per-link reward provenance so moves remove only this link's rewards, including equipped or
 * banked items, without removing identical rewards earned on other cards. */
export type ReferralCardIntent =
  | {
      type: 'grant';
      key: string;
      accountId: number;
      characterId: number;
      milestone: ReferralMilestone;
    }
  | {
      type: 'move';
      key: string;
      accountId: number;
      fromCharacterId: number;
      toCharacterId: number;
      redeemed: number;
    }
  | { type: 'friendCompleted'; key: string; inviterAccountId: number; inviteeAccountId: number };
export interface ReferralCardResult {
  state: ReferralCardState;
  intents: ReferralCardIntent[];
  error?: ReferralCardError;
}
export type ReferralCardEvent =
  | { type: 'partyReunion' }
  | { type: 'questTurnIn'; characterId: number; questId: string }
  | { type: 'dungeonClear'; dungeonId: string; eligibleCharacterIds: readonly number[] }
  | {
      type: 'raidBossKill';
      activityId: string;
      mobId: string;
      eligibleCharacterIds: readonly number[];
    };

/** The caller must have already validated a new-account referral link, not a friend request. */
export function createReferralCard(
  linkId: number,
  inviterAccountId: number,
  inviteeAccountId: number,
): ReferralCardState {
  if (
    ![linkId, inviterAccountId, inviteeAccountId].every(
      (id) => Number.isSafeInteger(id) && id > 0,
    ) ||
    inviterAccountId === inviteeAccountId
  ) {
    throw new Error('Invalid referral link identity');
  }
  const participant = (accountId: number): ReferralParticipant => ({
    accountId,
    characterId: null,
    characterName: '',
    credited: 0,
    redeemed: 0,
    locked: false,
  });
  return {
    linkId,
    revision: 0,
    status: 'idle',
    participants: [participant(inviterAccountId), participant(inviteeAccountId)],
    accepted: [false, false],
    declined: false,
  };
}

function result(state: ReferralCardState, error?: ReferralCardError): ReferralCardResult {
  return { state, intents: [], ...(error ? { error } : {}) };
}

function revised(state: ReferralCardState): ReferralCardState {
  const next: ReferralCardState = {
    ...state,
    revision: state.revision + 1,
    participants: [{ ...state.participants[0] }, { ...state.participants[1] }],
    accepted: [...state.accepted],
  };
  // Any other state change invalidates an outstanding lock acknowledgement.
  delete next.lockConfirmation;
  return next;
}

function characterError(character: ReferralCharacter): ReferralCardError | undefined {
  if (!Number.isInteger(character.level) || character.level < 1 || character.level >= 5)
    return 'levelTooHigh';
  if (character.completedQuestIds.includes('q_ps_set_sail')) return 'tutorialCompleted';
  return undefined;
}

function contextError(
  state: ReferralCardState,
  context: ReferralCardContext,
): ReferralCardError | undefined {
  const [a, b] = context.characters;
  if (
    a.accountId !== state.participants[0].accountId ||
    b.accountId !== state.participants[1].accountId ||
    a.characterId === b.characterId ||
    ![a.characterId, b.characterId].every((id) => Number.isSafeInteger(id) && id > 0)
  )
    return 'invalidCharacters';
  return undefined;
}

function together(context: ReferralCardContext): boolean {
  const [a, b] = context.characters;
  return a.partyId !== null && a.partyId > 0 && a.partyId === b.partyId;
}

function assigned(state: ReferralCardState, context: ReferralCardContext): boolean {
  return state.participants.every((p, i) => p.characterId === context.characters[i].characterId);
}

/** Shared by party-entry explanations and explicit start; reports the first blocking reason. */
export function referralStartError(
  state: ReferralCardState,
  context: ReferralCardContext,
): ReferralCardError | undefined {
  if (state.status !== 'idle') return 'alreadyStarted';
  return (
    contextError(state, context) ??
    (!together(context) ? 'notTogether' : undefined) ??
    characterError(context.characters[0]) ??
    characterError(context.characters[1])
  );
}

/** The host authenticates command.accountId and serializes commands for this link. */
export function transitionReferralCard(
  state: ReferralCardState,
  command: ReferralCardCommand,
  context: ReferralCardContext,
): ReferralCardResult {
  const index = state.participants.findIndex((p) => p.accountId === command.accountId);
  if (index < 0) return result(state, 'notParticipant');
  if (command.expectedRevision !== state.revision) return result(state, 'staleRevision');
  const invalid = contextError(state, context);
  if (invalid) return result(state, invalid);

  if (command.type === 'start') {
    const error = referralStartError(state, context);
    if (error) return result(state, error);
    const next = revised(state);
    next.status = 'pending';
    next.declined = false;
    next.accepted = [false, false];
    delete next.declineAccountId;
    for (let i = 0; i < 2; i++) {
      next.participants[i].characterId = context.characters[i].characterId;
      next.participants[i].characterName = context.characters[i].name;
    }
    return result(next);
  }
  if (command.type === 'respond') return respond(state, command, context, index);
  if (state.status !== 'active') return result(state, 'notActive');
  if (command.type === 'move') return move(state, command, context, index);
  if (state.participants[index].characterId !== context.characters[index].characterId)
    return result(state, 'wrongCharacter');
  return redeem(state, command, index);
}

function respond(
  state: ReferralCardState,
  command: Extract<ReferralCardCommand, { type: 'respond' }>,
  context: ReferralCardContext,
  index: number,
): ReferralCardResult {
  if (state.status !== 'pending') return result(state, 'notPending');
  if (!assigned(state, context)) return result(state, 'wrongCharacter');
  if (!command.accept) {
    if (command.confirmDecline && state.declineAccountId !== command.accountId)
      return result(state, 'declineNotConfirmed');
    if (state.declineAccountId !== undefined && state.declineAccountId !== command.accountId)
      return result(state, 'declinePending');
    const next = revised(state);
    if (!command.confirmDecline) {
      next.declineAccountId = command.accountId;
      return result(next);
    }
    next.status = 'idle';
    next.declined = true;
    next.accepted = [false, false];
    delete next.declineAccountId;
    for (const p of next.participants) {
      p.characterId = null;
      p.characterName = '';
    }
    return result(next);
  }
  if (state.declineAccountId !== undefined && state.declineAccountId !== command.accountId)
    return result(state, 'declinePending');
  if (!together(context)) return result(state, 'notTogether');
  const error = characterError(context.characters[0]) ?? characterError(context.characters[1]);
  if (error) return result(state, error);
  if (state.accepted[index] && state.declineAccountId === undefined) return result(state);
  const next = revised(state);
  delete next.declineAccountId;
  next.accepted[index] = true;
  if (next.accepted.every(Boolean)) next.status = 'active';
  return result(next);
}

function move(
  state: ReferralCardState,
  command: Extract<ReferralCardCommand, { type: 'move' }>,
  context: ReferralCardContext,
  index: number,
): ReferralCardResult {
  const p = state.participants[index];
  if (p.locked) return result(state, 'locked');
  const character = context.characters[index];
  if (command.characterId !== character.characterId) return result(state, 'wrongCharacter');
  if (p.characterId === character.characterId) return result(state, 'sameCharacter');
  // Either bound account may arrive on a replacement character first. Requiring
  // the peer's old assignment here would deadlock two players rerolling together.
  // Milestone credit still requires both final assigned characters below.
  if (!together(context)) return result(state, 'notTogether');
  const error = characterError(character);
  if (error) return result(state, error);
  const next = revised(state);
  next.participants[index].characterId = character.characterId;
  next.participants[index].characterName = character.name;
  return {
    state: next,
    intents: [
      {
        type: 'move',
        key: `referral:${state.linkId}:${command.accountId}:move:${next.revision}`,
        accountId: command.accountId,
        fromCharacterId: p.characterId!,
        toCharacterId: character.characterId,
        redeemed: p.redeemed,
      },
    ],
  };
}

function redeem(
  state: ReferralCardState,
  command: Extract<ReferralCardCommand, { type: 'redeem' }>,
  index: number,
): ReferralCardResult {
  const position = REFERRAL_MILESTONES.findIndex((m) => m.id === command.milestone);
  if (position < 0) return result(state, 'invalidMilestone');
  const bit = 1 << position;
  const p = state.participants[index];
  if (p.redeemed & bit) return result(state, 'alreadyRedeemed');
  if (!(p.credited & bit)) return result(state, 'notEarned');
  if ((p.redeemed & (bit - 1)) !== bit - 1) return result(state, 'previousRewardRequired');
  const next = revised(state);
  if (command.milestone === 'fogbinder') {
    const pending = state.lockConfirmation;
    const valid = pending?.accountId === command.accountId && pending.revision === state.revision;
    if (!command.confirmation) {
      next.lockConfirmation = { accountId: command.accountId, stage: 1, revision: next.revision };
      return result(next);
    }
    if (!valid) return result(state, 'confirmationRequired');
    if (command.confirmation === 'understand' && pending.stage === 1) {
      next.lockConfirmation = { accountId: command.accountId, stage: 2, revision: next.revision };
      return result(next);
    }
    if (command.confirmation !== 'confirm' || pending.stage !== 2)
      return result(state, 'confirmationRequired');
    next.participants[index].locked = true;
  }
  next.participants[index].redeemed |= bit;
  const intents: ReferralCardIntent[] = [
    {
      type: 'grant',
      key: `referral:${state.linkId}:${command.accountId}:${command.milestone}`,
      accountId: command.accountId,
      characterId: p.characterId!,
      milestone: command.milestone,
    },
  ];
  if (index === 1 && next.participants[1].redeemed === (1 << REFERRAL_MILESTONES.length) - 1) {
    intents.push({
      type: 'friendCompleted',
      key: `referral:${state.linkId}:completed`,
      inviterAccountId: state.participants[0].accountId,
      inviteeAccountId: state.participants[1].accountId,
    });
  }
  return { state: next, intents };
}

/** Called only for authoritative successful turn-ins, dungeon clears, and eligible boss kills.
 * Each player's quest credit is personal. A later shared dungeon clear catches up a quest
 * they already turned in alone. Tutorial has no dungeon; the assigned pair's
 * reunion recovers its stamp once both have completed the final tutorial quest.
 * Raid evidence requires BOTH assigned characters to be eligible for that actual boss kill.
 * Credit may arrive out of order; redemption remains in milestone order. */
export function creditReferralCard(
  state: ReferralCardState,
  event: ReferralCardEvent,
  context: ReferralCardContext,
): ReferralCardResult {
  if (state.status !== 'active') return result(state, 'notActive');
  const invalid = contextError(state, context);
  if (invalid) return result(state, invalid);
  if (!assigned(state, context)) return result(state, 'wrongCharacter');
  if (!together(context)) return result(state, 'notTogether');
  let milestone = -1;
  if (event.type === 'questTurnIn') {
    milestone = REFERRAL_MILESTONES.findIndex((m) => m.questId === event.questId);
  } else if (event.type === 'partyReunion') {
    if (!context.characters.every((c) => c.completedQuestIds.includes('q_ps_set_sail')))
      return result(state);
    milestone = 0;
  } else {
    if (!context.characters.every((c) => event.eligibleCharacterIds.includes(c.characterId)))
      return result(state);
    if (event.type === 'dungeonClear') {
      milestone = REFERRAL_MILESTONES.findIndex((m) => m.dungeonId === event.dungeonId);
    } else {
      const activity = finderActivity(event.activityId);
      if (activity?.kind === 'raid' && activity.encounters.some((e) => e.mobId === event.mobId))
        milestone = 4;
    }
  }
  if (milestone < 0) return result(state);
  const bit = 1 << milestone;
  const questId = REFERRAL_MILESTONES[milestone].questId;
  const next = revised(state);
  for (let i = 0; i < 2; i++) {
    const character = context.characters[i];
    if (event.type === 'questTurnIn' && event.characterId !== character.characterId) continue;
    if (questId && !character.completedQuestIds.includes(questId)) continue;
    next.participants[i].credited |= bit;
  }
  if (next.participants.every((p, i) => p.credited === state.participants[i].credited))
    return result(state);
  return result(next);
}

export function referralNextMilestone(participant: ReferralParticipant): ReferralMilestone | null {
  return REFERRAL_MILESTONES.find((_, i) => !(participant.redeemed & (1 << i)))?.id ?? null;
}
