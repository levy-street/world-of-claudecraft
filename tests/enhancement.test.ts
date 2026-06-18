import { describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ITEMS } from '../src/sim/data';
import { Rng } from '../src/sim/rng';
import { recalcPlayerStats } from '../src/sim/entity';
import { scaledWeapon, stacksMerge, stackEnhance } from '../src/sim/content/enhancement';
import { wireEntity } from '../server/game';
import { createPlayer } from '../src/sim/entity';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, devCommands: true });
}

function nearSmith(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === 'smith_haldren') {
      sim.player.pos.x = e.pos.x;
      sim.player.pos.z = e.pos.z + 1;
      return;
    }
  }
  throw new Error('smith_haldren not found');
}

function meta(sim: Sim) {
  return sim.players.get(sim.playerId)!;
}

describe('enhancement helpers', () => {
  it('stacksMerge keeps enhanced gear separate', () => {
    expect(stacksMerge({ itemId: 'eastbrook_arming_sword', count: 1, enhance: 3 }, 'eastbrook_arming_sword', 0)).toBe(false);
    expect(stacksMerge({ itemId: 'eastbrook_arming_sword', count: 1, enhance: 3 }, 'eastbrook_arming_sword', 3)).toBe(true);
    expect(stacksMerge({ itemId: 'crypt_refinement_shard', count: 2 }, 'crypt_refinement_shard', 0)).toBe(true);
  });

  it('scaledWeapon increases damage per level', () => {
    const base = ITEMS.eastbrook_arming_sword.weapon!;
    const plus9 = scaledWeapon(base, 9);
    expect(plus9.min).toBeGreaterThan(base.min);
    expect(plus9.max).toBeGreaterThan(base.max);
  });
});

describe('Sim.enhanceItem', () => {
  it('requires a nearby smith', () => {
    const sim = makeSim();
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
    sim.addItem('crypt_refinement_shard', 1, sim.playerId);
    const idx = sim.inventory.findIndex((s) => s.itemId === 'eastbrook_arming_sword');
    sim.enhanceItem({ source: 'inv', index: idx });
    expect(stackEnhance(sim.inventory[idx])).toBe(0);
  });

  it('succeeds and increments enhance level', () => {
    const sim = makeSim();
    nearSmith(sim);
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
    sim.addItem('crypt_refinement_shard', 2, sim.playerId);
    const idx = sim.inventory.findIndex((s) => s.itemId === 'eastbrook_arming_sword');
    const rng = (sim as unknown as { rng: Rng }).rng;
    vi.spyOn(rng, 'chance').mockReturnValue(true);
    sim.enhanceItem({ source: 'inv', index: idx });
    expect(stackEnhance(sim.inventory[idx])).toBe(1);
    expect(sim.inventory.find((s) => s.itemId === 'crypt_refinement_shard')?.count).toBe(1);
  });

  it('fails, consumes material, and downgrades (floor +0)', () => {
    const sim = makeSim();
    nearSmith(sim);
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId, 2);
    sim.addItem('crypt_refinement_shard', 1, sim.playerId);
    const idx = sim.inventory.findIndex((s) => s.itemId === 'eastbrook_arming_sword');
    const rng = (sim as unknown as { rng: Rng }).rng;
    vi.spyOn(rng, 'chance').mockReturnValue(false);
    sim.enhanceItem({ source: 'inv', index: idx });
    expect(stackEnhance(sim.inventory[idx])).toBe(1);
    expect(sim.inventory.some((s) => s.itemId === 'crypt_refinement_shard')).toBe(false);
  });

  it('equip swap preserves enhance level', () => {
    const sim = makeSim();
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId, 4);
    sim.equipItem('eastbrook_arming_sword', sim.playerId, 4);
    expect(sim.equipmentEnhance.mainhand).toBe(4);
    sim.equipItem('eastbrook_arming_sword', sim.playerId); // no-op without in bag
    const oldId = sim.equipment.mainhand;
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId, 0);
    sim.equipItem('eastbrook_arming_sword', sim.playerId, 0);
    const returned = sim.inventory.find((s) => s.itemId === oldId);
    expect(returned?.enhance).toBe(4);
  });

  it('serializes equipmentEnhance', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.equipmentEnhance = { mainhand: 5 };
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.equipmentEnhance?.mainhand).toBe(5);
  });
});

describe('recalcPlayerStats with enhance', () => {
  it('applies +9 weapon scaling to entity weapon', () => {
    const p = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Hero');
    const itemId = 'eastbrook_arming_sword';
    const base = ITEMS[itemId].weapon!;
    recalcPlayerStats(p, 'warrior', { mainhand: itemId }, undefined, { mainhand: 9 });
    const scaled = scaledWeapon(base, 9);
    expect(p.weapon.min).toBe(scaled.min);
    expect(p.weapon.max).toBe(scaled.max);
    expect(p.mainhandEnhance).toBe(9);
  });
});

describe('wire sync', () => {
  it('includes enh on player entities with +mainhand', () => {
    const p = createPlayer(2, 'warrior', { x: 1, y: 0, z: 2 }, 'Peer');
    p.mainhandEnhance = 7;
    const w = wireEntity(p);
    expect(w.enh).toBe(7);
  });

  it('omits enh when mainhand enhance is zero', () => {
    const p = createPlayer(3, 'mage', { x: 0, y: 0, z: 0 }, 'Mage');
    const w = wireEntity(p);
    expect(w.enh).toBeUndefined();
  });
});
