import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('mixed maker potion experience', () => {
  it.each([false, true])('credits only the consumed maker (selected slot: %s)', (selected) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Ana');
    const meta = sim.ctx.players.get(pid)!;
    const entity = sim.ctx.entities.get(pid)!;
    meta.archetype.activeArchetype = 'alchemy';
    sim.addItemInstance('sunpetal_healing_draught', { signer: 'Ana' }, pid);
    sim.addItemInstance('sunpetal_healing_draught', { signer: 'Zoe' }, pid);
    const slotIndex = meta.inventory.findIndex(
      (slot) => slot.itemId === 'sunpetal_healing_draught',
    );
    expect(meta.inventory[slotIndex].count).toBe(2);
    entity.hp = 1;
    sim.useItem('sunpetal_healing_draught', pid, selected ? slotIndex : undefined);
    expect(meta.craftSkills.alchemy).toBe(0.25);
    expect(meta.inventory[slotIndex].materialSources).toEqual([
      { source: { signer: 'Zoe' }, count: 1 },
    ]);
    const state = sim.serializeCharacter(pid)!;
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Ana', { state });
    const restoredMeta = restored.ctx.players.get(restoredPid)!;
    const restoredEntity = restored.ctx.entities.get(restoredPid)!;
    restoredEntity.hp = 1;
    restoredEntity.potionCooldownUntil = 0;
    const remainingIndex = restoredMeta.inventory.findIndex(
      (slot) => slot.itemId === 'sunpetal_healing_draught',
    );
    restored.useItem(
      'sunpetal_healing_draught',
      restoredPid,
      selected ? remainingIndex : undefined,
    );
    expect(restoredMeta.craftSkills.alchemy).toBe(0.25);
    expect(restored.countItem('sunpetal_healing_draught', restoredPid)).toBe(0);
  });
});
