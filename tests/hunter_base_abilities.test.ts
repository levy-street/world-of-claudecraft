import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { dist2d } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const HUNTER_BASE_ABILITIES = [
  'hunters_mark',
  'disengage',
  'aspect_of_the_cheetah',
  'aspect_of_the_turtle',
  'exhilaration',
  'feign_death',
  'freezing_trap',
] as const;

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function groundEffects(sim: Sim): GroundAoE[] {
  return (sim as unknown as { groundAoEs: GroundAoE[] }).groundAoEs;
}

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  entity.prevPos = { ...entity.pos };
}

function makeHunter(): { sim: TestSim; hunter: Entity } {
  const sim = new Sim({ seed: 2707, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  const hunter = sim.player;
  place(sim, hunter, 700, 0);
  hunter.resource = hunter.maxResource;
  return { sim, hunter };
}

function spawnTarget(sim: TestSim, hunter: Entity, x: number, z: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  hunter.facing = Math.atan2(mob.pos.x - hunter.pos.x, mob.pos.z - hunter.pos.z);
  sim.targetEntity(mob.id, hunter.id);
  return mob;
}

function damage(sim: Sim, source: Entity, target: Entity, amount: number): number {
  const before = target.hp;
  (sim as unknown as { dealDamage(...args: unknown[]): void }).dealDamage(
    source,
    target,
    amount,
    false,
    'physical',
    'Test hit',
    'hit',
  );
  return before - target.hp;
}

describe('Hunter base abilities', () => {
  it('has no minimum range on Hunter shots, Auto Shot, or Rapid Fire', () => {
    expect(CLASSES.hunter.ranged?.minRange).toBe(0);
    expect(
      Object.values(ABILITIES)
        .filter((ability) => ability.class === 'hunter' && ability.minRange !== undefined)
        .map((ability) => ability.id),
    ).toEqual([]);

    const { sim, hunter } = makeHunter();
    expect(sim.setSpec('marksmanship')).toBe(true);
    spawnTarget(sim, hunter, 700, 2);

    sim.castAbility('rapid_fire');

    expect(hunter.castingAbility).toBe('rapid_fire');
    expect(
      sim.drainEvents().some((event) => event.type === 'error' && event.text === 'Too close!'),
    ).toBe(false);
  });

  it('keeps the full base kit available to every Hunter spec and no other class', () => {
    for (const spec of ['beast_mastery', 'marksmanship', 'survival'] as const) {
      const sim = new Sim({ seed: 17, playerClass: 'hunter', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec(spec)).toBe(true);
      for (const abilityId of HUNTER_BASE_ABILITIES) {
        expect(sim.resolvedAbility(abilityId), `${spec} knows ${abilityId}`).not.toBeNull();
      }
    }

    for (const cls of ['mage', 'warrior'] as PlayerClass[]) {
      const sim = new Sim({ seed: 17, playerClass: cls, autoEquip: true });
      sim.setPlayerLevel(20);
      for (const abilityId of HUNTER_BASE_ABILITIES) {
        expect(sim.resolvedAbility(abilityId), `${cls} does not know ${abilityId}`).toBeNull();
      }
    }
  });

  it('reserves Gutting Strike and Counterfang for Survival', () => {
    for (const spec of ['beast_mastery', 'marksmanship', 'survival'] as const) {
      const sim = new Sim({ seed: 18, playerClass: 'hunter', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec(spec)).toBe(true);
      for (const abilityId of ['raptor_strike', 'mongoose_bite']) {
        if (spec === 'survival') {
          expect(sim.resolvedAbility(abilityId), `${spec} knows ${abilityId}`).not.toBeNull();
        } else {
          expect(sim.resolvedAbility(abilityId), `${spec} does not know ${abilityId}`).toBeNull();
        }
      }
    }
  });

  it('unlocks Gutting Strike when Survival becomes selectable at level 5', () => {
    const sim = new Sim({ seed: 19, playerClass: 'hunter', autoEquip: true });
    expect(sim.resolvedAbility('raptor_strike')).toBeNull();
    sim.setPlayerLevel(5);
    expect(sim.setSpec('survival')).toBe(true);
    expect(sim.resolvedAbility('raptor_strike')).not.toBeNull();
  });

  it("Hunter's Mark amplifies only its Hunter's damage", () => {
    const { sim, hunter } = makeHunter();
    const target = spawnTarget(sim, hunter, 700, 15);
    sim.castAbility('hunters_mark');

    expect(target.auras).toContainEqual(
      expect.objectContaining({
        id: 'hunters_mark',
        kind: 'hunter_mark',
        value: 0.05,
        sourceId: hunter.id,
      }),
    );

    target.hp = target.maxHp;
    expect(damage(sim, hunter, target, 100)).toBe(105);

    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...hunter.pos });
    pet.ownerId = hunter.id;
    pet.hostile = false;
    sim.addEntity(pet);
    target.hp = target.maxHp;
    expect(damage(sim, pet, target, 100)).toBe(105);

    const otherPid = sim.addPlayer('warrior', 'Other');
    const other = sim.entities.get(otherPid);
    if (!other) throw new Error('missing other player');
    target.hp = target.maxHp;
    expect(damage(sim, other, target, 100)).toBe(100);
  });

  it("Hunter's Mark amplifies a real direct Hunter shot exactly once", () => {
    const castArcaneShot = (marked: boolean): number => {
      const { sim, hunter } = makeHunter();
      const target = spawnTarget(sim, hunter, 700, 15);
      if (marked) {
        sim.castAbility('hunters_mark');
        hunter.gcdRemaining = 0;
        hunter.resource = hunter.maxResource;
      }
      const hpBefore = target.hp;
      sim.castAbility('arcane_shot');
      return hpBefore - target.hp;
    };

    const unmarked = castArcaneShot(false);
    const marked = castArcaneShot(true);
    expect(marked).toBe(Math.round(unmarked * 1.05));
  });

  it("Hunter's Mark moves to the Hunter's new priority target", () => {
    const { sim, hunter } = makeHunter();
    const first = spawnTarget(sim, hunter, 700, 15);
    const second = spawnTarget(sim, hunter, 702, 15);
    sim.targetEntity(first.id, hunter.id);
    sim.castAbility('hunters_mark');
    expect(first.auras.some((aura) => aura.id === 'hunters_mark')).toBe(true);

    hunter.gcdRemaining = 0;
    sim.targetEntity(second.id, hunter.id);
    sim.castAbility('hunters_mark');

    expect(first.auras.some((aura) => aura.id === 'hunters_mark')).toBe(false);
    expect(second.auras).toContainEqual(
      expect.objectContaining({ id: 'hunters_mark', sourceId: hunter.id }),
    );
  });

  it('Disengage leaps backwards through the collision-safe movement path', () => {
    const { sim, hunter } = makeHunter();
    hunter.facing = 0;
    const before = { ...hunter.pos };

    sim.castAbility('disengage');

    expect(hunter.pos).toEqual(before);
    expect(hunter.onGround).toBe(false);
    expect(hunter.jumping).toBe(true);
    expect(hunter.vy).toBeGreaterThan(0);
    expect(hunter.vz).toBeLessThan(0);

    sim.tick();
    expect(hunter.pos.z).toBeLessThan(before.z);
    expect(hunter.pos.y).toBeGreaterThan(before.y);
    for (let i = 0; i < 40 && !hunter.onGround; i++) sim.tick();

    expect(hunter.onGround).toBe(true);
    expect(hunter.pos.z).toBeLessThan(before.z - 10);
    expect(Math.abs(hunter.pos.x - before.x)).toBeLessThan(0.01);
    expect(dist2d(before, hunter.pos)).toBeLessThanOrEqual(15);

    place(sim, hunter, 4220, -1248);
    hunter.facing = -Math.PI / 2;
    hunter.cooldowns.delete('disengage');
    const beforeWall = { ...hunter.pos };
    sim.castAbility('disengage');
    expect(hunter.pos).toEqual(beforeWall);
    for (let i = 0; i < 40 && !hunter.onGround; i++) sim.tick();
    expect(hunter.pos.x).toBeGreaterThan(beforeWall.x);
    expect(hunter.pos.x).toBeLessThan(4222.6);
    expect(dist2d(beforeWall, hunter.pos)).toBeLessThan(3);
  });

  it('Aspect of the Cheetah is a strong short sprint instead of a maintenance aspect', () => {
    const { sim, hunter } = makeHunter();
    sim.castAbility('aspect_of_the_cheetah');

    expect(hunter.auras).toContainEqual(
      expect.objectContaining({
        id: 'aspect_of_the_cheetah',
        kind: 'buff_speed',
        value: 1.9,
        remaining: 3,
      }),
    );
    expect(hunter.cooldowns.get('aspect_of_the_cheetah')).toBe(180);

    for (let i = 0; i < 61; i++) sim.tick();
    expect(hunter.auras.some((aura) => aura.id === 'aspect_of_the_cheetah')).toBe(false);
  });

  it('Aspect of the Turtle reduces damage and prevents attacking while active', () => {
    const { sim, hunter } = makeHunter();
    const target = spawnTarget(sim, hunter, 700, 15);
    hunter.autoAttack = true;
    sim.castAbility('aspect_of_the_turtle');

    expect(hunter.auras).toContainEqual(
      expect.objectContaining({
        id: 'aspect_of_the_turtle',
        kind: 'shield_wall',
        value: 0.3,
        remaining: 8,
      }),
    );
    expect(damage(sim, target, hunter, 100)).toBe(70);
    expect(hunter.autoAttack).toBe(false);

    sim.drainEvents();
    sim.startAutoAttack(hunter.id);
    expect(hunter.autoAttack).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: "You can't attack while protected by Aspect of the Turtle.",
      }),
    );

    hunter.gcdRemaining = 0;
    sim.drainEvents();
    sim.castAbility('arcane_shot');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: "You can't attack while protected by Aspect of the Turtle.",
      }),
    );
    expect(target.hp).toBe(target.maxHp);
  });

  it('Exhilaration restores 30% maximum health without exceeding the cap', () => {
    const { sim, hunter } = makeHunter();
    hunter.hp = Math.round(hunter.maxHp * 0.2);
    const before = hunter.hp;

    sim.castAbility('exhilaration');

    expect(hunter.hp - before).toBe(Math.round(hunter.maxHp * 0.3));
    expect(hunter.cooldowns.get('exhilaration')).toBe(120);

    hunter.gcdRemaining = 0;
    hunter.cooldowns.delete('exhilaration');
    hunter.hp = hunter.maxHp - 1;
    sim.castAbility('exhilaration');
    expect(hunter.hp).toBe(hunter.maxHp);
  });

  it('Exhilaration respects healing reductions and heal absorbs', () => {
    const { sim, hunter } = makeHunter();
    hunter.hp = Math.round(hunter.maxHp * 0.2);
    hunter.auras.push(
      {
        id: 'mortal_wound_test',
        name: 'Mortal Wound',
        kind: 'mortal_wound',
        remaining: 10,
        duration: 10,
        value: 0.5,
        sourceId: 999,
        school: 'physical',
      },
      {
        id: 'heal_absorb_test',
        name: 'Heal Absorb',
        kind: 'heal_absorb',
        remaining: 10,
        duration: 10,
        value: 10,
        sourceId: 999,
        school: 'shadow',
      },
    );
    const before = hunter.hp;

    sim.castAbility('exhilaration');

    const reduced = Math.round(Math.round(hunter.maxHp * 0.3) * 0.5);
    expect(hunter.hp - before).toBe(reduced - 10);
    expect(hunter.auras.some((aura) => aura.kind === 'heal_absorb')).toBe(false);
  });

  it('Feign Death drops threat, cancels targeted casts, and ends when the Hunter acts', () => {
    const { sim, hunter } = makeHunter();
    const target = spawnTarget(sim, hunter, 700, 4);
    const allyPid = sim.addPlayer('priest', 'Ally');
    target.threat.set(hunter.id, 200);
    target.threat.set(allyPid, 100);
    target.aggroTargetId = hunter.id;
    target.aiState = 'attack';
    target.inCombat = true;
    target.castingAbility = 'shadow_bolt';
    target.castTargetId = hunter.id;
    target.castRemaining = 1;

    sim.castAbility('feign_death');

    expect(target.threat.has(hunter.id)).toBe(false);
    expect(target.aggroTargetId).toBe(allyPid);
    expect(target.castingAbility).toBeNull();
    expect(hunter.auras).toContainEqual(
      expect.objectContaining({ id: 'feign_death', kind: 'feign_death', remaining: 360 }),
    );
    expect(hunter.stealthed).toBe(false);

    for (let i = 0; i < 121; i++) sim.tick();
    expect(hunter.auras.some((aura) => aura.id === 'feign_death')).toBe(true);

    sim.castAbility('aspect_of_the_cheetah');
    expect(hunter.auras.some((aura) => aura.id === 'feign_death')).toBe(false);
  });

  it('Feign Death ends when the Hunter deliberately moves or jumps', () => {
    const { sim, hunter } = makeHunter();
    const meta = sim.players.get(hunter.id);
    if (!meta) throw new Error('missing Hunter meta');
    sim.castAbility('feign_death');
    meta.moveInput.forward = true;

    sim.tick();

    expect(hunter.auras.some((aura) => aura.id === 'feign_death')).toBe(false);

    meta.moveInput.forward = false;
    hunter.cooldowns.delete('feign_death');
    sim.castAbility('feign_death');
    meta.moveInput.jump = true;
    sim.tick();
    expect(hunter.auras.some((aura) => aura.id === 'feign_death')).toBe(false);
  });

  it('Feign Death ends when the Hunter uses a combat consumable', () => {
    const { sim, hunter } = makeHunter();
    hunter.hp = Math.round(hunter.maxHp * 0.5);
    sim.addItem('minor_healing_potion', 1, hunter.id);
    sim.castAbility('feign_death');

    sim.useItem('minor_healing_potion', hunter.id);

    expect(hunter.auras.some((aura) => aura.id === 'feign_death')).toBe(false);
  });

  it('Freezing Trap incapacitates only the first enemy to trigger it and breaks on damage', () => {
    const { sim, hunter } = makeHunter();
    const first = spawnTarget(sim, hunter, 700, 12);
    const second = spawnTarget(sim, hunter, 700.5, 12);

    sim.castAbility('freezing_trap', hunter.id, { x: 700, z: 12 });
    expect(groundEffects(sim).some((effect) => effect.ability === 'Freezing Trap')).toBe(true);
    expect([...sim.entities.values()]).toContainEqual(
      expect.objectContaining({
        kind: 'object',
        templateId: 'hunter_freezing_trap',
        lootable: false,
        pos: expect.objectContaining({
          x: 700,
          y: groundHeight(700, 12, sim.cfg.seed),
          z: 12,
        }),
      }),
    );

    sim.tick();

    expect(first.auras).toContainEqual(
      expect.objectContaining({
        id: 'freezing_trap',
        kind: 'incapacitate',
        breaksOnDamage: true,
      }),
    );
    expect(second.auras.some((aura) => aura.id === 'freezing_trap')).toBe(false);
    expect(first.auras.find((aura) => aura.id === 'freezing_trap')?.remaining).toBeCloseTo(
      59.95,
      4,
    );
    expect(groundEffects(sim).some((effect) => effect.ability === 'Freezing Trap')).toBe(false);
    expect(
      [...sim.entities.values()].some((entity) => entity.templateId === 'hunter_freezing_trap'),
    ).toBe(false);

    damage(sim, hunter, first, 1);
    expect(first.auras.some((aura) => aura.id === 'freezing_trap')).toBe(false);
  });

  it('removes an untriggered Freezing Trap if its Hunter dies', () => {
    const { sim, hunter } = makeHunter();
    sim.castAbility('freezing_trap', hunter.id, { x: 700, z: 20 });
    expect(
      [...sim.entities.values()].some((entity) => entity.templateId === 'hunter_freezing_trap'),
    ).toBe(true);

    hunter.dead = true;
    sim.tick();

    expect(groundEffects(sim).some((effect) => effect.ability === 'Freezing Trap')).toBe(false);
    expect(
      [...sim.entities.values()].some((entity) => entity.templateId === 'hunter_freezing_trap'),
    ).toBe(false);
  });

  it('cleans up Freezing Trap on natural expiry or a missing source', () => {
    for (const cleanup of ['expiry', 'missing-source'] as const) {
      const { sim, hunter } = makeHunter();
      sim.castAbility('freezing_trap', hunter.id, { x: 700, z: 20 });
      const effect = groundEffects(sim).find((candidate) => candidate.ability === 'Freezing Trap');
      if (!effect) throw new Error('missing Freezing Trap ground effect');
      expect(effect.remaining).toBe(60);
      if (cleanup === 'expiry') effect.remaining = 0.05;
      else effect.sourceId = 999_999;

      sim.tick();

      expect(groundEffects(sim).some((candidate) => candidate.ability === 'Freezing Trap')).toBe(
        false,
      );
      expect(
        [...sim.entities.values()].some((entity) => entity.templateId === 'hunter_freezing_trap'),
      ).toBe(false);
    }
  });

  it("Freezing Trap checks line of sight from the trap instead of the Hunter's new position", () => {
    const { sim, hunter } = makeHunter();
    place(sim, hunter, 4220, -1248);
    const target = spawnTarget(sim, hunter, 4210, -1248);
    sim.castAbility('freezing_trap', hunter.id, { x: 4210, z: -1248 });
    place(sim, hunter, 4225, -1248);

    sim.tick();

    expect(target.auras).toContainEqual(expect.objectContaining({ id: 'freezing_trap' }));
  });

  it('Freezing Trap waits when its own line of sight to an enemy is blocked', () => {
    const { sim, hunter } = makeHunter();
    place(sim, hunter, 4200, -1248);
    const target = spawnTarget(sim, hunter, 4211.7, -1248);
    sim.castAbility('freezing_trap', hunter.id, { x: 4210.3, z: -1248 });

    sim.tick();

    expect(target.auras.some((aura) => aura.id === 'freezing_trap')).toBe(false);
    expect(groundEffects(sim).some((effect) => effect.ability === 'Freezing Trap')).toBe(true);
  });
});
