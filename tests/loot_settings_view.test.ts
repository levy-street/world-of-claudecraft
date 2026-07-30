import { describe, expect, it } from 'vitest';
import { lootSettingsView } from '../src/ui/hud/loot/loot_settings_view';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

const member = (pid: number, name: string): PartyMemberInfo => ({
  pid,
  name,
  cls: 'warrior',
  level: 40,
  hp: 100,
  mhp: 100,
  res: 100,
  mres: 100,
  rtype: 'rage',
  x: 0,
  z: 0,
  dead: 0,
  inCombat: 0,
  group: 1,
});

const info = (over: Partial<PartyInfo>): PartyInfo => ({
  leader: 1,
  raid: false,
  master: { enabled: true, looter: 0, threshold: 'rare' },
  members: [member(1, 'Ashkandi'), member(2, 'Thrall')],
  ...over,
});

describe('lootSettingsView', () => {
  it('marks the leader editable and resolves looter 0 to the leader name', () => {
    const m = lootSettingsView(info({}), 1);
    expect(m.isLeader).toBe(true);
    expect(m.enabled).toBe(true);
    expect(m.looterPid).toBe(0);
    expect(m.looterName).toBe('Ashkandi');
    expect(m.memberOptions).toEqual([
      { pid: 1, name: 'Ashkandi' },
      { pid: 2, name: 'Thrall' },
    ]);
  });

  it('marks a non-leader read-only and resolves a named looter', () => {
    const m = lootSettingsView(
      info({ master: { enabled: true, looter: 2, threshold: 'epic' } }),
      2,
    );
    expect(m.isLeader).toBe(false);
    expect(m.looterName).toBe('Thrall');
    expect(m.threshold).toBe('epic');
  });

  it('reports master loot off', () => {
    const m = lootSettingsView(
      info({ master: { enabled: false, looter: 0, threshold: 'uncommon' } }),
      2,
    );
    expect(m.enabled).toBe(false);
  });

  it('is a pure projection (identical input, identical output)', () => {
    const a = info({});
    expect(lootSettingsView(a, 1)).toEqual(lootSettingsView(a, 1));
  });
});
