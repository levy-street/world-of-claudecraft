import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { setActiveWorldContent, ZONES } from '../src/sim/data';
import {
  devTownLanding,
  devTownList,
  devTownSlug,
  devTownTargets,
  resolveDevTown,
} from '../src/sim/dev/town_teleport';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import { distancePointToObb } from '../src/sim/placed_town_kit';
import { Sim } from '../src/sim/sim';
import type { WorldContent, ZoneDef } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function makeSim(devCommands: boolean): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands,
    world: EMPTY_TEST_WORLD,
  });
}

function playerPos(sim: Sim): { x: number; z: number } {
  const me = sim.entities.get(sim.playerId);
  if (!me) throw new Error('player missing');
  return { x: me.pos.x, z: me.pos.z };
}

function texts(sim: Sim): string[] {
  return sim
    .drainEvents()
    .map((event) => (event as { text?: string }).text)
    .filter((text): text is string => typeof text === 'string');
}

function hubOf(zoneId: string): ZoneDef['hub'] {
  const zone = ZONES.find((zn) => zn.id === zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  return zone.hub;
}

describe('dev town resolver (pure)', () => {
  it('slugs a hub name the way the command line spells it', () => {
    expect(devTownSlug('Eastbrook')).toBe('eastbrook');
    expect(devTownSlug('Dawnrest Camp')).toBe('dawnrest_camp');
    expect(devTownSlug('  dawnrest-camp! ')).toBe('dawnrest_camp');
    expect(devTownSlug('')).toBe('');
  });

  it('lists one target per shipped zone hub, in zone order, with unique slugs', () => {
    const targets = devTownTargets(ZONES);
    expect(targets.map((target) => target.zoneId)).toEqual(ZONES.map((zone) => zone.id));
    expect(new Set(targets.map((target) => target.id)).size).toBe(ZONES.length);
    // Hub slugs and zone-id slugs are disjoint namespaces today, so no name
    // can resolve to two different zones through the two alias arms.
    const zoneIdSlugs = new Set(ZONES.map((zone) => devTownSlug(zone.id)));
    for (const target of targets) expect(zoneIdSlugs.has(target.id)).toBe(false);
    for (const target of targets) {
      const hub = hubOf(target.zoneId);
      expect(target.name).toBe(hub.name);
      expect(target.x).toBe(hub.x);
      expect(target.z).toBe(hub.z);
      expect(target.id).toBe(devTownSlug(hub.name));
    }
    // The hub settlements every tester knows are reachable by name.
    expect(targets.map((target) => target.id)).toEqual(
      expect.arrayContaining(['eastbrook', 'fenbridge', 'highwatch', 'dawnrest_camp']),
    );
  });

  it('resolves by slug, display name, or zone id, case-insensitively, exact only', () => {
    expect(resolveDevTown(ZONES, 'eastbrook')?.zoneId).toBe('eastbrook_vale');
    expect(resolveDevTown(ZONES, 'EASTBROOK')?.zoneId).toBe('eastbrook_vale');
    expect(resolveDevTown(ZONES, 'Dawnrest Camp')?.zoneId).toBe('proving_shore');
    expect(resolveDevTown(ZONES, 'dawnrest_camp')?.zoneId).toBe('proving_shore');
    expect(resolveDevTown(ZONES, 'thornpeak_heights')?.id).toBe('highwatch');
    // No prefix or substring matching: a partial name never picks a town.
    expect(resolveDevTown(ZONES, 'east')).toBeNull();
    expect(resolveDevTown(ZONES, 'brook')).toBeNull();
    expect(resolveDevTown(ZONES, '')).toBeNull();
    expect(resolveDevTown(ZONES, '   ')).toBeNull();
    expect(resolveDevTown(ZONES, '12 34')).toBeNull();
  });

  it('prefers the hub a name spells over a zone id that happens to match it', () => {
    // A custom map can name one zone's hub after another zone's id; the town
    // the tester typed wins regardless of which zone sits first in the array.
    const first: ZoneDef = {
      ...ZONES[0],
      id: 'harbor',
      hub: { ...ZONES[0].hub, name: 'Old Quay' },
    };
    const second: ZoneDef = {
      ...ZONES[1],
      id: 'uplands',
      hub: { ...ZONES[1].hub, name: 'Harbor' },
    };
    expect(resolveDevTown([first, second], 'harbor')?.zoneId).toBe('uplands');
    expect(resolveDevTown([first, second], 'old quay')?.zoneId).toBe('harbor');
    // A numeric hub name is still reachable by name (the tp-alias digit guard
    // lives in the command, not here).
    const numeric: ZoneDef = {
      ...ZONES[0],
      id: 'mile_marker',
      hub: { ...ZONES[0].hub, name: '12' },
    };
    expect(resolveDevTown([numeric], '12')?.zoneId).toBe('mile_marker');
  });

  it('falls back to the zone id for a custom-map hub with a blank name', () => {
    const custom: ZoneDef = { ...ZONES[0], id: 'custom_isle', hub: { ...ZONES[0].hub, name: ' ' } };
    const [target] = devTownTargets([custom]);
    expect(target.id).toBe('custom_isle');
    expect(target.name).toBe('custom_isle');
    expect(devTownList([custom])).toBe('custom_isle');
  });
});

describe('dev town landing (pure)', () => {
  // Turned a quarter: its 8 yd width runs along z, so its walls cover x 8 to 12
  // and z 16 to 24 (unturned they would cover x 6 to 14 and z 18 to 22).
  const building = {
    position: { x: 10, z: 20 },
    rotation: Math.PI / 2,
    nativeDimensions: { width: 8, depth: 4 },
    frontStandingPoint: { x: 4, z: 20 },
  };

  it('steps out to the door of a building whose turned walls stand on the hub', () => {
    const landing = devTownLanding({ x: 10, z: 23 }, [building]);
    expect(landing).toEqual({ x: 4, z: 20 });
    expect(landing).not.toBe(building.frontStandingPoint);
  });

  it('keeps the hub when no wall stands on it', () => {
    // inside the unturned box only: the turn is honoured
    expect(devTownLanding({ x: 13, z: 20 }, [building])).toEqual({ x: 13, z: 20 });
    expect(devTownLanding({ x: 10, z: 23 }, [])).toEqual({ x: 10, z: 23 });
  });
});

describe('/dev town', () => {
  it('teleports to the named hub through the shared dev displacement', () => {
    const sim = makeSim(true);
    const hub = hubOf('thornpeak_heights');
    const before = playerPos(sim);
    expect(Math.hypot(before.x - hub.x, before.z - hub.z)).toBeGreaterThan(50);

    sim.chat('/dev town highwatch');

    const after = playerPos(sim);
    expect(after.x).toBeCloseTo(hub.x, 5);
    expect(after.z).toBeCloseTo(hub.z, 5);
    const me = sim.entities.get(sim.playerId);
    expect(me?.prevPos.x).toBeCloseTo(hub.x, 5);
    expect(me?.prevPos.z).toBeCloseTo(hub.z, 5);
    expect(texts(sim).some((text) => text.includes('[dev] Teleported to Highwatch'))).toBe(true);
  });

  it('accepts a spaced display name and the /dev tp <name> alias', () => {
    const sim = makeSim(true);
    sim.chat('/dev town Dawnrest Camp');
    const camp = hubOf('proving_shore');
    expect(playerPos(sim).x).toBeCloseTo(camp.x, 5);
    expect(playerPos(sim).z).toBeCloseTo(camp.z, 5);

    sim.chat('/dev tp fenbridge');
    const fen = hubOf('mirefen_marsh');
    expect(playerPos(sim).x).toBeCloseTo(fen.x, 5);
    expect(playerPos(sim).z).toBeCloseTo(fen.z, 5);
  });

  it('keeps the coordinate form of /dev tp intact and answers a half-typed pair with usage', () => {
    const sim = makeSim(true);
    sim.chat('/dev tp 12.5 -40');
    expect(playerPos(sim).x).toBeCloseTo(12.5, 5);
    expect(playerPos(sim).z).toBeCloseTo(-40, 5);

    const before = playerPos(sim);
    sim.chat('/dev tp 12.5');
    expect(playerPos(sim)).toEqual(before);
    const out = texts(sim);
    expect(out.some((text) => text.includes('[dev] Usage: /dev tp <x> <z>'))).toBe(true);
    expect(out.some((text) => text.includes('Unknown town'))).toBe(false);

    // The digit guard is the tp alias's alone: the town verb looks the name
    // up as typed, so a numeric-named hub on a custom map is never shadowed.
    sim.chat('/dev town 12.5');
    expect(playerPos(sim)).toEqual(before);
    const townOut = texts(sim);
    expect(townOut.some((text) => text.includes("[dev] Unknown town '12.5'"))).toBe(true);
    expect(townOut.some((text) => text.includes('Usage: /dev tp'))).toBe(false);
  });

  it('accepts the no-space spellings while armed', () => {
    const sim = makeSim(true);
    sim.chat('/devtown eastbrook');
    const vale = hubOf('eastbrook_vale');
    expect(playerPos(sim).x).toBeCloseTo(vale.x, 5);
    expect(playerPos(sim).z).toBeCloseTo(vale.z, 5);

    sim.chat('/devtp highwatch');
    const peaks = hubOf('thornpeak_heights');
    expect(playerPos(sim).x).toBeCloseTo(peaks.x, 5);
    expect(playerPos(sim).z).toBeCloseTo(peaks.z, 5);
  });

  it('refuses an unknown town without moving and names the valid list', () => {
    const sim = makeSim(true);
    const before = playerPos(sim);
    const copperBefore = sim.meta(sim.playerId)?.copper ?? 0;
    sim.chat('/dev town nowhere; /dev gold 999');
    expect(playerPos(sim)).toEqual(before);
    const out = texts(sim);
    expect(out.some((text) => text.includes("[dev] Unknown town 'nowhere; /dev gold 999'"))).toBe(
      true,
    );
    expect(out.some((text) => text.includes('eastbrook, fenbridge, highwatch'))).toBe(true);
    // The injected tail was never treated as a command of its own.
    expect(sim.meta(sim.playerId)?.copper ?? 0).toBe(copperBefore);
  });

  it('prints the town list when no name is given', () => {
    const sim = makeSim(true);
    const before = playerPos(sim);
    sim.chat('/dev town');
    expect(playerPos(sim)).toEqual(before);
    expect(texts(sim).some((text) => text.startsWith('[dev] Towns: eastbrook, '))).toBe(true);
  });

  it('is inert when dev commands are off (the production state)', () => {
    const sim = makeSim(false);
    const before = playerPos(sim);
    sim.chat('/dev town highwatch');
    sim.chat('/dev tp highwatch');
    sim.chat('/devtown highwatch');
    expect(playerPos(sim)).toEqual(before);
    expect(texts(sim).some((text) => text.includes('[dev]'))).toBe(false);
  });

  it('advertises the command in the /dev help line', () => {
    const sim = makeSim(true);
    sim.chat('/dev');
    expect(texts(sim).some((text) => text.includes('/dev town'))).toBe(true);
  });

  // Bridgemere's painted rebuild stands its island inn on the hub
  // (sim/painted_towns/bridgemere.ts): the jump lands on the inn's door step.
  const islandInn = PAINTED_TOWNS.flatMap((town) => town.buildings).find(
    (building) => building.id === 'bridgemere_island_inn',
  );

  it("lands at the door of the building that stands on the hub: Bridgemere's island inn", () => {
    if (!islandInn) throw new Error('no island inn');
    const hub = hubOf('willowfen');
    expect(distancePointToObb(hub, islandInn.footprint), 'the inn stands on the hub').toBe(0);
    const sim = makeSim(true);
    sim.chat('/dev town bridgemere');
    const after = playerPos(sim);
    expect(after.x).toBeCloseTo(islandInn.frontStandingPoint.x, 5);
    expect(after.z).toBeCloseTo(islandInn.frontStandingPoint.z, 5);
    expect(distancePointToObb(after, islandInn.footprint)).toBeGreaterThan(1);
    expect(isBlocked(42, after.x, after.z, 0.5), 'the door step is open ground').toBe(false);
    expect(texts(sim).some((text) => text.includes('[dev] Teleported to Bridgemere'))).toBe(true);
  });

  it('lands on the hub itself in a world that does not stand that building', () => {
    // the command reads the ACTIVE world (its zones and its buildings)
    const world: WorldContent = {
      ...EMPTY_TEST_WORLD,
      props: {
        ...EMPTY_TEST_WORLD.props,
        buildings: EMPTY_TEST_WORLD.props.buildings.filter(
          (building) => building.id !== 'bridgemere_island_inn',
        ),
      },
    };
    setActiveWorldContent(world);
    try {
      const sim = new Sim({
        seed: 42,
        playerClass: 'warrior',
        autoEquip: true,
        devCommands: true,
        world,
      });
      sim.chat('/dev town bridgemere');
      const hub = hubOf('willowfen');
      expect(playerPos(sim).x).toBeCloseTo(hub.x, 5);
      expect(playerPos(sim).z).toBeCloseTo(hub.z, 5);
    } finally {
      setActiveWorldContent(null);
    }
  });
});
