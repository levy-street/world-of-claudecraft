// Retribution Aura is a paladin self-buff that reuses the Thorns aura: while it
// is up, any enemy that lands a melee swing on the paladin takes flat Holy damage
// back — the player-side analogue of innate mob "spiked hide" (see mob_thorns).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

function makePaladin() {
  const sim = new Sim({ seed: 42, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(16); // Retribution Aura is learned at 16
  const p = sim.player;
  p.maxHp = 100000; // survive the scripted mob swings (death wipes auras)
  p.hp = p.maxHp;
  return sim;
}

// drop a hostile mob right on top of the player so its swings land
function spawnHostile(sim: Sim, templateId: string, level: number): Entity {
  const tpl = MOBS[templateId];
  const id = (sim as any).nextId++;
  const mob = createMob(id, tpl, level, { x: 0.5, y: 0, z: 0 });
  mob.hostile = true;
  mob.maxHp = 100000;
  mob.hp = mob.maxHp;
  sim.entities.set(id, mob);
  return mob;
}

// force `n` of the mob's swings to land on the target
function connectMobSwings(sim: Sim, mob: Entity, target: Entity, n: number) {
  let landed = 0;
  for (let i = 0; i < n * 40 && landed < n; i++) {
    const before = target.hp;
    (sim as any).mobSwing(mob, target);
    if (target.hp < before) landed++;
  }
  return landed;
}

describe('paladin Retribution Aura', () => {
  it('is a holy, zero-cost self-buff learned at level 16', () => {
    const def = ABILITIES['retribution_aura'];
    expect(def.class).toBe('paladin');
    expect(def.learnLevel).toBe(16);
    expect(def.cost).toBe(0);
    expect(def.school).toBe('holy');
    expect(def.effects[0]).toMatchObject({ type: 'selfBuff', kind: 'thorns' });
    expect(CLASSES['paladin'].abilities).toContain('retribution_aura');
  });

  it('reflects flat Holy damage onto a melee attacker while active', () => {
    const sim = makePaladin();
    const p = sim.player;
    sim.castAbility('retribution_aura');
    const aura = p.auras.find((a) => a.id === 'retribution_aura');
    expect(aura).toBeDefined();
    expect(aura!.kind).toBe('thorns');
    expect(aura!.school).toBe('holy');

    const mob = spawnHostile(sim, 'forest_wolf', 14);
    const before = mob.hp;
    const landed = connectMobSwings(sim, mob, p, 8);

    expect(landed).toBeGreaterThan(0);
    // each connecting swing reflects the aura's value back at the attacker
    expect(before - mob.hp).toBe(landed * aura!.value);
  });

  it('reflects nothing once the buff is gone', () => {
    const sim = makePaladin();
    const p = sim.player;
    const mob = spawnHostile(sim, 'forest_wolf', 14);
    // no aura cast: a melee swing should not hurt the attacker
    const before = mob.hp;
    connectMobSwings(sim, mob, p, 5);
    expect(mob.hp).toBe(before);
  });
});
