import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// G5 (fix/talents2-balance-pass): fears no longer insta-break on any damage.
// The fear family (Harrow, Dread Chorus, Morrowlash, Terror Canticle) carries
// breakChanceScale: each damage event breaks the fear with probability
// min(1, amount / (scale * maxHp)), so big hits reliably break it and dot
// ticks usually do not (the classic behavior that makes dot-then-fear a
// warlock rotation instead of an anti-combo). Plain incapacitates (Eye Jab,
// Wyvern Sting, Startle Shot) keep the classic break-on-any-damage rule, and
// the warrior Lingering Dread soak threshold is unchanged.

function addTarget(sim: Sim, distance: number, level = 20): Entity {
  const player = sim.player;
  const mob = createMob(20_000 + sim.entities.size, MOBS.forest_wolf, level, {
    x: player.pos.x + distance,
    y: player.pos.y,
    z: player.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle'; // stay passive so cast-time spells finish without pushback
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
  return mob;
}

function fearAura(target: Entity): Aura | undefined {
  return target.auras.find((aura) => aura.kind === 'incapacitate');
}

function dealHit(sim: Sim, target: Entity, amount: number): void {
  (
    sim as unknown as {
      ctx: {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string | null,
          kind: string,
          aoe: boolean,
          threat: { flat: number; mult: number },
        ): void;
      };
    }
  ).ctx.dealDamage(sim.player, target, amount, false, 'physical', 'test hit', 'hit', false, {
    flat: 0,
    mult: 1,
  });
}

describe('G5: damage-scaled fear break', () => {
  it('a hit at or above scale * maxHp always breaks a chance-scaled fear', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    const mob = addTarget(sim, 3);
    mob.auras.push({
      id: 'test_fear',
      name: 'Test Fear',
      kind: 'incapacitate',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'shadow',
      breaksOnDamage: true,
      breakChanceScale: 0.1,
    } as Aura);
    dealHit(sim, mob, Math.ceil(mob.maxHp * 0.1)); // chance clamps to 1
    expect(fearAura(mob)).toBeUndefined();
  });

  it('a tiny hit usually leaves a chance-scaled fear standing (seeded draw)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    const mob = addTarget(sim, 3);
    mob.auras.push({
      id: 'test_fear',
      name: 'Test Fear',
      kind: 'incapacitate',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'shadow',
      breaksOnDamage: true,
      breakChanceScale: 0.1,
    } as Aura);
    dealHit(sim, mob, 1); // chance 1 / 10000 with the seeded rng: survives
    expect(fearAura(mob)).toBeDefined();
  });

  it('Harrow applies a chance-scaled fear', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(14);
    const mob = addTarget(sim, 3);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('fear');
    // 1.5s cast, then the fear rides a projectile (spellfx projectile) and
    // applies on arrival: give both legs room.
    for (let i = 0; i < 80; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Harrow fear aura').toBeDefined();
    expect(aura?.breaksOnDamage).toBe(true);
    expect(aura?.breakChanceScale).toBeCloseTo(0.1);
  });

  it('Terror Canticle (aoeFear) applies chance-scaled fears', () => {
    const sim = new Sim({ seed: 7, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 8: 'pri_r8_psychic_scream' } })).toBe(true);
    const mob = addTarget(sim, 3);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('psychic_scream');
    for (let i = 0; i < 6; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Terror Canticle fear aura').toBeDefined();
    expect(aura?.breakChanceScale).toBeCloseTo(0.1);
  });

  it('Eye Jab stays a classic incapacitate: any damage breaks it', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(10);
    const mob = addTarget(sim, 2);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('gouge');
    for (let i = 0; i < 6; i++) sim.tick();
    const aura = fearAura(mob);
    expect(aura, 'Eye Jab incapacitate aura').toBeDefined();
    expect(aura?.breakChanceScale).toBeUndefined();
    dealHit(sim, mob, 1);
    expect(fearAura(mob)).toBeUndefined();
  });
});
