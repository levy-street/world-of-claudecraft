// The shared party-station qualification (Masterwrought phase 18,
// mst-party-walk-closure): the visitor-taking walk became a per-member
// predicate (partySharedStationFor) so the 20 Hz per-viewer resolver
// allocates no per-call closure, with each consumer running its own plain
// loop. This file pins the rework's behavior through BOTH consumers (the
// craft gate's party arm and the per-viewer set resolver) plus the
// allocation-free empty answer. Stations are written straight into the
// transient PlayerMeta.mobileStation slot (the module's "caller owns the
// state" contract); the placement paths have their own suites
// (tests/mobile_station_party.test.ts, tests/professions_station_placement.test.ts).
import { describe, expect, it } from 'vitest';
import { STATION_RADIUS } from '../src/sim/content/professions';
import {
  activeMobileStationCraftsForViewer,
  type MobileCraftingStation,
  partySharedStationSatisfies,
} from '../src/sim/professions/mobile_station';
import { stationTypeForCraft } from '../src/sim/professions/stations';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const FIELD = { x: 5000, z: 5000 };
const FORGE_CRAFT = 'weaponcrafting';
const OTHER_CRAFT = 'alchemy';

function makeWorld(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
}

function metaOf(sim: Sim, pid: number): PlayerMeta {
  return sim.players.get(pid) as PlayerMeta;
}

function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid);
  if (!e) throw new Error('the player has an entity');
  e.pos.x = x;
  e.pos.z = z;
  e.prevPos = { ...e.pos };
}

function posOf(sim: Sim, pid: number): { x: number; z: number } {
  const e = sim.entities.get(pid);
  if (!e) throw new Error('the player has an entity');
  return e.pos;
}

function makeParty(sim: Sim, ...pids: number[]): void {
  const [leader, ...rest] = pids;
  for (const pid of rest) {
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
  }
}

/** A live station literal in the member's transient slot. */
function plantStation(
  sim: Sim,
  pid: number,
  craftId: string,
  x: number,
  z: number,
  opts: { partyShared?: boolean; expired?: boolean } = {},
): MobileCraftingStation {
  const now = sim.ctx.tickCount;
  const station: MobileCraftingStation = {
    playerId: metaOf(sim, pid).name,
    craftId,
    partyShared: opts.partyShared !== false,
    pos: { x, z },
    placedAtTick: now,
    expiresAtTick: opts.expired ? now : now + 1000,
  };
  metaOf(sim, pid).mobileStation = station;
  return station;
}

describe('partySharedStationSatisfies: the gate consumer of the shared qualification', () => {
  function gateWorld() {
    const sim = makeWorld(7);
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('warrior', 'Brill');
    teleport(sim, a, FIELD.x + STATION_RADIUS - 2, FIELD.z);
    teleport(sim, b, FIELD.x, FIELD.z);
    const party = { members: [a, b] };
    const type = stationTypeForCraft(FORGE_CRAFT);
    if (!type) throw new Error('the forge craft maps to a station type');
    return { sim, a, b, party, type };
  }

  it('serves a type-matched, in-range, ACTIVE partyShared member station', () => {
    const { sim, a, b, party, type } = gateWorld();
    plantStation(sim, b, FORGE_CRAFT, FIELD.x, FIELD.z);
    const pos = posOf(sim, a);
    expect(partySharedStationSatisfies(party, a, sim.players, pos, type, sim.ctx.tickCount)).toBe(
      true,
    );
    // The type dimension is the GATE's layer, not the qualification's: the
    // same station refuses a different station type.
    const otherType = stationTypeForCraft(OTHER_CRAFT);
    if (!otherType || otherType === type) throw new Error('the two crafts map to distinct types');
    expect(
      partySharedStationSatisfies(party, a, sim.players, pos, otherType, sim.ctx.tickCount),
    ).toBe(false);
  });

  it('refuses out-of-range, expired, and owner-only member stations, and a null party', () => {
    const { sim, a, b, party, type } = gateWorld();
    const pos = posOf(sim, a);
    const now = sim.ctx.tickCount;
    plantStation(sim, b, FORGE_CRAFT, FIELD.x - STATION_RADIUS - 3, FIELD.z);
    expect(partySharedStationSatisfies(party, a, sim.players, pos, type, now), 'range').toBe(false);
    plantStation(sim, b, FORGE_CRAFT, FIELD.x, FIELD.z, { expired: true });
    expect(partySharedStationSatisfies(party, a, sim.players, pos, type, now), 'expiry').toBe(
      false,
    );
    plantStation(sim, b, FORGE_CRAFT, FIELD.x, FIELD.z, { partyShared: false });
    expect(partySharedStationSatisfies(party, a, sim.players, pos, type, now), 'owner-only').toBe(
      false,
    );
    plantStation(sim, b, FORGE_CRAFT, FIELD.x, FIELD.z);
    expect(partySharedStationSatisfies(null, a, sim.players, pos, type, now), 'no party').toBe(
      false,
    );
  });

  it('skips the SELF slot: an own station never leaks through the party arm', () => {
    const { sim, a, party, type } = gateWorld();
    const pos = posOf(sim, a);
    plantStation(sim, a, FORGE_CRAFT, pos.x, pos.z);
    expect(partySharedStationSatisfies(party, a, sim.players, pos, type, sim.ctx.tickCount)).toBe(
      false,
    );
  });
});

describe('activeMobileStationCraftsForViewer: the resolver consumer', () => {
  it('dedupes the own craft against a shared twin, sorts, and freezes the set', () => {
    const sim = makeWorld(9);
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('warrior', 'Brill');
    const c = sim.addPlayer('warrior', 'Cass');
    makeParty(sim, a, b, c);
    teleport(sim, a, FIELD.x, FIELD.z);
    teleport(sim, b, FIELD.x + 2, FIELD.z);
    teleport(sim, c, FIELD.x, FIELD.z + 2);
    // The viewer's own station (any distance) shares b's craft; c brings a
    // second craft. The set answers every qualifying craft, deduped, sorted.
    plantStation(sim, a, FORGE_CRAFT, FIELD.x - 4000, FIELD.z, { partyShared: false });
    plantStation(sim, b, FORGE_CRAFT, FIELD.x + 2, FIELD.z);
    plantStation(sim, c, OTHER_CRAFT, FIELD.x, FIELD.z + 2);
    const crafts = activeMobileStationCraftsForViewer(sim.ctx, a);
    expect(crafts).toEqual([OTHER_CRAFT, FORGE_CRAFT].sort());
    expect(Object.isFrozen(crafts)).toBe(true);
    expect(() => (crafts as string[]).push('x')).toThrow();
  });

  it('a partied viewer with no qualifying station answers the ONE shared empty array', () => {
    // The allocation-free empty path: the resolver hands every empty answer
    // the same frozen instance (no per-call closure, no per-call array), so
    // two calls, and two different viewers, compare identical by reference.
    const sim = makeWorld(11);
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('warrior', 'Brill');
    const c = sim.addPlayer('warrior', 'Cass');
    makeParty(sim, a, b, c);
    teleport(sim, a, FIELD.x, FIELD.z);
    teleport(sim, b, FIELD.x + STATION_RADIUS + 5, FIELD.z);
    teleport(sim, c, FIELD.x + 1, FIELD.z);
    // b's station is real but out of range of both viewers, so the walk runs
    // and finds nothing (the arm the old code paid a closure for). b itself
    // would see it through the any-distance OWN arm, so the cross-viewer
    // identity check uses the stationless c instead.
    plantStation(sim, b, FORGE_CRAFT, FIELD.x + STATION_RADIUS + 5, FIELD.z);
    const first = activeMobileStationCraftsForViewer(sim.ctx, a);
    const second = activeMobileStationCraftsForViewer(sim.ctx, a);
    expect(first).toEqual([]);
    expect(second, 'the empty answer is one shared instance').toBe(first);
    expect(activeMobileStationCraftsForViewer(sim.ctx, c), 'across viewers too').toBe(first);
  });
});
