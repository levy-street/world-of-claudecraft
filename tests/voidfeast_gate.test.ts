import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// Voidfeast gate (maintainer request): the devour is ONLY castable when the
// target actually carries a dispellable effect (a beneficial magic effect on
// an enemy, or a harmful one on an ally). A no-food cast is refused at the
// cast gate BEFORE billing (the judgement no-Seal precedent): no mana, no
// cooldown. Other dispel abilities (Cleansing Verdict, Spellsteal) keep the
// old fire-anyway behavior; the gate is the requiresDispellable opt-in.

type Ev = { type?: string; text?: string };

function setup(): { sim: Sim; p: Entity; mob: Entity; events: Ev[] } {
  const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(10);
  expect(sim.applyTalents({ spec: null, rows: { 8: 'wlk_r8_voidfeast' } })).toBe(true);
  const p = sim.player;
  const mob = createMob(20_000, MOBS.forest_wolf, 8, {
    x: p.pos.x + 3,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  p.resource = p.maxResource;
  const events: Ev[] = [];
  const anySim = sim as unknown as { emit(e: Ev): void };
  const orig = anySim.emit.bind(sim);
  anySim.emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return { sim, p, mob, events };
}

function buffAura(sourceId: number): Aura {
  return {
    id: 'test_buff',
    name: 'Test Blessing',
    kind: 'buff_ap',
    remaining: 30,
    duration: 30,
    value: 20,
    sourceId,
    school: 'holy',
  } as Aura;
}

describe('Voidfeast is only usable with something to devour', () => {
  it('refuses a clean enemy target before billing: no mana, no cooldown', () => {
    const { sim, p, events } = setup();
    const manaBefore = p.resource;
    sim.castAbility('voidfeast');
    sim.tick();
    expect(events.some((e) => e.type === 'error' && /nothing to devour/i.test(e.text ?? ''))).toBe(
      true,
    );
    expect(p.resource).toBe(manaBefore);
    expect(p.cooldowns.has('voidfeast')).toBe(false);
  });

  it('devours a beneficial magic effect from an enemy and heals 6% max health', () => {
    const { sim, p, mob, events } = setup();
    mob.auras.push(buffAura(mob.id));
    p.hp = Math.round(p.maxHp * 0.5);
    sim.castAbility('voidfeast');
    // The devour rides a projectile: give it room to land. The heal is
    // asserted via its event (the angered wolf chips hp during the ticks).
    for (let i = 0; i < 15; i++) sim.tick();
    expect(mob.auras.some((aura) => aura.id === 'test_buff')).toBe(false);
    const expectedHeal = Math.round(p.maxHp * 0.06);
    expect(
      (events as { type?: string; targetId?: number; amount?: number; ability?: string }[]).some(
        (e) =>
          e.type === 'heal2' &&
          e.targetId === p.id &&
          e.ability === 'Voidfeast' &&
          (e.amount ?? 0) >= expectedHeal, // crit may inflate the base 6%
      ),
    ).toBe(true);
    expect(p.cooldowns.has('voidfeast')).toBe(true);
  });

  it('a physical-school effect is not food: still refused', () => {
    const { sim, p, mob, events } = setup();
    mob.auras.push({ ...buffAura(mob.id), school: 'physical' } as Aura);
    sim.castAbility('voidfeast');
    sim.tick();
    expect(events.some((e) => e.type === 'error' && /nothing to devour/i.test(e.text ?? ''))).toBe(
      true,
    );
    expect(mob.auras.some((aura) => aura.id === 'test_buff')).toBe(true);
  });

  it('Cleansing Verdict keeps the old behavior on a clean target (no gate)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(10);
    expect(sim.applyTalents({ spec: null, rows: { 8: 'pal_r8_cleansing_verdict' } })).toBe(true);
    const p = sim.player;
    p.resource = p.maxResource;
    sim.targetEntity(p.id);
    const manaBefore = p.resource;
    sim.castAbility('cleansing_verdict');
    sim.tick();
    expect(p.resource).toBeLessThan(manaBefore); // billed: the cast went through
  });
});
