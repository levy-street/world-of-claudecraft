import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHoardValley,
  disposeHoardValleyGroup,
  resolveHoardValleyEffectsProfile,
  updateHoardValleyDayNight,
  updateHoardValleySkyDayNight,
} from '../src/render/hoard_valley';
import type { RiftFloorPlan } from '../src/sim/rift/types';

function floorPlan(): RiftFloorPlan {
  return {
    seed: 0x91234567,
    baseLevel: 20,
    floorIndex: 0,
    floorCount: 1,
    isBoss: true,
    name: 'Buried Hoard',
    themeName: 'Hidden Valley',
    layout: {
      zMin: -19,
      zMax: 145,
      sideWallZ: 63,
      sideWallHd: 83,
      wallX: 35,
      floorHalfX: 34,
      pillars: [],
      tombs: [],
      stubs: [],
      clutter: [],
      dais: { x: 0, z: 126, r: 13 },
      shellPolygon: [
        { x: 9, z: -19 },
        { x: 9, z: 10 },
        { x: 17, z: 28 },
        { x: 30, z: 50 },
        { x: 34, z: 145 },
        { x: -34, z: 145 },
        { x: -30, z: 50 },
        { x: -17, z: 28 },
        { x: -9, z: 10 },
        { x: -9, z: -19 },
      ],
    },
    style: {
      kit: 'temple',
      torch: { flame: 0xffffff, emissive: 0xffffff, light: 0xffffff },
      fog: { color: 0xffffff, near: 10, far: 100 },
    },
    entry: { x: 0, z: -11 },
    spawns: [],
    objects: [],
    puzzle: { kind: 'none', pylonCount: 0 },
    hazards: [],
    iceZone: null,
    rollers: [],
    platform: null,
    gate: null,
    outdoor: { zoneId: 'amberfall', gorgeEndZ: 18, valleyStartZ: 39 },
  };
}

describe('hoard valley painter', () => {
  it('grades the basic low-preset sky through the live night cycle', () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const setDayNight = vi.fn();
    const setCycle = vi.fn();
    updateHoardValleySkyDayNight(
      { dome: new THREE.Mesh(new THREE.SphereGeometry(1), material), setDayNight, setCycle },
      {
        lightScale: 0.2,
        ambientScale: 0.3,
        sky: [0.08, 0.12, 0.24],
        fog: [0.14, 0.2, 0.32],
        farScale: 0.8,
        nightAmt: 1,
      },
      new THREE.Vector3(0, -1, 0),
    );
    expect(material.color.toArray()).toEqual([0.18, 0.22, 0.38]);
    expect(setDayNight).toHaveBeenCalledWith([0.08, 0.12, 0.24]);
    expect(setCycle).toHaveBeenCalledOnce();
  });

  it('attaches hidden through the GPU compile gate and seats at the instance offset', async () => {
    const scene = new THREE.Scene();
    let release = (): void => {};
    let compiled: THREE.Object3D | null = null;
    const gate = (target: THREE.Object3D) =>
      new Promise<void>((resolve) => {
        compiled = target;
        release = resolve;
      });
    const view = buildHoardValley({
      scene,
      compileGate: gate,
      plan: floorPlan(),
      offset: { x: 80, y: -3, z: 400 },
      effectsProfile: resolveHoardValleyEffectsProfile('high'),
    });
    expect(compiled).toBe(view.group);
    expect(scene.children).toContain(view.group);
    expect(view.group.visible).toBe(false);
    expect(view.group.position.toArray()).toEqual([80, -3, 400]);
    release();
    await view.readyForEntry;
    expect(view.group.visible).toBe(true);
    view.dispose();
  });

  it('holds reveal for both environment preparation and shader compilation', async () => {
    const scene = new THREE.Scene();
    let releaseEnvironment = (): void => {};
    let releaseCompile = (): void => {};
    const view = buildHoardValley({
      scene,
      prepareEnvironment: () =>
        new Promise<void>((resolve) => {
          releaseEnvironment = resolve;
        }),
      compileGate: () =>
        new Promise<void>((resolve) => {
          releaseCompile = resolve;
        }),
      plan: floorPlan(),
      offset: { x: 0, y: 0, z: 0 },
      effectsProfile: resolveHoardValleyEffectsProfile('high'),
    });
    releaseCompile();
    await Promise.resolve();
    expect(view.group.visible).toBe(false);
    releaseEnvironment();
    await view.readyForEntry;
    expect(view.group.visible).toBe(true);
    view.dispose();
  });

  it('builds shared-resource instancing for the ground, boundary and zone props', async () => {
    const scene = new THREE.Scene();
    const view = buildHoardValley({
      scene,
      plan: floorPlan(),
      offset: { x: 0, y: 0, z: 0 },
      effectsProfile: resolveHoardValleyEffectsProfile('ultra'),
    });
    const secondView = buildHoardValley({
      scene,
      plan: floorPlan(),
      offset: { x: 80, y: 0, z: 0 },
      effectsProfile: resolveHoardValleyEffectsProfile('ultra'),
    });
    await view.readyForEntry;
    await secondView.readyForEntry;
    const instances: THREE.InstancedMesh[] = [];
    const secondInstances: THREE.InstancedMesh[] = [];
    view.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instances.push(object);
    });
    secondView.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) secondInstances.push(object);
    });
    expect(view.group.getObjectByName('HoardValleyGround')).toBeInstanceOf(THREE.Mesh);
    expect(instances.map((mesh) => mesh.name)).toContain('HoardCavernCornice');
    expect(instances.map((mesh) => mesh.name)).toContain('HoardCavernHangingRoots');
    expect(instances.map((mesh) => mesh.name)).toContain('HoardValleyBoundaryCliffs');
    expect(instances.length).toBeLessThanOrEqual(6);
    for (const mesh of instances) {
      expect(mesh.geometry.userData.sharedRendererResource).toBe(true);
      expect((mesh.material as THREE.Material).userData.sharedRendererResource).toBe(true);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    }
    expect(secondInstances.map((mesh) => mesh.name)).toEqual(instances.map((mesh) => mesh.name));
    for (let i = 0; i < instances.length; i++) {
      expect(secondInstances[i].geometry).toBe(instances[i].geometry);
      expect(secondInstances[i].material).toBe(instances[i].material);
    }
    expect(view.group.getObjectByName('HoardValleyGroundShadows')).toBeDefined();
    updateHoardValleyDayNight({ fog: [0.14, 0.2, 0.32], nightAmt: 1 });
    const material = instances[0].material as THREE.MeshBasicMaterial;
    expect(material.color.r).toBeGreaterThanOrEqual(0.75);
    expect(material.color.b).toBeGreaterThan(material.color.r);
    updateHoardValleyDayNight({ fog: [1, 1, 1], nightAmt: 0 });
    secondView.dispose();
    view.dispose();
  });

  it('retires through a group-only registry adapter and releases instance buffers', async () => {
    const scene = new THREE.Scene();
    const view = buildHoardValley({
      scene,
      plan: floorPlan(),
      offset: { x: 0, y: 0, z: 0 },
      effectsProfile: resolveHoardValleyEffectsProfile('low'),
    });
    await view.readyForEntry;
    const ground = view.group.getObjectByName('HoardValleyGround') as THREE.Mesh;
    expect(view.group.getObjectByName('HoardValleyGroundShadows')).toBeUndefined();
    let disposed = false;
    let instancesDisposed = false;
    let sharedDisposed = false;
    const cliffs = view.group.getObjectByName('HoardValleyBoundaryCliffs') as THREE.InstancedMesh;
    cliffs.addEventListener('dispose', () => {
      instancesDisposed = true;
    });
    cliffs.geometry.addEventListener('dispose', () => {
      sharedDisposed = true;
    });
    ground.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    expect(disposeHoardValleyGroup(view.group)).toBe(true);
    expect(disposed).toBe(true);
    expect(instancesDisposed).toBe(true);
    expect(sharedDisposed).toBe(false);
    expect(scene.children).not.toContain(view.group);
    expect(disposeHoardValleyGroup(view.group)).toBe(false);
  });

  it('cuts away the actual entry roof at an offset and restores it below the ceiling', async () => {
    const view = buildHoardValley({
      scene: new THREE.Scene(),
      plan: floorPlan(),
      offset: { x: 10000, y: -3, z: 400 },
      effectsProfile: resolveHoardValleyEffectsProfile('low'),
    });
    await view.readyForEntry;
    const roof = view.group.getObjectByName('HoardCavernEntryRoof');
    const grade = { fog: [1, 1, 1] as const, nightAmt: 0 };
    const target = new THREE.Vector3(10000, -1, 390);
    updateHoardValleyDayNight(grade, new THREE.Vector3(10000, 25, 390), target);
    expect(roof?.visible).toBe(false);
    updateHoardValleyDayNight(grade, new THREE.Vector3(10000, 4, 382), target);
    expect(roof?.visible).toBe(true);
    view.dispose();
    updateHoardValleyDayNight(grade, new THREE.Vector3(10000, 25, 390), target);
    expect(roof?.visible).toBe(true);
  });
});
