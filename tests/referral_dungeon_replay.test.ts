import { describe, expect, it } from 'vitest';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  createReferralCard,
  creditReferralCard,
  type ReferralCardContext,
  transitionReferralCard,
} from '../src/sim/referral_cards';
import { referralParticipants } from '../src/sim/referral_evidence';
import { Sim } from '../src/sim/sim';

describe('referral catch-up through a real Gravewyrm clear', () => {
  it('emits final-boss evidence for eligible party members on an already completed quest', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'RecruitOne', { characterId: 101 });
    const b = sim.addPlayer('priest', 'RecruitTwo', { characterId: 202 });
    for (const [pid, accountId] of [
      [a, 11],
      [b, 22],
    ]) {
      const meta = sim.meta(pid)!;
      meta.accountId = accountId;
    }
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const characters = referralParticipants(sim.ctx, [a, b]);
    const enrollment: ReferralCardContext = { characters: [characters[0], characters[1]] };
    let card = createReferralCard(22, 11, 22);
    for (const command of [
      { type: 'start', accountId: 11 },
      { type: 'respond', accountId: 11, accept: true },
      { type: 'respond', accountId: 22, accept: true },
    ] as const) {
      const result = transitionReferralCard(
        card,
        { ...command, expectedRevision: card.revision },
        enrollment,
      );
      expect(result.error).toBeUndefined();
      card = result.state;
    }
    for (const pid of [a, b]) {
      sim.meta(pid)!.questsDone.add('q_sanctum_gate');
      sim.meta(pid)!.questsDone.add('q_gravewyrm');
      sim.setPlayerLevel(20, pid);
    }
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', a);
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', b);
    const instance = sim.instances.find(
      (slot) => slot.dungeonId === 'gravewyrm_sanctum' && slot.partyKey !== null,
    );
    expect(instance).toBeDefined();
    const boss = instance!.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === 'korzul_the_gravewyrm')!;
    expect(boss).toBeDefined();
    expect(boss.dungeonId).toBeNull();
    for (const pid of [a, b]) {
      const player = sim.entities.get(pid)!;
      player.pos = { ...boss.pos };
      player.prevPos = { ...player.pos };
      sim.rebucket(player);
    }
    sim.events.length = 0;
    sim.dealDamage(sim.entities.get(a)!, boss, 1_000_000_000, false, 'physical', null, 'hit');
    expect(boss.dead).toBe(true);
    expect(boss.lootRecipientIds).toEqual([a, b]);
    const evidence = sim.events.filter((event) => event.type === 'referralEvidence');
    expect(evidence).toMatchObject([
      {
        kind: 'boss',
        mobId: 'korzul_the_gravewyrm',
        dungeonId: 'gravewyrm_sanctum',
        participants: [
          { characterId: 101, completedQuestIds: ['q_gravewyrm'] },
          { characterId: 202, completedQuestIds: ['q_gravewyrm'] },
        ],
      },
    ]);
    const actual = evidence[0];
    if (!actual.dungeonId) throw new Error('real kill omitted its owning dungeon');
    const context: ReferralCardContext = {
      characters: [actual.participants[0], actual.participants[1]],
    };
    const clear = {
      type: 'dungeonClear' as const,
      dungeonId: actual.dungeonId,
      eligibleCharacterIds: actual.participants.map((p) => p.characterId),
    };
    const credited = creditReferralCard(card, clear, context);
    expect(credited.state.participants.map((p) => p.credited)).toEqual([8, 8]);
    expect(credited.intents).toEqual([]);
    const repeated = creditReferralCard(credited.state, clear, context);
    expect(repeated.state).toBe(credited.state);
    expect(repeated.intents).toEqual([]);
  });
});
