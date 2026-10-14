import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap, newFlatCustomMap } from '../src/editor/custom_map';
import {
  promoteEditablePalms,
  promoteMajorWorldProps,
  repairStretchedWorldProps,
  withoutEditableWorldProps,
  worldMajorPropPlacements,
} from '../src/editor/world_prop_placements';
import { isEastbrookRebuildBuilding } from '../src/render/eastbrook_town';
import { isFenbridgeRebuildBuilding } from '../src/render/fenbridge_town';
import { pathCrossesFence } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { MAX_PLACEMENTS, type MapPlacement, sanitizeMapDoc } from '../src/sim/map_doc';
import { isResting } from '../src/sim/progression/xp';
import { type Entity, emptyZoneProps, type ZonePropsDef } from '../src/sim/types';

// Built from the real factory so a new ZonePropsDef field cannot leave this
// fixture silently short of the type (v0.31's marshReeds was exactly that).
// delveMarkers/greatTrees are optional on the type and absent from the factory,
// but this fork's projection always emits them, so the fixture declares them.
const EMPTY: ZonePropsDef = { ...emptyZoneProps(), delveMarkers: [], greatTrees: [] };

describe('editable overworld scenery', () => {
  afterEach(() => setActiveWorldContent(null));

  it('expands buildings and fence runs into ordinary transformable placements', () => {
    const props: ZonePropsDef = {
      ...EMPTY,
      buildings: [
        { kind: 'house', x: 10, z: 20, w: 8, d: 6, rot: 0.4 },
        { kind: 'inn', x: -5, z: 3, w: 10, d: 8, rot: 1.2 },
      ],
      fences: [{ x1: 0, z1: 0, x2: 7.05, z2: 0 }],
    };

    const placements = worldMajorPropPlacements(props);

    expect(placements.filter((p) => p.name?.startsWith('Building'))).toHaveLength(2);
    expect(placements.filter((p) => p.assetId === 'props/fence')).toHaveLength(3);
    expect(placements.every((p) => p.collide)).toBe(true);
    expect(placements.find((p) => p.worldPropKind === 'inn')).toBeDefined();
    expect(placements.filter((p) => p.worldPropKind === 'fence')).toHaveLength(3);
  });

  it('turns every built-in scenery family into selectable placements', () => {
    const props: ZonePropsDef = {
      ...EMPTY,
      wells: [{ x: 1, z: 2, r: 1.4 }],
      stalls: [{ x: 3, z: 4, rot: 0.2, r: 2 }],
      mines: [{ x: 5, z: 6, rot: 0.3 }],
      docks: [{ x: 7, z: 8, rot: 0.4, hutLocal: { x: 2, z: 1, hw: 2, hd: 1.5 } }],
      tents: [{ x: 9, z: 10, rot: 0.5, scale: 1.2 }],
      crates: [[11, 12]],
      campfires: [[13, 14]],
      mudHuts: [[15, 16]],
      ruinRings: [{ x: 17, z: 18, ringR: 4, columns: 3 }],
      graveyards: [{ x: 19, z: 20 }],
      delveMarkers: [{ x: 21, z: 22, delveId: 'drowned_litany' }],
      greatTrees: [{ x: 23, z: 24, r: 4 }],
    };

    const placements = worldMajorPropPlacements(props);
    const assets = new Set(placements.map((placement) => placement.assetId));

    for (const assetId of [
      'props/well',
      'props/market_stand_1',
      'props/timber_pillar',
      'props/dock_platform',
      'props/tent_open',
      'props/crate_wooden',
      'props/bonfire',
      'props/mushroom_red',
      'props/column_broken',
      'props/gravestone_round',
      'dungeon/delve_entrance_2',
      'foliage/twisted_1',
    ]) {
      expect(assets.has(assetId), assetId).toBe(true);
    }
    expect(placements.find((placement) => placement.assetId === 'props/bonfire')?.fire).toBe(true);
    expect(withoutEditableWorldProps(props)).toEqual(EMPTY);
  });

  it('sizes promoted great trees from the same full-model height as the renderer', () => {
    const [tree] = worldMajorPropPlacements({
      ...EMPTY,
      greatTrees: [{ x: 23, z: 24, r: 4 }],
    });

    // The authored target is r * 12 = 48 yards. PlacedAssetsView normalizes
    // twisted_1 to 7.5 yards, so scale 6.4 is the exact matching transform.
    expect(tree.assetId).toBe('foliage/twisted_1');
    expect(tree.scale).toBeCloseTo(6.4, 6);
    expect(tree.scaleX).toBe(1);
    expect(tree.scaleY).toBe(1);
    expect(tree.scaleZ).toBe(1);
  });

  it('new world maps export all scenery as placements without static duplicates', () => {
    const map = newCustomMap('Editable World', 'world', 100);
    const world = customMapToWorldContent(map);

    expect(map.propsMode).toBe('editable-all');
    expect(map.placements.some((p) => p.assetId.startsWith('props/house_'))).toBe(true);
    expect(map.placements.some((p) => p.assetId === 'props/fence')).toBe(true);
    expect(map.placements.some((p) => p.assetId === 'props/bonfire')).toBe(true);
    expect(map.placements.some((p) => p.assetId === 'dungeon/delve_entrance_2')).toBe(true);

    // The ONE exception to "everything becomes a placement": the authored
    // towns (Eastbrook Vale, Fenbridge) draw their own buildings from bespoke
    // subtrees whose art is not placement-shaped. Those records STAY static so
    // the subtree has something to gate on, props.ts skips the generic kit
    // stand-ins for exactly the same records, so there is still no duplicate.
    // Strip them and the editor renders an empty village while the live game
    // shows the town (see sim/custom_world_props clonePropsKeepingAuthoredTowns).
    const authoredTown = (b: { id?: string }): boolean =>
      isEastbrookRebuildBuilding(b as never) || isFenbridgeRebuildBuilding(b as never);
    expect(world.props.buildings.length).toBeGreaterThan(0);
    expect(world.props.buildings.every(authoredTown)).toBe(true);
    expect(map.placements.some((p) => authoredTown(p as never))).toBe(false);
    // The realms' authored dressing is promoted too (flower beds, iron fences,
    // torches, hex homes), with ONE exception: floating decor rides the
    // waterline at its own draft, so a placement would seat it on the seabed.
    expect(map.placements.some((p) => p.assetId === 'props/flower_bed_round')).toBe(true);
    const floats = (BUILTIN_WORLD.props.decorProps ?? []).filter((d) => d.float !== undefined);
    expect(world.props.decorProps).toHaveLength(floats.length);
    expect(world.props.decorProps?.every((d) => d.float !== undefined)).toBe(true);

    // Everything the towns do NOT own is still fully promoted. Benches and
    // walls stay static ON PURPOSE: the authored town subtree draws them with
    // no skip on the generic path, so promoting them would double them.
    expect({
      ...world.props,
      buildings: [],
      wells: [],
      stalls: [],
      fences: [],
      benches: [],
      walls: [],
      decorProps: [],
      // The Highwatch race fixture is a singleton the renderer builds whole
      // (arch + jumps), not a placement family: it stays static like the
      // authored town art.
      raceCourse: undefined,
    }).toEqual({
      ...EMPTY,
      buildings: [],
      wells: [],
      stalls: [],
      fences: [],
      benches: [],
      walls: [],
      decorProps: [],
      raceCourse: undefined,
    });
  });

  it('promotes a recognized legacy world once without touching unrelated or full maps', () => {
    const legacy = newCustomMap('Legacy World', 'legacy', 100);
    legacy.placements = [];
    delete legacy.propsMode;

    expect(promoteMajorWorldProps(legacy)).toBe(true);
    const count = legacy.placements.length;
    expect(count).toBeGreaterThan(0);
    expect(promoteMajorWorldProps(legacy)).toBe(false);
    expect(legacy.placements).toHaveLength(count);

    const partial = newCustomMap('Partial', 'partial', 100);
    partial.placements = worldMajorPropPlacements({
      ...EMPTY,
      buildings: BUILTIN_WORLD.props.buildings,
      fences: BUILTIN_WORLD.props.fences,
    });
    partial.propsMode = 'editable-major';
    const oldCount = partial.placements.length;
    expect(promoteMajorWorldProps(partial)).toBe(true);
    expect(partial.propsMode).toBe('editable-all');
    expect(partial.placements.length).toBeGreaterThan(oldCount);

    const blank = newFlatCustomMap('Blank', 'blank', 100);
    delete blank.propsMode;
    expect(promoteMajorWorldProps(blank)).toBe(false);

    const full = newCustomMap('Full', 'full', 100);
    full.placements = Array.from({ length: MAX_PLACEMENTS }, (_, index) => ({
      id: `full-${index}`,
      assetId: 'props/crate',
      x: index,
      y: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: false,
      snapToGround: true,
    }));
    delete full.propsMode;
    expect(promoteMajorWorldProps(full)).toBe(false);
    expect(full.propsMode).toBeUndefined();
  });

  it('fits camp tents to a natural aspect instead of stretching them across the map', () => {
    // The tents' baked collision is only thin pole slabs, so fitting the target
    // width to it used to blow scaleX up to ~12 (a map-spanning band). The fit
    // must now fall back to a sane aspect on that axis.
    const props: ZonePropsDef = {
      ...EMPTY,
      tents: [
        { x: 0, z: 0, rot: 0, scale: 1 },
        { x: 40, z: 0, rot: 0, scale: 1.2 },
        { x: 80, z: 0, rot: 0, scale: 1 },
        { x: 120, z: 0, rot: 0, scale: 0.9 },
      ],
    };
    const tents = worldMajorPropPlacements(props).filter((p) => p.name?.startsWith('Camp tent'));
    expect(tents.length).toBe(4);
    for (const tent of tents) {
      expect(tent.scaleX ?? 1, `${tent.assetId} scaleX`).toBeLessThanOrEqual(3);
      expect(tent.scaleZ ?? 1, `${tent.assetId} scaleZ`).toBeLessThanOrEqual(3);
      // Height still scaled normally (positive), just not stretched sideways.
      expect(tent.scale).toBeGreaterThan(0);
    }
  });

  it('repairs already-saved stretched tents in place, leaving other props alone', () => {
    const c = { y: 0, rotY: 0, collide: true } as const;
    const map = {
      placements: [
        { assetId: 'props/tent_open', x: 0, z: 0, scale: 2.4, scaleX: 12.37, scaleZ: 0.74, ...c },
        { assetId: 'props/tent_small', x: 5, z: 0, scale: 2, scaleX: 4.7, scaleZ: 0.7, ...c },
        { assetId: 'props/well', x: 9, z: 0, scale: 1, scaleX: 1.1, scaleZ: 1, ...c },
        { assetId: 'props/tent_open', x: 20, z: 0, scale: 2.4, scaleX: 1, scaleZ: 0.74, ...c },
      ],
    };
    expect(repairStretchedWorldProps(map)).toBe(true);
    // The blown-up tent axes reset to the natural aspect (1)...
    expect(map.placements[0].scaleX).toBe(1);
    expect(map.placements[0].scaleZ).toBe(0.74); // in-range axis untouched
    expect(map.placements[1].scaleX).toBe(1);
    // ...a non-tent prop is never touched...
    expect(map.placements[2].scaleX).toBe(1.1);
    // ...and an already-sane tent needs no change.
    expect(map.placements[3].scaleX).toBe(1);
    // Second pass is a no-op (idempotent).
    expect(repairStretchedWorldProps(map)).toBe(false);
  });

  it('repairs legacy trunk-scaled great trees with uniform axes', () => {
    const tree = {
      assetId: 'foliage/twisted_1',
      name: 'Great tree 1',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      scale: 14,
      scaleX: 0.7,
      scaleY: 1.2,
      scaleZ: 0.8,
      collide: true,
    };
    const map = { placements: [tree] };

    expect(repairStretchedWorldProps(map)).toBe(true);
    expect(tree.scale).toBeLessThan(8);
    expect(tree.scaleX).toBe(1);
    expect(tree.scaleY).toBe(1);
    expect(tree.scaleZ).toBe(1);
    expect(repairStretchedWorldProps(map)).toBe(false);
  });

  it('normalizes manually skewed twisted trees without changing overall size', () => {
    const tree = {
      assetId: 'foliage/twisted_1',
      name: 'Twisted tree',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      scale: 5.5,
      scaleX: 1.4,
      scaleY: 0.65,
      scaleZ: 0.8,
      collide: true,
    };
    const map = { placements: [tree] };

    expect(repairStretchedWorldProps(map)).toBe(true);
    expect(tree.scale).toBe(5.5);
    expect([tree.scaleX, tree.scaleY, tree.scaleZ]).toEqual([1, 1, 1]);
    expect(repairStretchedWorldProps(map)).toBe(false);
  });

  it('promotes the beach strand into editable uniformly scaled palms once', () => {
    const map = {
      placements: [] as MapPlacement[],
      propsMode: 'editable-all' as const,
      content: { zones: BUILTIN_WORLD.zones.map((zone) => ({ id: zone.id })) },
      meta: { seed: 20061 },
    };
    expect(promoteEditablePalms(map)).toBe(true);
    expect(map.placements.length).toBeGreaterThan(0);
    expect(map.placements.every((p) => /^biome\/beach_palm_[123]$/.test(p.assetId))).toBe(true);
    expect(map.placements.every((p) => p.scaleX === 1 && p.scaleY === 1 && p.scaleZ === 1)).toBe(
      true,
    );
    expect(promoteEditablePalms(map)).toBe(false);
  });

  it('preserves transform and gameplay metadata through export sanitization', () => {
    const map = newCustomMap('Round trip', 'round-trip', 100);
    const clean = sanitizeMapDoc(JSON.stringify(map));
    const fence = clean?.placements.find((p) => p.worldPropKind === 'fence');

    expect(clean?.propsMode).toBe('editable-all');
    expect(fence?.assetId).toBe('props/fence');
    expect(fence?.collisionMode).toBe('baked');
    expect(fence?.worldPropWidth).toBeGreaterThan(0);
    expect(fence?.worldPropDepth).toBeGreaterThan(0);
    expect(typeof fence?.rotZ).toBe('number');
  });

  it('keeps moved fences jump-aware and moved inns rest-aware', () => {
    const map = newCustomMap('Gameplay props', 'gameplay-props', 100);
    const fence = map.placements.find((p) => p.worldPropKind === 'fence');
    const inn = map.placements.find((p) => p.worldPropKind === 'inn');
    expect(fence).toBeDefined();
    expect(inn).toBeDefined();
    if (!fence || !inn) return;

    const oldInn = { x: inn.x, z: inn.z };
    inn.x += 100;
    inn.z += 100;
    setActiveWorldContent(customMapToWorldContent(map));

    const nx = Math.sin(fence.rotY);
    const nz = Math.cos(fence.rotY);
    expect(
      pathCrossesFence(fence.x - nx * 2, fence.z - nz * 2, fence.x + nx * 2, fence.z + nz * 2),
    ).toBe(true);

    const player = {
      inCombat: false,
      pos: { x: inn.x, y: 0, z: inn.z },
    } as Entity;
    expect(isResting(player)).toBe(true);
    player.pos.x = oldInn.x;
    player.pos.z = oldInn.z;
    expect(isResting(player)).toBe(false);
  });
});
