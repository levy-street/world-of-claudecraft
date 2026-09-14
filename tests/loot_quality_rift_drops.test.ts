import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  addRiftClearGearLoot,
  addRiftProgressionLoot,
  createRiftGearInstance,
} from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload, LootSlot } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const quality: ItemInstancePayload = {
  lootQuality: { version: 1, tier: 3, weights: [5, 200, 900, 8, 9] },
};
function setup() {
  const sim = new Sim({
    seed: 123,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], groundObjects: [], npcs: {} },
  });
  const owner = sim.addPlayer('warrior', 'Owner');
  const mage = sim.addPlayer('mage', 'Mage');
  const rogue = sim.addPlayer('rogue', 'Rogue');
  const boss = createMob(sim.nextId++, MOBS.rift_boss_arcane, 23, {
    ...expectDefined(sim.entities.get(owner)).pos,
  });
  boss.dead = true;
  boss.corpseTimer = 60;
  boss.lootable = true;
  boss.tappedById = owner;
  const existing: LootSlot[] = [
    { itemId: 'greyjaw_hide_boots', count: 1 },
    { itemId: 'greyjaw_hide_boots', count: 1, instance: structuredClone(quality) },
  ];
  boss.loot = { copper: 0, items: [...existing] };
  sim.entities.set(boss.id, boss);
  return { sim, owner, mage, rogue, boss, existing };
}
const isEquipment = (itemId: string) =>
  ['weapon', 'armor', 'held_offhand'].includes(ITEMS[itemId].kind);

afterEach(() => vi.restoreAllMocks());

describe('Rift reward source quality', () => {
  it.each([20, 22, 25, 28])(
    'rolls each new eligible rank-level %i clear reward once after its ordinary selection',
    (baseLevel) => {
      const { sim, boss, existing } = setup();
      const calls: string[] = [];
      vi.spyOn(sim.ctx.rng, 'chance').mockImplementation(() => {
        calls.push('selection');
        return true;
      });
      vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min, max) => {
        calls.push(max === 9999 ? 'tier' : max === 1000 ? 'allocation' : 'selection');
        return max === 9999 ? 9999 : min;
      });
      addRiftClearGearLoot(sim.ctx, boss, baseLevel);
      const slots = expectDefined(boss.loot).items;
      expect(slots.slice(0, 2)).toEqual(existing);
      expect(slots[0]).toBe(existing[0]);
      expect(slots[1]).toBe(existing[1]);
      const newGear = slots.slice(2).filter((s) => isEquipment(s.itemId));
      expect(newGear.length).toBeGreaterThan(0);
      expect(newGear.every((s) => s.instance?.lootQuality?.tier === 4)).toBe(true);
      expect(
        slots
          .slice(2)
          .filter((s) => !isEquipment(s.itemId))
          .every((s) => !s.instance?.lootQuality),
      ).toBe(true);
      expect(calls.filter((c) => c === 'tier')).toHaveLength(newGear.length);
      expect(calls.indexOf('tier')).toBeGreaterThan(calls.lastIndexOf('selection'));
    },
  );

  it('rolls personal class rings independently, excludes essence and gems, and preserves the minted copy on pickup', () => {
    const { sim, owner, mage, rogue, boss, existing } = setup();
    let tierDraws = 0;
    const int = vi
      .spyOn(sim.ctx.rng, 'int')
      .mockImplementation((min, max) => (max === 9999 ? [0, 9000, 9999][tierDraws++] : min));
    addRiftProgressionLoot(sim.ctx, boss, 'natural-rift-test', 'S', [owner, mage, rogue]);
    const slots = expectDefined(boss.loot).items;
    expect(slots.slice(0, 2)).toEqual(existing);
    const rings = slots.slice(2).filter((s) => s.instance?.rift);
    expect(rings.map((s) => s.itemId)).toEqual([
      'riftbound_band_of_might',
      'riftbound_band_of_insight',
      'riftbound_band_of_guile',
    ]);
    expect(rings.map((s) => s.instance?.lootQuality?.tier)).toEqual([undefined, 1, 4]);
    expect(tierDraws).toBe(3);
    expect(
      slots
        .slice(2)
        .filter((s) => !s.instance?.rift)
        .every((s) => !s.instance),
    ).toBe(true);
    const generated = structuredClone(rings);
    int.mockClear();
    for (const pid of [owner, mage, rogue]) sim.lootCorpse(boss.id, pid);
    for (const ring of generated) {
      const recipient = expectDefined(ring.personalFor)[0];
      const received = expectDefined(sim.players.get(recipient)).inventory.find(
        (s) => s.itemId === ring.itemId,
      );
      expect(received?.instance).toEqual(ring.instance);
    }
    expect(int).not.toHaveBeenCalled();
  });

  it.each(['dev', 'affix', 'owned', 'dummy'] as const)(
    'never rolls quality for %s Rift reward sources',
    (source) => {
      const { sim, boss, owner } = setup();
      if (source === 'dev') boss.devSpawnOwnerId = owner;
      if (source === 'affix') boss.affixSpawned = true;
      if (source === 'owned') boss.ownerId = owner;
      if (source === 'dummy')
        boss.templateId = expectDefined(Object.values(MOBS).find((m) => m.dummy)).id;
      vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(false);
      const int = vi.spyOn(sim.ctx.rng, 'int').mockImplementation((min) => min);
      addRiftClearGearLoot(sim.ctx, boss, 20);
      addRiftProgressionLoot(sim.ctx, boss, 'excluded-rift-test', 'S', [owner]);
      expect(int.mock.calls.some(([min, max]) => min === 0 && max === 9999)).toBe(false);
      expect(
        expectDefined(boss.loot)
          .items.slice(2)
          .every((s) => !s.instance?.lootQuality),
      ).toBe(true);
    },
  );

  it('keeps generic forge/dev band creation ordinary', () => {
    const gear = createRiftGearInstance('generic-test', 'S', 'warrior', 9, 5);
    expect(gear.instance.lootQuality).toBeUndefined();
    expect(gear.instance.rift?.upgradeLevel).toBe(5);
  });
});
