// The placed mobile-station renderer (src/render/mobile_stations.ts) in
// plain Node: THREE.Group/Mesh construct fine without a canvas, so the
// mirror's create, re-seat, remove, gated hold and dispose are all
// assertable here, the farm_patches_adapter idiom. The GLBs never load in
// Node, so every prop draws its fallback box part (owned geometry).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENTITY_GATE_STAND_INS } from '../src/render/entity_gate_stand_in_core';
import { FarmPatchVisuals, type FarmPlotSource } from '../src/render/farm_patches';
import {
  MOBILE_STATION_SHADOW_CAP,
  type MobileStationCompileGate,
  MobileStationVisuals,
} from '../src/render/mobile_stations';
import { mobileStationTemplateId } from '../src/sim/professions/mobile_station_object';
import type { Entity } from '../src/sim/types';

function station(id: number, suffix: string, pos = { x: 12, y: 0, z: -8 }): Entity {
  return {
    id,
    kind: 'object',
    templateId: mobileStationTemplateId(suffix),
    name: 'Fizban',
    pos,
    objectItemId: null,
    lootable: false,
  } as unknown as Entity;
}

const SEED = 1234;

function groupOf(scene: THREE.Scene, id: number): THREE.Object3D | undefined {
  return scene.children.find((c) => c.name === `mobileStation:${id}`);
}

describe('MobileStationVisuals', () => {
  it('mirrors a placed station into the scene and removes it on despawn', () => {
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene);
    const entities = new Map<number, Entity>([[7, station(7, 'laden_hearth')]]);
    visuals.sync(entities, SEED);
    const group = groupOf(scene, 7);
    expect(group).toBeDefined();
    expect(group?.visible).toBe(true);
    expect(visuals.standingIds()).toEqual([7]);
    // Steady state: a second read creates nothing new.
    visuals.sync(entities, SEED);
    expect(scene.children.filter((c) => c.name === 'mobileStation:7')).toHaveLength(1);
    entities.clear();
    visuals.sync(entities, SEED);
    expect(groupOf(scene, 7)).toBeUndefined();
    expect(visuals.standingIds()).toEqual([]);
  });

  it('builds the town cluster: the hearth carries a flame, the Grand Cauldron is scaled up', () => {
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene);
    visuals.sync(
      new Map<number, Entity>([
        [1, station(1, 'laden_hearth')],
        [2, station(2, 'grand_cauldron', { x: 40, y: 0, z: 40 })],
        [3, station(3, 'weaponcrafting', { x: 80, y: 0, z: 80 })],
      ]),
      SEED,
    );
    const hearth = groupOf(scene, 1) as THREE.Group;
    const cauldron = groupOf(scene, 2) as THREE.Group;
    const forge = groupOf(scene, 3) as THREE.Group;
    // Three props each (anchor, crate, barrel), the kitchens cluster.
    expect(hearth.children).toHaveLength(3);
    expect(cauldron.children).toHaveLength(3);
    expect(forge.children).toHaveLength(3);
    const meshCount = (holder: THREE.Object3D) =>
      holder.children.filter((c) => (c as THREE.Mesh).isMesh).length;
    // The hearth's anchor: its part plus the flame cone.
    expect(meshCount(hearth.children[0])).toBe(2);
    // The Grand Cauldron: taller than town scale, and lit.
    expect(cauldron.children[0].scale.x).toBeGreaterThan(1);
    expect(meshCount(cauldron.children[0])).toBe(2);
    // A specialization forge placement: town scale, no fire.
    expect(forge.children[0].scale.x).toBe(1);
    expect(meshCount(forge.children[0])).toBe(1);
  });

  it('flickers only its flames per frame and allocates no new children', () => {
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene);
    visuals.sync(new Map<number, Entity>([[1, station(1, 'laden_hearth')]]), SEED);
    const hearth = groupOf(scene, 1) as THREE.Group;
    const flame = hearth.children[0].children[1] as THREE.Mesh;
    const before = flame.scale.y;
    const childrenBefore = scene.children.length;
    visuals.update(0.05);
    visuals.update(0.05);
    expect(flame.scale.y).not.toBe(before);
    expect(scene.children.length).toBe(childrenBefore);
  });

  it('caps shadow casters at MOBILE_STATION_SHADOW_CAP, oldest first, refilling on despawn', () => {
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene);
    const entities = new Map<number, Entity>();
    const total = MOBILE_STATION_SHADOW_CAP + 2;
    for (let id = 1; id <= total; id++) {
      entities.set(id, station(id, 'laden_hearth', { x: id * 10, y: 0, z: 0 }));
    }
    visuals.sync(entities, SEED);
    const casts = (id: number) => {
      const group = groupOf(scene, id) as THREE.Group;
      const meshes: THREE.Mesh[] = [];
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      // The flame cone never casts; every station part follows the budget.
      return meshes.filter((m) => m.castShadow).length > 0;
    };
    for (let id = 1; id <= MOBILE_STATION_SHADOW_CAP; id++) expect(casts(id), `${id}`).toBe(true);
    expect(casts(total - 1)).toBe(false);
    expect(casts(total)).toBe(false);
    entities.delete(1);
    visuals.sync(entities, SEED);
    expect(casts(total - 1)).toBe(true);
    expect(casts(total)).toBe(false);
  });

  it('re-seats a station whose authoritative position moved', () => {
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene);
    const entities = new Map<number, Entity>([[1, station(1, 'grand_cauldron')]]);
    visuals.sync(entities, SEED);
    const group = groupOf(scene, 1) as THREE.Group;
    entities.set(1, station(1, 'grand_cauldron', { x: 30, y: 1, z: 30 }));
    visuals.sync(entities, SEED);
    expect(groupOf(scene, 1)).toBe(group);
    expect(group.position.x).toBe(30);
  });

  it('holds a new station hidden under the compile gate, reveals on settle, retires on despawn', async () => {
    const row = ENTITY_GATE_STAND_INS.find((r) => r.file === 'src/render/mobile_stations.ts');
    expect(row?.gate).toBe('attachSceneGroupGated');
    expect(row?.standIn).toContain('feastNear');
    const pending: { target: THREE.Object3D; label: string; release: () => void }[] = [];
    const gate: MobileStationCompileGate = (target, label) =>
      new Promise<void>((resolve) => pending.push({ target, label, release: resolve }));
    const scene = new THREE.Scene();
    const visuals = new MobileStationVisuals(scene, gate);
    const entities = new Map<number, Entity>([[5, station(5, 'laden_hearth')]]);
    visuals.sync(entities, SEED);
    const held = groupOf(scene, 5);
    expect(held?.visible).toBe(false);
    expect(pending.at(-1)?.label).toBe('mobile-station:5');
    pending.at(-1)?.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(held?.visible).toBe(true);

    // A second station despawned before its gate settles is never shown.
    entities.set(6, station(6, 'grand_cauldron', { x: 50, y: 0, z: 50 }));
    visuals.sync(entities, SEED);
    expect(groupOf(scene, 6)?.visible).toBe(false);
    entities.delete(6);
    visuals.sync(entities, SEED);
    pending.at(-1)?.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(groupOf(scene, 6)).toBeUndefined();
  });

  it('rides the farm driver: FarmPatchVisuals syncs and disposes the stations', () => {
    const scene = new THREE.Scene();
    const farm = new FarmPatchVisuals(scene, new Map(), { burst() {}, groundPuff() {} });
    const entities = new Map<number, Entity>([[9, station(9, 'grand_cauldron')]]);
    const world: FarmPlotSource = {
      get myFarmPlots() {
        return [];
      },
      farmNowMs: () => 0,
      entities,
      cfg: { seed: SEED },
    };
    farm.sync(world, 0.5);
    expect(groupOf(scene, 9)).toBeDefined();
    farm.dispose();
    expect(groupOf(scene, 9)).toBeUndefined();
  });
});
