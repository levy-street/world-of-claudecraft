import { describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import { BUILTIN_WORLD } from '../src/sim/data';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { makePlacedTownBuilding } from '../src/sim/placed_town_kit';
import { composeWorldLayout, placeLayoutBuilding, type WorldLayout } from '../src/sim/world_layout';

const empty = (): WorldLayout => ({
  version: 1,
  buildings: {},
  npcs: {},
  camps: [],
  groundObjects: {},
  objectMoves: {},
});

describe('shared world layout composition', () => {
  it('keeps new gameplay and missing NPCs while applying only spatial fields', () => {
    const layout = empty();
    const npc = BUILTIN_WORLD.npcs.fury;
    layout.npcs.fury = { pos: { x: 10, z: 20 }, facing: 1 };
    // A stale or malicious editor payload cannot remove capabilities/inventory.
    Object.assign(layout.npcs.fury, { warfareVendor: false, vendorItems: [] });
    const world = composeWorldLayout(BUILTIN_WORLD, layout);
    expect(world.npcs.fury).toEqual({ ...npc, pos: { x: 10, z: 20 }, facing: 1 });
    expect(world.npcs.fury.vendorItems).toHaveLength(189);
    for (const id of ['fisher_nell', 'innkeeper_maudie', 'patron_amos_eelby'])
      expect(world.npcs[id]).toBe(BUILTIN_WORLD.npcs[id]);
    expect(Object.keys(world.npcs)).toEqual(Object.keys(BUILTIN_WORLD.npcs));
    expect(world.services).toBe(BUILTIN_WORLD.services);
    expect(BUILTIN_WORLD.npcs.fury).toBe(npc);
    expect(npc.pos).not.toEqual({ x: 10, z: 20 });
  });

  it('splits a camp without losing its private random stream or later additions', () => {
    const camp = BUILTIN_WORLD.camps.find((c) => c.offStream)!;
    const layout = empty();
    layout.camps.push({
      sources: [{ mobId: camp.mobId, center: { ...camp.center } }],
      placements: [
        { center: { x: 10, z: 20 }, radius: 0.5, count: 1 },
        { center: { x: 15, z: 25 }, radius: 0.5, count: 2 },
      ],
    });
    const world = composeWorldLayout(BUILTIN_WORLD, layout);
    const index = BUILTIN_WORLD.camps.indexOf(camp);
    expect(world.camps.slice(index, index + 2)).toEqual(
      layout.camps[0].placements.map((p) => ({ ...camp, ...p })),
    );
    expect(world.camps[index].offStream).toBe(true);
    expect(world.camps.at(-1)).toBe(BUILTIN_WORLD.camps.at(-1));
    expect(world.camps).toHaveLength(BUILTIN_WORLD.camps.length + 1);
  });

  it('rejects stale identities instead of silently dropping edits', () => {
    const layout = empty();
    layout.npcs.missing_npc = { pos: { x: 0, z: 0 } };
    expect(() => composeWorldLayout(BUILTIN_WORLD, layout)).toThrow('Unknown NPC');
    const camps = empty();
    camps.camps.push({ sources: [{ mobId: 'missing', center: { x: 0, z: 0 } }], placements: [] });
    expect(() => composeWorldLayout(BUILTIN_WORLD, camps)).toThrow('Unknown camp');
  });

  it('keeps ground object gameplay and reserved entity ids', () => {
    const object = BUILTIN_WORLD.groundObjects.find((o) => o.itemId === 'eastbrook_freight_wagon')!;
    const layout = empty();
    layout.groundObjects[object.itemId] = { positions: [{ x: 5, z: 6 }] };
    const world = composeWorldLayout(BUILTIN_WORLD, layout);
    const moved = world.groundObjects.find((o) => o.itemId === object.itemId)!;
    expect(moved).toEqual({ ...object, positions: [{ x: 5, z: 6 }] });
    expect(moved.entityIds).toEqual([2_147_100_004]);
    expect(world.groundObjects[1]).toBe(BUILTIN_WORLD.groundObjects[1]);
  });
});

describe('canonical building placement', () => {
  it('moves the real Fenbridge bank and its teller/entrance together', () => {
    const bank = FENBRIDGE_LAYOUT.buildings.find((b) => b.id === 'fenbridge_gilded_strongbox')!;
    const target = {
      path: bank.assetId,
      x: -47.24921810755174,
      z: 333.4989613563245,
      rotation: -Math.PI / 2,
      scale: 11.099795454545452,
      lift: -2.55,
      groundY: 1.1168982661567985,
    };
    const placed = placeLayoutBuilding(bank, target);
    expect(placed.placement.x).toBe(target.x);
    expect(placed.placement.z).toBe(target.z);
    expect(placed.walkIn).toBe(true);
    expect(placed.placement.modelSize).toBe(bank.placement.modelSize);
    const dx = target.x - bank.placement.x;
    const dz = target.z - bank.placement.z;
    expect(placed.frontStandingPoint.x).toBeCloseTo(bank.frontStandingPoint.x + dx, 3);
    expect(placed.frontStandingPoint.z).toBeCloseTo(bank.frontStandingPoint.z + dz, 3);
    expect(placed.sockets.entrance.position.x).toBeCloseTo(
      bank.sockets.entrance.position.x + dx,
      3,
    );
    expect(bank.placement.x).toBe(-12.3);
  });

  it('rotates and scales every geometry field with the collider yaw convention', () => {
    const building = makePlacedTownBuilding(
      {
        id: 'test',
        assetId: '/model.glb',
        kind: 'inn',
        anchor: { x: 10, z: 20 },
        rotation: 0,
        reach: { x: 0, z: 0, width: 10, height: 8, depth: 10 },
        walls: { x: 1, z: 2, width: 6, depth: 4 },
        doorX: 1,
        annexes: [{ name: 'tower', x: 4, z: 3, width: 2, depth: 2 }],
        walkIn: true,
      },
      { scale: 1, lift: -1, frontClearance: 2 },
    );
    const placed = placeLayoutBuilding(building, {
      path: '/model.glb',
      x: 100,
      z: 200,
      rotation: Math.PI / 2,
      scale: 20 / 2.2,
      lift: -3,
    });
    expect(placed.position).toEqual({ x: 104, z: 198 });
    expect(placed.annexes[0].center).toEqual({ x: 106, z: 192 });
    expect(placed.footprint.center).toEqual(placed.position);
    expect(placed.frontStandingPoint).toEqual({ x: 96, z: 198 });
    expect(placed.nativeDimensions).toEqual({ width: 12, height: 13, depth: 8 });
    expect(placed.placement.scale).toBe(2);
    expect(placed.sockets.entrance.localPosition).toEqual({ x: 2, z: 0 });
  });

  it('refuses asset substitution and nonfinite transforms', () => {
    const bank = FENBRIDGE_LAYOUT.buildings[4];
    const target = { path: 'wrong.glb', x: 0, z: 0, rotation: 0, scale: 1, lift: 0 };
    expect(() => placeLayoutBuilding(bank, target)).toThrow('model mismatch');
    expect(() =>
      placeLayoutBuilding(bank, { ...target, path: bank.assetId, scale: Number.NaN }),
    ).toThrow('Invalid building');
  });
});
