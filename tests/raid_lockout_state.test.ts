// src/sim/raid_lockout_state.ts: the still-locked subset of a durable save's
// raidLockouts blob, as the character list ships it. Mirrors the sim's own
// load filter (addPlayer keeps finite expiries still in the future) so the
// roster and the world agree on which lockouts a character carries.
import { describe, expect, it } from 'vitest';
import { DAILY_LOCKOUT_RAID_ROOMS, WEEKLY_LOCKOUT_RAID_ROOMS } from '../src/sim/instances/dungeons';
import { activeRaidLockouts, LOCKOUT_KIND_ORDER, lockoutKind } from '../src/sim/raid_lockout_state';
import { isRaidRoom } from '../src/sim/raid_rooms';

const NOW = 1_800_000_000_000;

describe('activeRaidLockouts', () => {
  it('keeps only expiries strictly in the future', () => {
    expect(
      activeRaidLockouts(
        {
          nythraxis_boss_arena: NOW + 3_600_000,
          'nythraxis_boss_arena:heroic': NOW, // expires exactly now: unlocked
          'worldboss:thunzharr_waking_peak': NOW - 1, // lapsed
        },
        NOW,
      ),
    ).toEqual({ nythraxis_boss_arena: NOW + 3_600_000 });
  });

  it('sorts the ids so the wire shape is deterministic', () => {
    const out = activeRaidLockouts({ zzz: NOW + 2, aaa: NOW + 1, mmm: NOW + 3 }, NOW);
    expect(Object.keys(out)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('drops non-finite and non-numeric values from an untrusted blob', () => {
    expect(
      activeRaidLockouts(
        {
          ok: NOW + 1,
          nan: Number.NaN,
          inf: Number.POSITIVE_INFINITY,
          str: String(NOW + 1),
          nul: null,
        },
        NOW,
      ),
    ).toEqual({ ok: NOW + 1 });
  });

  it('is empty for an absent, null, or non-object blob', () => {
    expect(activeRaidLockouts(undefined, NOW)).toEqual({});
    expect(activeRaidLockouts(null, NOW)).toEqual({});
    expect(activeRaidLockouts('junk' as unknown as Record<string, unknown>, NOW)).toEqual({});
    expect(activeRaidLockouts({}, NOW)).toEqual({});
  });
});

describe('lockoutKind', () => {
  it('classifies a world-boss loot lockout by its prefix', () => {
    expect(lockoutKind('worldboss:thunzharr_waking_peak')).toBe('worldBoss');
  });

  it('classifies every raid boss room as a raid on both difficulties', () => {
    for (const id of [...WEEKLY_LOCKOUT_RAID_ROOMS, ...DAILY_LOCKOUT_RAID_ROOMS]) {
      expect(lockoutKind(id), id).toBe('raid');
      expect(lockoutKind(`${id}:heroic`), id).toBe('raid');
    }
  });

  it('classifies any other dungeon lock as a dungeon (the heroic daily shape)', () => {
    expect(lockoutKind('hollow_crypt:heroic')).toBe('dungeon');
    expect(lockoutKind('sunken_bastion')).toBe('dungeon');
  });

  it('reads the raid rooms through the leaf the instance module re-exports', () => {
    expect(isRaidRoom('nythraxis_boss_arena')).toBe(true);
    expect(isRaidRoom('ignivar_inner_crucible')).toBe(true);
    expect(isRaidRoom('hollow_crypt')).toBe(false);
    expect(LOCKOUT_KIND_ORDER).toEqual(['raid', 'dungeon', 'worldBoss']);
  });
});
