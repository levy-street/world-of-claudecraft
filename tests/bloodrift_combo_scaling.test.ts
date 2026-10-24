import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// Classic Rip scaling for Bloodrift (owner ruling 2026-07-29, mirroring the
// Bleed Out fix): a FIXED 24 sec duration whose total damage scales per
// combo point spent, so points buy bigger ticks. The values were doubled to
// 72 plus 48 per point (312 at a 5-point spend) to make Bloodrift worth its
// press. Rounds out the six-spec tooltip-clarity rule that every finisher
// visibly rewards the points it consumes.

function rig() {
  const sim = new Sim({ seed: 43, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.resource = p.maxResource;
  sim.castAbility('cat_form');
  for (let i = 0; i < 40; i++) sim.tick(); // land the form, clear the gcd
  expect(p.auras.some((a) => a.kind === 'form_cat')).toBe(true);
  return { sim, p };
}

function addTargetMob(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(9700, MOBS.forest_wolf, 20, {
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

function castAtCombo(sim: Sim, combo: number): void {
  sim.player.comboPoints = combo;
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('rip');
  sim.player.autoAttack = false;
  for (let i = 0; i < 40; i++) sim.tick(); // clear the global cooldown
}

function bleedOn(mob: Entity): Aura | undefined {
  return mob.auras.find((a) => a.kind === 'dot' && a.id === 'rip');
}

describe('Bloodrift (rip): damage scales with combo points at a fixed duration', () => {
  it('always runs 24 sec, with 72 plus 48 per combo point of bleed', () => {
    // Tick value = comboTotal / 12 ticks (+ a constant AP snapshot), so each
    // combo point adds exactly 4 per tick: 48 extra damage over the bleed.
    const ticks: number[] = [];
    for (const combo of [1, 3, 5]) {
      const { sim } = rig();
      const mob = addTargetMob(sim);
      castAtCombo(sim, combo);
      const bleed = bleedOn(mob);
      expect(bleed, `rip at ${combo} combo`).toBeDefined();
      expect(bleed?.duration).toBe(24);
      expect(bleed?.tickInterval).toBe(2);
      ticks.push(bleed?.value ?? 0);
      expect(sim.player.comboPoints).toBe(0);
    }
    const [v1, v3, v5] = ticks;
    expect(v1).toBeGreaterThan(0);
    // (72 + 48 x 3)/12 - (72 + 48 x 1)/12 = 8, and again from 3 to 5 points.
    expect(v3 - v1).toBe(8);
    expect(v5 - v3).toBe(8);
  });

  it('cannot be cast with no combo points', () => {
    const { sim, p } = rig();
    const mob = addTargetMob(sim);
    p.comboPoints = 0;
    p.resource = p.maxResource;
    sim.castAbility('rip');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(bleedOn(mob)).toBeUndefined();
  });
});
