import { describe, expect, it, vi } from 'vitest';
import {
  grantBuddy,
  restoreBuddyCollection,
  serializeBuddyCollection,
  summonBuddy,
  syncBuddyOwnership,
} from '../src/sim/buddies';
import { normalizeBuddyNames, renameBuddy } from '../src/sim/buddy_names';
import { buddyOf } from '../src/sim/pet/buddy_ai';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Owner');
  grantBuddy(sim.ctx, pid, 'horse');
  return { sim, pid, buddy: buddyOf(sim.ctx, pid)! };
}

describe('remembered buddy names', () => {
  it('remembers a different name for each buddy across switches, dismissals and save/load', () => {
    const { sim, pid, buddy } = setup();
    expect(renameBuddy(sim.ctx, pid, buddy.id, '  Sir   Oats  ')).toBe(true);
    expect(buddy.name).toBe('Sir Oats');
    grantBuddy(sim.ctx, pid, 'crystal_lich');
    expect(renameBuddy(sim.ctx, pid, buddyOf(sim.ctx, pid)!.id, 'Frosty')).toBe(true);
    summonBuddy(sim.ctx, pid, 'horse');
    expect(buddyOf(sim.ctx, pid)?.name).toBe('Sir Oats');
    summonBuddy(sim.ctx, pid, 'horse');
    summonBuddy(sim.ctx, pid, 'horse');
    expect(buddyOf(sim.ctx, pid)?.name).toBe('Sir Oats');
    const state = sim.serializeCharacter(pid)!;
    const restored = sim.addPlayer('warrior', 'Restored', { state });
    summonBuddy(sim.ctx, restored, 'crystal_lich');
    expect(buddyOf(sim.ctx, restored)?.name).toBe('Frosty');
    summonBuddy(sim.ctx, restored, 'horse');
    expect(buddyOf(sim.ctx, restored)?.name).toBe('Sir Oats');
  });

  it('rejects other owners, combat pets, missing and stale entities without renaming a replacement', () => {
    const { sim, pid, buddy } = setup();
    const other = sim.addPlayer('warrior', 'Other');
    expect(renameBuddy(sim.ctx, other, buddy.id, 'Stolen')).toBe(false);
    expect(renameBuddy(sim.ctx, pid, pid, 'Player')).toBe(false);
    expect(renameBuddy(sim.ctx, pid, -1, 'Missing')).toBe(false);
    buddy.templateId = 'pet_wolf';
    expect(renameBuddy(sim.ctx, pid, buddy.id, 'Wolf')).toBe(false);
    buddy.templateId = 'buddy_horse';
    grantBuddy(sim.ctx, pid, 'forgemaw');
    expect(renameBuddy(sim.ctx, pid, buddy.id, 'Stale')).toBe(false);
    expect(buddyOf(sim.ctx, pid)?.name).toBe('Forgemaw The Molten');
  });

  it.each(['', 'A', '123', '<script>', 'ABCDEFGHIJKLMNOPQ', 'Bad\n123'])(
    'rejects invalid name %j',
    (name) => {
      const { sim, pid, buddy } = setup();
      expect(renameBuddy(sim.ctx, pid, buddy.id, name)).toBe(false);
      expect(sim.meta(pid)!.buddies.names).toEqual({});
      expect(buddy.name).toBe('Tug, the Warhorse');
    },
  );

  it('does not scan entities or publish an account grant and keeps names character-local', () => {
    const { sim, pid, buddy } = setup();
    const alt = sim.addPlayer('warrior', 'Alt', { accountBuddyOwned: ['horse'] });
    const grant = vi.fn();
    sim.onBuddyGranted = grant;
    const scan = vi.spyOn(sim.entities, 'values').mockImplementation(() => {
      throw new Error('realm scan');
    });
    try {
      expect(renameBuddy(sim.ctx, pid, buddy.id, 'Oats')).toBe(true);
    } finally {
      scan.mockRestore();
    }
    syncBuddyOwnership(sim.ctx, pid, ['horse', 'forgemaw']);
    expect(sim.meta(pid)!.buddies.names).toEqual({ horse: 'Oats' });
    expect(sim.meta(alt)!.buddies.names).toEqual({});
    expect(grant).not.toHaveBeenCalled();
  });

  it('normalizes malformed legacy name maps and omits empty names without changing old saves', () => {
    expect(normalizeBuddyNames(null)).toEqual({});
    expect(normalizeBuddyNames(['horse'])).toEqual({});
    const restored = restoreBuddyCollection({
      owned: ['horse'],
      names: {
        horse: '  Sir   Oats ',
        crystal_lich: '<bad>',
        forgemaw: 'Cinder',
        sapling: 'Retired',
      },
    });
    expect(serializeBuddyCollection(restored)?.names).toEqual({
      horse: 'Sir Oats',
      forgemaw: 'Cinder',
    });
    expect(serializeBuddyCollection(restoreBuddyCollection({ owned: ['horse'] }))).toEqual({
      owned: ['horse'],
    });
    const raw = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`fake${i}`, 'Bad']));
    Object.assign(raw, {
      horse: 'ABCDEFGHIJKLMNOP',
      crystal_lich: 'ABCDEFGHIJKLMNOP',
      forgemaw: 'ABCDEFGHIJKLMNOP',
    });
    const names = normalizeBuddyNames(raw);
    expect(Object.keys(names)).toHaveLength(3);
    expect(Buffer.byteLength(JSON.stringify({ names }), 'utf8')).toBeLessThan(128);
  });
});
