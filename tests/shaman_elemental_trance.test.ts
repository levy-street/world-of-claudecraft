// Elemental Trance: the Warspirit (Enhancement) level-20 defensive signature.
// 2 min cooldown, 15 sec duration, damage taken reduced by 30%, and 20% of all
// damage the shaman deals converted to mana while the trance is active.

import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const TRANCE_ID = 'elemental_trance';

function knownIdsAt(level: number, spec: string | null): string[] {
  const mods = computeTalentModifiers('shaman', {
    ...emptyAllocation(),
    spec,
  } as never);
  return abilitiesKnownAt('shaman', level, mods).map((known) => known.def.id);
}

function rig(): { sim: Sim; p: Entity; mob: Entity } {
  const sim = new Sim({
    seed: 2841,
    playerClass: 'shaman',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('shaman', 'Trancer');
  sim.setPlayerLevel(20, pid);
  expect(sim.applyTalents({ spec: 'enhancement', rows: {} }, pid)).toBe(true);
  const p = sim.entities.get(pid)!;
  p.resource = p.maxResource;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x + 2,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return { sim, p, mob };
}

function castTrance(sim: Sim, p: Entity): void {
  sim.castAbility(TRANCE_ID, p.id);
  sim.drainEvents();
  expect(p.auras.some((aura) => aura.id === TRANCE_ID)).toBe(true);
}

describe('Elemental Trance', () => {
  it('is an Enhancement signature learned at level 20', () => {
    expect(knownIdsAt(20, 'enhancement')).toContain(TRANCE_ID);
    expect(knownIdsAt(19, 'enhancement')).not.toContain(TRANCE_ID);
    expect(knownIdsAt(20, 'elemental')).not.toContain(TRANCE_ID);
    expect(knownIdsAt(20, 'restoration')).not.toContain(TRANCE_ID);
    expect(knownIdsAt(20, null)).not.toContain(TRANCE_ID);
  });

  it('lasts 15 seconds on a 2 minute cooldown', () => {
    const { sim, p } = rig();
    castTrance(sim, p);
    const aura = p.auras.find((a) => a.id === TRANCE_ID)!;
    expect(aura.duration).toBe(15);
    expect(aura.remaining).toBe(15);
    expect(p.cooldowns.get(TRANCE_ID) ?? 0).toBeGreaterThan(119);
    // The trance self-expires: 15 sec later the buff is gone.
    for (let tick = 0; tick < 20 * 16; tick++) sim.tick();
    expect(p.auras.some((a) => a.id === TRANCE_ID)).toBe(false);
  });

  it('reduces damage taken by 30% while active', () => {
    const { sim, p, mob } = rig();
    const hpBeforeBaseline = p.hp;
    sim.ctx.dealDamage(mob, p, 100, false, 'nature', 'Test Strike', 'hit');
    const baselineLoss = hpBeforeBaseline - p.hp;
    expect(baselineLoss).toBe(100);

    p.hp = p.maxHp;
    castTrance(sim, p);
    const hpBefore = p.hp;
    sim.ctx.dealDamage(mob, p, 100, false, 'nature', 'Test Strike', 'hit');
    expect(hpBefore - p.hp).toBe(70);
  });

  it('converts 20% of all damage dealt to mana while active, capped at maximum', () => {
    const { sim, p, mob } = rig();
    castTrance(sim, p);
    p.resource = 0;
    sim.ctx.dealDamage(p, mob, 100, false, 'nature', 'Test Strike', 'hit');
    expect(p.resource).toBe(20);
    // Any school converts: a physical hit feeds the same trance.
    sim.ctx.dealDamage(p, mob, 250, false, 'physical', null, 'hit');
    expect(p.resource).toBe(70);
    // The gain clamps at maximum mana instead of overflowing.
    p.resource = p.maxResource - 5;
    sim.ctx.dealDamage(p, mob, 100, false, 'nature', 'Test Strike', 'hit');
    expect(p.resource).toBe(p.maxResource);
  });

  it('grants no mana without the trance', () => {
    const { sim, p, mob } = rig();
    p.resource = 0;
    sim.ctx.dealDamage(p, mob, 100, false, 'nature', 'Test Strike', 'hit');
    expect(p.resource).toBe(0);
  });
});
