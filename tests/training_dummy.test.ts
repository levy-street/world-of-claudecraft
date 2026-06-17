import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// The Eastbrook training dummy: a near-immortal, inert practice target that
// counts for damage, never fights back, and respawns 10s after it dies.
const makeSim = (seed = 7) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

function dummy(sim: Sim): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.templateId === 'training_dummy') return e;
  }
  throw new Error('training dummy not spawned');
}

function hit(sim: Sim, target: Entity, amount: number): void {
  (sim as any).dealDamage(sim.player, target, amount, false, 'physical', null, 'hit');
}

describe('training dummy', () => {
  it('spawns in the Eastbrook hub with 999999 hp', () => {
    const d = dummy(makeSim());
    expect(d.maxHp).toBe(999999);
    expect(d.hp).toBe(999999);
    expect(d.level).toBe(10);
  });

  it('stays inert when attacked — never aggros or moves, but takes damage', () => {
    const sim = makeSim();
    const d = dummy(sim);
    const spawn = { ...d.pos };
    hit(sim, d, 500);
    expect(d.hp).toBe(999499); // counts for damage
    // attacking it puts the player in combat...
    expect(sim.player.inCombat).toBe(true);
    // ...but the dummy never retaliates
    expect(d.aiState).toBe('idle');
    expect(d.aggroTargetId).toBeNull();
    for (let i = 0; i < 20; i++) sim.tick(); // 1s
    expect(d.aiState).toBe('idle');
    expect(d.pos.x).toBeCloseTo(spawn.x, 5);
    expect(d.pos.z).toBeCloseTo(spawn.z, 5);
  });

  it('drops combat and heals to full ~5s after the last hit', () => {
    const sim = makeSim();
    const d = dummy(sim);
    hit(sim, d, 12345);
    expect(d.hp).toBeLessThan(d.maxHp);
    for (let i = 0; i < 20 * 6; i++) sim.tick(); // 6s of no hits
    expect(d.hp).toBe(d.maxHp);
    expect(d.inCombat).toBe(false);
    // the player is also out of combat after the 5s window
    expect(sim.player.inCombat).toBe(false);
  });

  it('drops a Bale of Straw and respawns ~10s after dying', () => {
    const sim = makeSim();
    const d = dummy(sim);
    const id = d.id;
    hit(sim, d, 999999); // overkill
    expect(d.dead).toBe(true);
    expect(d.lootable).toBe(true);
    expect(d.loot?.items.some((it) => it.itemId === 'bale_of_straw')).toBe(true);
    expect(d.respawnTimer).toBeCloseTo(10, 1);
    // before 10s it is still a corpse
    for (let i = 0; i < 20 * 9; i++) sim.tick();
    expect(d.dead).toBe(true);
    // after 10s the same entity is back at full health
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(d.id).toBe(id);
    expect(d.dead).toBe(false);
    expect(d.hp).toBe(d.maxHp);
    expect(d.aiState).toBe('idle');
  });
});
