import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { BUDDY_KEYS } from '../src/sim/content/buddies';
import { BUDDY_DEED_REWARDS, buddyDeedOf } from '../src/sim/content/buddy_sources';
import { grantDeed } from '../src/sim/deeds';
import { Sim } from '../src/sim/sim';
import { VENDOR_TEST_WORLD } from './sim_shared';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

const retiredRewardDeeds = [
  'prog_logging_100',
  'prog_mining_100',
  'prog_herbalism_100',
  'prog_master_angler',
  'prog_master_gatherer',
];

describe('retired companion rewards leave the Book of Deeds intact', () => {
  it('has no companion or cosmetic deed source for the retained roster', () => {
    expect(BUDDY_DEED_REWARDS).toEqual({});
    for (const key of BUDDY_KEYS) expect(buddyDeedOf(key)).toBeNull();
  });

  it.each(retiredRewardDeeds)(
    '%s still grants once without a retired companion or look',
    (deedId) => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Owner');
      sim.tick();
      const meta = sim.players.get(pid)!;
      expect(grantDeed(sim.ctx, meta, deedId)).toBe(true);
      expect(meta.deedsEarned.has(deedId)).toBe(true);
      expect(meta.buddies.owned.size).toBe(0);
      expect(sim.entities.get(pid)!.buddyKey).toBe('');
      expect(sim.tick().filter((ev) => ev.type === 'buddyRevealed')).toEqual([]);
      expect(grantDeed(sim.ctx, meta, deedId)).toBe(false);
    },
  );

  it('restores previously earned deeds without granting retired rewards at login', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;
    for (const deedId of retiredRewardDeeds) grantDeed(sim.ctx, meta, deedId);
    const state = sim.serializeCharacter(pid)!;
    state.buddies = undefined;
    const again = makeWorld();
    const pid2 = again.addPlayer('warrior', 'Owner', { state });
    const events = again.tick();
    const restored = again.players.get(pid2)!;
    for (const deedId of retiredRewardDeeds) expect(restored.deedsEarned.has(deedId)).toBe(true);
    expect(restored.buddies.owned.size).toBe(0);
    expect(events.filter((ev) => ev.type === 'buddyRevealed')).toEqual([]);
  });
});
