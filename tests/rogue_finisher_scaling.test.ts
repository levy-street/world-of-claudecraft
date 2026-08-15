import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// Classic combo-point scaling for the two utility finishers
// (docs/design/rogue-v029-spec-engines.md, tooltip-clarity pass):
// Bleed Out lasts 6 sec plus 2 per combo point at a FIXED tick value
// (points buy more ticks, never bigger ones), and Armor Breach lands
// one Sunder stack per combo point for a flat 30 sec.

function rig() {
  const sim = new Sim({ seed: 31, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

function castAtCombo(sim: Sim, ability: string, combo: number): void {
  sim.player.comboPoints = combo;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(ability);
  sim.player.autoAttack = false;
  for (let i = 0; i < 40; i++) sim.tick(); // clear the global cooldown
}

function auraOn(mob: Entity, id: string): Aura | undefined {
  return mob.auras.find((a) => a.id === id);
}

describe('Bleed Out (rupture): duration scales with combo points spent', () => {
  it('lasts 6 sec plus 2 per combo point, at the same per-tick value', () => {
    const perCombo: Array<{ combo: number; duration: number }> = [
      { combo: 1, duration: 8 },
      { combo: 3, duration: 12 },
      { combo: 5, duration: 16 },
    ];
    const tickValues = new Set<number>();
    for (const { combo, duration } of perCombo) {
      const { sim } = rig();
      const mob = addTargetMob(sim);
      castAtCombo(sim, 'rupture', combo);
      const bleed = auraOn(mob, 'rupture');
      expect(bleed, `rupture at ${combo} combo`).toBeDefined();
      expect(bleed?.duration).toBe(duration);
      expect(bleed?.tickInterval).toBe(2);
      tickValues.add(bleed?.value ?? 0);
      expect(sim.player.comboPoints).toBe(0);
    }
    // One shared tick value across every spend: more points = more ticks,
    // never bigger ones (5 points = the pre-change 16 sec bleed exactly).
    expect(tickValues.size).toBe(1);
    expect(tickValues.has(0)).toBe(false);
  });

  it('cannot be cast with no combo points', () => {
    const { sim, p } = rig();
    const mob = addTargetMob(sim);
    p.comboPoints = 0;
    p.resource = p.maxResource;
    sim.castAbility('rupture');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(auraOn(mob, 'rupture')).toBeUndefined();
  });
});

describe('Armor Breach (expose_armor): stacks scale with combo points spent', () => {
  it('lands one 2% Sunder stack per combo point for 30 sec', () => {
    for (const combo of [1, 3, 5]) {
      const { sim } = rig();
      const mob = addTargetMob(sim);
      castAtCombo(sim, 'expose_armor', combo);
      const sunder = mob.auras.find((a) => a.kind === 'sunder');
      expect(sunder, `expose at ${combo} combo`).toBeDefined();
      expect(sunder?.stacks).toBe(combo);
      expect(sunder?.duration).toBe(30);
      expect(sim.player.comboPoints).toBe(0);
    }
  });

  it('a recast sets the stacks to the new spend, up and down', () => {
    const { sim } = rig();
    const mob = addTargetMob(sim);
    castAtCombo(sim, 'expose_armor', 2);
    expect(mob.auras.find((a) => a.kind === 'sunder')?.stacks).toBe(2);
    castAtCombo(sim, 'expose_armor', 5);
    expect(mob.auras.find((a) => a.kind === 'sunder')?.stacks).toBe(5);
    // A cheaper recast overwrites too: the debuff always reads the last spend.
    castAtCombo(sim, 'expose_armor', 1);
    expect(mob.auras.find((a) => a.kind === 'sunder')?.stacks).toBe(1);
  });

  it('cannot be cast with no combo points', () => {
    const { sim, p } = rig();
    const mob = addTargetMob(sim);
    p.comboPoints = 0;
    p.resource = p.maxResource;
    sim.castAbility('expose_armor');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(mob.auras.find((a) => a.kind === 'sunder')).toBeUndefined();
  });
});
