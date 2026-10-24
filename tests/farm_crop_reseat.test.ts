// The map editor's live bed drag (render/editor_api/moved_object_preview.ts)
// carries the crops growing in that bed: the pure seat math in
// farm_patches_core.ts, and over the real farm renderer the drawn plot and the
// bed-seat map a later plot rebuild reads.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { shiftMovedObjectInScene } from '../src/render/editor_api/moved_object_preview';
import {
  buildFarmPatchProps,
  type FarmCompileGate,
  FarmPatchVisuals,
} from '../src/render/farm_patches';
import { farmSeatAfterBedMove } from '../src/render/farm_patches_core';
import { FARM_PATCHES, farmBedById } from '../src/sim/content/farm_patches';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import type { FarmPlotView } from '../src/world_api/farming';

const SEED = 1234;
const BED = 'bed_eastbrook_1';
const HOUR = 3_600_000;
const ground = (x: number, z: number) => terrainHeight(x, z, SEED);
const flatGround = () => 7;

function yawOf(q: THREE.Quaternion): number {
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(facing.x, facing.z);
}

describe('farmSeatAfterBedMove', () => {
  it('carries a seat at the bed centre onto the new spot, on the new ground', () => {
    const next = farmSeatAfterBedMove(
      { x: 3, z: 4 },
      { x: 3, z: 4 },
      { x: -10, z: 20 },
      flatGround,
    );
    expect(next).toEqual({ x: -10, y: 7, z: 20, turn: 0 });
  });

  it('keeps an off-centre seat at its offset, turned with the bed', () => {
    const quarter = Math.PI / 2;
    const next = farmSeatAfterBedMove(
      { x: 1, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 10, rotY: quarter },
      (x, z) => x + z,
    );
    // A quarter turn about +y takes the +x offset to -z.
    expect(next.x).toBeCloseTo(10);
    expect(next.z).toBeCloseTo(9);
    expect(next.y).toBeCloseTo(19);
    expect(next.turn).toBeCloseTo(quarter);
  });

  it('turns by the change in yaw only', () => {
    const next = farmSeatAfterBedMove(
      { x: 0, z: 0 },
      { x: 0, z: 0, rotY: 0.5 },
      { x: 0, z: 0, rotY: 0.75 },
      flatGround,
    );
    expect(next.turn).toBeCloseTo(0.25);
  });
});

describe('dragging a planted bed in the map editor', () => {
  function plantedScene(rows: FarmPlotView[], gate: FarmCompileGate | null = null) {
    const scene = new THREE.Scene();
    const props = buildFarmPatchProps(SEED, FARM_PATCHES);
    scene.add(props.group);
    const visuals = new FarmPatchVisuals(
      scene,
      props.seats,
      { burst: () => {}, groundPuff: () => {} },
      gate,
    );
    const world = {
      myFarmPlots: rows,
      farmNowMs: () => HOUR / 2,
      entities: new Map<number, Entity>(),
      cfg: { seed: SEED },
    };
    visuals.sync(world, 0.5);
    return { scene, seats: props.seats, visuals, world };
  }

  const row = (over: Partial<FarmPlotView> = {}): FarmPlotView => ({
    bedId: BED,
    cropId: 'vale_wheat',
    plantedAtMs: 0,
    readyAtMs: HOUR,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status: 'growing',
    ...over,
  });

  it('moves the growing crop, its seat and its turn with the bed', () => {
    const bed = farmBedById(BED);
    if (!bed) throw new Error('no bed');
    const { scene, seats, visuals, world } = plantedScene([row()]);
    const crop = scene.getObjectByName(`farmPlot:${BED}`);
    expect(crop, 'the planted crop must be drawn').toBeDefined();
    if (!crop) return;
    const lift = crop.position.y - ground(bed.x, bed.z);
    const patchId = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED))?.id ?? '';

    const to = { x: bed.x - 60, z: bed.z + 9, rotY: 0.6 };
    const moved = shiftMovedObjectInScene(
      scene,
      { kind: 'farmBed', patchId, bedId: BED },
      { x: bed.x, z: bed.z },
      to,
      ground,
    );
    expect(moved).toBe(2); // the bed instance and its crop

    expect(crop.position.x).toBeCloseTo(to.x);
    expect(crop.position.z).toBeCloseTo(to.z);
    expect(crop.position.y).toBeCloseTo(ground(to.x, to.z) + lift);
    expect(yawOf(crop.quaternion)).toBeCloseTo(to.rotY, 1);
    // The idle sway re-composes onto the turned seat, never the old facing.
    visuals.update(0.25);
    expect(yawOf(crop.quaternion)).toBeCloseTo(to.rotY, 1);
    const seat = seats.get(BED);
    expect(seat).toMatchObject({ x: to.x, z: to.z, y: ground(to.x, to.z) });

    // A rebuild (the crop grows a stage) lands on the moved seat.
    world.myFarmPlots = [row({ cropId: 'brook_carrot' })];
    visuals.sync(world, 0.5);
    const rebuilt = scene.getObjectByName(`farmPlot:${BED}`);
    expect(rebuilt?.position.x).toBeCloseTo(to.x);
    expect(rebuilt?.position.z).toBeCloseTo(to.z);
    visuals.dispose();
  });

  it('drops the crop of a deleted bed until a restore, through any rebuild', () => {
    const bed = farmBedById(BED);
    if (!bed) throw new Error('no bed');
    const { scene, seats, visuals, world } = plantedScene([row()]);
    const crop = scene.getObjectByName(`farmPlot:${BED}`);
    const patchId = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED))?.id ?? '';
    const target = { kind: 'farmBed' as const, patchId, bedId: BED };
    const at = { x: bed.x, z: bed.z };
    shiftMovedObjectInScene(scene, target, at, { ...at, removed: true }, ground);
    // Gone at once, and no seat left for a rebuild or a flourish to use.
    expect(crop?.scale.toArray()).toEqual([0, 0, 0]);
    expect(seats.has(BED)).toBe(false);
    world.myFarmPlots = [row({ cropId: 'brook_carrot' })];
    visuals.sync(world, 0.5);
    expect(scene.getObjectByName(`farmPlot:${BED}`)).toBeUndefined();

    // Restored somewhere else: the next read draws the crop on the new seat.
    const back = { x: bed.x + 4, z: bed.z - 3 };
    shiftMovedObjectInScene(scene, target, { ...at, removed: true }, back, ground);
    expect(seats.get(BED)).toMatchObject(back);
    visuals.sync(world, 0.5);
    const redrawn = scene.getObjectByName(`farmPlot:${BED}`);
    expect(redrawn?.position.x).toBeCloseTo(back.x);
    expect(redrawn?.position.z).toBeCloseTo(back.z);
    expect(redrawn?.scale.toArray()).toEqual([1, 1, 1]);
    visuals.dispose();
  });

  it('never reveals a crop its compile gate is still holding', () => {
    const bed = farmBedById(BED);
    if (!bed) throw new Error('no bed');
    const { scene, visuals } = plantedScene([row()], () => new Promise(() => {}));
    const crop = scene.getObjectByName(`farmPlot:${BED}`);
    expect(crop?.visible).toBe(false);
    const patchId = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED))?.id ?? '';
    const target = { kind: 'farmBed' as const, patchId, bedId: BED };
    const at = { x: bed.x, z: bed.z };
    const away = { x: bed.x + 6, z: bed.z };
    shiftMovedObjectInScene(scene, target, at, away, ground);
    shiftMovedObjectInScene(scene, target, away, { ...away, removed: true }, ground);
    shiftMovedObjectInScene(scene, target, { ...away, removed: true }, away, ground);
    expect(crop?.visible).toBe(false);
    expect(crop?.position.x).toBeCloseTo(away.x);
    visuals.dispose();
  });

  it('moves both drawn stages while a rebuild is still linking', async () => {
    const bed = farmBedById(BED);
    if (!bed) throw new Error('no bed');
    // The first stage links at once; the rebuilt one never settles.
    let gates = 0;
    const { scene, visuals, world } = plantedScene([row()], () =>
      gates++ === 0 ? Promise.resolve() : new Promise(() => {}),
    );
    await Promise.resolve();
    await Promise.resolve();
    world.myFarmPlots = [row({ cropId: 'brook_carrot' })];
    visuals.sync(world, 0.5);
    const stages: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.name === `farmPlot:${BED}`) stages.push(o);
    });
    expect(stages.length).toBe(2);
    const patchId = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED))?.id ?? '';
    const to = { x: bed.x - 12, z: bed.z + 7 };
    shiftMovedObjectInScene(scene, { kind: 'farmBed', patchId, bedId: BED }, bed, to, ground);
    for (const stage of stages) {
      expect(stage.position.x).toBeCloseTo(to.x);
      expect(stage.position.z).toBeCloseTo(to.z);
    }
    visuals.dispose();
  });

  it('leaves an unplanted bed and every other crop alone', () => {
    const bed = farmBedById(BED);
    if (!bed) throw new Error('no bed');
    const other = 'bed_eastbrook_2';
    const { scene, visuals } = plantedScene([row({ bedId: other })]);
    const crop = scene.getObjectByName(`farmPlot:${other}`);
    const before = crop?.position.clone();
    const patchId = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED))?.id ?? '';
    const moved = shiftMovedObjectInScene(
      scene,
      { kind: 'farmBed', patchId, bedId: BED },
      { x: bed.x, z: bed.z },
      { x: bed.x + 5, z: bed.z },
      ground,
    );
    expect(moved).toBe(1); // the bed instance only
    expect(crop?.position.equals(before ?? new THREE.Vector3())).toBe(true);
    visuals.dispose();
  });
});
