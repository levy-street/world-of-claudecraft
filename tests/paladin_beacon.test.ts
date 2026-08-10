import { describe, expect, it } from 'vitest';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`missing entity ${id}`);
  return found;
}

function groupedPaladin(): {
  sim: Sim;
  paladin: Entity;
  ally: Entity;
  beacon: Entity;
} {
  const sim = new Sim({ seed: 211, playerClass: 'paladin', noPlayer: true });
  const paladinId = sim.addPlayer('paladin', 'Aurelia');
  const allyId = sim.addPlayer('warrior', 'Borin');
  const beaconId = sim.addPlayer('priest', 'Celia');
  for (const id of [paladinId, allyId, beaconId]) sim.setPlayerLevel(20, id);
  expect(sim.setSpec('holy', paladinId)).toBe(true);
  sim.partyInvite(allyId, paladinId);
  sim.partyAccept(allyId);
  sim.partyInvite(beaconId, paladinId);
  sim.partyAccept(beaconId);
  return {
    sim,
    paladin: entity(sim, paladinId),
    ally: entity(sim, allyId),
    beacon: entity(sim, beaconId),
  };
}

function castBeacon(sim: Sim, paladin: Entity, target: Entity): void {
  paladin.resource = paladin.maxResource;
  paladin.gcdRemaining = 0;
  sim.targetEntity(target.id, paladin.id);
  sim.castAbility('beacon_of_light', paladin.id);
}

function heal(sim: Sim, source: Entity, target: Entity, amount: number): number {
  return sim.ctx.applyHeal(source, target, amount, 'Test Heal', 'test_heal', false, false, true);
}

function runAbility(sim: Sim, source: Entity, target: Entity | null, id: string): void {
  const resolved = sim.resolvedAbility(id, source.id) as ResolvedAbility | null;
  const meta = sim.meta(source.id);
  if (!resolved || !meta) throw new Error(`missing ${id}`);
  sim.ctx.runEffects(source, meta, target, resolved);
}

function makeWounded(...entities: Entity[]): void {
  for (const target of entities) {
    target.maxHp = 1_000;
    target.hp = 1;
  }
}

describe('Paladin Beacon of Light', () => {
  it('is a level 16 Holy ability that marks one living group member', () => {
    const { sim, paladin, beacon } = groupedPaladin();
    const ability = sim.resolvedAbility('beacon_of_light', paladin.id);

    expect(ability?.def).toMatchObject({
      learnLevel: 16,
      specs: ['holy'],
      cooldown: 7,
      targetType: 'friendly',
      partyOnlyTarget: true,
    });
    expect(ability?.effects).toEqual([{ type: 'beaconOfLight' }]);

    castBeacon(sim, paladin, beacon);
    expect(paladin.cooldowns.get('beacon_of_light')).toBe(7);
    expect(beacon.auras).toContainEqual(
      expect.objectContaining({
        id: 'beacon_of_light',
        kind: 'beacon_of_light',
        sourceId: paladin.id,
      }),
    );
  });

  it('copies 50% of effective healing from a real direct-heal effect', () => {
    const { sim, paladin, ally, beacon } = groupedPaladin();
    castBeacon(sim, paladin, beacon);
    ally.maxHp = 1_000;
    ally.hp = 960;
    beacon.maxHp = 1_000;
    beacon.hp = 1;
    sim.rng.range = () => 100;
    sim.rng.chance = () => false;

    runAbility(sim, paladin, ally, 'holy_light');

    expect(ally.hp).toBe(1_000);
    expect(beacon.hp).toBe(21);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'heal2',
        sourceId: paladin.id,
        targetId: beacon.id,
        amount: 20,
        crit: false,
        ability: 'Beacon of Light',
      }),
    );
  });

  it('does not copy AoE healing to the Beacon', () => {
    const { sim, paladin, ally, beacon } = groupedPaladin();
    castBeacon(sim, paladin, beacon);
    makeWounded(paladin, ally, beacon);
    sim.rng.chance = () => false;

    runAbility(sim, paladin, null, 'radiant_chorus');

    const events = sim.drainEvents();
    expect(ally.hp).toBeGreaterThan(1);
    expect(beacon.hp).toBeGreaterThan(1);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'heal2', ability: 'Beacon of Light' }),
    );
  });

  it('does not copy direct healing on the beacon, other healers, overheal, or out-of-range heals', () => {
    const { sim, paladin, ally, beacon } = groupedPaladin();
    const otherHealerId = sim.addPlayer('priest', 'Dara');
    sim.setPlayerLevel(20, otherHealerId);
    sim.partyInvite(otherHealerId, paladin.id);
    sim.partyAccept(otherHealerId);
    const otherHealer = entity(sim, otherHealerId);
    castBeacon(sim, paladin, beacon);
    makeWounded(ally, beacon);

    heal(sim, paladin, beacon, 100);
    expect(beacon.hp).toBe(101);

    heal(sim, paladin, paladin, 100);
    expect(beacon.hp).toBe(101);

    heal(sim, otherHealer, ally, 100);
    expect(beacon.hp).toBe(101);

    const outsiderId = sim.addPlayer('warrior', 'Eamon');
    sim.setPlayerLevel(20, outsiderId);
    const outsider = entity(sim, outsiderId);
    outsider.maxHp = 1_000;
    outsider.hp = 1;
    heal(sim, paladin, outsider, 100);
    expect(beacon.hp).toBe(101);

    ally.hp = ally.maxHp;
    heal(sim, paladin, ally, 100);
    expect(beacon.hp).toBe(101);

    ally.hp = 1;
    ally.pos.x = beacon.pos.x + 61;
    ally.pos.z = beacon.pos.z;
    heal(sim, paladin, ally, 100);
    expect(beacon.hp).toBe(101);
  });

  it("moves one Paladin's beacon while preserving marks placed by another Paladin", () => {
    const { sim, paladin, ally, beacon } = groupedPaladin();
    const secondId = sim.addPlayer('paladin', 'Edrin');
    sim.setPlayerLevel(20, secondId);
    expect(sim.setSpec('holy', secondId)).toBe(true);
    sim.partyInvite(secondId, paladin.id);
    sim.partyAccept(secondId);
    const second = entity(sim, secondId);

    castBeacon(sim, paladin, beacon);
    castBeacon(sim, second, beacon);
    expect(beacon.auras.filter((aura) => aura.kind === 'beacon_of_light')).toHaveLength(2);

    for (let tick = 0; tick < 20 * 7 + 1; tick++) sim.tick();
    castBeacon(sim, paladin, ally);
    expect(
      beacon.auras.some((aura) => aura.kind === 'beacon_of_light' && aura.sourceId === paladin.id),
    ).toBe(false);
    expect(
      beacon.auras.some((aura) => aura.kind === 'beacon_of_light' && aura.sourceId === second.id),
    ).toBe(true);
    expect(
      ally.auras.some((aura) => aura.kind === 'beacon_of_light' && aura.sourceId === paladin.id),
    ).toBe(true);

    makeWounded(paladin, ally, beacon, second);
    heal(sim, paladin, second, 100);
    expect(ally.hp).toBe(51);
    expect(beacon.hp).toBe(1);
    heal(sim, second, paladin, 100);
    expect(beacon.hp).toBe(51);
    expect(ally.hp).toBe(51);
  });

  it('removes the beacon when its carrier or its Paladin dies', () => {
    const carrierDeath = groupedPaladin();
    castBeacon(carrierDeath.sim, carrierDeath.paladin, carrierDeath.beacon);
    expect(carrierDeath.beacon.auras.some((aura) => aura.kind === 'beacon_of_light')).toBe(true);
    carrierDeath.sim.ctx.handleDeath(carrierDeath.beacon, carrierDeath.paladin);
    expect(carrierDeath.beacon.auras.some((aura) => aura.kind === 'beacon_of_light')).toBe(false);

    const casterDeath = groupedPaladin();
    castBeacon(casterDeath.sim, casterDeath.paladin, casterDeath.beacon);
    expect(casterDeath.beacon.auras.some((aura) => aura.kind === 'beacon_of_light')).toBe(true);
    casterDeath.sim.ctx.handleDeath(casterDeath.paladin, null);
    expect(casterDeath.beacon.auras.some((aura) => aura.kind === 'beacon_of_light')).toBe(false);
  });

  it('cannot be dismissed as an ordinary right-click buff', () => {
    const { sim, paladin, beacon } = groupedPaladin();
    castBeacon(sim, paladin, beacon);

    sim.cancelAura('beacon_of_light', beacon.id);

    expect(beacon.auras.some((aura) => aura.kind === 'beacon_of_light')).toBe(true);
  });
});
