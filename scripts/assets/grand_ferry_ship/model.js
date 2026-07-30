import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const GRAND_FERRY_SHIP_NATIVE_BOUNDS = Object.freeze({
  length: 36.4,
  height: 24.005729972474303,
  beam: 10.754368724631487,
  keelY: -0.00025165538299146904,
});

const STANDARD_BERTH = Object.freeze({
  length: 60,
  waterlineY: -4.5,
  draft: 2.5,
  deckWorldY: 0.72,
});
const STANDARD_SCALE = STANDARD_BERTH.length / GRAND_FERRY_SHIP_NATIVE_BOUNDS.length;
const DECK_CENTER_X = 6.6 / STANDARD_SCALE;
const DECK_HALF_LENGTH = 14 / STANDARD_SCALE;
const DECK_HALF_BEAM = 6.2 / STANDARD_SCALE;
const DECK_SURFACE_Y =
  (STANDARD_BERTH.deckWorldY - (STANDARD_BERTH.waterlineY - STANDARD_BERTH.draft)) / STANDARD_SCALE;
const DECK_THICKNESS = 0.18;
const GANGWAY_CENTER_X = 4.25 / STANDARD_SCALE;
const GANGWAY_HALF_WIDTH = 1.4 / STANDARD_SCALE;
const RAIL_HALF_THICKNESS = 0.14 / STANDARD_SCALE;
const RAIL_HEIGHT = 1.05 / STANDARD_SCALE;
const HULL_HALF_LENGTH = GRAND_FERRY_SHIP_NATIVE_BOUNDS.length / 2;
const HULL_HALF_BEAM = GRAND_FERRY_SHIP_NATIVE_BOUNDS.beam / 2;
const HULL_EDGE_BLOCKER_HALF_THICKNESS = 0.08;
const HULL_NOTCH_BEVEL = 0.02;
const HULL_SECTIONS = Object.freeze([
  Object.freeze({ x: -HULL_HALF_LENGTH, top: 3.8, chine: 2.8, keel: 0.65 }),
  Object.freeze({ x: -13.5, top: 4.85, chine: 3.75, keel: 0.75 }),
  Object.freeze({ x: -2, top: HULL_HALF_BEAM, chine: 4.15, keel: 0.8 }),
  Object.freeze({ x: 8, top: HULL_HALF_BEAM, chine: 4.05, keel: 0.72 }),
  Object.freeze({ x: 14.5, top: 4.05, chine: 2.9, keel: 0.55 }),
  Object.freeze({ x: HULL_HALF_LENGTH, top: 0.28, chine: 0.2, keel: 0.08 }),
]);
const SUPERSTRUCTURE = Object.freeze({
  x: 7.8,
  z: 0,
  hw: 2.2,
  hd: 2.2,
  height: 3.1,
  roofTopY: DECK_SURFACE_Y + 3.65,
});

function railSegment(id, x, z, hw, rot) {
  return Object.freeze({
    id,
    x,
    z,
    hw,
    halfThickness: RAIL_HALF_THICKNESS,
    rot,
    height: RAIL_HEIGHT,
  });
}

const deckMinX = DECK_CENTER_X - DECK_HALF_LENGTH;
const deckMaxX = DECK_CENTER_X + DECK_HALF_LENGTH;
const openingMinX = GANGWAY_CENTER_X - GANGWAY_HALF_WIDTH;
const openingMaxX = GANGWAY_CENTER_X + GANGWAY_HALF_WIDTH;

const rails = Object.freeze([
  railSegment('starboard', DECK_CENTER_X, DECK_HALF_BEAM, DECK_HALF_LENGTH, 0),
  railSegment(
    'port-stern',
    (deckMinX + openingMinX) / 2,
    -DECK_HALF_BEAM,
    (openingMinX - deckMinX) / 2,
    0,
  ),
  railSegment(
    'port-bow',
    (openingMaxX + deckMaxX) / 2,
    -DECK_HALF_BEAM,
    (deckMaxX - openingMaxX) / 2,
    0,
  ),
  railSegment('stern', deckMinX, 0, DECK_HALF_BEAM, Math.PI / 2),
  railSegment('bow', deckMaxX, 0, DECK_HALF_BEAM, Math.PI / 2),
]);

function hullSectionAt(x) {
  for (let index = 0; index < HULL_SECTIONS.length - 1; index++) {
    const left = HULL_SECTIONS[index];
    const right = HULL_SECTIONS[index + 1];
    if (x < left.x || x > right.x) continue;
    const t = (x - left.x) / (right.x - left.x);
    return {
      x,
      top: left.top + (right.top - left.top) * t,
      chine: left.chine + (right.chine - left.chine) * t,
      keel: left.keel + (right.keel - left.keel) * t,
    };
  }
  throw new Error(`grand ferry hull profile has no section at x=${x}`);
}

function blocker(id, kind, x0, x1, z, hd, topY, cameraTopY) {
  return Object.freeze({
    id,
    kind,
    x: (x0 + x1) / 2,
    z,
    hw: (x1 - x0) / 2,
    hd,
    rot: 0,
    topY,
    cameraTopY,
  });
}

function hullProfileSpans(x0, x1) {
  const points = [
    x0,
    ...HULL_SECTIONS.filter((section) => section.x > x0 && section.x < x1).map(
      (section) => section.x,
    ),
    x1,
  ].map(hullSectionAt);
  return points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1] }));
}

function hullEdgeBlocker(id, kind, start, end, side, topY, cameraTopY) {
  const dx = end.x - start.x;
  const startZ = start.top * side;
  const endZ = end.top * side;
  const dz = endZ - startZ;
  return Object.freeze({
    id,
    kind,
    x: (start.x + end.x) / 2,
    z: (startZ + endZ) / 2,
    hw: Math.hypot(dx, dz) / 2,
    hd: HULL_EDGE_BLOCKER_HALF_THICKNESS,
    rot: Math.atan2(-dz, dx),
    topY,
    cameraTopY,
  });
}

function endHullBlockers(kind, x0, x1) {
  return hullProfileSpans(x0, x1).flatMap(({ start, end }, index) => [
    blocker(
      `${kind}-center-${index + 1}`,
      kind,
      start.x,
      end.x,
      0,
      Math.min(start.top, end.top),
      null,
      DECK_SURFACE_Y + RAIL_HEIGHT,
    ),
    hullEdgeBlocker(
      `${kind}-starboard-${index + 1}`,
      kind,
      start,
      end,
      1,
      null,
      DECK_SURFACE_Y + RAIL_HEIGHT,
    ),
    hullEdgeBlocker(
      `${kind}-port-${index + 1}`,
      kind,
      start,
      end,
      -1,
      null,
      DECK_SURFACE_Y + RAIL_HEIGHT,
    ),
  ]);
}

function lowerHullSideBlockers(label, x0, x1, side) {
  return hullProfileSpans(x0, x1).map(({ start, end }, index) =>
    hullEdgeBlocker(
      `lower-hull-${label}-${index + 1}`,
      'lower-hull',
      start,
      end,
      side,
      DECK_SURFACE_Y,
      DECK_SURFACE_Y,
    ),
  );
}

const blockingVolumes = Object.freeze([
  ...lowerHullSideBlockers('starboard', deckMinX, deckMaxX, 1),
  ...lowerHullSideBlockers('port-stern', deckMinX, openingMinX, -1),
  ...lowerHullSideBlockers('port-bow', openingMaxX, deckMaxX, -1),
  ...endHullBlockers('stern', -HULL_HALF_LENGTH, deckMinX),
  ...endHullBlockers('bow', deckMaxX, HULL_HALF_LENGTH),
  Object.freeze({
    id: 'superstructure',
    kind: 'superstructure',
    x: SUPERSTRUCTURE.x,
    z: SUPERSTRUCTURE.z,
    hw: SUPERSTRUCTURE.hw,
    hd: SUPERSTRUCTURE.hd,
    rot: 0,
    topY: null,
    cameraTopY: SUPERSTRUCTURE.roofTopY,
  }),
]);

export const GRAND_FERRY_SHIP_PLAN = Object.freeze({
  version: 1,
  model: Object.freeze({
    length: GRAND_FERRY_SHIP_NATIVE_BOUNDS.length,
    beam: GRAND_FERRY_SHIP_NATIVE_BOUNDS.beam,
    height: GRAND_FERRY_SHIP_NATIVE_BOUNDS.height,
    keelY: GRAND_FERRY_SHIP_NATIVE_BOUNDS.keelY,
    deckSurfaceY: DECK_SURFACE_Y,
  }),
  standardBerth: STANDARD_BERTH,
  deck: Object.freeze({
    id: 'main-deck',
    x: DECK_CENTER_X,
    z: 0,
    hw: DECK_HALF_LENGTH,
    hd: DECK_HALF_BEAM,
    y: DECK_SURFACE_Y,
    thickness: DECK_THICKNESS,
  }),
  rails,
  blockingVolumes,
  rampMatingEdge: Object.freeze({
    id: 'port-gangway',
    x: GANGWAY_CENTER_X,
    z: -DECK_HALF_BEAM,
    halfWidth: GANGWAY_HALF_WIDTH,
    outward: 'z-',
    y: DECK_SURFACE_Y,
  }),
  measurementEpsilons: Object.freeze({
    raw: 0.00001,
    optimized: 0.005,
  }),
});

const PALETTE = Object.freeze({
  hullDeep: 0x183247,
  hullMid: 0x274f67,
  hullLight: 0x3b6c7d,
  stripe: 0xb64d3c,
  deckDark: 0x5a3823,
  deck: 0x835735,
  deckLight: 0xa2764d,
  cabin: 0xd0c49f,
  cabinShade: 0x9d957d,
  rail: 0x4a3021,
  metal: 0x4d5558,
  brass: 0xb58b3f,
  window: 0x6aa4b5,
  sail: 0xd8cfb2,
  sailShade: 0xb8ae92,
});

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function prepareGeometry(source, color, matrix = null) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (matrix) geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r;
    colors[index + 1] = tint.g;
    colors[index + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function addGeometry(bucket, geometry, color, options = {}) {
  bucket.push(
    prepareGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function addCylinder(bucket, radiusTop, radiusBottom, height, segments, position, color, rotation) {
  addGeometry(
    bucket,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    color,
    { position, rotation },
  );
}

function mergeBucket(bucket, label) {
  const merged = mergeGeometries(bucket, false);
  if (!merged) throw new Error(`could not merge grand ferry ${label} geometry`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function makeHullGeometry() {
  const hullTopY = DECK_SURFACE_Y - DECK_THICKNESS;
  const beforeOpening = hullSectionAt(openingMinX - HULL_NOTCH_BEVEL);
  const openingStart = hullSectionAt(openingMinX);
  const openingEnd = hullSectionAt(openingMaxX);
  const afterOpening = hullSectionAt(openingMaxX + HULL_NOTCH_BEVEL);
  const sections = [
    ...HULL_SECTIONS.slice(0, 3),
    beforeOpening,
    { ...openingStart, portTop: DECK_HALF_BEAM },
    { ...openingEnd, portTop: DECK_HALF_BEAM },
    afterOpening,
    ...HULL_SECTIONS.slice(3),
  ];
  const ringSize = 6;
  const positions = [];
  for (const section of sections) {
    positions.push(
      section.x,
      hullTopY,
      section.top,
      section.x,
      1.55,
      section.chine,
      section.x,
      GRAND_FERRY_SHIP_NATIVE_BOUNDS.keelY,
      section.keel,
      section.x,
      GRAND_FERRY_SHIP_NATIVE_BOUNDS.keelY,
      -section.keel,
      section.x,
      1.55,
      -section.chine,
      section.x,
      hullTopY,
      -(section.portTop ?? section.top),
    );
  }
  const indices = [];
  for (let section = 0; section < sections.length - 1; section++) {
    const current = section * ringSize;
    const next = (section + 1) * ringSize;
    for (let side = 0; side < ringSize; side++) {
      const following = (side + 1) % ringSize;
      indices.push(
        current + side,
        next + side,
        next + following,
        current + side,
        next + following,
        current + following,
      );
    }
  }
  for (const [offset, reverse] of [
    [0, true],
    [(sections.length - 1) * ringSize, false],
  ]) {
    for (let index = 1; index < ringSize - 1; index++) {
      if (reverse) indices.push(offset, offset + index + 1, offset + index);
      else indices.push(offset, offset + index, offset + index + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeSail(points, z) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      points.flatMap(([x, y]) => [x, y, z]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMaterial(name, roughness, metalness, options = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    roughness,
    metalness,
    vertexColors: true,
    side: options.side ?? THREE.FrontSide,
  });
}

function meshFromBucket(name, bucket, material) {
  const mesh = new THREE.Mesh(mergeBucket(bucket, name), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildHull(root, hullMaterial) {
  const hull = [];
  addGeometry(hull, makeHullGeometry(), PALETTE.hullDeep);
  const mesh = meshFromBucket('GrandFerryHull', hull, hullMaterial);
  root.add(mesh);
}

function buildMainDeck(root, woodMaterial) {
  const deck = [];
  addBox(
    deck,
    [DECK_HALF_LENGTH * 2, DECK_THICKNESS, DECK_HALF_BEAM * 2],
    [DECK_CENTER_X, DECK_SURFACE_Y - DECK_THICKNESS / 2, 0],
    PALETTE.deck,
  );
  root.add(meshFromBucket('GrandFerryMainDeck', deck, woodMaterial));

  const mating = [];
  addBox(
    mating,
    [GANGWAY_HALF_WIDTH * 2, 0.08, 0.46],
    [GANGWAY_CENTER_X, DECK_SURFACE_Y - 0.04, -DECK_HALF_BEAM + 0.23],
    PALETTE.deckLight,
  );
  root.add(meshFromBucket('GrandFerryGangwayMating', mating, woodMaterial));
}

function railBoxSize(rail, length, height, depth) {
  if (Math.abs(rail.rot) < 0.001) return [length, height, depth];
  return [depth, height, length];
}

function railPoint(rail, along) {
  const cos = Math.cos(rail.rot);
  const sin = Math.sin(rail.rot);
  return [rail.x + along * cos, rail.z - along * sin];
}

function buildRails(root, woodMaterial) {
  const railGeometry = [];
  const bulwarkHeight = RAIL_HEIGHT * 0.42;
  const capHeight = 0.09;
  const postSize = RAIL_HALF_THICKNESS * 1.65;
  for (const rail of rails) {
    const length = rail.hw * 2;
    addBox(
      railGeometry,
      railBoxSize(rail, length, bulwarkHeight, RAIL_HALF_THICKNESS * 2),
      [rail.x, DECK_SURFACE_Y + bulwarkHeight / 2, rail.z],
      PALETTE.hullLight,
    );
    addBox(
      railGeometry,
      railBoxSize(rail, length, capHeight, RAIL_HALF_THICKNESS * 2.2),
      [rail.x, DECK_SURFACE_Y + RAIL_HEIGHT - capHeight / 2, rail.z],
      PALETTE.rail,
    );
    const posts = Math.max(2, Math.ceil(length / 1.25));
    for (let index = 0; index <= posts; index++) {
      if (rail.id === 'port-stern' && index === posts) continue;
      if (rail.id === 'port-bow' && index === 0) continue;
      const along = -rail.hw + (index / posts) * length;
      const [x, z] = railPoint(rail, along);
      addBox(
        railGeometry,
        [postSize, RAIL_HEIGHT, postSize],
        [x, DECK_SURFACE_Y + RAIL_HEIGHT / 2, z],
        PALETTE.rail,
      );
    }
  }
  root.add(meshFromBucket('GrandFerryRails', railGeometry, woodMaterial));
}

function buildSuperstructure(root, hullMaterial, accentMaterial) {
  const cabin = [];
  addBox(
    cabin,
    [SUPERSTRUCTURE.hw * 2, SUPERSTRUCTURE.height, SUPERSTRUCTURE.hd * 2],
    [SUPERSTRUCTURE.x, DECK_SURFACE_Y + SUPERSTRUCTURE.height / 2, 0],
    PALETTE.cabin,
  );
  root.add(meshFromBucket('GrandFerrySuperstructure', cabin, hullMaterial));

  const details = [];
  addBox(
    details,
    [SUPERSTRUCTURE.hw * 2 + 0.45, 0.34, SUPERSTRUCTURE.hd * 2 + 0.5],
    [SUPERSTRUCTURE.x, SUPERSTRUCTURE.roofTopY - 0.17, 0],
    PALETTE.hullMid,
  );
  for (const z of [-SUPERSTRUCTURE.hd - 0.025, SUPERSTRUCTURE.hd + 0.025]) {
    for (const x of [SUPERSTRUCTURE.x - 1.3, SUPERSTRUCTURE.x, SUPERSTRUCTURE.x + 1.3]) {
      addBox(details, [0.72, 0.62, 0.05], [x, DECK_SURFACE_Y + 2.05, z], PALETTE.window);
    }
  }
  addCylinder(
    details,
    0.28,
    0.32,
    1.55,
    10,
    [SUPERSTRUCTURE.x - 1.2, SUPERSTRUCTURE.roofTopY + 0.775, 0],
    PALETTE.metal,
  );
  root.add(meshFromBucket('GrandFerrySuperstructureDetails', details, accentMaterial));
}

function buildRigging(root, woodMaterial) {
  const rigging = [];
  const mainMastX = -7;
  const foreMastX = 14.2;
  addCylinder(
    rigging,
    0.12,
    0.2,
    GRAND_FERRY_SHIP_NATIVE_BOUNDS.height - DECK_SURFACE_Y,
    10,
    [mainMastX, (GRAND_FERRY_SHIP_NATIVE_BOUNDS.height + DECK_SURFACE_Y) / 2, 0],
    PALETTE.rail,
  );
  addCylinder(rigging, 0.1, 0.16, 10.8, 9, [foreMastX, DECK_SURFACE_Y + 5.4, 0], PALETTE.rail);
  addCylinder(rigging, 0.1, 0.1, 8.4, 8, [mainMastX, 17.2, 0], PALETTE.rail, [Math.PI / 2, 0, 0]);
  addCylinder(rigging, 0.08, 0.08, 5.6, 8, [foreMastX, 12.2, 0], PALETTE.rail, [Math.PI / 2, 0, 0]);
  root.add(meshFromBucket('GrandFerryRigging', rigging, woodMaterial));
}

function buildSails(root, sailMaterial) {
  const sails = [];
  for (const z of [-0.04, 0.04]) {
    addGeometry(
      sails,
      makeSail(
        [
          [-6.7, 22.5],
          [-6.7, 9],
          [0.8, 10.2],
        ],
        z,
      ),
      z < 0 ? PALETTE.sailShade : PALETTE.sail,
    );
    addGeometry(
      sails,
      makeSail(
        [
          [14, 15.7],
          [14, 7.6],
          [9.3, 8.4],
        ],
        z,
      ),
      z < 0 ? PALETTE.sailShade : PALETTE.sail,
    );
  }
  root.add(meshFromBucket('GrandFerrySails', sails, sailMaterial));
}

function buildAccents(root, accentMaterial) {
  const accents = [];
  for (const z of [-5.02, 5.02]) {
    addBox(accents, [25, 0.22, 0.12], [-1, 3.25, z], PALETTE.stripe);
  }
  for (const x of [-12, -5, 2, 9]) {
    for (const z of [-5.09, 5.09]) {
      addCylinder(accents, 0.12, 0.12, 0.13, 8, [x, 2.45, z], PALETTE.brass, [Math.PI / 2, 0, 0]);
    }
  }
  root.add(meshFromBucket('GrandFerryAccents', accents, accentMaterial));
}

function addSocket(root, name, position, id, purpose, forward) {
  const socket = new THREE.Object3D();
  socket.name = name;
  socket.position.fromArray(position);
  socket.userData.sculptSocket = { id, purpose, forward: [...forward], interactive: false };
  root.add(socket);
}

export function createGrandFerryShip() {
  const root = new THREE.Group();
  root.name = 'GrandFerryShip';
  const hullMaterial = makeMaterial('GrandFerryHullPaint', 0.78, 0.05);
  const woodMaterial = makeMaterial('GrandFerryTimber', 0.86, 0);
  const sailMaterial = makeMaterial('GrandFerrySailcloth', 0.94, 0, {
    side: THREE.DoubleSide,
  });
  const accentMaterial = makeMaterial('GrandFerryMetalAndGlass', 0.5, 0.42);

  buildHull(root, hullMaterial);
  buildMainDeck(root, woodMaterial);
  buildRails(root, woodMaterial);
  buildSuperstructure(root, hullMaterial, accentMaterial);
  buildRigging(root, woodMaterial);
  buildSails(root, sailMaterial);
  buildAccents(root, accentMaterial);

  addSocket(
    root,
    'Socket_GangwayMatingEdge',
    [GANGWAY_CENTER_X, DECK_SURFACE_Y, -DECK_HALF_BEAM],
    'gangway-mating-edge',
    'flush edge shared by the visual deck and generated harbor ramp',
    [0, 0, -1],
  );
  addSocket(
    root,
    'Socket_DeckCenter',
    [DECK_CENTER_X, DECK_SURFACE_Y, 0],
    'deck-center',
    'walkable main deck center',
    [1, 0, 0],
  );

  root.userData.sculptRuntime = {
    version: 1,
    source: 'deterministic-procedural-threejs',
    frontAxis: [1, 0, 0],
    floorSeated: true,
    collisionPlanVersion: GRAND_FERRY_SHIP_PLAN.version,
    shippingCollisionMesh: false,
    serviceCues: [
      'deep-blue-flared-hull',
      'warm-timber-main-deck',
      'port-gangway-opening',
      'raised-wheelhouse',
      'twin-mast-silhouette',
    ],
  };
  root.updateMatrixWorld(true);
  return root;
}
