// Stealth observation under World PvP (server/entity_observation.ts
// canObserveEntity + src/sim/pvp worldPvpConcealsStealthFrom).
//
// The bug: a viewer who is not hostile yet fell through to the friendly
// detection radius instead of respecting a flagged stealther's privacy. An
// unflagged stranger therefore saw every flagged rogue nearby, then raised the
// flag (instant) and struck where the rogue stood. A viewer who could become
// the stealther's enemy at will cannot scout them while neutral; nearby
// hostile viewers can detect ordinary stealth, and party/raid see their own.

import { describe, expect, it } from 'vitest';
import { canObserveEntity } from '../server/entity_observation';
import { BUILTIN_WORLD, ZONES } from '../src/sim/data';
import { worldPvpStealthExposed, worldPvpZonePolicyAt } from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, SimConfig, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const QUIET_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
/** Same open spots as tests/world_pvp.test.ts. */
const CONTESTED = { x: 60, z: 700 };
const FFA_ZONE = 'drakelands';
const FFA = { x: 353.8, z: 2262.4 };
/** Well inside every detection radius, so only the rule under test decides. */
const NEAR_D2 = 4;

function world(extra: Partial<SimConfig> = {}): Sim {
  return new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: QUIET_WORLD,
    ...extra,
  });
}

function place(e: Entity, spot: { x: number; z: number }): void {
  e.pos = { x: spot.x, y: groundHeight(spot.x, spot.z, SEED), z: spot.z };
  e.prevPos = { ...e.pos };
}

function addPlayer(sim: Sim, name: string, spot = CONTESTED): Entity {
  const pid = sim.addPlayer('warrior', name, { autoEquip: true });
  sim.setPlayerLevel(20, pid);
  const e = sim.entities.get(pid)!;
  place(e, spot);
  return e;
}

/** A flagged rogue in stealth and an unflagged stranger beside them. */
function setup(extra: Partial<SimConfig> = {}) {
  const sim = world(extra);
  const rogue = addPlayer(sim, 'Lurker');
  const viewer = addPlayer(sim, 'Scout', { x: CONTESTED.x, z: CONTESTED.z - 2 });
  viewer.facing = 0; // the rogue is 2 yd ahead, matching NEAR_D2
  sim.setWorldPvpFlag(true, rogue.id);
  rogue.stealthed = true;
  return { sim, rogue, viewer };
}

describe('stealth observation under World PvP', () => {
  it('hides a flagged stealther from an unflagged stranger who could flag at will', () => {
    const { sim, rogue, viewer } = setup();
    expect(rogue.pvpFlag).toBe(true);
    expect(viewer.pvpFlag).toBeFalsy();
    expect(sim.isHostileTo(viewer, rogue)).toBe(false);
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(false);
    // Already knowing the entity cannot bypass neutral-stranger privacy.
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2, true)).toBe(false);
  });

  it('hides them from a flagged stranger outside the hostile held radius', () => {
    const { sim, rogue, viewer } = setup();
    sim.setWorldPvpFlag(true, viewer.id);
    place(viewer, { x: rogue.pos.x, z: rogue.pos.z - 8 });
    expect(sim.isHostileTo(viewer, rogue)).toBe(true);
    expect(canObserveEntity(sim, viewer, rogue, 8 ** 2)).toBe(false);
    expect(canObserveEntity(sim, viewer, rogue, 8 ** 2, true)).toBe(false);
  });

  it('detects nearby ordinary stealth once the stranger becomes hostile', () => {
    const { sim, rogue, viewer } = setup();
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(false);
    sim.setWorldPvpFlag(true, viewer.id);
    expect(sim.isHostileTo(viewer, rogue)).toBe(true);
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(true);
  });

  it('retains a spotted hostile stealther through the held band', () => {
    const { sim, rogue, viewer } = setup();
    sim.setWorldPvpFlag(true, viewer.id);
    place(viewer, { x: rogue.pos.x, z: rogue.pos.z - 5.5 });
    expect(sim.isHostileTo(viewer, rogue)).toBe(true);
    expect(canObserveEntity(sim, viewer, rogue, 5.5 ** 2)).toBe(false);
    expect(canObserveEntity(sim, viewer, rogue, 5.5 ** 2, true)).toBe(true);
  });

  it.each(['vanish', 'greater_invisibility'])('never detects the full escape %s', (id) => {
    const { sim, rogue, viewer } = setup();
    sim.setWorldPvpFlag(true, viewer.id);
    rogue.auras.push({
      id,
      name: 'Escape',
      kind: 'stealth',
      remaining: 20,
      duration: 20,
      value: 0.5,
      sourceId: rogue.id,
      school: 'physical',
    });
    expect(sim.isHostileTo(viewer, rogue)).toBe(true);
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(false);
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2, true)).toBe(false);
  });

  it('a party member still sees their flagged stealther', () => {
    const { sim, rogue, viewer } = setup();
    sim.partyInvite(viewer.id, rogue.id);
    sim.partyAccept(viewer.id);
    expect(sim.partyOf(viewer.id)?.members).toContain(rogue.id);
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(true);
  });

  it('two unflagged players on contested ground keep the friendly detection radius', () => {
    const sim = world();
    const rogue = addPlayer(sim, 'Lurker');
    const viewer = addPlayer(sim, 'Scout');
    rogue.stealthed = true;
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(true);
  });

  it('hides an unflagged stealther on free-for-all ground from a stranger outside it', () => {
    // No zone ships free-for-all today (tests/world_pvp_zones.test.ts pins
    // that), but the rule exists, so mark one for this case and restore it.
    const zone = ZONES.find((z) => z.id === FFA_ZONE)!;
    const previous = zone.worldPvp;
    zone.worldPvp = 'ffa';
    try {
      const sim = world();
      const rogue = addPlayer(sim, 'Lurker', FFA);
      const viewer = addPlayer(sim, 'Scout');
      rogue.stealthed = true;
      expect(worldPvpZonePolicyAt(rogue.pos.x, rogue.pos.z)).toBe('ffa');
      expect(sim.isHostileTo(viewer, rogue)).toBe(false);
      expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(false);
    } finally {
      zone.worldPvp = previous;
    }
  });

  it('a flagged stealther standing in a sanctuary keeps the friendly rule', () => {
    const { sim, rogue, viewer } = setup();
    const sanctuary = ZONES.find((z) => z.id === 'proving_shore')!.graveyard;
    place(rogue, sanctuary);
    place(viewer, sanctuary);
    expect(rogue.pvpFlag).toBe(true);
    expect(worldPvpZonePolicyAt(rogue.pos.x, rogue.pos.z)).toBe('sanctuary');
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(true);
  });

  it('a realm with World PvP switched off keeps the friendly rule', () => {
    const { sim, rogue, viewer } = setup({ worldPvpDisabled: true });
    rogue.pvpFlag = true; // a flag carried over from before the switch
    expect(canObserveEntity(sim, viewer, rogue, NEAR_D2)).toBe(true);
  });
});

describe('worldPvpStealthExposed', () => {
  const flagged = { pvpFlag: true } as Entity;
  const unflagged = { pvpFlag: false } as Entity;

  it('is exposed when flagged on contested ground or anyone on free-for-all ground', () => {
    expect(worldPvpStealthExposed(flagged, 'contested')).toBe(true);
    expect(worldPvpStealthExposed(unflagged, 'ffa')).toBe(true);
    expect(worldPvpStealthExposed(flagged, 'ffa')).toBe(true);
  });

  it('is never exposed in a sanctuary, nor unflagged on contested ground', () => {
    expect(worldPvpStealthExposed(flagged, 'sanctuary')).toBe(false);
    expect(worldPvpStealthExposed(unflagged, 'sanctuary')).toBe(false);
    expect(worldPvpStealthExposed(unflagged, 'contested')).toBe(false);
  });
});
