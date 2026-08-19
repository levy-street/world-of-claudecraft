// The Weirdo Cream truck: a rideable ice cream van, authored procedurally.
//
// Built the way the Terrorspark Groundshaker is (the other vehicle mount), and
// deliberately sharing its surface-shading core so both vehicles carry the same
// baked cavity, contact, grime, and bevel-wear bands rather than two drifting
// copies of that look. What is new here is the signage layer: three flat decal
// quads sample the hand-rastered atlas in decal_atlas.mjs, which is what puts
// "Weirdo Cream" on both flanks, the driver's portrait on the rear shutter, and
// the cone badge on the nose.
//
// THE CAB IS OPEN BY DESIGN. The rider is a full standing humanoid lifted onto
// the seat by MOUNT_VISUAL_SPECS (src/render/mount_visuals.ts); no mount in this
// game poses a rider, so a roofed cab would put the driver's head through the
// roof. Instead the cab is a roofless tub whose door panels stop at waist height
// and whose windscreen stops below the shoulders, so the driver reads as sitting
// at the wheel and no part of the body intersects the shell. The clearance
// numbers are pinned by tests/weirdo_cream_truck_asset.test.ts, so a later tweak
// to the cab cannot silently reintroduce clipping.
//
// Conventions the pipeline requires: floor-seated at Y = 0, centered on X/Z,
// +Z front, stable mesh names, Socket_* empties, no Math.random anywhere.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  boxProjectUvInto,
  buildOccluderIndex,
  SURFACE_TUNING,
  shadeSurfaceInto,
  UV_SCALE,
} from '../terrorspark_groundshaker/surface_shading.mjs';
import { DECAL_REGIONS } from './decal_regions.mjs';

export const TRUCK_STAGES = Object.freeze([
  'blockout',
  'structural',
  'form',
  'material',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'final',
]);

// Measured off the assembled model (mirrors included in the width, the roof
// cone's cherry in the height). Kept here so the manifest can declare the same
// number and render the truck at scale 1.
export const TRUCK_NATIVE_BOUNDS = Object.freeze({
  width: 2.79,
  height: 3.65,
  depth: 4.86,
});

/** Where the driver ends up in the finished model's own space, after the
 *  centering pass. src/render/mount_visuals.ts copies these into the mount's
 *  seat/seatFwd, and tests/weirdo_cream_truck_asset.test.ts pins that they
 *  still agree. */
export const TRUCK_RIDER_SEAT = Object.freeze({ y: 0.863, z: 1.28 });

export const TRUCK_CLIP_NAMES = Object.freeze(['Idle', 'Walk', 'Run', 'Death']);

// --- the cab contract -------------------------------------------------------
// One source of truth for the numbers that keep the driver visible and
// unclipped. The model builds the cab from these and the asset test re-asserts
// them against the shipped GLB's bounds.
export const TRUCK_CAB = Object.freeze({
  /** Cab tub floor height. The rider's feet stand here. */
  floorY: 0.82,
  /** Cab tub extent along Z (front of the freezer box to the back of the nose). */
  backZ: 0.55,
  frontZ: 2.15,
  /** Door panels stop at the driver's waist, so the torso is never enclosed. */
  doorTopY: 1.42,
  /** Inner face of each door panel; the driver's shoulders clear this. */
  innerHalfWidth: 1.15,
  /** Windscreen glass, which tops out below the driver's shoulder line. */
  screenZ: 1.98,
  screenTopY: 2.05,
  /** Where the driver is planted, and the body radius assumed around them. */
  riderZ: 1.32,
  riderClearRadius: 0.4,
});

export const TRUCK_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'rider',
    nodeName: 'Socket_Rider',
    position: Object.freeze([0, TRUCK_CAB.floorY + 0.04, TRUCK_CAB.riderZ]),
    purpose: 'mounted player seat',
  }),
  Object.freeze({
    id: 'exhaust',
    nodeName: 'Socket_Exhaust',
    position: Object.freeze([-0.86, 0.52, -2.18]),
    purpose: 'engine exhaust effect anchor',
  }),
  Object.freeze({
    id: 'chime',
    nodeName: 'Socket_Chime',
    position: Object.freeze([0, 2.52, -0.15]),
    purpose: 'roof chime speaker, the jingle emitter',
  }),
]);

// `roughness`/`metalness` are the AUTHORED TARGETS; the exporter divides them by
// the ORM map's midtone when it attaches the maps so factor times sampled
// channel lands back here. `surface` picks the map family: `metal` and `fabric`
// are the shared procedural sets, `decal` is this asset's own signage atlas
// (baseColor only, sampled through the quads' own UVs).
export const TRUCK_MATERIAL_CONTRACT = Object.freeze([
  Object.freeze({
    name: 'TruckCreamPanel',
    color: 0xf2e9d5,
    roughness: 0.55,
    metalness: 0.22,
    surface: 'metal',
    uvScale: UV_SCALE.creamPaint,
  }),
  Object.freeze({
    name: 'TruckMintShell',
    color: 0x7fc4bd,
    roughness: 0.52,
    metalness: 0.28,
    surface: 'metal',
    uvScale: UV_SCALE.violetPaint,
  }),
  Object.freeze({
    name: 'TruckDarkTrim',
    color: 0x3a3138,
    roughness: 0.72,
    metalness: 0.42,
    surface: 'metal',
    uvScale: UV_SCALE.darkIron,
  }),
  Object.freeze({
    name: 'TruckChrome',
    color: 0xd8d3c6,
    roughness: 0.26,
    metalness: 0.86,
    surface: 'metal',
    uvScale: UV_SCALE.bronze,
  }),
  Object.freeze({
    name: 'TruckAwning',
    color: 0xe8899d,
    roughness: 0.88,
    metalness: 0,
    surface: 'fabric',
    uvScale: UV_SCALE.textile,
  }),
  Object.freeze({
    name: 'TruckDecal',
    color: 0xffffff,
    roughness: 0.44,
    metalness: 0.08,
    surface: 'decal',
    uvScale: 1,
  }),
]);

const MATERIAL_BY_NAME = new Map(
  TRUCK_MATERIAL_CONTRACT.map((contract) => [contract.name, contract]),
);

const PALETTE = Object.freeze({
  cream: 0xe6dcc6,
  creamLight: 0xf2e9d5,
  creamShade: 0xc2b79c,
  mint: 0x6bb0a9,
  mintLight: 0x7fc4bd,
  mintShade: 0x47837e,
  iron: 0x2c252c,
  ironLight: 0x3a3138,
  ironDeep: 0x1b171c,
  chrome: 0xb8b3a6,
  chromeLight: 0xd8d3c6,
  chromeShade: 0x807c72,
  // Windscreen glass: a cool tint over the chrome base (see addCab).
  glass: 0x8f9aa5,
  awning: 0xd06b83,
  awningLight: 0xe8899d,
  awningShade: 0x8f4356,
  white: 0xffffff,
  blockoutPrimary: 0x8d9099,
  blockoutSecondary: 0x5c5f68,
});

// Each authored shade maps to the lightest member of its family, which is the
// material's own base colour. `zoneTint` divides by that base so one material
// paints several shades through COLOR_0 alone.
const VERTEX_COLOR_BASES = new Map([
  [PALETTE.cream, PALETTE.creamLight],
  [PALETTE.creamLight, PALETTE.creamLight],
  [PALETTE.creamShade, PALETTE.creamLight],
  [PALETTE.mint, PALETTE.mintLight],
  [PALETTE.mintLight, PALETTE.mintLight],
  [PALETTE.mintShade, PALETTE.mintLight],
  [PALETTE.iron, PALETTE.ironLight],
  [PALETTE.ironLight, PALETTE.ironLight],
  [PALETTE.ironDeep, PALETTE.ironLight],
  [PALETTE.chrome, PALETTE.chromeLight],
  [PALETTE.chromeLight, PALETTE.chromeLight],
  [PALETTE.chromeShade, PALETTE.chromeLight],
  [PALETTE.glass, PALETTE.chromeLight],
  [PALETTE.awning, PALETTE.awningLight],
  [PALETTE.awningLight, PALETTE.awningLight],
  [PALETTE.awningShade, PALETTE.awningLight],
  [PALETTE.white, PALETTE.white],
  [PALETTE.blockoutPrimary, PALETTE.blockoutPrimary],
  [PALETTE.blockoutSecondary, PALETTE.blockoutPrimary],
]);

function stageIndex(stage) {
  const index = TRUCK_STAGES.indexOf(stage);
  if (index < 0) throw new Error(`unknown truck stage: ${stage}`);
  return index;
}

function atLeast(stage, threshold) {
  return stageIndex(stage) >= stageIndex(threshold);
}

function stageColor(stage, finished, blockout = PALETTE.blockoutPrimary) {
  return atLeast(stage, 'material') ? finished : blockout;
}

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function createSurface(stage) {
  return { stage, parts: [] };
}

function surfaceBucket(surface, materialName) {
  const bucket = [];
  bucket.surface = surface;
  bucket.materialName = materialName;
  return bucket;
}

function zoneTint(color) {
  const tint = new THREE.Color(color);
  const base = new THREE.Color(VERTEX_COLOR_BASES.get(color) ?? 0xffffff);
  return [
    THREE.MathUtils.clamp(tint.r / base.r, 0, 1),
    THREE.MathUtils.clamp(tint.g / base.g, 0, 1),
    THREE.MathUtils.clamp(tint.b / base.b, 0, 1),
  ];
}

function prepareGeometry(source, matrix = null) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (matrix) geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

/** Record a part. UV and COLOR_0 are written later, by the baked surface pass,
 *  which needs every part placed first so it can occlude each against its
 *  neighbours. `keepUv` marks the decal quads, whose atlas UVs are authored and
 *  must survive the world-space projection. */
function addGeometry(bucket, geometry, color, options = {}) {
  const part = {
    geometry: prepareGeometry(
      geometry,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
    materialName: bucket.materialName,
    tint: zoneTint(color),
    offset: options.offset ?? [0, 0, 0],
    variation: SURFACE_TUNING.mottleBase + (options.variation ?? 0),
    keepUv: options.keepUv ?? false,
    weights: options.weights ?? null,
  };
  bucket.push(part);
  bucket.surface.parts.push(part);
  return part;
}

function addBox(bucket, size, position, color, options = {}) {
  const radius = Math.min(options.radius ?? 0.03, Math.min(...size) * 0.45);
  const geometry =
    radius > 0
      ? new RoundedBoxGeometry(size[0], size[1], size[2], options.segments ?? 1, radius)
      : new THREE.BoxGeometry(...size);
  addGeometry(bucket, geometry, color, {
    position,
    rotation: options.rotation,
    variation: options.variation,
    offset: options.offset,
  });
}

function addCylinder(bucket, radius, length, position, color, options = {}) {
  const geometry = new THREE.CylinderGeometry(
    radius,
    options.radiusTop ?? radius,
    length,
    options.radialSegments ?? 14,
    1,
    options.openEnded ?? false,
  );
  addGeometry(bucket, geometry, color, {
    position,
    rotation: options.rotation ?? [0, 0, Math.PI / 2],
    variation: options.variation,
    offset: options.offset,
  });
}

function addSphere(bucket, radius, position, color, options = {}) {
  addGeometry(bucket, new THREE.IcosahedronGeometry(radius, options.detail ?? 2), color, {
    position,
    scale: options.scale,
    variation: options.variation,
    offset: options.offset,
  });
}

function addCone(bucket, radius, height, position, color, options = {}) {
  addGeometry(bucket, new THREE.ConeGeometry(radius, height, options.radialSegments ?? 18), color, {
    position,
    rotation: options.rotation,
    variation: options.variation,
  });
}

/**
 * A flat signage quad sampling one atlas region.
 *
 * `axis` is the face it lies on and `sign` which way it faces. The UVs are
 * written here (not by the projection pass) because they address the atlas, and
 * the surface bake is dialled almost flat for these parts so the painted art
 * stays legible instead of picking up the body's grime bands.
 */
function addDecal(bucket, region, { axis, sign, center, width, height, flip = false }) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const rotation =
    axis === 'x' ? [0, (sign * Math.PI) / 2, 0] : sign > 0 ? [0, 0, 0] : [0, Math.PI, 0];
  const part = addGeometry(bucket, geometry, PALETTE.white, {
    position: center,
    rotation,
    keepUv: true,
    // Decals keep a whisper of the baked pass (contact and occlusion only) so
    // they sit in the same light as the panel, without grime over the letters.
    weights: { midtone: 1, grime: 0, dust: 0, wear: 0, seam: 0, occlusion: 0.35, contact: 0.4 },
  });
  const count = part.geometry.getAttribute('position').count;
  const uv = new Float32Array(count * 2);
  // PlaneGeometry's vertex order after toNonIndexed is two triangles over the
  // corners (-x,+y) (+x,+y) (-x,-y) (+x,-y); rebuild the atlas UVs from each
  // vertex's own position so the mapping cannot drift with three's winding.
  const positions = part.geometry.getAttribute('position').array;
  const uAxis = axis === 'x' ? 2 : 0;
  const uDirection = (axis === 'x' ? -sign : sign) * (flip ? -1 : 1);
  for (let index = 0; index < count; index++) {
    // Corners land exactly on the region edge, so the divide can land a few
    // float ulps outside [0, 1]. Clamping keeps the exporter's non-negative
    // texcoord assertion happy without moving any texel.
    const localU = THREE.MathUtils.clamp(
      ((positions[index * 3 + uAxis] - center[uAxis]) / width) * uDirection + 0.5,
      0,
      1,
    );
    const localV = THREE.MathUtils.clamp(
      0.5 - (positions[index * 3 + 1] - center[1]) / height,
      0,
      1,
    );
    uv[index * 2] = region.u0 + localU * (region.u1 - region.u0);
    uv[index * 2 + 1] = region.v0 + localV * (region.v1 - region.v0);
  }
  part.atlasUv = uv;
  return part;
}

function mergeBucket(bucket, label) {
  if (bucket.length === 0) return null;
  const merged = mergeGeometries(
    bucket.map((part) => part.geometry),
    false,
  );
  if (!merged) throw new Error(`could not merge truck ${label} geometry`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Which surface bands each authoring stage has brought in. */
function surfaceWeights(stage) {
  const surfaced = atLeast(stage, 'surface');
  const lit = atLeast(stage, 'lighting');
  return {
    midtone: atLeast(stage, 'material') ? SURFACE_TUNING.midtone : 1,
    grime: surfaced ? 1 : 0,
    wear: surfaced ? 1 : 0,
    seam: surfaced ? 1 : 0,
    occlusion: lit ? 1 : 0,
    contact: lit ? 1 : 0,
    dust: lit ? 1 : 0,
  };
}

function partBounds(part, ownerId) {
  part.geometry.computeBoundingBox();
  const box = part.geometry.boundingBox;
  const [ox, oy, oz] = part.offset;
  return {
    min: [box.min.x + ox, box.min.y + oy, box.min.z + oz],
    max: [box.max.x + ox, box.max.y + oy, box.max.z + oz],
    ownerId,
  };
}

function bakeSurface(surface) {
  const stageWeights = surfaceWeights(surface.stage);
  const occluders = buildOccluderIndex(
    surface.parts.map((part, ownerId) => partBounds(part, ownerId)),
  );
  for (let ownerId = 0; ownerId < surface.parts.length; ownerId++) {
    const part = surface.parts[ownerId];
    const positions = part.geometry.getAttribute('position');
    const normals = part.geometry.getAttribute('normal');
    const contract = MATERIAL_BY_NAME.get(part.materialName);
    if (!contract) throw new Error(`truck part has no material: ${part.materialName}`);

    if (part.keepUv) {
      part.geometry.setAttribute('uv', new THREE.BufferAttribute(part.atlasUv, 2));
    } else {
      const uv = new Float32Array(positions.count * 2);
      boxProjectUvInto(positions.array, normals.array, uv, contract.uvScale, part.offset);
      part.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }

    const colors = new Float32Array(positions.count * 3);
    shadeSurfaceInto(positions.array, normals.array, colors, {
      tint: part.tint,
      offset: part.offset,
      occluders,
      ownerId,
      variation: part.variation,
      seed: 3_119 + ownerId * 41,
      weights: part.weights ? { ...stageWeights, ...part.weights } : stageWeights,
    });
    part.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

function createMaterial(contract, stage, blockoutColor) {
  const material = new THREE.MeshStandardMaterial({
    name: contract.name,
    color: atLeast(stage, 'material') ? contract.color : blockoutColor,
    roughness: atLeast(stage, 'material') ? contract.roughness : 0.8,
    metalness: atLeast(stage, 'material') ? contract.metalness : 0,
    vertexColors: true,
    flatShading: false,
  });
  material.userData.semanticColor = blockoutColor;
  return material;
}

// ---------------------------------------------------------------------------
// Running gear: four wheels on their own nodes so the clips can spin them.
// ---------------------------------------------------------------------------

const WHEEL_RADIUS = 0.5;
const WHEEL_WIDTH = 0.32;
const WHEEL_X = 1.02;
const WHEEL_Z = Object.freeze([1.55, -1.35]);

function addWheel(surface, stage, node, sideX) {
  const tyre = surfaceBucket(surface, 'TruckDarkTrim');
  const hub = surfaceBucket(surface, 'TruckChrome');
  const inward = -Math.sign(sideX);

  addCylinder(tyre, WHEEL_RADIUS, WHEEL_WIDTH, [0, 0, 0], stageColor(stage, PALETTE.iron), {
    radialSegments: 20,
  });
  // Tread blocks: a ring of short bars, the silhouette detail that keeps the
  // wheel from reading as a smooth disc at a grazing angle. Ten is where the
  // ring still reads as tread from the saddle; more only costs triangles on a
  // part that spins.
  for (let index = 0; index < 10; index++) {
    const angle = (index / 10) * Math.PI * 2;
    addBox(
      tyre,
      [WHEEL_WIDTH + 0.015, 0.09, 0.22],
      [0, Math.sin(angle) * (WHEEL_RADIUS - 0.045), Math.cos(angle) * (WHEEL_RADIUS - 0.045)],
      stageColor(stage, PALETTE.ironDeep, PALETTE.blockoutSecondary),
      // Rotation about X maps local +Y to (0, cos, sin), and the block's
      // thickness (+Y) has to point radially outward at (0, sin a, cos a):
      // hence PI/2 - a, not a. Feeding the angle straight in splays the tread
      // into spikes.
      { radius: 0.02, rotation: [Math.PI / 2 - angle, 0, 0], variation: 0.01 },
    );
  }
  addCylinder(
    hub,
    WHEEL_RADIUS * 0.46,
    WHEEL_WIDTH + 0.05,
    [0, 0, 0],
    stageColor(stage, PALETTE.chromeLight),
    { radialSegments: 16 },
  );
  addCylinder(
    hub,
    WHEEL_RADIUS * 0.16,
    WHEEL_WIDTH + 0.11,
    [0, 0, 0],
    stageColor(stage, PALETTE.chrome),
    { radialSegments: 12 },
  );
  // Polished hubcap dome, then five lug spokes radiating across it. The spokes
  // take the BRIGHT chrome shade: on the dark one they merged into a black star
  // that read as a hole rather than as brightwork.
  addSphere(
    hub,
    0.17,
    [inward * -(WHEEL_WIDTH / 2 + 0.02), 0, 0],
    stageColor(stage, PALETTE.chromeLight),
    { detail: 1, scale: [0.55, 1, 1] },
  );
  for (let index = 0; index < 5; index++) {
    const angle = (index / 5) * Math.PI * 2;
    addBox(
      hub,
      [0.05, 0.05, 0.24],
      [inward * -(WHEEL_WIDTH / 2 + 0.03), Math.sin(angle) * 0.22, Math.cos(angle) * 0.22],
      stageColor(stage, PALETTE.chromeLight, PALETTE.blockoutSecondary),
      // Same correction on the other axis: rotation about X maps local +Z to
      // (0, -sin, cos), so the radial direction is -a.
      { radius: 0.02, rotation: [-angle, 0, 0], variation: 0.008 },
    );
  }
  return { tyre, hub };
}

function addRunningGear(root, surface, stage, wheelNodes, wheelPlans) {
  for (const z of WHEEL_Z) {
    for (const sideX of [-WHEEL_X, WHEEL_X]) {
      const node = new THREE.Group();
      node.name = `Wheel_${z > 0 ? 'F' : 'R'}${sideX > 0 ? 'R' : 'L'}`;
      node.position.set(sideX, WHEEL_RADIUS, z);
      root.add(node);
      wheelNodes.push(node);
      const buckets = addWheel(surface, stage, node, sideX);
      wheelPlans.push({ node, buckets });
    }
  }
}

// ---------------------------------------------------------------------------
// The body: chassis, freezer box, open cab, nose, roof cone, signage.
// ---------------------------------------------------------------------------

const BOX_BACK_Z = -2.25;
const BOX_FRONT_Z = TRUCK_CAB.backZ;
const BOX_TOP_Y = 2.45;
const BODY_HALF_WIDTH = 1.2;
/** The side banner's footprint. Everything bolted to a flank is placed relative
 *  to these so nothing can drift across the lettering again. 2.2 by 1.1 matches
 *  the atlas banner region's 2:1 aspect exactly, so the sign never stretches. */
const BANNER_WIDTH = 2.2;
const BANNER_HEIGHT = 1.1;
const BANNER_CENTER_Y = 1.62;
const BANNER_TOP_Y = BANNER_CENTER_Y + BANNER_HEIGHT / 2;
/** The stowed awning roll, tucked between the banner top and the roof cap. */
const AWNING_ROLL_Y = 2.29;

function addChassis(buckets, stage) {
  const dark = stageColor(stage, PALETTE.iron, PALETTE.blockoutSecondary);
  // Ladder frame plus the sills the body sits on.
  addBox(buckets.dark, [2.06, 0.2, 4.14], [0, 0.66, 0.05], dark, { radius: 0.05 });
  for (const sideX of [-0.78, 0.78]) {
    addBox(buckets.dark, [0.16, 0.3, 3.9], [sideX, 0.5, 0.05], dark, { radius: 0.04 });
  }
  // Axles between the wheel pairs.
  for (const z of WHEEL_Z) {
    addCylinder(buckets.dark, 0.1, 2.0, [0, WHEEL_RADIUS, z], dark, { radialSegments: 10 });
  }
  // Mud flaps behind the rear wheels and the fender arches over all four.
  for (const z of WHEEL_Z) {
    for (const sideX of [-1, 1]) {
      addBox(
        buckets.mint,
        [0.12, 0.42, 1.26],
        [sideX * (BODY_HALF_WIDTH - 0.02), 0.78, z],
        stageColor(stage, PALETTE.mintShade),
        { radius: 0.05, variation: 0.012 },
      );
    }
  }
  addBox(buckets.dark, [1.9, 0.34, 0.16], [0, 0.5, BOX_BACK_Z - 0.06], dark, { radius: 0.04 });
}

function addFreezerBox(buckets, stage) {
  const depth = BOX_FRONT_Z - BOX_BACK_Z;
  const centerZ = (BOX_FRONT_Z + BOX_BACK_Z) / 2;
  const lowerTop = 1.15;

  // Mint lower body, cream upper: the two-tone split the signage sits above.
  addBox(
    buckets.mint,
    [2.4, lowerTop - 0.78, depth],
    [0, (0.78 + lowerTop) / 2, centerZ],
    stageColor(stage, PALETTE.mintLight),
    { radius: 0.08, variation: 0.01 },
  );
  addBox(
    buckets.cream,
    [2.4, BOX_TOP_Y - lowerTop, depth],
    [0, (lowerTop + BOX_TOP_Y) / 2, centerZ],
    stageColor(stage, PALETTE.creamLight),
    { radius: 0.1, variation: 0.012 },
  );
  // Waistline moulding where the two colours meet, and the roof cap.
  addBox(
    buckets.chrome,
    [2.44, 0.07, depth + 0.02],
    [0, lowerTop, centerZ],
    stageColor(stage, PALETTE.chromeLight),
    { radius: 0.025 },
  );
  addBox(
    buckets.mint,
    [2.44, 0.12, depth + 0.04],
    [0, BOX_TOP_Y, centerZ],
    stageColor(stage, PALETTE.mint),
    { radius: 0.05, variation: 0.01 },
  );

  // Corner posts, so the box has real edges rather than a soft slab silhouette.
  for (const sideX of [-1, 1]) {
    for (const z of [BOX_BACK_Z + 0.06, BOX_FRONT_Z - 0.06]) {
      addBox(
        buckets.cream,
        [0.12, BOX_TOP_Y - 0.82, 0.12],
        [sideX * (BODY_HALF_WIDTH - 0.02), (0.82 + BOX_TOP_Y) / 2, z],
        stageColor(stage, PALETTE.creamShade),
        { radius: 0.03, variation: 0.008 },
      );
    }
  }

  // The awning roll, stowed under the roof lip on the serving side.
  //
  // There is deliberately NO recessed serving hatch: the flank is the one place
  // "Weirdo Cream" can be read at size, and a counter recess sat straight across
  // the lettering. The rolled canopy carries the ice-cream-van read on its own
  // and lives above the sign, where it shades the banner instead of hiding it.
  // Rolled rather than deployed for the same reason it is on one side only: a
  // deployed canopy throws a third of a yard of silhouette off-axis, which reads
  // as a broken mount under a centered rider, and a truck under way has its
  // awning wound in anyway.
  const hatchX = -(BODY_HALF_WIDTH + 0.01);
  addCylinder(
    buckets.chrome,
    0.09,
    1.78,
    [hatchX - 0.09, AWNING_ROLL_Y, centerZ + 0.24],
    stageColor(stage, PALETTE.chromeShade),
    { rotation: [Math.PI / 2, 0, 0], radialSegments: 10 },
  );
  for (let index = 0; index < 7; index++) {
    const t = (index + 0.5) / 7;
    const stripeZ = centerZ + 0.24 + (t - 0.5) * 1.72;
    addCylinder(
      buckets.awning,
      0.115,
      1.72 / 7,
      [hatchX - 0.09, AWNING_ROLL_Y, stripeZ],
      stageColor(stage, index % 2 === 0 ? PALETTE.awningLight : PALETTE.creamLight),
      { rotation: [Math.PI / 2, 0, 0], radialSegments: 10, variation: 0.014 },
    );
  }
  // Counter rail below the roll, the one nod to a serving side that stays clear
  // of the lettering.
  addBox(
    buckets.chrome,
    [0.12, 0.08, 1.78],
    [hatchX - 0.05, BANNER_TOP_Y + 0.09, centerZ + 0.24],
    stageColor(stage, PALETTE.chromeLight),
    { radius: 0.025 },
  );

  // Rear shutter panel the portrait decal is stamped on, plus tail lamps.
  addBox(
    buckets.cream,
    [1.6, 1.3, 0.08],
    [0, 1.72, BOX_BACK_Z - 0.02],
    stageColor(stage, PALETTE.cream),
    { radius: 0.04, variation: 0.01 },
  );
  for (const sideX of [-1, 1]) {
    addBox(
      buckets.awning,
      [0.2, 0.28, 0.08],
      [sideX * 0.92, 1.06, BOX_BACK_Z - 0.02],
      stageColor(stage, PALETTE.awningLight),
      { radius: 0.03 },
    );
  }
}

function addRoofCone(coneNode, surface, stage) {
  const cream = surfaceBucket(surface, 'TruckCreamPanel');
  const awning = surfaceBucket(surface, 'TruckAwning');
  const mint = surfaceBucket(surface, 'TruckMintShell');
  const chrome = surfaceBucket(surface, 'TruckChrome');

  // The giant cone on the roof: waffle cone point-down, three scoops, a cherry.
  // Sized so the whole truck tops out inside its height contract; scoops are
  // detail-1 icosahedra, which at this size is the last subdivision that reads
  // as a scoop rather than as polygons, and a quarter the triangles of detail 2.
  addCone(cream, 0.26, 0.52, [0, 0.26, 0], stageColor(stage, PALETTE.creamShade), {
    rotation: [Math.PI, 0, 0],
    radialSegments: 14,
  });
  addSphere(mint, 0.22, [-0.11, 0.58, 0.03], stageColor(stage, PALETTE.mintLight), { detail: 1 });
  addSphere(awning, 0.21, [0.12, 0.6, -0.04], stageColor(stage, PALETTE.awningLight), {
    detail: 1,
  });
  addSphere(cream, 0.2, [0.01, 0.8, 0.02], stageColor(stage, PALETTE.creamLight), { detail: 1 });
  addSphere(awning, 0.07, [0.02, 0.99, 0.02], stageColor(stage, PALETTE.awningShade), {
    detail: 1,
  });
  addCylinder(chrome, 0.014, 0.13, [0.045, 1.07, 0.02], stageColor(stage, PALETTE.chromeShade), {
    rotation: [0.3, 0, 0.2],
    radialSegments: 6,
  });

  // The chime speaker under the cone: where the jingle comes from.
  addCylinder(chrome, 0.13, 0.1, [0, 0.04, -0.15], stageColor(stage, PALETTE.chromeLight), {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 12,
  });
  return { cream, awning, mint, chrome };
}

function addCab(buckets, stage) {
  const { floorY, backZ, frontZ, doorTopY, screenZ, screenTopY } = TRUCK_CAB;

  // Tub floor and the kick panel the driver's feet rest against.
  addBox(
    buckets.dark,
    [2.24, 0.1, frontZ - backZ],
    [0, floorY - 0.05, (backZ + frontZ) / 2],
    stageColor(stage, PALETTE.ironLight, PALETTE.blockoutSecondary),
    { radius: 0.03 },
  );

  // Door panels: mint outside, cream cap rail. They stop at the waist, which is
  // what keeps the driver's torso in open air.
  for (const sideX of [-1, 1]) {
    addBox(
      buckets.mint,
      [0.1, doorTopY - floorY + 0.14, frontZ - backZ - 0.24],
      [sideX * BODY_HALF_WIDTH, (floorY + doorTopY) / 2 - 0.02, (backZ + frontZ) / 2 - 0.06],
      stageColor(stage, PALETTE.mintLight),
      { radius: 0.04, variation: 0.01 },
    );
    addBox(
      buckets.chrome,
      [0.14, 0.07, frontZ - backZ - 0.2],
      [sideX * BODY_HALF_WIDTH, doorTopY, (backZ + frontZ) / 2 - 0.06],
      stageColor(stage, PALETTE.chromeLight),
      { radius: 0.025 },
    );
    // Door handle and a wing mirror on its stalk.
    addBox(
      buckets.chrome,
      [0.06, 0.06, 0.24],
      [sideX * (BODY_HALF_WIDTH + 0.06), 1.22, backZ + 0.5],
      stageColor(stage, PALETTE.chrome),
      { radius: 0.02 },
    );
    addCylinder(
      buckets.chrome,
      0.022,
      0.26,
      [sideX * (BODY_HALF_WIDTH + 0.14), 1.56, frontZ - 0.28],
      stageColor(stage, PALETTE.chromeShade),
      { rotation: [0, 0, 0], radialSegments: 6 },
    );
    addBox(
      buckets.dark,
      [0.05, 0.22, 0.16],
      [sideX * (BODY_HALF_WIDTH + 0.16), 1.72, frontZ - 0.28],
      stageColor(stage, PALETTE.ironDeep, PALETTE.blockoutSecondary),
      { radius: 0.03 },
    );
  }

  // Windscreen: a chrome frame around the glass, topped out below the driver's
  // shoulders so nothing crosses the body. The pane rides the CHROME material
  // rather than the dark trim: vertex colours can only darken toward their
  // material's base, so on the near-black trim any glass tint clamps to flat
  // black and the screen reads as a hole punched through the cab. On the bright
  // metallic base the same tint lands as cool, reflective automotive glass.
  addBox(
    buckets.chrome,
    [2.14, 0.08, 0.1],
    [0, screenTopY, screenZ],
    stageColor(stage, PALETTE.chromeLight),
    { radius: 0.03 },
  );
  addBox(
    buckets.chrome,
    [2.0, screenTopY - doorTopY, 0.05],
    [0, (doorTopY + screenTopY) / 2, screenZ],
    stageColor(stage, PALETTE.glass, PALETTE.blockoutSecondary),
    { radius: 0.02 },
  );
  // Centre divider and a pair of wipers parked at the base of the screen.
  addBox(
    buckets.chrome,
    [0.05, screenTopY - doorTopY, 0.07],
    [0, (doorTopY + screenTopY) / 2, screenZ],
    stageColor(stage, PALETTE.chrome),
    { radius: 0.02 },
  );
  for (const sideX of [-1, 1]) {
    addBox(
      buckets.dark,
      [0.5, 0.03, 0.03],
      [sideX * 0.5, doorTopY + 0.09, screenZ - 0.05],
      stageColor(stage, PALETTE.ironLight, PALETTE.blockoutSecondary),
      { radius: 0.012, rotation: [0, 0, sideX * 0.12] },
    );
  }
  for (const sideX of [-1, 1]) {
    addBox(
      buckets.chrome,
      [0.09, screenTopY - doorTopY + 0.1, 0.1],
      [sideX * 1.05, (doorTopY + screenTopY) / 2, screenZ],
      stageColor(stage, PALETTE.chrome),
      { radius: 0.025 },
    );
  }

  // Bench seat and the wheel, both behind and below the driver's standing pose.
  addBox(
    buckets.awning,
    [1.5, 0.16, 0.5],
    [0, floorY + 0.28, TRUCK_CAB.riderZ - 0.32],
    stageColor(stage, PALETTE.awningLight),
    { radius: 0.06, variation: 0.02 },
  );
  addBox(
    buckets.awning,
    [1.5, 0.5, 0.14],
    [0, floorY + 0.56, TRUCK_CAB.riderZ - 0.55],
    stageColor(stage, PALETTE.awning),
    { radius: 0.05, variation: 0.02 },
  );
  addCylinder(
    buckets.dark,
    0.03,
    0.34,
    [0, floorY + 0.44, TRUCK_CAB.riderZ + 0.42],
    stageColor(stage, PALETTE.ironLight, PALETTE.blockoutSecondary),
    { rotation: [1.1, 0, 0], radialSegments: 8 },
  );
  addGeometry(
    buckets.dark,
    new THREE.TorusGeometry(0.21, 0.032, 8, 20),
    stageColor(stage, PALETTE.iron, PALETTE.blockoutSecondary),
    { position: [0, floorY + 0.6, TRUCK_CAB.riderZ + 0.5], rotation: [1.1, 0, 0] },
  );
}

function addNose(buckets, stage) {
  // The bonnet box spans z 2.08 to 2.40, so its FRONT FACE is 2.40. The badge
  // decal sits just proud of that; at the old 2.38 it was buried inside the
  // bonnet and never drew.
  const noseFrontZ = 2.4;
  // Snub bonnet, grille, bumper, lamps, and the brass horn on top.
  addBox(buckets.mint, [2.16, 0.85, 0.32], [0, 1.12, 2.24], stageColor(stage, PALETTE.mintLight), {
    radius: 0.09,
    variation: 0.012,
  });
  addBox(buckets.cream, [2.2, 0.14, 0.36], [0, 1.5, 2.22], stageColor(stage, PALETTE.creamLight), {
    radius: 0.05,
  });
  for (const sideX of [-1, 1]) {
    addCylinder(
      buckets.chrome,
      0.15,
      0.12,
      [sideX * 0.78, 1.16, noseFrontZ - 0.02],
      stageColor(stage, PALETTE.chromeLight),
      { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 },
    );
    addCylinder(
      buckets.cream,
      0.11,
      0.06,
      [sideX * 0.78, 1.16, noseFrontZ + 0.03],
      stageColor(stage, PALETTE.creamLight),
      { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 },
    );
  }
  // Grille slats under the badge.
  for (let index = 0; index < 4; index++) {
    addBox(
      buckets.dark,
      [0.9, 0.05, 0.06],
      [0, 0.86 + index * 0.09, noseFrontZ - 0.01],
      stageColor(stage, PALETTE.ironDeep, PALETTE.blockoutSecondary),
      { radius: 0.015 },
    );
  }
  addBox(
    buckets.chrome,
    [2.24, 0.18, 0.22],
    [0, 0.72, noseFrontZ - 0.04],
    stageColor(stage, PALETTE.chromeLight),
    { radius: 0.06 },
  );
  // The horn: a brass trumpet bolted to the bonnet, the vroom made visible.
  addCone(buckets.chrome, 0.14, 0.34, [0.62, 1.68, 2.1], stageColor(stage, PALETTE.chrome), {
    rotation: [Math.PI / 2 + 0.25, 0, 0],
    radialSegments: 12,
  });
  addCylinder(
    buckets.chrome,
    0.035,
    0.3,
    [0.62, 1.62, 1.86],
    stageColor(stage, PALETTE.chromeShade),
    { rotation: [Math.PI / 2 + 0.25, 0, 0], radialSegments: 8 },
  );
  return noseFrontZ;
}

function addSignage(bucket, noseFrontZ) {
  const bannerCenterZ = (BOX_BACK_Z + BOX_FRONT_Z) / 2 + 0.1;
  // "Weirdo Cream" on BOTH flanks, at the atlas region's own 2:1 aspect.
  for (const sign of [-1, 1]) {
    addDecal(bucket, DECAL_REGIONS.banner, {
      axis: 'x',
      sign,
      center: [sign * (BODY_HALF_WIDTH + 0.012), BANNER_CENTER_Y, bannerCenterZ],
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
    });
  }
  // The driver's portrait on the rear shutter.
  addDecal(bucket, DECAL_REGIONS.portrait, {
    axis: 'z',
    sign: -1,
    center: [0, 1.75, BOX_BACK_Z - 0.075],
    width: 1.1,
    height: 1.1,
  });
  // The cone badge on the nose.
  addDecal(bucket, DECAL_REGIONS.badge, {
    axis: 'z',
    sign: 1,
    center: [0, 1.2, noseFrontZ + 0.012],
    width: 0.56,
    height: 0.56,
  });
}

// ---------------------------------------------------------------------------
// Clips. An old truck idles rough, so Idle shakes rather than breathes; Walk and
// Run spin the wheels one revolution per cycle and bounce the body on its
// springs, with the roof cone lagging a frame behind on its own node.
// ---------------------------------------------------------------------------

function createAnimations(bodyPivot, coneNode, wheelNodes) {
  const clips = [];
  const wheelTracks = (duration, rotations) => {
    const times = rotations.map((_, index) => (index * duration) / (rotations.length - 1));
    const tracks = [];
    for (const node of wheelNodes) {
      const values = [];
      for (const angle of rotations) {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          angle,
        );
        values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
    }
    return tracks;
  };
  const coneTrack = (duration, amplitude, times) =>
    new THREE.QuaternionKeyframeTrack(
      `${coneNode.name}.quaternion`,
      times,
      times.flatMap((_, index) => {
        const phase = (index / (times.length - 1)) * Math.PI * 2;
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.sin(phase) * amplitude, 0, Math.cos(phase) * amplitude * 0.6),
        );
        return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
      }),
    );

  // Idle: a lumpy diesel shudder, deliberately not a smooth sine.
  const idleTimes = [0, 0.18, 0.34, 0.52, 0.7, 0.9];
  clips.push(
    new THREE.AnimationClip('Idle', 0.9, [
      new THREE.VectorKeyframeTrack(
        `${bodyPivot.name}.position`,
        idleTimes,
        [0, 0, 0, 0, 0.012, 0, 0, 0.004, 0, 0, 0.014, 0, 0, 0.003, 0, 0, 0, 0],
      ),
      coneTrack(0.9, 0.014, idleTimes),
    ]),
  );

  const revolution = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2, Math.PI * 2];
  const walkTimes = [0, 0.22, 0.44, 0.66, 0.88];
  clips.push(
    new THREE.AnimationClip('Walk', 0.88, [
      new THREE.VectorKeyframeTrack(
        `${bodyPivot.name}.position`,
        walkTimes,
        [0, 0, 0, 0, 0.03, 0.006, 0, 0.006, 0, 0, 0.03, -0.006, 0, 0, 0],
      ),
      coneTrack(0.88, 0.045, walkTimes),
      ...wheelTracks(0.88, revolution),
    ]),
  );

  const runTimes = [0, 0.1125, 0.225, 0.3375, 0.45];
  clips.push(
    new THREE.AnimationClip('Run', 0.45, [
      new THREE.VectorKeyframeTrack(
        `${bodyPivot.name}.position`,
        runTimes,
        [0, 0, 0, 0, 0.062, 0.018, 0, 0.01, 0, 0, 0.062, -0.018, 0, 0, 0],
      ),
      coneTrack(0.45, 0.1, runTimes),
      ...wheelTracks(0.45, revolution),
    ]),
  );

  // Death: the truck drops on its springs and rolls onto its side.
  const deathTimes = [0, 0.3, 0.75, 1.25];
  const deathValues = [];
  for (const [x, z] of [
    [0, 0],
    [0.05, -0.06],
    [-0.08, 0.5],
    [-0.1, 1.35],
  ]) {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, z));
    deathValues.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  clips.push(
    new THREE.AnimationClip('Death', 1.25, [
      new THREE.QuaternionKeyframeTrack(`${bodyPivot.name}.quaternion`, deathTimes, deathValues),
      new THREE.VectorKeyframeTrack(
        `${bodyPivot.name}.position`,
        deathTimes,
        [0, 0, 0, 0, -0.05, 0, 0, -0.12, 0, 0, -0.16, 0],
      ),
    ]),
  );
  return clips;
}

function addSemanticMesh(parent, bucket, material, name, shadows = true) {
  const geometry = mergeBucket(bucket, name);
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createWeirdoCreamTruck({ stage = 'final', sourceFingerprint = null } = {}) {
  stageIndex(stage);
  const root = new THREE.Group();
  root.name = 'WeirdoCreamTruck';
  root.userData = {
    assetId: 'weirdo_cream_truck',
    assetType: 'rideable-mount',
    sourceFingerprint,
    frontAxis: [0, 0, 1],
    nativeBounds: TRUCK_NATIVE_BOUNDS,
    clips: TRUCK_CLIP_NAMES,
    cab: TRUCK_CAB,
  };

  const materialByName = new Map(
    TRUCK_MATERIAL_CONTRACT.map((contract) => [
      contract.name,
      createMaterial(contract, stage, PALETTE.blockoutPrimary),
    ]),
  );
  const surface = createSurface(stage);
  const wheelNodes = [];
  const wheelPlans = [];
  addRunningGear(root, surface, stage, wheelNodes, wheelPlans);

  // Everything above the springs hangs off one pivot so the clips can bounce
  // the body without moving the contact patches.
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'BodyPivot';
  root.add(bodyPivot);

  const bodyBuckets = {
    cream: surfaceBucket(surface, 'TruckCreamPanel'),
    mint: surfaceBucket(surface, 'TruckMintShell'),
    dark: surfaceBucket(surface, 'TruckDarkTrim'),
    chrome: surfaceBucket(surface, 'TruckChrome'),
    awning: surfaceBucket(surface, 'TruckAwning'),
  };
  const decalBucket = surfaceBucket(surface, 'TruckDecal');

  addChassis(bodyBuckets, stage);
  addFreezerBox(bodyBuckets, stage);
  addCab(bodyBuckets, stage);
  const noseFrontZ = addNose(bodyBuckets, stage);
  addSignage(decalBucket, noseFrontZ);

  const coneNode = new THREE.Group();
  coneNode.name = 'RoofCone';
  coneNode.position.set(0, BOX_TOP_Y + 0.06, -0.15);
  bodyPivot.add(coneNode);
  const coneBuckets = addRoofCone(coneNode, surface, stage);

  // Every part is placed: project UVs and bake the macro shading band before
  // anything is merged into a draw call.
  bakeSurface(surface);

  for (const plan of wheelPlans) {
    addSemanticMesh(plan.node, plan.buckets.tyre, materialByName.get('TruckDarkTrim'), 'TruckTyre');
    addSemanticMesh(plan.node, plan.buckets.hub, materialByName.get('TruckChrome'), 'TruckHub');
  }

  addSemanticMesh(bodyPivot, bodyBuckets.cream, materialByName.get('TruckCreamPanel'), 'TruckBody');
  addSemanticMesh(bodyPivot, bodyBuckets.mint, materialByName.get('TruckMintShell'), 'TruckShell');
  addSemanticMesh(bodyPivot, bodyBuckets.dark, materialByName.get('TruckDarkTrim'), 'TruckFrame');
  addSemanticMesh(
    bodyPivot,
    bodyBuckets.chrome,
    materialByName.get('TruckChrome'),
    'TruckBrightwork',
  );
  addSemanticMesh(bodyPivot, bodyBuckets.awning, materialByName.get('TruckAwning'), 'TruckAwning');
  // Signage never casts: a flat quad's shadow is a hard rectangle on the panel
  // it is glued to, which reads as a bug rather than a decal.
  addSemanticMesh(bodyPivot, decalBucket, materialByName.get('TruckDecal'), 'TruckSignage', false);

  addSemanticMesh(
    coneNode,
    coneBuckets.cream,
    materialByName.get('TruckCreamPanel'),
    'ConeScoopCream',
  );
  addSemanticMesh(
    coneNode,
    coneBuckets.mint,
    materialByName.get('TruckMintShell'),
    'ConeScoopMint',
  );
  addSemanticMesh(
    coneNode,
    coneBuckets.awning,
    materialByName.get('TruckAwning'),
    'ConeScoopBerry',
  );
  addSemanticMesh(coneNode, coneBuckets.chrome, materialByName.get('TruckChrome'), 'ConeHardware');

  for (const definition of TRUCK_SOCKET_DEFINITIONS) {
    const socket = new THREE.Object3D();
    socket.name = definition.nodeName;
    socket.position.fromArray(definition.position);
    socket.userData = {
      socketType: definition.id === 'rider' ? 'rider-seat' : 'vfx-emitter',
      purpose: definition.purpose,
    };
    bodyPivot.add(socket);
  }

  root.traverse((object) => {
    if (object.isMesh) object.frustumCulled = true;
  });
  root.updateMatrixWorld(true);

  // Seat the model on the floor and centre it on X/Z, which the pipeline
  // requires and which every consumer assumes: the renderer parents the mount at
  // the entity origin, so an off-centre body would ride visibly beside the
  // player. Doing it from the measured bounds rather than by hand means a later
  // detail that widens one flank cannot quietly break the contract. The rider
  // seat is authored in the SAME space, so `riderSeat` below reports where the
  // driver actually ends up for src/render/mount_visuals.ts to copy.
  const box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.y -= box.min.y;
  root.position.z -= (box.min.z + box.max.z) / 2;
  root.updateMatrixWorld(true);

  const riderSocket = root.getObjectByName('Socket_Rider');
  const riderSeat = new THREE.Vector3();
  riderSocket.getWorldPosition(riderSeat);
  return {
    root,
    animations: createAnimations(bodyPivot, coneNode, wheelNodes),
    riderSeat: riderSeat.toArray(),
  };
}
