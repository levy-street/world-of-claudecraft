import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { emitReferralBossEvidence, emitReferralQuestEvidence } from '../src/sim/referral_evidence';
import { referralRewardState } from '../src/sim/referral_reward_state';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

function world() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const a = sim.addPlayer('warrior', 'One', { characterId: 11 });
  const b = sim.addPlayer('priest', 'Two', { characterId: 22 });
  sim.meta(a)!.accountId = 1;
  sim.meta(b)!.accountId = 2;
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  return { sim, a, b, ctx: (sim as unknown as { ctx: SimContext }).ctx };
}
describe('authoritative referral evidence', () => {
  it('party joins capture stable identities, and disband captures loss of party', () => {
    const { sim, a, b } = world();
    const joined = sim.events.find((e) => e.type === 'referralEvidence');
    expect(joined).toMatchObject({
      kind: 'party',
      participants: [
        { accountId: 1, characterId: 11 },
        { accountId: 2, characterId: 22 },
      ],
    });
    sim.partyLeave(b);
    const left = sim.events.filter((e) => e.type === 'referralEvidence').at(-1);
    expect(left).toMatchObject({
      kind: 'party',
      participants: expect.arrayContaining([
        {
          pid: a,
          accountId: 1,
          characterId: 11,
          name: 'One',
          level: 1,
          completedQuestIds: [],
          partyId: null,
        },
      ]),
    });
  });
  it('the real quest reward core emits evidence after recording completion', () => {
    const { sim, a, ctx } = world();
    const meta = sim.meta(a)!;
    const questId = 'q_ps_set_sail';
    meta.questLog.set(questId, { questId, state: 'ready', counts: [1] });
    expect(turnInQuestCore(ctx, questId, QUESTS[questId], meta)).toBe(true);
    expect(
      sim.events.find((e) => e.type === 'referralEvidence' && e.kind === 'quest'),
    ).toMatchObject({
      characterId: 11,
      questId,
      participants: [{ completedQuestIds: [questId] }, {}],
    });
  });
  it('quest evidence preserves completion and party at the event time', () => {
    const { sim, a, b, ctx } = world();
    sim.meta(a)!.questsDone.add('q_hollow');
    emitReferralQuestEvidence(ctx, sim.meta(a)!, 'q_hollow');
    const evidence = sim.events.filter((e) => e.type === 'referralEvidence').at(-1);
    sim.meta(a)!.questsDone.clear();
    sim.partyLeave(b);
    expect(evidence).toMatchObject({
      kind: 'quest',
      characterId: 11,
      questId: 'q_hollow',
      participants: [
        { completedQuestIds: ['q_hollow'], partyId: expect.any(Number) },
        { partyId: expect.any(Number) },
      ],
    });
  });
  it('only eligible recipients receive authored boss evidence', () => {
    const { sim, a, ctx } = world();
    sim.events.length = 0;
    emitReferralBossEvidence(ctx, { templateId: 'morthen', dungeonId: 'hollow_crypt' } as Entity, [
      sim.meta(a)!,
    ]);
    expect(sim.events).toMatchObject([
      { kind: 'boss', dungeonId: 'hollow_crypt', participants: [{ characterId: 11 }] },
    ]);
    sim.events.length = 0;
    emitReferralBossEvidence(ctx, { templateId: 'boar', dungeonId: 'hollow_crypt' } as Entity, [
      sim.meta(a)!,
    ]);
    expect(sim.events).toEqual([]);
  });
  it('sanitizes and detaches persisted reward receipts', () => {
    const input = {
      referralRewards: { '7': { redeemed: 3 }, bad: { redeemed: 31 }, '8': { redeemed: 99 } },
      referralInviterRewards: 3,
    };
    const result = referralRewardState(input);
    input.referralRewards['7'].redeemed = 31;
    expect(result).toEqual({
      referralRewards: { '7': { redeemed: 3 } },
      referralInviterRewards: 3,
    });
  });
});
