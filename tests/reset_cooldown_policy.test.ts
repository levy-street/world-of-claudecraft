import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST } from '../src/sim/data';
import { IGNIVAR_RAID_ROOM_IDS } from '../src/sim/ignivar_raid_ids';
import {
  DAILY_LOCKOUT_RAID_ROOMS,
  RAID_REQUIRED_DUNGEON_IDS as REEXPORTED,
  WEEKLY_LOCKOUT_RAID_ROOMS,
} from '../src/sim/instances/dungeons';
import {
  RAID_REQUIRED_DUNGEON_IDS,
  resetCooldownApplies,
} from '../src/sim/instances/reset_cooldown_policy';

describe('reset cooldown policy: which claims pay the five-minute Reset All cooldown', () => {
  it('every standard dungeon pays it', () => {
    expect(resetCooldownApplies('hollow_crypt')).toBe(true);
    expect(resetCooldownApplies('nythraxis_crypt')).toBe(true);
    const standard = DUNGEON_LIST.map((d) => d.id).filter(
      (id) => !RAID_REQUIRED_DUNGEON_IDS.has(id),
    );
    expect(standard.length).toBeGreaterThan(0);
    for (const id of standard) expect(resetCooldownApplies(id)).toBe(true);
  });

  it('the raid-required rooms skip it: the Nythraxis boss arena and every Ignivar room', () => {
    expect(resetCooldownApplies('nythraxis_boss_arena')).toBe(false);
    for (const id of IGNIVAR_RAID_ROOM_IDS) expect(resetCooldownApplies(id)).toBe(false);
    expect([...RAID_REQUIRED_DUNGEON_IDS].sort()).toEqual(
      ['nythraxis_boss_arena', ...IGNIVAR_RAID_ROOM_IDS].sort(),
    );
  });

  it('the raid rooms it exempts are exactly the ones whose boss room carries its own daily or weekly lockout', () => {
    // The exemption is only sound because a raid kill locks the tier on its
    // own boundary: every lockout room is raid-required, and every
    // raid-required family reaches one.
    for (const id of [...DAILY_LOCKOUT_RAID_ROOMS, ...WEEKLY_LOCKOUT_RAID_ROOMS]) {
      expect(RAID_REQUIRED_DUNGEON_IDS.has(id)).toBe(true);
    }
    expect(DAILY_LOCKOUT_RAID_ROOMS.has('nythraxis_boss_arena')).toBe(true);
    expect(IGNIVAR_RAID_ROOM_IDS.some((id) => WEEKLY_LOCKOUT_RAID_ROOMS.has(id))).toBe(true);
  });

  it('dungeons.ts re-exports the same set object (one source of truth)', () => {
    expect(REEXPORTED).toBe(RAID_REQUIRED_DUNGEON_IDS);
  });
});
