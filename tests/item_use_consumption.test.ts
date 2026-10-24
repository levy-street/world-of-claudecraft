import { describe, expect, it } from 'vitest';
import { useItem } from '../src/sim/items';
import { Sim } from '../src/sim/sim';

describe('using locked consumables spends the unit that grants the effect', () => {
  it.each([
    ['minor_healing_potion', false],
    ['minor_healing_potion', true],
    ['baked_bread', false],
    ['baked_bread', true],
    ['elixir_of_the_bear', false],
    ['elixir_of_the_bear', true],
  ] as const)('%s with named selection %s consumes one locked unit', (itemId, selected) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const { meta, e: player } = sim.ctx.resolve(sim.playerId)!;
    meta.inventory = [
      {
        itemId,
        count: 2,
        instance: { locked: true },
        materialSources: [
          { source: { signer: 'Ana' }, count: 1 },
          { source: { signer: 'Bru' }, count: 1 },
        ],
      },
    ];
    player.hp = 1;
    useItem(sim.ctx, itemId, sim.playerId, selected ? 0 : undefined);
    expect(meta.inventory[0].count).toBe(1);
    expect(meta.inventory[0].instance).toEqual({ locked: true });
    expect(meta.inventory[0].materialSources).toEqual([{ source: { signer: 'Bru' }, count: 1 }]);
    if (itemId === 'minor_healing_potion') expect(player.hp).toBeGreaterThan(1);
    else if (itemId === 'baked_bread') expect(player.eating).not.toBeNull();
    else expect(player.auras.some((aura) => aura.id === 'elixir_buff_sta')).toBe(true);
  });

  it.each([false, true])(
    'invalid source state grants no free healing with named selection %s',
    (selected) => {
      const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
      const { meta, e: player } = sim.ctx.resolve(sim.playerId)!;
      meta.inventory = [
        {
          itemId: 'minor_healing_potion',
          count: 2,
          materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
        },
      ];
      const before = structuredClone(meta.inventory);
      const cooldownBefore = player.potionCooldownUntil;
      player.hp = 1;
      useItem(sim.ctx, 'minor_healing_potion', sim.playerId, selected ? 0 : undefined);
      expect(player.hp).toBe(1);
      expect(player.potionCooldownUntil).toBe(cooldownBefore);
      expect(meta.inventory).toEqual(before);
    },
  );
});
