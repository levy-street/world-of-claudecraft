import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import { savedQuestProgress } from '../src/sim/quests/quest_progress_save';
import { Sim } from '../src/sim/sim';
import type { QuestProgress } from '../src/sim/types';

describe('character referral persistence', () => {
  it('loads an older character blob with no referral fields without granting entitlements', () => {
    const source = new Sim({ seed: 42, playerClass: 'warrior' });
    const state = source.serializeCharacter(source.player.id)!;
    delete state.referralRewards;
    delete state.referralInviterRewards;
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Legacy', { state });
    expect(restored.meta(pid)?.referralRewards).toBeUndefined();
    expect(restored.meta(pid)?.referralInviterRewards).toBeUndefined();
    expect(restored.serializeCharacter(pid)).not.toHaveProperty('referralRewards');
    expect(restored.serializeCharacter(pid)).not.toHaveProperty('referralInviterRewards');
  });

  it('discards invalid custody fields and detaches valid rows at the JSON boundary', () => {
    const source = new Sim({ seed: 42, playerClass: 'warrior' });
    const state = source.serializeCharacter(source.player.id)!;
    const malformed = {
      ...state,
      referralRewards: {
        '1': { redeemed: 3 },
        '0': { redeemed: 1 },
        '2': { redeemed: 32 },
        '3': null,
        bad: { redeemed: 1 },
      },
      referralInviterRewards: -1,
    } as unknown as CharacterState;
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Boundary', { state: malformed });
    expect(restored.meta(pid)?.referralRewards).toEqual({ '1': { redeemed: 3 } });
    expect(restored.meta(pid)?.referralInviterRewards).toBeUndefined();
    malformed.referralRewards!['1'].redeemed = 31;
    expect(restored.meta(pid)?.referralRewards).toEqual({ '1': { redeemed: 3 } });
  });

  it('round trips reward custody independently from account identity', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const meta = sim.meta(sim.player.id)!;
    meta.accountId = 7;
    meta.referralRewards = { '9': { redeemed: 3 } };
    meta.referralInviterRewards = 1;
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state).toMatchObject({
      referralRewards: { '9': { redeemed: 3 } },
      referralInviterRewards: 1,
    });
    meta.referralRewards['9'].redeemed = 7;
    expect(state.referralRewards?.['9'].redeemed).toBe(3);
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Reload', { state });
    expect(restored.meta(pid)?.referralRewards).toEqual({ '9': { redeemed: 3 } });
    expect(restored.meta(pid)?.accountId).toBeUndefined();
  });
  it('detaches all mutable quest progress without introducing absent keys', () => {
    const quest: QuestProgress = {
      questId: 'q_hollow',
      state: 'active',
      counts: [1],
      creditedObjects: ['a'],
      burnedObjects: [{ key: 'x', at: 2 }],
      resolvedCounts: [2],
    };
    const saved = savedQuestProgress({
      questLog: new Map([['q_hollow', quest]]),
      questsDone: new Set(['q_ps_set_sail']),
    });
    quest.counts[0] = 9;
    quest.burnedObjects![0].at = 3;
    quest.creditedObjects!.push('b');
    expect(saved.questLog[0]).toEqual({
      questId: 'q_hollow',
      state: 'active',
      counts: [1],
      creditedObjects: ['a'],
      burnedObjects: [{ key: 'x', at: 2 }],
      resolvedCounts: [2],
    });
    expect(saved.questsDone).toEqual(['q_ps_set_sail']);
    expect(saved.questLog[0]).not.toHaveProperty('selection');
  });
});
