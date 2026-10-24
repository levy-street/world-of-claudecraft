import { describe, expect, it, vi } from 'vitest';

// Exercise the retained enabled rules; queue_rewards_disabled pins shipping mode.
vi.mock('../src/sim/content/queue_rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sim/content/queue_rewards')>()),
  QUEUE_REWARDS_ENABLED: true,
}));

import { applyHeal } from '../src/sim/combat/heal';
import { TALENTS } from '../src/sim/content/talents';
import { expeditionActivity } from '../src/sim/instances/dungeon_expeditions';
import { recordQueueDamage, recordQueueHealing } from '../src/sim/instances/queue_participation';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { loadQueueRewards } from '../src/sim/social/queue_rewards';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name);
    sim.setPlayerLevel(8, pid);
    sim.setSpec(TALENTS.warrior.specs.find((s) => s.role === 'dps')!.id, pid);
    return pid;
  };
  const leader = add('Leader'),
    helper = add('Helper');
  sim.resetDay = '2026-10-05';
  sim.enterDungeon('hollow_crypt', leader);
  sim.dungeonFinderExpeditionOpen(leader);
  const listing = sim.dungeonFinderBoardView()[0];
  sim.dungeonFinderExpeditionApply(listing.id, 'dps', helper);
  sim.dungeonFinderApplicationRespond(helper, true, leader);
  sim.dungeonFinderExpeditionTravel(helper);
  const claim = sim.instances.find(
    (c) => c.exitId === sim.dungeonFinderInfoFor(helper)?.expedition?.exitId,
  )!;
  const activity = expeditionActivity(claim)!;
  const bosses = activity.encounters.map(
    (e) =>
      sim.entities.get(claim.mobIds.find((id) => sim.entities.get(id)?.templateId === e.mobId)!)!,
  );
  const context = (sim as unknown as { ctx: SimContext }).ctx;
  const attack = (pid: number, boss: typeof sim.player, amount: number) =>
    sim.dealDamage(sim.entities.get(pid)!, boss, amount, false, 'physical', 'Test', 'hit');
  return { sim, leader, helper, claim, bosses, context, attack };
}
describe('Queue Points from real admitted-helper encounters', () => {
  it('pays only at completion, tracks helpers after recruitment closes and never pays the original leader', () => {
    const { sim, leader, helper, bosses, attack } = setup();
    sim.dungeonFinderListingClose(leader);
    const first = bosses[0],
      final = bosses[bosses.length - 1];
    attack(helper, first, first.maxHp * 0.02 + 20);
    attack(leader, first, first.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(0);
    attack(helper, final, final.maxHp * 0.02 + 20);
    attack(leader, final, final.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(20);
    expect(sim.dungeonFinderInfoFor(leader)?.queueRewards?.balance).toBe(0);
    const saved = sim.serializeCharacter(helper)!;
    expect(saved.queueRewards?.balance).toBe(20);
    const restored = sim.addPlayer('warrior', 'Reloaded', { state: saved, characterId: 99 });
    expect(sim.dungeonFinderInfoFor(restored)?.queueRewards?.balance).toBe(20);
    attack(helper, final, final.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(20);
  });
  it('does not pay a waiting helper or one who only tags a boss below the contribution threshold', () => {
    const { sim, leader, helper, bosses, attack } = setup();
    const final = bosses[bosses.length - 1];
    attack(helper, final, 1);
    attack(leader, final, final.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(0);
  });
  it('counts effective healing and incoming boss damage without counting zero effects', () => {
    const { sim, leader, helper, bosses, context, attack } = setup();
    const final = bosses[bosses.length - 1];
    const player = sim.entities.get(helper)!;
    const tank = sim.entities.get(leader)!;
    final.threat.set(leader, 10);
    recordQueueHealing(context, player, tank, 0);
    recordQueueDamage(context, final, player, 0);
    recordQueueHealing(context, player, tank, final.maxHp * 0.005);
    recordQueueDamage(context, final, player, final.maxHp * 0.01);
    attack(leader, final, final.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(15);
  });
  it('counts effective heals through the combat pipeline but rejects overheal', () => {
    const { sim, leader, helper, bosses, context, attack } = setup();
    const final = bosses[bosses.length - 1];
    const healer = sim.entities.get(helper)!;
    const target = sim.entities.get(leader)!;
    final.threat.set(leader, 10);
    expect(applyHeal(context, healer, target, 1000, 'Test', null, false, false)).toBe(0);
    expect(
      sim.instances.find((c) => c.queueHelpers?.has(helper))!.queueHelpers!.get(helper)!.scores
        .size,
    ).toBe(0);
    target.hp = 1;
    applyHeal(context, healer, target, final.maxHp * 0.02, 'Test', null, false, false);
    attack(leader, final, final.maxHp * 10);
    expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(15);
  });
  it.each(['left', 'disconnecting', 'outside'] as const)(
    'does not pay a helper who is %s at completion',
    (state) => {
      const { sim, leader, helper, bosses, attack } = setup();
      const final = bosses[bosses.length - 1];
      attack(helper, final, final.maxHp * 0.1);
      if (state === 'left') sim.partyLeave(helper);
      else if (state === 'disconnecting') sim.players.get(helper)!.leaving = true;
      else sim.entities.get(helper)!.pos = sim.groundPos(0, 0);
      attack(leader, final, final.maxHp * 10);
      expect(sim.dungeonFinderInfoFor(helper)?.queueRewards?.balance).toBe(0);
    },
  );
  it('persists purchases and prevents buying the same finish again after reloading', () => {
    const { sim, helper } = setup();
    sim.players.get(helper)!.queueRewards = loadQueueRewards({ balance: 100 });
    sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: 'silver', buy: true }, helper);
    const saved = sim.serializeCharacter(helper)!;
    expect(saved.queueRewards).toMatchObject({
      balance: 40,
      unlocked: ['silver'],
      equipped: 'silver',
    });
    const pid = sim.addPlayer('warrior', 'Reloaded', { state: saved });
    sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: 'silver', buy: true }, pid);
    expect(sim.dungeonFinderInfoFor(pid)?.queueRewards?.balance).toBe(40);
    sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: 'gold', buy: true }, pid);
    expect(sim.dungeonFinderInfoFor(pid)?.queueRewards?.balance).toBe(40);
  });
});
