import * as THREE from 'three';
import {
  addArchedFrame,
  addArchedPanel,
  addBarrel,
  addBeamXY,
  addBox,
  addCylinder,
  addExteriorPolishRounds,
  addGeometry,
  addLantern,
  addMasonryCourse,
  addOctahedron,
  addPitchedRoof,
  addRopeRail,
  addShingledRoof,
  addSteps,
  addTorus,
  addVerticalPlankFace,
  FENBRIDGE_PALETTE as P,
} from './shared.js';

function _addMasonryFooting(buckets, width, depth, height = 0.48) {
  addBox(buckets, 'stone', [width, height, depth], [0, height / 2, 0], P.stoneDeep);
  addBox(
    buckets,
    'stone',
    [width * 0.92, height * 0.72, depth * 0.9],
    [0, height + height * 0.36, 0],
    P.stone,
  );
  for (const [x, z, lift] of [
    [-width * 0.38, depth * 0.43, 0.02],
    [width * 0.34, depth * 0.44, 0.08],
    [-width * 0.42, -depth * 0.39, 0.05],
    [width * 0.41, -depth * 0.37, 0],
  ]) {
    addBox(
      buckets,
      'stone',
      [width * 0.22, height * 0.46, depth * 0.16],
      [x, height * 0.88 + lift, z],
      lift > 0.04 ? P.stoneLight : P.stone,
    );
  }
  addMasonryCourse(buckets, width * 0.96, 0.2, height * 0.55, [0, depth * 0.48], {
    blocks: Math.max(5, Math.round(width / 0.95)),
    height: height * 0.62,
  });
  addMasonryCourse(buckets, width * 0.96, 0.2, height * 0.55, [0, -depth * 0.48], {
    blocks: Math.max(5, Math.round(width / 0.95)),
    height: height * 0.62,
  });
}

function _addFramedShell(buckets, width, depth, bottomY, topY, centerX = 0, centerZ = 0) {
  const height = topY - bottomY;
  const centerY = bottomY + height / 2;
  // Inset mass for closed silhouette; exterior planks own the readable timber.
  addBox(
    buckets,
    'timber',
    [width * 0.84, height * 0.96, depth * 0.82],
    [centerX, centerY, centerZ],
    P.timberDeep,
  );
  addVerticalPlankFace(
    buckets,
    'front',
    width * 0.9,
    height,
    [centerX, centerY, centerZ + depth * 0.44],
    { plankCount: Math.max(7, Math.round(width / 0.48)) },
  );
  addVerticalPlankFace(
    buckets,
    'rear',
    width * 0.9,
    height,
    [centerX, centerY, centerZ - depth * 0.44],
    { plankCount: Math.max(7, Math.round(width / 0.48)) },
  );
  addVerticalPlankFace(
    buckets,
    'right',
    depth * 0.88,
    height,
    [centerX + width * 0.45, centerY, centerZ],
    { plankCount: Math.max(6, Math.round(depth / 0.5)) },
  );
  addVerticalPlankFace(
    buckets,
    'left',
    depth * 0.88,
    height,
    [centerX - width * 0.45, centerY, centerZ],
    { plankCount: Math.max(6, Math.round(depth / 0.5)) },
  );
  const halfX = width * 0.45;
  const halfZ = depth * 0.44;
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      addBox(
        buckets,
        'timber',
        [0.22, height + 0.08, 0.22],
        [centerX + x, bottomY + height / 2, centerZ + z],
        P.timberDark,
      );
    }
  }
  for (const y of [bottomY + height * 0.35, bottomY + height * 0.72, topY - 0.08]) {
    for (const z of [-halfZ, halfZ]) {
      addBox(
        buckets,
        'timber',
        [width * 0.92, 0.16, 0.18],
        [centerX, y, centerZ + z],
        P.timberDark,
      );
    }
    for (const x of [-halfX, halfX]) {
      addBox(
        buckets,
        'timber',
        [0.18, 0.16, depth * 0.89],
        [centerX + x, y, centerZ],
        P.timberDark,
      );
    }
  }
}

function faceRotation(face) {
  if (face === 'back') return [0, Math.PI, 0];
  if (face === 'right') return [0, Math.PI / 2, 0];
  if (face === 'left') return [0, -Math.PI / 2, 0];
  return [0, 0, 0];
}

function addMullionedWindow(
  buckets,
  position,
  scale = 1,
  { face = 'front', kind = 'rounded', frameBucket = 'timber' } = {},
) {
  const rotation = faceRotation(face);
  const [x, y, z] = position;
  addArchedPanel(buckets, 'warm', 0.5 * scale, 0.8 * scale, 0.055, position, P.warm, {
    kind,
    rotation,
  });
  addArchedFrame(
    buckets,
    frameBucket,
    0.72 * scale,
    1.02 * scale,
    0.5 * scale,
    0.8 * scale,
    0.1,
    position,
    frameBucket === 'metal' ? P.iron : P.timberLight,
    { kind, rotation },
  );
  addBox(
    buckets,
    frameBucket,
    [0.055, 0.7 * scale, 0.105],
    [x, y - 0.03, z],
    frameBucket === 'metal' ? P.iron : P.timberDark,
    rotation,
  );
  addBox(
    buckets,
    frameBucket,
    [0.43 * scale, 0.055, 0.105],
    [x, y - 0.08, z],
    frameBucket === 'metal' ? P.iron : P.timberDark,
    rotation,
  );
}

function addIronboundDoor(buckets, x, y, z, width, height, kind = 'rounded') {
  addArchedPanel(buckets, 'timber', width * 0.78, height * 0.84, 0.1, [x, y, z], P.timberDeep, {
    kind,
  });
  addArchedFrame(
    buckets,
    'metal',
    width,
    height,
    width * 0.78,
    height * 0.84,
    0.13,
    [x, y, z + 0.03],
    P.iron,
    { kind },
  );
  for (const offset of [-0.5, 0, 0.5]) {
    addBox(
      buckets,
      'metal',
      [width * 0.68, 0.075, 0.13],
      [x, y + offset * height * 0.54, z + 0.075],
      offset === 0 ? P.brass : P.iron,
    );
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-0.42, 0.42]) {
      addOctahedron(
        buckets,
        'metal',
        0.045,
        [x + sx * width * 0.25, y + sy * height * 0.55, z + 0.15],
        P.ironLight,
      );
    }
  }
}

function addDiagonalYZ(buckets, bucket, x, start, end, thickness, depth, color) {
  const deltaY = end[0] - start[0];
  const deltaZ = end[1] - start[1];
  const length = Math.hypot(deltaY, deltaZ);
  addBox(
    buckets,
    bucket,
    [depth, length, thickness],
    [x, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    color,
    [Math.atan2(deltaZ, deltaY), 0, 0],
  );
}

function _addRoofHorn(buckets, side, z = 2.28) {
  const root = [side * 1.56, 8.1];
  const center = [side * 2.0, 8.52, z];
  const rotationZ = side > 0 ? (-Math.PI * 3) / 4 : Math.PI;
  addTorus(buckets, 'metal', 0.64, 0.12, center, P.brass, [0, 0, rotationZ], (Math.PI * 3) / 4);
  addOctahedron(buckets, 'metal', 0.15, [side * 2.6, 8.6, z], P.brassLight, [0.7, 1.35, 0.7]);
  addCylinder(buckets, 'metal', 0.16, 0.18, 0.68, 7, [side * 1.46, root[1], z], P.iron, [
    0,
    0,
    Math.PI / 2,
  ]);
  for (const x of [1.28, 1.6]) {
    addBox(buckets, 'metal', [0.12, 0.4, 0.38], [side * x, root[1], z], P.ironLight);
  }
  addBeamXY(buckets, 'timber', [side * 0.92, 8.78], root, z - 0.02, 0.17, 0.2, P.timberLight);
}

function _addBlankShield(buckets, position, scale = 1) {
  const outline = new THREE.Shape();
  outline.moveTo(-0.48, 0.42);
  outline.lineTo(0.48, 0.42);
  outline.lineTo(0.44, -0.08);
  outline.lineTo(0, -0.58);
  outline.lineTo(-0.44, -0.08);
  outline.closePath();
  const backing = new THREE.ExtrudeGeometry(outline, {
    depth: 0.13,
    bevelEnabled: false,
    steps: 1,
  });
  backing.center();
  addGeometry(buckets, 'metal', backing, P.iron, {
    position: [position[0], position[1], position[2] - 0.05],
    scale: [1.16 * scale, 1.16 * scale, 1.1],
  });
  const face = new THREE.ExtrudeGeometry(outline, {
    depth: 0.1,
    bevelEnabled: false,
    steps: 1,
  });
  face.center();
  addGeometry(buckets, 'metal', face, P.brass, {
    position: [position[0], position[1], position[2] + 0.04],
    scale: [scale, scale, 1],
  });
}

function _addRectangularStoneCourse(
  buckets,
  {
    width,
    depth,
    y,
    blockWidth = 0.72,
    blockHeight = 0.28,
    frontGap = null,
    faces = ['front', 'rear', 'left', 'right'],
  },
) {
  const xCount = Math.max(2, Math.floor(width / blockWidth));
  const xSpacing = width / xCount;
  for (let index = 0; index < xCount; index += 1) {
    const x = -width / 2 + xSpacing * (index + 0.5);
    const color = index % 3 === 0 ? P.moss : index % 2 === 0 ? P.stoneLight : P.stone;
    if (
      faces.includes('front') &&
      !(frontGap && Math.abs(x - frontGap.center) < frontGap.halfWidth)
    ) {
      addBox(buckets, 'stone', [xSpacing * 0.9, blockHeight, 0.24], [x, y, depth / 2], color);
    }
    if (faces.includes('rear')) {
      addBox(
        buckets,
        'stone',
        [xSpacing * 0.9, blockHeight, 0.24],
        [x, y + (index % 2) * 0.035, -depth / 2],
        color,
      );
    }
  }
  const zCount = Math.max(2, Math.floor(depth / blockWidth));
  const zSpacing = depth / zCount;
  for (let index = 0; index < zCount; index += 1) {
    const z = -depth / 2 + zSpacing * (index + 0.5);
    const color = index % 3 === 1 ? P.moss : index % 2 === 0 ? P.stone : P.stoneLight;
    if (faces.includes('left')) {
      addBox(buckets, 'stone', [0.24, blockHeight, zSpacing * 0.9], [-width / 2, y, z], color);
    }
    if (faces.includes('right')) {
      addBox(
        buckets,
        'stone',
        [0.24, blockHeight, zSpacing * 0.9],
        [width / 2, y + (index % 2) * 0.035, z],
        color,
      );
    }
  }
}

function _addWallStudRhythm(
  buckets,
  { width, depth, bottomY, topY, frontXs = [], backXs = [], sideZs = [] },
) {
  const height = topY - bottomY;
  const centerY = bottomY + height / 2;
  const frontZ = depth * 0.445 + 0.04;
  const sideX = width * 0.455 + 0.04;
  for (const [index, x] of frontXs.entries()) {
    addBox(
      buckets,
      'timber',
      [0.1, height, 0.085],
      [x, centerY, frontZ],
      index % 2 ? P.timberDeep : P.timberDark,
    );
  }
  for (const [index, x] of backXs.entries()) {
    addBox(
      buckets,
      'timber',
      [0.1, height, 0.085],
      [x, centerY, -frontZ],
      index % 2 ? P.timberDark : P.timberDeep,
    );
  }
  for (const [index, z] of sideZs.entries()) {
    for (const x of [-sideX, sideX]) {
      addBox(
        buckets,
        'timber',
        [0.085, height, 0.1],
        [x, centerY, z],
        index % 2 ? P.timberDeep : P.timberDark,
      );
    }
  }
}

function _addPointedRoofTrim(
  buckets,
  { width, depth, eaveY, peakY, courseFractions = [0.3, 0.58] },
) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  for (const z of [-halfDepth, halfDepth]) {
    addBeamXY(buckets, 'timber', [-halfWidth, eaveY], [0, peakY], z, 0.11, 0.14, P.timberLight);
    addBeamXY(buckets, 'timber', [0, peakY], [halfWidth, eaveY], z, 0.11, 0.14, P.timberLight);
    for (const fraction of courseFractions) {
      const y = eaveY + (peakY - eaveY) * fraction;
      const halfSpan = halfWidth * (1 - fraction);
      addBeamXY(buckets, 'roof', [-halfSpan, y], [-0.03, y], z, 0.065, 0.1, P.roofDeep);
      addBeamXY(buckets, 'roof', [0.03, y], [halfSpan, y], z, 0.065, 0.1, P.roofDeep);
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    addBox(buckets, 'timber', [0.13, 0.13, depth], [x, eaveY, 0], P.timberLight);
  }
}

function _addPointedRoofShingles(buckets, { width, depth, eaveY, peakY, rows, columns }) {
  const halfWidth = width / 2;
  const usableDepth = depth - 0.18;
  const slopeAngle = Math.atan2(peakY - eaveY, halfWidth);
  const tileLength = (halfWidth / (rows + 0.75)) * 0.82;
  const tileDepth = (usableDepth / columns) * 0.86;
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row += 1) {
      const fraction = (row + 0.82) / (rows + 0.72);
      const x = side * halfWidth * fraction;
      const y = peakY - (peakY - eaveY) * fraction + 0.055;
      for (let column = 0; column < columns; column += 1) {
        const z = -usableDepth / 2 + (usableDepth / columns) * (column + 0.5);
        addBox(
          buckets,
          'roof',
          [tileLength, 0.075, tileDepth],
          [x, y, z],
          (row + column) % 4 === 0 ? P.roofDeep : P.roof,
          [0, 0, side > 0 ? -slopeAngle : slopeAngle],
        );
      }
    }
  }
}

function _addBroadRoofShingles(buckets, { width, depth, eaveY, peakY, rows, columns }) {
  const halfDepth = depth / 2;
  const usableWidth = width - 0.2;
  const slopeAngle = Math.atan2(peakY - eaveY, halfDepth);
  const tileWidth = (usableWidth / columns) * 0.86;
  const tileLength = (halfDepth / (rows + 0.75)) * 0.82;
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row += 1) {
      const fraction = (row + 0.82) / (rows + 0.72);
      const z = side * halfDepth * fraction;
      const y = peakY - (peakY - eaveY) * fraction + 0.055;
      for (let column = 0; column < columns; column += 1) {
        const x = -usableWidth / 2 + (usableWidth / columns) * (column + 0.5);
        addBox(
          buckets,
          'roof',
          [tileWidth, 0.075, tileLength],
          [x, y, z],
          (row + column) % 4 === 0 ? P.roofDeep : P.roof,
          [side > 0 ? slopeAngle : -slopeAngle, 0, 0],
        );
      }
    }
  }
}

function _addBroadRoofTrim(buckets, { width, depth, eaveY, peakY }) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  for (const x of [-halfWidth, halfWidth]) {
    addDiagonalYZ(buckets, 'timber', x, [eaveY, -halfDepth], [peakY, 0], 0.11, 0.14, P.timberLight);
    addDiagonalYZ(buckets, 'timber', x, [peakY, 0], [eaveY, halfDepth], 0.11, 0.14, P.timberLight);
  }
  for (const z of [-halfDepth, halfDepth]) {
    addBox(buckets, 'timber', [width, 0.13, 0.13], [0, eaveY, z], P.timberLight);
  }
  for (const fraction of [-0.42, 0.42]) {
    const z = halfDepth * fraction;
    const y = eaveY + (peakY - eaveY) * (1 - Math.abs(fraction));
    addBox(buckets, 'roof', [width * 0.94, 0.065, 0.1], [0, y, z], P.roofDeep);
  }
}

function _addRadialRoofRib(buckets, angle, radius, centerY, eaveY) {
  const innerRadius = 0.11;
  const start = new THREE.Vector3(
    Math.cos(angle) * innerRadius,
    centerY,
    Math.sin(angle) * innerRadius,
  );
  const end = new THREE.Vector3(Math.cos(angle) * radius, eaveY, Math.sin(angle) * radius);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rotation = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize()),
  );
  addBox(
    buckets,
    'metal',
    [0.06, 0.06, length],
    start.clone().add(end).multiplyScalar(0.5).toArray(),
    P.brass,
    [rotation.x, rotation.y, rotation.z],
  );
}

function addSideWinch(buckets, x, y, z) {
  addTorus(buckets, 'metal', 0.38, 0.065, [x, y, z], P.ironLight, [0, Math.PI / 2, 0]);
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2;
    addDiagonalYZ(
      buckets,
      'metal',
      x,
      [y, z],
      [y + Math.cos(angle) * 0.33, z + Math.sin(angle) * 0.33],
      0.055,
      0.07,
      index % 2 ? P.brass : P.iron,
    );
  }
  addCylinder(buckets, 'metal', 0.11, 0.11, 0.3, 7, [x, y, z], P.brass, [0, 0, Math.PI / 2]);
  addBox(
    buckets,
    'metal',
    [0.08, 0.48, 0.08],
    [x - 0.18, y + 0.2, z + 0.24],
    P.brass,
    [0, 0, -0.48],
  );
}

function _addRainChain(buckets, x, topY, z, length = 1.38) {
  const segments = 5;
  const step = length / segments;
  for (let index = 0; index < segments; index += 1) {
    const startX = x + (index % 2 === 0 ? -0.045 : 0.045);
    const endX = x + (index % 2 === 0 ? 0.045 : -0.045);
    addBeamXY(
      buckets,
      'metal',
      [startX, topY - index * step],
      [endX, topY - (index + 1) * step],
      z,
      0.065,
      0.075,
      index % 2 === 0 ? P.iron : P.brass,
    );
  }
}

/**
 * Warden Gatehouse: exterior-only multi-round rebuild from admitted turnaround crops.
 * Identity: moss-stone footing, timber stilts/pickets, tall plank tower, iron straps,
 * pointed teal shingle roof with horns + finial, signal horn, entry porch + steps,
 * hanging lantern cage, teal banner, offset lookout balcony, clear front approach.
 * Sockets: front-entry [0,0,3.5], guard-apron [-2.6,0,3.65]. Beside gate, not across.
 * No interior. Ten polish rounds for quality + performance (see round tags).
 */
export function buildWardenGatehouse(buckets) {
  // ---- Round 1: proportions + stone footing ----
  const baseH = 1.12;
  const wallBottom = baseH + 0.04;
  const wallTop = 7.15;
  const peakY = 10.15;
  const bodyW = 3.45;
  const bodyD = 3.65;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyD * 0.5;
  const rearZ = -bodyD * 0.5;
  const porchZ = frontZ + 0.95;

  addBox(buckets, 'stone', [5.85, baseH * 0.52, 4.95], [0, baseH * 0.26, 0.08], P.stoneDeep);
  addBox(buckets, 'stone', [5.35, baseH * 0.45, 4.45], [0, baseH * 0.72, 0.08], P.stone);
  addMasonryCourse(buckets, 5.6, 0.24, baseH * 0.52, [0, 2.35], { blocks: 8, height: 0.58 });
  addMasonryCourse(buckets, 5.6, 0.24, baseH * 0.52, [0, -2.2], { blocks: 8, height: 0.58 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i += 1) {
      const z = -1.85 + i * 0.75;
      addBox(
        buckets,
        'stone',
        [0.24, baseH * 0.72, 0.62],
        [side * 2.78, baseH * 0.48, z],
        i % 2 === 0 ? P.stone : i % 3 === 0 ? P.moss : P.stoneLight,
      );
    }
  }

  // ---- Round 2: wood stilts / pickets in footing (concept poles) ----
  const stilts = [
    [-2.55, 2.15, 0.13],
    [-1.25, 2.25, 0.12],
    [0, 2.28, 0.11],
    [1.25, 2.25, 0.12],
    [2.55, 2.15, 0.13],
    [-2.65, 0.55, 0.12],
    [2.65, 0.55, 0.12],
    [-2.6, -1.2, 0.12],
    [2.6, -1.2, 0.12],
    [-2.5, -2.05, 0.13],
    [-0.9, -2.15, 0.11],
    [0.9, -2.15, 0.11],
    [2.5, -2.05, 0.13],
  ];
  for (const [i, [x, z, r]] of stilts.entries()) {
    const h = baseH * (0.88 + (i % 3) * 0.04);
    addCylinder(
      buckets,
      'timber',
      r,
      r * 1.1,
      h,
      5,
      [x, h / 2 - 0.02, z],
      i % 2 === 0 ? P.timberDark : P.timberDeep,
    );
    addCylinder(
      buckets,
      'stone',
      r * 1.35,
      r * 1.45,
      0.08,
      5,
      [x, 0.05, z],
      i % 2 ? P.moss : P.stoneDeep,
    );
    if (i % 2 === 0) {
      addCylinder(buckets, 'cloth', r * 1.2, r * 1.2, 0.06, 5, [x, h - 0.1, z], P.rope);
    }
  }
  // Platform planks.
  for (let i = 0; i < 9; i += 1) {
    const x = -2.55 + i * 0.64;
    addBox(
      buckets,
      'timber',
      [0.56, 0.1, 4.6],
      [x, baseH + 0.06, 0.05],
      i % 2 === 0 ? P.timberLight : P.timber,
    );
  }
  addBox(buckets, 'timber', [5.4, 0.12, 0.14], [0, baseH - 0.02, 2.25], P.timberDark);
  // Spike pickets on apron (concept).
  for (const [x, z] of [
    [-2.7, 2.3],
    [-1.5, 2.35],
    [1.5, 2.35],
    [2.7, 2.3],
    [-2.7, -2.15],
    [2.7, -2.15],
  ]) {
    addBox(buckets, 'timber', [0.13, 0.95, 0.13], [x, baseH + 0.55, z], P.timberDark);
    addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.09, 0.26, 4), P.iron, {
      position: [x, baseH + 1.12, z],
    });
    addBox(buckets, 'metal', [0.17, 0.1, 0.17], [x, baseH + 0.14, z], P.ironLight);
  }

  // ---- Round 3: tall timber shell + iron straps ----
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.96, bodyD * 0.86],
    [0, wallCy, 0],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.95, wallH, [0, wallCy, frontZ - 0.05], {
    plankCount: 9,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.95, wallH, [0, wallCy, rearZ + 0.05], {
    plankCount: 9,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.92, wallH, [-bodyW * 0.46, wallCy, 0], {
    plankCount: 8,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.92, wallH, [bodyW * 0.46, wallCy, 0], {
    plankCount: 8,
  });
  for (const x of [-bodyW * 0.46, bodyW * 0.46]) {
    for (const z of [rearZ + 0.05, frontZ - 0.05]) {
      addBox(buckets, 'timber', [0.24, wallH + 0.22, 0.24], [x, wallCy, z], P.timberDark);
      for (const y of [
        wallBottom + 0.55,
        wallBottom + wallH * 0.35,
        wallBottom + wallH * 0.65,
        wallTop - 0.55,
      ]) {
        addBox(buckets, 'metal', [0.3, 0.12, 0.3], [x, y, z], P.iron);
        addBox(
          buckets,
          'metal',
          [0.08, 0.08, 0.08],
          [x + Math.sign(x) * 0.12, y, z + Math.sign(z || 1) * 0.12],
          P.ironLight,
        );
      }
    }
  }
  for (const z of [frontZ - 0.03, rearZ + 0.03]) {
    for (const y of [
      wallBottom + wallH * 0.28,
      wallBottom + wallH * 0.52,
      wallBottom + wallH * 0.76,
      wallTop - 0.1,
    ]) {
      addBox(
        buckets,
        'timber',
        [bodyW * 0.97, 0.13, 0.13],
        [0, y, z],
        y > wallTop - 0.2 ? P.timber : P.timberDark,
      );
    }
  }
  addBox(
    buckets,
    'timber',
    [bodyW * 1.06, 0.16, bodyD * 1.06],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );
  // Diagonal braces (sides/rear only; front door bay stays open).
  addBeamXY(
    buckets,
    'timber',
    [-bodyW * 0.4, wallBottom + 0.45],
    [-bodyW * 0.1, wallTop - 1.3],
    rearZ + 0.04,
    0.1,
    0.11,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [bodyW * 0.4, wallBottom + 0.45],
    [bodyW * 0.1, wallTop - 1.3],
    rearZ + 0.04,
    0.1,
    0.11,
    P.timber,
  );
  addDiagonalYZ(
    buckets,
    'timber',
    -bodyW * 0.48,
    [wallBottom + 0.55, -1.3],
    [wallTop - 1.5, 1.05],
    0.1,
    0.11,
    P.timberDark,
  );
  addDiagonalYZ(
    buckets,
    'timber',
    bodyW * 0.48,
    [wallBottom + 0.55, -1.3],
    [wallTop - 1.5, 1.05],
    0.1,
    0.11,
    P.timberDark,
  );
  addDiagonalYZ(
    buckets,
    'timber',
    -bodyW * 0.48,
    [wallBottom + 2.2, 1.05],
    [wallTop - 0.8, -1.0],
    0.09,
    0.1,
    P.timber,
  );
  addDiagonalYZ(
    buckets,
    'timber',
    bodyW * 0.48,
    [wallBottom + 2.2, 1.05],
    [wallTop - 0.8, -1.0],
    0.09,
    0.1,
    P.timber,
  );

  // ---- Round 4: shingled teal slopes + timber gable faces (kill flat end-caps) ----
  // Concept front is a TIMBER gable, not a smooth teal triangle. Slopes carry
  // layered teal courses; ends get planked gable skins + stepped course edges.
  const roofW = bodyW * 1.38;
  const roofD = bodyD * 1.32;
  const eaveY = wallTop + 0.02;
  const rise = peakY - eaveY;
  const halfW = roofW / 2;
  const halfD = roofD / 2;
  const pitch = Math.atan2(rise, halfW);
  addShingledRoof(buckets, roofW, roofD, eaveY, peakY, {
    ridgeAxis: 'z',
    courses: 13,
  });
  // Stepped course ends at front/rear so gable edges show teal row relief.
  for (const slope of [-1, 1]) {
    for (const end of [-1, 1]) {
      for (let course = 0; course < 11; course += 1) {
        const midT = (course + 0.55) / 11;
        const y = eaveY + rise * midT + 0.05 * Math.cos(pitch);
        const x = slope * halfW * (1 - midT);
        const z = end * (halfD * 0.94);
        const courseDepth = Math.max(0.14, halfW / 11 + 0.04);
        const color = course % 3 === 0 ? P.roofDeep : course % 2 === 0 ? P.roof : P.roofLight;
        addBox(buckets, 'roof', [courseDepth, 0.055, 0.16], [x, y, z], color, [
          0,
          0,
          -slope * pitch * 0.95,
        ]);
      }
    }
  }
  // Timber ridge rail + eave fascia (seat continuous roof on the plate).
  addBox(buckets, 'timber', [0.16, 0.11, roofD * 1.04], [0, peakY + 0.12, 0], P.timberDark);
  for (const z of [halfD * 0.98, -halfD * 0.98]) {
    addBox(buckets, 'timber', [roofW * 1.02, 0.13, 0.11], [0, eaveY - 0.01, z], P.timberDark);
  }
  for (const x of [-halfW * 0.98, halfW * 0.98]) {
    addBox(buckets, 'timber', [0.11, 0.13, roofD * 0.98], [x, eaveY - 0.01, 0], P.timberDark);
  }
  // Concept pagoda upswept eave corners (timber + teal cap, seated).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tipX = sx * (halfW - 0.02);
      const tipZ = sz * (halfD - 0.06);
      addBox(
        buckets,
        'timber',
        [0.48, 0.1, 0.12],
        [tipX + sx * 0.14, eaveY + 0.12, tipZ],
        P.timberLight,
        [0, 0, -sx * 0.62],
      );
      addBox(
        buckets,
        'roof',
        [0.32, 0.07, 0.14],
        [tipX + sx * 0.28, eaveY + 0.24, tipZ],
        P.roofDeep,
        [0, 0, -sx * 0.85],
      );
      addBox(
        buckets,
        'timber',
        [0.18, 0.08, 0.08],
        [tipX + sx * 0.4, eaveY + 0.36, tipZ],
        P.timberDark,
        [0, 0, -sx * 1.05],
      );
    }
  }
  // Front/rear TIMBER gable skins: stacked tapering boards fill the triangle so
  // the end view never reads as a flat teal sheet (concept wood gable).
  for (const end of [-1, 1]) {
    const z = end * (halfD + 0.04);
    // King post + raking rafters.
    addBox(buckets, 'timber', [0.16, rise * 0.96, 0.14], [0, eaveY + rise * 0.5, z], P.timberDark);
    for (const side of [-1, 1]) {
      const len = Math.hypot(rise, halfW * 0.92);
      addBox(
        buckets,
        'timber',
        [0.13, len, 0.12],
        [side * halfW * 0.32, eaveY + rise * 0.5, z],
        P.timber,
        [0, 0, side * -pitch * 0.9],
      );
    }
    // Horizontal battens + plank fill (taper with roof width at each height).
    for (let row = 0; row < 9; row += 1) {
      const t = (row + 0.4) / 9;
      const y = eaveY + rise * t + 0.02;
      const w = Math.max(0.28, bodyW * (1 - t) * 0.92);
      addBox(
        buckets,
        'timber',
        [w, 0.11, 0.08],
        [0, y, z + end * 0.01],
        row % 2 === 0 ? P.timber : P.timberLight,
      );
      // Vertical micro-planks inside each batten bay for seam read.
      if (row < 7 && w > 0.6) {
        for (const dx of [-w * 0.28, 0, w * 0.28]) {
          addBox(
            buckets,
            'timber',
            [0.08, rise / 9 + 0.04, 0.06],
            [dx, y + rise / 18, z + end * 0.02],
            P.timberDeep,
          );
        }
      }
    }
    // Peak plate + front shield disc (concept ornament under peak).
    addBox(buckets, 'timber', [0.36, 0.22, 0.14], [0, peakY - 0.02, z], P.timberLight);
    if (end > 0) {
      addCylinder(
        buckets,
        'timber',
        0.28,
        0.28,
        0.1,
        8,
        [0, peakY - 0.62, z + 0.04],
        P.timberDark,
        [Math.PI / 2, 0, 0],
      );
      addCylinder(buckets, 'metal', 0.12, 0.12, 0.07, 6, [0, peakY - 0.62, z + 0.09], P.ironLight, [
        Math.PI / 2,
        0,
        0,
      ]);
      // Small chevron under the disc.
      addBox(buckets, 'timber', [0.55, 0.1, 0.08], [0, peakY - 1.05, z + 0.03], P.timber);
      addBox(buckets, 'timber', [0.1, 0.35, 0.08], [0, peakY - 1.2, z + 0.03], P.timberDark);
    }
  }
  // Peak finial (concept iron spike).
  addCylinder(buckets, 'timber', 0.055, 0.065, 0.62, 5, [0, peakY + 0.42, 0], P.timberDark);
  addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.13, 0.38, 4), P.ironLight, {
    position: [0, peakY + 0.88, 0],
  });

  // ---- Round 5: rooted bone antlers (concept horns, continuous from roof) ----
  const bone = P.parchment;
  const boneDeep = P.parchmentDark;
  const hornSpecs = [
    { z: halfD * 0.18, s: 1.12, rootT: 0.4 },
    { z: -halfD * 0.14, s: 0.92, rootT: 0.42 },
  ];
  for (const side of [-1, 1]) {
    for (const horn of hornSpecs) {
      const s = horn.s;
      const rootT = horn.rootT;
      const surfX = side * halfW * (1 - rootT);
      const surfY = eaveY + rise * rootT;
      const rootZ = horn.z;
      // Mount digs into slope (timber socket + iron collar).
      addBox(
        buckets,
        'timber',
        [0.55 * s, 0.36 * s, 0.38 * s],
        [surfX - side * 0.05, surfY - 0.1, rootZ],
        P.timberDark,
        [0, 0, -side * pitch],
      );
      addBox(
        buckets,
        'metal',
        [0.46 * s, 0.2 * s, 0.32 * s],
        [surfX + side * 0.03, surfY + 0.02, rootZ],
        P.iron,
        [0, 0, -side * pitch],
      );
      // Thick continuous bone: heavy overlap so front reads one horn, not sticks.
      addBox(
        buckets,
        'timber',
        [0.48 * s, 0.3 * s, 0.3 * s],
        [surfX + side * 0.2 * s, surfY + 0.08 * s, rootZ],
        boneDeep,
        [0, 0, -side * 0.32],
      );
      addBox(
        buckets,
        'timber',
        [0.58 * s, 0.26 * s, 0.26 * s],
        [surfX + side * 0.52 * s, surfY + 0.2 * s, rootZ],
        bone,
        [0, 0, -side * 0.52],
      );
      addBox(
        buckets,
        'timber',
        [0.46 * s, 0.18 * s, 0.18 * s],
        [surfX + side * 0.88 * s, surfY + 0.4 * s, rootZ],
        bone,
        [0, 0, -side * 0.78],
      );
      addBox(
        buckets,
        'timber',
        [0.26 * s, 0.11 * s, 0.11 * s],
        [surfX + side * 1.14 * s, surfY + 0.58 * s, rootZ],
        boneDeep,
        [0, 0, -side * 1.0],
      );
      addBox(
        buckets,
        'metal',
        [0.15 * s, 0.15 * s, 0.2 * s],
        [surfX + side * 0.34 * s, surfY + 0.12 * s, rootZ],
        P.ironLight,
        [0, 0, -side * 0.38],
      );
    }
  }
  // Signal horn under front eave (service cue, concept brass).
  addCylinder(
    buckets,
    'metal',
    0.08,
    0.14,
    0.46,
    6,
    [0.5, wallTop + 0.08, frontZ + 0.08],
    P.brass,
    [Math.PI / 2, 0.22, 0],
  );
  addCylinder(
    buckets,
    'metal',
    0.05,
    0.05,
    0.24,
    5,
    [0.82, wallTop + 0.08, frontZ + 0.14],
    P.brassLight,
    [Math.PI / 2, 0.22, 0],
  );

  // ---- Round 6: entry porch, ironbound door, steps (clear approach) ----
  addIronboundDoor(buckets, 0, wallBottom + 1.12, frontZ - 0.02, 1.22, 2.22, 'rounded');
  for (const dx of [-0.28, -0.1, 0.1, 0.28]) {
    addBox(
      buckets,
      'timber',
      [0.14, 1.62, 0.05],
      [dx, wallBottom + 1.08, frontZ + 0.03],
      Math.abs(dx) < 0.15 ? P.timberLight : P.timber,
    );
  }
  for (const y of [wallBottom + 0.52, wallBottom + 1.08, wallBottom + 1.68, wallBottom + 2.15]) {
    addBox(buckets, 'metal', [1.12, 0.08, 0.06], [0, y, frontZ + 0.05], P.iron);
  }
  addTorus(buckets, 'metal', 0.14, 0.035, [0, wallBottom + 1.2, frontZ + 0.11], P.ironLight, [
    Math.PI / 2,
    0,
    0,
  ]);
  for (const x of [-0.78, 0.78]) {
    addBox(
      buckets,
      'timber',
      [0.14, 2.35, 0.14],
      [x, wallBottom + 1.25, frontZ - 0.05],
      P.timberDark,
    );
    for (const y of [wallBottom + 0.7, wallBottom + 1.4, wallBottom + 2.1]) {
      addBox(buckets, 'metal', [0.2, 0.1, 0.18], [x, y, frontZ - 0.02], P.iron);
    }
  }
  addBox(buckets, 'timber', [1.75, 0.12, 0.14], [0, wallBottom + 2.42, frontZ - 0.04], P.timber);
  // Porch canopy: shingles + timber gable face (matches main roof language).
  const porchEave = wallBottom + 2.42;
  const porchPeak = wallBottom + 3.28;
  const porchRise = porchPeak - porchEave;
  const _porchHalfW = 1.28;
  addShingledRoof(buckets, 2.55, 1.7, porchEave, porchPeak, {
    ridgeAxis: 'z',
    center: [0, 0, porchZ - 0.08],
    courses: 6,
  });
  // Porch gable timber fill (front of porch only).
  for (let row = 0; row < 5; row += 1) {
    const t = (row + 0.45) / 5;
    const y = porchEave + porchRise * t;
    const w = Math.max(0.2, 2.2 * (1 - t));
    addBox(
      buckets,
      'timber',
      [w, 0.09, 0.07],
      [0, y, porchZ + 0.55],
      row % 2 ? P.timber : P.timberLight,
    );
  }
  addBox(
    buckets,
    'timber',
    [0.1, porchRise * 0.9, 0.1],
    [0, porchEave + porchRise * 0.45, porchZ + 0.55],
    P.timberDark,
  );
  for (const x of [-1.05, 1.05]) {
    addBox(buckets, 'timber', [0.15, 1.42, 0.15], [x, wallBottom + 1.65, porchZ], P.timberDark);
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, wallBottom + 0.14, porchZ], P.iron);
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, wallBottom + 2.28, porchZ], P.ironLight);
  }
  addBox(buckets, 'timber', [2.25, 0.11, 0.13], [0, wallBottom + 2.35, porchZ], P.timber);
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [0.32, 0.08, 0.09],
      [sx * 1.2, porchEave + 0.12, porchZ + 0.58],
      P.timberLight,
      [0, 0, -sx * 0.5],
    );
    addBox(
      buckets,
      'roof',
      [0.2, 0.05, 0.1],
      [sx * 1.32, porchEave + 0.22, porchZ + 0.58],
      P.roofDeep,
      [0, 0, -sx * 0.7],
    );
  }
  addSteps(buckets, 0, porchZ + 0.42, 1.95, 5, 1, 0.02);
  for (const sx of [-1.05, 1.05]) {
    addBox(buckets, 'stone', [0.16, 0.58, 0.75], [sx, 0.32, porchZ + 0.25], P.stoneDeep);
    addBox(buckets, 'stone', [0.14, 0.2, 0.3], [sx, 0.72, porchZ + 0.35], P.moss);
  }
  // Rope rails open at steps (guard apron left stays clear).
  addRopeRail(buckets, -2.45, -1.15, baseH, 2.35, 3);
  addRopeRail(buckets, 1.15, 2.45, baseH, 2.35, 3);
  // Front apron rope chain posts (concept).
  for (const x of [-1.15, 1.15]) {
    addBox(buckets, 'timber', [0.1, 0.55, 0.1], [x, baseH + 0.35, porchZ + 0.75], P.timberDark);
    addCylinder(
      buckets,
      'cloth',
      0.03,
      0.03,
      1.0,
      5,
      [x * 0.5, baseH + 0.55, porchZ + 0.75],
      P.rope,
      [0, 0, x > 0 ? 0.05 : -0.05],
    );
  }

  // ---- Round 7: windows + iron frame depth ----
  addMullionedWindow(buckets, [0, wallBottom + 3.95, frontZ - 0.03], 1.12, {
    kind: 'rounded',
    frameBucket: 'metal',
  });
  // Window hood shelf (concept timber lintel over upper window).
  addBox(
    buckets,
    'timber',
    [1.35, 0.12, 0.18],
    [0, wallBottom + 4.55, frontZ + 0.05],
    P.timberDark,
  );
  addBox(buckets, 'timber', [1.15, 0.08, 0.12], [0, wallBottom + 4.68, frontZ + 0.02], P.timber);
  addMullionedWindow(buckets, [-bodyW * 0.48, wallBottom + 3.25, 0.45], 0.9, {
    face: 'left',
    frameBucket: 'metal',
  });
  addMullionedWindow(buckets, [-bodyW * 0.48, wallBottom + 4.85, -0.25], 0.78, {
    face: 'left',
    frameBucket: 'metal',
  });
  addMullionedWindow(buckets, [bodyW * 0.48, wallBottom + 3.55, -0.15], 0.9, {
    face: 'right',
    frameBucket: 'metal',
  });
  addMullionedWindow(buckets, [0.35, wallBottom + 3.25, rearZ + 0.03], 0.82, {
    face: 'back',
    frameBucket: 'metal',
  });
  // Extra mid-level iron belt on front (concept horizontal straps).
  for (const y of [wallBottom + wallH * 0.38, wallBottom + wallH * 0.62]) {
    addBox(buckets, 'metal', [bodyW * 0.95, 0.1, 0.08], [0, y, frontZ + 0.02], P.iron);
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      addBox(buckets, 'metal', [0.1, 0.1, 0.07], [x, y, frontZ + 0.05], P.ironLight);
    }
  }

  // ---- Round 8: lookout balcony (offset right, concept knee braces) ----
  addBox(buckets, 'timber', [2.0, 0.15, 1.72], [2.28, wallBottom + 3.38, 0.55], P.timberLight);
  for (const x of [1.48, 3.0]) {
    for (const z of [1.25, -0.15]) {
      addBox(buckets, 'timber', [0.11, 1.05, 0.11], [x, wallBottom + 3.98, z], P.timberDark);
      addBox(buckets, 'metal', [0.15, 0.09, 0.15], [x, wallBottom + 3.46, z], P.iron);
    }
  }
  addBox(buckets, 'timber', [1.7, 0.1, 0.1], [2.24, wallBottom + 4.48, 1.25], P.timber);
  addBox(buckets, 'timber', [1.7, 0.1, 0.1], [2.24, wallBottom + 4.48, -0.15], P.timber);
  addBox(buckets, 'timber', [0.1, 0.1, 1.5], [1.48, wallBottom + 4.48, 0.55], P.timberLight);
  addBox(buckets, 'timber', [0.1, 0.1, 1.5], [3.0, wallBottom + 4.48, 0.55], P.timberLight);
  // Mid rail + vertical pickets for denser balcony read.
  addBox(buckets, 'timber', [1.7, 0.07, 0.07], [2.24, wallBottom + 4.05, 1.25], P.timberDark);
  for (let i = 0; i < 5; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.07, 0.55, 0.07],
      [1.65 + i * 0.32, wallBottom + 4.2, 1.25],
      P.timber,
    );
  }
  for (const x of [1.55, 2.9]) {
    addDiagonalYZ(
      buckets,
      'timber',
      x,
      [wallBottom + 2.2, 0.05],
      [wallBottom + 3.35, 0.55],
      0.1,
      0.1,
      P.timberDark,
    );
  }
  for (let i = 0; i < 5; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.32, 0.06, 1.55],
      [1.65 + i * 0.35, wallBottom + 3.48, 0.55],
      i % 2 ? P.timber : P.timberLight,
    );
  }

  // ---- Round 9: lantern cage arm + banner + winch + rope ----
  addBox(
    buckets,
    'timber',
    [2.15, 0.14, 0.14],
    [-2.0, wallBottom + 3.7, frontZ + 0.32],
    P.timberDark,
    [0, 0, -0.08],
  );
  addBox(buckets, 'timber', [0.15, 0.5, 0.15], [-1.12, wallBottom + 3.55, frontZ + 0.28], P.timber);
  addBox(buckets, 'metal', [0.2, 0.12, 0.2], [-1.12, wallBottom + 3.85, frontZ + 0.28], P.iron);
  addBox(buckets, 'metal', [0.14, 0.14, 0.14], [-2.95, wallBottom + 3.58, frontZ + 0.32], P.iron);
  addCylinder(
    buckets,
    'metal',
    0.03,
    0.03,
    1.05,
    5,
    [-2.95, wallBottom + 2.95, frontZ + 0.32],
    P.iron,
  );
  // Lantern cage frame (taller iron lattice).
  addBox(
    buckets,
    'metal',
    [0.32, 0.52, 0.32],
    [-2.95, wallBottom + 2.38, frontZ + 0.32],
    P.ironLight,
  );
  for (const dx of [-0.1, 0.1]) {
    addBox(
      buckets,
      'metal',
      [0.04, 0.48, 0.04],
      [-2.95 + dx, wallBottom + 2.38, frontZ + 0.32],
      P.iron,
    );
  }
  addLantern(buckets, [-2.95, wallBottom + 2.28, frontZ + 0.32], 1.1);
  addCylinder(
    buckets,
    'cloth',
    0.032,
    0.032,
    2.7,
    5,
    [-1.7, wallBottom + 1.9, frontZ + 0.14],
    P.rope,
    [0.34, 0, 0.08],
  );

  // Banner arm on right (concept) + blank teal cloth.
  addBox(
    buckets,
    'timber',
    [0.12, 0.12, 1.15],
    [2.05, wallBottom + 4.25, -frontZ - 0.05],
    P.timberDark,
  );
  addBox(buckets, 'metal', [0.14, 0.1, 0.14], [2.05, wallBottom + 4.25, -frontZ - 0.55], P.iron);
  addBox(
    buckets,
    'cloth',
    [0.09, 1.65, 0.82],
    [2.05, wallBottom + 3.3, -frontZ - 0.55],
    P.clothTeal,
    [0, 0, -0.05],
  );
  addBox(
    buckets,
    'cloth',
    [0.07, 0.42, 0.35],
    [1.88, wallBottom + 2.48, -frontZ - 0.68],
    P.roofDeep,
    [0, 0, -0.14],
  );

  addSideWinch(buckets, -bodyW * 0.55, wallBottom + 1.75, -0.45);
  addCylinder(
    buckets,
    'cloth',
    0.032,
    0.032,
    1.65,
    5,
    [-bodyW * 0.55, wallBottom + 0.9, -0.45],
    P.rope,
  );
  addCylinder(
    buckets,
    'cloth',
    0.036,
    0.036,
    3.5,
    5,
    [0.4, wallBottom + 2.55, rearZ - 0.06],
    P.rope,
    [0.4, 0, 0.12],
  );

  // ---- Round 10: moss, hardware, clutter, final seat (guard apron clear) ----
  for (const x of [-bodyW * 0.46, bodyW * 0.46]) {
    for (const z of [frontZ - 0.05, rearZ + 0.05]) {
      for (const y of [wallBottom + 1.15, wallBottom + 2.7, wallBottom + 4.4, wallTop - 0.4]) {
        addBox(buckets, 'metal', [0.07, 0.07, 0.06], [x * 1.05, y, z * 1.02], P.ironLight);
      }
    }
  }
  // Moss cushions on stone courses.
  for (const x of [-2.0, -0.7, 0.7, 2.0]) {
    addBox(buckets, 'stone', [0.58, 0.1, 0.24], [x, 0.58, 2.32], P.moss);
  }
  for (const [x, z] of [
    [-2.4, -1.9],
    [2.4, -1.8],
    [2.5, 1.6],
  ]) {
    addBox(buckets, 'stone', [0.4, 0.08, 0.28], [x, 0.55, z], P.moss);
  }
  // Clutter: right / rear only (left front is guard apron socket).
  addBarrel(buckets, [2.48, baseH + 0.36, 1.95], 0.74);
  addBarrel(buckets, [2.7, baseH + 0.33, 1.38], 0.6);
  addBarrel(buckets, [2.4, baseH + 0.34, -1.55], 0.68);
  addBarrel(buckets, [-2.45, baseH + 0.34, -1.75], 0.64);
  addBox(buckets, 'timber', [0.58, 0.42, 0.52], [2.55, baseH + 0.36, -0.75], P.timberLight);
  addBox(buckets, 'timber', [0.4, 0.28, 0.35], [2.35, baseH + 0.28, -0.25], P.timber);
  for (const [x, z, lean] of [
    [2.9, 2.05, -0.18],
    [-2.85, -2.05, 0.16],
  ]) {
    addCylinder(buckets, 'timber', 0.06, 0.08, 0.95, 5, [x, 0.42, z], P.timberDark, [0, 0, lean]);
  }
  // Wall-plate eave locks (seat roof to shell).
  for (const z of [frontZ * 0.98, rearZ * 0.98]) {
    addBox(buckets, 'timber', [bodyW * 1.14, 0.13, 0.11], [0, wallTop + 0.02, z], P.timberDark);
  }
  for (const x of [-bodyW * 0.52, bodyW * 0.52]) {
    addBox(buckets, 'timber', [0.11, 0.13, bodyD * 1.1], [x, wallTop + 0.02, 0], P.timberDark);
  }
  // Rain-dark streaks under eaves.
  for (const [x, y, h] of [
    [-0.85, wallBottom + 3.7, 2.35],
    [0.35, wallBottom + 4.15, 1.85],
    [1.0, wallBottom + 3.25, 2.15],
    [-0.2, wallBottom + 5.0, 1.2],
  ]) {
    addBox(buckets, 'timber', [0.1, h, 0.06], [x, y, frontZ - 0.02], P.timberDeep);
  }
  // Mid belt iron studs on front.
  for (const x of [-1.15, -0.55, 0, 0.55, 1.15]) {
    addBox(
      buckets,
      'metal',
      [0.1, 0.1, 0.07],
      [x, wallBottom + wallH * 0.5, frontZ + 0.03],
      P.ironLight,
    );
  }

  // R16-30 exterior polish: weathering, hardware, moss, corner lanterns (guard apron clear).
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH,
    clearFront: 1.15,
    density: 1.05,
    fenlight: true,
  });
  // Signal-tower specific: extra balcony rail studs + horn mount ring.
  for (const x of [-1.35, -0.45, 0.45, 1.35]) {
    addBox(buckets, 'metal', [0.08, 0.08, 0.06], [x, wallTop - 0.55, frontZ + 0.04], P.brass);
  }
  addCylinder(buckets, 'metal', 0.08, 0.1, 0.12, 6, [0, peakY - 0.35, 0.15], P.brassLight);
}

/**
 * Lantern Chapel: exterior-only multi-round rebuild from admitted turnaround crops.
 * Identity: moss-stone footing + buttresses, timber nave, pointed gothic portal,
 * diamond gable window, open bell gable with brass bell, continuous bent teal roof,
 * lancet windows, left archive niche (scrolls/ledgers), grave-lamp posts, hanging lanterns.
 * Sockets: front-entry [0,0,3.5], archive-display [-3.5,1.15,0]. No interior.
 * Ten polish rounds for concept fidelity (see round tags).
 */
export function buildLanternChapel(buckets) {
  // ---- Round 1: proportions + moss-stone footing + corner buttresses ----
  const baseH = 0.95;
  const wallBottom = baseH + 0.02;
  const wallTop = 4.55;
  const peakY = 6.85;
  const bodyW = 5.35;
  const bodyD = 5.55;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyD * 0.5;
  const rearZ = -bodyD * 0.5;
  const halfW = bodyW * 0.5;

  addBox(buckets, 'stone', [6.35, baseH * 0.55, 6.45], [0, baseH * 0.28, 0.05], P.stoneDeep);
  addBox(buckets, 'stone', [5.85, baseH * 0.48, 5.95], [0, baseH * 0.72, 0.05], P.stone);
  addMasonryCourse(buckets, 6.1, 0.28, baseH * 0.55, [0, 3.05], { blocks: 9, height: 0.55 });
  addMasonryCourse(buckets, 6.1, 0.28, baseH * 0.55, [0, -2.95], { blocks: 9, height: 0.55 });
  // Corner buttresses (concept heavy stone corners).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        buckets,
        'stone',
        [0.55, baseH * 1.15, 0.55],
        [sx * 2.85, baseH * 0.55, sz * 2.85],
        P.stoneDeep,
      );
      addBox(
        buckets,
        'stone',
        [0.42, baseH * 0.85, 0.42],
        [sx * 2.85, baseH * 0.95, sz * 2.85],
        sx * sz > 0 ? P.stone : P.moss,
      );
    }
  }
  // Side course blocks with moss.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      const z = -2.2 + i * 1.1;
      addBox(
        buckets,
        'stone',
        [0.28, baseH * 0.7, 0.85],
        [side * 3.0, baseH * 0.48, z],
        i % 2 === 0 ? P.stone : i % 3 === 0 ? P.moss : P.stoneLight,
      );
    }
  }
  for (const x of [-2.2, -0.7, 0.7, 2.2]) {
    addBox(buckets, 'stone', [0.65, 0.1, 0.28], [x, 0.52, 3.05], P.moss);
  }

  // ---- Round 2: timber nave shell + iron straps + wall plate ----
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.96, bodyD * 0.86],
    [0, wallCy, 0],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.95, wallH, [0, wallCy, frontZ - 0.04], {
    plankCount: 11,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.95, wallH, [0, wallCy, rearZ + 0.04], {
    plankCount: 11,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.92, wallH, [-halfW * 0.92, wallCy, 0], {
    plankCount: 10,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.92, wallH, [halfW * 0.92, wallCy, 0], {
    plankCount: 10,
  });
  // Corner posts.
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const z of [rearZ + 0.04, frontZ - 0.04]) {
      addBox(buckets, 'timber', [0.26, wallH + 0.2, 0.26], [x, wallCy, z], P.timberDark);
      for (const y of [
        wallBottom + 0.45,
        wallBottom + wallH * 0.38,
        wallBottom + wallH * 0.68,
        wallTop - 0.35,
      ]) {
        addBox(buckets, 'metal', [0.32, 0.12, 0.32], [x, y, z], P.iron);
        addBox(
          buckets,
          'metal',
          [0.08, 0.08, 0.08],
          [x + Math.sign(x) * 0.14, y, z + Math.sign(z || 1) * 0.14],
          P.ironLight,
        );
      }
    }
  }
  // Horizontal rails on each face.
  for (const z of [frontZ - 0.02, rearZ + 0.02]) {
    for (const y of [wallBottom + wallH * 0.32, wallBottom + wallH * 0.62, wallTop - 0.08]) {
      addBox(buckets, 'timber', [bodyW * 0.98, 0.14, 0.14], [0, y, z], P.timberDark);
    }
  }
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const y of [wallBottom + wallH * 0.32, wallBottom + wallH * 0.62, wallTop - 0.08]) {
      addBox(buckets, 'timber', [0.14, 0.14, bodyD * 0.95], [x, y, 0], P.timberDark);
    }
  }
  // Wall plate the roof seats on.
  addBox(
    buckets,
    'timber',
    [bodyW * 1.06, 0.16, bodyD * 1.06],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );
  // Front gable truss braces (concept diagonal timber).
  addBeamXY(
    buckets,
    'timber',
    [-halfW * 0.42, wallBottom + 0.5],
    [-0.15, wallTop - 0.6],
    frontZ - 0.02,
    0.11,
    0.12,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [halfW * 0.42, wallBottom + 0.5],
    [0.15, wallTop - 0.6],
    frontZ - 0.02,
    0.11,
    0.12,
    P.timber,
  );
  // Rear X braces (concept rear timber face).
  addBeamXY(
    buckets,
    'timber',
    [-halfW * 0.4, wallBottom + 0.55],
    [halfW * 0.35, wallTop - 0.7],
    rearZ + 0.03,
    0.1,
    0.11,
    P.timberDark,
  );
  addBeamXY(
    buckets,
    'timber',
    [halfW * 0.4, wallBottom + 0.55],
    [-halfW * 0.35, wallTop - 0.7],
    rearZ + 0.03,
    0.1,
    0.11,
    P.timberDark,
  );

  // ---- Round 3: teal roof with ridge front-to-back (front = timber gable) ----
  // Concept front is a tall pointed WOOD gable, not a shingle slope. Ridge runs
  // along Z so left/right slopes carry teal courses; ends get timber gable skins.
  const roofW = bodyW * 1.28;
  const roofD = bodyD * 1.22;
  const eaveY = wallTop + 0.02;
  const rise = peakY - eaveY;
  const roofHalfW = roofW / 2;
  const roofHalfD = roofD / 2;
  const _pitch = Math.atan2(rise, roofHalfW);
  addShingledRoof(buckets, roofW, roofD, eaveY, peakY, {
    ridgeAxis: 'z',
    courses: 11,
  });
  // Timber ridge rail + eave fascia.
  addBox(buckets, 'timber', [0.14, 0.1, roofD * 1.02], [0, peakY + 0.11, 0], P.timberDark);
  for (const z of [roofHalfD * 0.98, -roofHalfD * 0.98]) {
    addBox(buckets, 'timber', [roofW * 1.02, 0.12, 0.1], [0, eaveY - 0.01, z], P.timberDark);
  }
  for (const x of [-roofHalfW * 0.98, roofHalfW * 0.98]) {
    addBox(buckets, 'timber', [0.1, 0.12, roofD * 0.98], [x, eaveY - 0.01, 0], P.timberDark);
  }
  // Upswept eave tips only at side corners (seated, not floating sticks).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        buckets,
        'timber',
        [0.28, 0.08, 0.09],
        [sx * (roofHalfW - 0.08), eaveY + 0.1, sz * (roofHalfD - 0.18)],
        P.timberLight,
        [0, 0, -sx * 0.42],
      );
    }
  }
  // Vertical timber gable skins AT the roof ends (not behind the overhang), so
  // front/rear never read as a flat teal triangle. Concept wood gable faces.
  for (const end of [-1, 1]) {
    const z = end * (roofHalfD + 0.02);
    // Solid backer plate under the plank rhythm (closes the triangle).
    for (let row = 0; row < 10; row += 1) {
      const t0 = row / 10;
      const t1 = (row + 1) / 10;
      const midT = (t0 + t1) * 0.5;
      const y = eaveY + rise * midT;
      const w = Math.max(0.22, roofW * (1 - midT) * 0.96);
      addBox(
        buckets,
        'timber',
        [w, rise / 10 + 0.02, 0.1],
        [0, y, z],
        row % 2 === 0 ? P.timberDeep : P.timber,
      );
    }
    // King post + short edge posts only (no long raking sticks above the ridge).
    addBox(
      buckets,
      'timber',
      [0.14, rise * 0.98, 0.12],
      [0, eaveY + rise * 0.5, z + end * 0.04],
      P.timberDark,
    );
    // Bargeboard strips as short stepped segments along the roof edge.
    for (const side of [-1, 1]) {
      for (let s = 0; s < 5; s += 1) {
        const t = (s + 0.55) / 5;
        const y = eaveY + rise * t;
        const x = side * roofHalfW * (1 - t) * 0.92;
        addBox(
          buckets,
          'timber',
          [0.14, 0.12, 0.1],
          [x, y, z + end * 0.05],
          s % 2 ? P.timberLight : P.timber,
        );
      }
    }
    // Horizontal battens for seam read.
    for (const t of [0.22, 0.42, 0.62, 0.8]) {
      const y = eaveY + rise * t;
      const w = Math.max(0.25, bodyW * (1 - t) * 0.88);
      addBox(buckets, 'timber', [w, 0.09, 0.08], [0, y, z + end * 0.06], P.timberLight);
    }
    addBox(buckets, 'timber', [0.32, 0.18, 0.12], [0, peakY - 0.02, z + end * 0.04], P.timberLight);
  }

  // ---- Round 4: open bell gable on FRONT peak + brass bell + finial ----
  const bellZ = frontZ * 0.05;
  const bellBaseY = peakY - 0.05;
  const bellPeakY = peakY + 1.65;
  // Open timber belfry (posts leave negative space for the bell).
  for (const x of [-0.38, 0.38]) {
    for (const z of [bellZ - 0.22, bellZ + 0.22]) {
      addBox(buckets, 'timber', [0.11, 1.4, 0.11], [x, bellBaseY + 0.72, z], P.timberDark);
    }
  }
  addBox(buckets, 'timber', [0.88, 0.11, 0.11], [0, bellBaseY + 0.12, bellZ], P.timber);
  addBox(buckets, 'timber', [0.88, 0.11, 0.11], [0, bellBaseY + 1.28, bellZ], P.timber);
  addBox(buckets, 'timber', [0.11, 0.11, 0.55], [-0.38, bellBaseY + 1.28, bellZ], P.timberLight);
  addBox(buckets, 'timber', [0.11, 0.11, 0.55], [0.38, bellBaseY + 1.28, bellZ], P.timberLight);
  // Pointed belfry arch.
  addBeamXY(
    buckets,
    'timber',
    [-0.38, bellBaseY + 1.32],
    [0, bellPeakY - 0.4],
    bellZ + 0.24,
    0.09,
    0.1,
    P.timberLight,
  );
  addBeamXY(
    buckets,
    'timber',
    [0.38, bellBaseY + 1.32],
    [0, bellPeakY - 0.4],
    bellZ + 0.24,
    0.09,
    0.1,
    P.timberLight,
  );
  // Small teal cap on belfry.
  addPitchedRoof(buckets, 'roof', 1.05, 0.8, bellBaseY + 1.38, bellPeakY - 0.12, P.roof, {
    ridgeAxis: 'z',
    center: [0, 0, bellZ],
  });
  for (let c = 0; c < 3; c += 1) {
    const t = (c + 0.55) / 3;
    const y = bellBaseY + 1.38 + (bellPeakY - 0.12 - bellBaseY - 1.38) * t + 0.03;
    for (const slope of [-1, 1]) {
      addBox(
        buckets,
        'roof',
        [0.16, 0.04, 0.65],
        [slope * 0.4 * (1 - t), y, bellZ],
        c % 2 ? P.roofDeep : P.roofLight,
        [0, 0, -slope * 0.65],
      );
    }
  }
  // Brass bell + clapper hanging in the open frame.
  addCylinder(buckets, 'metal', 0.15, 0.21, 0.26, 8, [0, bellBaseY + 0.78, bellZ], P.brass);
  addCylinder(buckets, 'metal', 0.04, 0.04, 0.2, 5, [0, bellBaseY + 0.55, bellZ], P.brassLight);
  addOctahedron(buckets, 'metal', 0.055, [0, bellBaseY + 0.42, bellZ], P.brassLight);
  addCylinder(buckets, 'metal', 0.028, 0.028, 0.32, 5, [0, bellBaseY + 1.08, bellZ], P.iron);
  // Finial.
  addCylinder(buckets, 'timber', 0.04, 0.05, 0.42, 5, [0, bellPeakY + 0.08, bellZ], P.timberDark);
  addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.1, 0.28, 4), P.ironLight, {
    position: [0, bellPeakY + 0.4, bellZ],
  });
  // Small rear-gable peak plate only (no free-standing knobs on the slope).
  addBox(
    buckets,
    'timber',
    [0.28, 0.16, 0.12],
    [0, peakY - 0.04, -roofHalfD - 0.02],
    P.timberLight,
  );

  // ---- Round 5: pointed portal, double door, steps (clear approach) ----
  // Nested pointed arch frame.
  addArchedFrame(
    buckets,
    'timber',
    1.85,
    2.55,
    1.45,
    2.15,
    0.14,
    [0, wallBottom + 1.35, frontZ - 0.01],
    P.timberDark,
    { kind: 'pointed' },
  );
  addArchedFrame(
    buckets,
    'metal',
    1.55,
    2.25,
    1.25,
    1.95,
    0.1,
    [0, wallBottom + 1.35, frontZ + 0.03],
    P.iron,
    { kind: 'pointed' },
  );
  // Double door leaves.
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [0.55, 1.85, 0.1],
      [sx * 0.32, wallBottom + 1.15, frontZ + 0.02],
      sx < 0 ? P.timberDeep : P.timber,
    );
    for (const dy of [-0.55, 0, 0.55]) {
      addBox(
        buckets,
        'metal',
        [0.42, 0.08, 0.06],
        [sx * 0.32, wallBottom + 1.15 + dy, frontZ + 0.08],
        P.iron,
      );
    }
    addBox(
      buckets,
      'metal',
      [0.08, 0.7, 0.06],
      [sx * 0.48, wallBottom + 1.15, frontZ + 0.09],
      P.ironLight,
    );
  }
  // Door handles (brass rings).
  for (const sx of [-1, 1]) {
    addTorus(
      buckets,
      'metal',
      0.09,
      0.025,
      [sx * 0.18, wallBottom + 1.15, frontZ + 0.12],
      P.brass,
      [Math.PI / 2, 0, 0],
    );
  }
  // Steps clear to socket.
  addSteps(buckets, 0, frontZ + 0.55, 1.9, 4, 1, 0.02);
  for (const sx of [-1.05, 1.05]) {
    addBox(buckets, 'stone', [0.18, 0.5, 0.7], [sx, 0.28, frontZ + 0.4], P.stoneDeep);
  }
  // Diamond gable window above portal (concept amber).
  addBox(buckets, 'warm', [0.38, 0.38, 0.06], [0, wallBottom + 3.55, frontZ + 0.02], P.warm, [
    0,
    0,
    Math.PI / 4,
  ]);
  addBox(buckets, 'metal', [0.48, 0.06, 0.08], [0, wallBottom + 3.55, frontZ + 0.05], P.iron);
  addBox(buckets, 'metal', [0.06, 0.48, 0.08], [0, wallBottom + 3.55, frontZ + 0.05], P.iron);
  addBox(
    buckets,
    'timber',
    [0.55, 0.55, 0.08],
    [0, wallBottom + 3.55, frontZ - 0.02],
    P.timberDark,
    [0, 0, Math.PI / 4],
  );
  // Flanking pointed lancets beside portal (concept).
  for (const sx of [-1.15, 1.15]) {
    addMullionedWindow(buckets, [sx, wallBottom + 1.55, frontZ - 0.02], 0.72, {
      kind: 'pointed',
      frameBucket: 'metal',
    });
  }

  // ---- Round 6: lancet windows (sides + rear) ----
  // Right long elevation: three pointed lancets (concept).
  for (const [i, z] of [
    [0, 0.85],
    [1, -0.15],
    [2, -1.15],
  ]) {
    addMullionedWindow(buckets, [halfW * 0.94, wallBottom + 2.05, z], 0.85, {
      face: 'right',
      kind: 'pointed',
      frameBucket: 'metal',
    });
    // Sill shelf.
    addBox(
      buckets,
      'timber',
      [0.14, 0.1, 0.55],
      [halfW * 0.98, wallBottom + 1.55, z],
      i % 2 ? P.timber : P.timberLight,
    );
  }
  // Left elevation: one lancet toward rear (archive niche owns mid-front left).
  addMullionedWindow(buckets, [-halfW * 0.94, wallBottom + 2.15, -1.0], 0.8, {
    face: 'left',
    kind: 'pointed',
    frameBucket: 'metal',
  });
  // Rear circular rose (concept).
  addCylinder(buckets, 'warm', 0.32, 0.32, 0.08, 10, [0, wallBottom + 3.2, rearZ + 0.02], P.warm, [
    Math.PI / 2,
    0,
    0,
  ]);
  addTorus(buckets, 'metal', 0.36, 0.05, [0, wallBottom + 3.2, rearZ + 0.06], P.iron, [
    Math.PI / 2,
    0,
    0,
  ]);
  addBox(buckets, 'metal', [0.06, 0.55, 0.06], [0, wallBottom + 3.2, rearZ + 0.08], P.ironLight);
  addBox(buckets, 'metal', [0.55, 0.06, 0.06], [0, wallBottom + 3.2, rearZ + 0.08], P.ironLight);
  // Small roof dormer (concept side/hero).
  addBox(buckets, 'timber', [0.55, 0.7, 0.55], [-0.85, wallTop + 0.55, 0.2], P.timberDark);
  addPitchedRoof(buckets, 'roof', 0.75, 0.7, wallTop + 0.85, wallTop + 1.35, P.roofDeep, {
    ridgeAxis: 'z',
    center: [-0.85, 0, 0.2],
  });
  addMullionedWindow(buckets, [-0.85, wallTop + 0.55, 0.48], 0.45, {
    kind: 'pointed',
    frameBucket: 'metal',
  });

  // ---- Round 7: archive niche on left (socket -3.5, 1.15, 0) ----
  // Protected exterior niche: roofed shelf with ledgers + scrolls (no readable text).
  // Push slightly outward so left elevation reads the service cue clearly.
  const archX = -halfW * 1.02;
  const archZ = 0.2;
  addBox(
    buckets,
    'timber',
    [0.65, 1.25, 1.55],
    [archX - 0.2, wallBottom + 1.4, archZ],
    P.timberDeep,
  );
  addBox(
    buckets,
    'timber',
    [0.78, 0.12, 1.7],
    [archX - 0.15, wallBottom + 2.05, archZ],
    P.timberDark,
  );
  // Mini shingle awning over niche (ridge along Z so it faces outward on left).
  addPitchedRoof(buckets, 'roof', 0.85, 1.7, wallBottom + 2.08, wallBottom + 2.65, P.roof, {
    ridgeAxis: 'z',
    center: [archX - 0.25, 0, archZ],
  });
  for (let c = 0; c < 4; c += 1) {
    const t = (c + 0.55) / 4;
    addBox(
      buckets,
      'roof',
      [0.2, 0.04, 1.55],
      [archX - 0.25 - t * 0.15, wallBottom + 2.2 + t * 0.35, archZ],
      c % 2 ? P.roofDeep : P.roofLight,
      [0, 0, 0.35],
    );
  }
  // Ledgers / books (organic + timber).
  for (const [dx, dy, dz, sx, sy, sz, col] of [
    [-0.05, 0.15, -0.35, 0.18, 0.28, 0.22, P.timberLight],
    [0.05, 0.12, -0.05, 0.16, 0.22, 0.18, P.timber],
    [-0.02, 0.1, 0.25, 0.2, 0.18, 0.25, P.timberDark],
    [0.08, 0.08, 0.45, 0.14, 0.14, 0.14, P.parchmentDark],
  ]) {
    addBox(
      buckets,
      'timber',
      [sx, sy, sz],
      [archX + 0.05 + dx, wallBottom + 0.95 + dy, archZ + dz],
      col,
    );
  }
  // Rolled parchment cylinders.
  for (const [dz, r] of [
    [-0.15, 0.06],
    [0.1, 0.055],
    [0.35, 0.07],
  ]) {
    addCylinder(
      buckets,
      'parchment',
      r,
      r,
      0.32,
      6,
      [archX + 0.12, wallBottom + 1.35, archZ + dz],
      P.parchment,
      [0, 0, Math.PI / 2],
    );
  }
  // Blank scroll panel (no text): push outward for left-elevation read.
  addBox(
    buckets,
    'parchment',
    [0.08, 0.62, 0.85],
    [archX - 0.05, wallBottom + 1.5, archZ + 0.05],
    P.parchment,
    [0, 0.06, 0],
  );
  addBox(
    buckets,
    'parchment',
    [0.06, 0.4, 0.5],
    [archX - 0.08, wallBottom + 1.35, archZ - 0.15],
    P.parchmentDark,
    [0, -0.1, 0],
  );
  addBox(
    buckets,
    'metal',
    [0.05, 0.08, 0.08],
    [archX - 0.02, wallBottom + 1.75, archZ + 0.05],
    P.brass,
  );
  // Niche posts.
  for (const z of [archZ - 0.6, archZ + 0.6]) {
    addBox(buckets, 'timber', [0.12, 1.5, 0.12], [archX - 0.35, wallBottom + 1.0, z], P.timberDark);
    addBox(buckets, 'metal', [0.16, 0.1, 0.16], [archX - 0.35, wallBottom + 0.3, z], P.iron);
  }

  // ---- Round 8: grave-lamp posts + hanging lanterns ----
  // Tall iron grave-lamp posts at outer corners (concept pointed caps).
  for (const [x, z] of [
    [-3.05, 2.65],
    [3.05, 2.65],
    [-3.05, -2.55],
    [3.05, -2.55],
  ]) {
    addCylinder(buckets, 'metal', 0.07, 0.08, 2.45, 6, [x, wallBottom + 1.35, z], P.iron);
    addBox(buckets, 'metal', [0.22, 0.12, 0.22], [x, wallBottom + 0.15, z], P.ironLight);
    addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.14, 0.35, 4), P.ironLight, {
      position: [x, wallBottom + 2.75, z],
    });
    addCylinder(buckets, 'metal', 0.1, 0.1, 0.12, 6, [x, wallBottom + 2.55, z], P.iron);
  }
  // Hanging lantern arms (front left concept + side).
  addBox(
    buckets,
    'timber',
    [1.15, 0.12, 0.12],
    [-1.55, wallBottom + 2.85, frontZ + 0.25],
    P.timberDark,
    [0, 0, -0.12],
  );
  addBox(buckets, 'metal', [0.12, 0.12, 0.12], [-2.35, wallBottom + 2.7, frontZ + 0.28], P.iron);
  addCylinder(
    buckets,
    'metal',
    0.025,
    0.025,
    0.55,
    5,
    [-2.35, wallBottom + 2.35, frontZ + 0.28],
    P.iron,
  );
  addLantern(buckets, [-2.35, wallBottom + 1.95, frontZ + 0.28], 0.95);
  // Right-side hanging lantern.
  addBox(
    buckets,
    'timber',
    [0.12, 0.12, 0.85],
    [halfW * 0.95, wallBottom + 2.7, -2.0],
    P.timberDark,
  );
  addCylinder(
    buckets,
    'metal',
    0.025,
    0.025,
    0.5,
    5,
    [halfW * 0.95, wallBottom + 2.35, -2.55],
    P.iron,
  );
  addLantern(buckets, [halfW * 0.95, wallBottom + 1.95, -2.55], 0.9);
  // Rear hanging lantern.
  addBox(buckets, 'timber', [0.9, 0.1, 0.1], [1.1, wallBottom + 2.6, rearZ - 0.15], P.timberDark);
  addCylinder(
    buckets,
    'metal',
    0.025,
    0.025,
    0.45,
    5,
    [1.7, wallBottom + 2.3, rearZ - 0.2],
    P.iron,
  );
  addLantern(buckets, [1.7, wallBottom + 1.95, rearZ - 0.2], 0.88);
  // Iron chain accents (concept hanging chains on rear/side).
  for (const [x, z, h] of [
    [-2.6, -1.8, 2.2],
    [2.7, 0.5, 1.9],
  ]) {
    addCylinder(buckets, 'metal', 0.03, 0.03, h, 5, [x, wallBottom + h * 0.45, z], P.ironLight);
  }

  // ---- Round 9: micro hardware, moss, clutter (clear front approach + archive) ----
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const z of [frontZ - 0.04, rearZ + 0.04]) {
      for (const y of [wallBottom + 1.0, wallBottom + 2.2, wallBottom + 3.4]) {
        addBox(buckets, 'metal', [0.07, 0.07, 0.06], [x * 1.04, y, z * 1.02], P.ironLight);
      }
    }
  }
  // Mid iron belt studs on front rails.
  for (const x of [-1.6, -0.7, 0.7, 1.6]) {
    addBox(
      buckets,
      'metal',
      [0.1, 0.1, 0.07],
      [x, wallBottom + wallH * 0.5, frontZ + 0.03],
      P.ironLight,
    );
  }
  // Corner moss pads.
  for (const [x, z] of [
    [-2.7, 2.7],
    [2.7, 2.6],
    [-2.6, -2.6],
    [2.65, -2.55],
  ]) {
    addBox(buckets, 'stone', [0.5, 0.1, 0.4], [x, 0.5, z], P.moss);
  }
  // Clutter off approach: barrels at rear corners only.
  addBarrel(buckets, [2.55, baseH + 0.35, -2.35], 0.7);
  addBarrel(buckets, [2.75, baseH + 0.32, -1.75], 0.55);
  addBarrel(buckets, [-2.6, baseH + 0.34, -2.4], 0.65);
  addBox(buckets, 'timber', [0.5, 0.35, 0.45], [2.4, baseH + 0.3, 2.4], P.timberLight);

  // ---- Round 10: eave locks, rain streaks, final seat ----
  for (const z of [frontZ * 0.98, rearZ * 0.98]) {
    addBox(buckets, 'timber', [bodyW * 1.12, 0.12, 0.1], [0, wallTop + 0.02, z], P.timberDark);
  }
  for (const x of [-halfW * 1.0, halfW * 1.0]) {
    addBox(buckets, 'timber', [0.1, 0.12, bodyD * 1.1], [x, wallTop + 0.02, 0], P.timberDark);
  }
  // Rain-dark streaks under eaves (damp hierarchy).
  for (const [x, y, h] of [
    [-1.1, wallBottom + 2.8, 1.6],
    [0.55, wallBottom + 3.1, 1.3],
    [1.4, wallBottom + 2.5, 1.5],
  ]) {
    addBox(buckets, 'timber', [0.1, h, 0.06], [x, y, frontZ - 0.02], P.timberDeep);
  }
  // Side rain streaks on right elevation.
  for (const [z, h] of [
    [0.9, 1.4],
    [-0.2, 1.2],
  ]) {
    addBox(buckets, 'timber', [0.06, h, 0.1], [halfW * 0.96, wallBottom + 2.6, z], P.timberDeep);
  }

  // R16-30 exterior polish: archive niche stays clear (clearFront left of door).
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH,
    clearFront: 1.0,
    density: 1.1,
    fenlight: true,
  });
  // Bell gable hardware + grave-lamp bases.
  for (const x of [-1.55, 1.55]) {
    addBox(buckets, 'metal', [0.12, 0.08, 0.12], [x, wallTop + 0.35, 0.1], P.brass);
  }
  for (const [x, z] of [
    [-2.9, 2.85],
    [2.9, 2.8],
  ]) {
    addCylinder(buckets, 'stone', 0.14, 0.16, 0.35, 6, [x, 0.35, z], P.stoneDeep);
    addCylinder(buckets, 'metal', 0.04, 0.04, 1.1, 5, [x, 1.0, z], P.iron);
    addLantern(buckets, [x, 1.55, z], 0.55, 'fenlight');
  }
}

/**
 * Gilded Strongbox: bank house, stone plinth, timber shell, teller window + bars,
 * iron vault door, gilded blank sign, chest prop, chimney. Sockets: front-entry
 * [1.75,0,3.25], teller-window [-1.25,1.45,3.25]. Multi-round exterior rebuild.
 */
export function buildGildedStrongbox(buckets) {
  const baseH = 0.85;
  const wallBottom = baseH + 0.02;
  const wallTop = 3.85;
  const peakY = 5.65;
  const bodyW = 6.2;
  const bodyD = 5.2;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyD * 0.5;
  const halfW = bodyW * 0.5;

  // R1-2 footing
  addBox(buckets, 'stone', [7.0, baseH * 0.55, 5.9], [0, baseH * 0.28, 0], P.stoneDeep);
  addBox(buckets, 'stone', [6.5, baseH * 0.48, 5.45], [0, baseH * 0.72, 0], P.stone);
  addMasonryCourse(buckets, 6.7, 0.26, baseH * 0.5, [0, 2.75], { blocks: 9, height: 0.5 });
  for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    addBox(buckets, 'stone', [0.55, 0.1, 0.25], [x, 0.48, 2.75], P.moss);
  }

  // R3 shell
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.96, bodyD * 0.86],
    [0, wallCy, 0],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.95, wallH, [0, wallCy, frontZ - 0.04], {
    plankCount: 12,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.95, wallH, [0, wallCy, -frontZ + 0.04], {
    plankCount: 12,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.92, wallH, [-halfW * 0.92, wallCy, 0], {
    plankCount: 9,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.92, wallH, [halfW * 0.92, wallCy, 0], {
    plankCount: 9,
  });
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const z of [-frontZ + 0.04, frontZ - 0.04]) {
      addBox(buckets, 'timber', [0.24, wallH + 0.15, 0.24], [x, wallCy, z], P.timberDark);
      for (const y of [wallBottom + 0.4, wallBottom + wallH * 0.55, wallTop - 0.3]) {
        addBox(buckets, 'metal', [0.3, 0.12, 0.3], [x, y, z], P.iron);
      }
    }
  }
  addBox(
    buckets,
    'timber',
    [bodyW * 1.05, 0.15, bodyD * 1.05],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );

  // R4-5 roof ridge X (long front eaves under porch) with dormers
  addShingledRoof(buckets, bodyW * 1.2, bodyD * 1.18, wallTop + 0.02, peakY, {
    ridgeAxis: 'x',
    courses: 10,
  });
  // Front porch roof lower
  addShingledRoof(buckets, bodyW * 0.95, 1.7, wallTop - 0.35, wallTop + 0.55, {
    ridgeAxis: 'x',
    center: [0, 0, frontZ + 0.35],
    courses: 5,
  });
  // Peak finials
  for (const x of [-halfW * 0.55, halfW * 0.55, 0]) {
    addCylinder(buckets, 'timber', 0.05, 0.06, 0.35, 5, [x, peakY + 0.2, 0], P.timberDark);
    addOctahedron(buckets, 'metal', 0.08, [x, peakY + 0.45, 0], P.brass);
  }

  // R6-8 teller window (left front) + vault door (right front)
  // Teller bar window
  addBox(
    buckets,
    'timber',
    [1.55, 1.05, 0.12],
    [-1.25, wallBottom + 1.55, frontZ + 0.02],
    P.timberDark,
  );
  addBox(buckets, 'warm', [1.25, 0.75, 0.06], [-1.25, wallBottom + 1.55, frontZ + 0.05], P.warm);
  for (const dx of [-0.4, -0.15, 0.15, 0.4]) {
    addBox(
      buckets,
      'metal',
      [0.05, 0.7, 0.05],
      [-1.25 + dx, wallBottom + 1.55, frontZ + 0.08],
      P.ironLight,
    );
  }
  for (const dy of [-0.25, 0, 0.25]) {
    addBox(
      buckets,
      'metal',
      [1.15, 0.05, 0.05],
      [-1.25, wallBottom + 1.55 + dy, frontZ + 0.08],
      P.iron,
    );
  }
  addBox(
    buckets,
    'timber',
    [1.45, 0.12, 0.35],
    [-1.25, wallBottom + 1.0, frontZ + 0.2],
    P.timberLight,
  );
  // Vault door right
  addIronboundDoor(buckets, 1.55, wallBottom + 1.15, frontZ - 0.02, 1.15, 2.1, 'rounded');
  addBox(buckets, 'metal', [0.2, 0.35, 0.08], [1.85, wallBottom + 1.15, frontZ + 0.08], P.brass);
  // Steps under door
  addSteps(buckets, 1.55, frontZ + 0.45, 1.5, 3, 1, 0.02);
  // Porch posts
  for (const x of [-2.4, -0.3, 0.9, 2.5]) {
    addBox(
      buckets,
      'timber',
      [0.16, 1.55, 0.16],
      [x, wallBottom + 0.9, frontZ + 0.55],
      P.timberDark,
    );
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, wallBottom + 0.12, frontZ + 0.55], P.iron);
  }
  addBox(buckets, 'timber', [5.2, 0.12, 0.12], [0, wallBottom + 1.7, frontZ + 0.55], P.timber);

  // R9 windows + chimney
  addMullionedWindow(buckets, [-halfW * 0.95, wallBottom + 2.0, 0.6], 0.75, {
    face: 'left',
    frameBucket: 'metal',
  });
  addMullionedWindow(buckets, [-halfW * 0.95, wallBottom + 2.0, -0.8], 0.7, {
    face: 'left',
    frameBucket: 'metal',
  });
  // Vault wheel window
  addCylinder(
    buckets,
    'metal',
    0.35,
    0.35,
    0.1,
    10,
    [-halfW * 0.95, wallBottom + 2.0, -0.1],
    P.iron,
    [0, Math.PI / 2, 0],
  );
  addMullionedWindow(buckets, [0.3, wallBottom + 2.55, -frontZ + 0.03], 0.65, {
    face: 'back',
    frameBucket: 'metal',
  });
  // Chimney left rear
  for (let c = 0; c < 8; c += 1) {
    addBox(
      buckets,
      'stone',
      [0.7, 0.32, 0.65],
      [-2.0, wallBottom + 0.4 + c * 0.34, -1.4],
      c % 2 ? P.stoneDeep : P.stone,
    );
  }
  addBox(buckets, 'stone', [0.85, 0.14, 0.8], [-2.0, wallBottom + 3.15, -1.4], P.stoneLight);

  // R10-12 sign, chest, lanterns, pipes
  addBox(buckets, 'timber', [0.1, 0.1, 1.0], [2.9, wallBottom + 2.4, frontZ + 0.3], P.timberDark);
  addBox(
    buckets,
    'metal',
    [0.55, 0.75, 0.08],
    [2.9, wallBottom + 2.0, frontZ + 0.85],
    P.brass,
    [0, 0.15, 0],
  );
  // Ironbound chest on left platform
  addBox(
    buckets,
    'timber',
    [0.85, 0.55, 0.55],
    [-2.85, wallBottom + 0.55, frontZ * 0.3],
    P.timberDeep,
  );
  for (const y of [0.15, 0.4]) {
    addBox(
      buckets,
      'metal',
      [0.9, 0.08, 0.58],
      [-2.85, wallBottom + y + 0.35, frontZ * 0.3],
      P.iron,
    );
  }
  addBox(buckets, 'metal', [0.15, 0.12, 0.12], [-2.5, wallBottom + 0.65, frontZ * 0.55], P.brass);
  addBarrel(buckets, [-2.5, baseH + 0.35, frontZ * 0.7], 0.65);
  // Lanterns
  addLantern(buckets, [-1.9, wallBottom + 2.35, frontZ + 0.35], 0.85);
  addLantern(buckets, [0.4, wallBottom + 2.35, frontZ + 0.35], 0.85);
  addLantern(buckets, [2.5, wallBottom + 2.2, frontZ + 0.25], 0.8);
  // Brass pipes on left (concept)
  addCylinder(buckets, 'metal', 0.06, 0.06, 1.4, 5, [-2.9, wallBottom + 1.5, 0.3], P.brass);
  addCylinder(buckets, 'metal', 0.06, 0.06, 0.8, 5, [-2.5, wallBottom + 2.1, 0.3], P.brass, [
    0,
    0,
    Math.PI / 2,
  ]);

  // R13-15 exterior densify: side gable planks, more iron, rain streaks, porch floor
  for (const end of [-1, 1]) {
    const z = end * (bodyD * 0.5 + 0.08);
    for (let row = 0; row < 5; row += 1) {
      const t = (row + 0.45) / 5;
      const y = wallTop + 0.05 + (peakY - wallTop) * t;
      const w = Math.max(0.4, bodyW * (1 - t) * 0.55);
      addBox(buckets, 'timber', [w, 0.1, 0.08], [0, y, z], row % 2 ? P.timber : P.timberLight);
    }
  }
  // Front dormer over teller
  addBox(buckets, 'timber', [1.2, 0.75, 0.65], [-1.1, wallTop + 0.45, frontZ * 0.15], P.timberDark);
  addPitchedRoof(buckets, 'roof', 1.4, 0.8, wallTop + 0.75, wallTop + 1.25, P.roofDeep, {
    ridgeAxis: 'z',
    center: [-1.1, 0, frontZ * 0.15],
  });
  addMullionedWindow(buckets, [-1.1, wallTop + 0.45, frontZ * 0.4], 0.5, {
    kind: 'rounded',
    frameBucket: 'metal',
  });
  // Porch plank floor (exterior only)
  for (let i = 0; i < 8; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.65, 0.08, 1.15],
      [-2.3 + i * 0.7, baseH + 0.08, frontZ + 0.55],
      i % 2 ? P.timberLight : P.timber,
    );
  }
  for (const x of [-2.2, -1.0, 0.2, 1.4, 2.4]) {
    addBox(
      buckets,
      'metal',
      [0.1, 0.1, 0.07],
      [x, wallBottom + wallH * 0.45, frontZ + 0.02],
      P.ironLight,
    );
  }
  for (const [x, h] of [
    [-1.8, 1.4],
    [0.5, 1.2],
    [2.0, 1.5],
  ]) {
    addBox(buckets, 'timber', [0.09, h, 0.06], [x, wallBottom + 2.0, frontZ - 0.02], P.timberDeep);
  }
  for (const z of [frontZ * 0.98, -frontZ * 0.98]) {
    addBox(buckets, 'timber', [bodyW * 1.1, 0.12, 0.1], [0, wallTop + 0.02, z], P.timberDark);
  }
  addRopeRail(buckets, -2.6, -1.6, baseH, frontZ + 0.7, 2);
  addRopeRail(buckets, 0.8, 2.5, baseH, frontZ + 0.7, 3);
  // Extra barrel + crate exterior clutter off approach
  addBarrel(buckets, [2.7, baseH + 0.35, -2.0], 0.6);
  addBox(buckets, 'timber', [0.45, 0.35, 0.4], [-2.9, baseH + 0.3, -1.8], P.timberLight);

  // R16-30 exterior polish: keep teller left and entry right clear.
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ: -bodyD * 0.5,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH,
    clearFront: 1.35,
    density: 1.15,
  });
  // Vault iron straps + brass corner plates.
  for (const y of [wallBottom + 0.8, wallBottom + 1.6, wallBottom + 2.4]) {
    addBox(buckets, 'metal', [0.55, 0.08, 0.06], [1.55, y, frontZ + 0.03], P.ironLight);
  }
  for (const sx of [-1, 1]) {
    addBox(
      buckets,
      'metal',
      [0.18, 0.18, 0.06],
      [sx * bodyW * 0.48, wallBottom + 0.45, frontZ + 0.02],
      P.brass,
    );
  }
}

/**
 * Mirelight cistern: civic center ring, stone platform, open pavilion roof,
 * brazier + kettle, winch, teal fenlight lanterns. Socket kettle [0,1.45,0].
 */
export function buildMirelightCistern(buckets) {
  // R1-4 stone ring platform
  addCylinder(buckets, 'stone', 1.75, 1.75, 0.35, 16, [0, 0.18, 0], P.stoneDeep);
  addCylinder(buckets, 'stone', 1.55, 1.55, 0.22, 14, [0, 0.4, 0], P.stone);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 1.55;
    const z = Math.sin(a) * 1.55;
    addBox(
      buckets,
      'stone',
      [0.42, 0.18, 0.55],
      [x, 0.45, z],
      i % 3 === 0 ? P.moss : i % 2 ? P.stone : P.stoneLight,
      [0, -a, 0],
    );
  }
  // Water ring
  addCylinder(buckets, 'organic', 1.85, 1.85, 0.08, 16, [0, 0.06, 0], P.water);

  // R5-8 posts + pavilion roof
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.15;
    const z = Math.sin(a) * 1.15;
    addBox(buckets, 'timber', [0.2, 1.85, 0.2], [x, 1.15, z], P.timberDark);
    addBox(buckets, 'metal', [0.26, 0.12, 0.26], [x, 0.55, z], P.iron);
    addBox(buckets, 'metal', [0.26, 0.12, 0.26], [x, 2.0, z], P.brass);
  }
  // Radial shingle rings (exterior pavilion cap) + dual pitched under-roof
  addPitchedRoof(buckets, 'roof', 3.4, 3.4, 2.05, 2.85, P.roof, { ridgeAxis: 'x' });
  addPitchedRoof(buckets, 'roof', 3.4, 3.4, 2.05, 2.85, P.roofDeep, { ridgeAxis: 'z' });
  for (let ring = 0; ring < 7; ring += 1) {
    const t = (ring + 0.5) / 7;
    const y = 2.08 + 0.72 * t;
    const r = 1.55 * (1 - t * 0.7);
    const segs = 10;
    for (let i = 0; i < segs; i += 1) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      const x = Math.cos(am) * r;
      const z = Math.sin(am) * r;
      addBox(
        buckets,
        'roof',
        [0.42, 0.05, 0.28],
        [x, y, z],
        (ring + i) % 3 === 0 ? P.roofDeep : (ring + i) % 2 === 0 ? P.roof : P.roofLight,
        [0, -am, 0.35],
      );
    }
  }
  // Horn tips on eave (concept)
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 1.62;
    const z = Math.sin(a) * 1.62;
    addBox(buckets, 'timber', [0.38, 0.09, 0.1], [x, 2.18, z], P.timberLight, [0, -a, 0.55]);
    addBox(buckets, 'metal', [0.12, 0.08, 0.08], [x * 1.08, 2.28, z * 1.08], P.brass, [0, -a, 0]);
  }
  addCylinder(buckets, 'timber', 0.06, 0.07, 0.45, 5, [0, 3.05, 0], P.timberDark);
  addOctahedron(buckets, 'metal', 0.1, [0, 3.35, 0], P.brassLight);
  // Extra moss pads on ring stones
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    addBox(
      buckets,
      'stone',
      [0.3, 0.08, 0.25],
      [Math.cos(a) * 1.5, 0.52, Math.sin(a) * 1.5],
      P.moss,
      [0, -a, 0],
    );
  }

  // R9-12 brazier + kettle + winch
  addCylinder(buckets, 'metal', 0.7, 0.75, 0.25, 12, [0, 0.7, 0], P.iron);
  addCylinder(buckets, 'metal', 0.55, 0.55, 0.12, 10, [0, 0.85, 0], P.ironLight);
  addBox(buckets, 'warm', [0.45, 0.2, 0.45], [0, 0.95, 0], P.warm);
  addCylinder(buckets, 'metal', 0.18, 0.22, 0.28, 8, [0, 1.55, 0], P.iron);
  addCylinder(buckets, 'metal', 0.03, 0.03, 0.55, 5, [0, 1.85, 0], P.ironLight);
  addBox(buckets, 'metal', [0.08, 0.08, 0.8], [0, 2.15, 0], P.iron);
  // Winch
  addBox(buckets, 'timber', [0.15, 0.9, 0.15], [0.95, 1.0, 0.7], P.timberDark);
  addCylinder(buckets, 'timber', 0.12, 0.12, 0.45, 6, [0.95, 1.35, 0.7], P.timber, [
    0,
    0,
    Math.PI / 2,
  ]);
  addBox(buckets, 'metal', [0.08, 0.35, 0.08], [1.2, 1.35, 0.7], P.ironLight);
  addCylinder(buckets, 'timber', 0.22, 0.24, 0.35, 8, [0.95, 0.55, 1.15], P.timberLight);
  // Teal fenlight lanterns
  for (const a of [Math.PI * 0.25, Math.PI * 1.25]) {
    const x = Math.cos(a) * 1.2;
    const z = Math.sin(a) * 1.2;
    addBox(buckets, 'metal', [0.12, 0.35, 0.12], [x, 1.7, z], P.ironLight);
    addBox(buckets, 'fenlight', [0.14, 0.22, 0.14], [x, 1.55, z], P.fenlight);
  }

  // R16-30 exterior densify: pavilion ribs, more moss ring, chain hangers, kettle details.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 1.05;
    const z = Math.sin(a) * 1.05;
    addBox(buckets, 'timber', [0.08, 0.95, 0.08], [x, 1.55, z], i % 2 ? P.timber : P.timberDark, [
      0,
      -a,
      0.25,
    ]);
  }
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + 0.1;
    addBox(
      buckets,
      'stone',
      [0.28, 0.07, 0.22],
      [Math.cos(a) * 1.62, 0.5, Math.sin(a) * 1.62],
      i % 2 ? P.moss : P.stoneDeep,
      [0, -a, 0],
    );
  }
  // Chain links from pavilion to kettle
  for (const a of [0.4, Math.PI + 0.4]) {
    const x = Math.cos(a) * 0.55;
    const z = Math.sin(a) * 0.55;
    for (let s = 0; s < 4; s += 1) {
      addBox(buckets, 'metal', [0.05, 0.1, 0.05], [x, 1.35 + s * 0.12, z], P.ironLight);
    }
  }
  addCylinder(buckets, 'metal', 0.04, 0.04, 0.55, 5, [0, 1.25, 0], P.iron);
  // Extra fenlights opposite the first pair
  for (const a of [Math.PI * 0.75, Math.PI * 1.75]) {
    const x = Math.cos(a) * 1.15;
    const z = Math.sin(a) * 1.15;
    addBox(buckets, 'metal', [0.1, 0.28, 0.1], [x, 1.65, z], P.iron);
    addBox(buckets, 'fenlight', [0.12, 0.18, 0.12], [x, 1.5, z], P.fenlightPale);
  }
  // Wet splash ring at waterline
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    addBox(
      buckets,
      'organic',
      [0.35, 0.04, 0.22],
      [Math.cos(a) * 1.95, 0.04, Math.sin(a) * 1.95],
      P.mud,
      [0, -a, 0],
    );
  }
}
