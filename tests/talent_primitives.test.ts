import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, Aura, Entity, PlayerClass } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as unknown as TestSim;
}

function makeSim(cls: PlayerClass, level = 20, seed = 77): { sim: TestSim; p: Entity } {
  const sim = harness(new Sim({ seed, playerClass: cls, autoEquip: true }));
  sim.setPlayerLevel(level);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function spawnTarget(sim: TestSim, p: Entity, dz = 4): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function metaOf(sim: TestSim, p: Entity): PlayerMeta {
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error(`missing player meta for ${p.id}`);
  return meta;
}

function startDuel(sim: TestSim, aPid: number, bPid: number): void {
  sim.duelRequest(bPid, aPid);
  sim.duelAccept(bPid);
  for (let i = 0; i < 20 * 5; i++) {
    sim.tick();
    if (sim.duelFor(aPid)?.state === 'active') break;
  }
}

function entityOf(sim: TestSim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`missing entity ${id}`);
  return entity;
}

function aura(kind: Aura['kind'], id = kind): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 10,
    duration: 10,
    value: 0,
    sourceId: 0,
    school: 'arcane',
  };
}

function interruptRes(lockout = 4): ResolvedAbility {
  const def: AbilityDef = {
    id: 'test_interrupt',
    name: 'Test Interrupt',
    class: 'rogue',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'physical',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout }],
    description: '',
  };
  return {
    def,
    rank: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
}

function fixedDamageRes(
  id: string,
  cls: PlayerClass,
  school: AbilityDef['school'],
): ResolvedAbility {
  const def: AbilityDef = {
    id,
    name: id,
    class: cls,
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school,
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 10, max: 10 }],
    description: '',
  };
  return {
    def,
    rank: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
}

describe('talent primitive P1: interrupt', () => {
  it('cancels a non-physical cast and applies the interrupted school lockout', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mageId = sim.addPlayer('mage', 'Caster');
    sim.setPlayerLevel(20, mageId);
    startDuel(sim, rogue.id, mageId);
    const mage = entityOf(sim, mageId);
    mage.castingAbility = 'fireball';
    mage.castRemaining = 1.25;
    mage.castTotal = 1.5;

    runEffects(sim.ctx, rogue, metaOf(sim, rogue), mage, interruptRes(4));

    expect(mage.castingAbility).toBeNull();
    expect(mage.castRemaining).toBe(0);
    expect(mage.auras).toContainEqual(
      expect.objectContaining({ kind: 'lockout', school: 'fire', remaining: 4, duration: 4 }),
    );
  });

  it('cancels a CHANNEL and locks out its school', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mageId = sim.addPlayer('mage', 'Channeler');
    sim.setPlayerLevel(20, mageId);
    startDuel(sim, rogue.id, mageId);
    const mage = entityOf(sim, mageId);
    mage.castingAbility = 'arcane_missiles';
    mage.channeling = true;
    mage.castRemaining = 2;
    mage.castTotal = 3;
    mage.channelTickEvery = 1;
    mage.channelTickTimer = 1;

    runEffects(sim.ctx, rogue, metaOf(sim, rogue), mage, interruptRes(4));

    expect(mage.castingAbility).toBeNull();
    expect(mage.channeling).toBe(false);
    expect(mage.auras).toContainEqual(
      expect.objectContaining({ kind: 'lockout', school: 'arcane' }),
    );
  });

  it('does nothing against a non-casting target and against a physical cast', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mageId = sim.addPlayer('mage', 'Idle Caster');
    const warriorId = sim.addPlayer('warrior', 'Slammer');
    sim.setPlayerLevel(20, mageId);
    sim.setPlayerLevel(20, warriorId);
    const mage = entityOf(sim, mageId);
    const warrior = entityOf(sim, warriorId);

    runEffects(sim.ctx, rogue, metaOf(sim, rogue), mage, interruptRes());
    expect(mage.auras.some((a) => a.kind === 'lockout')).toBe(false);

    warrior.castingAbility = 'slam';
    warrior.castRemaining = 1;
    warrior.castTotal = 1.5;
    runEffects(sim.ctx, rogue, metaOf(sim, rogue), warrior, interruptRes());
    expect(warrior.castingAbility).toBe('slam');
    expect(warrior.auras.some((a) => a.kind === 'lockout')).toBe(false);
  });

  it('diminishes PvP lockouts to full, half, quarter, then immune', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mageId = sim.addPlayer('mage', 'Caster');
    sim.setPlayerLevel(20, mageId);
    startDuel(sim, rogue.id, mageId);
    const mage = entityOf(sim, mageId);

    const interruptCast = () => {
      mage.auras = mage.auras.filter((a) => a.kind !== 'lockout');
      mage.castingAbility = 'fireball';
      mage.castRemaining = 1.25;
      mage.castTotal = 1.5;
      runEffects(sim.ctx, rogue, metaOf(sim, rogue), mage, interruptRes(8));
      return mage.auras.find((a) => a.kind === 'lockout')?.duration ?? null;
    };

    expect(interruptCast()).toBe(8);
    expect(interruptCast()).toBe(4);
    expect(interruptCast()).toBe(2);
    expect(interruptCast()).toBeNull();
    expect(mage.castingAbility).toBeNull();
  });

  it('does not cancel an uninterruptible ability definition', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mob = spawnTarget(sim, rogue);
    const abilityId = 'test_uninterruptible_cast';
    ABILITIES[abilityId] = {
      id: abilityId,
      name: 'Test Uninterruptible Cast',
      class: 'mage',
      learnLevel: 1,
      cost: 0,
      castTime: 2,
      cooldown: 0,
      range: 30,
      school: 'fire',
      requiresTarget: true,
      uninterruptible: true,
      effects: [{ type: 'directDamage', min: 1, max: 1 }],
      description: '',
    };

    try {
      mob.castingAbility = abilityId;
      mob.castRemaining = 1.25;
      mob.castTotal = 2;

      runEffects(sim.ctx, rogue, metaOf(sim, rogue), mob, interruptRes(4));

      expect(mob.castingAbility).toBe(abilityId);
      expect(mob.castRemaining).toBe(1.25);
      expect(mob.auras.some((a) => a.kind === 'lockout')).toBe(false);
    } finally {
      delete ABILITIES[abilityId];
    }
  });

  it('prevents the locked school from being cast until the lockout expires', () => {
    const { sim, p: rogue } = makeSim('rogue');
    const mageId = sim.addPlayer('mage', 'Caster');
    sim.setPlayerLevel(20, mageId);
    startDuel(sim, rogue.id, mageId);
    const mage = entityOf(sim, mageId);
    mage.resource = mage.maxResource;
    spawnTarget(sim, mage);
    mage.castingAbility = 'fireball';
    mage.castRemaining = 1;
    mage.castTotal = 1.5;
    runEffects(sim.ctx, rogue, metaOf(sim, rogue), mage, interruptRes(0.15));

    sim.castAbility('fireball', mage.id);
    expect(mage.castingAbility).toBeNull();

    for (let i = 0; i < 4; i++) sim.tick();
    mage.gcdRemaining = 0;
    mage.resource = mage.maxResource;
    sim.castAbility('fireball', mage.id);
    expect(mage.castingAbility).toBe('fireball');
    expect(mage.castRemaining).toBeGreaterThan(0);
  });
});

describe('talent primitive P3: empower next', () => {
  it('next_cast_instant zeroes exactly one cast and is consumed', () => {
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    p.auras.push(aura('next_cast_instant'));

    sim.castAbility('fireball');
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(false);

    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
    expect(p.castRemaining).toBeGreaterThan(0);
  });

  it('next_cast_free zeroes exactly one cost and is consumed', () => {
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    p.resource = 0;
    p.auras.push(aura('next_cast_free'));

    sim.castAbility('fire_blast');
    expect(p.resource).toBe(0);
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);

    p.gcdRemaining = 0;
    p.cooldowns.delete('fire_blast');
    sim.castAbility('fire_blast');
    expect(p.resource).toBe(0);
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'error' && e.pid === p.id && e.text === 'Not enough mana!'),
    ).toBe(true);
  });

  it('next_attack_crit forces exactly one crit without changing rng draw count', () => {
    const run = (empowered: boolean): { crits: boolean[]; draws: number } => {
      const { sim, p } = makeSim('rogue', 20, 9001);
      const target = spawnTarget(sim, p);
      p.critChance = 0;
      if (empowered) p.auras.push(aura('next_attack_crit'));
      let draws = 0;
      const crits: boolean[] = [];
      sim.rng.setObserver(() => {
        draws++;
      });
      sim.drainEvents();
      runEffects(
        sim.ctx,
        p,
        metaOf(sim, p),
        target,
        fixedDamageRes('test_hit', 'rogue', 'physical'),
      );
      runEffects(
        sim.ctx,
        p,
        metaOf(sim, p),
        target,
        fixedDamageRes('test_hit', 'rogue', 'physical'),
      );
      for (const ev of sim.drainEvents()) {
        if (ev.type === 'damage' && ev.sourceId === p.id && ev.ability === 'test_hit') {
          crits.push(ev.crit);
        }
      }
      sim.rng.setObserver(null);
      return { crits, draws };
    };

    const normal = run(false);
    const empowered = run(true);
    expect(normal.draws).toBe(empowered.draws);
    expect(normal.crits).toEqual([false, false]);
    expect(empowered.crits).toEqual([true, false]);
  });

  it('next_cast_free on a CAST-TIME spell survives cast start and zeroes the completion bill', () => {
    // Cost is billed at cast COMPLETION (applyAbility re-resolves the ability),
    // so the free charge must not be consumed at cast start or the player would
    // pay full price anyway. Regression for the start-consume bug.
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    p.resource = 0;
    p.auras.push(aura('next_cast_free'));

    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(true);

    const events = [];
    for (let i = 0; i < 200 && p.castingAbility; i++) events.push(...sim.tick());
    // the bolt may still be in flight after the cast completes; let it land
    for (let i = 0; i < 40; i++) events.push(...sim.tick());
    expect(p.castingAbility).toBeNull();
    // Consumed at completion (where the bill lands), the cast resolved for free
    // (no mana error despite starting at 0), and the hit actually landed.
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
    expect(events.some((e) => e.type === 'error' && e.text === 'Not enough mana!')).toBe(false);
    expect(events.some((e) => e.type === 'damage' && e.sourceId === p.id)).toBe(true);
  });

  it('a channel neither shortens from next_cast_instant nor consumes the charge', () => {
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    p.auras.push(aura('next_cast_instant'));

    sim.castAbility('arcane_missiles');
    expect(p.channeling).toBe(true);
    expect(p.castTotal).toBeGreaterThan(0);
    expect(p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(true);
  });

  it('next_cast_free rides an on-next-swing queue: consumed at queue, swing lands at 0 rage', () => {
    const { sim, p } = makeSim('warrior');
    spawnTarget(sim, p);
    p.resource = 0;
    p.auras.push(aura('next_cast_free'));

    sim.castAbility('heroic_strike');
    // consumed the moment it queues; the entity flag carries the discount
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
    expect(p.queuedOnSwing).toBe('heroic_strike');
    expect(p.queuedOnSwingFree).toBe(true);

    const events = [];
    for (let i = 0; i < 100 && p.queuedOnSwing; i++) {
      p.resource = 0; // pin rage at 0 so only the free flag can pay the bill
      events.push(...sim.tick());
    }
    expect(p.queuedOnSwing).toBeNull();
    expect(p.queuedOnSwingFree).toBeUndefined();
    expect(
      events.some(
        (e) => e.type === 'damage' && e.sourceId === p.id && e.ability === 'Reaver Strike',
      ),
    ).toBe(true);
  });

  it('a free conjure consumes the charge where the bill lands (early-return branch)', () => {
    const { sim, p } = makeSim('mage');
    p.resource = 0;
    p.auras.push(aura('next_cast_free'));

    sim.castAbility('conjure_water');
    for (let i = 0; i < 200 && p.castingAbility; i++) sim.tick();
    expect(p.castingAbility).toBeNull();
    // regression: the conjure branch bills directly and must consume the charge
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
  });
});

describe('talent primitive P2: cast while moving', () => {
  it('movement cancels a normal cast (baseline behavior unchanged)', () => {
    const { sim, p } = makeSim('mage');
    spawnTarget(sim, p);
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
    metaOf(sim, p).moveInput.forward = true;
    sim.tick();
    expect(p.castingAbility).toBeNull();
  });

  it('a def-level castWhileMoving flag keeps the cast through movement', () => {
    ABILITIES.fireball.castWhileMoving = true;
    try {
      const { sim, p } = makeSim('mage');
      spawnTarget(sim, p);
      sim.castAbility('fireball');
      metaOf(sim, p).moveInput.forward = true;
      sim.tick();
      sim.tick();
      expect(p.castingAbility).toBe('fireball');
      expect(p.castRemaining).toBeGreaterThan(0);
    } finally {
      delete ABILITIES.fireball.castWhileMoving;
    }
  });

  it('a talent castWhileMoving mod bakes onto the resolved ability', () => {
    const mods = emptyModifiers();
    mods.abilities.fireball = {
      dmgPct: 0,
      flatDmg: 0,
      costPct: 0,
      cooldownPct: 0,
      castPct: 0,
      buffPct: 0,
      castWhileMoving: true,
      addEffects: [],
    };
    const fb = abilitiesKnownAt('mage', 20, mods).find((k) => k.def.id === 'fireball');
    expect(fb?.castWhileMoving).toBe(true);
    const plain = abilitiesKnownAt('mage', 20).find((k) => k.def.id === 'fireball');
    expect(plain?.castWhileMoving).toBeUndefined();
  });
});

describe('talent primitives P4/P5', () => {
  function damageAmount(rooted: boolean): number {
    const { sim, p } = makeSim('warrior', 20, 4242);
    const target = spawnTarget(sim, p);
    target.stats.armor = 0;
    p.critChance = 0;
    if (rooted) target.auras.push(aura('root'));
    const res = fixedDamageRes('test_vs_rooted', 'warrior', 'physical');
    res.effects = [{ type: 'directDamage', min: 10, max: 10, vsRootedMult: 2 }];
    runEffects(sim.ctx, p, metaOf(sim, p), target, res);
    const ev = sim.drainEvents().find((e) => e.type === 'damage' && e.ability === 'test_vs_rooted');
    if (ev?.type !== 'damage') throw new Error('missing damage event');
    expect(ev.crit).toBe(false);
    return ev.amount;
  }

  it('vsRootedMult multiplies direct damage only when the target is rooted', () => {
    const normal = damageAmount(false);
    const rooted = damageAmount(true);
    expect(rooted).toBe(normal * 2);
  });

  it('critVsRooted adds spell crit chance only against rooted targets without extra draws', () => {
    const run = (rooted: boolean): { crit: boolean; draws: number } => {
      const { sim, p } = makeSim('mage', 20, 991);
      const target = spawnTarget(sim, p);
      p.stats.int = -62.5;
      metaOf(sim, p).talentMods.global.critVsRooted = 1;
      if (rooted) target.auras.push(aura('root'));
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      runEffects(
        sim.ctx,
        p,
        metaOf(sim, p),
        target,
        fixedDamageRes('test_shatter', 'mage', 'frost'),
      );
      sim.rng.setObserver(null);
      const ev = sim.drainEvents().find((e) => e.type === 'damage' && e.ability === 'test_shatter');
      if (ev?.type !== 'damage') throw new Error('missing damage event');
      return { crit: ev.crit, draws };
    };

    const normal = run(false);
    const rooted = run(true);
    expect(normal.draws).toBe(rooted.draws);
    expect(normal.crit).toBe(false);
    expect(rooted.crit).toBe(true);
  });

  it('addEffects appends copied effects during ability resolution without mutating content', () => {
    const mods = emptyModifiers();
    const added = { type: 'dot', total: 30, duration: 6, interval: 2 } as const;
    const originalEffects = ABILITIES.fireball.effects;
    mods.abilities.fireball = {
      dmgPct: 0,
      flatDmg: 0,
      costPct: 0,
      cooldownPct: 0,
      castPct: 0,
      buffPct: 0,
      castWhileMoving: false,
      addEffects: [added],
    };

    const fireball = abilitiesKnownAt('mage', 20, mods).find((k) => k.def.id === 'fireball');

    expect(fireball).toBeDefined();
    expect(fireball?.effects.at(-1)).toEqual(added);
    expect(fireball?.effects.at(-1)).not.toBe(added);
    expect(ABILITIES.fireball.effects).toBe(originalEffects);
    expect(ABILITIES.fireball.effects).not.toContain(added);
  });
});
