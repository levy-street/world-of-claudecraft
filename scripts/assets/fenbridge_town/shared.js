import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FENBRIDGE_BUCKET_KEYS = Object.freeze([
  'stone',
  'timber',
  'roof',
  'cloth',
  'metal',
  'parchment',
  'organic',
  'warm',
  'fenlight',
]);

// These vertex colors are the semantic palette authority. Runtime surface
// detail may multiply them by the shared atlas, but the GLBs remain readable
// and correctly colored without any texture present.
export const FENBRIDGE_PALETTE = Object.freeze({
  stoneDeep: 0x2e3431,
  stone: 0x4e5650,
  stoneLight: 0x74776b,
  moss: 0x59613a,
  timberDeep: 0x1d1713,
  timberDark: 0x34271e,
  timber: 0x523b29,
  timberLight: 0x765236,
  roofDeep: 0x103a3c,
  roof: 0x176269,
  roofLight: 0x2d8585,
  iron: 0x34383a,
  ironLight: 0x62676a,
  brass: 0x9b762d,
  brassLight: 0xd1a952,
  clothTeal: 0x276a6f,
  rope: 0x8d7650,
  parchment: 0xd3be8c,
  parchmentDark: 0xa58a5f,
  hide: 0x9e7449,
  mud: 0x604c36,
  potionGlass: 0x6269a5,
  herb: 0x587b3d,
  wax: 0xa42632,
  water: 0x194d59,
  warm: 0xffa43a,
  warmBright: 0xffdd77,
  fenlight: 0x30e4d1,
  fenlightPale: 0x90fff0,
});

export const FENBRIDGE_SURFACE_CELLS = Object.freeze([
  Object.freeze({ id: 'mossStone', color: 0x4e5650 }),
  Object.freeze({ id: 'cleanStone', color: 0x74776b }),
  Object.freeze({ id: 'darkTimber', color: 0x34271e }),
  Object.freeze({ id: 'warmTimber', color: 0x523b29 }),
  Object.freeze({ id: 'tealShingles', color: 0x176269 }),
  Object.freeze({ id: 'forgedIron', color: 0x34383a }),
  Object.freeze({ id: 'agedBrass', color: 0x9b762d }),
  Object.freeze({ id: 'rope', color: 0x8d7650 }),
  Object.freeze({ id: 'tealCanvas', color: 0x276a6f }),
  Object.freeze({ id: 'parchment', color: 0xd3be8c }),
  Object.freeze({ id: 'curedHide', color: 0x9e7449 }),
  Object.freeze({ id: 'packedMud', color: 0x604c36 }),
  Object.freeze({ id: 'tealFenlight', color: 0x30e4d1 }),
  Object.freeze({ id: 'potionGlass', color: 0x6269a5 }),
  Object.freeze({ id: 'rawBoard', color: 0x765236 }),
  Object.freeze({ id: 'redWax', color: 0xa42632 }),
]);

const SHIPPING_MATERIALS = Object.freeze({
  opaque: Object.freeze({
    name: 'FenbridgeOpaque',
    metalness: 0.04,
    roughness: 0.84,
  }),
  emissive: Object.freeze({
    name: 'FenbridgeEmissive',
    metalness: 0,
    roughness: 0.3,
    emissive: 0x223c36,
    emissiveIntensity: 1.2,
  }),
});

export function createFenbridgeBuckets() {
  return Object.fromEntries(FENBRIDGE_BUCKET_KEYS.map((key) => [key, []]));
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
  for (const attribute of ['uv', 'uv1', 'uv2', 'tangent']) geometry.deleteAttribute(attribute);
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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function addGeometry(buckets, bucket, geometry, color, options = {}) {
  if (!FENBRIDGE_BUCKET_KEYS.includes(bucket)) {
    throw new Error(`unknown Fenbridge geometry bucket: ${bucket}`);
  }
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
  addGeometry(buckets, bucket, new THREE.SphereGeometry(radius, 8, 6), color, {
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
  addGeometry(buckets, bucket, new THREE.TorusGeometry(radius, tube, 4, 10, arc), color, {
    position,
    rotation,
  });
}

function addBeamBetween(buckets, bucket, start, end, thickness, depth, color, plane) {
  const first = new THREE.Vector2(start[0], start[1]);
  const second = new THREE.Vector2(end[0], end[1]);
  const delta = second.clone().sub(first);
  const length = delta.length();
  if (!(length > 0)) throw new Error('Fenbridge beam endpoints must differ');
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

function pitchedRoofGeometry(width, depth, eaveY, peakY, ridgeAxis) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  let vertices;
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
  } else {
    throw new Error(`unknown Fenbridge roof ridge axis: ${ridgeAxis}`);
  }
  const indices =
    ridgeAxis === 'x'
      ? [0, 2, 3, 0, 3, 1, 4, 5, 3, 4, 3, 2, 0, 4, 2, 1, 3, 5, 0, 1, 5, 0, 5, 4]
      : [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function addPitchedRoof(buckets, bucket, width, depth, eaveY, peakY, color, options = {}) {
  const ridgeAxis = options.ridgeAxis ?? 'x';
  addGeometry(buckets, bucket, pitchedRoofGeometry(width, depth, eaveY, peakY, ridgeAxis), color, {
    position: options.center ?? [0, 0, 0],
  });
}

/**
 * Exterior-only vertical plank face. Builds readable timber boards without
 * shipping interior wall volume. face: front (+Z), rear (-Z), right (+X), left (-X).
 */
export function addVerticalPlankFace(
  buckets,
  face,
  width,
  height,
  center,
  {
    plankCount = Math.max(6, Math.round(width / 0.42)),
    plankDepth = 0.07,
    colors = [
      FENBRIDGE_PALETTE.timber,
      FENBRIDGE_PALETTE.timberDark,
      FENBRIDGE_PALETTE.timberDeep,
      FENBRIDGE_PALETTE.timberLight,
    ],
    stagger = 0.04,
  } = {},
) {
  const [cx, cy, cz] = center;
  const plankWidth = width / plankCount;
  for (let index = 0; index < plankCount; index += 1) {
    const lateral = -width / 2 + plankWidth * (index + 0.5);
    const lift = ((index % 3) - 1) * stagger * 0.35;
    const color = colors[index % colors.length];
    const slim = plankWidth * (index % 4 === 2 ? 0.82 : 0.94);
    if (face === 'front' || face === 'rear') {
      const z = cz + (face === 'front' ? plankDepth / 2 : -plankDepth / 2);
      addBox(
        buckets,
        'timber',
        [slim, height * (0.96 + (index % 2) * 0.03), plankDepth],
        [cx + lateral, cy + lift, z],
        color,
      );
    } else {
      const x = cx + (face === 'right' ? plankDepth / 2 : -plankDepth / 2);
      addBox(
        buckets,
        'timber',
        [plankDepth, height * (0.96 + (index % 2) * 0.03), slim],
        [x, cy + lift, cz + lateral],
        color,
      );
    }
  }
  // Top and bottom plate boards lock the face silhouette.
  if (face === 'front' || face === 'rear') {
    const z = cz + (face === 'front' ? plankDepth * 0.7 : -plankDepth * 0.7);
    addBox(
      buckets,
      'timber',
      [width * 1.01, 0.11, plankDepth * 1.15],
      [cx, cy + height / 2 - 0.05, z],
      FENBRIDGE_PALETTE.timberDark,
    );
    addBox(
      buckets,
      'timber',
      [width * 1.01, 0.12, plankDepth * 1.15],
      [cx, cy - height / 2 + 0.06, z],
      FENBRIDGE_PALETTE.timberDeep,
    );
  } else {
    const x = cx + (face === 'right' ? plankDepth * 0.7 : -plankDepth * 0.7);
    addBox(
      buckets,
      'timber',
      [plankDepth * 1.15, 0.11, width * 1.01],
      [x, cy + height / 2 - 0.05, cz],
      FENBRIDGE_PALETTE.timberDark,
    );
    addBox(
      buckets,
      'timber',
      [plankDepth * 1.15, 0.12, width * 1.01],
      [x, cy - height / 2 + 0.06, cz],
      FENBRIDGE_PALETTE.timberDeep,
    );
  }
}

/**
 * Pitched roof with shingle course strips. Exterior-only: base plane plus
 * overlapping courses and a ridge cap. ridgeAxis 'x' means ridge runs along X.
 */
export function addShingledRoof(buckets, width, depth, eaveY, peakY, options = {}) {
  const ridgeAxis = options.ridgeAxis ?? 'x';
  const center = options.center ?? [0, 0, 0];
  const [cx, , cz] = center;
  const courses = options.courses ?? 8;
  const deep = options.deepColor ?? FENBRIDGE_PALETTE.roofDeep;
  const mid = options.color ?? FENBRIDGE_PALETTE.roof;
  const light = options.lightColor ?? FENBRIDGE_PALETTE.roofLight;

  // Thin solid under-roof for continuous silhouette and atlas binding.
  addPitchedRoof(buckets, 'roof', width, depth, eaveY, peakY, mid, {
    ridgeAxis,
    center,
  });

  const rise = peakY - eaveY;
  if (!(rise > 0.05)) return;

  // Course centers sit ON the slope: t=0 at eave (±half), t=1 at ridge (0).
  // Earlier placement inverted that (high courses drifted outward) and read as
  // floating shelves / fans. Match addBentConceptRoof: along-slope * (1 - t).
  if (ridgeAxis === 'x') {
    const halfDepth = depth / 2;
    const pitch = Math.atan2(rise, halfDepth);
    for (const slope of [-1, 1]) {
      for (let course = 0; course < courses; course += 1) {
        const midT = (course + 0.55) / courses;
        // Slight normal lift so boards rest on the continuous under-roof.
        const y = eaveY + rise * midT + 0.04 * Math.cos(pitch);
        const z = cz + slope * halfDepth * (1 - midT);
        const courseDepth = Math.max(0.16, halfDepth / courses + 0.05);
        const color = course % 3 === 0 ? deep : course % 2 === 0 ? mid : light;
        addBox(buckets, 'roof', [width * 1.02, 0.05, courseDepth], [cx, y, z], color, [
          slope * pitch * 0.95,
          0,
          0,
        ]);
      }
    }
    addBox(buckets, 'roof', [width * 1.04, 0.1, 0.22], [cx, peakY + 0.05, cz], deep);
    addBox(
      buckets,
      'timber',
      [width * 1.06, 0.08, 0.1],
      [cx, peakY + 0.11, cz],
      FENBRIDGE_PALETTE.timberDark,
    );
  } else {
    const halfWidth = width / 2;
    const pitch = Math.atan2(rise, halfWidth);
    for (const slope of [-1, 1]) {
      for (let course = 0; course < courses; course += 1) {
        const midT = (course + 0.55) / courses;
        const y = eaveY + rise * midT + 0.04 * Math.cos(pitch);
        const x = cx + slope * halfWidth * (1 - midT);
        const courseDepth = Math.max(0.16, halfWidth / courses + 0.05);
        const color = course % 3 === 0 ? deep : course % 2 === 0 ? mid : light;
        addBox(buckets, 'roof', [courseDepth, 0.05, depth * 1.02], [x, y, cz], color, [
          0,
          0,
          -slope * pitch * 0.95,
        ]);
      }
    }
    addBox(buckets, 'roof', [0.22, 0.1, depth * 1.04], [cx, peakY + 0.05, cz], deep);
  }
}

/**
 * Continuous bent marsh roof that seats on the wall plate (no floating
 * segments). Ridge height follows a lift profile along X; both slopes share
 * the same eave line so side views stay closed against the timber shell.
 * profile: [[xFraction -0.5..0.5, ridgeLift], ...] lifts above peakY.
 */
export function addBentConceptRoof(buckets, width, depth, eaveY, peakY, options = {}) {
  const center = options.center ?? [0, 0, 0];
  const [cx, , cz] = center;
  const profile = options.profile ?? [
    [-0.5, 0.55],
    [-0.3, 0.12],
    [-0.08, -0.04],
    [0.12, 0.0],
    [0.32, 0.14],
    [0.5, 0.5],
  ];
  const courses = options.courses ?? 9;
  const deep = options.deepColor ?? FENBRIDGE_PALETTE.roofDeep;
  const mid = options.color ?? FENBRIDGE_PALETTE.roof;
  const light = options.lightColor ?? FENBRIDGE_PALETTE.roofLight;
  const halfD = depth / 2;
  const halfW = width / 2;
  const strips = options.strips ?? 14;

  function ridgeLiftAt(xFraction) {
    // Piecewise-linear lift from profile fractions in [-0.5, 0.5].
    if (xFraction <= profile[0][0]) return profile[0][1];
    if (xFraction >= profile[profile.length - 1][0]) return profile[profile.length - 1][1];
    for (let index = 0; index < profile.length - 1; index += 1) {
      const [f0, l0] = profile[index];
      const [f1, l1] = profile[index + 1];
      if (xFraction >= f0 && xFraction <= f1) {
        const t = (xFraction - f0) / Math.max(1e-6, f1 - f0);
        return l0 + (l1 - l0) * t;
      }
    }
    return 0;
  }

  // Continuous under-roof: strip quads from eave to ridge on both slopes.
  // Eave Y is constant so the plate meets the wall; only the ridge bends.
  const positions = [];
  const indices = [];
  let vertex = 0;
  for (let strip = 0; strip < strips; strip += 1) {
    const f0 = -0.5 + strip / strips;
    const f1 = -0.5 + (strip + 1) / strips;
    const x0 = cx + f0 * width;
    const x1 = cx + f1 * width;
    const ridgeY0 = peakY + ridgeLiftAt(f0);
    const ridgeY1 = peakY + ridgeLiftAt(f1);
    // Front slope (toward +Z), rear slope (toward -Z).
    for (const slope of [1, -1]) {
      const zEave = cz + slope * halfD;
      const zRidge = cz;
      const base = vertex;
      positions.push(x0, eaveY, zEave, x1, eaveY, zEave, x1, ridgeY1, zRidge, x0, ridgeY0, zRidge);
      // Winding so outward normals face away from the building mass.
      if (slope > 0) {
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else {
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      vertex += 4;
    }
  }
  // Closed gable triangles at each end so the roof does not read as a thin shell.
  // These faces get the roof semantic for atlas mapping; timber bargeboards and
  // battens below give them readable structure from the side.
  for (const end of [-1, 1]) {
    const f = end * 0.5;
    const x = cx + f * width;
    const ridgeY = peakY + ridgeLiftAt(f);
    const base = vertex;
    positions.push(x, eaveY, cz + halfD, x, ridgeY, cz, x, eaveY, cz - halfD);
    if (end < 0) indices.push(base, base + 1, base + 2);
    else indices.push(base, base + 2, base + 1);
    vertex += 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  addGeometry(buckets, 'roof', geometry, mid);

  // Gable-end detail: bargeboards + horizontal battens so side views are not a
  // blank teal triangle. Outward offset keeps them on the exterior.
  for (const end of [-1, 1]) {
    const f = end * 0.5;
    const x = cx + f * width + end * 0.04;
    const ridgeY = peakY + ridgeLiftAt(f);
    // Bargeboards along both roof edges of the gable.
    for (const slope of [-1, 1]) {
      const zEave = cz + slope * halfD;
      const midY = (eaveY + ridgeY) * 0.5;
      const midZ = (zEave + cz) * 0.5;
      const len = Math.hypot(ridgeY - eaveY, zEave - cz);
      const pitch = Math.atan2(ridgeY - eaveY, Math.abs(zEave - cz));
      addBox(buckets, 'timber', [0.08, 0.1, len], [x, midY, midZ], FENBRIDGE_PALETTE.timberDark, [
        slope * pitch,
        0,
        0,
      ]);
    }
    // Horizontal battens across the gable face (reads as framed cladding).
    for (const t of [0.22, 0.45, 0.68]) {
      const y = eaveY + (ridgeY - eaveY) * t;
      const halfSpan = halfD * (1 - t) * 0.92;
      addBox(
        buckets,
        'timber',
        [0.06, 0.07, halfSpan * 2],
        [x, y, cz],
        t > 0.5 ? FENBRIDGE_PALETTE.timber : FENBRIDGE_PALETTE.timberDark,
      );
    }
    // Peak finial plate.
    addBox(
      buckets,
      'timber',
      [0.1, 0.22, 0.22],
      [x, ridgeY - 0.05, cz],
      FENBRIDGE_PALETTE.timberLight,
    );
  }

  // Shingle courses sit ON the continuous slope (slight lift only).
  for (const slope of [-1, 1]) {
    for (let course = 0; course < courses; course += 1) {
      const t = (course + 0.55) / courses;
      for (let strip = 0; strip < strips; strip += 1) {
        const f0 = -0.5 + strip / strips;
        const f1 = -0.5 + (strip + 1) / strips;
        const midF = (f0 + f1) * 0.5;
        const midX = cx + midF * width;
        const ridgeY = peakY + ridgeLiftAt(midF);
        const y = eaveY + (ridgeY - eaveY) * t + 0.035;
        const z = cz + slope * halfD * (1 - t);
        const segW = (width / strips) * 1.02;
        const courseDepth = Math.max(0.14, halfD / courses + 0.04);
        const color = course % 3 === 0 ? deep : course % 2 === 0 ? mid : light;
        const pitch = Math.atan2(ridgeY - eaveY, halfD);
        addBox(buckets, 'roof', [segW, 0.04, courseDepth], [midX, y, z], color, [
          slope * pitch,
          0,
          0,
        ]);
      }
    }
  }

  // Ridge beam follows the bent ridge and seats on it.
  for (let strip = 0; strip < strips; strip += 1) {
    const f0 = -0.5 + strip / strips;
    const f1 = -0.5 + (strip + 1) / strips;
    addBeamXY(
      buckets,
      'timber',
      [cx + f0 * width, peakY + ridgeLiftAt(f0) + 0.06],
      [cx + f1 * width, peakY + ridgeLiftAt(f1) + 0.06],
      cz,
      0.1,
      0.14,
      FENBRIDGE_PALETTE.timberDark,
    );
    addBeamXY(
      buckets,
      'roof',
      [cx + f0 * width, peakY + ridgeLiftAt(f0) + 0.01],
      [cx + f1 * width, peakY + ridgeLiftAt(f1) + 0.01],
      cz,
      0.16,
      0.18,
      deep,
    );
  }

  // End horns + finial (concept read).
  for (const side of [-1, 1]) {
    const tipX = cx + side * (halfW + 0.12);
    const tipY = peakY + ridgeLiftAt(side * 0.5) + 0.12;
    addBox(buckets, 'timber', [0.5, 0.09, 0.09], [tipX, tipY, cz], FENBRIDGE_PALETTE.timberLight, [
      0,
      0,
      side * 0.32,
    ]);
    addOctahedron(
      buckets,
      'metal',
      0.07,
      [tipX + side * 0.18, tipY + 0.05, cz],
      FENBRIDGE_PALETTE.brass,
      [0.7, 1.1, 0.7],
    );
  }
  addCylinder(
    buckets,
    'timber',
    0.045,
    0.055,
    0.85,
    6,
    [cx + width * 0.04, peakY + 0.5, cz],
    FENBRIDGE_PALETTE.timberDark,
  );
  addOctahedron(
    buckets,
    'metal',
    0.11,
    [cx + width * 0.04, peakY + 1.0, cz],
    FENBRIDGE_PALETTE.brassLight,
    [0.65, 1.25, 0.65],
  );

  // Eave fascia boards lock the roof edge to the wall plate.
  for (const slope of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [width * 1.02, 0.12, 0.1],
      [cx, eaveY - 0.02, cz + slope * (halfD - 0.02)],
      FENBRIDGE_PALETTE.timberDark,
    );
  }
}

/** Raised stone-piling deck with open undercroft (concept marsh stilt house). */
export function addRaisedPilingDeck(
  buckets,
  width,
  depth,
  { deckY = 0.72, deckThickness = 0.16, pilingRows = 3, pilingsPerRow = 6, center = [0, 0] } = {},
) {
  const [cx, cz] = center;
  addBox(
    buckets,
    'timber',
    [width, deckThickness, depth],
    [cx, deckY, cz],
    FENBRIDGE_PALETTE.timberLight,
  );
  // Edge joists.
  for (const z of [cz - depth * 0.48, cz + depth * 0.48]) {
    addBox(
      buckets,
      'timber',
      [width * 1.02, 0.14, 0.14],
      [cx, deckY - 0.08, z],
      FENBRIDGE_PALETTE.timberDark,
    );
  }
  for (let row = 0; row < pilingRows; row += 1) {
    const z = cz - depth * 0.42 + (depth * 0.84 * row) / Math.max(1, pilingRows - 1);
    for (let col = 0; col < pilingsPerRow; col += 1) {
      const x = cx - width * 0.44 + (width * 0.88 * col) / Math.max(1, pilingsPerRow - 1);
      const height = deckY - 0.02 + ((col + row) % 3) * 0.03;
      addBox(
        buckets,
        'stone',
        [0.28, height, 0.28],
        [x, height / 2, z],
        (col + row) % 2 === 0 ? FENBRIDGE_PALETTE.stoneDeep : FENBRIDGE_PALETTE.stone,
      );
      addBox(buckets, 'stone', [0.36, 0.12, 0.36], [x, 0.06, z], FENBRIDGE_PALETTE.moss);
    }
  }
}

/** Rope rail along a front edge (concept porch). */
export function addRopeRail(buckets, x0, x1, y, z, posts = 5) {
  for (let index = 0; index < posts; index += 1) {
    const t = posts === 1 ? 0.5 : index / (posts - 1);
    const x = x0 + (x1 - x0) * t;
    addBox(buckets, 'timber', [0.1, 0.85, 0.1], [x, y + 0.42, z], FENBRIDGE_PALETTE.timberDark);
  }
  addBeamXY(buckets, 'cloth', [x0, y + 0.72], [x1, y + 0.7], z, 0.05, 0.05, FENBRIDGE_PALETTE.rope);
  addBeamXY(
    buckets,
    'cloth',
    [x0, y + 0.42],
    [x1, y + 0.44],
    z,
    0.045,
    0.045,
    FENBRIDGE_PALETTE.rope,
  );
}

/** Mossy stone block course along a wall foot (exterior only). */
export function addMasonryCourse(
  buckets,
  width,
  depth,
  y,
  center = [0, 0],
  { blocks = 5, height = 0.28 } = {},
) {
  const [cx, cz] = center;
  const blockW = width / blocks;
  for (let index = 0; index < blocks; index += 1) {
    const color =
      index % 3 === 0
        ? FENBRIDGE_PALETTE.moss
        : index % 2 === 0
          ? FENBRIDGE_PALETTE.stone
          : FENBRIDGE_PALETTE.stoneLight;
    addBox(
      buckets,
      'stone',
      [blockW * 0.92, height * (0.9 + (index % 2) * 0.12), depth],
      [cx - width / 2 + blockW * (index + 0.5), y, cz],
      color,
    );
  }
}

function archedOutline(width, height, kind) {
  const halfWidth = width / 2;
  const shoulder = -height / 2 + height * (kind === 'pointed' ? 0.56 : 0.54);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -height / 2);
  shape.lineTo(halfWidth, -height / 2);
  shape.lineTo(halfWidth, shoulder);
  if (kind === 'pointed') {
    shape.quadraticCurveTo(halfWidth * 0.9, height * 0.29, 0, height / 2);
    shape.quadraticCurveTo(-halfWidth * 0.9, height * 0.29, -halfWidth, shoulder);
  } else {
    shape.quadraticCurveTo(halfWidth, height / 2, 0, height / 2);
    shape.quadraticCurveTo(-halfWidth, height / 2, -halfWidth, shoulder);
  }
  shape.closePath();
  return shape;
}

function archedPanelGeometry(width, height, depth, kind) {
  // Panels are mounted into opaque wall shells. Keep the outward face at the
  // same depth as the former extrusion without shipping its buried back and
  // edge faces.
  const geometry = new THREE.ShapeGeometry(archedOutline(width, height, kind), 3);
  geometry.translate(0, 0, depth / 2);
  return geometry;
}

function archedFrameGeometry(outerWidth, outerHeight, innerWidth, innerHeight, depth, kind) {
  const shape = archedOutline(outerWidth, outerHeight, kind);
  // Match the inner arch to the intentionally faceted outer silhouette. The
  // frame is wall-mounted, so only this outward ring can ever be seen.
  const points = archedOutline(innerWidth, innerHeight, kind).getPoints(3);
  const hole = new THREE.Path();
  hole.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    hole.lineTo(points[index].x, points[index].y);
  }
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(shape, 3);
  geometry.translate(0, 0, depth / 2);
  return geometry;
}

export function addArchedPanel(
  buckets,
  bucket,
  width,
  height,
  depth,
  position,
  color,
  options = {},
) {
  addGeometry(
    buckets,
    bucket,
    archedPanelGeometry(width, height, depth, options.kind ?? 'rounded'),
    color,
    { position, rotation: options.rotation },
  );
}

export function addArchedFrame(
  buckets,
  bucket,
  outerWidth,
  outerHeight,
  innerWidth,
  innerHeight,
  depth,
  position,
  color,
  options = {},
) {
  addGeometry(
    buckets,
    bucket,
    archedFrameGeometry(
      outerWidth,
      outerHeight,
      innerWidth,
      innerHeight,
      depth,
      options.kind ?? 'rounded',
    ),
    color,
    { position, rotation: options.rotation },
  );
}

export function addSteps(buckets, centerX, frontZ, width, count = 3, direction = 1, baseY = 0) {
  for (let index = 0; index < count; index += 1) {
    const height = 0.11;
    addBox(
      buckets,
      'stone',
      [width + index * 0.18, height, 0.34 + index * 0.1],
      [centerX, baseY + height / 2 + index * height, frontZ + direction * index * 0.11],
      index % 2 === 0 ? FENBRIDGE_PALETTE.stoneLight : FENBRIDGE_PALETTE.stone,
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
    8,
    [x, y + 0.31 * scale, z],
    FENBRIDGE_PALETTE.timber,
  );
  for (const offset of [-0.22, 0.22]) {
    // The barrel body fills both band openings, so capped discs would be
    // entirely buried. Keep the same eight-sided outer silhouette.
    addGeometry(
      buckets,
      'metal',
      new THREE.CylinderGeometry(0.305 * scale, 0.305 * scale, 0.05 * scale, 8, 1, true),
      FENBRIDGE_PALETTE.iron,
      { position: [x, y + (0.31 + offset) * scale, z] },
    );
  }
}

export function addCrate(buckets, position, size = [0.62, 0.58, 0.58]) {
  const [x, y, z] = position;
  addBox(buckets, 'timber', size, [x, y + size[1] / 2, z], FENBRIDGE_PALETTE.timber);
  const frame = 0.07;
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [frame, size[1] * 0.92, size[2] + 0.03],
      [x + sx * (size[0] / 2 - frame / 2), y + size[1] / 2, z],
      FENBRIDGE_PALETTE.timberDark,
    );
  }
}

export function addLantern(buckets, position, scale = 1, glow = 'warm') {
  const [x, y, z] = position;
  const glowBucket = glow === 'fenlight' ? 'fenlight' : 'warm';
  const glowColor =
    glow === 'fenlight' ? FENBRIDGE_PALETTE.fenlightPale : FENBRIDGE_PALETTE.warmBright;
  for (const dy of [-0.2, 0.2]) {
    addBox(
      buckets,
      'metal',
      [0.28 * scale, 0.05 * scale, 0.22 * scale],
      [x, y + dy * scale, z],
      dy > 0 ? FENBRIDGE_PALETTE.brass : FENBRIDGE_PALETTE.iron,
    );
  }
  addBox(buckets, glowBucket, [0.17 * scale, 0.33 * scale, 0.12 * scale], [x, y, z], glowColor);
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'metal',
      [0.034 * scale, 0.41 * scale, 0.034 * scale],
      [x + sx * 0.13 * scale, y, z],
      FENBRIDGE_PALETTE.iron,
    );
  }
}

/**
 * Exterior-only multi-round polish (R16-30 style densify). Adds weathering,
 * iron hardware, moss, eave locks, and sparse corner clutter with NO interior
 * volumes. Keep clearFront half-width free for service sockets and door bays.
 */
export function addExteriorPolishRounds(
  buckets,
  {
    frontZ,
    rearZ,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH = 0.45,
    clearFront = 0.85,
    density = 1,
    rainOnlyFront = false,
    skipClutter = false,
    fenlight = false,
  },
) {
  const halfW = bodyW * 0.5;
  const halfD = bodyD * 0.5;
  const rear = rearZ ?? -frontZ;
  const d = Math.max(0.55, Math.min(1.35, density));

  // R16-18: denser eave fascia seats the roof to the shell on all four sides.
  for (const z of [frontZ * 0.98, rear * 0.98]) {
    addBox(
      buckets,
      'timber',
      [bodyW * 1.12, 0.11, 0.1],
      [0, wallTop + 0.015, z],
      FENBRIDGE_PALETTE.timberDark,
    );
    addBox(
      buckets,
      'timber',
      [bodyW * 1.05, 0.06, 0.07],
      [0, wallTop - 0.08, z * 0.99],
      FENBRIDGE_PALETTE.timberDeep,
    );
  }
  for (const x of [-halfW * 1.0, halfW * 1.0]) {
    addBox(
      buckets,
      'timber',
      [0.1, 0.11, bodyD * 1.08],
      [x, wallTop + 0.015, 0],
      FENBRIDGE_PALETTE.timberDark,
    );
  }

  // R19-21: rain-dark streaks under eaves (swamp weathering hierarchy).
  const rainXs = [];
  const span = halfW * 0.92;
  const rainN = Math.max(3, Math.round(5 * d));
  for (let i = 0; i < rainN; i += 1) {
    const x = -span + (span * 2 * (i + 0.5)) / rainN;
    if (Math.abs(x) < clearFront * 0.55) continue;
    rainXs.push(x);
  }
  for (const [i, x] of rainXs.entries()) {
    const h = 1.05 + (i % 3) * 0.35 * d;
    const y = wallBottom + (wallTop - wallBottom) * (0.45 + (i % 4) * 0.08);
    addBox(
      buckets,
      'timber',
      [0.09, h, 0.055],
      [x, y, frontZ - 0.02],
      i % 2 === 0 ? FENBRIDGE_PALETTE.timberDeep : FENBRIDGE_PALETTE.timberDark,
    );
    if (!rainOnlyFront) {
      addBox(
        buckets,
        'timber',
        [0.09, h * 0.85, 0.055],
        [x * 0.9, y - 0.1, rear + 0.02],
        FENBRIDGE_PALETTE.timberDeep,
      );
    }
  }
  // Side elevation streaks (exterior only).
  for (const side of [-1, 1]) {
    for (const [j, z] of [-halfD * 0.55, halfD * 0.35].entries()) {
      addBox(
        buckets,
        'timber',
        [0.055, 1.15 + j * 0.25, 0.09],
        [side * halfW * 0.97, wallBottom + (wallTop - wallBottom) * 0.55, z],
        FENBRIDGE_PALETTE.timberDeep,
      );
    }
  }

  // R22-24: iron stud grids on corners + mid belts (hardware density).
  const studYs = [];
  const studRows = Math.max(2, Math.round(3 * d));
  for (let r = 0; r < studRows; r += 1) {
    studYs.push(wallBottom + ((wallTop - wallBottom) * (r + 1)) / (studRows + 1));
  }
  for (const x of [-halfW * 0.94, halfW * 0.94]) {
    for (const z of [frontZ - 0.03, rear + 0.03]) {
      for (const y of studYs) {
        addBox(
          buckets,
          'metal',
          [0.07, 0.07, 0.055],
          [x * 1.03, y, z * 1.01],
          FENBRIDGE_PALETTE.ironLight,
        );
      }
    }
  }
  for (const x of [-halfW * 0.55, halfW * 0.55]) {
    if (Math.abs(x) < clearFront * 0.4) continue;
    for (const y of studYs) {
      addBox(buckets, 'metal', [0.09, 0.09, 0.06], [x, y, frontZ + 0.02], FENBRIDGE_PALETTE.iron);
    }
  }

  // R25-26: moss pads and wet footing stains (swamp base read).
  const moss = [
    [-halfW * 0.85, halfD * 0.9],
    [halfW * 0.85, halfD * 0.88],
    [-halfW * 0.8, -halfD * 0.85],
    [halfW * 0.82, -halfD * 0.8],
    [0, -halfD * 0.95],
  ];
  for (const [i, [x, z]] of moss.entries()) {
    if (Math.abs(x) < clearFront * 0.5 && z > 0) continue;
    addBox(
      buckets,
      'stone',
      [0.42 + (i % 2) * 0.12, 0.08, 0.32],
      [x, baseH * 0.55, z],
      i % 3 === 0 ? FENBRIDGE_PALETTE.moss : FENBRIDGE_PALETTE.stoneDeep,
    );
  }

  // R27-28: bargeboard / gable edge ribs (side silhouette).
  for (const end of [-1, 1]) {
    const z = end * (halfD + 0.06);
    const rise = wallTop + (wallTop - wallBottom) * 0.08;
    for (let row = 0; row < Math.max(3, Math.round(4 * d)); row += 1) {
      const t = (row + 0.4) / Math.max(3, Math.round(4 * d));
      const y = wallTop + 0.04 + (rise - wallTop + 0.55) * t;
      const w = Math.max(0.35, bodyW * (1 - t) * 0.48);
      addBox(
        buckets,
        'timber',
        [w, 0.09, 0.07],
        [0, y, z],
        row % 2 ? FENBRIDGE_PALETTE.timber : FENBRIDGE_PALETTE.timberLight,
      );
    }
  }

  // R29: corner lantern arms (off the approach center).
  const glow = fenlight ? 'fenlight' : 'warm';
  addBox(
    buckets,
    'timber',
    [0.55, 0.09, 0.09],
    [-halfW * 0.92, wallBottom + (wallTop - wallBottom) * 0.72, frontZ * 0.55],
    FENBRIDGE_PALETTE.timberDark,
  );
  addLantern(
    buckets,
    [-halfW * 1.05, wallBottom + (wallTop - wallBottom) * 0.62, frontZ * 0.55],
    0.72,
    glow,
  );
  addBox(
    buckets,
    'timber',
    [0.55, 0.09, 0.09],
    [halfW * 0.92, wallBottom + (wallTop - wallBottom) * 0.68, rear * 0.4],
    FENBRIDGE_PALETTE.timberDark,
  );
  addLantern(
    buckets,
    [halfW * 1.05, wallBottom + (wallTop - wallBottom) * 0.58, rear * 0.4],
    0.68,
    glow,
  );

  // R30: sparse exterior clutter, never on clear front approach.
  if (!skipClutter) {
    addBarrel(buckets, [halfW * 0.95, baseH + 0.32, -halfD * 0.75], 0.62 * d);
    addBarrel(buckets, [halfW * 1.05, baseH + 0.28, -halfD * 0.45], 0.48 * d);
    addCrate(buckets, [-halfW * 0.95, baseH + 0.05, -halfD * 0.7], [0.42, 0.32, 0.38]);
    // Rope wraps on rear stilts / corners.
    for (const x of [-halfW * 0.9, halfW * 0.9]) {
      addCylinder(
        buckets,
        'cloth',
        0.12,
        0.12,
        0.09,
        5,
        [x, wallBottom + 0.55, rear * 0.85],
        FENBRIDGE_PALETTE.rope,
      );
    }
  }
}

function draftBounds(buckets) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const geometries of Object.values(buckets)) {
    for (const geometry of geometries) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    }
  }
  if (bounds.isEmpty()) throw new Error('Fenbridge asset has no geometry');
  return bounds;
}

function normalizeBuckets(buckets, target) {
  const bounds = draftBounds(buckets);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) {
    throw new Error(`Fenbridge draft has degenerate bounds ${size.toArray().join('x')}`);
  }
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

function makeShippingMaterial(definition) {
  return new THREE.MeshStandardMaterial({
    name: definition.name,
    color: 0xffffff,
    vertexColors: true,
    metalness: definition.metalness,
    roughness: definition.roughness,
    emissive: definition.emissive ?? 0x000000,
    emissiveIntensity: definition.emissiveIntensity ?? 1,
  });
}

/**
 * Minimal exterior shell for assets not yet quality-rebuilt. Kept so the town
 * export/layout still resolve a GLB; replace with a full concept factory when
 * that asset's multi-round quality pass starts. Only crooked_reed_inn and
 * hesk_tannery (plus the asset currently under rebuild) should ship real detail.
 */
export function buildUnapprovedPlaceholder(buckets) {
  // Opaque-only shell (no emissive) so instanced props stay single-draw until
  // their quality rewrite. Dimensions normalize to the asset contract.
  addBox(buckets, 'stone', [1.05, 0.08, 1.05], [0, 0.04, 0], FENBRIDGE_PALETTE.stoneDeep);
  addBox(buckets, 'timber', [0.92, 0.82, 0.92], [0, 0.49, 0], FENBRIDGE_PALETTE.timberDeep);
  addBox(buckets, 'roof', [1.08, 0.1, 1.08], [0, 0.95, 0], FENBRIDGE_PALETTE.roof);
}

export function finishFenbridgeAsset(contract, buckets) {
  const normalization = normalizeBuckets(buckets, contract.dimensions);
  const root = new THREE.Group();
  root.name = contract.rootName;
  root.userData.sculptRuntime = {
    schemaVersion: 1,
    assetId: contract.id,
    coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
    nativeBounds: { ...contract.dimensions },
    serviceCues: [...contract.serviceCues],
    supportTextures: {
      base: '/textures/fenbridge_surface_atlas.webp',
      normal: '/textures/fenbridge_surface_normal.webp',
      roughness: '/textures/fenbridge_surface_roughness.webp',
    },
    interaction: { mode: contract.interactionMode ?? 'static-town-asset', interactive: false },
    collider: { shippingCollisionMesh: false, intent: contract.colliderIntent ?? 'runtime-owned' },
    destruction: { breakable: false, detachableParts: [] },
  };

  const shippingBuckets = {
    opaque: FENBRIDGE_BUCKET_KEYS.filter((key) => key !== 'warm' && key !== 'fenlight').flatMap(
      (key) => buckets[key],
    ),
    emissive: [...buckets.warm, ...buckets.fenlight],
  };
  for (const [key, geometries] of Object.entries(shippingBuckets)) {
    if (geometries.length === 0) continue;
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`failed to merge ${contract.id} ${key} geometry`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, makeShippingMaterial(SHIPPING_MATERIALS[key]));
    mesh.name = `${contract.rootName}_${SHIPPING_MATERIALS[key].name}`;
    mesh.castShadow = key === 'opaque';
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  const socketEntries = {};
  for (const definition of contract.sockets) {
    const socket = new THREE.Object3D();
    socket.name = definition.name;
    socket.position.fromArray(
      definition.positionSpace === 'draft'
        ? normalization.point(definition.position)
        : definition.position,
    );
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

  const finalBounds = new THREE.Box3().setFromObject(root);
  const finalSize = finalBounds.getSize(new THREE.Vector3());
  const finalCenter = finalBounds.getCenter(new THREE.Vector3());
  for (const [label, actual, expected] of [
    ['width', finalSize.x, contract.dimensions.width],
    ['height', finalSize.y, contract.dimensions.height],
    ['depth', finalSize.z, contract.dimensions.depth],
    ['floor', finalBounds.min.y, 0],
    ['centerX', finalCenter.x, 0],
    ['centerZ', finalCenter.z, 0],
  ]) {
    if (Math.abs(actual - expected) > 1e-4) {
      throw new Error(`${contract.id} ${label} expected ${expected}, got ${actual}`);
    }
  }
  return root;
}
