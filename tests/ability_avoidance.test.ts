// Avoidance belongs to the shared resolution funnel, not to one delivery path.
// Two arms regressed by being bolted onto a single path each:
//   A. an INSTANT hostile spell (`projectile: false`) skipped the resist roll the
//      projectile arm does on impact, so Cinderfall and friends landed 100% of the
//      time and Hit rating did nothing for them.
//   B. a physical `directDamage` special never rolled a swing miss at all, unlike
//      the `sunder` effect right next to it.
// These pin both arms plus the two carve-outs that must NEVER roll: taunts (a
// resisted taunt silently breaks tanking) and friendly/self casts.

import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// chance(p) is `next() < p`, so a draw of 0 makes every roll succeed and a draw
// just under 1 makes every roll fail. Pinning next() (rather than chance()) keeps
// these tests indifferent to how many draws upstream code takes.
const ALWAYS = 0;
const NEVER = 0.999999;

// The threat a pull seeds on its own (aggroMob), independent of any damage dealt.
const AGGRO_SEED_THREAT = 1;

function makeSim(cls: PlayerClass, level: number): { sim: AnySim; p: AnyEntity; meta: any } {
  const sim = new Sim({ seed: 1234, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  p.resource = p.maxResource;
  return { sim, p, meta: sim.players.get(p.id) };
}

function spawnTarget(sim: AnySim, p: AnyEntity, level: number, distance = 3): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + distance,
  }) as AnyEntity;
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function capture(sim: AnySim): any[] {
  const events: any[] = [];
  sim.ctx.emit = (e: any) => events.push(e);
  return events;
}

function finishCast(sim: AnySim, p: AnyEntity, meta: any): void {
  let n = 0;
  while (p.castingAbility && n++ < 1000) updateCasting(sim.ctx, p, meta);
}

function damageOn(events: any[], target: AnyEntity): any[] {
  return events.filter((e) => e.type === 'damage').filter((e) => e.targetId === target.id);
}

function advanceProjectiles(sim: AnySim): void {
  let n = 0;
  while (sim.ctx.pendingProjectiles.length > 0 && n++ < 1000) sim.tick();
}

describe('instant hostile spells roll spell resist', () => {
  it('a resisted instant spell emits a zero-damage resist and no effect', () => {
    const { sim, p, meta } = makeSim('mage', 12);
    expect(sim.setSpec('fire', p.id)).toBe(true);
    const mob = spawnTarget(sim, p, 15);
    sim.rng.next = () => NEVER;

    const events = capture(sim);
    castAbility(sim.ctx, 'fire_blast', p.id);
    finishCast(sim, p, meta);

    const dmg = damageOn(events, mob);
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.kind === 'resist')).toBe(true);
    expect(dmg.every((e) => e.amount === 0)).toBe(true);
    expect(mob.hp).toBe(mob.maxHp);
  });

  it('enough Hit rating removes the resist entirely for the same instant cast', () => {
    const { sim, p, meta } = makeSim('mage', 12);
    expect(sim.setSpec('fire', p.id)).toBe(true);
    const mob = spawnTarget(sim, p, 15);
    // hitBonus is added to spell hit and capped at 1, so a full point of Hit makes
    // the same pinned draw land instead of resisting.
    p.hitBonus = 1;
    sim.rng.next = () => NEVER;

    const events = capture(sim);
    castAbility(sim.ctx, 'fire_blast', p.id);
    finishCast(sim, p, meta);

    const dmg = damageOn(events, mob);
    expect(dmg.some((e) => e.kind === 'resist')).toBe(false);
    expect(dmg.filter((e) => e.kind === 'hit').some((e) => e.amount > 0)).toBe(true);
    expect(mob.hp).toBeLessThan(mob.maxHp);
  });

  it('an instant taunt always lands, even on a draw that resists everything', () => {
    const { sim, p, meta } = makeSim('paladin', 12);
    expect(sim.setSpec('protection', p.id)).toBe(true);
    const mob = spawnTarget(sim, p, 15);
    sim.rng.next = () => NEVER;

    const events = capture(sim);
    castAbility(sim.ctx, 'sacred_challenge', p.id);
    finishCast(sim, p, meta);

    expect(damageOn(events, mob).some((e) => e.kind === 'resist')).toBe(false);
    expect(mob.forcedTargetId).toBe(p.id);
  });

  it('a friendly self cast never rolls a resist', () => {
    const { sim, p, meta } = makeSim('priest', 12);
    p.hp = Math.max(1, p.maxHp - 50);
    sim.rng.next = () => NEVER;

    const events = capture(sim);
    castAbility(sim.ctx, 'renew', p.id, undefined, p.id);
    finishCast(sim, p, meta);

    expect(damageOn(events, p).some((e) => e.kind === 'resist')).toBe(false);
    expect(p.auras.some((a: any) => a.kind === 'hot')).toBe(true);
  });
});

describe('physical directDamage rolls a swing miss', () => {
  it('a missed physical direct hit deals no damage and generates no threat', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    const mob = spawnTarget(sim, p, 15);
    // Early Grave is an execute: it only resolves under 20% target health.
    mob.hp = Math.round(mob.maxHp * 0.1);
    const hpBefore = mob.hp;
    sim.rng.next = () => ALWAYS;

    const events = capture(sim);
    castAbility(sim.ctx, 'execute', p.id);
    finishCast(sim, p, meta);

    const dmg = damageOn(events, mob);
    expect(dmg.filter((e) => e.kind === 'miss').some((e) => e.amount === 0)).toBe(true);
    expect(dmg.some((e) => e.kind === 'hit')).toBe(false);
    expect(mob.hp).toBe(hpBefore);
    // Pulling the mob seeds AGGRO_SEED_THREAT; a miss adds no damage threat on top.
    expect(mob.threat.get(p.id) ?? 0).toBe(AGGRO_SEED_THREAT);
  });

  it('a missed physical direct hit skips later target effects in the same payload', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    const mob = spawnTarget(sim, p, 15);
    sim.rng.next = () => ALWAYS;

    const events = capture(sim);
    castAbility(sim.ctx, 'hamstring', p.id);
    finishCast(sim, p, meta);

    expect(damageOn(events, mob).some((e) => e.kind === 'miss')).toBe(true);
    expect(mob.auras.some((a) => a.id === 'hamstring_slow')).toBe(false);
  });

  it('a missed physical projectile direct hit skips hit-gated resource returns', () => {
    const { sim, p, meta } = makeSim('hunter', 12);
    expect(sim.setSpec('marksmanship', p.id)).toBe(true);
    const mob = spawnTarget(sim, p, 15, 10);
    p.resource = 0;
    sim.rng.next = () => ALWAYS;

    const events = capture(sim);
    castAbility(sim.ctx, 'measured_shot', p.id);
    finishCast(sim, p, meta);
    advanceProjectiles(sim);

    expect(damageOn(events, mob).some((e) => e.kind === 'miss')).toBe(true);
    expect(p.resource).toBe(0);
  });

  it('enough Hit rating removes the miss entirely for the same physical special', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    const mob = spawnTarget(sim, p, 15);
    mob.hp = Math.round(mob.maxHp * 0.1);
    const hpBefore = mob.hp;
    // swingMissChance subtracts hitBonus with a floor at 0, so a full point of Hit
    // makes the same pinned draw land.
    p.hitBonus = 1;
    sim.rng.next = () => ALWAYS;

    const events = capture(sim);
    castAbility(sim.ctx, 'execute', p.id);
    finishCast(sim, p, meta);

    const dmg = damageOn(events, mob);
    expect(dmg.some((e) => e.kind === 'miss')).toBe(false);
    expect(dmg.filter((e) => e.kind === 'hit').some((e) => e.amount > 0)).toBe(true);
    expect(mob.hp).toBeLessThan(hpBefore);
    expect(mob.threat.get(p.id) ?? 0).toBeGreaterThan(AGGRO_SEED_THREAT);
  });

  it('a spell-school directDamage cast never takes the physical miss roll', () => {
    const { sim, p, meta } = makeSim('mage', 12);
    expect(sim.setSpec('fire', p.id)).toBe(true);
    const mob = spawnTarget(sim, p, 15);
    // ALWAYS makes every chance() succeed, so the spell-hit roll lands (a resist is
    // the INVERSE of that roll): a stray physical miss roll is the only way this
    // cast could still fail.
    sim.rng.next = () => ALWAYS;

    const events = capture(sim);
    castAbility(sim.ctx, 'fire_blast', p.id);
    finishCast(sim, p, meta);

    const dmg = damageOn(events, mob);
    expect(dmg.some((e) => e.kind === 'miss')).toBe(false);
    expect(dmg.filter((e) => e.kind === 'hit').some((e) => e.amount > 0)).toBe(true);
  });
});
