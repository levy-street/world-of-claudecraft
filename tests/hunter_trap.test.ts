import { describe, expect, it } from 'vitest';
import { lineOfSightClear } from '../src/sim/colliders';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  ctx: { groundAoEs: GroundAoE[] };
  addEntity(entity: Entity): void;
  nextId: number;
};

function setup(rows: Record<number, string> = {}): TestSim {
  const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'marksmanship', rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addMobAt(sim: TestSim, x: number, z: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.moveSpeed = 0;
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function clearPoint(sim: TestSim, distance: number): { x: number; z: number } {
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI) / 8;
    const candidate = {
      x: sim.player.pos.x + Math.sin(angle) * distance,
      z: sim.player.pos.z + Math.cos(angle) * distance,
    };
    if (lineOfSightClear(sim.cfg.seed, sim.player.pos, candidate)) return candidate;
  }
  throw new Error('test fixture could not find a clear ranged lane');
}

function trapEntries(sim: TestSim): GroundAoE[] {
  return sim.ctx.groundAoEs.filter((effect) => effect.hunterTrap !== undefined);
}

function advance(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...sim.tick());
  return events;
}

function rooted(mob: Entity): boolean {
  return mob.auras.some((aura) => aura.id === 'frostjaw_trap_freeze');
}

describe('Frostjaw Trap', () => {
  it('places at the selected enemy or the hunter, arms, and then triggers', () => {
    const sim = setup();
    sim.castAbility('frostjaw_trap');
    sim.tick();
    const trap = trapEntries(sim)[0];
    expect(trap.pos.x).toBeCloseTo(sim.player.pos.x, 1);
    expect(trap.pos.z).toBeCloseTo(sim.player.pos.z, 1);

    const early = addMobAt(sim, trap.pos.x, trap.pos.z);
    sim.tick();
    expect(rooted(early)).toBe(false);

    advance(sim, 20);
    expect(rooted(early)).toBe(true);
    expect(trapEntries(sim)).toHaveLength(0);
  });

  it('uses the selected enemy as its placement center', () => {
    const sim = setup();
    const selected = addMobAt(sim, sim.player.pos.x, sim.player.pos.z + 20);
    sim.targetEntity(selected.id);
    const selectedPos = { ...selected.pos };

    sim.castAbility('frostjaw_trap');
    sim.tick();

    const trap = trapEntries(sim)[0];
    expect(trap.pos.x).toBeCloseTo(selectedPos.x, 1);
    expect(trap.pos.z).toBeCloseTo(selectedPos.z, 1);
  });

  it('roots one enemy and slows every enemy in the trigger area', () => {
    const sim = setup();
    sim.castAbility('frostjaw_trap');
    sim.tick();
    const trap = trapEntries(sim)[0];
    const first = addMobAt(sim, trap.pos.x, trap.pos.z);
    const second = addMobAt(sim, trap.pos.x + 0.5, trap.pos.z);

    advance(sim, 20);

    expect([first, second].filter(rooted)).toHaveLength(1);
    expect(
      [first, second].filter((mob) => mob.auras.some((aura) => aura.kind === 'slow')),
    ).toHaveLength(2);
  });

  it('lets Binding Payload root the full trigger area', () => {
    const sim = setup({ 11: 'hun_r11_binding_payload' });
    sim.castAbility('frostjaw_trap');
    sim.tick();
    const trap = trapEntries(sim)[0];
    const first = addMobAt(sim, trap.pos.x, trap.pos.z);
    const second = addMobAt(sim, trap.pos.x + 0.5, trap.pos.z);

    advance(sim, 20);

    expect([first, second].filter(rooted)).toHaveLength(2);
  });

  it('links Trapcraft and Chain Reaction to the authoritative trigger', () => {
    const sim = setup({
      14: 'hun_r14_trapcraft',
      20: 'hun_r20_chain_reaction',
    });
    sim.player.resource = 0;
    sim.player.cooldowns.set('trailbreak', 20);
    sim.castAbility('frostjaw_trap');
    sim.tick();
    const trap = trapEntries(sim)[0];
    const first = addMobAt(sim, trap.pos.x, trap.pos.z);
    const second = addMobAt(sim, trap.pos.x + 0.5, trap.pos.z);

    advance(sim, 20);

    expect(sim.player.resource).toBeGreaterThanOrEqual(20);
    expect(sim.player.cooldowns.get('trailbreak')).toBeLessThanOrEqual(15);
    expect(first.auras.some((aura) => aura.id.startsWith('hunter_chain_mark'))).toBe(true);
    expect(second.auras.some((aura) => aura.id.startsWith('hunter_chain_mark'))).toBe(true);
    expect(sim.player.auras.find((aura) => aura.id === 'hunter_chain_reaction_uses')?.stacks).toBe(
      3,
    );
  });

  it('echoes the next three Focus spenders between Chain Reaction marks', () => {
    const sim = setup({ 20: 'hun_r20_chain_reaction' });
    const center = clearPoint(sim, 20);
    const first = addMobAt(sim, center.x, center.z);
    const second = addMobAt(sim, center.x + 0.5, center.z);
    sim.targetEntity(first.id);
    sim.castAbility('frostjaw_trap');
    sim.tick();
    advance(sim, 20);
    sim.player.resource = sim.player.maxResource;
    sim.player.gcdRemaining = 0;

    sim.castAbility('arcane_shot');
    const events = advance(sim, 40);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        targetId: second.id,
        ability: 'Chain Reaction',
      }),
    );
    expect(sim.player.auras.find((aura) => aura.id === 'hunter_chain_reaction_uses')?.stacks).toBe(
      2,
    );
  });

  it('replaces the previous trap when a new one is placed', () => {
    const sim = setup();
    sim.castAbility('frostjaw_trap');
    sim.tick();
    expect(trapEntries(sim)).toHaveLength(1);
    sim.player.cooldowns.delete('frostjaw_trap');
    sim.player.gcdRemaining = 0;
    sim.player.pos.x += 10;

    sim.castAbility('frostjaw_trap');
    sim.tick();

    const traps = trapEntries(sim);
    expect(traps).toHaveLength(1);
    expect(traps[0].pos.x).toBeCloseTo(sim.player.pos.x, 1);
  });
});
