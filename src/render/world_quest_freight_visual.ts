import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { EASTBROOK_FREIGHT_CARAVAN_MOB_ID } from '../sim/content/world_quests';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { buildCaravanDriver } from './world_quest_caravan_driver';

const FREIGHT_ASSET_URLS = Object.freeze({
  wagon: '/models/biome/city_wagon.glb',
  horse: '/models/mounts/valorsteed.glb',
  crate: '/models/quest/supply_crate.glb',
});

const gltfByUrl = new Map<string, GLTF>();
let freightWagonTemplate: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  for (const url of Object.values(FREIGHT_ASSET_URLS)) {
    registerDeferredPreload(() =>
      loadGltf(url)
        .then((gltf) => gltfByUrl.set(url, gltf))
        .catch(() => undefined),
    );
  }
}

function normalizeLargest(root: THREE.Object3D, target: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.scale.setScalar(target / Math.max(size.x, size.y, size.z, 0.001));
  seatAndCenter(root);
}

function normalizeHeight(root: THREE.Object3D, target: number): void {
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.scale.setScalar(target / Math.max(size.y, 0.001));
  seatAndCenter(root);
}

function seatAndCenter(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.y -= box.min.y;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
}

function markTemplateShared<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    markSharedGeometry(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) markSharedMaterial(material);
  });
  return root;
}

function sourceClone(url: string): THREE.Group | null {
  const gltf = gltfByUrl.get(url);
  return gltf ? (cloneSkinned(gltf.scene) as THREE.Group) : null;
}

function prepareFreightWagon(): THREE.Group | null {
  if (freightWagonTemplate) return freightWagonTemplate;
  const wagon = sourceClone(FREIGHT_ASSET_URLS.wagon);
  const horseSource = sourceClone(FREIGHT_ASSET_URLS.horse);
  const crateSource = sourceClone(FREIGHT_ASSET_URLS.crate);
  if (!wagon || !horseSource || !crateSource) return null;

  const root = new THREE.Group();
  normalizeLargest(wagon, 4.4);
  root.add(wagon);

  normalizeHeight(horseSource, 2.15);
  for (const x of [-0.8, 0.8]) {
    const horse = cloneSkinned(horseSource);
    horse.userData.freightHorse = true;
    horse.position.set(x, 0, 3.45);
    root.add(horse);
  }

  normalizeLargest(crateSource, 0.72);
  for (const [x, y, z, rotation] of [
    [-0.42, 1.05, 0.15, 0.12],
    [0.35, 1.05, 0.05, -0.18],
    [0, 1.68, 0.08, 0.05],
  ] as const) {
    const crate = crateSource.clone(true);
    crate.userData.freightCargo = true;
    crate.position.set(x, y, z);
    crate.rotation.y = rotation;
    root.add(crate);
  }

  root.updateMatrixWorld(true);
  freightWagonTemplate = markTemplateShared(root);
  return freightWagonTemplate;
}

export function buildWorldQuestFreightWagon(): { group: THREE.Group; height: number } | null {
  const template = prepareFreightWagon();
  if (!template) return null;
  return { group: cloneSkinned(template) as THREE.Group, height: 2.3 };
}

interface FreightHorseAnimation {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  current: THREE.AnimationAction | null;
}

export interface MovingWorldQuestFreightWagonVisual {
  group: THREE.Group;
  height: number;
  update(dt: number, moving: boolean, animateDriver?: boolean): void;
  dispose(): void;
}

/** A live escort instance owns its mixers and cloned skeletons. Static freight
 * props keep using buildWorldQuestFreightWagon; moving caravans must use this
 * lifecycle so horses walk instead of sliding and bone textures are released. */
export function buildMovingWorldQuestFreightWagon(
  templateId = EASTBROOK_FREIGHT_CARAVAN_MOB_ID,
): MovingWorldQuestFreightWagonVisual | null {
  const template = prepareFreightWagon();
  const horseGltf = gltfByUrl.get(FREIGHT_ASSET_URLS.horse);
  if (!template || !horseGltf) return null;
  const group = cloneSkinned(template) as THREE.Group;
  const driver = buildCaravanDriver(templateId);
  if (driver) {
    // The wagon GLB includes long shafts ahead of its deck. Seat the driver
    // on a small supply chest on the deck, with the delivery cargo behind.
    const cargo = group.children.filter((child) => child.userData.freightCargo === true);
    const rearPositions = [
      [-0.35, 0.7, -1.25],
      [0.35, 0.7, -1.25],
      [0, 1.42, -1.25],
    ];
    cargo.forEach((crate, index) => {
      crate.position.set(...(rearPositions[index] as [number, number, number]));
    });
    const seatModel = sourceClone(FREIGHT_ASSET_URLS.crate);
    if (seatModel) {
      normalizeLargest(seatModel, 0.72);
      const seat = new THREE.Group();
      seat.add(seatModel);
      seat.name = 'caravan-driver-seat';
      seat.position.set(0, 0.45, -0.1);
      group.add(seat);
    }
    group.add(driver.root);
  }
  const idleClip = horseGltf.animations.find((clip) => /idle/i.test(clip.name)) ?? null;
  const walkClip = horseGltf.animations.find((clip) => /walk/i.test(clip.name)) ?? null;
  const horses: FreightHorseAnimation[] = [];
  group.traverse((object) => {
    if (object.userData.freightHorse !== true) return;
    const mixer = new THREE.AnimationMixer(object);
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    const current = idle ?? walk;
    current?.play();
    horses.push({ root: object, mixer, idle, walk, current });
  });
  let disposed = false;
  let driverDt = 0;
  return {
    group,
    height: driver ? 3 : 2.3,
    update(dt, moving, animateDriver = true) {
      if (disposed) return;
      // Preserve elapsed time across cadence skips; cap offscreen catch-up
      // at the same maximum mixer step used by CharacterVisual.
      driverDt = Math.min(0.3, driverDt + dt);
      if (animateDriver) {
        driver?.update(driverDt);
        driverDt = 0;
      }
      for (const horse of horses) {
        const next = (moving ? horse.walk : horse.idle) ?? horse.walk ?? horse.idle;
        if (next && next !== horse.current) {
          horse.current?.fadeOut(0.18);
          next.reset().fadeIn(0.18).play();
          horse.current = next;
        }
        horse.mixer.update(dt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Detach first: CharacterVisual owns its skeleton, unlike the horses.
      driver?.dispose();
      for (const horse of horses) {
        horse.mixer.stopAllAction();
        horse.mixer.uncacheRoot(horse.root);
      }
      const skeletons = new Set<THREE.Skeleton>();
      group.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
      });
      for (const skeleton of skeletons) skeleton.dispose();
    },
  };
}

export const worldQuestFreightVisualInternalsForTest = {
  assetUrls: FREIGHT_ASSET_URLS,
  setGltf(url: string, gltf: GLTF): void {
    gltfByUrl.set(url, gltf);
  },
  reset(): void {
    freightWagonTemplate = null;
    gltfByUrl.clear();
  },
};
