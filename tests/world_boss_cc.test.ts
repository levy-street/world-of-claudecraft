// A cc-immune mob (a raid boss like Thunzharr) can never be polymorphed. The bug: the
// polymorph EFFECT ran `target.hp = target.maxHp` (the sheep full-heal) BEFORE the aura
// was applied, and the aura was then dropped by the ccImmune gate, so casting Polymorph
// on the boss healed him to full without sheeping him: he "reset" mid-fight. These tests
// pin that a cc-immune target is left entirely untouched, while normal poly is unchanged.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeMage(seed = 42): Sim {
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20); // knows Polymorph
  return sim;
}

function spawnMobAtPlayer(sim: Sim, templateId: string, level: number): Entity {
  const p = sim.player;
  const mob = createMob((sim as any).nextId++, MOBS[templateId], level, {
    x: p.pos.x + 5,
    y: p.pos.y,
    z: p.pos.z,
  });
  (sim as any).entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

function castPolymorphAt(sim: Sim, mob: Entity): void {
  const p = sim.player;
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id);
  sim.castAbility('polymorph');
  for (let i = 0; i < 20 * 2; i++) sim.tick();
}

describe('polymorph vs a cc-immune raid boss', () => {
  it('rejects Polymorph on a cc-immune mob, so it is never sheeped or full-healed', () => {
    const sim = makeMage();
    const boss = spawnMobAtPlayer(sim, 'thunzharr_waking_peak', 20);
    boss.hp = Math.floor(boss.maxHp * 0.4); // hurt mid-fight

    const p = sim.player;
    p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
    sim.targetEntity(boss.id);
    sim.castAbility('polymorph');
    const events = sim.tick();

    // The cast is rejected outright, so the polymorph effect (and its sheep full-heal
    // side effect, the "he just reset to full" bug) never runs.
    expect(
      events.some(
        (e) => e.type === 'error' && /cannot be polymorphed/i.test((e as { text: string }).text),
      ),
    ).toBe(true);
    expect(boss.auras.some((a) => a.kind === 'polymorph')).toBe(false);
    // Its HP was not snapped to full; one tick of idle regen cannot reach maxHp from 40%.
    expect(boss.hp).toBeLessThan(boss.maxHp);
  });

  it('still sheeps a normal, non-immune mob (poly is otherwise unchanged)', () => {
    const sim = makeMage();
    const wolf = spawnMobAtPlayer(sim, 'forest_wolf', 5);

    castPolymorphAt(sim, wolf);

    // The regression guard: a non-immune mob is still sheeped. (The sheep full-heal
    // itself is covered by tests/sim.test.ts; here we only prove immunity is targeted.)
    expect(wolf.auras.some((a) => a.kind === 'polymorph')).toBe(true);
  });
});
