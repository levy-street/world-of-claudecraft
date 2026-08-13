import { describe, expect, it } from 'vitest';
import { PALADIN_BASTION_SWEEP_IMPACT_TIME } from '../src/render/characters/paladin_bastion_sweep_clip';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion } from '../src/sim/paladin_devotion';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

// Staging ground for the Protection kit. The default spawn sits in the Eastbrook
// plaza, whose v0.30.0 building layout blocks line of sight past ~20 yd out of it
// in every direction, while Oath Chain and Sunward Disc need a clear lane to 27 yd
// and Bastion Sweep needs an unobstructed arc all round. This field west of town
// is flat (so no target slides or snaps, which the no-displacement pins require)
// and probed clear over a 24-point short ring plus the +z lane. The y comes from
// the terrain rather than the plaza's platform height, so targetAt() spawns mobs
// already grounded.
const OPEN_GROUND = { x: -60, z: -2 } as const;

function makeProtection(): TestSim {
  const sim = new Sim({ seed: 7176, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('protection')).toBe(true);
  sim.addItem('eastbrook_buckler', 1);
  sim.equipItem('eastbrook_buckler');
  sim.player.resource = sim.player.maxResource;
  return sim;
}

// Move the staging area out of town, for the tests that need range. Everything
// short-ranged stays on the plaza, whose geometry those pins were written
// against. The ambient wildlife is cleared first: out in the field it would sit
// inside Consecration and the Sunward chain, and the absorb cases pin an exact
// Devotion count that any extra impact would inflate.
function stageInField(sim: TestSim): void {
  for (const [id, entity] of [...sim.entities]) {
    if (entity.kind === 'player') continue;
    // Drop it from the spatial index too: grid.refresh() only re-indexes what it
    // is handed, so a plain entities.delete() leaves the mob in its old cell and
    // hostilesInRadius keeps returning a ghost that outranks the real targets.
    sim.grid.remove(entity);
    sim.entities.delete(id);
  }
  sim.player.pos.x = OPEN_GROUND.x;
  sim.player.pos.z = OPEN_GROUND.z;
  sim.player.pos.y = groundHeight(OPEN_GROUND.x, OPEN_GROUND.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.grid.update(sim.player);
  sim.playerGrid.update(sim.player);
}

function targetAt(sim: TestSim, distance: number, xOffset = 0): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + xOffset,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

function root(target: Entity): void {
  target.auras.push({
    id: 'test_root',
    name: 'Test Root',
    kind: 'root',
    remaining: 60,
    duration: 60,
    value: 0,
    sourceId: -1,
    school: 'holy',
  });
}

describe('Paladin Protection abilities', () => {
  it('requires an equipped shield before Bastion Sweep can spend its cast', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 3);
    root(target);
    delete sim.equipment.offhand;
    delete sim.player.equippedItems.offhand;

    sim.castAbility('bastion_sweep');
    for (let tick = 0; tick < 10; tick++) sim.tick();

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.gcdRemaining).toBe(0);
    expect(sim.player.cooldowns.has('bastion_sweep')).toBe(false);
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'spellfx' && event.fx === 'paladinBastionSweep'),
    ).toBe(false);
  });

  it('Bastion Sweep damages nearby enemies, generates Devotion, and creates high threat', () => {
    const sim = makeProtection();
    const first = targetAt(sim, 5.9);
    const second = targetAt(sim, 3, 2);
    const edge = targetAt(sim, 0);
    const outsideArc = targetAt(sim, 0);
    const behind = targetAt(sim, -2);
    const outside = targetAt(sim, 10);
    const edgeAngle = (89 * Math.PI) / 180;
    edge.pos.x = sim.player.pos.x + Math.sin(edgeAngle) * 5.9;
    edge.pos.z = sim.player.pos.z + Math.cos(edgeAngle) * 5.9;
    const outsideArcAngle = (91 * Math.PI) / 180;
    outsideArc.pos.x = sim.player.pos.x + Math.sin(outsideArcAngle) * 4;
    outsideArc.pos.z = sim.player.pos.z + Math.cos(outsideArcAngle) * 4;
    sim.grid.update(edge);
    sim.grid.update(outsideArc);
    for (const target of [first, second, edge, outsideArc, behind, outside]) root(target);
    const positions = new Map(
      [first, second, edge, outsideArc, behind, outside].map((target) => [
        target.id,
        { ...target.pos },
      ]),
    );
    const playerAuras = [...sim.player.auras];
    const playerArmor = sim.player.stats.armor;
    const groundAreas = [...sim.activeConsecrations];
    sim.player.facing = 0;
    sim.targetEntity(first.id);

    sim.castAbility('bastion_sweep');
    const castEvents = sim.drainEvents();

    expect(first.hp).toBe(first.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(edge.hp).toBe(edge.maxHp);
    expect(first.threat.get(sim.playerId) ?? 0).toBe(0);
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(sim.player.cooldowns.get('bastion_sweep')).toBe(6);
    expect(castEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinBastionSweep',
        facing: 0,
      }),
    );
    expect(
      sim.ctx.delayedEvents.some(
        (event) => event.at === sim.ctx.time + PALADIN_BASTION_SWEEP_IMPACT_TIME,
      ),
    ).toBe(true);
    // The authored wind-up owns the hit direction. Turning during the 0.32 s
    // anticipation must not rotate the authoritative arc away from the VFX.
    sim.player.facing = Math.PI;
    const preImpactEvents: SimEvent[] = [];
    for (let tick = 0; tick < 6; tick++) preImpactEvents.push(...sim.tick());
    expect(first.hp).toBe(first.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(preImpactEvents).not.toContainEqual(
      expect.objectContaining({ type: 'spellfx', fx: 'paladinBastionSweepImpact' }),
    );

    const impactEvents = sim.tick();
    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(edge.hp).toBeLessThan(edge.maxHp);
    expect(outsideArc.hp).toBe(outsideArc.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
    expect(impactEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinBastionSweepImpact',
        targetId: first.id,
      }),
    );
    expect(sim.player.paladinDevotion?.value).toBe(1);
    expect(first.threat.get(sim.playerId) ?? 0).toBeGreaterThan(first.maxHp - first.hp);
    expect(sim.player.cooldowns.get('bastion_sweep')).toBeCloseTo(5.65);
    expect(sim.player.auras).toEqual(playerAuras);
    expect(sim.player.stats.armor).toBe(playerArmor);
    expect(sim.activeConsecrations).toEqual(groundAreas);
    for (const target of [first, second, edge, outsideArc, behind, outside]) {
      expect(target.pos).toEqual(positions.get(target.id));
      expect(target.auras).toEqual([expect.objectContaining({ id: 'test_root' })]);
    }
  });

  it('Oath Chain makes a distant enemy travel toward the Paladin before slowing it', () => {
    const sim = makeProtection();
    stageInField(sim);
    const target = targetAt(sim, 24);
    root(target);
    sim.player.facing = 0;
    sim.targetEntity(target.id);
    const before = Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);

    sim.castAbility('oath_chain');

    expect(Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z)).toBe(
      before,
    );
    expect(target.auras).toContainEqual(
      expect.objectContaining({ id: 'oath_chain_pull', kind: 'forced_move', value: 1 }),
    );

    for (let tick = 0; tick < 10; tick++) sim.tick();
    const during = Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
    expect(during).toBeLessThan(before);
    expect(during).toBeGreaterThan(3);

    for (let tick = 0; tick < 40; tick++) sim.tick();
    expect(
      Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z),
    ).toBeCloseTo(3, 1);
    expect(target.auras).toContainEqual(
      expect.objectContaining({ id: 'oath_chain_slow', kind: 'slow', value: 0.5 }),
    );
  });

  it('pulls a slow-immune enemy over time without applying the final slow', () => {
    const sim = makeProtection();
    stageInField(sim);
    const target = targetAt(sim, 18);
    target.slowImmune = true;
    root(target);
    sim.targetEntity(target.id);

    sim.castAbility('oath_chain');

    expect(target.auras).toContainEqual(
      expect.objectContaining({ id: 'oath_chain_pull', kind: 'forced_move' }),
    );
    for (let tick = 0; tick < 40; tick++) sim.tick();
    expect(
      Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z),
    ).toBeCloseTo(3, 1);
    expect(target.auras.some((aura) => aura.id === 'oath_chain_slow')).toBe(false);
  });

  it('reindexes an Oath Chain target while it travels instead of teleporting for an immediate sweep', () => {
    const sim = makeProtection();
    stageInField(sim);
    const target = targetAt(sim, 24);
    sim.targetEntity(target.id);

    sim.castAbility('oath_chain');
    const afterPull = target.hp;
    sim.castAbility('bastion_sweep');

    expect(target.hp).toBe(afterPull);

    for (let tick = 0; tick < 30; tick++) sim.tick();
    sim.player.gcdRemaining = 0;
    sim.player.cooldowns.delete('bastion_sweep');
    sim.castAbility('bastion_sweep');
    for (let tick = 0; tick < 7; tick++) sim.tick();
    expect(target.hp).toBeLessThan(afterPull);
  });

  it('pulls two enemies with Oath Chain during Ascension', () => {
    const sim = makeProtection();
    stageInField(sim);
    const first = targetAt(sim, 24);
    const second = targetAt(sim, 20, 1);
    const third = targetAt(sim, 24, -4);
    root(first);
    root(second);
    root(third);
    sim.targetEntity(first.id);
    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');

    sim.castAbility('oath_chain');

    expect(first.auras.some((aura) => aura.id === 'oath_chain_pull')).toBe(true);
    expect(second.auras.some((aura) => aura.id === 'oath_chain_pull')).toBe(true);
    expect(third.auras.some((aura) => aura.id === 'oath_chain_pull')).toBe(false);
    expect(first.pos.z).toBeCloseTo(sim.player.pos.z + 24);
    expect(second.pos.z).toBeCloseTo(sim.player.pos.z + 20);
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'divine_ascension', charges: 4 }),
    );
  });

  it('requires a shield to cast Sunward Disc', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 10);
    sim.targetEntity(target.id);
    delete sim.equipment.offhand;
    delete sim.player.equippedItems.offhand;

    sim.castAbility('sunward_disc');
    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.cooldowns.has('sunward_disc')).toBe(false);

    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    expect(sim.equipment.offhand).toBe('eastbrook_buckler');
    sim.drainEvents();
    const second = targetAt(sim, 12, 3);
    const third = targetAt(sim, 13, 4);
    sim.castAbility('sunward_disc');
    expect(target.hp).toBe(target.maxHp);
    const sunwardFx = sim
      .drainEvents()
      .filter((event) => event.type === 'spellfx' && event.fx === 'paladinSunwardDisc');
    for (let tick = 0; tick < 60 && third.hp === third.maxHp; tick++) {
      const events = sim.tick();
      sunwardFx.push(
        ...events.filter((event) => event.type === 'spellfx' && event.fx === 'paladinSunwardDisc'),
      );
    }
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(third.hp).toBeLessThan(third.maxHp);
    expect(sunwardFx).toEqual([
      expect.objectContaining({
        sourceId: sim.player.id,
        targetId: target.id,
        ability: 'sunward_disc',
        level: 0,
      }),
      expect.objectContaining({
        sourceId: target.id,
        targetId: second.id,
        ability: 'sunward_disc',
        level: 1,
      }),
      expect.objectContaining({
        sourceId: second.id,
        targetId: third.id,
        ability: 'sunward_disc',
        level: 2,
      }),
    ]);
  });

  it('Sunward Disc damages on arrival, chains locally from each hit, and grants 1 Devotion per impact', () => {
    const sim = makeProtection();
    stageInField(sim);
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const nearCaster = targetAt(sim, 2);
    const primary = targetAt(sim, 24);
    const second = targetAt(sim, 25, 2);
    const third = targetAt(sim, 27, 4);
    for (const target of [nearCaster, primary, second, third]) root(target);
    sim.player.facing = 0;
    sim.targetEntity(primary.id);

    sim.castAbility('sunward_disc');

    expect(primary.hp).toBe(primary.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(third.hp).toBe(third.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);

    const primaryArrivalEvents: SimEvent[] = [];
    for (let tick = 0; tick < 80 && primary.hp === primary.maxHp; tick++) {
      primaryArrivalEvents.push(...sim.tick());
    }
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(1);
    expect(primaryArrivalEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinSunwardDiscImpact',
        sourceId: sim.player.id,
        targetId: primary.id,
        level: 0,
      }),
    );

    const secondArrivalEvents: SimEvent[] = [];
    for (let tick = 0; tick < 30 && second.hp === second.maxHp; tick++) {
      secondArrivalEvents.push(...sim.tick());
    }
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(third.hp).toBe(third.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(2);
    expect(secondArrivalEvents).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinSunwardDiscImpact',
        sourceId: primary.id,
        targetId: second.id,
        level: 1,
      }),
    );

    for (let tick = 0; tick < 30 && third.hp === third.maxHp; tick++) sim.tick();
    expect(third.hp).toBeLessThan(third.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(3);
  });

  it('keeps Sunward ricochets local when the primary impact is lethal', () => {
    const sim = makeProtection();
    stageInField(sim);
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const nearCaster = targetAt(sim, 2);
    const primary = targetAt(sim, 24);
    const second = targetAt(sim, 25, 2);
    const third = targetAt(sim, 27, 4);
    primary.hp = 1;
    for (const target of [nearCaster, primary, second, third]) root(target);
    sim.player.facing = 0;
    sim.targetEntity(primary.id);

    sim.castAbility('sunward_disc');
    for (let tick = 0; tick < 80 && !primary.dead; tick++) sim.tick();

    expect(primary.dead).toBe(true);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(1);

    for (let tick = 0; tick < 30 && second.hp === second.maxHp; tick++) sim.tick();
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(2);

    for (let tick = 0; tick < 30 && third.hp === third.maxHp; tick++) sim.tick();
    expect(third.hp).toBeLessThan(third.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(3);
  });

  it('does not grant Sunward Devotion for a fully absorbed impact', () => {
    const sim = makeProtection();
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
    const target = targetAt(sim, 10);
    root(target);
    target.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 60,
      duration: 60,
      value: 50_000,
      sourceId: target.id,
      school: 'holy',
    });
    sim.targetEntity(target.id);

    sim.castAbility('sunward_disc');
    for (let tick = 0; tick < 100; tick++) sim.tick();

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);
  });

  it('does not grant Sunward Devotion for a fully absorbed ricochet', () => {
    const sim = makeProtection();
    sim.player.hitBonus = 1;
    const primary = targetAt(sim, 10);
    const absorbedBounce = targetAt(sim, 12, 1);
    for (const target of [primary, absorbedBounce]) root(target);
    absorbedBounce.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 60,
      duration: 60,
      value: 50_000,
      sourceId: absorbedBounce.id,
      school: 'holy',
    });
    sim.targetEntity(primary.id);

    sim.castAbility('sunward_disc');
    const events: SimEvent[] = [];
    for (
      let tick = 0;
      tick < 120 &&
      !events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'paladinSunwardDiscImpact' &&
          event.targetId === absorbedBounce.id,
      );
      tick++
    ) {
      events.push(...sim.tick());
    }

    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(absorbedBounce.hp).toBe(absorbedBounce.maxHp);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'paladinSunwardDiscImpact',
        targetId: absorbedBounce.id,
        level: 1,
      }),
    );
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('Holy Shield never spends Devotion and still grants block and absorb', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 2);
    grantDevotion(sim.player, 2);
    sim.castAbility('holy_shield');

    expect(sim.player.paladinDevotion?.value).toBe(2);
    expect(sim.player.cooldowns.get('holy_shield')).toBe(8);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'holy_shield', kind: 'buff_block', value: 0.3 }),
        expect.objectContaining({
          id: 'holy_shield_absorb',
          kind: 'absorb',
          value: Math.round(sim.player.maxHp * 0.1),
        }),
      ]),
    );
    expect(target.threat.get(sim.playerId) ?? 0).toBeGreaterThan(0);
  });

  it('casts the Ascended Holy Shield as a 15% maximum-health absorb', () => {
    const sim = makeProtection();
    grantDevotion(sim.player, 20);
    expect(activateDivineAscension(sim.player)).toBe(true);

    sim.castAbility('holy_shield');

    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'holy_shield',
          kind: 'buff_block',
          value: 0.4,
          duration: 10,
        }),
        expect.objectContaining({
          id: 'holy_shield_absorb',
          kind: 'absorb',
          value: Math.round(sim.player.maxHp * 0.15),
          duration: 10,
        }),
      ]),
    );
  });

  it('Consecration ticks once per second for nine seconds with threat only inside its radius', () => {
    const sim = makeProtection();
    const inside = targetAt(sim, 2);
    const outside = targetAt(sim, 7);
    root(inside);
    root(outside);

    sim.castAbility('consecration');
    const events = [...sim.drainEvents()];
    expect(sim.activeConsecrations).toEqual([
      expect.objectContaining({ radius: 6, duration: 9, remaining: 9 }),
    ]);
    for (let tick = 0; tick < 9 * 20; tick++) events.push(...sim.tick());

    const insideHits = events.filter(
      (event) =>
        event.type === 'damage' && event.ability === 'Holy Ground' && event.targetId === inside.id,
    );
    const outsideHits = events.filter(
      (event) =>
        event.type === 'damage' && event.ability === 'Holy Ground' && event.targetId === outside.id,
    );
    expect(insideHits).toHaveLength(9);
    expect(outsideHits).toHaveLength(0);
    expect(inside.threat.get(sim.playerId) ?? 0).toBeGreaterThan(
      insideHits.reduce((total, event) => total + (event.type === 'damage' ? event.amount : 0), 0),
    );
    expect(outside.threat.get(sim.playerId) ?? 0).toBeLessThanOrEqual(1);
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('does not generate Devotion when Consecration damage is fully absorbed', () => {
    const sim = makeProtection();
    const target = targetAt(sim, 2);
    root(target);
    target.auras.push({
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 60,
      duration: 60,
      value: 50_000,
      sourceId: target.id,
      school: 'holy',
    });

    sim.castAbility('consecration');
    for (let tick = 0; tick < 9 * 20; tick++) sim.tick();

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);
  });

  it('reduces damage to a Protection Paladin by 10% only while standing in Consecration', () => {
    const sim = makeProtection();
    const attacker = targetAt(sim, 2);
    sim.castAbility('consecration');

    const insideHp = sim.player.hp;
    sim.ctx.dealDamage(attacker, sim.player, 100, false, 'holy', 'Test', 'hit');
    expect(insideHp - sim.player.hp).toBe(90);

    sim.player.hp = insideHp;
    sim.player.pos.z += 9;
    sim.ctx.dealDamage(attacker, sim.player, 100, false, 'holy', 'Test', 'hit');
    expect(insideHp - sim.player.hp).toBe(100);

    const retribution = new Sim({ seed: 7172, playerClass: 'paladin', autoEquip: true }) as TestSim;
    retribution.setPlayerLevel(20);
    retribution.setSpec('retribution');
    const retAttacker = targetAt(retribution, 2);
    retribution.castAbility('consecration');
    const retHp = retribution.player.hp;
    retribution.ctx.dealDamage(retAttacker, retribution.player, 100, false, 'holy', 'Test', 'hit');
    expect(retHp - retribution.player.hp).toBe(100);
  });
});
