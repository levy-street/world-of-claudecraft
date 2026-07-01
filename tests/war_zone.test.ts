// The Breach eternal war zone (Valdris): cross-faction players are hostile
// ONLY inside the open Breach band; the Last Bastion truce ground and every
// instance band are exempt; nothing changes anywhere else in the world.

import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerRace } from '../src/sim/types';
import {
  inEternalWarZone,
  inWarZoneSanctuary,
  playerFaction,
  WAR_ZONE_ID,
  warZonePvpHostile,
} from '../src/sim/war_zone';
import { terrainHeight } from '../src/sim/world';

const breach = ZONES.find((z) => z.id === WAR_ZONE_ID)!;

const makeSim = () =>
  new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Host', autoEquip: true });

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

// A point inside the open band, well away from the Last Bastion truce circle.
const OPEN = { x: -100, z: breach.zMin + 40 };

describe('war zone geometry', () => {
  it('the breach zone is registered', () => {
    expect(breach).toBeTruthy();
    expect(breach.levelRange[1]).toBe(60);
  });

  it('covers the open band, not the sanctuary, not instances, not elsewhere', () => {
    expect(inEternalWarZone({ x: OPEN.x, y: 0, z: OPEN.z })).toBe(true);
    // the Last Bastion truce ground (hub + 10yd yard) is exempt
    expect(inWarZoneSanctuary({ x: breach.hub.x, y: 0, z: breach.hub.z })).toBe(true);
    expect(inEternalWarZone({ x: breach.hub.x, y: 0, z: breach.hub.z })).toBe(false);
    // instances live in far-off x bands
    expect(inEternalWarZone({ x: 900, y: 0, z: breach.zMin + 40 })).toBe(false);
    // the rest of the strip is untouched
    expect(inEternalWarZone({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(inEternalWarZone({ x: 0, y: 0, z: breach.zMax + 5 })).toBe(false);
  });

  it('derives player faction with the Human default for pre-race entities', () => {
    const sim = makeSim();
    const e = sim.entities.get(sim.playerId)!;
    expect(e.race).toBe('human');
    expect(playerFaction(e)).toBe('kael');
    e.race = undefined; // a mirrored entity from a pre-race server
    expect(playerFaction(e)).toBe('kael');
  });
});

describe('war zone hostility through the sim choke point', () => {
  function pairInBreach(raceA: PlayerRace, raceB: PlayerRace) {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph', { race: raceA });
    const b = sim.addPlayer('mage', 'Beth', { race: raceB });
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    teleport(sim, ea, OPEN.x, OPEN.z);
    teleport(sim, eb, OPEN.x + 5, OPEN.z + 5);
    return { sim, ea, eb };
  }

  it('cross-faction players are hostile inside the open breach, both ways', () => {
    const { sim, ea, eb } = pairInBreach('human', 'elf');
    expect(sim.isHostileTo(ea, eb)).toBe(true);
    expect(sim.isHostileTo(eb, ea)).toBe(true);
    // and never heal-able
    expect((sim as unknown as { isFriendlyTo(a: Entity, b: Entity): boolean }).isFriendlyTo(ea, eb)).toBe(false);
  });

  it('same-faction players stay friendly inside the breach', () => {
    const { sim, ea, eb } = pairInBreach('human', 'dwarf');
    expect(sim.isHostileTo(ea, eb)).toBe(false);
    expect((sim as unknown as { isFriendlyTo(a: Entity, b: Entity): boolean }).isFriendlyTo(ea, eb)).toBe(true);
  });

  it('cross-faction players are NOT hostile outside the breach', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph', { race: 'human' });
    const b = sim.addPlayer('mage', 'Beth', { race: 'sand_mage' });
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    teleport(sim, ea, 0, 950); // Ossara, outside the breach
    teleport(sim, eb, 5, 955);
    expect(sim.isHostileTo(ea, eb)).toBe(false);
  });

  it('one side standing in the Last Bastion truce ground blocks hostility', () => {
    const { sim, ea, eb } = pairInBreach('human', 'elf');
    teleport(sim, eb, breach.hub.x + 2, breach.hub.z + 2);
    expect(sim.isHostileTo(ea, eb)).toBe(false);
    expect(warZonePvpHostile(ea, eb)).toBe(false);
  });

  it('a dead attacker is never hostile', () => {
    const { sim, ea, eb } = pairInBreach('human', 'elf');
    ea.dead = true;
    expect(sim.isHostileTo(ea, eb)).toBe(false);
  });
});
