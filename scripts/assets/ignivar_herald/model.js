import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const IGNIVAR_CLIP_NAMES = Object.freeze([
  'Idle',
  'Walk',
  'Run',
  'Attack',
  'Cast',
  'Hit',
  'Death',
  'Flourish',
]);

export const IGNIVAR_NATIVE_BOUNDS = Object.freeze({
  width: 5.2,
  height: 6.32,
  depth: 2.25,
});

export const IGNIVAR_MATERIAL_CONTRACT = Object.freeze([
  Object.freeze({
    name: 'IgnivarCharredStone',
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.06,
    emissive: 0x000000,
    emissiveIntensity: 0,
  }),
  Object.freeze({
    name: 'IgnivarDarkIron',
    color: 0xffffff,
    roughness: 0.67,
    metalness: 0.52,
    emissive: 0x000000,
    emissiveIntensity: 0,
  }),
  Object.freeze({
    name: 'IgnivarBurntBronze',
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.58,
    emissive: 0x100300,
    emissiveIntensity: 0.12,
  }),
  Object.freeze({
    name: 'IgnivarFurnaceGlow',
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.04,
    emissive: 0xff3a04,
    emissiveIntensity: 5.2,
  }),
]);

export const IGNIVAR_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'Socket_ChestCore', position: [0, 3.48, 0.96] }),
  Object.freeze({ name: 'Socket_ShoulderLeft', position: [-1.5, 4.82, -0.08] }),
  Object.freeze({ name: 'Socket_ShoulderRight', position: [1.5, 4.82, -0.08] }),
]);

const MATERIAL_KEYS = Object.freeze({
  stone: 'IgnivarCharredStone',
  iron: 'IgnivarDarkIron',
  bronze: 'IgnivarBurntBronze',
  glow: 'IgnivarFurnaceGlow',
});

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function colorize(geometry, hex, variation = 0.1) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color(hex);
  for (let index = 0; index < position.count; index++) {
    const signal = Math.sin(
      position.getX(index) * 17.17 +
        position.getY(index) * 31.73 +
        position.getZ(index) * 47.11 +
        index * 0.37,
    );
    const factor = 1 + signal * variation;
    colors[index * 3] = Math.min(1, base.r * factor);
    colors[index * 3 + 1] = Math.min(1, base.g * factor);
    colors[index * 3 + 2] = Math.min(1, base.b * factor);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function addGeometry(bucket, geometry, position, rotation, scale, color, variation) {
  const compatible = geometry.index ? geometry.toNonIndexed() : geometry;
  compatible.deleteAttribute('uv');
  const copy = colorize(compatible, color, variation);
  copy.applyMatrix4(matrixFor(position, rotation, scale));
  bucket.push(copy);
}

function addBox(
  bucket,
  size,
  position,
  color,
  { rotation = [0, 0, 0], radius = 0.08, segments = 1, variation = 0.08 } = {},
) {
  addGeometry(
    bucket,
    new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius),
    position,
    rotation,
    [1, 1, 1],
    color,
    variation,
  );
}

function addCylinder(
  bucket,
  radiusTop,
  radiusBottom,
  height,
  position,
  color,
  { rotation = [0, 0, 0], radialSegments = 12, variation = 0.08 } = {},
) {
  addGeometry(
    bucket,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false),
    position,
    rotation,
    [1, 1, 1],
    color,
    variation,
  );
}

function addSphere(
  bucket,
  radius,
  position,
  color,
  { scale = [1, 1, 1], detail = 1, variation = 0.1 } = {},
) {
  addGeometry(
    bucket,
    new THREE.IcosahedronGeometry(radius, detail),
    position,
    [0, 0, 0],
    scale,
    color,
    variation,
  );
}

function addCone(
  bucket,
  radius,
  height,
  position,
  color,
  { rotation = [0, 0, 0], radialSegments = 8, scale = [1, 1, 1], variation = 0.08 } = {},
) {
  addGeometry(
    bucket,
    new THREE.ConeGeometry(radius, height, radialSegments, 1, false),
    position,
    rotation,
    scale,
    color,
    variation,
  );
}

function addTorus(
  bucket,
  radius,
  tube,
  position,
  color,
  { rotation = [0, 0, 0], scale = [1, 1, 1], variation = 0.06 } = {},
) {
  addGeometry(
    bucket,
    new THREE.TorusGeometry(radius, tube, 6, 16),
    position,
    rotation,
    scale,
    color,
    variation,
  );
}

function addDiamond(
  bucket,
  size,
  position,
  color,
  { rotation = [0, 0, 0], variation = 0.06 } = {},
) {
  addGeometry(
    bucket,
    new THREE.OctahedronGeometry(0.5, 0),
    position,
    rotation,
    size,
    color,
    variation,
  );
}

function emptyBuckets() {
  return { stone: [], iron: [], bronze: [], glow: [] };
}

function materialFor(contract) {
  const material = new THREE.MeshStandardMaterial({
    name: contract.name,
    color: contract.color,
    roughness: contract.roughness,
    metalness: contract.metalness,
    emissive: contract.emissive,
    emissiveIntensity: contract.emissiveIntensity,
    vertexColors: true,
  });
  material.name = contract.name;
  return material;
}

function animatedGlowMesh(geometry, material, name) {
  const compatible = geometry.index ? geometry.toNonIndexed() : geometry;
  compatible.deleteAttribute('uv');
  if (!compatible.getAttribute('color')) colorize(compatible, 0xffa142, 0.07);
  compatible.computeVertexNormals();
  const mesh = new THREE.Mesh(compatible, material);
  mesh.name = name;
  mesh.userData.shadowCaster = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function mergeBucket(bucket) {
  if (bucket.length === 0) return null;
  const merged = mergeGeometries(bucket, false);
  if (!merged) throw new Error('Ignivar geometry merge failed');
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function addBucketMeshes(parent, buckets, materials, prefix) {
  for (const key of Object.keys(buckets)) {
    const geometry = mergeBucket(buckets[key]);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, materials.get(MATERIAL_KEYS[key]));
    mesh.name = `${prefix}_${key}`;
    const shadowCaster = key !== 'glow';
    mesh.userData.shadowCaster = shadowCaster;
    mesh.castShadow = shadowCaster;
    mesh.receiveShadow = shadowCaster;
    parent.add(mesh);
  }
}

function flameClusterGeometry() {
  const pieces = [];
  addCone(pieces, 0.32, 1.05, [0, 0.48, 0], 0xff5f0d, {
    radialSegments: 8,
    scale: [1, 1, 0.82],
    variation: 0.03,
  });
  addCone(pieces, 0.2, 0.82, [-0.2, 0.35, 0.01], 0xff8c24, {
    rotation: [0, 0, 0.18],
    radialSegments: 7,
    variation: 0.025,
  });
  addCone(pieces, 0.17, 0.72, [0.2, 0.31, -0.01], 0xff7a18, {
    rotation: [0, 0, -0.2],
    radialSegments: 7,
    variation: 0.025,
  });
  addCone(pieces, 0.12, 0.68, [0, 0.32, 0.12], 0xffd28a, {
    radialSegments: 6,
    variation: 0.015,
  });
  return mergeBucket(pieces);
}

function buildLeg(leg, materials, prefix, sharedGeometries = null) {
  const stonePieces = [];
  const armorPieces = [];
  const trimPieces = [];
  const glowPieces = [];
  const stone = 0x3c3432;
  const stoneLight = 0x514641;
  const iron = 0x514a47;
  const ironLight = 0x6a605a;
  const bronze = 0x9e6234;
  const bronzeLight = 0xc07b42;
  const glow = 0xff6a12;
  if (!sharedGeometries) {
    addBox(armorPieces, [1.16, 0.42, 1.44], [0, -1.46, 0.14], iron, {
      radius: 0.11,
      segments: 2,
    });
    addBox(armorPieces, [1.24, 0.16, 1.5], [0, -1.65, 0.12], 0x352f2e, {
      radius: 0.045,
    });
    addSphere(stonePieces, 0.66, [0, -1.22, 0.42], stoneLight, {
      scale: [0.82, 0.5, 1.02],
      detail: 1,
    });
    addSphere(stonePieces, 0.46, [0, -0.72, 0], stone, {
      scale: [0.82, 1.12, 0.82],
      detail: 1,
    });
    addCylinder(armorPieces, 0.47, 0.53, 0.92, [0, -0.63, -0.02], ironLight, {
      radialSegments: 10,
    });
    addBox(armorPieces, [0.9, 0.45, 0.52], [0, -0.12, 0.31], iron, {
      rotation: [-0.12, 0, 0],
      radius: 0.1,
      segments: 2,
    });
    addDiamond(armorPieces, [0.72, 0.5, 0.22], [0, -0.05, 0.61], ironLight, {
      rotation: [0.1, 0, 0],
    });
    addBox(trimPieces, [1.12, 0.16, 1.04], [0, -1.12, 0.1], bronze, {
      radius: 0.045,
    });
    addBox(trimPieces, [0.98, 0.14, 0.92], [0, -0.28, 0.04], bronzeLight, {
      radius: 0.045,
    });
    addBox(trimPieces, [0.9, 0.14, 0.86], [0, 0.11, 0.01], bronze, {
      radius: 0.045,
    });
    for (const x of [-0.25, 0, 0.25]) {
      addBox(glowPieces, [0.1, 0.25, 0.08], [x, -1.42, 0.87], glow, {
        radius: 0.02,
      });
    }
    addBox(glowPieces, [0.48, 0.08, 0.08], [0, -0.6, 0.52], glow, { radius: 0.018 });
  }

  const geometries = sharedGeometries ?? {
    stone: mergeBucket(stonePieces),
    armor: mergeBucket(armorPieces),
    trim: mergeBucket(trimPieces),
    glow: mergeBucket(glowPieces),
  };
  const parts = [
    ['Stone', geometries.stone, MATERIAL_KEYS.stone, true],
    ['Armor', geometries.armor, MATERIAL_KEYS.iron, true],
    ['Trim', geometries.trim, MATERIAL_KEYS.bronze, true],
    ['Glow', geometries.glow, MATERIAL_KEYS.glow, false],
  ];
  for (const [suffix, geometry, materialKey, shadowCaster] of parts) {
    if (!geometry) throw new Error(`Ignivar leg ${suffix} geometry merge failed`);
    const mesh = new THREE.Mesh(geometry, materials.get(materialKey));
    mesh.name = `${prefix}${suffix}`;
    mesh.userData.shadowCaster = shadowCaster;
    mesh.castShadow = shadowCaster;
    mesh.receiveShadow = shadowCaster;
    leg.add(mesh);
  }
  return geometries;
}

function buildBlockoutBody(body) {
  const b = emptyBuckets();
  const stone = 0x211b1b;
  const stoneLight = 0x342a29;
  const iron = 0x383334;
  const ironLight = 0x514849;
  const bronze = 0x7d4b27;
  const bronzeLight = 0xa66a31;
  const glow = 0xff7814;
  const whiteHot = 0xffdda0;

  addBox(b.stone, [1.72, 0.72, 1.02], [0, 1.88, -0.02], stone, {
    radius: 0.18,
    segments: 3,
  });
  addBox(b.iron, [1.95, 0.26, 1.12], [0, 2.14, -0.03], iron, { radius: 0.08 });
  addBox(b.bronze, [0.26, 1.05, 0.18], [0, 1.8, 0.59], bronzeLight, {
    radius: 0.04,
  });
  addCone(b.bronze, 0.24, 0.42, [0, 1.18, 0.58], bronzeLight, {
    rotation: [Math.PI, 0, 0],
    radialSegments: 4,
  });

  addSphere(b.stone, 1.16, [0, 3.0, -0.08], stoneLight, {
    scale: [1.08, 1.16, 0.82],
    detail: 2,
  });
  addBox(b.iron, [2.12, 1.34, 0.56], [0, 3.2, -0.31], iron, {
    radius: 0.22,
    segments: 3,
  });
  addBox(b.iron, [0.62, 1.28, 0.18], [-0.72, 3.18, 0.34], ironLight, {
    rotation: [0, 0.2, 0.18],
    radius: 0.06,
  });
  addBox(b.iron, [0.62, 1.28, 0.18], [0.72, 3.18, 0.34], ironLight, {
    rotation: [0, -0.2, -0.18],
    radius: 0.06,
  });
  addTorus(b.bronze, 0.64, 0.11, [0, 3.35, 0.61], bronzeLight, {
    scale: [1, 1.12, 1],
  });
  addSphere(b.glow, 0.53, [0, 3.35, 0.57], glow, {
    scale: [1, 1.05, 0.34],
    detail: 2,
    variation: 0.04,
  });
  addSphere(b.glow, 0.26, [0, 3.38, 0.69], whiteHot, {
    scale: [1, 0.92, 0.28],
    detail: 2,
    variation: 0.02,
  });
  for (const x of [-0.34, -0.17, 0, 0.17, 0.34]) {
    addBox(b.bronze, [0.055, 0.82, 0.09], [x, 3.35, 0.78], bronzeLight, {
      radius: 0.016,
    });
  }

  for (const side of [-1, 1]) {
    const x = side * 1.25;
    addBox(b.iron, [1.25, 0.58, 1.04], [x, 3.78, -0.03], ironLight, {
      rotation: [0, 0, side * 0.13],
      radius: 0.16,
      segments: 3,
    });
    addBox(b.bronze, [1.12, 0.13, 0.96], [x, 4.02, -0.01], bronze, {
      rotation: [0, 0, side * 0.13],
      radius: 0.04,
    });
    addCylinder(b.iron, 0.32, 0.4, 0.72, [x, 4.34, -0.12], iron, {
      radialSegments: 10,
    });
    addCylinder(b.bronze, 0.38, 0.42, 0.13, [x, 4.67, -0.12], bronzeLight, {
      radialSegments: 12,
    });
    addCone(b.glow, 0.24, 0.78, [x, 5.08, -0.12], glow, {
      radialSegments: 7,
      scale: [0.88, 1, 0.88],
      variation: 0.03,
    });
    addCone(b.glow, 0.12, 0.52, [x, 5.22, -0.1], whiteHot, {
      radialSegments: 6,
      variation: 0.02,
    });
  }

  addSphere(b.stone, 0.54, [0, 4.24, 0.03], stoneLight, {
    scale: [0.88, 1, 0.78],
    detail: 2,
  });
  addBox(b.iron, [0.96, 0.36, 0.58], [0, 4.5, 0], iron, {
    radius: 0.11,
    segments: 3,
  });
  addBox(b.iron, [0.86, 0.3, 0.22], [0, 4.12, 0.36], ironLight, {
    radius: 0.08,
  });
  addBox(b.bronze, [0.98, 0.09, 0.18], [0, 3.97, 0.4], bronzeLight, {
    radius: 0.025,
  });
  addBox(b.glow, [0.19, 0.07, 0.08], [-0.18, 4.31, 0.43], whiteHot, {
    radius: 0.015,
  });
  addBox(b.glow, [0.19, 0.07, 0.08], [0.18, 4.31, 0.43], whiteHot, {
    radius: 0.015,
  });

  addCylinder(b.bronze, 0.5, 0.54, 0.19, [0, 4.68, 0], bronze, {
    radialSegments: 12,
  });
  for (const [x, height] of [
    [-0.33, 0.88],
    [0, 1.18],
    [0.33, 0.88],
  ]) {
    addBox(b.iron, [0.23, height, 0.28], [x, 4.77 + height * 0.44, 0], ironLight, {
      radius: 0.05,
      segments: 2,
    });
    addCone(b.glow, 0.105, 0.32, [x, 4.83 + height, 0], glow, {
      radialSegments: 6,
      variation: 0.02,
    });
  }

  addBucketMeshes(body, b, body.userData.materials, 'IgnivarBody');
}

function buildBody(body) {
  const b = emptyBuckets();
  const stone = 0x3d3532;
  const stoneLight = 0x554a45;
  const stoneDark = 0x292423;
  const iron = 0x514946;
  const ironLight = 0x6d625c;
  const ironDark = 0x332e2d;
  const bronze = 0x9b6033;
  const bronzeLight = 0xc47d42;
  const glow = 0xff6812;
  const hot = 0xffd18a;

  // Pelvis, abdomen, and broad furnace torso.
  addSphere(b.stone, 1.08, [0, 2.5, -0.05], stone, {
    scale: [1.08, 0.76, 0.82],
    detail: 1,
  });
  addBox(b.iron, [2.18, 0.62, 1.18], [0, 2.36, -0.02], iron, {
    radius: 0.16,
    segments: 2,
  });
  addBox(b.bronze, [2.34, 0.18, 1.23], [0, 2.62, -0.01], bronzeLight, {
    radius: 0.045,
  });
  addSphere(b.stone, 1.38, [0, 3.42, -0.08], stoneLight, {
    scale: [1.08, 0.96, 0.78],
    detail: 2,
    variation: 0.14,
  });
  addBox(b.iron, [2.52, 1.38, 0.62], [0, 3.46, -0.34], iron, {
    radius: 0.2,
    segments: 2,
  });
  addBox(b.iron, [0.48, 1.38, 0.22], [-0.88, 3.38, 0.4], ironLight, {
    rotation: [0, 0.08, 0.16],
    radius: 0.07,
  });
  addBox(b.iron, [0.48, 1.38, 0.22], [0.88, 3.38, 0.4], ironLight, {
    rotation: [0, -0.08, -0.16],
    radius: 0.07,
  });

  // Large open crucible: the dominant front-facing read in the approved sheet.
  addSphere(b.glow, 0.68, [0, 3.48, 0.69], glow, {
    scale: [1.12, 0.82, 0.38],
    detail: 2,
    variation: 0.035,
  });
  addSphere(b.glow, 0.36, [0, 3.49, 0.87], hot, {
    scale: [1.08, 0.82, 0.28],
    detail: 2,
    variation: 0.018,
  });
  addTorus(b.bronze, 0.76, 0.12, [0, 3.48, 0.72], bronzeLight, {
    scale: [1.12, 0.82, 1],
  });
  addBox(b.iron, [0.38, 1.14, 0.22], [-0.84, 3.52, 0.58], ironLight, {
    rotation: [0, 0.04, 0.32],
    radius: 0.065,
  });
  addBox(b.iron, [0.38, 1.14, 0.22], [0.84, 3.52, 0.58], ironLight, {
    rotation: [0, -0.04, -0.32],
    radius: 0.065,
  });
  addBox(b.bronze, [1.62, 0.16, 0.22], [0, 2.9, 0.61], bronze, {
    radius: 0.045,
  });
  for (const x of [-0.38, -0.19, 0, 0.19, 0.38]) {
    addBox(b.bronze, [0.06, 0.44, 0.09], [x, 3.25, 0.94], bronzeLight, {
      radius: 0.018,
    });
  }
  addDiamond(b.bronze, [0.34, 0.4, 0.16], [0, 4.17, 0.49], bronzeLight);
  addDiamond(b.iron, [0.18, 0.23, 0.17], [0, 4.17, 0.59], ironDark);

  // Layered pauldrons and real brazier bowls.
  for (const side of [-1, 1]) {
    const x = side * 1.5;
    addSphere(b.stone, 0.82, [x, 4.0, -0.02], stone, {
      scale: [1.06, 0.72, 0.9],
      detail: 1,
      variation: 0.13,
    });
    addBox(b.iron, [1.52, 0.56, 1.24], [x, 4.12, -0.02], iron, {
      rotation: [0, 0, side * 0.18],
      radius: 0.16,
      segments: 2,
    });
    addBox(b.iron, [1.34, 0.3, 1.36], [side * 1.62, 4.3, -0.03], ironLight, {
      rotation: [0, 0, side * 0.22],
      radius: 0.1,
      segments: 2,
    });
    addBox(b.bronze, [1.5, 0.13, 1.28], [x, 3.9, 0.01], bronze, {
      rotation: [0, 0, side * 0.18],
      radius: 0.04,
    });
    addBox(b.bronze, [1.28, 0.11, 1.39], [side * 1.62, 4.19, 0], bronzeLight, {
      rotation: [0, 0, side * 0.22],
      radius: 0.035,
    });
    addCylinder(b.iron, 0.43, 0.58, 0.34, [x, 4.62, -0.11], ironDark, {
      radialSegments: 12,
    });
    addCylinder(b.bronze, 0.51, 0.55, 0.13, [x, 4.78, -0.11], bronzeLight, {
      radialSegments: 12,
    });
    addTorus(b.bronze, 0.46, 0.055, [x, 4.81, -0.11], bronze, {
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 1, 0.88],
    });
    addBox(b.glow, [0.5, 0.08, 0.46], [x, 4.77, -0.08], glow, { radius: 0.02 });
  }

  // Basalt sovereign face, readable eyes, and exactly three crown prongs.
  addCylinder(b.stone, 0.42, 0.52, 0.48, [0, 4.42, -0.03], stoneDark, {
    radialSegments: 10,
  });
  addSphere(b.stone, 0.62, [0, 4.7, 0.05], stoneLight, {
    scale: [0.9, 1.08, 0.79],
    detail: 2,
    variation: 0.12,
  });
  addBox(b.iron, [1.02, 0.86, 0.48], [0, 4.68, 0.28], iron, {
    radius: 0.15,
    segments: 2,
  });
  addBox(b.iron, [0.42, 0.48, 0.2], [-0.31, 4.58, 0.54], ironLight, {
    rotation: [0, 0.05, -0.16],
    radius: 0.07,
  });
  addBox(b.iron, [0.42, 0.48, 0.2], [0.31, 4.58, 0.54], ironLight, {
    rotation: [0, -0.05, 0.16],
    radius: 0.07,
  });
  addBox(b.bronze, [0.15, 0.58, 0.15], [0, 4.68, 0.59], bronzeLight, {
    radius: 0.035,
  });
  addBox(b.iron, [0.68, 0.22, 0.22], [0, 4.38, 0.46], ironDark, {
    radius: 0.06,
  });
  addSphere(b.stone, 0.46, [0, 4.67, 0.55], stoneDark, {
    scale: [0.84, 0.96, 0.34],
    detail: 1,
    variation: 0.06,
  });
  addBox(b.iron, [0.3, 0.075, 0.09], [-0.2, 4.83, 0.72], ironLight, {
    rotation: [0, 0, -0.12],
    radius: 0.018,
  });
  addBox(b.iron, [0.3, 0.075, 0.09], [0.2, 4.83, 0.72], ironLight, {
    rotation: [0, 0, 0.12],
    radius: 0.018,
  });
  addBox(b.bronze, [1.04, 0.11, 0.23], [0, 4.96, 0.36], bronzeLight, {
    radius: 0.03,
  });
  addBox(b.glow, [0.2, 0.1, 0.1], [-0.2, 4.74, 0.75], hot, {
    radius: 0.018,
  });
  addBox(b.glow, [0.2, 0.1, 0.1], [0.2, 4.74, 0.75], hot, {
    radius: 0.018,
  });
  addBox(b.bronze, [0.12, 0.34, 0.11], [0, 4.63, 0.76], bronzeLight, {
    radius: 0.025,
  });
  addBox(b.iron, [0.43, 0.085, 0.1], [0, 4.47, 0.73], ironLight, {
    radius: 0.02,
  });
  addBox(b.stone, [0.54, 0.18, 0.16], [0, 4.37, 0.65], stoneLight, {
    radius: 0.045,
  });

  addCylinder(b.bronze, 0.58, 0.62, 0.22, [0, 5.08, 0.02], bronze, {
    radialSegments: 12,
  });
  for (const [x, height] of [
    [-0.4, 0.72],
    [0, 0.9],
    [0.4, 0.72],
  ]) {
    const centerY = 5.13 + height * 0.5;
    addBox(b.iron, [0.28, height, 0.34], [x, centerY, 0.02], ironLight, {
      radius: 0.065,
      segments: 2,
    });
    addBox(b.bronze, [0.075, height * 0.82, 0.08], [x, centerY, 0.22], bronzeLight, {
      radius: 0.018,
    });
    addCone(b.glow, 0.15, 0.3, [x, 5.27 + height, 0.02], hot, {
      radialSegments: 7,
      variation: 0.018,
    });
  }
  addDiamond(b.bronze, [0.34, 0.44, 0.16], [0, 5.08, 0.35], bronzeLight);

  // Belt, side skirts, and the long framed forge tabard.
  addBox(b.iron, [2.3, 0.34, 1.16], [0, 2.22, -0.01], ironDark, {
    radius: 0.1,
  });
  addBox(b.bronze, [2.4, 0.16, 1.2], [0, 2.32, 0], bronzeLight, {
    radius: 0.04,
  });
  addDiamond(b.bronze, [0.44, 0.48, 0.2], [0, 2.32, 0.65], bronzeLight);
  addBox(b.iron, [0.86, 1.18, 0.24], [0, 1.65, 0.58], iron, {
    radius: 0.08,
  });
  addBox(b.bronze, [1.02, 0.13, 0.29], [0, 2.1, 0.61], bronzeLight, {
    radius: 0.035,
  });
  addBox(b.bronze, [0.1, 1.06, 0.1], [-0.43, 1.68, 0.73], bronze, {
    radius: 0.025,
  });
  addBox(b.bronze, [0.1, 1.06, 0.1], [0.43, 1.68, 0.73], bronze, {
    radius: 0.025,
  });
  addDiamond(b.bronze, [0.82, 0.56, 0.18], [0, 1.12, 0.67], bronzeLight);
  addDiamond(b.bronze, [0.3, 0.42, 0.16], [0, 1.68, 0.75], bronze);
  for (const side of [-1, 1]) {
    addBox(b.iron, [0.72, 0.92, 0.48], [side * 0.83, 1.91, 0.16], iron, {
      rotation: [0, 0, side * 0.12],
      radius: 0.09,
    });
    addBox(b.bronze, [0.7, 0.12, 0.5], [side * 0.83, 2.24, 0.17], bronze, {
      rotation: [0, 0, side * 0.12],
      radius: 0.035,
    });
  }

  // Rear furnace grate and a few engineered magma seams on the torso.
  addSphere(b.glow, 0.62, [0, 3.46, -0.72], glow, {
    scale: [1.05, 0.92, 0.3],
    detail: 1,
    variation: 0.025,
  });
  addTorus(b.bronze, 0.68, 0.11, [0, 3.46, -0.76], bronzeLight, {
    scale: [1.08, 0.95, 1],
  });
  for (const x of [-0.34, -0.17, 0, 0.17, 0.34]) {
    addBox(b.iron, [0.075, 0.78, 0.1], [x, 3.46, -0.96], ironDark, {
      radius: 0.02,
    });
  }
  for (const [x, y, rotation] of [
    [-1.03, 3.22, -0.45],
    [1.03, 3.15, 0.5],
    [-0.92, 3.72, 0.36],
    [0.95, 3.8, -0.34],
  ]) {
    addBox(b.glow, [0.08, 0.42, 0.07], [x, y, 0.69], glow, {
      rotation: [0, 0, rotation],
      radius: 0.018,
    });
  }

  addBucketMeshes(body, b, body.userData.materials, 'IgnivarRoyalBody');
}

function buildBlockoutForgeArm(pivot) {
  const b = emptyBuckets();
  addSphere(b.stone, 0.55, [0, -0.35, 0], 0x2c2423, {
    scale: [1.05, 1.25, 1],
    detail: 1,
  });
  addCylinder(b.iron, 0.54, 0.64, 1.08, [0, -0.78, 0], 0x484041, {
    radialSegments: 10,
  });
  addBox(b.bronze, [1.04, 0.15, 0.88], [0, -0.48, 0], 0x92592b, {
    radius: 0.05,
  });
  addBox(b.iron, [1.08, 1.2, 1.02], [0, -1.65, 0.08], 0x3d3637, {
    radius: 0.17,
    segments: 3,
  });
  addBox(b.bronze, [1.15, 0.18, 1.08], [0, -1.18, 0.08], 0x9d622f, {
    radius: 0.05,
  });
  addBox(b.bronze, [1.15, 0.18, 1.08], [0, -2.06, 0.08], 0x7d4b27, {
    radius: 0.05,
  });
  addBox(b.iron, [1.32, 0.62, 1.22], [0, -2.36, 0.2], 0x514849, {
    radius: 0.16,
    segments: 3,
  });
  for (const x of [-0.42, -0.14, 0.14, 0.42]) {
    addBox(b.iron, [0.24, 0.42, 0.58], [x, -2.7, 0.36], 0x302b2c, {
      rotation: [0.12, 0, 0],
      radius: 0.07,
    });
  }
  addBox(b.glow, [0.48, 0.11, 0.12], [0, -1.64, 0.62], 0xff7814, {
    radius: 0.02,
  });
  addBucketMeshes(pivot, b, pivot.userData.materials, 'IgnivarForgeArm');
}

function buildForgeArm(pivot) {
  const assembly = new THREE.Group();
  assembly.name = 'IgnivarForgeGauntlet';
  assembly.userData.visualSystem = 'oversized-plated-forge-gauntlet';
  pivot.add(assembly);

  const b = emptyBuckets();
  const stone = 0x3b3432;
  const stoneLight = 0x514742;
  const iron = 0x514946;
  const ironLight = 0x6c615b;
  const ironDark = 0x322d2c;
  const bronze = 0x9b6033;
  const bronzeLight = 0xbf7940;

  addSphere(b.stone, 0.7, [0, -0.38, 0], stoneLight, {
    scale: [1.04, 1.16, 1],
    detail: 1,
    variation: 0.13,
  });
  addCylinder(b.iron, 0.61, 0.7, 1.2, [0, -0.94, 0.02], iron, {
    radialSegments: 10,
  });
  addBox(b.iron, [1.28, 1.42, 1.16], [0, -1.58, 0.08], ironLight, {
    radius: 0.2,
    segments: 2,
  });
  addBox(b.iron, [1.12, 0.56, 1.24], [0, -0.75, 0.02], ironDark, {
    radius: 0.13,
    segments: 2,
  });
  addBox(b.bronze, [1.3, 0.18, 1.18], [0, -0.62, 0.03], bronzeLight, {
    radius: 0.05,
  });
  addBox(b.bronze, [1.38, 0.19, 1.24], [0, -1.12, 0.08], bronze, {
    radius: 0.05,
  });
  addBox(b.bronze, [1.42, 0.2, 1.28], [0, -2.08, 0.11], bronzeLight, {
    radius: 0.05,
  });
  addBox(b.iron, [1.62, 0.74, 1.46], [0, -2.48, 0.2], iron, {
    radius: 0.19,
    segments: 2,
  });
  addBox(b.stone, [1.34, 0.5, 1.22], [0, -2.56, 0.27], stone, {
    radius: 0.16,
    segments: 2,
  });
  for (const x of [-0.54, -0.18, 0.18, 0.54]) {
    addBox(b.iron, [0.3, 0.48, 0.7], [x, -2.91, 0.48], ironDark, {
      rotation: [0.16, 0, 0],
      radius: 0.08,
    });
    addBox(b.bronze, [0.25, 0.1, 0.72], [x, -2.72, 0.51], bronze, {
      rotation: [0.16, 0, 0],
      radius: 0.025,
    });
  }
  addBox(b.iron, [0.34, 0.88, 1.25], [-0.79, -2.34, 0.15], ironLight, {
    rotation: [0, 0, -0.14],
    radius: 0.1,
  });
  addDiamond(b.bronze, [0.42, 0.5, 0.18], [0, -1.57, 0.72], bronzeLight);
  for (const x of [-0.31, -0.1, 0.1, 0.31]) {
    addBox(b.glow, [0.11, 0.32, 0.08], [x, -2.48, 0.96], 0xff7318, {
      radius: 0.02,
    });
  }
  addBucketMeshes(assembly, b, pivot.userData.materials, 'IgnivarForgeGauntlet');
}

function buildBlockoutMagmaArm(pivot) {
  const b = emptyBuckets();
  addSphere(b.stone, 0.58, [0, -0.36, 0], 0x2e2524, {
    scale: [1, 1.25, 1],
    detail: 1,
  });
  addCylinder(b.stone, 0.43, 0.5, 1.08, [0, -0.88, 0], 0x302625, {
    radialSegments: 9,
  });
  addCylinder(b.stone, 0.36, 0.43, 1.05, [0, -1.82, 0.04], 0x261f1f, {
    radialSegments: 9,
  });
  for (const y of [-0.58, -0.92, -1.28, -1.62, -1.96]) {
    const phase = Math.round(Math.abs(y) * 10) % 2;
    addTorus(b.glow, 0.37 + phase * 0.035, 0.045, [0, y, 0.02], 0xff5b0a, {
      rotation: [Math.PI / 2, 0, 0],
      scale: [1, 1, 0.82],
      variation: 0.03,
    });
  }
  addSphere(b.stone, 0.48, [0, -2.38, 0.12], 0x2b2322, {
    scale: [1.05, 0.82, 1.12],
    detail: 1,
  });
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    addCylinder(b.stone, 0.085, 0.105, 0.58, [x, -2.72, 0.22], 0x302625, {
      rotation: [0.28, 0, 0],
      radialSegments: 7,
    });
    addCone(b.glow, 0.07, 0.25, [x, -3.04, 0.31], 0xff8e22, {
      rotation: [0.28, 0, Math.PI],
      radialSegments: 6,
      variation: 0.02,
    });
  }
  addBox(b.bronze, [0.96, 0.15, 0.84], [0, -0.5, 0], 0x8f562a, {
    radius: 0.05,
  });
  addBucketMeshes(pivot, b, pivot.userData.materials, 'IgnivarMagmaArm');
}

function buildMagmaArm(pivot) {
  const assembly = new THREE.Group();
  assembly.name = 'IgnivarMagmaCore';
  assembly.userData.visualSystem = 'separated-basalt-over-molten-core';
  pivot.add(assembly);

  const b = emptyBuckets();
  const stone = 0x332c2a;
  const stoneLight = 0x50443f;
  const bronze = 0x995d31;
  const bronzeLight = 0xbd773e;
  const glow = 0xff5d0b;
  const hot = 0xffc56c;

  // A continuous molten interior remains visible through deliberate gaps.
  addCylinder(b.glow, 0.49, 0.42, 2.18, [0, -1.2, 0.02], glow, {
    radialSegments: 10,
  });
  addSphere(b.glow, 0.56, [0, -2.43, 0.12], hot, {
    scale: [1.02, 0.78, 1.08],
    detail: 1,
    variation: 0.02,
  });

  const chunks = [
    [0.02, -0.32, 0.01, 0.66, 0.56, 0.66],
    [-0.08, -0.78, 0.06, 0.56, 0.43, 0.58],
    [0.08, -1.18, -0.02, 0.53, 0.38, 0.56],
    [-0.06, -1.58, 0.08, 0.49, 0.36, 0.52],
    [0.07, -1.94, 0.01, 0.46, 0.34, 0.5],
  ];
  for (let index = 0; index < chunks.length; index++) {
    const [x, y, z, sx, sy, sz] = chunks[index];
    addSphere(b.stone, 0.72, [x, y, z], index % 2 === 0 ? stoneLight : stone, {
      scale: [sx / 0.72, sy / 0.72, sz / 0.72],
      detail: 1,
      variation: 0.16,
    });
  }
  addBox(b.bronze, [1.24, 0.18, 1.08], [0, -0.52, 0], bronzeLight, {
    radius: 0.055,
  });
  addBox(b.bronze, [1.08, 0.14, 0.96], [0, -1.48, 0.05], bronze, {
    rotation: [0, 0, 0.08],
    radius: 0.045,
  });
  for (const [x, y, rotation] of [
    [-0.27, -0.35, -0.48],
    [0.25, -0.72, 0.56],
    [-0.22, -1.08, 0.44],
    [0.22, -1.42, -0.5],
    [-0.18, -1.76, -0.42],
    [0.2, -2.02, 0.48],
  ]) {
    addBox(b.glow, [0.075, 0.42, 0.075], [x, y, 0.49], glow, {
      rotation: [0, 0, rotation],
      radius: 0.017,
    });
  }

  addSphere(b.stone, 0.57, [0, -2.42, 0.12], stoneLight, {
    scale: [1.05, 0.72, 1.05],
    detail: 1,
    variation: 0.16,
  });
  addBox(b.glow, [0.08, 0.72, 0.08], [-0.17, -2.45, 0.6], hot, {
    rotation: [0, 0, -0.48],
    radius: 0.018,
  });
  addBox(b.glow, [0.08, 0.68, 0.08], [0.18, -2.42, 0.61], glow, {
    rotation: [0, 0, 0.52],
    radius: 0.018,
  });
  for (const x of [-0.32, -0.11, 0.11, 0.32]) {
    addCylinder(b.glow, 0.1, 0.075, 0.68, [x, -2.83, 0.27], hot, {
      rotation: [0.3, 0, 0],
      radialSegments: 7,
      variation: 0.02,
    });
    addCylinder(b.stone, 0.115, 0.095, 0.43, [x, -2.75, 0.23], stone, {
      rotation: [0.3, 0, 0],
      radialSegments: 7,
      variation: 0.14,
    });
    addCone(b.glow, 0.09, 0.28, [x, -3.18, 0.38], hot, {
      rotation: [0.3, 0, Math.PI],
      radialSegments: 7,
      variation: 0.015,
    });
  }

  addBucketMeshes(assembly, b, pivot.userData.materials, 'IgnivarMagmaCore');
}

function quaternionValues(eulers) {
  const values = [];
  for (const euler of eulers) {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  return values;
}

function quaternionTrack(name, times, eulers) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quaternionValues(eulers));
}

function createAnimations(
  body,
  forgeArm,
  magmaArm,
  leftLeg,
  rightLeg,
  corePulse,
  leftFlame,
  rightFlame,
) {
  const idleTimes = [0, 0.75, 1.5, 2.25, 3];
  const clips = [
    new THREE.AnimationClip('Idle', 3, [
      new THREE.VectorKeyframeTrack(
        `${body.name}.position`,
        idleTimes,
        [0, 0, 0, 0, 0.035, 0, 0, 0, 0, 0, -0.02, 0, 0, 0, 0],
      ),
      quaternionTrack(forgeArm.name, idleTimes, [
        [0, 0, -0.04],
        [0.025, 0, -0.02],
        [0, 0, -0.04],
        [-0.02, 0, -0.06],
        [0, 0, -0.04],
      ]),
      quaternionTrack(magmaArm.name, idleTimes, [
        [0, 0, 0.04],
        [-0.025, 0, 0.02],
        [0, 0, 0.04],
        [0.02, 0, 0.06],
        [0, 0, 0.04],
      ]),
      new THREE.VectorKeyframeTrack(
        `${corePulse.name}.scale`,
        idleTimes,
        [1, 1, 1, 1.08, 1.08, 1.08, 1, 1, 1, 0.95, 0.95, 0.95, 1, 1, 1],
      ),
    ]),
  ];

  const walkTimes = [0, 0.35, 0.7, 1.05, 1.4];
  clips.push(
    new THREE.AnimationClip('Walk', 1.4, [
      new THREE.VectorKeyframeTrack(
        `${body.name}.position`,
        walkTimes,
        [0, 0, 0, 0, 0.075, 0.025, 0, 0, 0, 0, 0.075, -0.025, 0, 0, 0],
      ),
      quaternionTrack(forgeArm.name, walkTimes, [
        [0.12, 0, -0.04],
        [-0.1, 0, -0.04],
        [0.12, 0, -0.04],
        [-0.1, 0, -0.04],
        [0.12, 0, -0.04],
      ]),
      quaternionTrack(magmaArm.name, walkTimes, [
        [-0.11, 0, 0.04],
        [0.1, 0, 0.04],
        [-0.11, 0, 0.04],
        [0.1, 0, 0.04],
        [-0.11, 0, 0.04],
      ]),
      quaternionTrack(leftLeg.name, walkTimes, [
        [0.2, 0, 0],
        [-0.18, 0, 0],
        [0.2, 0, 0],
        [-0.18, 0, 0],
        [0.2, 0, 0],
      ]),
      quaternionTrack(rightLeg.name, walkTimes, [
        [-0.18, 0, 0],
        [0.2, 0, 0],
        [-0.18, 0, 0],
        [0.2, 0, 0],
        [-0.18, 0, 0],
      ]),
    ]),
  );

  const runTimes = [0, 0.2, 0.4, 0.6, 0.8];
  clips.push(
    new THREE.AnimationClip('Run', 0.8, [
      new THREE.VectorKeyframeTrack(
        `${body.name}.position`,
        runTimes,
        [0, 0, 0, 0, 0.11, 0.05, 0, 0.015, 0, 0, 0.11, -0.05, 0, 0, 0],
      ),
      quaternionTrack(forgeArm.name, runTimes, [
        [0.2, 0, -0.04],
        [-0.18, 0, -0.04],
        [0.2, 0, -0.04],
        [-0.18, 0, -0.04],
        [0.2, 0, -0.04],
      ]),
      quaternionTrack(magmaArm.name, runTimes, [
        [-0.18, 0, 0.04],
        [0.17, 0, 0.04],
        [-0.18, 0, 0.04],
        [0.17, 0, 0.04],
        [-0.18, 0, 0.04],
      ]),
      quaternionTrack(leftLeg.name, runTimes, [
        [0.34, 0, 0],
        [-0.3, 0, 0],
        [0.34, 0, 0],
        [-0.3, 0, 0],
        [0.34, 0, 0],
      ]),
      quaternionTrack(rightLeg.name, runTimes, [
        [-0.3, 0, 0],
        [0.34, 0, 0],
        [-0.3, 0, 0],
        [0.34, 0, 0],
        [-0.3, 0, 0],
      ]),
    ]),
  );

  const attackTimes = [0, 0.32, 0.62, 0.9, 1.25];
  clips.push(
    new THREE.AnimationClip('Attack', 1.25, [
      quaternionTrack(forgeArm.name, attackTimes, [
        [0, 0, -0.04],
        [-1.35, 0.18, -0.18],
        [0.72, -0.12, -0.05],
        [0.42, 0, -0.04],
        [0, 0, -0.04],
      ]),
      quaternionTrack(body.name, attackTimes, [
        [0, 0, 0],
        [-0.08, 0.1, 0.04],
        [0.13, -0.08, -0.05],
        [0.05, 0, 0],
        [0, 0, 0],
      ]),
    ]),
  );

  const castTimes = [0, 0.55, 1.1, 1.65, 2.2];
  clips.push(
    new THREE.AnimationClip('Cast', 2.2, [
      quaternionTrack(forgeArm.name, castTimes, [
        [0, 0, -0.04],
        [-0.42, 0, -0.72],
        [-0.56, 0, -0.86],
        [-0.42, 0, -0.72],
        [0, 0, -0.04],
      ]),
      quaternionTrack(magmaArm.name, castTimes, [
        [0, 0, 0.04],
        [-0.42, 0, 0.72],
        [-0.56, 0, 0.86],
        [-0.42, 0, 0.72],
        [0, 0, 0.04],
      ]),
      new THREE.VectorKeyframeTrack(
        `${corePulse.name}.scale`,
        castTimes,
        [1, 1, 1, 1.25, 1.25, 1.25, 1.5, 1.5, 1.5, 1.25, 1.25, 1.25, 1, 1, 1],
      ),
      new THREE.VectorKeyframeTrack(
        `${leftFlame.name}.scale`,
        castTimes,
        [1, 1, 1, 1, 1.35, 1, 1.1, 1.65, 1.1, 1, 1.35, 1, 1, 1, 1],
      ),
      new THREE.VectorKeyframeTrack(
        `${rightFlame.name}.scale`,
        castTimes,
        [1, 1, 1, 1, 1.35, 1, 1.1, 1.65, 1.1, 1, 1.35, 1, 1, 1, 1],
      ),
    ]),
  );

  const hitTimes = [0, 0.12, 0.32, 0.55];
  clips.push(
    new THREE.AnimationClip('Hit', 0.55, [
      quaternionTrack(body.name, hitTimes, [
        [0, 0, 0],
        [-0.12, 0, -0.12],
        [0.05, 0, 0.05],
        [0, 0, 0],
      ]),
    ]),
  );

  const deathTimes = [0, 0.45, 1.15, 2.1];
  clips.push(
    new THREE.AnimationClip('Death', 2.1, [
      new THREE.VectorKeyframeTrack(
        `${body.name}.position`,
        deathTimes,
        [0, 0, 0, 0, -0.12, 0.08, 0, -0.72, 0.5, 0, -1.45, 0.82],
      ),
      quaternionTrack(body.name, deathTimes, [
        [0, 0, 0],
        [0.14, 0, -0.06],
        [0.72, 0, -0.12],
        [1.38, 0, -0.14],
      ]),
      quaternionTrack(forgeArm.name, deathTimes, [
        [0, 0, -0.04],
        [-0.4, 0, -0.25],
        [-0.8, 0, -0.45],
        [-0.95, 0, -0.55],
      ]),
      quaternionTrack(magmaArm.name, deathTimes, [
        [0, 0, 0.04],
        [0.35, 0, 0.2],
        [0.68, 0, 0.4],
        [0.82, 0, 0.5],
      ]),
    ]),
  );

  const flourishTimes = [0, 0.5, 1.1, 1.65, 2.1];
  clips.push(
    new THREE.AnimationClip('Flourish', 2.1, [
      quaternionTrack(forgeArm.name, flourishTimes, [
        [0, 0, -0.04],
        [-0.78, 0, -0.82],
        [-1.02, 0, -1.02],
        [-0.78, 0, -0.82],
        [0, 0, -0.04],
      ]),
      quaternionTrack(magmaArm.name, flourishTimes, [
        [0, 0, 0.04],
        [-0.78, 0, 0.82],
        [-1.02, 0, 1.02],
        [-0.78, 0, 0.82],
        [0, 0, 0.04],
      ]),
      new THREE.VectorKeyframeTrack(
        `${corePulse.name}.scale`,
        flourishTimes,
        [1, 1, 1, 1.35, 1.35, 1.35, 1.65, 1.65, 1.65, 1.35, 1.35, 1.35, 1, 1, 1],
      ),
    ]),
  );
  return clips;
}

export function createIgnivarHerald({ sourceFingerprint = null } = {}) {
  const root = new THREE.Group();
  root.name = 'IgnivarHerald';
  root.userData = {
    assetId: 'ignivar_herald',
    assetType: 'animated-raid-boss',
    designRevision: 'approved-turnaround-v2',
    frontAxis: [0, 0, 1],
    sourceFingerprint,
    nativeBounds: IGNIVAR_NATIVE_BOUNDS,
    clips: IGNIVAR_CLIP_NAMES,
  };

  const materials = new Map(
    IGNIVAR_MATERIAL_CONTRACT.map((contract) => [contract.name, materialFor(contract)]),
  );
  const body = new THREE.Group();
  body.name = 'ForgeBodyPivot';
  body.userData.materials = materials;
  root.add(body);
  buildBody(body);
  for (const [name, position, visualSystem] of [
    ['IgnivarFaceAssembly', [0, 4.7, 0.28], 'basalt-sovereign-face'],
    ['IgnivarCrownAssembly', [0, 5.35, 0.02], 'three-prong-forge-crown'],
    ['IgnivarChestCrucible', [0, 3.48, 0.72], 'open-white-hot-crucible'],
    ['IgnivarShoulderBrazierLeft', [-1.5, 4.72, -0.1], 'layered-brazier-left'],
    ['IgnivarShoulderBrazierRight', [1.5, 4.72, -0.1], 'layered-brazier-right'],
    ['IgnivarWaistTabard', [0, 1.7, 0.66], 'framed-forge-tabard'],
    ['IgnivarBackFurnace', [0, 3.46, -0.78], 'barred-rear-furnace'],
  ]) {
    const anchor = new THREE.Object3D();
    anchor.name = name;
    anchor.position.fromArray(position);
    anchor.userData = { visualSystem };
    body.add(anchor);
  }

  const leftLeg = new THREE.Group();
  leftLeg.name = 'LeftLegPivot';
  leftLeg.position.set(-0.72, 1.72, 0);
  leftLeg.userData.materials = materials;
  body.add(leftLeg);
  const legGeometries = buildLeg(leftLeg, materials, 'IgnivarLeftLeg');

  const rightLeg = new THREE.Group();
  rightLeg.name = 'RightLegPivot';
  rightLeg.position.set(0.72, 1.72, 0);
  rightLeg.userData.materials = materials;
  body.add(rightLeg);
  buildLeg(rightLeg, materials, 'IgnivarRightLeg', legGeometries);

  const forgeArm = new THREE.Group();
  forgeArm.name = 'ForgeArmPivot';
  forgeArm.position.set(-1.82, 4.02, 0);
  forgeArm.rotation.z = -0.04;
  forgeArm.userData.materials = materials;
  body.add(forgeArm);
  buildForgeArm(forgeArm);

  const magmaArm = new THREE.Group();
  magmaArm.name = 'MagmaArmPivot';
  magmaArm.position.set(1.82, 4.02, 0);
  magmaArm.rotation.z = 0.04;
  magmaArm.userData.materials = materials;
  body.add(magmaArm);
  buildMagmaArm(magmaArm);

  const corePulse = new THREE.Object3D();
  corePulse.name = 'FurnaceCorePulse';
  corePulse.position.set(0, 3.48, 0.92);
  body.add(corePulse);
  const animatedCore = animatedGlowMesh(
    new THREE.IcosahedronGeometry(0.58, 2),
    materials.get(MATERIAL_KEYS.glow),
    'IgnivarAnimatedFurnaceCore',
  );
  animatedCore.scale.set(1.18, 0.9, 0.22);
  corePulse.add(animatedCore);

  const leftFlame = new THREE.Object3D();
  leftFlame.name = 'ShoulderFlameLeft';
  leftFlame.position.set(-1.5, 4.79, -0.1);
  body.add(leftFlame);
  const shoulderFlameGeometry = flameClusterGeometry();
  const animatedLeftFlame = animatedGlowMesh(
    shoulderFlameGeometry,
    materials.get(MATERIAL_KEYS.glow),
    'IgnivarAnimatedShoulderFlameLeft',
  );
  leftFlame.add(animatedLeftFlame);
  const rightFlame = new THREE.Object3D();
  rightFlame.name = 'ShoulderFlameRight';
  rightFlame.position.set(1.5, 4.79, -0.1);
  body.add(rightFlame);
  const animatedRightFlame = animatedGlowMesh(
    shoulderFlameGeometry,
    materials.get(MATERIAL_KEYS.glow),
    'IgnivarAnimatedShoulderFlameRight',
  );
  rightFlame.add(animatedRightFlame);

  for (const definition of IGNIVAR_SOCKET_DEFINITIONS) {
    const socket = new THREE.Object3D();
    socket.name = definition.name;
    socket.position.fromArray(definition.position);
    socket.userData = { socketType: 'vfx-emitter' };
    body.add(socket);
  }

  root.traverse((object) => {
    if (object.isMesh) object.frustumCulled = true;
  });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);

  return {
    root,
    animations: createAnimations(
      body,
      forgeArm,
      magmaArm,
      leftLeg,
      rightLeg,
      corePulse,
      leftFlame,
      rightFlame,
    ),
  };
}
