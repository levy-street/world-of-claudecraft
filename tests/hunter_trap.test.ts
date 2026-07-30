import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// G6 (fix/talents2-balance-pass): Rime Snare becomes a real trap. The
// maintainer's spec: placed at the hunter's feet, arms, and freezes the FIRST
// single enemy that touches it, instead of the old 30yd aimed 8yd-radius
// instant root+stun nova. Rides the groundAoEs collection with a hunterTrap
// rider, the Ring of Frost pattern.

type AnySim = Sim & { ctx: { groundAoEs: GroundAoE[] } };

function setup(): { sim: AnySim; p: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(10);
  expect(sim.applyTalents({ spec: null, rows: { 8: 'hun_r8_frost_trap' } })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addMobAt(sim: AnySim, x: number, z: number): Entity {
  const mob = createMob(20_000 + sim.ctx.groundAoEs.length, MOBS.forest_wolf, 8, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function trapEntries(sim: AnySim): GroundAoE[] {
  return sim.ctx.groundAoEs.filter((g) => g.hunterTrap !== undefined);
}

function frozen(mob: Entity): boolean {
  return mob.auras.some((aura) => aura.id === 'frost_trap_freeze');
}

describe('G6: Rime Snare is an armed single-target trap at your feet', () => {
  it('places at the hunter, arms, then freezes the first enemy that touches it', () => {
    const { sim, p } = setup();
    sim.castAbility('frost_trap');
    sim.tick();
    const traps = trapEntries(sim);
    expect(traps).toHaveLength(1);
    expect(traps[0].pos.x).toBeCloseTo(p.pos.x, 1);
    expect(traps[0].pos.z).toBeCloseTo(p.pos.z, 1);

    // An enemy standing on it BEFORE it arms is not frozen.
    const early = addMobAt(sim, traps[0].pos.x, traps[0].pos.z);
    sim.tick();
    expect(frozen(early)).toBe(false);

    // After the arm delay the same contact springs it.
    for (let i = 0; i < 40; i++) sim.tick();
    expect(frozen(early)).toBe(true);
    expect(trapEntries(sim)).toHaveLength(0); // sprung traps are consumed
  });

  it('an armed trap shimmers its ground indicator periodically', () => {
    const { sim } = setup();
    sim.castAbility('frost_trap');
    const events: { type?: string; fx?: string; school?: string }[] = [];
    const anySim = sim as unknown as { emit(e: (typeof events)[number]): void };
    const orig = anySim.emit.bind(sim);
    anySim.emit = (e) => {
      events.push(e);
      return orig(e);
    };
    for (let i = 0; i < 120; i++) sim.tick(); // arm + three shimmer windows
    const shimmers = events.filter(
      (e) => e.type === 'spellfxAt' && e.fx === 'nova' && e.school === 'frost',
    );
    expect(shimmers.length).toBeGreaterThanOrEqual(2);
  });

  it('freezes only ONE enemy even with several in the radius', () => {
    const { sim } = setup();
    sim.castAbility('frost_trap');
    sim.tick();
    const trap = trapEntries(sim)[0];
    const first = addMobAt(sim, trap.pos.x, trap.pos.z);
    const second = addMobAt(sim, trap.pos.x + 0.5, trap.pos.z);
    for (let i = 0; i < 40; i++) sim.tick();
    expect([first, second].filter(frozen)).toHaveLength(1);
  });

  it('one trap at a time: a new trap replaces the old one', () => {
    const { sim, p } = setup();
    sim.castAbility('frost_trap');
    sim.tick();
    expect(trapEntries(sim)).toHaveLength(1);
    p.cooldowns.delete('frost_trap');
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    p.pos.x += 10;
    sim.castAbility('frost_trap');
    sim.tick();
    const traps = trapEntries(sim);
    expect(traps).toHaveLength(1);
    expect(traps[0].pos.x).toBeCloseTo(p.pos.x, 1);
  });
});
