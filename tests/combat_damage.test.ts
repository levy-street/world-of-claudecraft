// Direct unit tests for src/sim/combat/damage.ts (C1). The post-mitigation damage
// pipeline is exercised by importing the module functions and calling them against a
// real Sim.ctx (so the SimContext seam, entities, players and rng are the real
// shared ones the engine uses). This proves the extracted module is callable on its
// own and that the moved behavior (amp stack, absorb soak, death routing, the single
// frenzy rng draw, and the xp-grant chain) is intact.

import { describe, expect, it } from 'vitest';
import { dealDamage, grantXp, handleDeath } from '../src/sim/combat/damage';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 4242): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

// Spawn a hostile mob and register it on the roster (entities + spatial grids).
function spawnHostileMob(sim: Sim, key: string, level: number): AnyEntity {
  const p = sim.player as AnyEntity;
  const mob = createMob(sim.nextId++, MOBS[key], level, {
    x: p.pos.x + 2,
    y: p.pos.y,
    z: p.pos.z,
  }) as AnyEntity;
  mob.hostile = true;
  sim.addEntity(mob);
  return mob;
}

describe('combat/damage dealDamage (post-mitigation)', () => {
  it('applies the integer amount verbatim and emits a damage event (no mitigation pulled in)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    mob.maxHp = 5000;
    mob.hp = 5000;
    sim.drainEvents();

    dealDamage(sim.ctx, p, mob, 100, false, 'physical', null, 'hit');

    expect(mob.hp).toBe(4900); // exactly amount; overkill/crit/dodge/armor are upstream
    const events = sim.drainEvents();
    const dmg = events.find((e) => e.type === 'damage' && (e as any).targetId === mob.id) as any;
    expect(dmg).toBeTruthy();
    expect(dmg.amount).toBe(100);
  });

  it('does not break unbreakable encounter control when the target takes damage', () => {
    const sim = makeSim();
    const player = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    player.auras.push({
      id: 'scripted_incapacitate',
      name: 'Scripted Incapacitate',
      kind: 'incapacitate',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: mob.id,
      school: 'shadow',
      breaksOnDamage: true,
      unbreakableControl: true,
    } as Aura & { unbreakableControl: true });

    dealDamage(sim.ctx, mob, player, 1, false, 'physical', null, 'hit');

    expect(player.auras.some((a: Aura) => a.id === 'scripted_incapacitate')).toBe(true);
  });

  it('vulnerability amplifies before absorb soaks', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    mob.maxHp = 5000;
    mob.hp = 5000;
    // +50% vulnerability, then a 30-point absorb shield.
    mob.auras.push({
      id: 'v',
      name: 'Frailty',
      kind: 'vulnerability',
      remaining: 9,
      duration: 9,
      value: 0.5,
      sourceId: p.id,
      school: 'shadow',
    } as Aura);
    mob.auras.push({
      id: 'a',
      name: 'Shield',
      kind: 'absorb',
      remaining: 9,
      duration: 9,
      value: 30,
      sourceId: mob.id,
      school: 'physical',
    } as Aura);

    dealDamage(sim.ctx, p, mob, 100, false, 'physical', null, 'hit');

    // 100 -> *1.5 = 150 amplified, then absorb soaks 30 -> 120 lands.
    expect(mob.hp).toBe(4880);
    expect(mob.auras.some((a) => a.kind === 'absorb')).toBe(false); // shield fully consumed + spliced
  });

  it('emits the absorbed amount on the damage event without changing landed damage', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    mob.maxHp = 5000;
    mob.hp = 5000;
    mob.auras.push({
      id: 'a',
      name: 'Shield',
      kind: 'absorb',
      remaining: 9,
      duration: 9,
      value: 30,
      sourceId: mob.id,
      school: 'physical',
    } as Aura);
    sim.drainEvents();

    dealDamage(sim.ctx, p, mob, 100, false, 'physical', null, 'hit');

    const dmg = sim.drainEvents().find((e) => e.type === 'damage' && e.targetId === mob.id);
    expect(dmg).toMatchObject({ type: 'damage', amount: 70, absorbed: 30 });
    expect(mob.hp).toBe(4930);
  });

  it('emits the cheat-death save moment when a killing blow is prevented', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    p.hp = 20;
    sim.drainEvents();

    const ctx = sim.ctx as typeof sim.ctx & {
      playerMods: typeof sim.ctx.playerMods;
    };
    const originalPlayerMods = ctx.playerMods;
    ctx.playerMods = ((meta) => {
      const mods = originalPlayerMods.call(ctx, meta);
      return { ...mods, global: { ...mods.global, cheatDeathIcd: 90 } };
    }) as typeof sim.ctx.playerMods;

    dealDamage(ctx, null, p, 50, false, 'physical', null, 'hit');

    expect(p.hp).toBe(1);
    const events = sim.drainEvents();
    expect(
      events.some((e) => e.type === 'spellfx' && e.fx === 'wardBloom' && e.targetId === p.id),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'log' && e.pid === p.id && e.text === 'A deathward saves you!'),
    ).toBe(true);
  });

  it('routes a lethal blow into handleDeath (mob dies, death event)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    mob.maxHp = 200;
    mob.hp = 50;
    sim.drainEvents();

    dealDamage(sim.ctx, p, mob, 100, false, 'physical', null, 'hit');

    expect(mob.hp).toBe(0);
    expect(mob.dead).toBe(true);
    expect(
      sim.drainEvents().some((e) => e.type === 'death' && (e as any).entityId === mob.id),
    ).toBe(true);
  });

  it('drives the only in-slice rng draw via maybeFrenzyOnHit (frenzyOnHit mob gains blood_frenzy)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    const p = sim.player as AnyEntity;
    const mob = spawnHostileMob(sim, 'old_greyjaw', 6);
    mob.maxHp = 9000;
    mob.hp = 9000;
    const trait = MOBS.old_greyjaw.frenzyOnHit;
    const orig = trait?.chance;
    try {
      if (trait) trait.chance = 1; // the draw still fires; outcome is forced for the assert
      dealDamage(sim.ctx, p, mob, 40, false, 'physical', null, 'hit');
    } finally {
      if (trait && orig !== undefined) trait.chance = orig;
    }
    expect(mob.auras.some((a) => a.id === 'blood_frenzy')).toBe(true);
  });
});

describe('combat/damage grantXp', () => {
  it('awards xp, accrues lifetime xp, and levels the player up', () => {
    const sim = makeSim();
    sim.setPlayerLevel(1);
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(p.id) as any;
    const beforeLevel = p.level;
    const beforeLifetime = meta.lifetimeXp;

    grantXp(sim.ctx, 100000, meta);

    expect(p.level).toBeGreaterThan(beforeLevel);
    expect(meta.lifetimeXp).toBe(beforeLifetime + 100000);
  });

  it('ignores a non-positive award', () => {
    const sim = makeSim();
    sim.setPlayerLevel(5);
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(p.id) as any;
    const before = meta.lifetimeXp;
    grantXp(sim.ctx, 0, meta);
    expect(meta.lifetimeXp).toBe(before);
  });
});

describe('combat/damage handleDeath', () => {
  it('credits the tapping player and tears down the slain mob', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(p.id) as any;
    const mob = spawnHostileMob(sim, 'forest_wolf', 5);
    mob.tappedById = p.id;
    mob.auras.push({
      id: 'x',
      name: 'Buff',
      kind: 'buff_haste',
      remaining: 9,
      duration: 9,
      value: 1.2,
      sourceId: mob.id,
      school: 'physical',
    } as Aura);
    const kills = meta.counters.kills;

    handleDeath(sim.ctx, mob, p);

    expect(mob.dead).toBe(true);
    expect(mob.auras.length).toBe(0); // auras cleared on death
    expect(meta.counters.kills).toBe(kills + 1); // kill credit went to the tapper
  });

  it('does not put an enemy-owned pet into evade when its player target dies', () => {
    const sim = new Sim({ seed: 909, playerClass: 'hunter', noPlayer: true, autoEquip: true });
    const ownerId = sim.addPlayer('hunter', 'Hunter');
    const victimId = sim.addPlayer('warrior', 'Victim');
    sim.setPlayerLevel(10, ownerId);
    sim.setPlayerLevel(10, victimId);
    const owner = sim.entities.get(ownerId) as AnyEntity;
    const victim = sim.entities.get(victimId) as AnyEntity;
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, owner.level, {
      x: owner.pos.x + 2,
      y: owner.pos.y,
      z: owner.pos.z,
    }) as AnyEntity;
    pet.ownerId = owner.id;
    pet.hostile = false;
    pet.aiState = 'attack';
    pet.aggroTargetId = victim.id;
    pet.inCombat = true;
    pet.threat.clear();
    sim.addEntity(pet);

    handleDeath(sim.ctx, victim, owner);

    expect(pet.dead).toBe(false);
    expect(pet.aiState).toBe('idle');
    expect(pet.aggroTargetId).toBeNull();
    expect(pet.inCombat).toBe(false);
    const hpBefore = pet.hp;
    dealDamage(sim.ctx, victim, pet, 5, false, 'physical', 'Test Strike', 'hit');
    expect(pet.hp).toBe(hpBefore - 5);
  });
});
