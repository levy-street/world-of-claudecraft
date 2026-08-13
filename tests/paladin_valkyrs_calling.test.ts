import { describe, expect, it } from 'vitest';
import { SelfMotionPredictor } from '../src/render/self_motion';
import {
  advanceValkyrsCalling,
  VALKYRS_CALLING_APPROACH_DURATION,
  VALKYRS_CALLING_ASCENT_DURATION,
  VALKYRS_CALLING_DESCENT_DURATION,
  VALKYRS_CALLING_FLIGHT_DURATION,
} from '../src/sim/combat/paladin_valkyrs_calling';
import { VALKYRS_CALLING_FLIGHT_AURA_ID } from '../src/sim/combat/paladin_valkyrs_calling_state';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { activateDivineAscension, grantDevotion, MAX_DEVOTION } from '../src/sim/paladin_devotion';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
  dealDamage(
    source: Entity,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string,
    kind: 'hit',
  ): void;
};

function makeRet(): TestSim {
  const sim = new Sim({ seed: 31381, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetAt(sim: TestSim, distance: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.moveSpeed = 0;
  sim.addEntity(mob);
  sim.player.facing = 0;
  sim.targetEntity(mob.id);
  return mob;
}

function tick(sim: Sim, count: number): void {
  for (let index = 0; index < count; index++) sim.tick();
}

function land(sim: TestSim): SimEvent[] {
  const events: SimEvent[] = [];
  for (let index = 0; index < 60 && sim.player.valkyrsCalling; index++) {
    events.push(...sim.tick());
  }
  expect(sim.player.valkyrsCalling).toBeNull();
  return events;
}

function castAndMeasureImpact(ascended: boolean): {
  damage: number;
  chargesAfterCast: number;
  chargesAfterLanding: number;
  ascensionImpacts: number;
} {
  const sim = makeRet();
  const target = targetAt(sim, 18);
  if (ascended) {
    grantDevotion(sim.player, MAX_DEVOTION);
    expect(activateDivineAscension(sim.player)).toBe(true);
  }

  sim.castAbility('valkyrs_calling');
  const launchEvents = [...sim.events];
  const chargesAfterCast = sim.player.paladinDevotion?.ascensionCharges ?? 0;
  const landingEvents = land(sim);
  return {
    damage: target.maxHp - target.hp,
    chargesAfterCast,
    chargesAfterLanding: sim.player.paladinDevotion?.ascensionCharges ?? 0,
    ascensionImpacts: [...launchEvents, ...landingEvents].filter(
      (event) =>
        event.type === 'spellfx' &&
        event.fx === 'paladinAscensionImpact' &&
        event.ability === 'valkyrs_calling',
    ).length,
  };
}

describe("Paladin Retribution: Valkyr's Calling", () => {
  it('is a level 13 Retribution target ability with the authored range and cooldown', () => {
    expect(ABILITIES.valkyrs_calling).toMatchObject({
      class: 'paladin',
      specs: ['retribution'],
      learnLevel: 13,
      cooldown: 60,
      range: 20,
      requiresTarget: true,
    });
  });

  it('ascends visibly, flies toward the snapshotted enemy position, then descends and impacts', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);
    const start = { ...sim.player.pos };
    const landing = { ...target.pos };
    grantDevotion(sim.player, 7);

    expect([
      VALKYRS_CALLING_ASCENT_DURATION,
      VALKYRS_CALLING_APPROACH_DURATION,
      VALKYRS_CALLING_DESCENT_DURATION,
    ]).toEqual([0.5, 1, 0.5]);
    expect(VALKYRS_CALLING_FLIGHT_DURATION).toBe(2);

    sim.castAbility('valkyrs_calling');

    const flight = sim.player.valkyrsCalling;
    expect(flight).not.toBeNull();
    if (!flight) throw new Error('Valkyr flight did not start');
    const safeLanding = { ...flight.to };
    expect(sim.player.pos).toEqual(start);
    expect(target.hp).toBe(target.maxHp);

    const previous = { ...sim.player.pos };
    let largestStep = 0;
    const advance = (count: number) => {
      for (let index = 0; index < count; index++) {
        sim.tick();
        largestStep = Math.max(
          largestStep,
          Math.hypot(
            sim.player.pos.x - previous.x,
            sim.player.pos.y - previous.y,
            sim.player.pos.z - previous.z,
          ),
        );
        Object.assign(previous, sim.player.pos);
      }
    };

    advance(1);
    const firstStep = Math.hypot(
      sim.player.pos.x - start.x,
      sim.player.pos.y - start.y,
      sim.player.pos.z - start.z,
    );
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(1);

    advance(Math.floor((VALKYRS_CALLING_ASCENT_DURATION * 20) / 2) - 1);
    expect(sim.player.pos.x).toBeCloseTo(start.x, 5);
    expect(sim.player.pos.z).toBeCloseTo(start.z, 5);
    expect(sim.player.pos.y).toBeGreaterThan(start.y);

    advance(Math.ceil(VALKYRS_CALLING_ASCENT_DURATION * 20));
    expect(sim.player.pos.z).toBeGreaterThan(start.z);
    expect(sim.player.pos.z).toBeLessThan(landing.z);
    expect(sim.player.pos.y).toBeGreaterThan(start.y);
    expect(target.hp).toBe(target.maxHp);

    for (let index = 0; index < VALKYRS_CALLING_FLIGHT_DURATION * 20 + 5; index++) {
      advance(1);
      if (!sim.player.valkyrsCalling) break;
    }

    expect(largestStep).toBeLessThan(3);
    expect(sim.player.valkyrsCalling).toBeNull();
    expect(sim.player.pos.x).toBeCloseTo(safeLanding.x, 5);
    expect(sim.player.pos.z).toBeCloseTo(safeLanding.z, 5);
    expect(sim.player.pos.y).toBeCloseTo(safeLanding.y, 5);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(8);
  });

  it('is immune to damage and cannot use other abilities for the whole flight', () => {
    const sim = makeRet();
    const attacker = targetAt(sim, 18);
    const hp = sim.player.hp;

    const assertBlocked = () => {
      sim.dealDamage(attacker, sim.player, 100, false, 'shadow', 'Test spell', 'hit');
      sim.castAbility('avenging_wrath');
      sim.startAutoAttack();
      expect(sim.player.hp).toBe(hp);
      expect(sim.player.autoAttack).toBe(false);
      expect(sim.player.cooldowns.has('avenging_wrath')).toBe(false);
      expect(sim.player.auras.some((aura) => aura.id === 'avenging_wrath')).toBe(false);
    };

    sim.castAbility('valkyrs_calling');
    assertBlocked();
    tick(sim, 15);
    assertBlocked();
    tick(sim, 17);

    attacker.pos.x = sim.player.pos.x;
    attacker.pos.z = sim.player.pos.z;
    const hpBeforeArmedAttack = attacker.hp;
    sim.player.autoAttack = true;
    sim.player.swingTimer = 0;
    sim.tick();
    expect(attacker.hp).toBe(hpBeforeArmedAttack);
    sim.player.autoAttack = false;

    assertBlocked();

    land(sim);
    sim.dealDamage(attacker, sim.player, 100, false, 'shadow', 'Test spell', 'hit');
    expect(sim.player.hp).toBeLessThan(hp);
    sim.castAbility('avenging_wrath');
    expect(sim.player.auras.some((aura) => aura.id === 'avenging_wrath')).toBe(true);
  });

  it('uses the snapshotted landing point and grants no Devotion when the impact has no victims', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);
    grantDevotion(sim.player, 5);

    sim.castAbility('valkyrs_calling');
    const flight = sim.player.valkyrsCalling;
    expect(flight).not.toBeNull();
    if (!flight) throw new Error('Valkyr flight did not start');
    const landing = { ...flight.to };
    target.pos.z += 30;
    land(sim);

    expect(sim.player.pos).toMatchObject(landing);
    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(5);
  });

  it('grants no Devotion when the impact is fully absorbed', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);
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

    sim.castAbility('valkyrs_calling');
    land(sim);

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);
  });

  it('impacts exactly once and cannot repeat damage or Devotion on later ticks', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);

    sim.castAbility('valkyrs_calling');
    const landingEvents = land(sim);
    const hpAfterLanding = target.hp;
    const devotionAfterLanding = sim.player.paladinDevotion?.value;
    const impactsAfterLanding = landingEvents.filter(
      (event) => event.type === 'damage' && event.ability === "Valkyr's Calling",
    ).length;

    expect(impactsAfterLanding).toBe(1);
    const laterEvents: SimEvent[] = [];
    for (let index = 0; index < 10; index++) laterEvents.push(...sim.tick());
    expect(target.hp).toBe(hpAfterLanding);
    expect(sim.player.paladinDevotion?.value).toBe(devotionAfterLanding);
    expect(
      laterEvents.filter(
        (event) => event.type === 'damage' && event.ability === "Valkyr's Calling",
      ),
    ).toHaveLength(0);
  });

  it('cleans up without impact when an external system relocates the paladin', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);

    sim.castAbility('valkyrs_calling');
    sim.player.pos.x += 5;
    sim.tick();

    expect(sim.player.valkyrsCalling).toBeNull();
    expect(sim.player.auras.some((aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID)).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });

  it('cleans up without impact when an external system marks the paladin dead', () => {
    const sim = makeRet();
    const target = targetAt(sim, 18);

    sim.castAbility('valkyrs_calling');
    sim.player.dead = true;
    advanceValkyrsCalling(sim.ctx, sim.player);

    expect(sim.player.valkyrsCalling).toBeNull();
    expect(sim.player.auras.some((aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID)).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });

  it('disables grounded online prediction so the rendered self follows the authoritative flight', () => {
    const sim = makeRet();
    targetAt(sim, 18);
    const predictor = new SelfMotionPredictor(sim.cfg.seed);
    const frame = {
      enabled: true,
      moveInput: {
        forward: false,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
        dive: false,
        surface: false,
      },
      displayFacing: sim.player.facing,
      echoMs: 100,
      jitterMs: 0,
      alpha: 1,
      frameDt: 1 / 60,
    };

    expect(predictor.step(sim.player, frame)).not.toBeNull();
    sim.castAbility('valkyrs_calling');

    const flightAura = sim.player.auras.find((aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID);
    expect(flightAura?.remaining).toBe(VALKYRS_CALLING_FLIGHT_DURATION + DT);
    expect(predictor.step(sim.player, frame)).toBeNull();

    land(sim);
    expect(sim.player.auras.some((aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID)).toBe(false);
    expect(predictor.step(sim.player, frame)).not.toBeNull();
  });

  it('deals more damage during Amanecer and consumes exactly one Ascension charge', () => {
    const normal = castAndMeasureImpact(false);
    const ascended = castAndMeasureImpact(true);

    expect(normal.chargesAfterCast).toBe(0);
    expect(normal.ascensionImpacts).toBe(0);
    expect(ascended.chargesAfterCast).toBe(4);
    expect(ascended.chargesAfterLanding).toBe(4);
    expect(ascended.ascensionImpacts).toBe(1);
    expect(Math.abs(ascended.damage - normal.damage * 1.5)).toBeLessThanOrEqual(1);
  });
});
