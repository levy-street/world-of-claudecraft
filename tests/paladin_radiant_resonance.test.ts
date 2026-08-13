import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { grantDevotion } from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`missing entity ${id}`);
  return found;
}

function holyParty(): {
  sim: Sim;
  paladin: Entity;
  firstAlly: Entity;
  secondAlly: Entity;
} {
  const sim = new Sim({ seed: 412, playerClass: 'paladin', noPlayer: true });
  const paladinId = sim.addPlayer('paladin', 'Aurelia');
  const firstAllyId = sim.addPlayer('warrior', 'Borin');
  const secondAllyId = sim.addPlayer('priest', 'Celia');
  for (const id of [paladinId, firstAllyId, secondAllyId]) sim.setPlayerLevel(20, id);
  expect(sim.setSpec('holy', paladinId)).toBe(true);
  sim.partyInvite(firstAllyId, paladinId);
  sim.partyAccept(firstAllyId);
  sim.partyInvite(secondAllyId, paladinId);
  sim.partyAccept(secondAllyId);
  return {
    sim,
    paladin: entity(sim, paladinId),
    firstAlly: entity(sim, firstAllyId),
    secondAlly: entity(sim, secondAllyId),
  };
}

function runAbility(sim: Sim, source: Entity, id: string): void {
  const resolved = sim.resolvedAbility(id, source.id) as ResolvedAbility | null;
  const meta = sim.meta(source.id);
  if (!resolved || !meta) throw new Error(`missing ${id}`);
  sim.ctx.runEffects(source, meta, null, resolved);
}

function setHealth(target: Entity, hp: number): void {
  target.maxHp = 1_000;
  target.hp = hp;
}

function resonance(target: Entity) {
  return target.auras.find((aura) => aura.kind === 'paladin_radiant_resonance');
}

describe('Paladin Radiant Resonance', () => {
  it('separates the cheap filler heal from the larger expensive heal', () => {
    expect(ABILITIES.holy_light).toMatchObject({
      castTime: 1.5,
      cooldown: 0,
      cost: 25,
      ranks: [
        { rank: 2, level: 8, cost: 35 },
        { rank: 3, level: 14, cost: 50 },
        {
          rank: 4,
          level: 20,
          cost: 65,
          effects: [{ type: 'heal', min: 190, max: 222 }],
        },
      ],
    });
    expect(ABILITIES.dawns_embrace).toMatchObject({
      castTime: 2.5,
      cooldown: 0,
      cost: 90,
      effects: [{ type: 'heal', min: 260, max: 310 }],
    });
  });

  it('keeps unempowered Mending Light as a normal 1.5 sec cast', () => {
    const { sim, paladin } = holyParty();
    setHealth(paladin, 1);
    paladin.resource = 100;
    sim.targetEntity(paladin.id, paladin.id);

    sim.castAbility('holy_light', paladin.id);

    expect(paladin.castingAbility).toBe('holy_light');
    expect(paladin.castTotal).toBe(1.5);
    expect(paladin.resource).toBe(100);
    sim.ctx.cancelCast(paladin);
    expect(paladin.resource).toBe(100);
  });

  it('requires effective healing on at least two allies', () => {
    const { sim, paladin, firstAlly, secondAlly } = holyParty();
    sim.rng.range = () => 100;
    sim.rng.chance = () => false;
    setHealth(paladin, 1);
    setHealth(firstAlly, 1_000);
    setHealth(secondAlly, 1_000);

    runAbility(sim, paladin, 'radiant_chorus');
    expect(resonance(paladin)).toBeUndefined();

    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');
    expect(resonance(paladin)).toMatchObject({
      name: 'Radiant Resonance',
      remaining: 10,
      duration: 10,
      sourceId: paladin.id,
    });
  });

  it('counts only allies inside 30 yards and in line of sight toward the proc threshold', () => {
    const { sim, paladin, firstAlly, secondAlly } = holyParty();
    sim.rng.range = () => 100;
    setHealth(paladin, 1_000);
    setHealth(firstAlly, 1);
    setHealth(secondAlly, 1);
    secondAlly.pos.z = paladin.pos.z + 31;
    sim.playerGrid.update(secondAlly);

    runAbility(sim, paladin, 'radiant_chorus');

    expect(firstAlly.hp).toBeGreaterThan(1);
    expect(secondAlly.hp).toBe(1);
    expect(resonance(paladin)).toBeUndefined();

    setHealth(firstAlly, 1);
    setHealth(secondAlly, 1);
    secondAlly.pos.z = paladin.pos.z;
    sim.playerGrid.update(secondAlly);
    const hasLineOfSight = sim.ctx.hasLineOfSight;
    sim.ctx.hasLineOfSight = (source, target) =>
      target.id !== secondAlly.id && hasLineOfSight(source, target);

    runAbility(sim, paladin, 'radiant_chorus');

    expect(firstAlly.hp).toBeGreaterThan(1);
    expect(secondAlly.hp).toBe(1);
    expect(resonance(paladin)).toBeUndefined();
  });

  it('expires after 10 sec without being consumed', () => {
    const { sim, paladin, firstAlly } = holyParty();
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');

    for (let elapsed = 0; elapsed <= 10; elapsed += DT) sim.tick();

    expect(resonance(paladin)).toBeUndefined();
  });

  it('survives non-eligible, failed, and cancelled casts', () => {
    const { sim, paladin, firstAlly } = holyParty();
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');

    paladin.resource = 64;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('holy_light', paladin.id);
    expect(paladin.castingAbility).toBeNull();
    expect(resonance(paladin)).toBeDefined();

    paladin.resource = 100;
    paladin.gcdRemaining = 0;
    sim.castAbility('sacred_form', paladin.id);
    expect(resonance(paladin)).toBeDefined();

    paladin.resource = 44;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('dawns_embrace', paladin.id);
    expect(paladin.castingAbility).toBeNull();
    expect(resonance(paladin)).toBeDefined();

    paladin.resource = 80;
    sim.castAbility('dawns_embrace', paladin.id);
    expect(paladin.castingAbility).toBe('dawns_embrace');
    sim.ctx.cancelCast(paladin);
    expect(paladin.resource).toBe(80);
    expect(resonance(paladin)).toBeDefined();
  });

  it('makes the next Mending Light instant and consumes the shared proc', () => {
    const { sim, paladin, firstAlly } = holyParty();
    sim.rng.range = () => 100;
    sim.rng.chance = () => false;
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');

    setHealth(paladin, 1);
    paladin.resource = 65;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('holy_light', paladin.id);

    expect(paladin.castingAbility).toBeNull();
    expect(paladin.resource).toBe(0);
    expect(resonance(paladin)).toBeUndefined();
    expect(sim.resolvedAbility('dawns_embrace', paladin.id)).toMatchObject({
      castTime: 2.5,
      cost: 90,
    });
  });

  it("halves Dawn's Embrace mana cost, shortens its cast to 1.5 sec, and consumes the proc", () => {
    const { sim, paladin, firstAlly } = holyParty();
    sim.rng.range = () => 100;
    sim.rng.chance = () => false;
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');

    expect(sim.resolvedAbility('dawns_embrace', paladin.id)).toMatchObject({
      castTime: 1.5,
      cost: 90,
    });

    setHealth(paladin, 1);
    paladin.resource = 80;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('dawns_embrace', paladin.id);

    expect(paladin.castingAbility).toBe('dawns_embrace');
    expect(paladin.castTotal).toBe(1.5);
    expect(resonance(paladin)).toBeDefined();

    paladin.castRemaining = 0;
    sim.tick();

    expect(paladin.castingAbility).toBeNull();
    expect(paladin.resource).toBe(35);
    expect(resonance(paladin)).toBeUndefined();
    expect(sim.resolvedAbility('dawns_embrace', paladin.id)).toMatchObject({
      castTime: 2.5,
      cost: 90,
    });
  });

  it("locks Dawn's Embrace discount when Resonance expires during the cast", () => {
    const { sim, paladin, firstAlly } = holyParty();
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');
    const proc = resonance(paladin);
    if (!proc) throw new Error('missing Radiant Resonance');
    proc.remaining = DT / 2;

    paladin.resource = 80;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('dawns_embrace', paladin.id);
    sim.tick();
    expect(resonance(paladin)).toBeUndefined();
    expect(sim.resolvedAbility('dawns_embrace', paladin.id)?.castTime).toBe(1.5);

    paladin.castRemaining = 0;
    sim.tick();

    expect(paladin.resource).toBe(35);
    expect(paladin.castingAbility).toBeNull();
  });

  it("consumes Resonance when another proc makes Dawn's Embrace free", () => {
    const { sim, paladin, firstAlly } = holyParty();
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');
    sim.ctx.applyAura(paladin, {
      id: 'test_free_dawn',
      name: 'Test Free Dawn',
      kind: 'next_cast_free',
      value: 1,
      remaining: 10,
      duration: 10,
      sourceId: paladin.id,
      school: 'holy',
      empowerAbilities: ['dawns_embrace'],
    });

    paladin.resource = 80;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('dawns_embrace', paladin.id);
    expect(paladin.castTotal).toBe(1.5);
    paladin.castRemaining = 0;
    sim.tick();

    expect(paladin.resource).toBe(80);
    expect(resonance(paladin)).toBeUndefined();
    expect(paladin.auras.some((aura) => aura.id === 'test_free_dawn')).toBe(false);
  });

  it("keeps Ascension's instant Dawn's Embrace while applying the mana discount", () => {
    const { sim, paladin, firstAlly } = holyParty();
    sim.rng.range = () => 100;
    sim.rng.chance = () => false;
    setHealth(paladin, 1);
    setHealth(firstAlly, 1);
    runAbility(sim, paladin, 'radiant_chorus');
    grantDevotion(paladin, 20);
    sim.castAbility('divine_ascension', paladin.id);

    expect(sim.resolvedAbility('dawns_embrace', paladin.id)?.castTime).toBe(0);
    setHealth(paladin, 1);
    paladin.resource = 80;
    paladin.gcdRemaining = 0;
    sim.targetEntity(paladin.id, paladin.id);
    sim.castAbility('dawns_embrace', paladin.id);

    expect(paladin.castingAbility).toBeNull();
    expect(paladin.resource).toBe(35);
    expect(resonance(paladin)).toBeUndefined();
    expect(paladin.paladinDevotion?.ascensionCharges).toBe(4);
  });
});
