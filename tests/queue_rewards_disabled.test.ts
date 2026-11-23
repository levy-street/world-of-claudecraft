import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  admitQueueHelper,
  awardQueueEncounter,
  recordQueueDamage,
  recordQueueHealing,
} from '../src/sim/instances/queue_participation';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  changeQueueReward,
  grantQueueEncounter,
  loadQueueRewards,
  savedQueueRewards,
} from '../src/sim/social/queue_rewards';
import { EMPTY_TEST_WORLD } from './sim_shared';

const existing = () =>
  loadQueueRewards({
    balance: 200,
    unlocked: ['bronze', 'silver'],
    equipped: 'bronze',
    day: '2026-10-05',
    earnedToday: 5,
    credited: {},
  });

describe('helper rewards are paused without erasing saved progress', () => {
  it('refuses grants, purchases, equips and unequips without even advancing the day', () => {
    const state = existing();
    const before = savedQueueRewards(state);
    const activity = FINDER_ACTIVITIES.find((a) => a.id === 'hollow_crypt_normal')!;
    expect(
      grantQueueEncounter(state, '2026-10-06', activity.id, activity.encounters[0].mobId),
    ).toBe(0);
    expect(changeQueueReward(state, 'gold', true)).toBe(false);
    expect(changeQueueReward(state, 'silver', false)).toBe(false);
    expect(changeQueueReward(state, null, false)).toBe(false);
    expect(savedQueueRewards(state)).toEqual(before);
  });

  it('preserves real character saves and refuses reward commands on old and new characters', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const fresh = sim.addPlayer('warrior', 'Fresh');
    const saved = { ...sim.serializeCharacter(fresh)!, queueRewards: existing() };
    const restored = sim.addPlayer('warrior', 'Restored', { state: saved, characterId: 99 });
    for (const pid of [fresh, restored]) {
      sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: 'gold', buy: true }, pid);
      sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: 'silver', buy: false }, pid);
      sim.dungeonFinderExpeditionConfigure({ kind: 'reward', id: null, buy: false }, pid);
    }
    expect(sim.serializeCharacter(fresh)?.queueRewards).toBeUndefined();
    expect(sim.serializeCharacter(restored)?.queueRewards).toEqual(saved.queueRewards);
  });

  it('does not allocate helper bookkeeping or award points in a real dungeon claim', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(8);
    sim.enterDungeon('hollow_crypt');
    const claim = sim.instances.find((c) => c.dungeonId === 'hollow_crypt')!;
    expect(claim).toBeDefined();
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const boss = sim.entities.get(claim.mobIds[0])!;
    admitQueueHelper(ctx, claim, sim.playerId, 1);
    recordQueueDamage(ctx, sim.player, boss, boss.maxHp);
    recordQueueHealing(ctx, sim.player, sim.player, 100);
    awardQueueEncounter(ctx, claim, boss);
    expect(claim.queueHelpers).toBeUndefined();
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved).not.toBeNull();
    expect(saved?.queueRewards).toBeUndefined();
  });
});
