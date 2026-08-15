import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ARMOURY_STAGES = [
  'blockout',
  'structural',
  'form',
  'material',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'final',
];
export const ARMOURY_UNLOCKED_STAGE = 'final';

export const ARMOURY_NATIVE_BOUNDS = Object.freeze({
  width: 13,
  height: 16.35,
  depth: 9,
  foundationDepth: 1.35,
});

export const ARMOURY_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'frontEntry',
    nodeName: 'Socket_FrontEntry',
    position: Object.freeze([0, 2.25, 3.18]),
    forward: Object.freeze([0, 0, 1]),
    purpose: 'closed-entry-reference',
  }),
  Object.freeze({
    id: 'rearService',
    nodeName: 'Socket_RearService',
    position: Object.freeze([0, 1.35, -4.5]),
    forward: Object.freeze([0, 0, -1]),
    purpose: 'closed-service-reference',
  }),
  Object.freeze({
    id: 'crestMount',
    nodeName: 'Socket_CrestMount',
    position: Object.freeze([0, 6.35, 4.45]),
    forward: Object.freeze([0, 0, 1]),
    purpose: 'crest-mount-reference',
  }),
]);

export const ARMOURY_INTERACTION_CONTRACT = Object.freeze({
  mode: 'static-closed-landmark',
  rootPivot: Object.freeze({
    nodeName: 'EastbrookGrandArmoury',
    floorCenter: Object.freeze([0, 0, 0]),
    rotationEuler: Object.freeze([0, 0, 0]),
    scale: Object.freeze([1, 1, 1]),
  }),
  collider: Object.freeze({
    type: 'obb',
    center: Object.freeze([0, ARMOURY_NATIVE_BOUNDS.height / 2, 0]),
    size: Object.freeze([
      ARMOURY_NATIVE_BOUNDS.width,
      ARMOURY_NATIVE_BOUNDS.height,
      ARMOURY_NATIVE_BOUNDS.depth,
    ]),
    halfExtents: Object.freeze([
      ARMOURY_NATIVE_BOUNDS.width / 2,
      ARMOURY_NATIVE_BOUNDS.height / 2,
      ARMOURY_NATIVE_BOUNDS.depth / 2,
    ]),
    rotationQuaternion: Object.freeze([0, 0, 0, 1]),
    shippingCollisionMesh: false,
  }),
  expectations: Object.freeze({
    interior: 'not-explorable',
    doors: 'closed-noninteractive',
    noticeboard: 'decorative-noninteractive',
    armouryDisplay: 'decorative-noninteractive',
  }),
  destruction: Object.freeze({
    breakable: false,
    fractureGroup: null,
    detachableParts: Object.freeze([]),
  }),
});

const PALETTE = Object.freeze({
  stoneDeep: 0x46505e,
  stone: 0x768190,
  stoneLight: 0x929ba6,
  timberDark: 0x392216,
  timber: 0x684027,
  cobaltDark: 0x102658,
  cobalt: 0x1b4d98,
  cobaltLight: 0x3577c4,
  iron: 0x515d6b,
  gold: 0xc6973f,
  parchment: 0xd9c79f,
  warm: 0xffb14f,
  arcane: 0x70dcff,
  stoneWeather: 0x5f6873,
  timberWeather: 0x4a2e20,
  cobaltCourse: 0x173b70,
  goldHighlight: 0xd0aa56,
  patina: 0x46706c,
});

const MATERIAL_PALETTE = Object.freeze({
  stoneDeep: 0x625a50,
  stone: 0x877b6c,
  stoneLight: 0xad9f8b,
  timberDark: 0x3b241a,
  timber: 0x64402a,
  cobaltDark: 0x0b214d,
  cobalt: 0x164785,
  cobaltLight: 0x2a68aa,
  iron: 0x4c5964,
  gold: 0xb48335,
  parchment: 0xd2b982,
  warm: 0xffad54,
  arcane: 0x55d6f4,
  stoneWeather: 0x70675d,
  timberWeather: 0x4a2d20,
  cobaltCourse: 0x1b4d82,
  goldHighlight: 0xc99a44,
  patina: 0x416c68,
});

export const ARMOURY_TIER1_AUDIT_ALBEDOS = Object.freeze({
  stone: MATERIAL_PALETTE.stone,
  cobalt: MATERIAL_PALETTE.cobalt,
  timber: MATERIAL_PALETTE.timber,
  arcane: MATERIAL_PALETTE.arcane,
  gold: MATERIAL_PALETTE.gold,
  warm: MATERIAL_PALETTE.warm,
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
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = tint.r;
    colors[i + 1] = tint.g;
    colors[i + 2] = tint.b;
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

function makePitchedRoof(width, eaveY, peakY, depth, centerZ) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const vertices = [
    -halfWidth,
    eaveY,
    centerZ - halfDepth,
    halfWidth,
    eaveY,
    centerZ - halfDepth,
    0,
    peakY,
    centerZ - halfDepth,
    -halfWidth,
    eaveY,
    centerZ + halfDepth,
    halfWidth,
    eaveY,
    centerZ + halfDepth,
    0,
    peakY,
    centerZ + halfDepth,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeShield(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.46, height * 0.3);
  shape.lineTo(-width * 0.38, -height * 0.18);
  shape.lineTo(0, -height * 0.5);
  shape.lineTo(width * 0.38, -height * 0.18);
  shape.lineTo(width * 0.46, height * 0.3);
  shape.lineTo(width * 0.27, height * 0.48);
  shape.lineTo(-width * 0.27, height * 0.48);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function makePointedArchFrame(outerWidth, outerHeight, innerWidth, innerHeight, depth) {
  const shape = new THREE.Shape();
  const outerShoulder = outerHeight * 0.54;
  shape.moveTo(-outerWidth / 2, 0);
  shape.lineTo(outerWidth / 2, 0);
  shape.lineTo(outerWidth / 2, outerShoulder);
  shape.quadraticCurveTo(outerWidth * 0.46, outerHeight * 0.82, 0, outerHeight);
  shape.quadraticCurveTo(-outerWidth * 0.46, outerHeight * 0.82, -outerWidth / 2, outerShoulder);
  shape.lineTo(-outerWidth / 2, 0);
  shape.closePath();

  const opening = new THREE.Path();
  const innerBottom = 0.18;
  const innerShoulder = innerHeight * 0.56;
  opening.moveTo(-innerWidth / 2, innerBottom);
  opening.lineTo(-innerWidth / 2, innerShoulder);
  opening.quadraticCurveTo(-innerWidth * 0.46, innerHeight * 0.84, 0, innerHeight);
  opening.quadraticCurveTo(innerWidth * 0.46, innerHeight * 0.84, innerWidth / 2, innerShoulder);
  opening.lineTo(innerWidth / 2, innerBottom);
  opening.closePath();
  shape.holes.push(opening);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function makePointedPanel(width, height, depth) {
  const shape = new THREE.Shape();
  const shoulder = height * 0.58;
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, shoulder);
  shape.quadraticCurveTo(width * 0.44, height * 0.84, 0, height);
  shape.quadraticCurveTo(-width * 0.44, height * 0.84, -width / 2, shoulder);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function makeBanner(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(0, -height * 0.33);
  shape.lineTo(-width / 2, -height / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function addLocalGeometry(bucket, geometry, color, parent, local = {}) {
  const parentMatrix = matrixFor(parent.position, parent.rotation);
  const localMatrix = matrixFor(local.position ?? [0, 0, 0], local.rotation, local.scale);
  bucket.push(prepareGeometry(geometry, color, parentMatrix.multiply(localMatrix)));
}

function addLocalBox(bucket, size, localPosition, color, parent, localRotation = [0, 0, 0]) {
  addLocalGeometry(bucket, new THREE.BoxGeometry(...size), color, parent, {
    position: localPosition,
    rotation: localRotation,
  });
}

function addBeamBetweenXY(bucket, start, end, z, thickness, depth, color) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  addBox(
    bucket,
    [length, thickness, depth],
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, z],
    color,
    [0, 0, Math.atan2(dy, dx)],
  );
}

function addBeamBetweenYZ(bucket, x, start, end, thickness, color) {
  const dy = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dy, dz);
  addBox(
    bucket,
    [thickness, length, thickness],
    [x, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    color,
    [Math.atan2(dz, dy), 0, 0],
  );
}

function roofSurfaceY(eaveY, peakY, width, xFromCenter) {
  return eaveY + (peakY - eaveY) * (1 - Math.abs(xFromCenter) / (width / 2));
}

function applyMaterialPalette(buckets) {
  const remap = new Map();
  const colorKey = (r, g, b) =>
    `${Math.round(r * 100_000)},${Math.round(g * 100_000)},${Math.round(b * 100_000)}`;
  for (const key of Object.keys(PALETTE)) {
    const source = new THREE.Color(PALETTE[key]);
    const target = new THREE.Color(MATERIAL_PALETTE[key]);
    remap.set(colorKey(source.r, source.g, source.b), target);
  }

  for (const [bucketName, geometries] of Object.entries(buckets)) {
    for (const geometry of geometries) {
      const colors = geometry.getAttribute('color');
      for (let i = 0; i < colors.count; i++) {
        const target = remap.get(colorKey(colors.getX(i), colors.getY(i), colors.getZ(i)));
        if (!target) {
          throw new Error(
            `material pass found unmapped ${bucketName} vertex color ${colorKey(colors.getX(i), colors.getY(i), colors.getZ(i))} at index ${i}`,
          );
        }
        colors.setXYZ(i, target.r, target.g, target.b);
      }
      colors.needsUpdate = true;
    }
  }
}

function makeMaterials(stage) {
  const materialPass = ARMOURY_STAGES.indexOf(stage) >= ARMOURY_STAGES.indexOf('material');
  return {
    stone: new THREE.MeshStandardMaterial({
      name: 'ArmouryStone',
      color: 0xffffff,
      vertexColors: true,
      metalness: materialPass ? 0 : 0.02,
      roughness: materialPass ? 0.9 : 0.82,
    }),
    timber: new THREE.MeshStandardMaterial({
      name: 'ArmouryTimber',
      color: 0xffffff,
      vertexColors: true,
      metalness: materialPass ? 0 : 0.01,
      roughness: materialPass ? 0.82 : 0.7,
    }),
    cobalt: new THREE.MeshStandardMaterial({
      name: 'ArmouryCobalt',
      color: 0xffffff,
      vertexColors: true,
      metalness: materialPass ? 0.02 : 0.04,
      roughness: materialPass ? 0.8 : 0.64,
    }),
    metal: new THREE.MeshStandardMaterial({
      name: 'ArmouryMetal',
      color: 0xffffff,
      vertexColors: true,
      metalness: materialPass ? 0.74 : 0.66,
      roughness: materialPass ? 0.44 : 0.4,
    }),
    warmEmissive: new THREE.MeshStandardMaterial({
      name: 'ArmouryWarmEmissive',
      color: 0xffffff,
      vertexColors: true,
      emissive: materialPass ? 0xe85c16 : 0x5c2605,
      emissiveIntensity: materialPass ? 1.05 : 0.72,
      metalness: materialPass ? 0 : 0.02,
      roughness: materialPass ? 0.36 : 0.3,
    }),
    arcaneEmissive: new THREE.MeshStandardMaterial({
      name: 'ArmouryArcaneEmissive',
      color: 0xffffff,
      vertexColors: true,
      emissive: materialPass ? 0x139fca : 0x073a57,
      emissiveIntensity: materialPass ? 1.15 : 0.88,
      metalness: materialPass ? 0.02 : 0.05,
      roughness: materialPass ? 0.24 : 0.22,
    }),
  };
}

function addFoundationBlockout(buckets) {
  addBox(
    buckets.stone,
    [
      ARMOURY_NATIVE_BOUNDS.width,
      ARMOURY_NATIVE_BOUNDS.foundationDepth,
      ARMOURY_NATIVE_BOUNDS.depth,
    ],
    [0, ARMOURY_NATIVE_BOUNDS.foundationDepth / 2, 0],
    PALETTE.stoneDeep,
  );
  addBox(buckets.stone, [12.4, 0.18, 8.4], [0, 1.29, 0], PALETTE.stoneLight);
}

function addHallBlockout(buckets) {
  addBox(buckets.stone, [8.2, 7.4, 5.85], [0, 5.05, 0.1], PALETTE.stone);
  addGeometry(buckets.cobalt, makePitchedRoof(7.0, 8.35, 11.4, 6.25, 0), PALETTE.cobalt);

  addBox(buckets.stone, [5.1, 5.45, 1.5], [0, 4.075, -3.55], PALETTE.stoneDeep);
  addGeometry(buckets.cobalt, makePitchedRoof(5.45, 6.62, 9.2, 1.58, -3.71), PALETTE.cobaltDark);

  for (const side of [-1, 1]) {
    addBox(buckets.stone, [2.9, 5.8, 2.9], [side * 4.95, 4.25, 1.25], PALETTE.stone);
    addBox(buckets.stone, [2.62, 5.15, 2.05], [side * 4.95, 3.925, -1.15], PALETTE.stone);
    addBox(buckets.stone, [2.5, 4.45, 2.05], [side * 4.95, 3.575, -3.15], PALETTE.stoneDeep);

    const frontRoof = makePitchedRoof(3.0, 6.95, 9.55, 3.3, 1.15);
    addGeometry(buckets.cobalt, frontRoof, PALETTE.cobaltLight, {
      position: [side * 4.95, 0, 0],
    });
    const middleRoof = makePitchedRoof(2.75, 6.28, 8.45, 2.25, -1.15);
    addGeometry(buckets.cobalt, middleRoof, PALETTE.cobalt, {
      position: [side * 4.95, 0, 0],
    });
    const rearRoof = makePitchedRoof(2.55, 5.62, 7.6, 2.2, -3.15);
    addGeometry(buckets.cobalt, rearRoof, side < 0 ? PALETTE.cobaltDark : PALETTE.cobalt, {
      position: [side * 4.95, 0, 0],
    });
  }
}

function addTowerBlockout(buckets) {
  addBox(buckets.stone, [3.0, 11.45, 3.25], [0, 7.075, -0.55], PALETTE.stoneLight);
  addBox(buckets.stone, [3.28, 0.22, 3.5], [0, 12.72, -0.55], PALETTE.stoneDeep);
  addBox(buckets.timber, [3.52, 0.16, 3.72], [0, 12.9, -0.55], PALETTE.timber);
  addGeometry(
    buckets.cobalt,
    makePitchedRoof(3.65, 12.98, ARMOURY_NATIVE_BOUNDS.height, 3.85, -0.55),
    PALETTE.cobaltDark,
  );

  for (const side of [-1, 1]) {
    addGeometry(
      buckets.stone,
      new THREE.CylinderGeometry(1.25, 1.25, 8.5, 8, 1, false),
      side < 0 ? PALETTE.stoneDeep : PALETTE.stone,
      { position: [side * 4.95, 5.6, 1.45], rotation: [0, Math.PI / 8, 0] },
    );
    addGeometry(
      buckets.cobalt,
      new THREE.ConeGeometry(1.55, 3.4, 8, 1, false),
      side < 0 ? PALETTE.cobaltDark : PALETTE.cobalt,
      { position: [side * 4.95, 11.45, 1.45], rotation: [0, Math.PI / 8, 0] },
    );
  }
}

function addEntranceBlockout(buckets) {
  for (const side of [-1, 1]) {
    addBox(buckets.stone, [1.12, 3.05, 1.62], [side * 2.1, 3.775, 3.55], PALETTE.stoneDeep);
  }
  addBox(buckets.stone, [5.32, 0.52, 1.62], [0, 5.04, 3.55], PALETTE.stoneDeep);
  addGeometry(buckets.cobalt, makePitchedRoof(5.85, 5.3, 7.85, 2.6, 3.1), PALETTE.cobalt);
  addBox(buckets.timber, [2.85, 2.7, 0.18], [0, 3.6, 3.075], PALETTE.timberDark);
  addBox(buckets.timber, [2.25, 2.45, 0.12], [0, 3.475, 3.18], PALETTE.timber);

  const stepCount = 5;
  for (let i = 0; i < stepCount; i++) {
    const height = 0.18;
    addBox(
      buckets.stone,
      [8.15 - i * 0.32, height, 0.5],
      [0, 1.35 + i * height + height / 2, 4.25 - i * 0.25],
      i % 2 === 0 ? PALETTE.stone : PALETTE.stoneLight,
    );
  }
  addBox(buckets.stone, [7.2, 0.18, 1.0], [0, 2.16, 2.75], PALETTE.stoneLight);
}

function addGableRoofStructure(buckets, roof) {
  const beam = roof.beam ?? 0.14;
  const eaveInset = roof.width / 2 - beam / 2;
  for (const side of [-1, 1]) {
    addBox(
      buckets.timber,
      [beam, 0.18, roof.depth],
      [roof.centerX + side * eaveInset, roof.eaveY - 0.04, roof.centerZ],
      side < 0 ? PALETTE.timberDark : PALETTE.timber,
    );
  }
  addBox(
    buckets.timber,
    [beam, 0.14, roof.depth],
    [roof.centerX, roof.peakY - 0.1, roof.centerZ],
    PALETTE.timberDark,
  );
  for (const face of [-1, 1]) {
    addBox(
      buckets.timber,
      [roof.width, 0.14, 0.12],
      [roof.centerX, roof.eaveY - 0.04, roof.centerZ + face * (roof.depth / 2 - 0.06)],
      PALETTE.timberDark,
    );
  }
}

function addRoofStructure(buckets) {
  const gableRoofs = [
    { centerX: 0, width: 7.0, eaveY: 8.35, peakY: 11.4, depth: 6.25, centerZ: 0 },
    { centerX: 0, width: 5.45, eaveY: 6.62, peakY: 9.2, depth: 1.58, centerZ: -3.71 },
    { centerX: 0, width: 3.65, eaveY: 12.98, peakY: 16.35, depth: 3.85, centerZ: -0.55 },
    { centerX: 0, width: 5.85, eaveY: 5.3, peakY: 7.85, depth: 2.6, centerZ: 3.1 },
  ];
  for (const side of [-1, 1]) {
    gableRoofs.push(
      {
        centerX: side * 4.95,
        width: 3.0,
        eaveY: 6.95,
        peakY: 9.55,
        depth: 3.3,
        centerZ: 1.15,
      },
      {
        centerX: side * 4.95,
        width: 2.75,
        eaveY: 6.28,
        peakY: 8.45,
        depth: 2.25,
        centerZ: -1.15,
      },
      {
        centerX: side * 4.95,
        width: 2.55,
        eaveY: 5.62,
        peakY: 7.6,
        depth: 2.2,
        centerZ: -3.15,
      },
    );
  }
  for (const roof of gableRoofs) addGableRoofStructure(buckets, roof);

  for (const side of [-1, 1]) {
    addGeometry(
      buckets.stone,
      new THREE.CylinderGeometry(1.45, 1.45, 0.22, 8, 1, false),
      PALETTE.stoneDeep,
      { position: [side * 4.95, 9.62, 1.45], rotation: [0, Math.PI / 8, 0] },
    );
    addGeometry(
      buckets.timber,
      new THREE.CylinderGeometry(1.55, 1.49, 0.18, 8, 1, false),
      PALETTE.timber,
      { position: [side * 4.95, 9.78, 1.45], rotation: [0, Math.PI / 8, 0] },
    );
  }
}

function addDormer(buckets, dormer) {
  const bottomY = dormer.surfaceY - dormer.embedDepth;
  addBox(
    buckets.stone,
    [dormer.width, dormer.height, dormer.depth],
    [dormer.x, bottomY + dormer.height / 2, dormer.z],
    dormer.direction > 0 ? PALETTE.stone : PALETTE.stoneDeep,
  );
  const roofEaveY = bottomY + dormer.height - 0.1;
  addGeometry(
    buckets.cobalt,
    makePitchedRoof(
      dormer.width + 0.24,
      roofEaveY,
      dormer.roofPeakY,
      dormer.depth + 0.28,
      dormer.z,
    ),
    dormer.direction > 0 ? PALETTE.cobaltLight : PALETTE.cobaltDark,
    { position: [dormer.x, 0, 0] },
  );

  const faceZ = dormer.z + dormer.direction * (dormer.depth / 2 + 0.045);
  for (const side of [-1, 1]) {
    addBox(
      buckets.timber,
      [0.09, dormer.height - 0.14, 0.09],
      [dormer.x + side * (dormer.width / 2 - 0.08), bottomY + dormer.height / 2, faceZ],
      PALETTE.timber,
    );
  }
  addBox(
    buckets.timber,
    [dormer.width - 0.12, 0.1, 0.09],
    [dormer.x, roofEaveY - 0.05, faceZ],
    PALETTE.timberDark,
  );
}

function addDormerSystem(buckets) {
  for (const x of [-2.2, 2.2]) {
    const surfaceY = roofSurfaceY(8.35, 11.4, 7.0, x);
    addDormer(buckets, {
      x,
      z: 2.9,
      direction: 1,
      surfaceY,
      embedDepth: 0.28,
      width: 1.05,
      height: 1.15,
      depth: 0.85,
      roofPeakY: 11.05,
    });
  }

  for (const x of [-1.5, 1.5]) {
    const surfaceY = roofSurfaceY(6.62, 9.2, 5.45, x);
    addDormer(buckets, {
      x,
      z: -3.96,
      direction: -1,
      surfaceY,
      embedDepth: 0.24,
      width: 0.9,
      height: 0.92,
      depth: 0.68,
      roofPeakY: 8.92,
    });
  }
}

function addButtressSystem(buckets, options = {}) {
  for (const x of [-3.85, 3.85]) {
    addBox(buckets.stone, [0.46, 6.55, 0.5], [x, 4.625, 3.25], PALETTE.stoneLight);
    addBox(buckets.stone, [0.72, 0.28, 0.72], [x, 1.49, 3.28], PALETTE.stoneDeep);
  }

  const sidePiers = [
    { z: 2.62, height: 5.7 },
    { z: -0.16, height: 5.05 },
    { z: -2.2, height: 4.45 },
  ];
  for (const side of [-1, 1]) {
    for (const pier of sidePiers) {
      addBox(
        buckets.stone,
        [0.28, pier.height, 0.5],
        [side * 6.36, 1.35 + pier.height / 2, pier.z],
        PALETTE.stoneLight,
      );
    }
  }

  const rearPiers = options.rearLoadingBay ? [-2.3, 2.3] : [-2.3, 0, 2.3];
  for (const x of rearPiers) {
    addBox(buckets.stone, [0.42, 4.75, 0.24], [x, 3.725, -4.38], PALETTE.stoneLight);
  }
}

function addTimberFrameSystem(buckets, options = {}) {
  addBox(buckets.timber, [7.75, 0.2, 0.18], [0, 7.72, 3.06], PALETTE.timberDark);
  for (const x of [-3.7, 3.7]) {
    addBox(buckets.timber, [0.18, 5.85, 0.18], [x, 4.55, 3.07], PALETTE.timber);
  }
  addBeamBetweenXY(buckets.timber, [-3.58, 5.55], [-2.52, 7.5], 3.08, 0.13, 0.18, PALETTE.timber);
  addBeamBetweenXY(buckets.timber, [3.58, 5.55], [2.52, 7.5], 3.08, 0.13, 0.18, PALETTE.timber);

  for (const side of [-1, 1]) {
    const xFront = side * 6.42;
    addBox(buckets.timber, [0.14, 0.18, 2.55], [xFront, 5.45, 1.22], PALETTE.timberDark);
    addBeamBetweenYZ(buckets.timber, xFront, [2.0, 0.05], [5.36, 2.35], 0.14, PALETTE.timber);

    const xMiddle = side * 6.33;
    addBox(buckets.timber, [0.14, 0.18, 1.75], [xMiddle, 4.78, -1.15], PALETTE.timberDark);
    addBeamBetweenYZ(buckets.timber, xMiddle, [1.8, -1.95], [4.68, -0.35], 0.14, PALETTE.timber);

    const xRear = side * 6.28;
    addBox(buckets.timber, [0.14, 0.18, 1.68], [xRear, 4.18, -3.15], PALETTE.timberDark);
    addBox(buckets.timber, [0.14, 2.7, 0.14], [xRear, 2.7, -3.9], PALETTE.timber);
  }

  addBox(buckets.timber, [4.75, 0.18, 0.14], [0, 5.38, -4.32], PALETTE.timberDark);
  const rearPosts = options.rearLoadingBay ? [-2.15, 2.15] : [-2.15, 0, 2.15];
  for (const x of rearPosts) {
    addBox(buckets.timber, [0.16, 3.55, 0.14], [x, 3.12, -4.32], PALETTE.timber);
  }
  addBeamBetweenXY(buckets.timber, [-2.05, 2.0], [0, 5.28], -4.32, 0.15, 0.14, PALETTE.timber);
  addBeamBetweenXY(buckets.timber, [2.05, 2.0], [0, 5.28], -4.32, 0.15, 0.14, PALETTE.timber);
}

function addPorticoStructure(buckets) {
  for (const side of [-1, 1]) {
    addBox(buckets.stone, [0.42, 2.75, 0.46], [side * 2.38, 3.625, 4.25], PALETTE.stoneLight);
    addBox(buckets.stone, [0.68, 0.24, 0.58], [side * 2.38, 2.37, 4.21], PALETTE.stoneDeep);
    addBeamBetweenYZ(buckets.timber, side * 2.62, [2.54, 3.14], [5.08, 4.28], 0.15, PALETTE.timber);
  }
  addBox(buckets.stone, [0.26, 2.08, 0.88], [-1.48, 3.38, 3.68], PALETTE.stoneDeep);
  addBox(buckets.stone, [0.26, 2.08, 0.88], [1.48, 3.38, 3.68], PALETTE.stoneDeep);
  addGeometry(buckets.stone, makePointedArchFrame(3.75, 2.8, 2.7, 2.3, 0.34), PALETTE.stoneLight, {
    position: [0, 2.25, 4.3],
  });
  addGeometry(buckets.metal, makeShield(1.4, 1.6, 0.08), PALETTE.iron, {
    position: [0, 6.35, 4.4],
  });
  addBox(buckets.timber, [4.65, 0.2, 0.2], [0, 5.18, 4.06], PALETTE.timberDark);
  addBox(buckets.timber, [4.3, 0.16, 0.22], [0, 2.34, 3.37], PALETTE.timber);
}

function addStructuralPass(buckets, options = {}) {
  addRoofStructure(buckets);
  addDormerSystem(buckets);
  addButtressSystem(buckets, options);
  addTimberFrameSystem(buckets, options);
  addPorticoStructure(buckets);
}

function addPointedWindow(buckets, window) {
  const innerWidth = window.width * 0.62;
  const innerHeight = window.height * 0.8;
  const parent = {
    position: window.position,
    rotation: window.rotation ?? [0, 0, 0],
  };
  addLocalGeometry(
    buckets.warmEmissive,
    makePointedPanel(innerWidth * 0.92, innerHeight * 0.94, 0.08),
    window.glassColor ?? PALETTE.warm,
    parent,
    { position: [0, 0.2, -0.07] },
  );
  addLocalGeometry(
    buckets.stone,
    makePointedArchFrame(window.width, window.height, innerWidth, innerHeight, 0.16),
    window.frameColor ?? PALETTE.stoneLight,
    parent,
  );

  const mullionZ = 0.095;
  addLocalBox(
    buckets.metal,
    [0.07, innerHeight * 0.72, 0.07],
    [0, 0.2 + innerHeight * 0.38, mullionZ],
    PALETTE.gold,
    parent,
  );
  addLocalBox(
    buckets.metal,
    [innerWidth * 0.68, 0.07, 0.07],
    [0, 0.2 + innerHeight * 0.48, mullionZ],
    PALETTE.gold,
    parent,
  );
}

function addSideGables(buckets) {
  for (const side of [-1, 1]) {
    addBox(buckets.stone, [0.72, 2.3, 1.65], [side * 6.04, 4.25, 1.2], PALETTE.stone);
    addGeometry(
      buckets.cobalt,
      makePitchedRoof(1.95, 5.35, 7.0, 0.92, 0),
      side < 0 ? PALETTE.cobaltDark : PALETTE.cobaltLight,
      {
        position: [side * 6.04, 0, 1.2],
        rotation: [0, side * Math.PI * 0.5, 0],
      },
    );
    addBox(buckets.timber, [0.14, 0.18, 1.78], [side * 6.43, 5.31, 1.2], PALETTE.timberDark);
  }
}

function addWindowSystem(buckets) {
  for (const x of [-3.08, 3.08]) {
    addPointedWindow(buckets, {
      position: [x, 2.65, 3.12],
      width: 0.9,
      height: 2.18,
    });
  }

  addPointedWindow(buckets, {
    position: [0, 10.35, 1.15],
    width: 1.2,
    height: 2.3,
    glassColor: PALETTE.warm,
  });
  for (const side of [-1, 1]) {
    addPointedWindow(buckets, {
      position: [side * 1.54, 10.45, -0.55],
      rotation: [0, side * Math.PI * 0.5, 0],
      width: 0.82,
      height: 2.08,
    });
  }

  for (const side of [-1, 1]) {
    const rotation = [0, side * Math.PI * 0.5, 0];
    addPointedWindow(buckets, {
      position: [side * 6.37, 3.45, 1.2],
      rotation,
      width: 0.8,
      height: 1.72,
    });
    addPointedWindow(buckets, {
      position: [side * 6.35, 2.55, -1.15],
      rotation,
      width: 0.68,
      height: 1.58,
    });
    addPointedWindow(buckets, {
      position: [side * 6.27, 2.35, -3.15],
      rotation,
      width: 0.62,
      height: 1.42,
    });
  }

  for (const x of [-1.58, 1.58]) {
    addPointedWindow(buckets, {
      position: [x, 3.6, -4.37],
      rotation: [0, Math.PI, 0],
      width: 0.7,
      height: 1.5,
    });
  }

  addPointedWindow(buckets, {
    position: [0, 10.15, -2.2],
    rotation: [0, Math.PI, 0],
    width: 1.12,
    height: 2.4,
    glassColor: PALETTE.warm,
  });

  for (const x of [-2.2, 2.2]) {
    addPointedWindow(buckets, {
      position: [x, 9.36, 3.37],
      width: 0.44,
      height: 0.72,
      frameColor: PALETTE.stone,
    });
  }
  for (const x of [-1.5, 1.5]) {
    addPointedWindow(buckets, {
      position: [x, 7.66, -4.34],
      rotation: [0, Math.PI, 0],
      width: 0.38,
      height: 0.62,
      frameColor: PALETTE.stone,
    });
  }
}

function addFinial(buckets, position, height, color = PALETTE.gold) {
  addGeometry(
    buckets.metal,
    new THREE.CylinderGeometry(0.055, 0.075, height * 0.58, 6, 1, false),
    color,
    { position: [position[0], position[1] + height * 0.29, position[2]] },
  );
  addGeometry(buckets.metal, new THREE.ConeGeometry(0.14, height * 0.42, 6, 1, false), color, {
    position: [position[0], position[1] + height * 0.79, position[2]],
  });
}

function addChimneysAndRoofTrim(buckets) {
  addBox(buckets.stone, [0.72, 2.25, 0.68], [-2.72, 10.02, -1.78], PALETTE.stoneDeep);
  addBox(buckets.stone, [0.9, 0.22, 0.84], [-2.72, 11.12, -1.78], PALETTE.stone);
  addBox(buckets.stone, [1.04, 0.18, 0.96], [-2.72, 11.32, -1.78], PALETTE.stoneLight);

  addBox(buckets.stone, [0.58, 1.68, 0.56], [4.72, 8.12, -2.65], PALETTE.stoneDeep);
  addBox(buckets.stone, [0.75, 0.2, 0.72], [4.72, 8.94, -2.65], PALETTE.stone);
  addBox(buckets.stone, [0.86, 0.16, 0.82], [4.72, 9.12, -2.65], PALETTE.stoneLight);

  const ridgeCaps = [
    { position: [0, 11.32, 0], size: [0.2, 0.16, 6.08] },
    { position: [0, 16.3, -0.55], size: [0.16, 0.1, 3.58] },
    { position: [0, 7.78, 3.1], size: [0.18, 0.14, 2.42] },
    { position: [0, 9.13, -3.71], size: [0.18, 0.14, 1.44] },
  ];
  for (const cap of ridgeCaps) addBox(buckets.metal, cap.size, cap.position, PALETTE.gold);

  for (const side of [-1, 1]) {
    addBox(buckets.metal, [0.15, 0.12, 3.05], [side * 4.95, 9.49, 1.15], PALETTE.gold);
    addBox(buckets.metal, [0.14, 0.12, 2.02], [side * 4.95, 8.39, -1.15], PALETTE.gold);
    addBox(buckets.metal, [0.13, 0.11, 1.96], [side * 4.95, 7.55, -3.15], PALETTE.gold);
    addFinial(buckets, [side * 4.95, 13.15, 1.45], 0.56);
  }
  addFinial(buckets, [0, 11.4, 2.92], 0.46);
  addFinial(buckets, [0, 11.4, -2.92], 0.46);
  addFinial(buckets, [0, 7.85, 4.12], 0.4);
}

function addEaveBracketSystem(buckets) {
  for (const side of [-1, 1]) {
    const x = side * 3.44;
    for (const z of [-2.45, -1.25, 0, 1.25, 2.45]) {
      addBox(buckets.timber, [0.3, 0.12, 0.14], [x - side * 0.1, 8.08, z], PALETTE.timber);
      addBeamBetweenYZ(
        buckets.timber,
        x,
        [7.8, z - 0.14],
        [8.24, z + 0.14],
        0.11,
        PALETTE.timberDark,
      );
    }
  }

  for (const side of [-1, 1]) {
    for (const z of [0.35, 1.15, 1.95]) {
      const x = side * 6.39;
      addBox(buckets.timber, [0.22, 0.11, 0.12], [x, 6.72, z], PALETTE.timber);
      addBeamBetweenYZ(
        buckets.timber,
        x,
        [6.46, z - 0.1],
        [6.87, z + 0.1],
        0.1,
        PALETTE.timberDark,
      );
    }
  }
}

function addMasonryRelief(buckets) {
  for (let i = 0; i < 10; i++) {
    const x = -3.6 + i * 0.8;
    addBox(
      buckets.stone,
      [0.68, 0.22, 0.13],
      [x, 6.68 + (i % 2) * 0.03, 3.13],
      i % 3 === 0 ? PALETTE.stoneLight : PALETTE.stone,
    );
  }

  for (const y of [6.65, 8.45, 10.35]) {
    addBox(buckets.stone, [3.22, 0.18, 3.46], [0, y, -0.55], PALETTE.stoneDeep);
    addBox(buckets.stone, [3.36, 0.12, 3.6], [0, y + 0.13, -0.55], PALETTE.stoneLight);
  }

  for (const side of [-1, 1]) {
    for (const y of [2.1, 3.2, 4.3]) {
      addBox(
        buckets.stone,
        [0.18, 0.26, 2.42],
        [side * 6.31, y, 1.22],
        y > 4 ? PALETTE.stoneLight : PALETTE.stone,
      );
    }
  }
}

function addRearLoadingBay(buckets) {
  addBox(buckets.timber, [2.5, 2.35, 0.12], [0, 2.625, -4.42], PALETTE.timberDark);
  for (const x of [-0.6, 0.6]) {
    addBox(buckets.timber, [1.06, 0.92, 0.06], [x, 2.12, -4.465], PALETTE.timber);
    addBox(buckets.timber, [1.06, 0.92, 0.06], [x, 3.08, -4.465], PALETTE.timberDark);
  }
  addBox(buckets.stone, [0.36, 2.55, 0.3], [-1.42, 2.625, -4.35], PALETTE.stoneLight);
  addBox(buckets.stone, [0.36, 2.55, 0.3], [1.42, 2.625, -4.35], PALETTE.stoneLight);
  addGeometry(buckets.cobalt, makePitchedRoof(3.3, 4.02, 5.15, 0.68, -4.16), PALETTE.cobaltDark);
  addBox(buckets.timber, [3.26, 0.15, 0.13], [0, 3.98, -4.43], PALETTE.timberDark);
  for (const y of [1.74, 2.62, 3.5]) {
    addBox(buckets.metal, [2.36, 0.09, 0.05], [0, y, -4.47], PALETTE.iron);
  }
  for (const x of [-0.6, 0.6]) {
    addGeometry(buckets.metal, new THREE.OctahedronGeometry(0.08, 0), PALETTE.gold, {
      position: [x, 2.64, -4.46],
      scale: [0.7, 1, 0.35],
    });
  }
}

function addDoorAndCrestForm(buckets) {
  for (const x of [-0.55, 0.55]) {
    for (const y of [2.92, 4.02]) {
      addBox(
        buckets.timber,
        [0.96, 0.92, 0.06],
        [x, y, 3.255],
        y < 3.5 ? PALETTE.timber : PALETTE.timberDark,
      );
    }
  }
  for (const y of [2.55, 3.48, 4.5]) {
    addBox(buckets.metal, [2.14, 0.09, 0.07], [0, y, 3.3], PALETTE.iron);
  }
  addBox(buckets.metal, [0.08, 2.32, 0.07], [0, 3.5, 3.3], PALETTE.iron);
  addGeometry(buckets.metal, new THREE.OctahedronGeometry(0.1, 0), PALETTE.gold, {
    position: [0.38, 3.48, 3.35],
    scale: [0.72, 1, 0.45],
  });

  addBox(buckets.metal, [0.09, 1.02, 0.05], [0, 6.36, 4.45], PALETTE.gold, [0, 0, 0.58]);
  addBox(buckets.metal, [0.09, 1.02, 0.05], [0, 6.36, 4.45], PALETTE.gold, [0, 0, -0.58]);
  addBox(buckets.metal, [0.58, 0.12, 0.05], [0, 6.34, 4.46], PALETTE.gold);
  addBox(buckets.metal, [0.22, 0.34, 0.05], [0, 6.18, 4.46], PALETTE.gold);
  addBox(buckets.metal, [0.43, 0.1, 0.05], [0, 6.0, 4.46], PALETTE.gold);
}

function addBannerSystem(buckets) {
  for (const side of [-1, 1]) {
    const x = side * 5.12;
    addGeometry(buckets.cobalt, makeBanner(0.92, 2.45, 0.08), PALETTE.cobaltDark, {
      position: [x, 4.15, 2.84],
    });
    addBox(buckets.metal, [1.12, 0.08, 0.09], [x, 5.4, 2.91], PALETTE.gold);
    addBox(buckets.metal, [0.07, 2.2, 0.08], [x - side * 0.38, 4.17, 2.9], PALETTE.gold);
    addBox(buckets.metal, [0.07, 2.2, 0.08], [x + side * 0.38, 4.17, 2.9], PALETTE.gold);
    addBox(buckets.metal, [0.5, 0.07, 0.07], [x, 3.5, 2.92], PALETTE.gold, [0, 0, side * 0.65]);
  }
}

function addNoticeboard(buckets) {
  const centerX = 5.15;
  for (const x of [centerX - 0.65, centerX + 0.65]) {
    addBox(buckets.timber, [0.15, 2.35, 0.15], [x, 2.525, 3.3], PALETTE.timberDark);
    addBox(buckets.stone, [0.34, 0.18, 0.34], [x, 1.44, 3.3], PALETTE.stoneDeep);
  }
  addBox(buckets.timber, [1.72, 1.34, 0.18], [centerX, 2.72, 3.35], PALETTE.timberDark);
  addBox(buckets.timber, [1.48, 1.1, 0.08], [centerX, 2.72, 3.49], PALETTE.timber);
  addGeometry(buckets.cobalt, makePitchedRoof(2.1, 3.55, 4.24, 0.74, 3.3), PALETTE.cobaltDark, {
    position: [centerX, 0, 0],
  });
  addBox(buckets.metal, [2.04, 0.09, 0.08], [centerX, 3.52, 3.62], PALETTE.gold);

  const sheets = [
    { x: centerX - 0.48, y: 2.9, width: 0.38, height: 0.5, tilt: -0.04 },
    { x: centerX, y: 2.65, width: 0.44, height: 0.58, tilt: 0.03 },
    { x: centerX + 0.48, y: 2.84, width: 0.36, height: 0.46, tilt: -0.02 },
  ];
  for (const sheet of sheets) {
    addBox(
      buckets.stone,
      [sheet.width, sheet.height, 0.025],
      [sheet.x, sheet.y, 3.545],
      PALETTE.parchment,
      [0, 0, sheet.tilt],
    );
    addGeometry(buckets.metal, new THREE.OctahedronGeometry(0.035, 0), PALETTE.gold, {
      position: [sheet.x, sheet.y + sheet.height * 0.38, 3.57],
      scale: [1, 1, 0.45],
    });
  }
}

function addArmouryDisplay(buckets) {
  const centerX = -5.15;
  addBox(buckets.timber, [2.18, 0.16, 0.48], [centerX, 1.45, 3.16], PALETTE.timberDark);
  for (const x of [centerX - 0.82, centerX + 0.82]) {
    addBox(buckets.timber, [0.14, 1.9, 0.14], [x, 2.3, 3.16], PALETTE.timber);
  }
  addBox(buckets.timber, [1.8, 0.14, 0.16], [centerX, 3.2, 3.16], PALETTE.timberDark);
  addBox(buckets.timber, [1.8, 0.12, 0.14], [centerX, 2.12, 3.2], PALETTE.timber);

  for (const [index, x] of [centerX - 0.42, centerX + 0.42].entries()) {
    addGeometry(
      buckets.metal,
      makeShield(0.66, 0.78, 0.08),
      index === 0 ? PALETTE.iron : PALETTE.gold,
      { position: [x, 2.5, 3.34] },
    );
    addGeometry(buckets.metal, new THREE.OctahedronGeometry(0.1, 0), PALETTE.gold, {
      position: [x, 2.52, 3.4],
      scale: [1, 1, 0.45],
    });
  }

  for (const x of [centerX - 0.98, centerX + 0.98]) {
    addGeometry(
      buckets.metal,
      new THREE.CylinderGeometry(0.035, 0.045, 2.58, 6, 1, false),
      PALETTE.iron,
      { position: [x, 2.78, 3.2] },
    );
    addGeometry(buckets.metal, new THREE.ConeGeometry(0.12, 0.34, 6, 1, false), PALETTE.gold, {
      position: [x, 4.22, 3.2],
    });
  }

  for (const [x, angle] of [
    [centerX - 0.28, 0.24],
    [centerX + 0.28, -0.24],
  ]) {
    addBox(buckets.metal, [0.075, 1.38, 0.045], [x, 2.76, 3.44], PALETTE.iron, [0, 0, angle]);
    addBox(buckets.metal, [0.48, 0.075, 0.055], [x, 2.17, 3.45], PALETTE.gold, [0, 0, angle]);
    addGeometry(buckets.metal, new THREE.ConeGeometry(0.095, 0.25, 4, 1, false), PALETTE.iron, {
      position: [x - Math.sin(angle) * 0.73, 3.43, 3.44],
      rotation: [0, 0, angle],
    });
  }
}

function addApproachLights(buckets) {
  for (const side of [-1, 1]) {
    const x = side * 4.42;
    const z = 4.02;
    addGeometry(
      buckets.stone,
      new THREE.CylinderGeometry(0.24, 0.28, 0.26, 8, 1, false),
      PALETTE.stoneDeep,
      { position: [x, 1.48, z], rotation: [0, Math.PI / 8, 0] },
    );
    addGeometry(
      buckets.metal,
      new THREE.CylinderGeometry(0.06, 0.075, 1.58, 8, 1, false),
      PALETTE.iron,
      { position: [x, 2.4, z] },
    );
    addBox(buckets.metal, [0.62, 0.08, 0.08], [x + side * 0.18, 3.16, z], PALETTE.gold);
    addGeometry(buckets.arcaneEmissive, new THREE.OctahedronGeometry(0.34, 0), PALETTE.arcane, {
      position: [x + side * 0.42, 3.45, z],
      scale: [0.72, 1.32, 0.72],
    });
    addGeometry(buckets.metal, new THREE.ConeGeometry(0.24, 0.28, 6, 1, false), PALETTE.gold, {
      position: [x + side * 0.42, 3.9, z],
    });
  }

  for (const side of [-1, 1]) {
    const x = side * 1.96;
    addBox(buckets.metal, [0.46, 0.08, 0.08], [x - side * 0.16, 4.55, 4.28], PALETTE.iron);
    addBox(buckets.metal, [0.26, 0.5, 0.1], [x, 4.34, 4.37], PALETTE.gold);
    addGeometry(buckets.warmEmissive, new THREE.OctahedronGeometry(0.19, 0), PALETTE.warm, {
      position: [x, 4.34, 4.38],
      scale: [0.78, 1.15, 0.5],
    });
    addGeometry(buckets.metal, new THREE.ConeGeometry(0.22, 0.2, 6, 1, false), PALETTE.iron, {
      position: [x, 4.66, 4.25],
    });
  }
}

function addFormRefinement(buckets) {
  addSideGables(buckets);
  addWindowSystem(buckets);
  addChimneysAndRoofTrim(buckets);
  addEaveBracketSystem(buckets);
  addMasonryRelief(buckets);
  addRearLoadingBay(buckets);
  addDoorAndCrestForm(buckets);
  addBannerSystem(buckets);
  addNoticeboard(buckets);
  addArmouryDisplay(buckets);
  addApproachLights(buckets);
}

function addRoofCourseSet(buckets, roof, fractions) {
  for (const side of [-1, 1]) {
    for (const fraction of fractions) {
      const xFromCenter = side * roof.width * 0.5 * fraction;
      const y = roofSurfaceY(roof.eaveY, roof.peakY, roof.width, xFromCenter) + 0.035;
      const slopeAngle = Math.atan((-side * (roof.peakY - roof.eaveY)) / (roof.width * 0.5));
      addBox(
        buckets.cobalt,
        [0.07, 0.035, roof.depth * 0.9],
        [roof.centerX + xFromCenter, y, roof.centerZ],
        PALETTE.cobaltCourse,
        [0, 0, slopeAngle],
      );
    }
  }
}

function addFrontGableCourses(buckets, roof, levels) {
  const faceZ = roof.centerZ + roof.depth * 0.5 + 0.035;
  for (const level of levels) {
    const width = roof.width * (1 - level) * 0.9;
    const y = roof.eaveY + (roof.peakY - roof.eaveY) * level;
    addBox(buckets.cobalt, [width, 0.065, 0.05], [roof.centerX, y, faceZ], PALETTE.cobaltCourse);
  }
}

function addRoofSurfacePass(buckets) {
  const roofs = [
    {
      centerX: 0,
      width: 7,
      eaveY: 8.35,
      peakY: 11.4,
      depth: 6.25,
      centerZ: 0,
      fractions: [0.28, 0.48, 0.68, 0.86],
      faceLevels: [0.22, 0.45, 0.68],
    },
    {
      centerX: 0,
      width: 5.85,
      eaveY: 5.3,
      peakY: 7.85,
      depth: 2.6,
      centerZ: 3.1,
      fractions: [0.3, 0.52, 0.74],
      faceLevels: [0.2, 0.42, 0.64],
    },
    {
      centerX: 0,
      width: 3.65,
      eaveY: 12.98,
      peakY: 16.35,
      depth: 3.85,
      centerZ: -0.55,
      fractions: [0.32, 0.56, 0.78],
      faceLevels: [0.24, 0.5, 0.72],
    },
  ];
  for (const side of [-1, 1]) {
    roofs.push({
      centerX: side * 4.95,
      width: 3,
      eaveY: 6.95,
      peakY: 9.55,
      depth: 3.3,
      centerZ: 1.15,
      fractions: [0.38, 0.68],
      faceLevels: [0.3, 0.58],
    });
  }
  for (const roof of roofs) {
    addRoofCourseSet(buckets, roof, roof.fractions);
    addFrontGableCourses(buckets, roof, roof.faceLevels);
  }
}

function addMasonrySurfacePass(buckets) {
  for (const y of [2.75, 4.25, 5.75]) {
    for (const x of [-3.25, 3.25]) {
      addBox(buckets.stone, [1.02, 0.075, 0.065], [x, y, 3.075], PALETTE.stoneWeather);
    }
  }

  const sideSections = [
    { z: 1.2, depth: 2.35, rows: [2.4, 4, 5.5] },
    { z: -1.15, depth: 1.72, rows: [2.5, 4] },
    { z: -3.15, depth: 1.68, rows: [2.4, 3.8] },
  ];
  for (const side of [-1, 1]) {
    for (const section of sideSections) {
      for (const y of section.rows) {
        addBox(
          buckets.stone,
          [0.065, 0.075, section.depth],
          [side * 6.445, y, section.z],
          PALETTE.stoneWeather,
        );
      }
    }
  }

  for (const side of [-1, 1]) {
    for (const y of [2.4, 3.9]) {
      addBox(buckets.stone, [2.05, 0.075, 0.065], [side * 4.95, y, -4.215], PALETTE.stoneWeather);
    }
    for (const x of [side * 1.92]) {
      for (const y of [2.4, 4.4]) {
        addBox(buckets.stone, [0.78, 0.075, 0.065], [x, y, -4.365], PALETTE.stoneWeather);
      }
    }
  }

  for (const side of [-1, 1]) {
    addBox(buckets.stone, [1.45, 0.18, 0.07], [side * 3.2, 1.5, 3.08], PALETTE.stoneWeather);
    addBox(buckets.stone, [0.07, 0.18, 7.45], [side * 6.445, 1.5, 0], PALETTE.stoneWeather);
  }
  addBox(buckets.stone, [4.7, 0.18, 0.07], [0, 1.5, -4.37], PALETTE.stoneWeather);

  addBox(buckets.stone, [7.45, 0.2, 0.07], [0, 8.02, 3.075], PALETTE.stoneDeep);
  for (const side of [-1, 1]) {
    addBox(buckets.stone, [0.07, 0.18, 2.48], [side * 6.445, 6.62, 1.2], PALETTE.stoneDeep);
    addBox(buckets.stone, [0.07, 0.16, 1.78], [side * 6.445, 5.96, -1.15], PALETTE.stoneDeep);
    addBox(buckets.stone, [0.07, 0.15, 1.7], [side * 6.445, 5.3, -3.15], PALETTE.stoneDeep);
  }
  addBox(buckets.stone, [4.72, 0.17, 0.07], [0, 6.35, -4.37], PALETTE.stoneDeep);

  for (const side of [-1, 1]) {
    for (const [index, y] of [2, 3.1, 4.2, 5.3].entries()) {
      addBox(
        buckets.stone,
        [0.1, 0.34, 0.46],
        [side * 6.43, y, 2.62],
        index % 2 === 0 ? PALETTE.stoneLight : PALETTE.stoneWeather,
      );
    }
    for (const [index, y] of [2, 3.2, 4.4].entries()) {
      addBox(
        buckets.stone,
        [0.3, 0.3, 0.08],
        [side * 6.12, y, -4.22],
        index % 2 === 0 ? PALETTE.stoneLight : PALETTE.stoneWeather,
      );
    }
  }
}

function addTimberSurfacePass(buckets) {
  for (const [index, x] of [-0.78, -0.3, 0.3, 0.78].entries()) {
    addBox(
      buckets.timber,
      [0.035, 1.82, 0.018],
      [x, 3.5, 3.297],
      index % 2 === 0 ? PALETTE.timberWeather : PALETTE.timberDark,
    );
  }

  for (const y of [2.24, 3.18]) {
    addBox(buckets.timber, [1.34, 0.035, 0.016], [5.15, y, 3.54], PALETTE.timberWeather);
  }
  for (const x of [4.55, 5.75]) {
    addBox(buckets.timber, [0.035, 1.04, 0.016], [x, 2.72, 3.54], PALETTE.timberDark);
  }

  for (const y of [1.72, 2.86]) {
    addBox(buckets.timber, [1.58, 0.04, 0.02], [-5.15, y, 3.285], PALETTE.timberWeather);
  }
}

function addMetalSurfacePass(buckets) {
  for (const side of [-1, 1]) {
    const x = side * 4.42;
    for (const y of [2.02, 2.72]) {
      addGeometry(
        buckets.metal,
        new THREE.CylinderGeometry(0.082, 0.082, 0.11, 8, 1, false),
        PALETTE.patina,
        { position: [x, y, 4.02] },
      );
    }
  }

  for (const [index, x] of [-5.57, -4.73].entries()) {
    addGeometry(
      buckets.metal,
      new THREE.TorusGeometry(0.25, 0.022, 4, 10),
      index === 0 ? PALETTE.patina : PALETTE.goldHighlight,
      { position: [x, 2.5, 3.405] },
    );
  }
  addGeometry(buckets.metal, new THREE.OctahedronGeometry(0.09, 0), PALETTE.goldHighlight, {
    position: [0, 6.34, 4.48],
    scale: [1, 1, 0.12],
  });
}

function addSurfacePass(buckets) {
  addRoofSurfacePass(buckets);
  addMasonrySurfacePass(buckets);
  addTimberSurfacePass(buckets);
  addMetalSurfacePass(buckets);
}

function addBlockout(buckets) {
  addFoundationBlockout(buckets);
  addHallBlockout(buckets);
  addTowerBlockout(buckets);
  addEntranceBlockout(buckets);
}

function createRuntimeMetadata(stage) {
  return {
    schemaVersion: 1,
    assetId: 'eastbrook-grand-armoury',
    stage,
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...ARMOURY_NATIVE_BOUNDS },
    rootPivot: {
      ...ARMOURY_INTERACTION_CONTRACT.rootPivot,
      floorCenter: [...ARMOURY_INTERACTION_CONTRACT.rootPivot.floorCenter],
      rotationEuler: [...ARMOURY_INTERACTION_CONTRACT.rootPivot.rotationEuler],
      scale: [...ARMOURY_INTERACTION_CONTRACT.rootPivot.scale],
    },
    collider: {
      ...ARMOURY_INTERACTION_CONTRACT.collider,
      center: [...ARMOURY_INTERACTION_CONTRACT.collider.center],
      size: [...ARMOURY_INTERACTION_CONTRACT.collider.size],
      halfExtents: [...ARMOURY_INTERACTION_CONTRACT.collider.halfExtents],
      rotationQuaternion: [...ARMOURY_INTERACTION_CONTRACT.collider.rotationQuaternion],
    },
    interaction: {
      mode: ARMOURY_INTERACTION_CONTRACT.mode,
      closedBuilding: true,
      ...ARMOURY_INTERACTION_CONTRACT.expectations,
    },
    sockets: Object.fromEntries(
      ARMOURY_SOCKET_DEFINITIONS.map((socket) => [
        socket.id,
        {
          nodeName: socket.nodeName,
          position: [...socket.position],
          forward: [...socket.forward],
          purpose: socket.purpose,
          interactive: false,
        },
      ]),
    ),
    destruction: {
      ...ARMOURY_INTERACTION_CONTRACT.destruction,
      detachableParts: [...ARMOURY_INTERACTION_CONTRACT.destruction.detachableParts],
    },
  };
}

function addInteractionNodes(root) {
  for (const definition of ARMOURY_SOCKET_DEFINITIONS) {
    const socket = new THREE.Object3D();
    socket.name = definition.nodeName;
    socket.position.fromArray(definition.position);
    socket.userData.sculptSocket = {
      id: definition.id,
      purpose: definition.purpose,
      forward: [...definition.forward],
      interactive: false,
    };
    root.add(socket);
  }
}

function addMergedMeshes(root, buckets, materials) {
  const meshDefs = [
    ['stone', 'ArmouryStoneMasses'],
    ['timber', 'ArmouryTimberMasses'],
    ['cobalt', 'ArmouryCobaltMasses'],
    ['metal', 'ArmouryMetalMasses'],
    ['warmEmissive', 'ArmouryWarmGlow'],
    ['arcaneEmissive', 'ArmouryArcaneGlow'],
  ];

  for (const [key, name] of meshDefs) {
    if (buckets[key].length === 0) continue;
    const geometry = mergeGeometries(buckets[key], false);
    if (!geometry) throw new Error(`failed to merge ${key} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = name;
    mesh.castShadow = key !== 'warmEmissive' && key !== 'arcaneEmissive';
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

function assertExactBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const expected = ARMOURY_NATIVE_BOUNDS;
  const tolerance = 1e-5;
  const checks = [
    ['width', size.x, expected.width],
    ['height', size.y, expected.height],
    ['depth', size.z, expected.depth],
    ['floor', bounds.min.y, 0],
  ];
  for (const [label, actual, target] of checks) {
    if (Math.abs(actual - target) > tolerance) {
      throw new Error(
        `armoury ${label} ${actual.toFixed(6)} does not match ${target}; bounds=${bounds.min
          .toArray()
          .join(',')}..${bounds.max.toArray().join(',')}`,
      );
    }
  }
}

function assertInteractionContract(root) {
  const tolerance = 1e-6;
  const identityChecks = [
    ['root position x', root.position.x, 0],
    ['root position y', root.position.y, 0],
    ['root position z', root.position.z, 0],
    ['root rotation x', root.rotation.x, 0],
    ['root rotation y', root.rotation.y, 0],
    ['root rotation z', root.rotation.z, 0],
    ['root scale x', root.scale.x, 1],
    ['root scale y', root.scale.y, 1],
    ['root scale z', root.scale.z, 1],
  ];
  for (const [label, actual, expected] of identityChecks) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`armoury interaction contract requires ${label}=${expected}; got ${actual}`);
    }
  }

  const visualBounds = new THREE.Box3().setFromObject(root);
  const collider = ARMOURY_INTERACTION_CONTRACT.collider;
  const colliderMin = collider.center.map((value, index) => value - collider.halfExtents[index]);
  const colliderMax = collider.center.map((value, index) => value + collider.halfExtents[index]);
  for (const [label, actual, expected] of [
    ['collider min x', visualBounds.min.x, colliderMin[0]],
    ['collider min y', visualBounds.min.y, colliderMin[1]],
    ['collider min z', visualBounds.min.z, colliderMin[2]],
    ['collider max x', visualBounds.max.x, colliderMax[0]],
    ['collider max y', visualBounds.max.y, colliderMax[1]],
    ['collider max z', visualBounds.max.z, colliderMax[2]],
  ]) {
    if (Math.abs(actual - expected) > 1e-5) {
      throw new Error(`armoury ${label}=${actual} falls outside contract value ${expected}`);
    }
  }

  for (const definition of ARMOURY_SOCKET_DEFINITIONS) {
    const socket = root.getObjectByName(definition.nodeName);
    if (socket?.type !== 'Object3D' || socket.children.length !== 0) {
      throw new Error(`armoury socket ${definition.nodeName} must be a named empty Object3D`);
    }
    if (socket.position.distanceTo(new THREE.Vector3(...definition.position)) > tolerance) {
      throw new Error(`armoury socket ${definition.nodeName} moved from its authored position`);
    }
  }
}

export function createEastbrookGrandArmoury(options = {}) {
  const stage = options.stage ?? ARMOURY_UNLOCKED_STAGE;
  if (!ARMOURY_STAGES.includes(stage)) throw new Error(`unknown armoury stage: ${stage}`);
  const stageIndex = ARMOURY_STAGES.indexOf(stage);
  const unlockedIndex = ARMOURY_STAGES.indexOf(ARMOURY_UNLOCKED_STAGE);
  if (stageIndex > unlockedIndex) {
    throw new Error(
      `armoury stage ${stage} is locked; review and accept ${ARMOURY_UNLOCKED_STAGE} first`,
    );
  }

  const buckets = {
    stone: [],
    timber: [],
    cobalt: [],
    metal: [],
    warmEmissive: [],
    arcaneEmissive: [],
  };
  addBlockout(buckets);
  if (stageIndex >= ARMOURY_STAGES.indexOf('structural')) {
    addStructuralPass(buckets, {
      rearLoadingBay: stageIndex >= ARMOURY_STAGES.indexOf('form'),
    });
  }
  if (stageIndex >= ARMOURY_STAGES.indexOf('form')) addFormRefinement(buckets);
  if (stageIndex >= ARMOURY_STAGES.indexOf('surface')) addSurfacePass(buckets);
  if (stageIndex >= ARMOURY_STAGES.indexOf('material')) applyMaterialPalette(buckets);

  const root = new THREE.Group();
  root.name = 'EastbrookGrandArmoury';
  root.userData.sculptRuntime = createRuntimeMetadata(stage);
  addMergedMeshes(root, buckets, makeMaterials(stage));
  if (stageIndex >= ARMOURY_STAGES.indexOf('interaction')) addInteractionNodes(root);
  assertExactBounds(root);
  if (stageIndex >= ARMOURY_STAGES.indexOf('interaction')) assertInteractionContract(root);
  return root;
}
