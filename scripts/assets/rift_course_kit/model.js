// The rift course kit: procedural factories for the parkour props that were
// shipping as raw cones and cylinders. Three assets, one contract table, the
// eastbrook_town archetype: named semantic systems merged into two material
// buckets per asset, vertex colours only, floor-seated at Y=0, centred on
// X/Z, +Z front, stable mesh names, sculptRuntime metadata.
//
// Provenance: procedural originals (no external reference image), like the
// water elemental and chicken-cow rigs; the identity cues live in this file.
// Budgets (locked before building, per the image-to-glb procedure):
//   rift_launch_pad   target 1400 tri, ceiling 1800, 30 KB, 2 materials
//   rift_gem_crystal  target  320 tri, ceiling  500, 12 KB, 2 materials
//   rift_waybrazier   target 1100 tri, ceiling 1500, 26 KB, 2 materials

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  addBox,
  addCylinder,
  addOctahedron,
  addSphere,
  addTorus,
} from '../eastbrook_town/shared.js';

const IRON = 0x2e2a26;
const IRON_LIT = 0x4a423a;
const EMBER = 0xd96a24;
const EMBER_HOT = 0xffa03e;
const CRYSTAL = 0x3fc4b4;
const CRYSTAL_DEEP = 0x1e7a72;

export const RIFT_COURSE_KIT = Object.freeze({
  rift_launch_pad: Object.freeze({
    id: 'rift-course-launch-pad',
    rootName: 'RiftCourseLaunchPad',
    outputName: 'rift_launch_pad.glb',
    dimensions: Object.freeze({ width: 2.4, height: 0.55, depth: 2.4 }),
    triangleTarget: 1400,
    triangleCeiling: 1800,
    byteCeiling: 30 * 1024,
    serviceCues: Object.freeze(['vent-grate', 'ember-throat', 'rivet-ring', 'blast-lip']),
  }),
  rift_gem_crystal: Object.freeze({
    id: 'rift-course-gem-crystal',
    rootName: 'RiftCourseGemCrystal',
    outputName: 'rift_gem_crystal.glb',
    dimensions: Object.freeze({ width: 0.6, height: 0.95, depth: 0.6 }),
    triangleTarget: 320,
    triangleCeiling: 500,
    byteCeiling: 12 * 1024,
    serviceCues: Object.freeze(['tall-core', 'satellite-shards', 'bright-heart']),
  }),
  rift_waybrazier: Object.freeze({
    id: 'rift-course-waybrazier',
    rootName: 'RiftCourseWaybrazier',
    outputName: 'rift_waybrazier.glb',
    dimensions: Object.freeze({ width: 1.15, height: 1.7, depth: 1.15 }),
    triangleTarget: 1100,
    triangleCeiling: 1500,
    byteCeiling: 26 * 1024,
    serviceCues: Object.freeze(['tripod-legs', 'coal-bowl', 'rim-ring', 'ember-mound']),
  }),
});

export const RIFT_COURSE_KIT_IDS = Object.freeze(Object.keys(RIFT_COURSE_KIT));

// Bucket keys reuse two TOWN keys ('metal', 'warm') purely to satisfy the
// shared helpers' key check; the MATERIALS below are this kit's own.
const MATERIALS = Object.freeze({
  metal: Object.freeze({ name: 'RiftCourseIron', metalness: 0.35, roughness: 0.62 }),
  warm: Object.freeze({ name: 'RiftCourseGlow', metalness: 0.1, roughness: 0.35 }),
});

function buildLaunchPad(buckets) {
  // The blast lip: an octagonal iron ring with a recessed ember throat, so
  // the eruption reads as coming from MACHINERY, not a drawn cone.
  addCylinder(buckets, 'metal', 1.2, 1.28, 0.16, 8, [0, 0.08, 0], IRON);
  addCylinder(buckets, 'metal', 1.02, 1.14, 0.2, 8, [0, 0.24, 0], IRON_LIT);
  // The throat: a shallow ember bowl under the grate.
  addCylinder(buckets, 'warm', 0.78, 0.9, 0.1, 8, [0, 0.3, 0], EMBER);
  addSphere(buckets, 'warm', 0.55, [0, 0.22, 0], EMBER_HOT, [1, 0.28, 1]);
  // The vent grate: five iron slats the flame licks through.
  for (let i = -2; i <= 2; i++) {
    addBox(buckets, 'metal', [1.5, 0.06, 0.12], [0, 0.4, i * 0.3], IRON);
  }
  // Rivet ring and four hold-down lugs: the pad is bolted to its deck.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    addSphere(buckets, 'metal', 0.07, [Math.sin(a) * 1.16, 0.2, Math.cos(a) * 1.16], IRON_LIT);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    addBox(
      buckets,
      'metal',
      [0.3, 0.14, 0.42],
      [Math.sin(a) * 1.22, 0.07, Math.cos(a) * 1.22],
      IRON,
      [0, a, 0],
    );
  }
  // The ember ring seam between lip and throat: the standing telegraph.
  addTorus(buckets, 'warm', 0.95, 0.045, [0, 0.36, 0], EMBER_HOT, [Math.PI / 2, 0, 0]);
}

function buildGemCrystal(buckets) {
  // A tall twinned core with two satellite shards: readable at a glance from
  // a deck away, bright heart against dark facets.
  addOctahedron(buckets, 'warm', 0.3, [0, 0.5, 0], CRYSTAL, [0.72, 1.55, 0.72]);
  addOctahedron(buckets, 'metal', 0.22, [0.1, 0.42, -0.06], CRYSTAL_DEEP, [0.6, 1.2, 0.6]);
  addOctahedron(buckets, 'warm', 0.12, [-0.2, 0.22, 0.08], CRYSTAL, [0.7, 1.15, 0.7]);
  addOctahedron(buckets, 'metal', 0.09, [0.2, 0.16, 0.12], CRYSTAL_DEEP, [0.8, 1.1, 0.8]);
  // The collet: a sliver of dark iron the shards grow from.
  addCylinder(buckets, 'metal', 0.2, 0.26, 0.1, 6, [0, 0.05, 0], IRON);
}

function buildWaybrazier(buckets) {
  // Tripod legs, splayed, with feet.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    addCylinder(buckets, 'metal', 0.05, 0.06, 1.05, 6, [sx * 0.34, 0.52, sz * 0.34], IRON, [
      Math.cos(a) * 0.32,
      0,
      -Math.sin(a) * 0.32,
    ]);
    addSphere(buckets, 'metal', 0.08, [sx * 0.5, 0.05, sz * 0.5], IRON_LIT);
  }
  // The bowl: flared cup with a bright rim ring.
  addCylinder(buckets, 'metal', 0.52, 0.3, 0.36, 10, [0, 1.12, 0], IRON_LIT);
  addTorus(buckets, 'metal', 0.52, 0.05, [0, 1.3, 0], IRON, [Math.PI / 2, 0, 0]);
  addTorus(buckets, 'warm', 0.44, 0.03, [0, 1.28, 0], EMBER, [Math.PI / 2, 0, 0]);
  // The ember mound: what the runtime flame stands on when lit.
  addSphere(buckets, 'warm', 0.36, [0, 1.28, 0], EMBER_HOT, [1, 0.5, 1]);
  // Collar where the legs meet, plus a hanging striker chain hint.
  addCylinder(buckets, 'metal', 0.12, 0.16, 0.18, 6, [0, 0.95, 0], IRON);
  addTorus(buckets, 'metal', 0.07, 0.02, [0.5, 1.18, 0.28], IRON_LIT, [0, 0, Math.PI / 3]);
  addTorus(buckets, 'metal', 0.07, 0.02, [0.54, 1.06, 0.3], IRON_LIT, [Math.PI / 3, 0, 0]);
}

const BUILDERS = Object.freeze({
  rift_launch_pad: buildLaunchPad,
  rift_gem_crystal: buildGemCrystal,
  rift_waybrazier: buildWaybrazier,
});

function normalizeBuckets(buckets, dims) {
  const box = new THREE.Box3();
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const translate = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const scale = new THREE.Matrix4().makeScale(
    dims.width / size.x,
    dims.height / size.y,
    dims.depth / size.z,
  );
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.applyMatrix4(translate);
      geometry.applyMatrix4(scale);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  }
}

/** Build one kit asset as a floor-seated, centred group. */
export function createRiftCourseProp(assetKey) {
  const contract = RIFT_COURSE_KIT[assetKey];
  if (!contract) throw new Error(`unknown rift course kit asset: ${assetKey}`);
  const buckets = { metal: [], warm: [] };
  BUILDERS[assetKey](buckets);
  normalizeBuckets(buckets, contract.dimensions);

  const root = new THREE.Group();
  root.name = contract.rootName;
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: contract.id,
    stage: 'final',
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...contract.dimensions },
    serviceCues: [...contract.serviceCues],
    interaction: { mode: 'course-feature-prop', interactive: false, authority: 'course-plan' },
    collider: { shippingCollisionMesh: false },
    destruction: { breakable: false, detachableParts: [] },
  };

  for (const [key, geometries] of Object.entries(buckets)) {
    if (geometries.length === 0) continue;
    const definition = MATERIALS[key];
    const material = new THREE.MeshStandardMaterial({
      name: definition.name,
      color: 0xffffff,
      vertexColors: true,
      metalness: definition.metalness,
      roughness: definition.roughness,
    });
    // One merged mesh per material bucket: two primitives per asset, the
    // whole point of bucketed authoring.
    const merged = mergeGeometries(geometries, false);
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${contract.rootName}_${key}`;
    root.add(mesh);
  }
  return root;
}
