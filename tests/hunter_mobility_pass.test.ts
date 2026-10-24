// Hunter mobility pass: Trailbreak leaps 25 yards on a 20 sec cooldown and,
// for every hunter (not only Tactical Retreat), breaks ordinary roots and
// movement slows; encounter-owned unbreakable control is left alone. The
// hunter abilities have no minimum range and Auto Shot no dead zone (were 8 yards).
import { describe, expect, it } from 'vitest';
import { applyCourserDaze, COURSER_DAZE_AURA_ID } from '../src/sim/combat/hunter_shared';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void; ctx: SimContext };

function hunter(seed: number): TestSim {
  const sim = new Sim({
    seed,
    playerClass: 'hunter',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as TestSim;
  sim.setPlayerLevel(20);
  // A row 5 pick other than Tactical Retreat, so the escape is the base kit's.
  expect(sim.applyTalents({ spec: 'marksmanship', rows: { 5: 'hun_r5_enduring_courser' } })).toBe(
    true,
  );
  return sim;
}

function control(id: string, kind: Aura['kind'], unbreakable = false): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 10,
    duration: 10,
    value: kind === 'slow' ? 0.5 : 0,
    sourceId: 99,
    school: 'physical',
    ...(unbreakable ? { unbreakableControl: true } : {}),
  };
}

describe('Trailbreak', () => {
  it('leaps 25 yards on a 15 sec cooldown', () => {
    const sim = hunter(4501);
    const resolved = sim.resolvedAbility('trailbreak');
    expect(resolved?.cooldown).toBe(15);
    expect(resolved?.effects).toContainEqual({ type: 'hunterTrailbreak', distance: 25 });
    expect(resolved?.charges ?? 1).toBe(1);

    sim.castAbility('trailbreak');
    expect(sim.player.cooldowns.get('trailbreak')).toBe(15);
  });

  it('breaks free of roots and movement slows without Tactical Retreat', () => {
    const sim = hunter(4502);
    sim.player.auras.push(control('test_root', 'root'), control('test_slow', 'slow'));
    sim.drainEvents();

    sim.castAbility('trailbreak');

    expect(sim.player.auras.some((aura) => aura.kind === 'root')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.kind === 'slow')).toBe(false);
    expect(sim.player.cooldowns.has('trailbreak')).toBe(true);
  });

  it("clears the hunter's own Courser's Guise daze", () => {
    const sim = hunter(4505);
    sim.castAbility('aspect_of_the_cheetah');
    sim.player.gcdRemaining = 0;
    applyCourserDaze(sim.ctx, sim.player);
    expect(sim.player.auras.some((aura) => aura.id === COURSER_DAZE_AURA_ID)).toBe(true);

    sim.castAbility('trailbreak');

    expect(sim.player.auras.some((aura) => aura.id === COURSER_DAZE_AURA_ID)).toBe(false);
  });

  it('leaves an unbreakable encounter slow in place', () => {
    const sim = hunter(4503);
    sim.player.auras.push(control('encounter_slow', 'slow', true), control('test_slow', 'slow'));

    sim.castAbility('trailbreak');

    expect(sim.player.auras.map((aura) => aura.id)).toContain('encounter_slow');
    expect(sim.player.auras.map((aura) => aura.id)).not.toContain('test_slow');
  });

  it('is still refused by an unbreakable root, which it does not strip', () => {
    const sim = hunter(4504);
    sim.player.auras.push(control('encounter_root', 'root', true));
    sim.drainEvents();

    sim.castAbility('trailbreak');

    expect(sim.player.auras.map((aura) => aura.id)).toContain('encounter_root');
    expect(sim.player.cooldowns.has('trailbreak')).toBe(false);
  });
});

describe('hunter minimum ranges', () => {
  it('no hunter ability has a minimum range, and Auto Shot has no dead zone', () => {
    const withMin = Object.values(ABILITIES).filter(
      (def) => def.class === 'hunter' && def.minRange !== undefined,
    );
    expect(withMin.map((def) => def.id)).toEqual([]);
    expect(CLASSES.hunter.ranged?.minRange).toBe(0);
  });

  it('Fell Shot fires point blank', () => {
    const sim = hunter(4506);
    const player = sim.player;
    const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 1,
    });
    target.hostile = true;
    target.maxHp = target.hp = 500_000;
    sim.addEntity(target);
    player.facing = 0;
    player.resource = player.maxResource;
    sim.targetEntity(target.id);
    sim.drainEvents();
    sim.castAbility('arcane_shot');
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 2; i++) events.push(...sim.tick());
    expect(
      events.some((e) => e.type === 'damage' && e.ability === 'Fell Shot' && e.amount > 0),
    ).toBe(true);
    expect(player.cooldowns.has('arcane_shot')).toBe(true);
  });

  it('Bloodhook lands its wound on a target already in melee', () => {
    const sim = new Sim({
      seed: 4510,
      playerClass: 'hunter',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    }) as TestSim;
    sim.setPlayerLevel(20);
    expect(sim.setSpec('survival')).toBe(true);
    const player = sim.player;
    const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 1,
    });
    target.hostile = true;
    target.maxHp = target.hp = 500_000;
    sim.addEntity(target);
    player.facing = 0;
    sim.targetEntity(target.id);
    sim.castAbility('bloodhook');
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(target.auras.some((aura) => aura.id === 'bloodhook_bleed')).toBe(true);
    expect(player.cooldowns.has('bloodhook')).toBe(true);
  });
});

describe('Auto Shot dead zone', () => {
  // Auto Shot resolves before the melee swing and has no dead zone, so a hunter
  // with a target in range always shoots, even point blank.
  function autoAttackDamage(distance: number, seed: number): SimEvent[] {
    const sim = hunter(seed);
    const player = sim.player;
    const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + distance,
    });
    target.hostile = true;
    target.maxHp = target.hp = 500_000;
    sim.addEntity(target);
    player.facing = 0;
    sim.targetEntity(target.id);
    sim.startAutoAttack();
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) events.push(...sim.tick());
    return events.filter((event) => event.type === 'damage' && event.sourceId === player.id);
  }

  it('shoots point blank instead of swinging in melee', () => {
    const shot = autoAttackDamage(1, 4509);
    expect(shot.length).toBeGreaterThan(0);
    expect(shot.every((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(true);
  });
});
