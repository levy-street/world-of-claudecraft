import { describe, expect, it, vi } from 'vitest';
import { attachPendingBuddy, grantBuddy, syncBuddyOwnership } from '../src/sim/buddies';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });

describe('account buddy ownership hydration', () => {
  it('unlocks account buddies without equipping, announcing or changing the chosen buddy', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Alt');
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    sim.tick();
    const meta = sim.meta(pid)!;
    attachPendingBuddy(sim.ctx, pid, 'horse', 'instance', { x: 0, z: 0 });
    const rev = meta.wireRev;
    const hook = vi.fn();
    sim.onBuddyGranted = hook;
    expect(syncBuddyOwnership(sim.ctx, pid, ['horse', 'penny_goldspark', 'unknown'])).toBe(true);
    expect(sim.ownedBuddiesFor(pid)).toEqual(['horse', 'crystal_lich']);
    expect(meta.buddies.pending).toEqual([]);
    expect(meta.buddies.last).toBe('crystal_lich');
    expect(sim.entities.get(pid)!.buddyKey).toBe('crystal_lich');
    expect(meta.wireRev).toBe(rev + 1);
    expect(syncBuddyOwnership(sim.ctx, pid, ['horse'])).toBe(false);
    expect(meta.wireRev).toBe(rev + 1);
    expect(hook).not.toHaveBeenCalled();
    expect(sim.tick().filter((event) => event.type === 'buddyRevealed')).toEqual([]);
  });

  it('hydrates account ownership before login reveals and restores only the character choice', () => {
    const sim = makeWorld();
    const first = sim.addPlayer('warrior', 'Source');
    grantBuddy(sim.ctx, first, 'crystal_lich');
    const state = sim.serializeCharacter(first)!;
    state.buddies!.pending = [{ key: 'horse', source: 'instance', x: 0, z: 0 }];
    sim.tick();
    const hook = vi.fn();
    sim.onBuddyGranted = hook;
    const alt = sim.addPlayer('warrior', 'Alt', {
      state,
      accountBuddyOwned: ['horse', 'forgemaw'],
    });
    expect(sim.ownedBuddiesFor(alt)).toEqual(['horse', 'crystal_lich', 'forgemaw']);
    expect(sim.pendingBuddiesFor(alt)).toEqual([]);
    expect(sim.entities.get(alt)!.buddyKey).toBe('crystal_lich');
    expect(hook).not.toHaveBeenCalled();
  });

  it('lets account siblings equip independently and leaves other accounts and sandboxes isolated', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A', { accountBuddyOwned: ['horse', 'crystal_lich'] });
    const b = sim.addPlayer('warrior', 'B', { accountBuddyOwned: ['horse', 'crystal_lich'] });
    const stranger = sim.addPlayer('warrior', 'C');
    expect(sim.entities.get(a)!.buddyKey).toBe('');
    sim.summonBuddyFor(a, 'horse');
    sim.summonBuddyFor(b, 'crystal_lich');
    expect(sim.entities.get(a)!.buddyKey).toBe('horse');
    expect(sim.entities.get(b)!.buddyKey).toBe('crystal_lich');
    sim.summonBuddyFor(a, 'horse');
    expect(sim.entities.get(a)!.buddyKey).toBe('');
    expect(sim.entities.get(b)!.buddyKey).toBe('crystal_lich');
    expect(sim.summonBuddyFor(stranger, 'horse')).toBe(false);
    const isolated = makeWorld();
    const other = isolated.addPlayer('warrior', 'A');
    expect(isolated.ownedBuddiesFor(other)).toEqual([]);
  });

  it('notifies the host once for a successful new grant, including a pending reveal', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Source');
    const hook = vi.fn();
    sim.onBuddyGranted = hook;
    expect(grantBuddy(sim.ctx, pid, 'horse')).toBe(true);
    expect(grantBuddy(sim.ctx, pid, 'horse')).toBe(false);
    expect(grantBuddy(sim.ctx, pid, 'penny_goldspark')).toBe(false);
    expect(hook).toHaveBeenCalledExactlyOnceWith(pid, 'horse');
    attachPendingBuddy(sim.ctx, pid, 'forgemaw', 'instance', { x: 0, z: 0 });
    for (let tick = 0; tick < 20; tick++) sim.tick();
    expect(hook).toHaveBeenLastCalledWith(pid, 'forgemaw');
    expect(hook).toHaveBeenCalledTimes(2);
  });
});
