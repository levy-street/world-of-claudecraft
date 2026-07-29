import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TOWN_BUCKET_KEYS = Object.freeze([
  'stone',
  'plaster',
  'timber',
  'roof',
  'metal',
  'warm',
  'arcane',
]);

export const TOWN_PALETTE = Object.freeze({
  stoneDeep: 0x30343a,
  stone: 0x555b61,
  stoneLight: 0x777d80,
  stoneEdge: 0x979b98,
  plasterDeep: 0x706b62,
  plaster: 0x999388,
  plasterLight: 0xb7b0a2,
  timberDeep: 0x211813,
  timberDark: 0x33251c,
  timber: 0x4c3829,
  timberLight: 0x704e32,
  roofDeep: 0x0c2454,
  roof: 0x153b88,
  roofLight: 0x2658b1,
  iron: 0x31363b,
  ironLight: 0x596067,
  gold: 0xa27320,
  goldLight: 0xd4a23c,
  warm: 0xffa127,
  warmBright: 0xffdc77,
  arcane: 0x21c6e8,
  arcanePale: 0x83efff,
  clothBlue: 0x315b9d,
  clothCream: 0xd6c29d,
  clothRed: 0xaa4c39,
  sackGreen: 0x788f36,
  sackOchre: 0xd4a12e,
  sackClay: 0xa95a45,
  water: 0x183e64,
  soot: 0x181718,
});

const SHIPPING_MATERIALS = Object.freeze({
  opaque: { name: 'TownOpaque', metalness: 0.04, roughness: 0.82 },
  emissive: {
    name: 'TownEmissive',
    metalness: 0,
    roughness: 0.32,
    emissive: 0x24221e,
    emissiveIntensity: 1.18,
  },
});

export function createTownBuckets() {
  return Object.fromEntries(TOWN_BUCKET_KEYS.map((key) => [key, []]));
}

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

export function addGeometry(buckets, bucket, geometry, color, options = {}) {
  if (!TOWN_BUCKET_KEYS.includes(bucket)) throw new Error(`unknown town bucket: ${bucket}`);
  buckets[bucket].push(
    preparedGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

export function addBox(buckets, bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(buckets, bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

export function addCylinder(
  buckets,
  bucket,
  radiusTop,
  radiusBottom,
  height,
  segments,
  position,
  color,
  rotation = [0, 0, 0],
) {
  addGeometry(
    buckets,
    bucket,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false),
    color,
    { position, rotation },
  );
}

export function addSphere(buckets, bucket, radius, position, color, scale = [1, 1, 1]) {
  addGeometry(buckets, bucket, new THREE.SphereGeometry(radius, 10, 7), color, {
    position,
    scale,
  });
}

export function addOctahedron(buckets, bucket, radius, position, color, scale = [1, 1, 1]) {
  addGeometry(buckets, bucket, new THREE.OctahedronGeometry(radius, 0), color, {
    position,
    scale,
  });
}

export function addTorus(
  buckets,
  bucket,
  radius,
  tube,
  position,
  color,
  rotation = [0, 0, 0],
  arc = Math.PI * 2,
) {
  addGeometry(buckets, bucket, new THREE.TorusGeometry(radius, tube, 4, 12, arc), color, {
    position,
    rotation,
  });
}

export function makePitchedRoof(width, depth, eaveY, peakY, ridgeAxis = 'x') {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  let vertices;
  let indices;
  if (ridgeAxis === 'x') {
    vertices = [
      -halfWidth,
      eaveY,
      -halfDepth,
      halfWidth,
      eaveY,
      -halfDepth,
      -halfWidth,
      peakY,
      0,
      halfWidth,
      peakY,
      0,
      -halfWidth,
      eaveY,
      halfDepth,
      halfWidth,
      eaveY,
      halfDepth,
    ];
    indices = [0, 2, 3, 0, 3, 1, 4, 5, 3, 4, 3, 2, 0, 4, 2, 1, 3, 5, 0, 1, 5, 0, 5, 4];
  } else if (ridgeAxis === 'z') {
    vertices = [
      -halfWidth,
      eaveY,
      -halfDepth,
      0,
      peakY,
      -halfDepth,
      halfWidth,
      eaveY,
      -halfDepth,
      -halfWidth,
      eaveY,
      halfDepth,
      0,
      peakY,
      halfDepth,
      halfWidth,
      eaveY,
      halfDepth,
    ];
    indices = [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3];
  } else {
    throw new Error(`unknown ridge axis: ${ridgeAxis}`);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addBeamBetween(buckets, bucket, start, end, thickness, depth, color, plane) {
  const first = new THREE.Vector2(start[0], start[1]);
  const second = new THREE.Vector2(end[0], end[1]);
  const delta = second.clone().sub(first);
  const length = delta.length();
  const middle = first.add(second).multiplyScalar(0.5);
  const angle = Math.atan2(delta.y, delta.x);
  if (plane === 'xy') {
    addBox(buckets, bucket, [length, thickness, depth], [middle.x, middle.y, start[2]], color, [
      0,
      0,
      angle,
    ]);
  } else {
    addBox(buckets, bucket, [depth, thickness, length], [start[2], middle.y, middle.x], color, [
      angle,
      0,
      0,
    ]);
  }
}

export function addBeamXY(buckets, bucket, start, end, z, thickness, depth, color) {
  addBeamBetween(
    buckets,
    bucket,
    [start[0], start[1], z],
    [end[0], end[1], z],
    thickness,
    depth,
    color,
    'xy',
  );
}

export function addBeamYZ(buckets, bucket, x, start, end, thickness, depth, color) {
  addBeamBetween(
    buckets,
    bucket,
    [start[1], start[0], x],
    [end[1], end[0], x],
    thickness,
    depth,
    color,
    'yz',
  );
}

function archedOutline(width, height, kind) {
  const halfWidth = width / 2;
  const shoulder = -height / 2 + height * (kind === 'pointed' ? 0.58 : 0.56);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -height / 2);
  shape.lineTo(halfWidth, -height / 2);
  shape.lineTo(halfWidth, shoulder);
  if (kind === 'pointed') {
    shape.quadraticCurveTo(halfWidth * 0.92, height * 0.3, 0, height / 2);
    shape.quadraticCurveTo(-halfWidth * 0.92, height * 0.3, -halfWidth, shoulder);
  } else {
    shape.quadraticCurveTo(halfWidth * 0.92, height / 2, 0, height / 2);
    shape.quadraticCurveTo(-halfWidth * 0.92, height / 2, -halfWidth, shoulder);
  }
  shape.closePath();
  return shape;
}

export function makeArchedPanel(width, height, depth, kind = 'rounded') {
  const geometry = new THREE.ExtrudeGeometry(archedOutline(width, height, kind), {
    depth,
    bevelEnabled: false,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

export function makeArchedFrame(
  outerWidth,
  outerHeight,
  innerWidth,
  innerHeight,
  depth,
  kind = 'rounded',
) {
  const shape = archedOutline(outerWidth, outerHeight, kind);
  const opening = archedOutline(innerWidth, innerHeight, kind);
  const points = opening.getPoints(16);
  const hole = new THREE.Path();
  hole.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) hole.lineTo(points[index].x, points[index].y);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function wallTransform(face, center) {
  if (face === 'front') return { position: center, rotation: [0, 0, 0] };
  if (face === 'back') return { position: center, rotation: [0, Math.PI, 0] };
  if (face === 'right') return { position: center, rotation: [0, Math.PI / 2, 0] };
  if (face === 'left') return { position: center, rotation: [0, -Math.PI / 2, 0] };
  throw new Error(`unknown wall face: ${face}`);
}

export function addArchedWindow(buckets, options) {
  const {
    face = 'front',
    center,
    width = 0.62,
    height = 1.05,
    kind = 'rounded',
    frameBucket = 'timber',
    frameColor = TOWN_PALETTE.timberDark,
  } = options;
  const transform = wallTransform(face, center);
  addGeometry(
    buckets,
    'warm',
    makeArchedPanel(width * 0.68, height * 0.76, 0.045, kind),
    TOWN_PALETTE.warm,
    transform,
  );
  addGeometry(
    buckets,
    frameBucket,
    makeArchedFrame(width, height, width * 0.68, height * 0.76, 0.085, kind),
    frameColor,
    {
      ...transform,
      position: [
        transform.position[0] + (face === 'right' ? 0.035 : face === 'left' ? -0.035 : 0),
        transform.position[1],
        transform.position[2] + (face === 'front' ? 0.035 : face === 'back' ? -0.035 : 0),
      ],
    },
  );
  const mullionDepth = 0.1;
  if (face === 'front' || face === 'back') {
    addBox(
      buckets,
      frameBucket,
      [0.055, height * 0.62, mullionDepth],
      [center[0], center[1] - height * 0.08, center[2] + (face === 'front' ? 0.06 : -0.06)],
      frameColor,
    );
    addBox(
      buckets,
      frameBucket,
      [width * 0.64, 0.055, mullionDepth],
      [center[0], center[1] - height * 0.04, center[2] + (face === 'front' ? 0.061 : -0.061)],
      frameColor,
    );
  } else {
    addBox(
      buckets,
      frameBucket,
      [mullionDepth, height * 0.62, 0.055],
      [center[0] + (face === 'right' ? 0.06 : -0.06), center[1] - height * 0.08, center[2]],
      frameColor,
    );
    addBox(
      buckets,
      frameBucket,
      [mullionDepth, 0.055, width * 0.64],
      [center[0] + (face === 'right' ? 0.061 : -0.061), center[1] - height * 0.04, center[2]],
      frameColor,
    );
  }
}

export function addArchedDoor(buckets, options) {
  const {
    face = 'front',
    center,
    width = 1.08,
    height = 1.82,
    kind = 'rounded',
    frameBucket = 'stone',
    frameColor = TOWN_PALETTE.stoneLight,
  } = options;
  const transform = wallTransform(face, center);
  addGeometry(
    buckets,
    'timber',
    makeArchedPanel(width * 0.72, height * 0.8, 0.055, kind),
    TOWN_PALETTE.timberDeep,
    transform,
  );
  addGeometry(
    buckets,
    frameBucket,
    makeArchedFrame(width, height, width * 0.72, height * 0.8, 0.12, kind),
    frameColor,
    {
      ...transform,
      position: [
        center[0] + (face === 'right' ? 0.055 : face === 'left' ? -0.055 : 0),
        center[1],
        center[2] + (face === 'front' ? 0.055 : face === 'back' ? -0.055 : 0),
      ],
    },
  );
  if (face === 'front' || face === 'back') {
    for (const x of [-0.22, 0, 0.22]) {
      addBox(
        buckets,
        'timber',
        [0.045, height * 0.58, 0.07],
        [
          center[0] + x * width,
          center[1] - height * 0.11,
          center[2] + (face === 'front' ? 0.075 : -0.075),
        ],
        x === 0 ? TOWN_PALETTE.timber : TOWN_PALETTE.timberDark,
      );
    }
    addOctahedron(
      buckets,
      'metal',
      0.065,
      [
        center[0] + width * 0.2,
        center[1] - height * 0.12,
        center[2] + (face === 'front' ? 0.115 : -0.115),
      ],
      TOWN_PALETTE.gold,
      [0.75, 1, 0.38],
    );
  }
}

export function addFoundation(buckets, width, depth, options = {}) {
  const height = options.height ?? 0.24;
  addBox(
    buckets,
    'stone',
    [width, height, depth],
    [options.centerX ?? 0, height / 2 + (options.baseY ?? 0), options.centerZ ?? 0],
    options.color ?? TOWN_PALETTE.stoneDeep,
  );
  const courseHeight = height * 0.48;
  addBox(
    buckets,
    'stone',
    [width * 0.94, courseHeight, depth * 0.94],
    [options.centerX ?? 0, height + courseHeight / 2 + (options.baseY ?? 0), options.centerZ ?? 0],
    TOWN_PALETTE.stoneLight,
  );
}

export function addGableShell(buckets, options) {
  const {
    width,
    depth,
    wallHeight,
    peakY,
    ridgeAxis = 'x',
    centerX = 0,
    centerZ = 0,
    baseY = 0.34,
    bodyColor = TOWN_PALETTE.plaster,
  } = options;
  addBox(
    buckets,
    'plaster',
    [width * 0.91, wallHeight - baseY, depth * 0.89],
    [centerX, baseY + (wallHeight - baseY) / 2, centerZ],
    bodyColor,
  );
  addBox(
    buckets,
    'stone',
    [width * 0.94, 0.54, depth * 0.92],
    [centerX, baseY + 0.27, centerZ],
    TOWN_PALETTE.stone,
  );
  addGeometry(
    buckets,
    'roof',
    makePitchedRoof(width, depth, wallHeight, peakY, ridgeAxis),
    TOWN_PALETTE.roof,
    { position: [centerX, 0, centerZ] },
  );

  const insetX = width * 0.455;
  const insetZ = depth * 0.445;
  for (const x of [-insetX, insetX]) {
    addBox(
      buckets,
      'timber',
      [0.18, wallHeight - baseY + 0.16, 0.2],
      [centerX + x, baseY + (wallHeight - baseY) / 2, centerZ + insetZ],
      x < 0 ? TOWN_PALETTE.timberDark : TOWN_PALETTE.timber,
    );
    addBox(
      buckets,
      'timber',
      [0.18, wallHeight - baseY + 0.16, 0.2],
      [centerX + x, baseY + (wallHeight - baseY) / 2, centerZ - insetZ],
      x < 0 ? TOWN_PALETTE.timberDark : TOWN_PALETTE.timber,
    );
  }
  addBox(
    buckets,
    'timber',
    [width * 0.95, 0.18, 0.22],
    [centerX, wallHeight - 0.02, centerZ + insetZ],
    TOWN_PALETTE.timberDark,
  );
  addBox(
    buckets,
    'timber',
    [width * 0.95, 0.18, 0.22],
    [centerX, wallHeight - 0.02, centerZ - insetZ],
    TOWN_PALETTE.timber,
  );
  addRoofTrim(buckets, { width, depth, wallHeight, peakY, ridgeAxis, centerX, centerZ });
  addRoofCourses(buckets, { width, depth, wallHeight, peakY, ridgeAxis, centerX, centerZ });
}

export function addRoofTrim(buckets, options) {
  const { width, depth, wallHeight, peakY, ridgeAxis, centerX = 0, centerZ = 0 } = options;
  if (ridgeAxis === 'x') {
    addBox(
      buckets,
      'timber',
      [width * 1.02, 0.16, 0.16],
      [centerX, peakY - 0.05, centerZ],
      TOWN_PALETTE.timberDark,
    );
    for (const z of [-depth / 2, depth / 2]) {
      addBox(
        buckets,
        'timber',
        [width * 1.02, 0.18, 0.18],
        [centerX, wallHeight, centerZ + z],
        TOWN_PALETTE.timber,
      );
    }
  } else {
    addBox(
      buckets,
      'timber',
      [0.16, 0.16, depth * 1.02],
      [centerX, peakY - 0.05, centerZ],
      TOWN_PALETTE.timberDark,
    );
    for (const x of [-width / 2, width / 2]) {
      addBox(
        buckets,
        'timber',
        [0.18, 0.18, depth * 1.02],
        [centerX + x, wallHeight, centerZ],
        TOWN_PALETTE.timber,
      );
    }
  }
}

export function addRoofCourses(buckets, options) {
  const { width, depth, wallHeight, peakY, ridgeAxis, centerX = 0, centerZ = 0 } = options;
  const rise = peakY - wallHeight;
  if (ridgeAxis === 'x') {
    const slopeAngle = Math.atan2(rise, depth / 2);
    const surfaceLength = Math.hypot(depth / 2, rise);
    for (const side of [-1, 1]) {
      for (const fraction of [0.18, 0.38, 0.58, 0.78]) {
        const z = side * (depth / 2) * (1 - fraction);
        const y = wallHeight + rise * fraction + 0.025;
        addBox(
          buckets,
          'roof',
          [width * 0.96, 0.035, surfaceLength * 0.025],
          [centerX, y, centerZ + z],
          fraction === 0.58 ? TOWN_PALETTE.roofLight : TOWN_PALETTE.roofDeep,
          [side * slopeAngle, 0, 0],
        );
      }
    }
  } else {
    const slopeAngle = Math.atan2(rise, width / 2);
    const surfaceLength = Math.hypot(width / 2, rise);
    for (const side of [-1, 1]) {
      for (const fraction of [0.18, 0.38, 0.58, 0.78]) {
        const x = side * (width / 2) * (1 - fraction);
        const y = wallHeight + rise * fraction + 0.025;
        addBox(
          buckets,
          'roof',
          [surfaceLength * 0.025, 0.035, depth * 0.96],
          [centerX + x, y, centerZ],
          fraction === 0.58 ? TOWN_PALETTE.roofLight : TOWN_PALETTE.roofDeep,
          [0, 0, -side * slopeAngle],
        );
      }
    }
  }
}

export function addGableFrame(buckets, options) {
  const { width, wallHeight, peakY, z, color = TOWN_PALETTE.timberDark, beam = 0.13 } = options;
  addBeamXY(buckets, 'timber', [-width / 2, wallHeight], [0, peakY], z, beam, 0.15, color);
  addBeamXY(buckets, 'timber', [0, peakY], [width / 2, wallHeight], z, beam, 0.15, color);
  addBox(
    buckets,
    'timber',
    [beam, peakY - wallHeight, 0.16],
    [0, wallHeight + (peakY - wallHeight) / 2, z],
    color,
  );
}

export function addSteps(buckets, centerX, frontZ, width, count = 3, direction = 1) {
  for (let index = 0; index < count; index++) {
    const depth = 0.34 + index * 0.1;
    const height = 0.11;
    addBox(
      buckets,
      'stone',
      [width + index * 0.18, height, depth],
      [centerX, height / 2 + index * height, frontZ + direction * index * 0.11],
      index % 2 === 0 ? TOWN_PALETTE.stoneLight : TOWN_PALETTE.stone,
    );
  }
}

export function addBarrel(buckets, position, scale = 1) {
  const [x, y, z] = position;
  addCylinder(
    buckets,
    'timber',
    0.27 * scale,
    0.3 * scale,
    0.62 * scale,
    10,
    [x, y + 0.31 * scale, z],
    TOWN_PALETTE.timber,
  );
  for (const offset of [-0.22, 0.22]) {
    addCylinder(
      buckets,
      'metal',
      0.305 * scale,
      0.305 * scale,
      0.055 * scale,
      10,
      [x, y + (0.31 + offset) * scale, z],
      TOWN_PALETTE.iron,
      [0, 0, 0],
    );
  }
  addCylinder(
    buckets,
    'timber',
    0.255 * scale,
    0.255 * scale,
    0.035 * scale,
    10,
    [x, y + 0.63 * scale, z],
    TOWN_PALETTE.timberLight,
  );
}

export function addCrate(buckets, position, size = [0.62, 0.58, 0.58]) {
  const [x, y, z] = position;
  addBox(buckets, 'timber', size, [x, y + size[1] / 2, z], TOWN_PALETTE.timber);
  const frame = 0.07;
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [frame, size[1] * 0.92, size[2] + 0.03],
      [x + sx * (size[0] / 2 - frame / 2), y + size[1] / 2, z],
      TOWN_PALETTE.timberDark,
    );
  }
  addBeamXY(
    buckets,
    'timber',
    [x - size[0] * 0.38, y + size[1] * 0.15],
    [x + size[0] * 0.38, y + size[1] * 0.85],
    z + size[2] / 2 + 0.02,
    frame,
    0.07,
    TOWN_PALETTE.timberDeep,
  );
}

export function addLantern(buckets, position, scale = 1) {
  const [x, y, z] = position;
  addBox(
    buckets,
    'metal',
    [0.28 * scale, 0.05 * scale, 0.22 * scale],
    [x, y - 0.2 * scale, z],
    TOWN_PALETTE.iron,
  );
  addBox(
    buckets,
    'metal',
    [0.28 * scale, 0.05 * scale, 0.22 * scale],
    [x, y + 0.2 * scale, z],
    TOWN_PALETTE.gold,
  );
  addBox(
    buckets,
    'warm',
    [0.18 * scale, 0.34 * scale, 0.13 * scale],
    [x, y, z],
    TOWN_PALETTE.warmBright,
  );
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'metal',
      [0.035 * scale, 0.42 * scale, 0.035 * scale],
      [x + sx * 0.13 * scale, y, z],
      TOWN_PALETTE.iron,
    );
  }
}

export function addCrystal(buckets, position, scale = 1) {
  const [x, y, z] = position;
  addCylinder(
    buckets,
    'metal',
    0.19 * scale,
    0.22 * scale,
    0.12 * scale,
    8,
    [x, y, z],
    TOWN_PALETTE.gold,
  );
  addOctahedron(
    buckets,
    'arcane',
    0.34 * scale,
    [x, y + 0.35 * scale, z],
    TOWN_PALETTE.arcanePale,
    [0.72, 1.45, 0.72],
  );
}

export function addBench(buckets, position, yaw = 0, scale = 1) {
  const group = { position, rotation: [0, yaw, 0] };
  const addLocalBox = (bucket, size, local, color) => {
    const parent = matrixFor(group.position, group.rotation);
    const localMatrix = matrixFor(local);
    addGeometry(
      buckets,
      bucket,
      new THREE.BoxGeometry(...size.map((value) => value * scale)),
      color,
      {
        position: [0, 0, 0],
      },
    );
    const geometry = buckets[bucket].pop();
    geometry.applyMatrix4(parent.multiply(localMatrix));
    buckets[bucket].push(geometry);
  };
  addLocalBox('timber', [1.08, 0.13, 0.34], [0, 0.5 * scale, 0], TOWN_PALETTE.timberLight);
  addLocalBox('timber', [1.08, 0.12, 0.13], [0, 0.73 * scale, -0.13 * scale], TOWN_PALETTE.timber);
  for (const x of [-0.42, 0.42]) {
    addLocalBox('stone', [0.16, 0.46, 0.22], [x * scale, 0.23 * scale, 0], TOWN_PALETTE.stoneDeep);
    addLocalBox('metal', [0.19, 0.08, 0.25], [x * scale, 0.55 * scale, 0], TOWN_PALETTE.gold);
  }
}

export function addSack(buckets, position, color, scale = 1) {
  addSphere(
    buckets,
    'plaster',
    0.28 * scale,
    [position[0], position[1] + 0.28 * scale, position[2]],
    color,
    [0.82, 1.15, 0.72],
  );
  addCylinder(
    buckets,
    'timber',
    0.07 * scale,
    0.09 * scale,
    0.08 * scale,
    7,
    [position[0], position[1] + 0.56 * scale, position[2]],
    TOWN_PALETTE.timberDark,
  );
}

function makeMaterials() {
  return Object.fromEntries(
    Object.entries(SHIPPING_MATERIALS).map(([key, definition]) => {
      return [
        key,
        new THREE.MeshStandardMaterial({
          name: definition.name,
          color: 0xffffff,
          vertexColors: true,
          metalness: definition.metalness,
          roughness: definition.roughness,
          emissive: definition.emissive ?? 0x000000,
          emissiveIntensity: definition.emissiveIntensity ?? 1,
        }),
      ];
    }),
  );
}

function draftBounds(buckets) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    }
  }
  if (bounds.isEmpty()) throw new Error('town asset has no geometry');
  return bounds;
}

function normalizeBuckets(buckets, target) {
  const bounds = draftBounds(buckets);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(
    target.width / size.x,
    target.height / size.y,
    target.depth / size.z,
  );
  const translate = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
  const stretch = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.applyMatrix4(translate);
      geometry.applyMatrix4(stretch);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  }
  return {
    point(value) {
      return [
        (value[0] - center.x) * scale.x,
        (value[1] - bounds.min.y) * scale.y,
        (value[2] - center.z) * scale.z,
      ];
    },
  };
}

export function finishTownAsset(contract, buckets) {
  const normalization = normalizeBuckets(buckets, contract.dimensions);
  const root = new THREE.Group();
  root.name = contract.rootName;
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: contract.id,
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...contract.dimensions },
    serviceCues: [...contract.serviceCues],
    interaction: { mode: 'static-town-asset', interactive: false },
    collider: { shippingCollisionMesh: false },
    destruction: { breakable: false, detachableParts: [] },
  };
  const materials = makeMaterials();
  const shippingBuckets = {
    opaque: TOWN_BUCKET_KEYS.filter((key) => key !== 'warm' && key !== 'arcane').flatMap(
      (key) => buckets[key],
    ),
    emissive: [...buckets.warm, ...buckets.arcane],
  };
  for (const [key, geometries] of Object.entries(shippingBuckets)) {
    if (geometries.length === 0) continue;
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`failed to merge ${contract.id} ${key} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = `${contract.rootName}_${SHIPPING_MATERIALS[key].name}`;
    mesh.castShadow = key === 'opaque';
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const socketEntries = {};
  for (const definition of contract.sockets) {
    const socket = new THREE.Object3D();
    socket.name = definition.name;
    socket.position.fromArray(normalization.point(definition.position));
    socket.userData.sculptSocket = {
      id: definition.id,
      purpose: definition.purpose,
      interactive: false,
    };
    root.add(socket);
    socketEntries[definition.id] = {
      nodeName: definition.name,
      position: socket.position.toArray(),
      purpose: definition.purpose,
      interactive: false,
    };
  }
  root.userData.sculptRuntime.sockets = socketEntries;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  for (const [label, actual, expected] of [
    ['width', size.x, contract.dimensions.width],
    ['height', size.y, contract.dimensions.height],
    ['depth', size.z, contract.dimensions.depth],
    ['floor', bounds.min.y, 0],
    ['centerX', bounds.getCenter(new THREE.Vector3()).x, 0],
    ['centerZ', bounds.getCenter(new THREE.Vector3()).z, 0],
  ]) {
    if (Math.abs(actual - expected) > 1e-4) {
      throw new Error(`${contract.id} ${label} expected ${expected}, got ${actual}`);
    }
  }
  return root;
}
