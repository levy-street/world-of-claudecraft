// The three jewelry equip slots (neck + ring1/ring2): the pure ring-slot
// resolver (equipment_rules.resolveEquipSlot), the equip/unequip flow through
// the concrete equipment keys, the any-class rule (jewelry has no armorType),
// the level gate, and the recalc contribution. The vendor that sells these
// pieces is covered in tests/heroic_vendor.test.ts.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { resolveEquipSlot } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 7): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function addCapped(sim: AnySim, cls: 'warrior' | 'mage', name: string): number {
  const pid = sim.addPlayer(cls, name);
  sim.setPlayerLevel(20, pid);
  return pid;
}

describe('resolveEquipSlot (pure)', () => {
  const RING = ITEMS.seal_of_the_nine_oaths;
  const NECK = ITEMS.yumis_keepsake_locket;
  const CHEST = ITEMS.recruit_tunic;

  it('passes non-ring slots straight through', () => {
    expect(resolveEquipSlot(NECK, {})).toBe('neck');
    expect(resolveEquipSlot(CHEST, {})).toBe(CHEST.slot);
    expect(resolveEquipSlot({ ...RING, slot: undefined } as never, {})).toBeNull();
  });

  it('fills ring1 first, then ring2, then swaps ring1', () => {
    expect(resolveEquipSlot(RING, {})).toBe('ring1');
    expect(resolveEquipSlot(RING, { ring1: 'nielas_coldlight_band' })).toBe('ring2');
    expect(resolveEquipSlot(RING, { ring2: 'nielas_coldlight_band' })).toBe('ring1');
    expect(resolveEquipSlot(RING, { ring1: 'nielas_coldlight_band', ring2: 'sutils_gambit' })).toBe(
      'ring1',
    );
  });
});

describe('jewelry equip flow', () => {
  it('equips two rings into ring1 then ring2, and a third swaps ring1 back to bags', () => {
    const sim = makeSim();
    const pid = addCapped(sim, 'warrior', 'Ringo');
    const meta = sim.players.get(pid) as any;
    sim.addItem('seal_of_the_nine_oaths', 1, pid);
    sim.addItem('nielas_coldlight_band', 1, pid);
    sim.addItem('sutils_gambit', 1, pid);

    sim.equipItem('seal_of_the_nine_oaths', pid);
    expect(meta.equipment.ring1).toBe('seal_of_the_nine_oaths');
    expect(meta.equipment.ring2).toBeUndefined();

    sim.equipItem('nielas_coldlight_band', pid);
    expect(meta.equipment.ring2).toBe('nielas_coldlight_band');

    sim.equipItem('sutils_gambit', pid);
    expect(meta.equipment.ring1).toBe('sutils_gambit');
    expect(meta.equipment.ring2).toBe('nielas_coldlight_band');
    // The swapped-out ring returns to the bags.
    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(1);
  });

  it('equips and unequips a neckpiece through the neck slot', () => {
    const sim = makeSim();
    const pid = addCapped(sim, 'warrior', 'Necko');
    const meta = sim.players.get(pid) as any;
    sim.addItem('yumis_keepsake_locket', 1, pid);

    sim.equipItem('yumis_keepsake_locket', pid);
    expect(meta.equipment.neck).toBe('yumis_keepsake_locket');
    expect(sim.countItem('yumis_keepsake_locket', pid)).toBe(0);

    expect(sim.unequipItem('neck', pid)).toBe(true);
    expect(meta.equipment.neck).toBeUndefined();
    expect(sim.countItem('yumis_keepsake_locket', pid)).toBe(1);
  });

  it('folds jewelry stats through recalcPlayerStats', () => {
    const sim = makeSim();
    const pid = addCapped(sim, 'warrior', 'Statty');
    const p = sim.entities.get(pid) as AnyEntity;
    const before = { str: p.stats.str, sta: p.stats.sta };
    sim.addItem('seal_of_the_nine_oaths', 1, pid);
    sim.equipItem('seal_of_the_nine_oaths', pid);
    expect(p.stats.str).toBe(before.str + 7);
    expect(p.stats.sta).toBe(before.sta + 4);
  });

  it('lets any class wear jewelry (no armorType gate)', () => {
    const sim = makeSim();
    const pid = addCapped(sim, 'mage', 'Maggie');
    const meta = sim.players.get(pid) as any;
    sim.addItem('seal_of_the_nine_oaths', 1, pid); // a str ring, still wearable
    sim.equipItem('seal_of_the_nine_oaths', pid);
    expect(meta.equipment.ring1).toBe('seal_of_the_nine_oaths');
  });

  it('refuses jewelry below the level requirement', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Lowbie'); // level 1
    const meta = sim.players.get(pid) as any;
    sim.addItem('seal_of_the_nine_oaths', 1, pid);
    sim.drainEvents();

    sim.equipItem('seal_of_the_nine_oaths', pid);

    expect(meta.equipment.ring1).toBeUndefined();
    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(1);
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'error' && e.pid === pid && /must be level/.test(e.text),
      ),
    ).toBe(true);
  });
});
