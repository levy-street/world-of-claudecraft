import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import {
  createReferralCard,
  creditReferralCard,
  REFERRAL_MILESTONES,
  type ReferralCardCommand,
  type ReferralCardContext,
  type ReferralCardState,
  type ReferralMilestone,
  referralNextMilestone,
  referralStartError,
  transitionReferralCard,
} from '../src/sim/referral_cards';

function context(): ReferralCardContext {
  return {
    characters: [
      { accountId: 10, characterId: 101, name: 'A', level: 1, partyId: 7, completedQuestIds: [] },
      { accountId: 20, characterId: 202, name: 'B', level: 1, partyId: 7, completedQuestIds: [] },
    ],
  };
}

type WithoutRevision<T> = T extends unknown ? Omit<T, 'expectedRevision'> : never;

function command(
  state: ReferralCardState,
  input: WithoutRevision<ReferralCardCommand>,
  ctx = context(),
) {
  return transitionReferralCard(state, { ...input, expectedRevision: state.revision }, ctx);
}

function active(ctx = context()): ReferralCardState {
  let state = command(createReferralCard(1, 10, 20), { type: 'start', accountId: 10 }, ctx).state;
  state = command(state, { type: 'respond', accountId: 10, accept: true }, ctx).state;
  return command(state, { type: 'respond', accountId: 20, accept: true }, ctx).state;
}

function earned(): ReferralCardState {
  const state = active();
  for (const participant of state.participants) participant.credited = 31;
  return state;
}

function claim(
  state: ReferralCardState,
  milestone: ReferralMilestone,
  accountId = 20,
  confirmation?: 'understand' | 'confirm',
) {
  return command(state, { type: 'redeem', accountId, milestone, confirmation });
}

function beforeFogbinder(): ReferralCardState {
  return claim(claim(earned(), 'tutorial').state, 'hollow').state;
}

describe('referral card enrollment', () => {
  it('pins milestone quests to authored content without inventing a tutorial dungeon', () => {
    expect(REFERRAL_MILESTONES.map((m) => m.questId && QUESTS[m.questId].name)).toEqual([
      'Set Sail',
      'Into the Hollow',
      'The Fogbinder',
      'Korzul the Gravewyrm',
      null,
    ]);
    expect(REFERRAL_MILESTONES[0].dungeonId).toBeNull();
  });
  it('recovers tutorial credit on the assigned pair reunion only after both completed it', () => {
    const ctx = context();
    const card = active(ctx);
    ctx.characters[0].completedQuestIds = ['q_ps_set_sail'];
    expect(creditReferralCard(card, { type: 'partyReunion' }, ctx).state).toBe(card);
    ctx.characters[1].completedQuestIds = ['q_ps_set_sail'];
    const credited = creditReferralCard(card, { type: 'partyReunion' }, ctx);
    expect(credited.state.participants.map((p) => p.credited)).toEqual([1, 1]);
    expect(creditReferralCard(credited.state, { type: 'partyReunion' }, ctx).state).toBe(
      credited.state,
    );
    ctx.characters[1].partyId = null;
    expect(creditReferralCard(card, { type: 'partyReunion' }, ctx).error).toBe('notTogether');
    ctx.characters[1].partyId = 7;
    ctx.characters[1].characterId = 303;
    expect(creditReferralCard(card, { type: 'partyReunion' }, ctx).error).toBe('wrongCharacter');
  });

  it('requires two current acceptances and rejects stale responses without changing state', () => {
    const initial = createReferralCard(1, 10, 20);
    const pending = command(initial, { type: 'start', accountId: 10 }).state;
    expect(pending.status).toBe('pending');
    expect(pending.accepted).toEqual([false, false]);
    const first = command(pending, { type: 'respond', accountId: 10, accept: true }).state;
    expect(first.status).toBe('pending');
    const stale = transitionReferralCard(
      first,
      {
        type: 'respond',
        accountId: 20,
        accept: true,
        expectedRevision: pending.revision,
      },
      context(),
    );
    expect(stale).toEqual({ state: first, intents: [], error: 'staleRevision' });
    expect(command(first, { type: 'respond', accountId: 10, accept: true }).state).toBe(first);
    const second = command(first, { type: 'respond', accountId: 20, accept: true }).state;
    expect(second.status).toBe('active');
    expect(second.participants.map((p) => p.characterId)).toEqual([101, 202]);
    expect(initial.participants.map((p) => p.characterId)).toEqual([null, null]);
  });

  it.each([0, 1])('checks fresh character eligibility for participant %i', (index) => {
    const state = createReferralCard(1, 10, 20);
    const ctx = context();
    ctx.characters[index].level = 5;
    expect(referralStartError(state, ctx)).toBe('levelTooHigh');
    ctx.characters[index].level = 4;
    ctx.characters[index].completedQuestIds = ['q_ps_set_sail'];
    expect(referralStartError(state, ctx)).toBe('tutorialCompleted');
    ctx.characters[index].completedQuestIds = [];
    expect(referralStartError(state, ctx)).toBeUndefined();
  });

  it('rechecks party, assignment, and eligibility when the second player accepts', () => {
    let state = command(createReferralCard(1, 10, 20), { type: 'start', accountId: 10 }).state;
    state = command(state, { type: 'respond', accountId: 10, accept: true }).state;
    const ctx = context();
    const accept = { type: 'respond', accountId: 20, accept: true } as const;
    ctx.characters[1].partyId = null;
    expect(command(state, accept, ctx).error).toBe('notTogether');
    ctx.characters[1].partyId = 8;
    expect(command(state, accept, ctx).error).toBe('notTogether');
    ctx.characters[1].partyId = 7;
    ctx.characters[1].characterId = 203;
    expect(command(state, accept, ctx).error).toBe('wrongCharacter');
    ctx.characters[1].characterId = 202;
    ctx.characters[1].level = 5;
    expect(command(state, accept, ctx).error).toBe('levelTooHigh');
  });

  it('confirms decline, blocks the other acceptance, and allows a later manual retry', () => {
    const pending = command(createReferralCard(1, 10, 20), { type: 'start', accountId: 10 }).state;
    const decline = { type: 'respond', accountId: 20, accept: false } as const;
    expect(command(pending, { ...decline, confirmDecline: true }).error).toBe(
      'declineNotConfirmed',
    );
    const first = command(pending, decline).state;
    expect(first.status).toBe('pending');
    expect(first.declineAccountId).toBe(20);
    expect(command(first, { type: 'respond', accountId: 10, accept: true }).error).toBe(
      'declinePending',
    );
    const declined = command(first, { ...decline, confirmDecline: true }).state;
    expect(declined.status).toBe('idle');
    expect(declined.declined).toBe(true);
    expect(declined.participants.map((p) => p.characterId)).toEqual([null, null]);
    const retry = command(declined, { type: 'start', accountId: 10 }).state;
    expect(retry.status).toBe('pending');
    expect(retry.accepted).toEqual([false, false]);
    expect(retry.declined).toBe(false);
  });

  it('lets the declining player change their mind and prevents another enrollment', () => {
    let state = command(createReferralCard(1, 10, 20), { type: 'start', accountId: 10 }).state;
    state = command(state, { type: 'respond', accountId: 20, accept: false }).state;
    state = command(state, { type: 'respond', accountId: 20, accept: true }).state;
    expect(state.declineAccountId).toBeUndefined();
    expect(state.accepted).toEqual([false, true]);
    expect(command(state, { type: 'start', accountId: 10 }).error).toBe('alreadyStarted');
    expect(command(active(), { type: 'start', accountId: 20 }).error).toBe('alreadyStarted');
  });

  it('rejects a third account, reversed ownership, or invalid link identity', () => {
    const state = createReferralCard(1, 10, 20);
    expect(command(state, { type: 'start', accountId: 30 }).error).toBe('notParticipant');
    const ctx = context();
    ctx.characters[0].accountId = 20;
    expect(command(state, { type: 'start', accountId: 10 }, ctx).error).toBe('invalidCharacters');
    expect(() => createReferralCard(1, 10, 10)).toThrow('Invalid referral link identity');
  });
});

describe('referral card milestone evidence', () => {
  it('credits personal turn-ins, both separately, with no duplicate revision or reward', () => {
    const ctx = context();
    const original = active();
    ctx.characters[0].completedQuestIds = ['q_ps_set_sail'];
    const event = { type: 'questTurnIn', characterId: 101, questId: 'q_ps_set_sail' } as const;
    const credited = creditReferralCard(original, event, ctx);
    expect(credited.state.participants.map((p) => p.credited)).toEqual([1, 0]);
    expect(credited.intents).toEqual([]);
    expect(creditReferralCard(credited.state, event, ctx).state).toBe(credited.state);
    ctx.characters[1].completedQuestIds = ['q_ps_set_sail'];
    expect(
      creditReferralCard(
        credited.state,
        { ...event, characterId: 202 },
        ctx,
      ).state.participants.map((p) => p.credited),
    ).toEqual([1, 1]);
    expect(original.participants[0].credited).toBe(0);
  });

  it('rejects forged completion, unassigned characters, and solo turn-ins', () => {
    const state = active();
    const ctx = context();
    const event = { type: 'questTurnIn', characterId: 101, questId: 'q_hollow' } as const;
    expect(creditReferralCard(state, event, ctx).state).toBe(state);
    ctx.characters[0].completedQuestIds = ['q_hollow'];
    expect(creditReferralCard(state, { ...event, characterId: 999 }, ctx).state).toBe(state);
    ctx.characters[1].partyId = 8;
    expect(creditReferralCard(state, event, ctx).error).toBe('notTogether');
    ctx.characters[1].partyId = 7;
    ctx.characters[1].characterId = 303;
    expect(creditReferralCard(state, event, ctx).error).toBe('wrongCharacter');
  });

  it('catches up solo dungeon quests only on the matching shared clear with both eligible', () => {
    const state = active();
    const ctx = context();
    ctx.characters[0].completedQuestIds = ['q_hollow', 'q_ps_set_sail'];
    const event = {
      type: 'dungeonClear',
      dungeonId: 'hollow_crypt',
      eligibleCharacterIds: [101, 202],
    } as const;
    expect(creditReferralCard(state, { ...event, eligibleCharacterIds: [101] }, ctx).state).toBe(
      state,
    );
    expect(creditReferralCard(state, { ...event, dungeonId: 'sunken_bastion' }, ctx).state).toBe(
      state,
    );
    const credited = creditReferralCard(state, event, ctx).state;
    expect(credited.participants.map((p) => p.credited)).toEqual([2, 0]);
    expect(referralNextMilestone(credited.participants[0])).toBe('tutorial');
    ctx.characters[1].completedQuestIds = ['q_hollow'];
    expect(
      creditReferralCard(credited, event, ctx).state.participants.map((p) => p.credited),
    ).toEqual([2, 2]);
  });

  it.each([
    ['nythraxis_boss_arena_normal', 'nythraxis_scourge_of_thornpeak'],
    ['nythraxis_boss_arena_heroic', 'nythraxis_scourge_of_thornpeak'],
    ['ignivar_raid_arena_normal', 'ignivar_herald_of_the_last_flame'],
    ['ignivar_raid_arena_heroic', 'varkhul_forgefather_of_the_last_flame'],
  ])('credits a real raid encounter %s/%s to both eligible characters', (activityId, mobId) => {
    const state = active();
    const event = {
      type: 'raidBossKill',
      activityId,
      mobId,
      eligibleCharacterIds: [101, 202],
    } as const;
    expect(
      creditReferralCard(state, event, context()).state.participants.map((p) => p.credited),
    ).toEqual([16, 16]);
    expect(
      creditReferralCard(state, { ...event, eligibleCharacterIds: [101] }, context()).state,
    ).toBe(state);
  });

  it('does not treat a dungeon boss, raid trash, or unknown activity as a raid milestone', () => {
    const state = active();
    for (const [activityId, mobId] of [
      ['hollow_crypt_normal', 'morthen'],
      ['nythraxis_boss_arena_normal', 'nythraxis_skeleton_warrior'],
      ['unknown', 'nythraxis_scourge_of_thornpeak'],
    ]) {
      expect(
        creditReferralCard(
          state,
          { type: 'raidBossKill', activityId, mobId, eligibleCharacterIds: [101, 202] },
          context(),
        ).state,
      ).toBe(state);
    }
  });
});

describe('referral rewards, lock confirmation, and character movement', () => {
  it('requires milestone order and produces exactly one grant candidate with a stable key', () => {
    const state = earned();
    expect(claim(state, 'raid').error).toBe('previousRewardRequired');
    const first = claim(state, 'tutorial');
    expect(first.intents).toEqual([
      {
        type: 'grant',
        key: 'referral:1:20:tutorial',
        accountId: 20,
        characterId: 202,
        milestone: 'tutorial',
      },
    ]);
    expect(state.participants[1].redeemed).toBe(0);
    expect(claim(state, 'tutorial').intents).toEqual(first.intents);
    expect(claim(first.state, 'tutorial').intents).toEqual([]);
    expect(claim(first.state, 'tutorial').error).toBe('alreadyRedeemed');
    expect(claim(active(), 'tutorial').error).toBe('notEarned');
  });

  it('requires both Fogbinder warnings and binds acknowledgement to the latest revision', () => {
    const state = beforeFogbinder();
    expect(claim(state, 'fogbinder', 20, 'confirm').error).toBe('confirmationRequired');
    const warning = claim(state, 'fogbinder');
    expect(warning.state.lockConfirmation?.stage).toBe(1);
    expect(warning.intents).toEqual([]);
    expect(claim(warning.state, 'fogbinder', 20, 'confirm').error).toBe('confirmationRequired');
    const understood = claim(warning.state, 'fogbinder', 20, 'understand');
    expect(understood.state.lockConfirmation?.stage).toBe(2);
    expect(understood.state.participants[1].locked).toBe(false);
    const locked = claim(understood.state, 'fogbinder', 20, 'confirm');
    expect(locked.intents).toHaveLength(1);
    expect(locked.state.participants[1].redeemed).toBe(7);
    expect(locked.state.participants[1].locked).toBe(true);
    expect(locked.state.participants[0].locked).toBe(false);
    expect(locked.state.lockConfirmation).toBeUndefined();
    const changed = claim(understood.state, 'tutorial', 10).state;
    expect(claim(changed, 'fogbinder', 20, 'confirm').error).toBe('confirmationRequired');
  });

  it('moves one participant with preserved credit and reward provenance, invalidating old confirmations', () => {
    const state = claim(beforeFogbinder(), 'fogbinder').state;
    const ctx = context();
    ctx.characters[1].characterId = 203;
    ctx.characters[1].name = 'Replacement';
    const moved = command(state, { type: 'move', accountId: 20, characterId: 203 }, ctx);
    expect(moved.state.participants[1]).toEqual({
      ...state.participants[1],
      characterId: 203,
      characterName: 'Replacement',
    });
    expect(moved.state.participants[0]).toEqual(state.participants[0]);
    expect(moved.state.lockConfirmation).toBeUndefined();
    expect(moved.intents).toEqual([
      {
        type: 'move',
        key: `referral:1:20:move:${moved.state.revision}`,
        accountId: 20,
        fromCharacterId: 202,
        toCharacterId: 203,
        redeemed: 3,
      },
    ]);
    expect(command(moved.state, { type: 'move', accountId: 20, characterId: 203 }, ctx).error).toBe(
      'sameCharacter',
    );
    expect(claim(moved.state, 'fogbinder').error).toBe('wrongCharacter');
    expect(state.participants[1].characterId).toBe(202);
  });

  it('enforces move eligibility and blocks moving only the locked participant', () => {
    let state = claim(beforeFogbinder(), 'fogbinder').state;
    state = claim(state, 'fogbinder', 20, 'understand').state;
    state = claim(state, 'fogbinder', 20, 'confirm').state;
    const ctx = context();
    ctx.characters[1].characterId = 203;
    expect(command(state, { type: 'move', accountId: 20, characterId: 203 }, ctx).error).toBe(
      'locked',
    );
    ctx.characters[1].characterId = 202;
    ctx.characters[0].characterId = 102;
    ctx.characters[0].level = 5;
    const move = { type: 'move', accountId: 10, characterId: 102 } as const;
    expect(command(state, move, ctx).error).toBe('levelTooHigh');
    ctx.characters[0].level = 1;
    ctx.characters[0].completedQuestIds = ['q_ps_set_sail'];
    expect(command(state, move, ctx).error).toBe('tutorialCompleted');
    ctx.characters[0].completedQuestIds = [];
    ctx.characters[0].partyId = null;
    expect(command(state, move, ctx).error).toBe('notTogether');
    ctx.characters[0].partyId = 7;
    expect(command(state, move, ctx).error).toBeUndefined();
  });
  it('lets both bound players move sequentially when they reroll together', () => {
    const state = active();
    const ctx = context();
    ctx.characters[0].characterId = 303;
    ctx.characters[1].characterId = 404;
    const first = command(state, { type: 'move', accountId: 10, characterId: 303 }, ctx);
    expect(first.error).toBeUndefined();
    expect(creditReferralCard(first.state, { type: 'partyReunion' }, ctx).error).toBe(
      'wrongCharacter',
    );
    const second = command(first.state, { type: 'move', accountId: 20, characterId: 404 }, ctx);
    expect(second.error).toBeUndefined();
    expect(second.state.participants.map((p) => p.characterId)).toEqual([303, 404]);
  });

  it('counts invitee completion once even when the inviter has not redeemed any rewards', () => {
    let state = claim(beforeFogbinder(), 'fogbinder').state;
    state = claim(state, 'fogbinder', 20, 'understand').state;
    state = claim(state, 'fogbinder', 20, 'confirm').state;
    state = claim(state, 'gravewyrm').state;
    const completion = claim(state, 'raid');
    expect(completion.state.participants.map((p) => p.redeemed)).toEqual([0, 31]);
    expect(referralNextMilestone(completion.state.participants[1])).toBeNull();
    expect(completion.intents[1]).toEqual({
      type: 'friendCompleted',
      key: 'referral:1:completed',
      inviterAccountId: 10,
      inviteeAccountId: 20,
    });
    expect(claim(completion.state, 'raid').intents).toEqual([]);
  });

  it('keeps two link cards on the same character independent', () => {
    const first = earned();
    const second = { ...earned(), linkId: 2 };
    const a = claim(first, 'tutorial');
    const b = claim(second, 'tutorial');
    expect(a.intents[0]).not.toEqual(b.intents[0]);
    expect(a.state.participants[1].characterId).toBe(b.state.participants[1].characterId);
    expect(second.participants[1].redeemed).toBe(0);
  });
});
