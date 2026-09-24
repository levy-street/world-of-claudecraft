import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const HOARD_ENTRANCE_STAGES = Object.freeze([
  'blockout',
  'structural',
  'form',
  'material',
  'final',
]);

export const HOARD_ENTRANCE_CONTRACT = Object.freeze({
  id: 'buried-hoard-entrance',
  rootName: 'HoardEntrance',
  outputName: 'hoard_entrance.glb',
  dimensions: Object.freeze({ width: 5.734, height: 3.186, depth: 5.009 }),
  triangleTarget: 4_500,
  triangleCeiling: 6_000,
  byteCeiling: 96 * 1024,
  terrainBurialDepth: 0.4,
  hatchOpenRotationX: -1.42,
  serviceCues: Object.freeze([
    'fresh-clumpy-earth-ring',
    'dark-rectangular-opening',
    'open-iron-bound-hatch',
    'descending-ladder-and-steps',
    'planted-shovel',
    'exposed-roots-and-stones',
  ]),
  sockets: Object.freeze([
    Object.freeze({
      id: 'interaction',
      name: 'Socket_Interaction',
      position: [0, 0.34, 1.05],
      purpose: 'walk-in entrance interaction anchor',
      interactive: true,
    }),
    Object.freeze({
      id: 'opening',
      name: 'Socket_Opening',
      position: [0, 0.24, 0],
      purpose: 'dark opening and ground glow anchor',
      interactive: false,
    }),
    Object.freeze({
      id: 'light',
      name: 'Socket_Light',
      position: [0, 0.38, 0.02],
      purpose: 'rarity light shaft origin',
      interactive: false,
    }),
    Object.freeze({
      id: 'motes',
      name: 'Socket_Motes',
      position: [0, 0.58, 0.02],
      purpose: 'rising dust mote emitter origin',
      interactive: false,
    }),
  ]),
});

const PALETTE = Object.freeze({
  void: 0x080807,
  earthDeep: 0x332218,
  earth: 0x59402a,
  earthWarm: 0x755238,
  earthFresh: 0x896044,
  stoneDeep: 0x3d3b36,
  stone: 0x666158,
  stoneLight: 0x898178,
  rootDeep: 0x2c1c12,
  root: 0x4c3020,
  woodDeep: 0x2b1a10,
  wood: 0x56351e,
  woodLight: 0x76502f,
  ironDeep: 0x25282a,
  iron: 0x454b4d,
  rarityMetal: 0xb99b67,
});

export const HOARD_MATERIAL_DEFINITIONS = Object.freeze({
  earth: Object.freeze({ name: 'HoardEarthStone', metalness: 0, roughness: 0.96 }),
  wood: Object.freeze({ name: 'HoardWood', metalness: 0, roughness: 0.83 }),
  iron: Object.freeze({ name: 'HoardIron', metalness: 0.68, roughness: 0.48 }),
  rarity: Object.freeze({ name: 'HoardRarityMetalwork', metalness: 0.74, roughness: 0.36 }),
});

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function preparedGeometry(source, color, transform) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (transform) geometry.applyMatrix4(transform);
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
    preparedGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0], radius = 0) {
  const geometry = radius
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius)
    : new THREE.BoxGeometry(...size);
  addGeometry(bucket, geometry, color, { position, rotation });
}

function addCylinder(bucket, radiusTop, radiusBottom, height, segments, position, color, rotation) {
  addGeometry(
    bucket,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    color,
    { position, rotation },
  );
}

function addCylinderBetween(bucket, start, end, radius, segments, color) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const delta = b.clone().sub(a);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.91, delta.length(), segments, 1);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  const matrix = new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1));
  bucket.push(preparedGeometry(geometry, color, matrix));
}

function addUnearthedPit(earth) {
  addBox(earth, [3.35, 0.12, 2.62], [0, 0.06, 0], PALETTE.void, [0, 0, 0], 0.12);
  // Continuous shoulder hides the terrain seam between the larger earth clumps.
  const shoulder = [];
  for (let index = 0; index < 28; index++) {
    const points = [index, index + 1].map((n) => {
      const a = (n / 28) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      const innerRadius = 1 / Math.max(Math.abs(c) / 1.64, Math.abs(s) / 1.27);
      return {
        inner: [c * innerRadius, 0.15, s * innerRadius],
        outer: [c * 2.47, 0.18 + Math.sin(n * 1.7) * 0.05, s * 2.08],
      };
    });
    shoulder.push(
      ...points[0].inner,
      ...points[1].inner,
      ...points[0].outer,
      ...points[1].inner,
      ...points[1].outer,
      ...points[0].outer,
    );
  }
  const shoulderGeometry = new THREE.BufferGeometry();
  shoulderGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shoulder, 3));
  shoulderGeometry.computeVertexNormals();
  addGeometry(earth, shoulderGeometry, PALETTE.earthDeep);
  const clumps = 34;
  for (let index = 0; index < clumps; index++) {
    const angle = (index / clumps) * Math.PI * 2;
    const wobble = 1 + Math.sin(index * 2.37) * 0.08;
    const x = Math.cos(angle) * 2.31 * wobble;
    const z = Math.sin(angle) * 1.94 * wobble;
    const y = 0.2 + (index % 4) * 0.055;
    const radius = 0.42 + (index % 5) * 0.035;
    const color = [PALETTE.earthDeep, PALETTE.earth, PALETTE.earthWarm, PALETTE.earthFresh][
      index % 4
    ];
    addGeometry(earth, new THREE.DodecahedronGeometry(radius, 0), color, {
      position: [x, y, z],
      rotation: [index * 0.17, index * 0.31, index * 0.11],
      scale: [1.15, 0.58 + (index % 3) * 0.07, 0.92],
    });
  }

  const stones = [
    [-2.15, 0.5, 0.9, 0.25],
    [-1.55, 0.43, -1.62, 0.2],
    [-0.85, 0.44, 2.05, 0.24],
    [0.72, 0.47, -2.02, 0.28],
    [1.55, 0.42, 1.72, 0.19],
    [2.1, 0.49, -0.9, 0.24],
    [2.38, 0.38, 0.36, 0.16],
    [-2.42, 0.37, -0.22, 0.15],
  ];
  for (const [index, [x, y, z, radius]] of stones.entries()) {
    addGeometry(
      earth,
      new THREE.OctahedronGeometry(radius, index % 3 === 0 ? 1 : 0),
      index % 2 ? PALETTE.stone : PALETTE.stoneLight,
      {
        position: [x, y, z],
        rotation: [index * 0.23, index * 0.41, index * 0.13],
        scale: [1.25, 0.72, 0.95],
      },
    );
  }
}

function addDescendingLadderAndSteps(wood) {
  addCylinderBetween(wood, [-0.72, 0.15, -0.85], [-0.72, 0.6, 0.62], 0.085, 8, PALETTE.woodDeep);
  addCylinderBetween(wood, [0.72, 0.15, -0.85], [0.72, 0.6, 0.62], 0.085, 8, PALETTE.woodDeep);
  for (let index = 0; index < 5; index++) {
    const t = index / 5;
    addCylinderBetween(
      wood,
      [-0.69, 0.18 + t * 0.38, -0.73 + t * 1.18],
      [0.69, 0.18 + t * 0.38, -0.73 + t * 1.18],
      0.07,
      8,
      index % 2 ? PALETTE.wood : PALETTE.woodLight,
    );
  }
  for (let index = 0; index < 3; index++) {
    addBox(
      wood,
      [1.55 - index * 0.14, 0.12, 0.38],
      [0, 0.13 + index * 0.1, 0.98 - index * 0.39],
      index === 1 ? PALETTE.woodLight : PALETTE.wood,
      [-0.04, 0, 0],
      0.025,
    );
  }
}

function addRootsAndShovel(wood, iron) {
  const roots = [
    [[-2.1, 0.38, -0.92], [-1.42, 0.22, -0.48], 0.07],
    [[-1.56, 0.35, 1.58], [-0.94, 0.18, 1.18], 0.06],
    [[1.34, 0.36, -1.7], [0.82, 0.16, -1.13], 0.075],
    [[2.12, 0.35, 0.72], [1.56, 0.19, 0.38], 0.055],
  ];
  for (const [index, [start, end, radius]] of roots.entries()) {
    addCylinderBetween(wood, start, end, radius, 7, index % 2 ? PALETTE.root : PALETTE.rootDeep);
    const tip = [...end];
    tip[0] += index % 2 ? -0.25 : 0.25;
    tip[2] += index < 2 ? -0.2 : 0.2;
    addCylinderBetween(wood, end, tip, radius * 0.55, 6, PALETTE.rootDeep);
  }

  addCylinderBetween(wood, [1.93, 0.42, -1.1], [1.55, 2.5, -1.3], 0.065, 10, PALETTE.woodLight);
  addCylinderBetween(iron, [1.93, 0.38, -1.1], [2.03, 0.05, -1.04], 0.095, 10, PALETTE.iron);
  addBox(iron, [0.42, 0.48, 0.09], [2.09, 0.13, -1.01], PALETTE.ironDeep, [0, 0, -0.18], 0.045);
  // An open D grip reads as a shovel at game distance, unlike a solid disc.
  addCylinderBetween(iron, [1.55, 2.47, -1.3], [1.36, 2.77, -1.33], 0.045, 8, PALETTE.iron);
  addCylinderBetween(iron, [1.55, 2.47, -1.3], [1.7, 2.77, -1.33], 0.045, 8, PALETTE.iron);
  addCylinderBetween(wood, [1.36, 2.77, -1.33], [1.7, 2.77, -1.33], 0.055, 8, PALETTE.woodLight);
}

function addOpenHatch(hatchWood, hatchRarity) {
  const plankColors = [PALETTE.woodDeep, PALETTE.wood, PALETTE.woodLight, PALETTE.wood];
  for (let index = 0; index < 4; index++) {
    addBox(
      hatchWood,
      [0.69, 0.18, 1.82],
      [-1.035 + index * 0.69, 0.09, 0.92],
      plankColors[index],
      [0, 0, 0],
      0.035,
    );
  }
  // Broad, uneven grain survives the gameplay camera without a texture sampler.
  for (let index = 0; index < 12; index++) {
    const x = -1.25 + index * 0.22;
    const z = 0.42 + (index % 3) * 0.24;
    addBox(
      hatchWood,
      [0.016 + (index % 2) * 0.012, 0.009, 0.6],
      [x, -0.004, z],
      index % 2 ? PALETTE.wood : PALETTE.woodDeep,
      [0, Math.sin(index * 2) * 0.02, 0],
    );
  }
  for (const z of [0.2, 0.92, 1.64]) {
    addBox(hatchRarity, [2.9, 0.065, 0.14], [0, -0.035, z], PALETTE.rarityMetal, [0, 0, 0], 0.02);
    addBox(hatchRarity, [2.9, 0.09, 0.14], [0, 0.205, z], PALETTE.rarityMetal, [0, 0, 0], 0.025);
    for (const x of [-1.25, -0.42, 0.42, 1.25]) {
      addCylinder(hatchRarity, 0.055, 0.055, 0.055, 8, [x, 0.275, z], PALETTE.rarityMetal);
    }
  }
  for (const x of [-1.4, 1.4]) {
    addBox(hatchRarity, [0.12, 0.1, 1.9], [x, 0.21, 0.92], PALETTE.rarityMetal, [0, 0, 0], 0.025);
  }
  addBox(hatchRarity, [0.46, 0.1, 0.32], [0, 0.22, 1.3], PALETTE.rarityMetal, [0, 0, 0], 0.05);
}

function materialFor(definition) {
  return new THREE.MeshStandardMaterial({
    name: definition.name,
    color: 0xffffff,
    vertexColors: true,
    metalness: definition.metalness,
    roughness: definition.roughness,
  });
}

function meshFromBucket(name, bucket, material) {
  const geometry = mergeGeometries(bucket, false);
  if (!geometry) throw new Error(`failed to merge ${name} geometry`);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function stageAtLeast(stage, required) {
  return HOARD_ENTRANCE_STAGES.indexOf(stage) >= HOARD_ENTRANCE_STAGES.indexOf(required);
}

export function createHoardEntrance(stage = 'final') {
  if (!HOARD_ENTRANCE_STAGES.includes(stage)) throw new Error(`unknown hoard stage: ${stage}`);

  const earth = [];
  const fixedWood = [];
  const fixedIron = [];
  const hatchWood = [];
  const hatchRarity = [];
  addUnearthedPit(earth);
  if (stageAtLeast(stage, 'structural')) addDescendingLadderAndSteps(fixedWood);
  if (stageAtLeast(stage, 'form')) addRootsAndShovel(fixedWood, fixedIron);
  addOpenHatch(hatchWood, hatchRarity);

  const materials = {
    earth: materialFor(HOARD_MATERIAL_DEFINITIONS.earth),
    wood: materialFor(HOARD_MATERIAL_DEFINITIONS.wood),
    iron: materialFor(HOARD_MATERIAL_DEFINITIONS.iron),
    rarity: materialFor(HOARD_MATERIAL_DEFINITIONS.rarity),
  };
  const root = new THREE.Group();
  root.name = HOARD_ENTRANCE_CONTRACT.rootName;
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: HOARD_ENTRANCE_CONTRACT.id,
    stage,
    source: 'original-procedural-design-brief',
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...HOARD_ENTRANCE_CONTRACT.dimensions },
    terrainBurialDepth: HOARD_ENTRANCE_CONTRACT.terrainBurialDepth,
    serviceCues: [...HOARD_ENTRANCE_CONTRACT.serviceCues],
    interaction: {
      mode: 'walk-in-ground-entrance',
      interactive: true,
      authority: 'ground-object-entity',
    },
    collider: { shippingCollisionMesh: false },
    animation: {
      mode: 'runtime-hatch-pivot',
      pivotNode: 'HatchAssembly',
      closedRotationX: 0,
      openRotationX: HOARD_ENTRANCE_CONTRACT.hatchOpenRotationX,
    },
    destruction: { breakable: false, detachableParts: [] },
  };

  root.add(meshFromBucket('HoardEarthAndStone', earth, materials.earth));
  if (fixedWood.length) root.add(meshFromBucket('HoardFixedWood', fixedWood, materials.wood));
  if (fixedIron.length) root.add(meshFromBucket('HoardFixedIron', fixedIron, materials.iron));

  const hatch = new THREE.Group();
  hatch.name = 'HatchAssembly';
  hatch.position.set(0, 0.28, -0.95);
  hatch.rotation.x = HOARD_ENTRANCE_CONTRACT.hatchOpenRotationX;
  hatch.userData.hoardHatchPivot = {
    closedRotationX: 0,
    openRotationX: HOARD_ENTRANCE_CONTRACT.hatchOpenRotationX,
  };
  hatch.add(meshFromBucket('HoardHatchWood', hatchWood, materials.wood));
  hatch.add(meshFromBucket('HoardHatchRarityMetalwork', hatchRarity, materials.rarity));
  root.add(hatch);

  const sockets = {};
  for (const definition of HOARD_ENTRANCE_CONTRACT.sockets) {
    const socket = new THREE.Object3D();
    socket.name = definition.name;
    socket.position.fromArray(definition.position);
    socket.userData.sculptSocket = {
      id: definition.id,
      purpose: definition.purpose,
      interactive: definition.interactive,
    };
    root.add(socket);
    sockets[definition.id] = {
      nodeName: definition.name,
      position: [...definition.position],
      purpose: definition.purpose,
      interactive: definition.interactive,
    };
  }
  root.userData.sculptRuntime.sockets = sockets;
  root.updateMatrixWorld(true);
  const authoredBounds = new THREE.Box3().setFromObject(root);
  const floorOffset = -authoredBounds.min.y;
  const centerX = (authoredBounds.min.x + authoredBounds.max.x) / 2;
  const centerZ = (authoredBounds.min.z + authoredBounds.max.z) / 2;
  for (const child of root.children) {
    if (child.name.startsWith('Socket_')) continue;
    child.position.x -= centerX;
    child.position.y += floorOffset;
    child.position.z -= centerZ;
  }
  root.userData.sculptRuntime.floorOffset = floorOffset;
  root.updateMatrixWorld(true);
  return root;
}
