import { describe, expect, it, vi } from 'vitest';
import { savedMaterialSlot } from '../src/sim/material_slot_load';
import * as materialStack from '../src/sim/material_stack';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

function world() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

function legacySlots(): InvSlot[] {
  return [
    { itemId: 'baked_bread', count: 5 },
    { itemId: 'minor_healing_potion', count: 3, instance: { signer: 'Ana' } },
    {
      itemId: 'copper_ore',
      count: 500,
      materialSources: [{ source: { signer: 'Bru' }, count: 500 }],
      materialSeparated: true,
    },
  ];
}

describe('canonical source projection at the character save boundary', () => {
  it.each(['minor_healing_potion', 'future_gathering_material'])(
    'preserves exact mixed sources, recipe identity and unknown nested payload for %s',
    (itemId) => {
      const slot: InvSlot = {
        itemId,
        count: 3,
        slot: 7,
        craftedRecipeId: 'minor_healing_potion',
        materialSeparated: true,
        materialSources: [
          { source: { signer: 'Ana' }, count: 2 },
          { source: { signer: 'Bru' }, count: 1 },
        ],
        instance: JSON.parse('{"future":{"nested":[1,2]},"__proto__":{"kept":true}}'),
      };
      const before = structuredClone(slot);
      const first = savedMaterialSlot(slot);
      const second = savedMaterialSlot(slot);
      expect(first).toEqual(before);
      expect(Object.hasOwn(first.instance!, '__proto__')).toBe(true);
      const future = Reflect.get(first.instance!, 'future');
      Reflect.set(future, 'nested', ['Changed']);
      Reflect.set(first.materialSources![0].source, 'signer', 'Changed');
      expect(slot).toEqual(before);
      expect(second).toEqual(before);
    },
  );

  it.each<InvSlot>([
    {
      itemId: 'minor_healing_potion',
      count: 1,
      instance: { signer: 'Ana' },
      materialSources: [{ source: { signer: 'Bru' }, count: 1 }],
    },
    {
      itemId: 'minor_healing_potion',
      count: 1,
      materialSources: [{ source: { signer: 'A'.repeat(17) }, count: 1 }],
    },
    { itemId: 'worn_sword', count: 1, materialSources: [{ source: {}, count: 1 }] },
    {
      itemId: 'minor_healing_potion',
      count: 2,
      instance: { charges: { zap: 2 } },
      materialSources: [{ source: {}, count: 2 }],
    },
  ])('refuses ambiguous, malformed or illegal source identity without mutation: %j', (slot) => {
    const before = structuredClone(slot);
    expect(() => savedMaterialSlot(slot)).toThrow(/material source state is invalid/);
    expect(slot).toEqual(before);
  });

  it('preserves a legacy empty signer as recorded identity rather than unknown stock', () => {
    const slot: InvSlot = {
      itemId: 'minor_healing_potion',
      count: 1,
      instance: { signer: '' },
    };
    expect(savedMaterialSlot(slot)).toEqual({
      itemId: slot.itemId,
      count: 1,
      materialSources: [{ source: { signer: '' }, count: 1 }],
    });
    expect(slot.instance).toEqual({ signer: '' });
  });

  it('validates and projects one oversized canonical row once, preserving every source', () => {
    const slot: InvSlot = {
      itemId: 'copper_ore',
      count: 500,
      materialSources: Array.from({ length: 500 }, (_, i) => ({
        source: { gatherer: { kind: 'character' as const, id: i + 1, name: 'Ana' } },
        count: 1,
      })),
    };
    const normalize = vi.spyOn(materialStack, 'normalizeMaterialStack');
    try {
      const saved = savedMaterialSlot(slot);
      expect(normalize).toHaveBeenCalledExactlyOnceWith(slot, expect.anything());
      expect(saved.count).toBe(500);
      expect(saved.materialSources).toHaveLength(500);
      // Canonical ordering may differ from numeric id order; normalization is
      // idempotent and preserves the exact set and multiplicity of descriptors.
      expect(savedMaterialSlot(saved)).toEqual(saved);
      expect(saved.materialSources).not.toBe(slot.materialSources);
      expect(
        saved
          .materialSources!.map((entry) => entry.source.gatherer!.id)
          .sort((a, b) => Number(a) - Number(b)),
      ).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    } finally {
      normalize.mockRestore();
    }
  });

  it('saves legacy stock canonically once without mutating live state or sharing snapshots', () => {
    const sim = world();
    const pid = sim.addPlayer('warrior', 'Ana');
    sim.addItem('minor_healing_potion', 3, pid);
    sim.addItem('copper_ore', 500, pid);
    const meta = sim.ctx.players.get(pid)!;
    meta.inventory = legacySlots();
    meta.bank.inventory = legacySlots();
    meta.vendorBuyback = legacySlots();
    // Only material rows belong in the vault; legacy over-cap counts survive.
    meta.vault.special = legacySlots().slice(2);
    delete meta.vault.special[0].materialSeparated;
    const before = structuredClone(meta);
    const first = sim.serializeCharacter(pid)!;
    const second = sim.serializeCharacter(pid)!;
    expect(meta).toEqual(before);
    expect(first).toEqual(second);
    for (const slots of [first.inventory, first.bank!.inventory, first.vendorBuyback!]) {
      expect(slots[0]).toEqual({
        itemId: 'baked_bread',
        count: 5,
        materialSources: [{ source: {}, count: 5 }],
      });
      expect(slots[1]).toEqual({
        itemId: 'minor_healing_potion',
        count: 3,
        materialSources: [{ source: { signer: 'Ana' }, count: 3 }],
      });
      expect(slots[2]).toEqual(legacySlots()[2]);
    }
    expect(first.vault!.special).toEqual(meta.vault.special);
    const restored = world();
    const loaded = restored.addPlayer('warrior', 'Ana', { state: first });
    // Preserve the complete character assertion, including cooldowns and storage.
    expect(restored.serializeCharacter(loaded)).toEqual(first);
    for (const slots of [
      first.inventory,
      first.bank!.inventory,
      first.vendorBuyback!,
      first.vault!.special!,
    ]) {
      Reflect.set(slots[0].materialSources![0], 'count', 1);
      Reflect.set(slots[slots.length - 1].materialSources![0].source, 'signer', 'Changed');
    }
    expect(sim.serializeCharacter(pid)).toEqual(second);
    expect(restored.serializeCharacter(loaded)).toEqual(second);
    expect(meta).toEqual(before);
  });

  it('normalizes a legacy save once and keeps the next whole-character round trip identical', () => {
    const sim = world();
    const pid = sim.addPlayer('warrior', 'Ana');
    const legacy = sim.serializeCharacter(pid)!;
    legacy.inventory = legacySlots();
    legacy.bank!.inventory = legacySlots();
    legacy.vendorBuyback = legacySlots();
    const original = structuredClone(legacy);
    const restored = world();
    const loaded = restored.addPlayer('warrior', 'Ana', { state: legacy });
    const canonical = restored.serializeCharacter(loaded)!;
    expect(legacy).toEqual(original);
    expect(canonical.inventory[0].materialSources).toEqual([{ source: {}, count: 5 }]);
    const again = world();
    const againPid = again.addPlayer('warrior', 'Ana', { state: canonical });
    expect(again.serializeCharacter(againPid)).toEqual(canonical);
  });

  it.each(['inventory', 'bank', 'vendorBuyback', 'vault'] as const)(
    'refuses a corrupt source total in %s instead of blessing it as unknown',
    (container) => {
      const sim = world();
      const pid = sim.addPlayer('warrior', 'Ana');
      const meta = sim.ctx.players.get(pid)!;
      const slot: InvSlot = {
        itemId: 'copper_ore',
        count: 500,
        materialSources: [{ source: { signer: 'Ana' }, count: 499 }],
      };
      if (container === 'bank') meta.bank.inventory = [slot];
      else if (container === 'vault') meta.vault.special = [slot];
      else meta[container] = [slot];
      const before = structuredClone(meta);
      expect(() => sim.serializeCharacter(pid)).toThrow(/material source state is invalid/);
      expect(meta).toEqual(before);
    },
  );
});
