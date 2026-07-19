import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function makeHunter(spec: 'beast_mastery' | 'marksmanship' | 'survival' = 'marksmanship') {
  const sim = new Sim({
    seed: 2901,
    playerClass: 'hunter',
    autoEquip: true,
  }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  const hunter = sim.player;
  hunter.pos = { x: 700, y: groundHeight(700, 0, sim.cfg.seed), z: 0 };
  hunter.prevPos = { ...hunter.pos };
  hunter.facing = 0;
  hunter.resource = hunter.maxResource;
  return { sim, hunter };
}

function spawn(sim: TestSim, hunter: Entity, x: number, z: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.auras.push({
    id: 'test_root',
    name: 'Test Root',
    kind: 'stun',
    remaining: 100,
    duration: 100,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
  sim.addEntity(mob);
  hunter.facing = Math.atan2(x - hunter.pos.x, z - hunter.pos.z);
  sim.targetEntity(mob.id, hunter.id);
  return mob;
}

function ticks(sim: Sim, count: number): void {
  for (let i = 0; i < count; i++) sim.tick();
}

describe('Marksmanship Hunter', () => {
  it('gates the spec kit and keeps Kill Shot shared only by Beast Mastery and Marksmanship', () => {
    const marksmanship = makeHunter('marksmanship').sim;
    for (const id of ['steady_shot', 'explosive_shot', 'aimed_shot', 'rapid_fire', 'trueshot']) {
      expect(marksmanship.resolvedAbility(id), id).not.toBeNull();
    }
    expect(marksmanship.resolvedAbility('kill_shot')).not.toBeNull();

    const beastMastery = makeHunter('beast_mastery').sim;
    expect(beastMastery.resolvedAbility('kill_shot')).not.toBeNull();
    const survival = makeHunter('survival').sim;
    expect(survival.resolvedAbility('kill_shot')).toBeNull();
    for (const sim of [beastMastery, survival]) {
      expect(
        sim.applyTalents({
          spec: sim.talents.spec,
          rows: { 20: 'hun_r20_powershot' },
        }),
      ).toBe(true);
      for (const id of [
        'steady_shot',
        'explosive_shot',
        'aimed_shot',
        'rapid_fire',
        'trueshot',
      ]) {
        expect(sim.resolvedAbility(id), `${id} must stay Marksmanship-only`).toBeNull();
      }
      expect(sim.resolvedAbility('powerful_shot'), 'class-wide row grant').not.toBeNull();
    }
  });

  it('uses one Aimed Shot charge with a 15 sec recharge and spends 35 Focus', () => {
    const { sim, hunter } = makeHunter();
    spawn(sim, hunter, 700, 20);
    const before = hunter.resource;

    sim.castAbility('aimed_shot');
    const events: ReturnType<Sim['tick']> = [];
    for (let i = 0; i < 65; i++) events.push(...sim.tick());

    expect(hunter.resource).toBe(before - 35);
    expect(hunter.cooldowns.get('aimed_shot')).toBeGreaterThan(11);
    expect(hunter.abilityCharges?.aimed_shot).toBeUndefined();
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' && event.fx === 'projectile' && event.abilityId === 'aimed_shot',
      ),
    ).toBe(true);
  });

  it('channels exactly 7 Rapid Fire shots while moving and generates 21 Focus', () => {
    const { sim, hunter } = makeHunter();
    spawn(sim, hunter, 700, 25);
    hunter.resource = 0;
    const meta = sim.players.get(hunter.id)!;
    meta.moveInput.forward = true;

    sim.castAbility('rapid_fire');
    const events: ReturnType<Sim['tick']> = [];
    for (let i = 0; i < 70; i++) events.push(...sim.tick());
    const shots = events.filter(
      (event) => event.type === 'damage' && event.ability === 'Rapid Fire',
    );
    expect(shots).toHaveLength(7);
    // Seven shots generate 21 Focus; one normal 2 sec Focus tick adds 20 more
    // during the projectile-drain window covered by this end-to-end assertion.
    expect(hunter.resource).toBe(41);
    expect(hunter.castingAbility).toBeNull();
    expect(hunter.pos.z).toBeGreaterThan(0);
  });

  it('makes Trueshot add crit stats and accelerate only Aimed Shot and Rapid Fire recovery', () => {
    const { sim, hunter } = makeHunter();
    const baseCrit = hunter.critChance;
    const baseCritDamage = hunter.critDmgPhysBonus;
    hunter.cooldowns.set('aimed_shot', 15);
    hunter.cooldowns.set('rapid_fire', 16);
    hunter.cooldowns.set('explosive_shot', 30);

    sim.castAbility('trueshot');
    expect(hunter.critChance).toBeCloseTo(baseCrit + 0.1);
    expect(hunter.critDmgPhysBonus).toBeCloseTo(baseCritDamage + 0.2);
    ticks(sim, 20);

    expect(hunter.cooldowns.get('aimed_shot')).toBeCloseTo(13.6, 3);
    expect(hunter.cooldowns.get('rapid_fire')).toBeCloseTo(14.4, 3);
    expect(hunter.cooldowns.get('explosive_shot')).toBeCloseTo(29, 3);

    ticks(sim, 281);
    expect(hunter.auras.some((aura) => aura.id === 'trueshot')).toBe(false);
    expect(hunter.critChance).toBeCloseTo(baseCrit);
    expect(hunter.critDmgPhysBonus).toBeCloseTo(baseCritDamage);
    hunter.cooldowns.set('aimed_shot', 15);
    hunter.cooldowns.set('rapid_fire', 16);
    ticks(sim, 20);
    expect(hunter.cooldowns.get('aimed_shot')).toBeCloseTo(14, 3);
    expect(hunter.cooldowns.get('rapid_fire')).toBeCloseTo(15, 3);
  });

  it('detonates Explosive Shot after 3 sec around the attached target', () => {
    const { sim, hunter } = makeHunter();
    const primary = spawn(sim, hunter, 700, 20);
    const oldPositionNearby = spawn(sim, hunter, 700, 24);
    const newPositionNearby = spawn(sim, hunter, 724, 20);
    sim.targetEntity(primary.id, hunter.id);

    sim.castAbility('explosive_shot');
    for (let i = 0; i < 40 && !primary.auras.some((aura) => aura.id === 'explosive_shot'); i++)
      sim.tick();
    expect(primary.auras).toContainEqual(
      expect.objectContaining({
        id: 'explosive_shot',
        kind: 'explosive_shot',
        remaining: expect.closeTo(3, 1),
      }),
    );
    expect(hunter.inCombat).toBe(true);
    expect(primary.inCombat).toBe(true);
    primary.pos = { x: 720, y: groundHeight(720, 20, sim.cfg.seed), z: 20 };
    primary.prevPos = { ...primary.pos };
    sim.grid.update(primary);
    const remaining = primary.auras.find((aura) => aura.id === 'explosive_shot')!.remaining;
    ticks(sim, Math.max(0, Math.ceil(remaining / 0.05) - 1));
    expect(primary.hp).toBe(primary.maxHp);
    ticks(sim, 1);
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(newPositionNearby.hp).toBeLessThan(newPositionNearby.maxHp);
    expect(oldPositionNearby.hp).toBe(oldPositionNearby.maxHp);
  });

  it('still detonates Explosive Shot at the corpse if its target dies first', () => {
    const { sim, hunter } = makeHunter();
    const primary = spawn(sim, hunter, 700, 20);
    const nearby = spawn(sim, hunter, 704, 20);
    sim.targetEntity(primary.id, hunter.id);
    sim.castAbility('explosive_shot');
    for (let i = 0; i < 40 && !primary.auras.some((aura) => aura.id === 'explosive_shot'); i++)
      sim.tick();
    expect(primary.auras.some((aura) => aura.id === 'explosive_shot')).toBe(true);
    primary.hp = 0;
    primary.dead = true;

    ticks(sim, 61);

    expect(nearby.hp).toBeLessThan(nearby.maxHp);
    expect(primary.auras.some((aura) => aura.id === 'explosive_shot')).toBe(false);
  });

  it('Multi-Shot hits around its target, soft caps beyond 5, and arms one ricochet', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 14: 'hun_r14_multi_shot' },
      }),
    ).toBe(true);
    const primary = spawn(sim, hunter, 700, 20);
    const others = Array.from({ length: 6 }, (_, index) => spawn(sim, hunter, 701 + index, 20));
    sim.targetEntity(primary.id, hunter.id);

    sim.drainEvents();
    sim.castAbility('multi_shot');
    const multiShotEvents = sim.drainEvents();
    const missileEvents = multiShotEvents.filter(
      (event) => event.type === 'spellfx' && event.fx === 'projectile',
    );
    expect(missileEvents).toHaveLength(7);
    expect(
      missileEvents.every(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'projectile' &&
          event.abilityId === 'multi_shot' &&
          event.projectileStyle === 'hunter-arrow' &&
          event.attackAnimation === 'ranged-shot',
      ),
    ).toBe(true);
    expect(
      missileEvents
        .map((event) => (event.type === 'spellfx' ? event.targetId : -1))
        .sort((a, b) => a - b),
    ).toEqual([primary, ...others].map((enemy) => enemy.id).sort((a, b) => a - b));
    expect(
      multiShotEvents
        .filter((event) => event.type === 'damage' && event.ability === 'Multi-Shot')
        .every((event) => event.type === 'damage' && event.attackAnimationStarted === true),
    ).toBe(true);
    expect([primary, ...others].every((enemy) => enemy.hp < enemy.maxHp)).toBe(true);
    const hpAfterMulti = others.map((enemy) => enemy.hp);
    expect(hunter.auras).toContainEqual(
      expect.objectContaining({
        id: 'hunter_trick_shots',
        kind: 'hunter_ricochet',
      }),
    );

    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('aimed_shot');
    hunter.resource = 100;
    sim.targetEntity(primary.id, hunter.id);
    sim.castAbility('aimed_shot');
    ticks(sim, 90);
    expect(hunter.auras.some((aura) => aura.id === 'hunter_trick_shots')).toBe(false);
    expect(others[0].hp).toBeLessThan(hpAfterMulti[0]);
    expect(others[1].hp).toBeLessThan(hpAfterMulti[1]);
    expect(others.slice(2).map((enemy) => enemy.hp)).toEqual(hpAfterMulti.slice(2));
  });

  it('makes all 7 Rapid Fire shots ricochet to only the two nearest enemies', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 14: 'hun_r14_multi_shot' },
      }),
    ).toBe(true);
    const primary = spawn(sim, hunter, 700, 20);
    const others = Array.from({ length: 4 }, (_, index) => spawn(sim, hunter, 701 + index, 20));
    sim.targetEntity(primary.id, hunter.id);
    sim.castAbility('multi_shot');
    const hpAfterMulti = others.map((enemy) => enemy.hp);

    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('rapid_fire');
    hunter.resource = 0;
    sim.castAbility('rapid_fire');
    ticks(sim, 70);

    expect(others[0].hp).toBeLessThan(hpAfterMulti[0]);
    expect(others[1].hp).toBeLessThan(hpAfterMulti[1]);
    expect(others.slice(2).map((enemy) => enemy.hp)).toEqual(hpAfterMulti.slice(2));
    expect(hunter.auras.some((aura) => aura.id === 'hunter_trick_shots')).toBe(false);
  });

  it('Steady Shot casts while moving and generates 20 Focus', () => {
    const { sim, hunter } = makeHunter();
    spawn(sim, hunter, 700, 25);
    hunter.resource = 0;
    sim.players.get(hunter.id)!.moveInput.forward = true;

    sim.castAbility('steady_shot');
    ticks(sim, 39);

    expect(hunter.resource).toBe(20);
    expect(hunter.castingAbility).toBeNull();
    expect(hunter.pos.z).toBeGreaterThan(0);
  });

  it('enforces the below-20% Kill Shot execute gate', () => {
    const { sim, hunter } = makeHunter();
    const target = spawn(sim, hunter, 700, 20);
    sim.castAbility('kill_shot');
    expect(target.hp).toBe(target.maxHp);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('below 20%'),
      }),
    );

    target.hp = Math.floor(target.maxHp * 0.19);
    hunter.gcdRemaining = 0;
    sim.castAbility('kill_shot');
    ticks(sim, 35);
    expect(target.hp).toBeLessThan(Math.floor(target.maxHp * 0.19));
  });

  it('Lock and Load procs from Auto Shot and makes one Aimed Shot instant and free', () => {
    const { sim, hunter } = makeHunter();
    const target = spawn(sim, hunter, 700, 20);
    (sim as any).rng.chance = (chance: number) => chance === 0.1;
    hunter.resource = 35;
    sim.startAutoAttack();
    ticks(sim, 100);

    expect(hunter.auras.filter((aura) => aura.name === 'Lock and Load')).toEqual([
      expect.objectContaining({
        id: 'lock_and_load',
        kind: 'next_cast_free_instant',
        empowerAbilities: ['aimed_shot'],
      }),
    ]);

    sim.stopAutoAttack();
    (sim as any).rng.chance = () => false;
    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('aimed_shot');
    const focusBefore = hunter.resource;
    const hpBeforeAimed = target.hp;
    sim.castAbility('aimed_shot');
    expect(hunter.castingAbility).toBeNull();
    expect(hunter.resource).toBe(focusBefore);
    ticks(sim, 20);
    expect(target.hp).toBeLessThan(hpBeforeAimed);
    expect(hunter.auras.some((aura) => aura.id === 'lock_and_load')).toBe(false);
  });

  it('does not grant Lock and Load when the Auto Shot proc roll fails', () => {
    const { sim, hunter } = makeHunter();
    spawn(sim, hunter, 700, 20);
    (sim as any).rng.chance = () => false;

    sim.startAutoAttack();
    ticks(sim, 100);

    expect(hunter.auras.some((aura) => aura.id === 'lock_and_load')).toBe(false);
  });

  it('Aimed Shot can proc Deathblow and the next Kill Shot ignores target health once', () => {
    const { sim, hunter } = makeHunter();
    const target = spawn(sim, hunter, 700, 20);
    (sim as any).rng.chance = (chance: number) => chance === 0.1;

    sim.castAbility('aimed_shot');
    ticks(sim, 80);
    expect(hunter.auras).toContainEqual(expect.objectContaining({ id: 'deathblow' }));

    hunter.gcdRemaining = 0;
    const hpBeforeKillShot = target.hp;
    sim.castAbility('kill_shot');
    expect(hunter.auras.some((aura) => aura.id === 'deathblow')).toBe(false);
    ticks(sim, 35);
    expect(target.hp).toBeLessThan(hpBeforeKillShot);
    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('kill_shot');
    sim.castAbility('kill_shot');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('below 20%'),
      }),
    );
  });

  it('keeps the Kill Shot health gate when the Aimed Shot Deathblow roll fails', () => {
    const { sim, hunter } = makeHunter();
    spawn(sim, hunter, 700, 20);
    (sim as any).rng.chance = () => false;

    sim.castAbility('aimed_shot');
    ticks(sim, 80);
    expect(hunter.auras.some((aura) => aura.id === 'deathblow')).toBe(false);

    hunter.gcdRemaining = 0;
    sim.castAbility('kill_shot');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('below 20%'),
      }),
    );
  });

  it('charges Powershot on the server and pierces only the narrow aimed line on release', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const near = spawn(sim, hunter, 700, 12);
    const far = spawn(sim, hunter, 700.5, 30);
    const side = spawn(sim, hunter, 704, 20);
    hunter.facing = 0;
    sim.targetEntity(null, hunter.id);

    sim.castAbility('powerful_shot');
    ticks(sim, 30);
    sim.releaseEmpoweredAbility('powerful_shot');

    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBeLessThan(far.maxHp);
    expect(side.hp).toBe(side.maxHp);
    expect(hunter.castingAbility).toBeNull();
    expect(hunter.cooldowns.get('powerful_shot')).toBeGreaterThan(40);
  });

  it('uses strip intersection for damage and emits a targetless directional projectile cue', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const target = spawn(sim, hunter, 700, 12);
    sim.targetEntity(null, hunter.id);
    // The lane itself is the targeting contract. Per-target terrain LoS samples
    // must not make an enemy visibly inside that lane immune on uneven ground.
    sim.ctx.hasLineOfSight = () => false;

    sim.castAbility('powerful_shot');
    sim.releaseEmpoweredAbility('powerful_shot');

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'powerfulShotFx',
        sourceId: hunter.id,
        x: 700,
        z: expect.any(Number),
      }),
    );
  });

  it('scales Powershot damage and length from minimum through partial to automatic maximum', () => {
    const fire = (chargeTicks: number, distance: number) => {
      const { sim, hunter } = makeHunter();
      expect(
        sim.applyTalents({
          spec: 'marksmanship',
          rows: { 20: 'hun_r20_powershot' },
        }),
      ).toBe(true);
      const target = spawn(sim, hunter, 700, distance);
      (sim as any).rng.chance = () => false;
      sim.castAbility('powerful_shot');
      ticks(sim, chargeTicks);
      if (hunter.castingAbility) sim.releaseEmpoweredAbility('powerful_shot');
      return { damage: target.maxHp - target.hp, hunter };
    };

    const minimum = fire(0, 12).damage;
    const partial = fire(25, 12).damage;
    const maximum = fire(50, 12);
    expect(minimum).toBeGreaterThan(0);
    expect(partial).toBeGreaterThan(minimum);
    expect(maximum.damage).toBeGreaterThan(partial);
    expect(maximum.hunter.castingAbility).toBeNull();

    expect(fire(0, 20).damage).toBe(0);
    expect(fire(25, 20).damage).toBeGreaterThan(0);
  });

  it('keeps Powershot width nearly constant while length triples', () => {
    const { sim } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const resolved = sim.known.find((known) => known.def.id === 'powerful_shot');
    const effect = resolved?.effects.find((candidate) => candidate.type === 'powerfulShot');
    expect(effect?.type).toBe('powerfulShot');
    if (!effect || effect.type !== 'powerfulShot') throw new Error('missing Powershot effect');

    expect(effect.maxLength / effect.minLength).toBeGreaterThanOrEqual(3);
    expect(effect.maxWidth / effect.minWidth).toBeLessThanOrEqual(1.2);
  });

  it('uses the latest facing, pierces aligned enemies once, and keeps maximum width narrow', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const oldDirection = spawn(sim, hunter, 700, 12);
    const alignedA = spawn(sim, hunter, 712, 0);
    const alignedB = spawn(sim, hunter, 725, 0);
    const edge = spawn(sim, hunter, 712, 1.1);
    const outside = spawn(sim, hunter, 712, 1.3);
    (sim as any).rng.chance = () => false;
    (sim as any).rng.range = (min: number, max: number) => (min + max) / 2;
    hunter.facing = 0;
    sim.castAbility('powerful_shot');
    const events = [];
    for (let i = 0; i < 25; i++) events.push(...sim.tick());
    hunter.facing = Math.PI / 2;
    for (let i = 0; i < 25; i++) events.push(...sim.tick());
    // Automatic maximum release uses this last valid direction.

    expect(oldDirection.hp).toBe(oldDirection.maxHp);
    for (const target of [alignedA, alignedB, edge]) expect(target.hp).toBeLessThan(target.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
    expect(alignedA.maxHp - alignedA.hp).toBe(alignedB.maxHp - alignedB.hp);
    const hits = events.filter((event) => event.type === 'damage');
    expect(hits.filter((event) => event.targetId === alignedA.id)).toHaveLength(1);
    expect(hits.filter((event) => event.targetId === alignedB.id)).toHaveLength(1);
    expect(hits.filter((event) => event.targetId === edge.id)).toHaveLength(1);
    expect(hits.some((event) => event.targetId === outside.id)).toBe(false);
  });

  it('includes enemies inside the far corners of the Powershot strip', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const corner = spawn(sim, hunter, 701.19, 44.99);
    (sim as any).rng.chance = () => false;
    hunter.facing = 0;

    sim.castAbility('powerful_shot');
    ticks(sim, 50);

    expect(corner.hp).toBeLessThan(corner.maxHp);
  });

  it('uses a release facing proposal atomically before another simulation tick', () => {
    const { sim, hunter } = makeHunter();
    expect(
      sim.applyTalents({
        spec: 'marksmanship',
        rows: { 20: 'hun_r20_powershot' },
      }),
    ).toBe(true);
    const oldDirection = spawn(sim, hunter, 700, 12);
    const releaseDirection = spawn(sim, hunter, 712, 0);
    (sim as any).rng.chance = () => false;
    hunter.facing = 0;

    sim.castAbility('powerful_shot');
    ticks(sim, 25);
    hunter.facing = Math.PI / 2;
    sim.releaseEmpoweredAbility('powerful_shot');

    expect(hunter.facing).toBe(Math.PI / 2);
    expect(oldDirection.hp).toBe(oldDirection.maxHp);
    expect(releaseDirection.hp).toBeLessThan(releaseDirection.maxHp);
  });

  it('rejects a Powershot release made while stunned', () => {
    for (const invalid of ['stun'] as const) {
      const { sim, hunter } = makeHunter();
      expect(
        sim.applyTalents({
          spec: 'marksmanship',
          rows: { 20: 'hun_r20_powershot' },
        }),
      ).toBe(true);
      const target = spawn(sim, hunter, 700, 12);
      hunter.facing = 0;
      sim.castAbility('powerful_shot');
      hunter.auras.push({
        id: 'release_test_stun',
        name: 'Release Test Stun',
        kind: 'stun',
        remaining: 2,
        duration: 2,
        value: 0,
        sourceId: target.id,
        school: 'physical',
      });

      sim.releaseEmpoweredAbility('powerful_shot');

      expect(target.hp, invalid).toBe(target.maxHp);
      expect(hunter.castingAbility, invalid).toBeNull();
      expect(sim.drainEvents()).toContainEqual(
        expect.objectContaining({
          type: 'castStop',
          entityId: hunter.id,
          success: false,
        }),
      );
    }
  });

  it('cancels Powershot on tick-time control loss or death without firing', () => {
    for (const invalid of ['control', 'death'] as const) {
      const { sim, hunter } = makeHunter();
      expect(
        sim.applyTalents({
          spec: 'marksmanship',
          rows: { 20: 'hun_r20_powershot' },
        }),
      ).toBe(true);
      const target = spawn(sim, hunter, 700, 12);
      hunter.facing = 0;
      sim.castAbility('powerful_shot');
      if (invalid === 'control') {
        hunter.auras.push({
          id: 'tick_test_stun',
          name: 'Tick Test Stun',
          kind: 'stun',
          remaining: 2,
          duration: 2,
          value: 0,
          sourceId: target.id,
          school: 'physical',
        });
      } else {
        (sim as any).ctx.dealDamage(
          target,
          hunter,
          hunter.maxHp * 10,
          false,
          'physical',
          'Test Kill',
          'hit',
        );
      }

      sim.tick();

      expect(hunter.castingAbility, invalid).toBeNull();
      expect(hunter.cooldowns.has('powerful_shot'), invalid).toBe(false);
      expect(target.hp, invalid).toBe(target.maxHp);
    }
  });
});
