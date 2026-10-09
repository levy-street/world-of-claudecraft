import { describe, expect, it } from 'vitest';
import { buddyOwned, summonBuddy } from '../src/sim/buddies';
import { ITEMS, MOBS } from '../src/sim/data';
import { useItem } from '../src/sim/items';
import { buddyOf } from '../src/sim/pet/buddy_ai';
import { Sim } from '../src/sim/sim';
import { VENDOR_TEST_WORLD } from './sim_shared';

describe('retired Sapling buddy', () => {
  it('keeps its saved whistle inert without consuming it or spawning a follower', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Owner');
    const meta = sim.players.get(pid)!;
    sim.addItem('whistle_sapling', 1, pid);
    useItem(sim.ctx, 'whistle_sapling', pid);
    expect(sim.countItem('whistle_sapling', pid)).toBe(1);
    expect(buddyOwned(meta, 'sapling')).toBe(false);
    expect(summonBuddy(sim.ctx, pid, 'sapling')).toBe(false);
    expect(buddyOf(sim.ctx, pid)).toBeNull();
    expect(MOBS.buddy_sapling).toBeUndefined();
    expect(ITEMS.whistle_sapling).toMatchObject({
      kind: 'buddy',
      buddy: 'sapling',
      soulbound: true,
    });
  });

  it('discards saved Sapling ownership, pending reveals and last selection on login', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Owner');
    const state = sim.serializeCharacter(pid)!;
    state.buddies = {
      owned: ['horse', 'sapling'],
      pending: [{ key: 'sapling', source: 'world', x: 0, z: 0 }],
      last: 'sapling',
      cosmetics: ['crystal_lich_frostbound'],
      equipped: { crystal_lich: 'crystal_lich_frostbound' },
    };
    const again = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const restoredId = again.addPlayer('warrior', 'Owner', { state });
    expect(again.ownedBuddiesFor(restoredId)).toEqual(['horse']);
    expect(again.pendingBuddiesFor(restoredId)).toEqual([]);
    expect(buddyOf(again.ctx, restoredId)).toBeNull();
    expect(again.serializeCharacter(restoredId)!.buddies).toEqual({ owned: ['horse'] });
  });
});
