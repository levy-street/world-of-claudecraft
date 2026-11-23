import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import {
  compileLiveWorldDocument,
  liveWorldBaseline,
  liveWorldCottagesChanged,
  liveWorldPreview,
  newLiveWorldMap,
  publishedLiveWorldDocument,
  refreshLiveWorldTerrain,
} from '../src/editor/live_world_core';
import { upgradeLoadedMap } from '../src/editor/map_load_upgrades';
import { MOVABLE_OBJECTS } from '../src/editor/object_moves_core';
import { parseMap, serializeMap } from '../src/editor/persist';
import { bankerChestSpots, colliderInternalsForTest, isBlocked } from '../src/sim/colliders';
import {
  authoredMapActive,
  BASE_WORLD,
  BUILTIN_WORLD,
  farmPatchesInActiveWorld,
  gatherNodesInActiveWorld,
  isBuiltinWorldActive,
  setActiveWorldContent,
  studioContentActive,
} from '../src/sim/data';
import { FENBRIDGE_LAYOUT, localToWorld } from '../src/sim/fenbridge_layout';
import { activeFenbridgeLayout } from '../src/sim/fenbridge_touchup';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { traversalBand } from '../src/sim/traversal_band';
import type { Entity } from '../src/sim/types';
import { groundHeight, invalidateTerrainEditIndex, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  applyWorldTouchup,
  worldTouchupBase,
  worldTouchupIdentity,
} from '../src/sim/world_touchup';

import { WORLD_TOUCHUP, WORLD_TOUCHUP_SOURCE } from '../src/sim/world_touchup.generated';

beforeEach(() => setActiveWorldContent({ ...BASE_WORLD, liveWorldPreview: true }));
afterEach(() => setActiveWorldContent(null));

describe('live-world touch-up pipeline', () => {
  it('keeps the checked-in source and runtime artifact in sync', () => {
    const source = WORLD_TOUCHUP_SOURCE ?? liveWorldBaseline();
    const compiled = compileLiveWorldDocument(source);
    expect(worldTouchupIdentity(compiled.patch.changes)).toBe(
      worldTouchupIdentity(WORLD_TOUCHUP.changes),
    );
  });

  it('moves and removes cottage ground pads with their editable placements', () => {
    const map = newLiveWorldMap('Cottage edits');
    const preview = liveWorldPreview(map);
    expect(liveWorldCottagesChanged(preview, map)).toBe(false);
    const cottage = map.fenbridgeTouchup!.addedCottages![0];
    const placement = map.placements.find((p) => p.uid === cottage.uid)!;
    placement.x += 50;
    placement.rotY += 0.5;
    expect(liveWorldCottagesChanged(preview, map)).toBe(true);
    refreshLiveWorldTerrain(preview, map);
    expect(liveWorldCottagesChanged(preview, map)).toBe(false);
    for (const world of [liveWorldPreview(map), compileLiveWorldDocument(map).world]) {
      const moved = activeFenbridgeLayout(world).addedCottageBuildings!.find(
        (b) => b.id === cottage.id,
      )!;
      expect(moved.placement.x).toBe(placement.x);
      expect(moved.rotation).toBe(placement.rotY);
    }
    map.placements.splice(map.placements.indexOf(placement), 1);
    for (const world of [liveWorldPreview(map), compileLiveWorldDocument(map).world]) {
      expect(
        activeFenbridgeLayout(world).addedCottageBuildings!.some((b) => b.id === cottage.id),
      ).toBe(false);
    }
  });

  it('refreshes sculpted terrain and undo/redo over relocated Fenbridge pads', () => {
    const map = newLiveWorldMap('Live sculpt');
    const world = liveWorldPreview(map);
    setActiveWorldContent(world);
    const x = 110,
      z = 280;
    const before = terrainHeight(x, z, WORLD_SEED);
    const stamp = { x, z, radius: 5, delta: 3, falloff: 'flat' as const, mode: 'add' as const };
    const refresh = () => {
      refreshLiveWorldTerrain(world, map);
      invalidateTerrainEditIndex();
      return terrainHeight(x, z, WORLD_SEED);
    };
    map.terrainEdits.push(stamp);
    const raised = refresh();
    expect(raised).toBeCloseTo(before + 3, 8);
    map.terrainEdits.pop();
    expect(refresh()).toBe(before);
    map.terrainEdits.push(stamp);
    expect(refresh()).toBe(raised);
    const compiled = compileLiveWorldDocument(map);
    setActiveWorldContent(compiled.world);
    invalidateTerrainEditIndex();
    expect(terrainHeight(x, z, WORLD_SEED)).toBe(raised);
  });
  it('opens, upgrades, saves and exports without changing any native world data', () => {
    const map = liveWorldBaseline();
    upgradeLoadedMap(map);
    const saved = parseMap(serializeMap(map))!;
    const result = compileLiveWorldDocument(saved);
    expect(result.patch.changes).toEqual({});
    expect(result.world).toBe(BASE_WORLD);
    expect(saved.placements).toEqual([]);
    expect(result.world.services).toBe(BASE_WORLD.services);
    expect(result.world.props).toBe(BASE_WORLD.props);
    expect(result.world.npcs).toBe(BASE_WORLD.npcs);
  });

  it('keeps live terrain, movement and content rules in the viewport and playtest', () => {
    const map = liveWorldBaseline();
    const samples = [
      [0, 300],
      [13, 285],
      [-15, -125],
      [24, -8],
      [185, 1000],
    ];
    const before = samples.map(([x, z]) => groundHeight(x, z, WORLD_SEED));
    for (const world of [liveWorldPreview(map), customMapToWorldContent(map)]) {
      setActiveWorldContent(world);
      expect(isBuiltinWorldActive()).toBe(true);
      expect(authoredMapActive()).toBe(false);
      expect(studioContentActive()).toBe(false);
      expect(traversalBand()).toBe(0.9);
      expect(samples.map(([x, z]) => groundHeight(x, z, WORLD_SEED))).toEqual(before);
    }
  });

  it('keeps every native static collider when opening the live world', () => {
    const native = colliderInternalsForTest.staticWorldColliders(WORLD_SEED);
    setActiveWorldContent(liveWorldPreview(liveWorldBaseline()));
    expect(colliderInternalsForTest.staticWorldColliders(WORLD_SEED)).toEqual(native);
  });

  it('carries a Mirefen terrain change through serialization into the same game heightfield', () => {
    const map = liveWorldBaseline();
    const x = 110,
      z = 280;
    const before = groundHeight(x, z, WORLD_SEED);
    map.terrainEdits.push({ x, z, radius: 5, delta: 3, falloff: 'flat', mode: 'add' });
    setActiveWorldContent(liveWorldPreview(map));
    const preview = groundHeight(x, z, WORLD_SEED);
    expect(preview).not.toBe(before);
    const compiled = compileLiveWorldDocument(serializeMap(map));
    setActiveWorldContent({ ...compiled.world, liveWorldPreview: true });
    expect(groundHeight(x, z, WORLD_SEED)).toBe(preview);
    expect(compiled.world.terrainEdits!.slice(0, -1)).toEqual(BASE_WORLD.terrainEdits);
    expect(compiled.world.props).toBe(BASE_WORLD.props);
  });

  it('moves and deletes an added solid prop without retaining its old placement', () => {
    const map = liveWorldBaseline();
    map.placements.push({
      uid: 'test-crate',
      assetId: 'biome/hex_crate_big',
      x: 110,
      z: 280,
      rotY: 0,
      scale: 1,
      collide: true,
      collisionMode: 'basic',
      collideRadius: 2,
    });
    expect(isBlocked(WORLD_SEED, 110, 280, 0.1)).toBe(false);
    const first = compileLiveWorldDocument(map).world;
    setActiveWorldContent({ ...first, liveWorldPreview: true });
    expect(isBlocked(WORLD_SEED, 110, 280, 0.1)).toBe(true);
    expect(first.placements).toHaveLength(1);
    map.placements[0].x += 10;
    const moved = compileLiveWorldDocument(map).world;
    setActiveWorldContent({ ...moved, liveWorldPreview: true });
    expect(isBlocked(WORLD_SEED, 110, 280, 0.1)).toBe(false);
    expect(isBlocked(WORLD_SEED, 120, 280, 0.1)).toBe(true);
    expect(moved.placements![0].x).toBe(120);
    expect(moved.placements![0].collideRadius).toBe(2);
    map.placements.splice(0, 1);
    expect(compileLiveWorldDocument(map).world).toBe(BASE_WORLD);
    setActiveWorldContent({ ...BASE_WORLD, liveWorldPreview: true });
    expect(isBlocked(WORLD_SEED, 120, 280, 0.1)).toBe(false);
  });

  it('carries explicit native road removal and gameplay object moves without replacing gameplay tables', () => {
    const map = liveWorldBaseline();
    map.roadEdits = { '0': { removed: true } };
    const object = MOVABLE_OBJECTS[0];
    map.objectMoves = { [object.key]: { x: object.builtin.x + 10, z: object.builtin.z } };
    const compiled = compileLiveWorldDocument(map);
    expect(compiled.world.roads).toEqual(BASE_WORLD.roads.slice(1));
    expect(compiled.world.npcs).toBe(BASE_WORLD.npcs);
    expect(compiled.world.camps).toBe(BASE_WORLD.camps);
    expect(compiled.world.objectMoves?.[object.key]).toEqual(map.objectMoves[object.key]);
  });

  it('ignores cross-engine final-ULP noise but detects meaningful changes and NPC ordering', () => {
    expect(worldTouchupIdentity({ dir: 1.1760052070951348 })).toBe(
      worldTouchupIdentity({ dir: 1.176005207095135 }),
    );
    expect(worldTouchupBase({ ...BASE_WORLD, roads: [] })).not.toBe(worldTouchupBase(BASE_WORLD));
    expect(
      worldTouchupBase({
        ...BASE_WORLD,
        npcs: Object.fromEntries(Object.entries(BASE_WORLD.npcs).reverse()),
      }),
    ).not.toBe(worldTouchupBase(BASE_WORLD));
  });

  it('rejects a stale touch-up revision and gives published edits a new local-save identity', () => {
    const map = liveWorldBaseline();
    map.terrainEdits.push({ x: 110, z: 280, radius: 5, delta: 3, falloff: 'flat', mode: 'add' });
    const { patch } = compileLiveWorldDocument(map);
    const next = publishedLiveWorldDocument(map, patch);
    expect(next.meta.overworldRevision).not.toBe(map.meta.overworldRevision);
    expect(next.meta.id).not.toBe(map.meta.id);
    expect(() => compileLiveWorldDocument(next)).toThrow(/revision changed/);
  });

  it('keeps provenance stable while a standalone Studio world has installed its content overlay', () => {
    const map = liveWorldBaseline();
    setActiveWorldContent({ ...BASE_WORLD, placements: [] });
    expect(studioContentActive()).toBe(true);
    expect(liveWorldBaseline()).toEqual(map);
    expect(compileLiveWorldDocument(map).patch.changes).toEqual({});
  });

  it('runs the real Node compiler and writes a source plus shared runtime artifact', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'woc-touchup-test-'));
    try {
      const map = liveWorldBaseline();
      map.terrainEdits.push({ x: 110, z: 280, radius: 5, delta: 3, falloff: 'flat', mode: 'add' });
      const file = path.join(dir, 'edit.json');
      writeFileSync(file, serializeMap(map));
      const output = execFileSync(
        process.execPath,
        ['scripts/world_touchup.mjs', 'export', file, '--out-dir', dir],
        { encoding: 'utf8' },
      );
      expect(output).toContain('terrainEdits');
      const source = JSON.parse(
        readFileSync(path.join(dir, 'data/world_touchup/current.map.json'), 'utf8'),
      );
      expect(source.terrainEdits.at(-1).delta).toBe(3);
      expect(source.meta.overworldRevision).not.toBe(map.meta.overworldRevision);
      expect(readFileSync(path.join(dir, 'src/sim/world_touchup.generated.ts'), 'utf8')).toContain(
        'WORLD_TOUCHUP: WorldTouchup',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects stale baselines, unsupported content edits and missing assets', () => {
    const changedZone = liveWorldBaseline();
    const cleanZone = liveWorldBaseline();
    expect(changedZone.content.zones[0]).not.toBe(cleanZone.content.zones[0]);
    changedZone.content.zones[0].hub.x += 10;
    expect(liveWorldBaseline()).toEqual(cleanZone);
    expect(() => compileLiveWorldDocument(changedZone)).toThrow(/Unsupported.*content/);
    const map = liveWorldBaseline();
    map.meta.overworldBase = 'bad-0-0';
    expect(() => compileLiveWorldDocument(map)).toThrow(/baseline/);
    map.meta.overworldBase = worldTouchupBase(BASE_WORLD);
    map.content.camps.pop();
    expect(() => compileLiveWorldDocument(map)).toThrow(/Unsupported.*content/);
    const unknown = liveWorldBaseline();
    unknown.placements.push({
      assetId: 'does-not-exist',
      collide: false,
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
    });
    expect(() => compileLiveWorldDocument(unknown)).toThrow(/cannot be resolved/);
    expect(() =>
      applyWorldTouchup(
        { ...BASE_WORLD, roads: [] },
        {
          version: 1,
          base: worldTouchupBase(BASE_WORLD),
          changes: {},
        },
      ),
    ).toThrow(/baseline changed/);
    expect(applyWorldTouchup(BASE_WORLD, { version: 1, base: null, changes: {} })).toBe(BASE_WORLD);
  });

  it('reconstructs the authoritative Fenbridge layout in BUILTIN_WORLD and round-trips through Studio', () => {
    setActiveWorldContent(null); // active world is BUILTIN_WORLD
    const layout = activeFenbridgeLayout(BUILTIN_WORLD);
    expect(layout).not.toBe(FENBRIDGE_LAYOUT);

    // 1. All 5 moved Fenbridge buildings match Candidate B coordinates and rotations.
    expect(
      layout.buildings.map((b) => [
        b.id,
        Number(b.placement.x.toFixed(4)),
        Number(b.placement.z.toFixed(4)),
        Number(b.placement.rotation.toFixed(4)),
      ]),
    ).toEqual([
      ['fenbridge_warden_gatehouse', 10.2731, 265.9471, 1.9373],
      ['fenbridge_crooked_reed_inn', 21.4035, 297.9038, 1.5708],
      ['fenbridge_lantern_chapel', -23.9464, 300.279, -1.6057],
      ['fenbridge_moonwort_apothecary', 15.9752, 328.6336, 0.7679],
      ['fenbridge_gilded_strongbox', -47.2492, 333.499, -1.5708],
    ]);
    for (const building of layout.buildings) {
      const prop = BUILTIN_WORLD.props.buildings.find((b) => b.id === building.id);
      expect(prop, building.id).toMatchObject({
        x: building.position.x,
        z: building.position.z,
        rot: building.rotation,
      });
    }

    // 2. Civic props match Candidate B (cistern and stall moved, muster board preserved).
    expect(layout.civic.cistern.position.x).toBeCloseTo(0.12354486560667244, 9);
    expect(layout.civic.cistern.position.z).toBeCloseTo(300.5201133200771, 9);
    expect(layout.civic.provisionStall.position.x).toBeCloseTo(-7.210512234363641, 9);
    expect(layout.civic.provisionStall.position.z).toBeCloseTo(287.6055964057244, 9);
    expect(layout.civic.provisionStall.rotation).toBeCloseTo(-2.4783675378319483, 9);
    expect(layout.civic.musterBoard.position).toEqual({ x: -6, z: 278 });
    expect(
      BUILTIN_WORLD.props.wells.find((w) => w.id === 'fenbridge_mirelight_cistern'),
    ).toMatchObject({
      x: layout.civic.cistern.position.x,
      z: layout.civic.cistern.position.z,
    });
    expect(
      BUILTIN_WORLD.props.stalls.find((s) => s.id === 'fenbridge_provision_stall'),
    ).toMatchObject({
      x: layout.civic.provisionStall.position.x,
      z: layout.civic.provisionStall.position.z,
      rot: layout.civic.provisionStall.rotation,
    });

    // 3. Added north cottages, Streetlamp 17, and 12 Fenbridge foliage placements exist and level terrain.
    const placements = WORLD_TOUCHUP.changes.placements ?? [];
    expect(placements).toHaveLength(16);
    const sourceCottages = (WORLD_TOUCHUP_SOURCE?.placements ?? []).filter(
      (p) => p.assetId === 'tidehold/fenrire/house_a' && p.z > 340,
    );
    expect(sourceCottages.map((p) => p.uid)).toEqual([
      'd4a2522da25a',
      'a1f743dc0b53',
      '97310fe05757',
    ]);
    const northCottages = placements.filter(
      (p) => p.path === '/models/tidehold/fenrire/house_a.glb',
    );
    expect(northCottages).toHaveLength(3);
    for (const cottage of northCottages) {
      expect(terrainHeight(cottage.x, cottage.z, WORLD_SEED)).toBeCloseTo(1.2, 2);
      expect(isBlocked(WORLD_SEED, cottage.x, cottage.z, 0.5)).toBe(true);
    }

    // 4. All 9 Fenbridge NPCs stand unblocked at Candidate B coordinates; weaver_ottilie stays in Eastbrook.
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    for (const npc of layout.services.npcs) {
      expect(BUILTIN_WORLD.npcs[npc.id].pos).toEqual(npc.position);
      const standing = { y: groundHeight(npc.position.x, npc.position.z, WORLD_SEED), lift: 0 };
      expect(
        isBlocked(
          WORLD_SEED,
          npc.position.x,
          npc.position.z,
          npc.bodyRadius,
          false,
          undefined,
          0,
          standing,
        ),
        npc.id,
      ).toBe(false);
      const entity = [...sim.entities.values()].find(
        (e) => e.kind === 'npc' && e.templateId === npc.id,
      );
      expect(entity?.pos.x, npc.id).toBeCloseTo(npc.position.x, 6);
      expect(entity?.pos.z, npc.id).toBeCloseTo(npc.position.z, 6);
    }
    expect(BUILTIN_WORLD.npcs.weaver_ottilie.pos).toEqual({ x: -20.5, z: -117.5 });

    // 5. Petra Vell's banker chest and Crooked Reed Inn rest area follow the moved buildings.
    const petra = layout.services.npcs.find((n) => n.id === 'bursar_petra_vell');
    if (!petra) throw new Error('Expected bursar_petra_vell in active Fenbridge layout');
    const chest = bankerChestSpots(WORLD_SEED).find(
      (spot) =>
        Math.abs(spot.anchorX - petra.position.x) < 1e-6 &&
        Math.abs(spot.anchorZ - petra.position.z) < 1e-6,
    );
    if (!chest) throw new Error('Expected Petra Vell banker chest spot');
    expect(isBlocked(WORLD_SEED, chest.x, chest.z, 0.5)).toBe(true);

    const inn = layout.buildings.find((b) => b.id === 'fenbridge_crooked_reed_inn');
    if (!inn) throw new Error('Expected fenbridge_crooked_reed_inn in active Fenbridge layout');
    const entityAt = (pt: { x: number; z: number }) =>
      ({
        inCombat: false,
        pos: { x: pt.x, y: terrainHeight(pt.x, pt.z, WORLD_SEED), z: pt.z },
      }) as Entity;
    expect(isResting(entityAt(inn.position))).toBe(true);
    // Vacated west edge of old inn (x=13.55, halfDepth=7.2 -> x=6.35..20.75; new inn starts at x=14.2035)
    expect(isResting(entityAt({ x: 8, z: 298 }))).toBe(false);
    expect(isBlocked(WORLD_SEED, 8, 298, 0.5)).toBe(false);
    // Vacated old strongbox (-12.3, 325.3) is open ground in BUILTIN_WORLD
    expect(isBlocked(WORLD_SEED, -12.3, 325.3, 0.5)).toBe(false);

    // 6. Walk-in doorways and raised interior floor decks work at the relocated buildings.
    for (const building of layout.buildings.filter((b) => b.walkIn)) {
      const door = building.sockets.entrance.localPosition;
      const inside = localToWorld(
        building.placement,
        building.placement.rotation,
        door.x,
        door.z + 2,
      );
      const rise =
        groundHeight(inside.x, inside.z, WORLD_SEED) -
        terrainHeight(inside.x, inside.z, WORLD_SEED);
      expect(rise, `${building.id} raised floor`).toBeGreaterThan(0.25);
      const standing = { y: groundHeight(inside.x, inside.z, WORLD_SEED), lift: 0 };
      expect(
        isBlocked(WORLD_SEED, inside.x, inside.z, 0.5, false, undefined, 0, standing),
        `${building.id} interior passable`,
      ).toBe(false);
    }

    // 7. Moved Mirefen gather nodes and farm beds apply in BUILTIN_WORLD.
    const movedWood3 = gatherNodesInActiveWorld().find((n) => n.id === 'wood_mirefen_3');
    if (!movedWood3) throw new Error('Expected wood_mirefen_3 in active world');
    expect(movedWood3.pos.x).toBeCloseTo(-28.655306607051592, 6);
    expect(movedWood3.pos.z).toBeCloseTo(366.6594938238977, 6);
    const mirefenPatch = farmPatchesInActiveWorld().find((p) => p.id === 'patch_mirefen');
    const bed1 = mirefenPatch?.beds.find((b) => b.id === 'bed_mirefen_1');
    if (!bed1) throw new Error('Expected bed_mirefen_1 in patch_mirefen');
    expect(bed1.x).toBeCloseTo(-23.47787353436417, 6);
    expect(bed1.z).toBeCloseTo(327.8430006215338, 6);

    // 8. Round-trip through Studio's newLiveWorldMap -> compileLiveWorldDocument preserves the touch-up.
    const liveMap = newLiveWorldMap('Live World Touch-Up');
    const roundTrip = compileLiveWorldDocument(liveMap);
    expect(worldTouchupIdentity(roundTrip.patch.changes)).toBe(
      worldTouchupIdentity(WORLD_TOUCHUP.changes),
    );
  });
});
