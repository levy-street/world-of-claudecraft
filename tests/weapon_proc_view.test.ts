import { describe, expect, it } from 'vitest';
import type { WeaponProc } from '../src/sim/types';
import { weaponProcLines } from '../src/ui/weapon_proc_view';

// Thronebane's on-hit: a chain arc plus an attack-speed slow.
const THRONEBANE: WeaponProc = {
  id: 'thronebane_arc',
  name: 'Chain Arc',
  trigger: 'weaponHit',
  chance: 0.1,
  effects: [
    { kind: 'chainArc', school: 'nature', damage: 42, jumps: 3, falloff: 0.6, radius: 8 },
    { kind: 'attackSlow', name: 'Thunderclap', mult: 1.2, duration: 6 },
  ],
};

// Heartwood: two separate procs, one on damaging spells (dot), one on heals (hot).
const DEATHBLOOM: WeaponProc = {
  id: 'deathless_dot',
  name: 'Deathbloom',
  trigger: 'spellDamage',
  chance: 0.15,
  effects: [
    { kind: 'dot', name: 'Deathbloom', school: 'nature', perTick: 12, interval: 2, duration: 8 },
  ],
};
const LIFEBLOOM: WeaponProc = {
  id: 'deathless_hot',
  name: 'Lifebloom',
  trigger: 'heal',
  chance: 0.15,
  effects: [{ kind: 'hot', name: 'Lifebloom', perTick: 10, interval: 2, duration: 8 }],
};

describe('weaponProcLines', () => {
  it('returns nothing for a plain item', () => {
    expect(weaponProcLines(undefined)).toEqual([]);
    expect(weaponProcLines([])).toEqual([]);
  });

  it('describes the chain-arc + attack-slow on-hit proc', () => {
    const [line] = weaponProcLines([THRONEBANE]);
    expect(line.trigger).toBe('weaponHit');
    expect(line.chancePct).toBe(10);
    expect(line.effects[0]).toEqual({
      kind: 'chainArc',
      name: 'Chain Arc',
      school: 'nature',
      damage: 42,
      jumps: 3,
    });
    // mult 1.2 -> a 20% slow.
    expect(line.effects[1]).toEqual({
      kind: 'attackSlow',
      name: 'Thunderclap',
      slowPct: 20,
      duration: 6,
    });
  });

  it('sums the dot total over the whole duration (12/tick x 4 ticks = 48)', () => {
    const [line] = weaponProcLines([DEATHBLOOM]);
    expect(line.trigger).toBe('spellDamage');
    expect(line.chancePct).toBe(15);
    expect(line.effects[0]).toEqual({
      kind: 'dot',
      name: 'Deathbloom',
      school: 'nature',
      total: 48,
      duration: 8,
    });
  });

  it('sums the hot total (10/tick x 4 ticks = 40) on the heal trigger', () => {
    const [line] = weaponProcLines([LIFEBLOOM]);
    expect(line.trigger).toBe('heal');
    expect(line.effects[0]).toEqual({ kind: 'hot', name: 'Lifebloom', total: 40, duration: 8 });
  });

  it('keeps one line per proc for a multi-proc item', () => {
    const lines = weaponProcLines([DEATHBLOOM, LIFEBLOOM]);
    expect(lines.map((l) => l.trigger)).toEqual(['spellDamage', 'heal']);
  });
});
