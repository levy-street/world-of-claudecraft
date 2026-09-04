import * as THREE from 'three';
import { WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { markSharedMaterial } from './shared_resource';

const FARSHORE_SHIPWRECK_ASSET_URLS = Object.freeze({
  ship: '/models/biome/sea_boat_sail_b.glb',
  dock: '/models/biome/beach_dock_broken.glb',
});

export const FARSHORE_SHIPWRECK_PLAN = Object.freeze({
  ship: Object.freeze({
    x: 269.8,
    y: WATER_LEVEL - 0.9,
    z: 105.8,
    scale: 3.5,
    pitch: 0.05,
    yaw: -1,
    roll: -0.2,
  }),
  dock: Object.freeze({
    x: 276.8,
    y: WATER_LEVEL + 0.12,
    z: 101.8,
    scale: 2.8,
    yaw: 0.12,
  }),
  removedHullFraction: 0.36,
});

interface ScenePart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

let shipScene: THREE.Group | null = null;
let dockScene: THREE.Group | null = null;

registerDeferredPreload(async () => {
  const [ship, dock] = await Promise.all([
    loadGltf(FARSHORE_SHIPWRECK_ASSET_URLS.ship),
    loadGltf(FARSHORE_SHIPWRECK_ASSET_URLS.dock),
  ]);
  shipScene = ship.scene;
  dockScene = dock.scene;
});

function sceneParts(source: THREE.Object3D): ScenePart[] {
  source.updateMatrixWorld(true);
  const parts: ScenePart[] = [];
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    markSharedMaterial(material);
    parts.push({ name: mesh.name, geometry, material });
  });
  return parts;
}

function boundsFor(parts: readonly ScenePart[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
  }
  return bounds;
}

function attributeComponent(
  attribute: THREE.BufferAttribute,
  index: number,
  component: number,
): number {
  switch (component) {
    case 0:
      return attribute.getX(index);
    case 1:
      return attribute.getY(index);
    case 2:
      return attribute.getZ(index);
    default:
      return attribute.getW(index);
  }
}

function clipGeometryPastBrokenBow(
  source: THREE.BufferGeometry,
  cutZ: number,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position) return geometry;

  const keptVertices: number[] = [];
  for (let first = 0; first + 2 < position.count; first += 3) {
    const centerX =
      (position.getX(first) + position.getX(first + 1) + position.getX(first + 2)) / 3;
    const centerY =
      (position.getY(first) + position.getY(first + 1) + position.getY(first + 2)) / 3;
    const centerZ =
      (position.getZ(first) + position.getZ(first + 1) + position.getZ(first + 2)) / 3;
    const jaggedCut = cutZ + Math.sin(centerX * 8.1 + centerY * 5.3) * 0.16;
    if (centerZ < jaggedCut) continue;
    keptVertices.push(first, first + 1, first + 2);
  }

  const clipped = new THREE.BufferGeometry();
  for (const [name, sourceAttribute] of Object.entries(geometry.attributes)) {
    const attribute = sourceAttribute as THREE.BufferAttribute;
    const values: number[] = [];
    for (const vertex of keptVertices) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values.push(attributeComponent(attribute, vertex, component));
      }
    }
    clipped.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
  }
  clipped.computeBoundingBox();
  clipped.computeBoundingSphere();
  return clipped;
}

function meshFromPart(part: ScenePart, geometry: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, part.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addRopeSegment(
  root: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  material: THREE.Material,
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 5), material);
  rope.position.copy(start).add(end).multiplyScalar(0.5);
  rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  rope.castShadow = true;
  rope.receiveShadow = true;
  root.add(rope);
}

function addMooringLines(root: THREE.Group): void {
  const lines = new THREE.Group();
  lines.name = 'farshore-mooring-lines';
  const rope = surfaceMat({ color: 0x2b1c12, roughness: 1, flatShading: true });
  for (const [start, dip, end] of [
    [
      new THREE.Vector3(274.7, -1.45, 100.6),
      new THREE.Vector3(273.7, -1.88, 102.1),
      new THREE.Vector3(272.7, -1.25, 103.7),
    ],
    [
      new THREE.Vector3(274.8, -1.52, 103.1),
      new THREE.Vector3(274, -1.94, 104.5),
      new THREE.Vector3(273.1, -1.3, 105.9),
    ],
  ] as const) {
    addRopeSegment(lines, start, dip, rope);
    addRopeSegment(lines, dip, end, rope);
  }
  root.add(lines);
}

function addBrokenHullDetails(ship: THREE.Group, cutZ: number): void {
  const timber = surfaceMat({ color: 0x4c2c19, roughness: 0.96, flatShading: true });
  const paleTimber = surfaceMat({ color: 0x8a5a31, roughness: 0.94, flatShading: true });

  const ribGeometry = new THREE.CylinderGeometry(0.04, 0.07, 1.05, 5);
  const ribs = new THREE.InstancedMesh(ribGeometry, timber, 6);
  ribs.name = 'farshore-exposed-ribs';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 6; i++) {
    const x = -0.72 + i * 0.29;
    position.set(x, 0.48 + (i % 2) * 0.06, cutZ + Math.sin(i * 1.7) * 0.035);
    quaternion.setFromEuler(new THREE.Euler(0.08 * (i - 2), 0, -0.1 + i * 0.035));
    ribs.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  }
  ribs.instanceMatrix.needsUpdate = true;
  ribs.castShadow = true;
  ribs.receiveShadow = true;
  ribs.computeBoundingSphere();
  ship.add(ribs);

  const splinterGeometry = new THREE.BoxGeometry(0.12, 0.055, 0.74);
  const splinters = new THREE.InstancedMesh(splinterGeometry, paleTimber, 5);
  splinters.name = 'farshore-broken-plank-ends';
  for (let i = 0; i < 5; i++) {
    position.set(-0.58 + i * 0.29, 0.34 + i * 0.12, cutZ - 0.23 - (i % 2) * 0.08);
    quaternion.setFromEuler(new THREE.Euler(0, -0.18 + i * 0.08, -0.11 + i * 0.045));
    scale.set(0.78 + (i % 3) * 0.11, 1, 1);
    splinters.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  }
  splinters.instanceMatrix.needsUpdate = true;
  splinters.castShadow = true;
  splinters.receiveShadow = true;
  splinters.computeBoundingSphere();
  ship.add(splinters);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 2.75, 6), timber);
  mast.name = 'farshore-fallen-mast';
  mast.position.set(0.18, 0.68, 0.3);
  mast.rotation.set(0.12, 0.18, 1.16);
  mast.castShadow = true;
  mast.receiveShadow = true;
  ship.add(mast);
}

function buildFromScenes(shipSource: THREE.Object3D, dockSource: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.name = 'farshore-shipwreck';

  const sourceShipParts = sceneParts(shipSource);
  const shipBounds = boundsFor(sourceShipParts);
  const shipCenter = shipBounds.getCenter(new THREE.Vector3());
  const shipSize = shipBounds.getSize(new THREE.Vector3());
  const cutZ = shipBounds.min.z + shipSize.z * FARSHORE_SHIPWRECK_PLAN.removedHullFraction;
  const cutLocalZ = cutZ - shipCenter.z;

  const ship = new THREE.Group();
  ship.name = 'farshore-broken-ship';
  for (const part of sourceShipParts) {
    if (part.name.toLowerCase().startsWith('sail')) continue;
    const geometry = clipGeometryPastBrokenBow(part.geometry, cutZ);
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count === 0) continue;
    geometry.translate(-shipCenter.x, -shipBounds.min.y, -shipCenter.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    ship.add(meshFromPart(part, geometry));
  }
  addBrokenHullDetails(ship, cutLocalZ);
  ship.position.set(
    FARSHORE_SHIPWRECK_PLAN.ship.x,
    FARSHORE_SHIPWRECK_PLAN.ship.y,
    FARSHORE_SHIPWRECK_PLAN.ship.z,
  );
  ship.rotation.set(
    FARSHORE_SHIPWRECK_PLAN.ship.pitch,
    FARSHORE_SHIPWRECK_PLAN.ship.yaw,
    FARSHORE_SHIPWRECK_PLAN.ship.roll,
  );
  ship.scale.setScalar(FARSHORE_SHIPWRECK_PLAN.ship.scale);
  root.add(ship);

  const sourceDockParts = sceneParts(dockSource);
  const dockBounds = boundsFor(sourceDockParts);
  const dockCenter = dockBounds.getCenter(new THREE.Vector3());
  const dock = new THREE.Group();
  dock.name = 'farshore-broken-dock';
  for (const part of sourceDockParts) {
    part.geometry.translate(-dockCenter.x, 0, -dockCenter.z);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
    dock.add(meshFromPart(part, part.geometry));
  }
  dock.position.set(
    FARSHORE_SHIPWRECK_PLAN.dock.x,
    FARSHORE_SHIPWRECK_PLAN.dock.y,
    FARSHORE_SHIPWRECK_PLAN.dock.z,
  );
  dock.rotation.y = FARSHORE_SHIPWRECK_PLAN.dock.yaw;
  dock.scale.setScalar(FARSHORE_SHIPWRECK_PLAN.dock.scale);
  root.add(dock);
  addMooringLines(root);

  return root;
}

export function buildFarshoreShipwreck(): THREE.Group | null {
  if (!shipScene || !dockScene) return null;
  return buildFromScenes(shipScene, dockScene);
}

export const farshoreShipwreckInternalsForTest = {
  assetUrls: FARSHORE_SHIPWRECK_ASSET_URLS,
  clipGeometryPastBrokenBow,
  buildFromScenes,
};
