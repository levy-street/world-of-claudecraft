// Deterministic procedural factory for the farming prop set: one garden bed, one
// shared sprout, three crop families across three growth stages plus a withered
// husk, and a compost bin. Every asset is vertex colored and texture free; the
// renderer supplies the biome tint on the bed and the per-crop identity tint on
// the crop_accent material, so the meshes ship in a neutral palette.
//
// The factory is pure: the same asset id always yields the same geometry, so the
// exporter can prove a byte-identical rebuild.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FARM_BODY_MESH_NODE = 'FarmBody';
export const FARM_ACCENT_MESH_NODE = 'CropAccent';
export const FARM_BODY_MATERIAL = 'farm_body';
export const FARM_ACCENT_MATERIAL = 'crop_accent';
export const FARM_SOIL_SOCKET_NODE = 'Socket_Soil';

// Soil surface height of farm_bed in yards. Stage meshes mount here.
const BED_SOIL_TOP = 0.22;

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function cropRow(id, rootNode, family, stage, footprintYd, heightYd, accent) {
  return {
    id,
    out: `models/props/${id}.glb`,
    rootNode,
    family,
    stage,
    footprintYd,
    pivot: 'floor-center',
    heightYd,
    meshes: accent ? [FARM_BODY_MESH_NODE, FARM_ACCENT_MESH_NODE] : [FARM_BODY_MESH_NODE],
    materials: accent ? [FARM_BODY_MATERIAL, FARM_ACCENT_MATERIAL] : [FARM_BODY_MATERIAL],
    sockets: {},
    mountsOn: FARM_SOIL_SOCKET_NODE,
    tintChannels: accent
      ? {
          farm_body: 'shared foliage, left untinted or biome tinted at draw time',
          crop_accent: 'per-crop identity multiply over a light neutral base',
        }
      : { farm_body: 'shared foliage, left untinted or biome tinted at draw time' },
  };
}

// The swap-ready contract every consumer reads: the Phase 13 handoff manifest is
// generated from this table, so every entry stays JSON shaped.
export const FARM_PROP_CONTRACTS = deepFreeze({
  farm_bed: {
    id: 'farm_bed',
    out: 'models/props/farm_bed.glb',
    rootNode: 'FarmBed',
    family: 'bed',
    stage: 'base',
    footprintYd: [3, 2],
    pivot: 'floor-center',
    heightYd: 0.34,
    meshes: [FARM_BODY_MESH_NODE],
    materials: [FARM_BODY_MATERIAL],
    sockets: {
      Socket_Soil: 'stage mesh mount point at the center of the soil surface',
    },
    mountsOn: null,
    tintChannels: {
      farm_body: 'per-hub biome multiply over the whole mesh',
    },
  },
  farm_sprout: cropRow('farm_sprout', 'FarmSprout', 'shared', 'sprout', [1.67, 0.97], 0.25, false),
  farm_grain_stage2: cropRow(
    'farm_grain_stage2',
    'FarmGrainStage2',
    'grain',
    'stage2',
    [1.81, 1.04],
    0.42,
    false,
  ),
  farm_rootleaf_stage2: cropRow(
    'farm_rootleaf_stage2',
    'FarmRootleafStage2',
    'rootleaf',
    'stage2',
    [1.61, 1.31],
    0.22,
    false,
  ),
  farm_gourd_stage2: cropRow(
    'farm_gourd_stage2',
    'FarmGourdStage2',
    'gourd',
    'stage2',
    [1.8, 1.16],
    0.09,
    false,
  ),
  farm_grain_stage3: cropRow(
    'farm_grain_stage3',
    'FarmGrainStage3',
    'grain',
    'stage3',
    [1.91, 1.31],
    0.82,
    true,
  ),
  farm_rootleaf_stage3: cropRow(
    'farm_rootleaf_stage3',
    'FarmRootleafStage3',
    'rootleaf',
    'stage3',
    [2.16, 1.49],
    0.37,
    true,
  ),
  farm_gourd_stage3: cropRow(
    'farm_gourd_stage3',
    'FarmGourdStage3',
    'gourd',
    'stage3',
    [2.46, 1.5],
    0.18,
    true,
  ),
  farm_grain_stage4: cropRow(
    'farm_grain_stage4',
    'FarmGrainStage4',
    'grain',
    'stage4',
    [2.54, 1.38],
    1.07,
    true,
  ),
  farm_rootleaf_stage4: cropRow(
    'farm_rootleaf_stage4',
    'FarmRootleafStage4',
    'rootleaf',
    'stage4',
    [2.72, 1.71],
    0.58,
    true,
  ),
  farm_gourd_stage4: cropRow(
    'farm_gourd_stage4',
    'FarmGourdStage4',
    'gourd',
    'stage4',
    [2.63, 1.61],
    0.4,
    true,
  ),
  farm_grain_withered: cropRow(
    'farm_grain_withered',
    'FarmGrainWithered',
    'grain',
    'withered',
    [2.17, 1.36],
    0.66,
    false,
  ),
  farm_rootleaf_withered: cropRow(
    'farm_rootleaf_withered',
    'FarmRootleafWithered',
    'rootleaf',
    'withered',
    [2.12, 1.47],
    0.24,
    false,
  ),
  farm_gourd_withered: cropRow(
    'farm_gourd_withered',
    'FarmGourdWithered',
    'gourd',
    'withered',
    [2.43, 1.42],
    0.14,
    false,
  ),
  farm_compost_bin: {
    id: 'farm_compost_bin',
    out: 'models/props/farm_compost_bin.glb',
    rootNode: 'FarmCompostBin',
    family: 'utility',
    stage: 'utility',
    footprintYd: [1, 1],
    pivot: 'floor-center',
    heightYd: 0.8,
    meshes: [FARM_BODY_MESH_NODE],
    materials: [FARM_BODY_MATERIAL],
    sockets: {},
    mountsOn: null,
    tintChannels: {
      farm_body: 'per-hub biome multiply over the whole mesh',
    },
  },
});

export const FARM_PROP_IDS = Object.freeze(Object.keys(FARM_PROP_CONTRACTS));

// Authored as sRGB swatches; three.js color management stores them linear, the
// same convention the eastbrook exporters use. The crop_accent swatches land
// near 0.8 in the shipped COLOR_0 buffer so a per-crop multiply stays readable.
const PALETTE = Object.freeze({
  soilDeep: 0x74593c,
  soil: 0x8a6b48,
  soilLight: 0x9d7d57,
  plankDark: 0x8a8172,
  plank: 0x9e9585,
  plankLight: 0xb0a796,
  leafDeep: 0x5f8f3d,
  leaf: 0x74a84c,
  leafLight: 0x8dbe63,
  stalk: 0x9bb455,
  stalkPale: 0xafc46b,
  accentDeep: 0xe0e0e0,
  accent: 0xe7e7e7,
  accentLight: 0xededed,
  witherDeep: 0x8a8072,
  wither: 0x9d9484,
  witherLight: 0xb0a897,
  compostDeep: 0x5a4a38,
  compost: 0x6b5a45,
});

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function jitterColor(random, hex, amount) {
  const color = new THREE.Color(hex);
  const factor = 1 + (random() - 0.5) * amount;
  color.r = Math.min(1, Math.max(0, color.r * factor));
  color.g = Math.min(1, Math.max(0, color.g * factor));
  color.b = Math.min(1, Math.max(0, color.b * factor));
  return color;
}

// Golden angle spiral: an even, clump-free scatter with no rejection sampling.
const GOLDEN_ANGLE = 2.399963229728653;

function scatterPositions(random, count, radiusX, radiusZ) {
  const positions = [];
  for (let index = 0; index < count; index++) {
    const radius = Math.sqrt((index + 0.5) / count);
    const angle = index * GOLDEN_ANGLE + (random() - 0.5) * 0.6;
    positions.push([Math.cos(angle) * radius * radiusX, Math.sin(angle) * radius * radiusZ]);
  }
  return positions;
}

function prepareGeometry(source, color, matrix) {
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

function centerMatrix(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

// Rotates a height-centered primitive about its own base so leaning shoots stay
// planted where they were placed.
function baseMatrix(base, rotation, height) {
  return new THREE.Matrix4()
    .makeTranslation(base[0], base[1], base[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)))
    .multiply(new THREE.Matrix4().makeTranslation(0, height / 2, 0));
}

function tipOf(base, rotation, height) {
  const offset = new THREE.Vector3(0, height, 0).applyEuler(new THREE.Euler(...rotation));
  return [base[0] + offset.x, base[1] + offset.y, base[2] + offset.z];
}

function makeFrustum(widthBottom, widthTop, height, depthBottom, depthTop) {
  const y0 = -height / 2;
  const y1 = height / 2;
  const xb = widthBottom / 2;
  const xt = widthTop / 2;
  const zb = depthBottom / 2;
  const zt = depthTop / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -xb,
        y0,
        -zb,
        xb,
        y0,
        -zb,
        xb,
        y0,
        zb,
        -xb,
        y0,
        zb,
        -xt,
        y1,
        -zt,
        xt,
        y1,
        -zt,
        xt,
        y1,
        zt,
        -xt,
        y1,
        zt,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0]) {
  bucket.push(
    prepareGeometry(new THREE.BoxGeometry(...size), color, centerMatrix(position, rotation)),
  );
}

// A tapered shoot, leaf, or head planted at `base` and leaning by `rotation`.
function addShoot(bucket, options) {
  const geometry = makeFrustum(
    options.bottom[0],
    options.top[0],
    options.height,
    options.bottom[1],
    options.top[1],
  );
  bucket.push(
    prepareGeometry(
      geometry,
      options.color,
      baseMatrix(options.base, options.rotation ?? [0, 0, 0], options.height),
    ),
  );
}

function addDisc(bucket, radius, thickness, position, color, rotation = [0, 0, 0]) {
  bucket.push(
    prepareGeometry(
      new THREE.CylinderGeometry(radius, radius, thickness, 6, 1),
      color,
      centerMatrix(position, rotation),
    ),
  );
}

function addBlob(bucket, radii, position, color, rotation = [0, 0, 0], segments = 6) {
  bucket.push(
    prepareGeometry(
      new THREE.SphereGeometry(1, segments, Math.max(3, Math.round(segments * 0.7))),
      color,
      centerMatrix(position, rotation, radii),
    ),
  );
}

function addVineSegment(bucket, from, to, thickness, color) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  addBox(
    bucket,
    [thickness, thickness, length],
    [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    color,
    [0, Math.atan2(dx, dz), 0],
  );
}

function buildBed(context) {
  const { body, random, sockets } = context;
  const halfX = 1.5;
  const halfZ = 1;
  const plankThickness = 0.09;
  const plankHeight = 0.25;
  const postSize = 0.17;
  const height = 0.34;

  body.push(
    prepareGeometry(
      makeFrustum(2.84, 2.56, BED_SOIL_TOP, 1.84, 1.56),
      PALETTE.soil,
      centerMatrix([0, BED_SOIL_TOP / 2, 0]),
    ),
  );
  for (const [x, z] of scatterPositions(random, 6, 1.05, 0.6)) {
    addBox(
      body,
      [0.22, 0.07, 0.17],
      [x, BED_SOIL_TOP + 0.005, z],
      jitterColor(random, PALETTE.soilLight, 0.16),
      [0, random() * Math.PI, 0],
    );
  }
  for (const [x, z] of scatterPositions(random, 4, 1.16, 0.68)) {
    addBox(
      body,
      [0.3, 0.05, 0.22],
      [x, BED_SOIL_TOP - 0.05, z],
      jitterColor(random, PALETTE.soilDeep, 0.16),
      [0, random() * Math.PI, 0],
    );
  }

  for (const sz of [-1, 1]) {
    addBox(
      body,
      [halfX * 2, plankHeight, plankThickness],
      [0, plankHeight / 2, sz * (halfZ - plankThickness / 2)],
      PALETTE.plank,
    );
  }
  for (const sx of [-1, 1]) {
    addBox(
      body,
      [plankThickness, plankHeight, halfZ * 2 - plankThickness * 2],
      [sx * (halfX - plankThickness / 2), plankHeight / 2, 0],
      PALETTE.plankDark,
    );
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        body,
        [postSize, height, postSize],
        [sx * (halfX - postSize / 2), height / 2, sz * (halfZ - postSize / 2)],
        PALETTE.plankLight,
      );
    }
  }

  sockets.push({
    name: FARM_SOIL_SOCKET_NODE,
    position: [0, BED_SOIL_TOP, 0],
    purpose: FARM_PROP_CONTRACTS.farm_bed.sockets[FARM_SOIL_SOCKET_NODE],
  });
}

function buildSprout(context) {
  const { body, random } = context;
  for (const [x, z] of scatterPositions(random, 9, 1.02, 0.58)) {
    const height = 0.16 + random() * 0.1;
    const lean = (random() - 0.5) * 0.5;
    addShoot(body, {
      base: [x, 0, z],
      height,
      bottom: [0.05, 0.03],
      top: [0.016, 0.011],
      rotation: [lean * 0.7, random() * Math.PI * 2, lean],
      color: jitterColor(random, PALETTE.leafLight, 0.18),
    });
  }
}

function grainField(context, options) {
  const { body, accent, random } = context;
  const bucketForHeads = options.headBucket === 'accent' ? accent : body;
  for (const [x, z] of scatterPositions(random, options.count, options.radiusX, options.radiusZ)) {
    const height = options.height + random() * options.heightSpread;
    const lean = options.lean * (0.35 + random() * 0.65);
    const yaw = random() * Math.PI * 2;
    const rotation = [lean * 0.7, yaw, lean];
    addShoot(body, {
      base: [x, 0, z],
      height,
      bottom: [0.05, 0.028],
      top: [0.02, 0.014],
      rotation,
      color: jitterColor(random, options.stalkColor, 0.18),
    });
    if (!options.headHeight) continue;
    const headLean = lean + options.headDroop;
    addShoot(bucketForHeads, {
      base: tipOf([x, 0, z], rotation, height * 0.94),
      height: options.headHeight,
      bottom: [0.045, 0.035],
      top: [0.02, 0.016],
      rotation: [headLean * 0.7, yaw, headLean],
      color: jitterColor(random, options.headColor, 0.1),
    });
  }
}

function rootleafField(context, options) {
  const { body, accent, random } = context;
  for (const [x, z] of scatterPositions(random, options.count, options.radiusX, options.radiusZ)) {
    const yawBase = random() * Math.PI * 2;
    for (let leaf = 0; leaf < options.leaves; leaf++) {
      const yaw = yawBase + (leaf / options.leaves) * Math.PI * 2;
      const tilt = options.tilt + (random() - 0.5) * 0.22;
      const length = options.leafLength * (0.82 + random() * 0.36);
      addShoot(body, {
        base: [x, 0, z],
        height: length,
        bottom: [0.05, 0.02],
        top: [options.leafWidth, 0.022],
        rotation: [0, yaw, tilt],
        color: jitterColor(random, options.leafColor, 0.2),
      });
    }
    if (!options.shoulderRadius) continue;
    addBlob(
      accent,
      [options.shoulderRadius, options.shoulderRadius * 0.72, options.shoulderRadius],
      [x, options.shoulderRadius * 0.24, z],
      jitterColor(random, PALETTE.accent, 0.1),
    );
  }
}

function gourdField(context, options) {
  const { body, accent, random } = context;
  const vineColor = options.vineColor;
  for (let vine = 0; vine < options.vines; vine++) {
    const offsetZ = (vine / Math.max(1, options.vines - 1) - 0.5) * options.radiusZ * 1.5;
    const phase = random() * Math.PI * 2;
    const points = [];
    for (let step = 0; step <= 5; step++) {
      const t = step / 5;
      points.push([
        (t - 0.5) * options.radiusX * 2,
        options.vineThickness / 2,
        offsetZ + Math.sin(phase + t * 3.1) * options.radiusZ * 0.32,
      ]);
    }
    for (let step = 0; step < points.length - 1; step++) {
      addVineSegment(
        body,
        points[step],
        points[step + 1],
        options.vineThickness,
        jitterColor(random, vineColor, 0.14),
      );
    }
    for (let step = 1; step < points.length; step++) {
      const [x, y, z] = points[step];
      const radius = options.leafRadius * (0.78 + random() * 0.44);
      addDisc(
        body,
        radius,
        0.022,
        [x + (random() - 0.5) * 0.16, y + options.leafLift, z + (random() - 0.5) * 0.16],
        jitterColor(random, options.leafColor, 0.18),
        [(random() - 0.5) * 0.3, random() * Math.PI, (random() - 0.5) * 0.3],
      );
    }
  }
  for (let fruit = 0; fruit < options.fruits; fruit++) {
    const t = options.fruits === 1 ? 0.5 : fruit / (options.fruits - 1);
    const x = (t - 0.5) * options.radiusX * 1.1;
    const z = Math.sin(t * 4.2) * options.radiusZ * 0.42;
    const radius = options.fruitRadius;
    addBlob(
      options.fruitBucket === 'accent' ? accent : body,
      [radius, radius * options.fruitSquash, radius],
      [x, radius * options.fruitSquash, z],
      jitterColor(random, options.fruitColor, 0.1),
      [0, random() * Math.PI, 0],
      options.fruitSegments,
    );
  }
}

function buildCompostBin(context) {
  const { body, random } = context;
  const half = 0.5;
  const height = 0.8;
  const postSize = 0.1;
  const slatThickness = 0.06;
  const slatHeight = 0.14;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        body,
        [postSize, height, postSize],
        [sx * (half - postSize / 2), height / 2, sz * (half - postSize / 2)],
        PALETTE.plankLight,
      );
    }
  }
  for (const y of [0.15, 0.4, 0.65]) {
    for (const sz of [-1, 1]) {
      addBox(
        body,
        [0.92, slatHeight, slatThickness],
        [0, y, sz * (half - slatThickness / 2)],
        jitterColor(random, PALETTE.plank, 0.12),
      );
    }
    for (const sx of [-1, 1]) {
      addBox(
        body,
        [slatThickness, slatHeight, 0.92],
        [sx * (half - slatThickness / 2), y, 0],
        jitterColor(random, PALETTE.plankDark, 0.12),
      );
    }
  }

  body.push(
    prepareGeometry(
      makeFrustum(0.84, 0.78, 0.58, 0.84, 0.78),
      PALETTE.compostDeep,
      centerMatrix([0, 0.29, 0]),
    ),
  );
  for (const [x, z] of scatterPositions(random, 5, 0.3, 0.3)) {
    addBox(body, [0.16, 0.06, 0.13], [x, 0.58, z], jitterColor(random, PALETTE.compost, 0.2), [
      0,
      random() * Math.PI,
      0,
    ]);
  }
}

const BUILDERS = Object.freeze({
  farm_bed: buildBed,
  farm_sprout: buildSprout,
  farm_grain_stage2: (context) =>
    grainField(context, {
      count: 9,
      radiusX: 1.05,
      radiusZ: 0.62,
      height: 0.28,
      heightSpread: 0.13,
      lean: 0.2,
      stalkColor: PALETTE.leaf,
      headHeight: 0,
      headDroop: 0,
      headColor: PALETTE.accent,
      headBucket: 'body',
    }),
  farm_rootleaf_stage2: (context) =>
    rootleafField(context, {
      count: 4,
      radiusX: 0.92,
      radiusZ: 0.55,
      leaves: 5,
      tilt: 1.14,
      leafLength: 0.26,
      leafWidth: 0.11,
      leafColor: PALETTE.leaf,
      shoulderRadius: 0,
    }),
  farm_gourd_stage2: (context) =>
    gourdField(context, {
      vines: 2,
      radiusX: 0.85,
      radiusZ: 0.46,
      vineThickness: 0.035,
      leafRadius: 0.085,
      leafLift: 0.05,
      leafColor: PALETTE.leaf,
      vineColor: PALETTE.leafDeep,
      fruits: 0,
      fruitRadius: 0,
      fruitSquash: 1,
      fruitColor: PALETTE.accent,
      fruitBucket: 'body',
      fruitSegments: 6,
    }),
  farm_grain_stage3: (context) =>
    grainField(context, {
      count: 12,
      radiusX: 1.2,
      radiusZ: 0.72,
      height: 0.56,
      heightSpread: 0.16,
      lean: 0.16,
      stalkColor: PALETTE.stalk,
      headHeight: 0.15,
      headDroop: 0.1,
      headColor: PALETTE.accentDeep,
      headBucket: 'accent',
    }),
  farm_rootleaf_stage3: (context) =>
    rootleafField(context, {
      count: 5,
      radiusX: 1.06,
      radiusZ: 0.52,
      leaves: 6,
      tilt: 0.98,
      leafLength: 0.4,
      leafWidth: 0.15,
      leafColor: PALETTE.leaf,
      shoulderRadius: 0.1,
    }),
  farm_gourd_stage3: (context) =>
    gourdField(context, {
      vines: 3,
      radiusX: 1.12,
      radiusZ: 0.56,
      vineThickness: 0.045,
      leafRadius: 0.13,
      leafLift: 0.055,
      leafColor: PALETTE.leaf,
      vineColor: PALETTE.leafDeep,
      fruits: 2,
      fruitRadius: 0.11,
      fruitSquash: 0.82,
      fruitColor: PALETTE.accent,
      fruitBucket: 'accent',
      fruitSegments: 6,
    }),
  farm_grain_stage4: (context) =>
    grainField(context, {
      count: 14,
      radiusX: 1.25,
      radiusZ: 0.75,
      height: 0.72,
      heightSpread: 0.18,
      lean: 0.14,
      stalkColor: PALETTE.stalkPale,
      headHeight: 0.24,
      headDroop: 0.18,
      headColor: PALETTE.accent,
      headBucket: 'accent',
    }),
  farm_rootleaf_stage4: (context) =>
    rootleafField(context, {
      count: 6,
      radiusX: 0.98,
      radiusZ: 0.58,
      leaves: 7,
      tilt: 0.88,
      leafLength: 0.54,
      leafWidth: 0.19,
      leafColor: PALETTE.leafLight,
      shoulderRadius: 0.15,
    }),
  farm_gourd_stage4: (context) =>
    gourdField(context, {
      vines: 3,
      radiusX: 1.22,
      radiusZ: 0.6,
      vineThickness: 0.05,
      leafRadius: 0.16,
      leafLift: 0.045,
      leafColor: PALETTE.leafLight,
      vineColor: PALETTE.leafDeep,
      fruits: 1,
      fruitRadius: 0.23,
      fruitSquash: 0.86,
      fruitColor: PALETTE.accent,
      fruitBucket: 'accent',
      fruitSegments: 8,
    }),
  farm_grain_withered: (context) =>
    grainField(context, {
      count: 12,
      radiusX: 1.2,
      radiusZ: 0.72,
      height: 0.46,
      heightSpread: 0.14,
      lean: 0.5,
      stalkColor: PALETTE.wither,
      headHeight: 0.13,
      headDroop: 0.34,
      headColor: PALETTE.witherDeep,
      headBucket: 'body',
    }),
  farm_rootleaf_withered: (context) =>
    rootleafField(context, {
      count: 5,
      radiusX: 1.06,
      radiusZ: 0.52,
      leaves: 6,
      tilt: 1.32,
      leafLength: 0.38,
      leafWidth: 0.14,
      leafColor: PALETTE.wither,
      shoulderRadius: 0,
    }),
  farm_gourd_withered: (context) =>
    gourdField(context, {
      vines: 3,
      radiusX: 1.12,
      radiusZ: 0.56,
      vineThickness: 0.04,
      leafRadius: 0.11,
      leafLift: 0.04,
      leafColor: PALETTE.witherLight,
      vineColor: PALETTE.witherDeep,
      fruits: 1,
      fruitRadius: 0.1,
      fruitSquash: 0.68,
      fruitColor: PALETTE.wither,
      fruitBucket: 'body',
      fruitSegments: 6,
    }),
  farm_compost_bin: buildCompostBin,
});

function mergeBucket(bucket, label) {
  if (bucket.length === 0) return null;
  const merged = mergeGeometries(bucket, false);
  if (!merged) throw new Error(`could not merge farm prop ${label} geometry`);
  return merged;
}

// Seats the asset on Y=0, centers it on X/Z, and fits the contract footprint and
// height exactly, so the shipped bounds are the documented bounds.
function fitToContract(contract, geometries, sockets) {
  const box = new THREE.Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(
    contract.footprintYd[0] / size.x,
    contract.heightYd / size.y,
    contract.footprintYd[1] / size.z,
  );
  for (const axis of ['x', 'y', 'z']) {
    if (!(scale[axis] > 0.9 && scale[axis] < 1.15)) {
      throw new Error(
        `${contract.id} authored size ${size.toArray().join(', ')} drifted too far from its contract footprint and height`,
      );
    }
  }
  const matrix = new THREE.Matrix4()
    .makeScale(scale.x, scale.y, scale.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  for (const geometry of geometries) {
    geometry.applyMatrix4(matrix);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  for (const socket of sockets) {
    socket.position = new THREE.Vector3(...socket.position).applyMatrix4(matrix).toArray();
  }
}

function bodyMaterial() {
  return new THREE.MeshStandardMaterial({
    name: FARM_BODY_MATERIAL,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
  });
}

function accentMaterial() {
  return new THREE.MeshStandardMaterial({
    name: FARM_ACCENT_MATERIAL,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    vertexColors: true,
  });
}

export function createFarmProp(id) {
  const contract = FARM_PROP_CONTRACTS[id];
  if (!contract) throw new Error(`unknown farm prop: ${id}`);
  const context = { body: [], accent: [], sockets: [], random: createRandom(hashSeed(id)) };
  BUILDERS[id](context);

  const bodyGeometry = mergeBucket(context.body, 'body');
  if (!bodyGeometry) throw new Error(`${id} produced no body geometry`);
  const accentGeometry = mergeBucket(context.accent, 'accent');
  const wantsAccent = contract.materials.includes(FARM_ACCENT_MATERIAL);
  if (wantsAccent !== (accentGeometry !== null)) {
    throw new Error(`${id} accent geometry does not match its contract`);
  }
  const geometries = accentGeometry ? [bodyGeometry, accentGeometry] : [bodyGeometry];
  fitToContract(contract, geometries, context.sockets);

  const root = new THREE.Group();
  root.name = contract.rootNode;
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial());
  bodyMesh.name = FARM_BODY_MESH_NODE;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);
  if (accentGeometry) {
    const accentMesh = new THREE.Mesh(accentGeometry, accentMaterial());
    accentMesh.name = FARM_ACCENT_MESH_NODE;
    accentMesh.castShadow = true;
    accentMesh.receiveShadow = true;
    root.add(accentMesh);
  }
  for (const socket of context.sockets) {
    const node = new THREE.Object3D();
    node.name = socket.name;
    node.position.fromArray(socket.position);
    node.userData.farmPropSocket = { name: socket.name, purpose: socket.purpose };
    root.add(node);
  }

  root.userData.farmPropContract = JSON.parse(JSON.stringify(contract));
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: id,
    source: 'deterministic-procedural-threejs',
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    swapReady: true,
  };
  root.updateMatrixWorld(true);
  return root;
}
