import { describe, expect, it } from 'vitest';
import { diffMaterialContainers } from '../server/material_source_ledger';
import { rekeyInstanceSigner } from '../src/sim/character_rename';
import { holdsSelfSignedInstance, requiredReagentCount } from '../src/sim/professions/crafting';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const self = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const row = (signer?: string): InvSlot => ({
  itemId: 'copper_ore',
  count: 2,
  materialSources: [{ source: { ...self, ...(signer === undefined ? {} : { signer }) }, count: 2 }],
});
describe('premium benefits of mixed material sources', () => {
  it('keeps self signatures distinct from attribution and foreign signatures', () => {
    expect(holdsSelfSignedInstance([row('Ana')], 'Ana', 'copper_ore')).toBe(true);
    expect(holdsSelfSignedInstance([row()], 'Ana', 'copper_ore')).toBe(false);
    expect(holdsSelfSignedInstance([row('Bru')], 'Ana', 'copper_ore')).toBe(false);
  });
  it('expires the discount exactly when the final premium unit is consumed', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    sim.inventory.splice(0);
    const meta = sim.players.get(sim.playerId)!;
    sim.addItem('copper_ore', 4);
    sim.addItemInstance('copper_ore', { signer: meta.name }, undefined, 1);
    const cost = () =>
      requiredReagentCount(
        meta,
        { itemId: 'copper_ore', count: 4 },
        meta.craftSkills,
        'armorcrafting',
      );
    expect(cost()).toEqual({ count: 3, selfSignedBonusApplied: true });
    sim.removeItem('copper_ore', 4);
    expect(cost()).toEqual({ count: 3, selfSignedBonusApplied: true });
    sim.removeItem('copper_ore', 1);
    expect(cost()).toEqual({ count: 4, selfSignedBonusApplied: false });
  });
  it('rewrites owned premium signatures on rename while preserving gatherer snapshots', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const state = sim.serializeCharacter(sim.playerId)!;
    state.inventory = [row('Ana'), row('Bru')];
    state.bank!.inventory = [row('Ana')];
    state.vendorBuyback = [row('Ana')];
    expect(rekeyInstanceSigner(state, 'Ana', 'Renamed')).toBe(true);
    expect(holdsSelfSignedInstance(state.inventory, 'Renamed', 'copper_ore')).toBe(true);
    for (const slot of [state.inventory[0], state.bank!.inventory[0], state.vendorBuyback[0]]) {
      expect(slot.materialSources).toEqual([{ source: { ...self, signer: 'Renamed' }, count: 2 }]);
      expect(slot.materialSources![0].source.gatherer!.name).toBe('Ana');
    }
    expect(state.inventory[1]).toEqual(row('Bru'));
  });
  it('renames vault-only premium signatures with exact zero-total journal movements', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const state = sim.serializeCharacter(sim.playerId)!;
    state.inventory = [];
    const mixed: InvSlot = {
      itemId: 'copper_ore',
      count: 4,
      craftedRecipeId: 'kept-marker',
      materialSources: [
        { source: {}, count: 1 },
        { source: { ...self, signer: 'Ana' }, count: 2 },
        { source: { ...self, signer: 'Bru' }, count: 1 },
      ],
    };
    state.vault = { upgrades: 1, stock: {}, special: [mixed] };
    const before = structuredClone(state.vault.special!);
    expect(rekeyInstanceSigner(state, 'Ana', 'Renamed')).toBe(true);
    expect(mixed.count).toBe(4);
    expect(mixed.craftedRecipeId).toBe('kept-marker');
    expect(mixed.materialSources).toEqual([
      { source: {}, count: 1 },
      { source: { ...self, signer: 'Bru' }, count: 1 },
      { source: { ...self, signer: 'Renamed' }, count: 2 },
    ]);
    const delta = diffMaterialContainers(before, state.vault.special!, new Set(['copper_ore']));
    expect(delta).toEqual({
      ok: true,
      value: [
        {
          itemId: 'copper_ore',
          craftedRecipeId: 'kept-marker',
          count: 0,
          sourceDeltas: [
            { source: { ...self, signer: 'Ana' }, count: -2 },
            { source: { ...self, signer: 'Renamed' }, count: 2 },
          ],
        },
      ],
    });
    expect(rekeyInstanceSigner(state, 'Ana', 'Renamed')).toBe(false);
  });
});
