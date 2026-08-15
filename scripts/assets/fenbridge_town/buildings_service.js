import * as THREE from 'three';
import {
  addArchedFrame,
  addArchedPanel,
  addBarrel,
  addBeamXY,
  addBeamYZ,
  addBentConceptRoof,
  addBox,
  addCrate,
  addCylinder,
  addExteriorPolishRounds,
  addGeometry,
  addLantern,
  addMasonryCourse,
  addOctahedron,
  addPitchedRoof,
  addRaisedPilingDeck,
  addRopeRail,
  addShingledRoof,
  addSphere,
  addSteps,
  addTorus,
  addVerticalPlankFace,
  FENBRIDGE_PALETTE as P,
} from './shared.js';

function _addFoundation(buckets, width, depth, height = 0.36, centerX = 0, centerZ = 0) {
  addBox(buckets, 'stone', [width, height, depth], [centerX, height / 2, centerZ], P.stoneDeep);
  addBox(
    buckets,
    'stone',
    [width * 0.94, height * 0.48, depth * 0.94],
    [centerX, height + height * 0.24, centerZ],
    P.stone,
  );
  // Exterior block rhythm on all four footings for wet-marsh masonry read.
  addMasonryCourse(buckets, width * 0.98, 0.22, height * 0.55, [centerX, centerZ + depth * 0.48], {
    blocks: Math.max(5, Math.round(width / 1.15)),
    height: height * 0.7,
  });
  addMasonryCourse(buckets, width * 0.98, 0.22, height * 0.55, [centerX, centerZ - depth * 0.48], {
    blocks: Math.max(5, Math.round(width / 1.15)),
    height: height * 0.7,
  });
  for (const side of [-1, 1]) {
    const blockCount = Math.max(4, Math.round(depth / 1.2));
    const blockD = depth / blockCount;
    for (let index = 0; index < blockCount; index += 1) {
      addBox(
        buckets,
        'stone',
        [0.22, height * 0.68, blockD * 0.9],
        [
          centerX + side * width * 0.49,
          height * 0.55,
          centerZ - depth / 2 + blockD * (index + 0.5),
        ],
        index % 2 === 0 ? P.stone : P.moss,
      );
    }
  }
}

function _addTimberShell(buckets, options) {
  const { width, depth, wallHeight, peakY, centerX = 0, centerZ = 0, ridgeAxis = 'x' } = options;
  const wallBottom = 0.42;
  const wallBody = wallHeight - wallBottom;
  const wallCenterY = wallBottom + wallBody / 2;
  // Inset mass only for closed silhouette; exterior planks own the readable surface.
  addBox(
    buckets,
    'timber',
    [width * 0.86, wallBody * 0.96, depth * 0.84],
    [centerX, wallCenterY, centerZ],
    P.timberDeep,
  );
  const halfX = width * 0.445;
  const halfZ = depth * 0.435;
  addVerticalPlankFace(
    buckets,
    'front',
    width * 0.9,
    wallBody,
    [centerX, wallCenterY, centerZ + halfZ],
    { plankCount: Math.max(8, Math.round(width / 0.5)) },
  );
  addVerticalPlankFace(
    buckets,
    'rear',
    width * 0.9,
    wallBody,
    [centerX, wallCenterY, centerZ - halfZ],
    { plankCount: Math.max(8, Math.round(width / 0.52)) },
  );
  addVerticalPlankFace(
    buckets,
    'right',
    depth * 0.88,
    wallBody,
    [centerX + halfX, wallCenterY, centerZ],
    { plankCount: Math.max(7, Math.round(depth / 0.52)) },
  );
  addVerticalPlankFace(
    buckets,
    'left',
    depth * 0.88,
    wallBody,
    [centerX - halfX, wallCenterY, centerZ],
    { plankCount: Math.max(7, Math.round(depth / 0.52)) },
  );
  addShingledRoof(buckets, width, depth, wallHeight, peakY, {
    ridgeAxis,
    center: [centerX, 0, centerZ],
    courses: Math.max(8, Math.round(Math.max(width, depth) / 0.95)),
  });
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      addBox(
        buckets,
        'timber',
        [0.22, wallHeight - 0.18, 0.22],
        [centerX + x, wallHeight / 2 + 0.2, centerZ + z],
        x < 0 ? P.timberDeep : P.timber,
      );
      // Iron corner straps for concept-accurate hardware.
      addBox(
        buckets,
        'metal',
        [0.08, 0.55, 0.08],
        [centerX + x, wallBottom + 0.4, centerZ + z],
        P.iron,
      );
      addBox(
        buckets,
        'metal',
        [0.08, 0.08, 0.42],
        [centerX + x, wallBottom + 0.55, centerZ + z * 0.92],
        P.ironLight,
      );
    }
  }
  for (const z of [-halfZ, halfZ]) {
    addBox(
      buckets,
      'timber',
      [width * 0.93, 0.16, 0.2],
      [centerX, wallHeight - 0.1, centerZ + z],
      z > 0 ? P.timberLight : P.timber,
    );
  }
  // Mid belt timber that sells the concept's horizontal framing.
  for (const z of [-halfZ, halfZ]) {
    addBox(
      buckets,
      'timber',
      [width * 0.9, 0.14, 0.14],
      [centerX, wallBottom + wallBody * 0.48, centerZ + z + (z > 0 ? 0.04 : -0.04)],
      P.timberDark,
    );
  }
}

function addWindow(buckets, x, y, z, scale = 1, kind = 'rounded') {
  addArchedPanel(buckets, 'warm', 0.48 * scale, 0.74 * scale, 0.05, [x, y, z], P.warm, {
    kind,
  });
  addArchedFrame(
    buckets,
    'timber',
    0.68 * scale,
    0.95 * scale,
    0.48 * scale,
    0.74 * scale,
    0.09,
    [x, y, z + 0.035],
    P.timberLight,
    { kind },
  );
  addBox(buckets, 'timber', [0.05, 0.62 * scale, 0.1], [x, y - 0.03, z + 0.07], P.timberDark);
  addBox(buckets, 'timber', [0.45 * scale, 0.05, 0.1], [x, y - 0.04, z + 0.071], P.timberDark);
}

function faceRotation(face) {
  if (face === 'rear') return [0, Math.PI, 0];
  if (face === 'right') return [0, Math.PI / 2, 0];
  if (face === 'left') return [0, -Math.PI / 2, 0];
  return [0, 0, 0];
}

function faceAxes(face) {
  if (face === 'rear') return { outward: [0, 0, -1], lateral: [-1, 0, 0] };
  if (face === 'right') return { outward: [1, 0, 0], lateral: [0, 0, -1] };
  if (face === 'left') return { outward: [-1, 0, 0], lateral: [0, 0, 1] };
  return { outward: [0, 0, 1], lateral: [1, 0, 0] };
}

function offsetPosition(position, axis, amount) {
  return [
    position[0] + axis[0] * amount,
    position[1] + axis[1] * amount,
    position[2] + axis[2] * amount,
  ];
}

function addExteriorWindow(
  buckets,
  position,
  scale = 1,
  { face = 'front', kind = 'rounded', shutters = false } = {},
) {
  const rotation = faceRotation(face);
  const { outward, lateral } = faceAxes(face);
  addArchedPanel(buckets, 'warm', 0.48 * scale, 0.74 * scale, 0.05, position, P.warm, {
    kind,
    rotation,
  });
  addArchedFrame(
    buckets,
    'timber',
    0.68 * scale,
    0.95 * scale,
    0.48 * scale,
    0.74 * scale,
    0.09,
    offsetPosition(position, outward, 0.045),
    P.timberLight,
    { kind, rotation },
  );
  addBox(
    buckets,
    'timber',
    [0.05, 0.62 * scale, 0.1],
    offsetPosition([position[0], position[1] - 0.03, position[2]], outward, 0.075),
    P.timberDark,
    rotation,
  );
  addBox(
    buckets,
    'timber',
    [0.45 * scale, 0.05, 0.1],
    offsetPosition([position[0], position[1] - 0.04, position[2]], outward, 0.076),
    P.timberDark,
    rotation,
  );
  addBox(
    buckets,
    'stone',
    [0.84 * scale, 0.11, 0.2],
    offsetPosition([position[0], position[1] - 0.53 * scale, position[2]], outward, 0.085),
    P.stoneLight,
    rotation,
  );
  if (!shutters) return;
  for (const side of [-1, 1]) {
    const shutterCenter = offsetPosition(
      offsetPosition(position, lateral, side * 0.5 * scale),
      outward,
      0.07,
    );
    addBox(
      buckets,
      'timber',
      [0.22 * scale, 0.72 * scale, 0.08],
      shutterCenter,
      side < 0 ? P.timber : P.timberDark,
      rotation,
    );
  }
}

function _addBasestoneRhythm(buckets, { width, depth, centerX = 0, centerZ = 0 }) {
  const rearZ = centerZ - depth * 0.455;
  for (const [index, fraction] of [-0.36, -0.12, 0.12, 0.36].entries()) {
    addBox(
      buckets,
      'stone',
      [width * 0.17, 0.3, 0.3],
      [centerX + width * fraction, 0.48, rearZ],
      index % 2 === 0 ? P.stone : P.stoneLight,
    );
  }
  for (const side of [-1, 1]) {
    for (const [index, fraction] of [-0.27, 0, 0.27].entries()) {
      addBox(
        buckets,
        'stone',
        [0.3, 0.3, depth * 0.18],
        [centerX + side * width * 0.465, 0.48, centerZ + depth * fraction],
        (index + side) % 2 === 0 ? P.stoneLight : P.stone,
      );
    }
  }
}

function _addSideAndRearFraming(buckets, { width, depth, wallHeight, centerX = 0, centerZ = 0 }) {
  const rearZ = centerZ - depth * 0.442;
  const frameHeight = wallHeight - 0.68;
  const frameY = 0.52 + frameHeight / 2;
  for (const fraction of [-0.34, 0, 0.34]) {
    addBox(
      buckets,
      'timber',
      [0.15, frameHeight, 0.13],
      [centerX + width * fraction, frameY, rearZ],
      fraction === 0 ? P.timber : P.timberDark,
    );
  }
  for (const y of [1.02, wallHeight - 0.72]) {
    addBox(buckets, 'timber', [width * 0.88, 0.15, 0.14], [centerX, y, rearZ], P.timberDark);
  }
  addBeamXY(
    buckets,
    'timber',
    [centerX - width * 0.4, 0.76],
    [centerX - width * 0.08, 1.78],
    rearZ - 0.02,
    0.11,
    0.12,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [centerX + width * 0.4, 0.76],
    [centerX + width * 0.08, 1.78],
    rearZ - 0.02,
    0.11,
    0.12,
    P.timber,
  );

  for (const side of [-1, 1]) {
    const sideX = centerX + side * width * 0.452;
    for (const fraction of [-0.28, 0.28]) {
      addBox(
        buckets,
        'timber',
        [0.13, frameHeight, 0.15],
        [sideX, frameY, centerZ + depth * fraction],
        side < 0 ? P.timberDark : P.timber,
      );
    }
    for (const y of [1.02, wallHeight - 0.72]) {
      addBox(buckets, 'timber', [0.14, 0.15, depth * 0.86], [sideX, y, centerZ], P.timberDark);
    }
    addBeamYZ(
      buckets,
      'timber',
      sideX + side * 0.02,
      [0.76, centerZ - depth * 0.39],
      [1.78, centerZ - depth * 0.08],
      0.11,
      0.12,
      P.timber,
    );
  }
}

function _addRoofStructure(buckets, { width, depth, eaveY, peakY, centerX = 0, centerZ = 0 }) {
  const halfDepth = depth / 2;
  for (const side of [-1, 1]) {
    const x = centerX + side * width * 0.49;
    addBeamYZ(
      buckets,
      'timber',
      x,
      [peakY + 0.05, centerZ - halfDepth],
      [eaveY + 0.05, centerZ],
      0.12,
      0.14,
      P.timberLight,
    );
    addBeamYZ(
      buckets,
      'timber',
      x,
      [eaveY + 0.05, centerZ],
      [peakY + 0.05, centerZ + halfDepth],
      0.12,
      0.14,
      P.timberLight,
    );
  }
  for (const fraction of [-0.26, 0.26]) {
    const x = centerX + width * fraction;
    addBeamYZ(
      buckets,
      'timber',
      x,
      [peakY + 0.06, centerZ - halfDepth],
      [eaveY + 0.06, centerZ],
      0.07,
      0.08,
      P.timberDark,
    );
    addBeamYZ(
      buckets,
      'timber',
      x,
      [eaveY + 0.06, centerZ],
      [peakY + 0.06, centerZ + halfDepth],
      0.07,
      0.08,
      P.timberDark,
    );
  }
  for (const z of [centerZ - halfDepth, centerZ + halfDepth]) {
    for (const fraction of [-0.3, 0, 0.3]) {
      addBox(
        buckets,
        'timber',
        [0.12, 0.34, 0.15],
        [centerX + width * fraction, eaveY - 0.14, z],
        P.timberLight,
      );
    }
  }
}

function addFrontSill(buckets, x, y, z, width = 0.86) {
  addBox(buckets, 'stone', [width, 0.11, 0.24], [x, y, z], P.stoneLight);
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

function addDoor(buckets, x, y, z, width = 0.95, height = 1.8, kind = 'rounded') {
  addArchedPanel(buckets, 'timber', width * 0.72, height * 0.82, 0.07, [x, y, z], P.timberDeep, {
    kind,
  });
  addArchedFrame(
    buckets,
    'metal',
    width,
    height,
    width * 0.72,
    height * 0.82,
    0.11,
    [x, y, z + 0.04],
    P.iron,
    { kind },
  );
  addOctahedron(
    buckets,
    'metal',
    0.06,
    [x + width * 0.2, y - 0.15, z + 0.11],
    P.brass,
    [0.8, 1, 0.4],
  );
}

function addDormer(buckets, x, y, z, scale = 1) {
  // Compact roof dormer: thin side walls + glowing front face, not a dark box.
  // Sits on the main roof slope; window is the identity read from the street.
  const w = 1.05 * scale;
  const d = 0.7 * scale;
  const h = 0.72 * scale;
  const faceZ = z + d * 0.42;
  // Thin side cheeks (exterior only).
  for (const side of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [0.08 * scale, h, d * 0.9],
      [x + side * (w * 0.45), y, z],
      P.timberDark,
    );
  }
  // Front face: light timber frame around the window, not a solid dark slab.
  addBox(buckets, 'timber', [w, h * 0.18, 0.06], [x, y + h * 0.38, faceZ], P.timber);
  addBox(buckets, 'timber', [w, h * 0.14, 0.06], [x, y - h * 0.38, faceZ], P.timberDark);
  for (const side of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [0.1 * scale, h * 0.72, 0.06],
      [x + side * (w * 0.42), y, faceZ],
      P.timberDark,
    );
  }
  // Window + sill dominate the front so it never reads as a sealed box.
  addWindow(buckets, x, y + 0.02 * scale, faceZ + 0.02, 0.78 * scale);
  addFrontSill(buckets, x, y - h * 0.32, faceZ + 0.05, 0.9 * scale);
  // Mini teal roof over the dormer, seated on the cheeks.
  const dormEave = y + h * 0.42;
  const dormPeak = y + h * 0.95;
  addPitchedRoof(buckets, 'roof', w * 1.25, d * 1.15, dormEave, dormPeak, P.roof, {
    ridgeAxis: 'x',
    center: [x, 0, z],
  });
  addBox(buckets, 'roof', [w * 1.28, 0.05, 0.14], [x, dormPeak + 0.02, z], P.roofDeep);
  // Small cheek shingles on the dormer sides so they match the main roof family.
  for (const side of [-1, 1]) {
    addBox(
      buckets,
      'roof',
      [0.05, 0.08, d * 0.55],
      [x + side * (w * 0.48), dormEave + 0.12, z + d * 0.05],
      P.roofLight,
      [0, 0, side * 0.35],
    );
  }
}

function _addChimney(buckets, x, z, baseY, height) {
  addBox(buckets, 'stone', [0.56, height, 0.56], [x, baseY + height / 2, z], P.stoneDeep);
  addBox(buckets, 'stone', [0.72, 0.22, 0.72], [x, baseY + height - 0.08, z], P.stoneLight);
}

function _addCrookedApothecaryVent(buckets, x, z, baseY) {
  addBox(buckets, 'metal', [0.62, 1.12, 0.62], [x, baseY + 0.56, z], P.brass);
  addBox(
    buckets,
    'metal',
    [0.52, 1.16, 0.52],
    [x + 0.1, baseY + 1.62, z],
    P.ironLight,
    [0, 0, -0.1],
  );
  addBox(
    buckets,
    'metal',
    [0.43, 0.66, 0.43],
    [x + 0.2, baseY + 2.46, z],
    P.brassLight,
    [0, 0, -0.16],
  );
  addBox(buckets, 'metal', [0.78, 0.18, 0.72], [x + 0.24, baseY + 2.8, z], P.iron);
  addBox(
    buckets,
    'metal',
    [0.5, 0.09, 0.9],
    [x + 0.4, baseY + 2.93, z],
    P.brassLight,
    [0, 0, -0.08],
  );
}

function addAwning(buckets, centerX, centerZ, width, depth, y, color = P.clothTeal) {
  addBox(buckets, 'cloth', [width, 0.09, depth], [centerX, y, centerZ], color, [-0.08, 0, 0]);
  for (const x of [centerX - width * 0.45, centerX + width * 0.45]) {
    addBox(
      buckets,
      'timber',
      [0.12, y - 0.18, 0.12],
      [x, (y - 0.18) / 2, centerZ + depth * 0.42],
      P.timberDark,
    );
  }
}

function addBottle(buckets, position, color, scale = 1) {
  const [x, y, z] = position;
  addCylinder(buckets, 'metal', 0.1 * scale, 0.14 * scale, 0.28 * scale, 8, [x, y, z], color);
  addCylinder(
    buckets,
    'metal',
    0.055 * scale,
    0.075 * scale,
    0.13 * scale,
    8,
    [x, y + 0.2 * scale, z],
    P.brass,
  );
}

function addHerbBundle(buckets, x, y, z, scale = 1) {
  for (const offset of [-0.12, 0, 0.12]) {
    addCylinder(
      buckets,
      'organic',
      0.025,
      0.035,
      0.55 * scale,
      5,
      [x + offset * scale, y, z],
      offset === 0 ? P.herb : P.moss,
      [0, 0, offset * 0.5],
    );
  }
  addTiedBand(buckets, x, y + 0.22 * scale, z, scale);
}

function addTiedBand(buckets, x, y, z, scale) {
  addBox(buckets, 'cloth', [0.36 * scale, 0.05, 0.08], [x, y, z], P.rope);
}

function _addBentRoofTrim(buckets, options) {
  const { width, eaveY, peakY, frontZ, backZ, centerX = 0, centerZ = 0 } = options;
  const profile = options.profile ?? [
    [-0.54, 0.62],
    [-0.34, 0.13],
    [-0.08, -0.04],
    [0.24, 0.05],
    [0.54, 0.5],
  ];
  for (const z of [frontZ, backZ]) {
    for (let index = 1; index < profile.length; index += 1) {
      const [startX, startLift] = profile[index - 1];
      const [endX, endLift] = profile[index];
      addBeamXY(
        buckets,
        'timber',
        [centerX + startX * width, eaveY + startLift],
        [centerX + endX * width, eaveY + endLift],
        z,
        0.16,
        0.18,
        P.timberLight,
      );
    }
  }
  for (let index = 1; index < profile.length; index += 1) {
    const [startX, startLift] = profile[index - 1];
    const [endX, endLift] = profile[index];
    addBeamXY(
      buckets,
      'timber',
      [centerX + startX * width, peakY + startLift],
      [centerX + endX * width, peakY + endLift],
      centerZ,
      0.18,
      0.2,
      P.timberDark,
    );
  }
}

function addReedBundleSign(buckets, mountX, y, z, scale = 1) {
  const bundleX = mountX - 0.8 * scale;
  addBox(
    buckets,
    'timber',
    [2.02 * scale, 0.17, 0.17],
    [mountX - 0.82 * scale, y + 1.52 * scale, z],
    P.timberDark,
  );
  addBox(
    buckets,
    'timber',
    [0.17, 1.78 * scale, 0.17],
    [mountX, y + 0.76 * scale, z],
    P.timberDark,
  );
  for (const ropeX of [bundleX - 0.32 * scale, bundleX + 0.32 * scale]) {
    addCylinder(
      buckets,
      'cloth',
      0.03,
      0.03,
      0.68 * scale,
      5,
      [ropeX, y + 1.16 * scale, z],
      P.rope,
    );
  }
  const reedColors = [P.parchmentDark, P.rope, P.hide, P.parchmentDark, P.herb];
  for (let index = 0; index < 13; index += 1) {
    const offset = (index - 6) * 0.07 * scale;
    const depthOffset = ((index % 3) - 1) * 0.075 * scale;
    const lean = (index - 6) * 0.025;
    const height = (1.72 - Math.abs(index - 6) * 0.035 + (index % 2) * 0.08) * scale;
    addCylinder(
      buckets,
      'organic',
      0.07 * scale,
      0.105 * scale,
      height,
      6,
      [bundleX + offset, y + 0.18 * scale, z + depthOffset],
      reedColors[index % reedColors.length],
      [0, 0, lean],
    );
  }
  for (const bandY of [y + 0.52 * scale, y - 0.16 * scale]) {
    addBox(buckets, 'cloth', [1.22 * scale, 0.11, 0.24], [bundleX, bandY, z + 0.075], P.rope);
  }
  addBeamXY(
    buckets,
    'cloth',
    [bundleX - 0.55 * scale, y - 0.04 * scale],
    [bundleX + 0.55 * scale, y + 0.44 * scale],
    z + 0.09,
    0.045,
    0.05,
    P.rope,
  );
}

function addAttachedRopeNet(buckets, centerX, centerY, z, width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  for (const fraction of [-0.5, 0, 0.5]) {
    addBeamXY(
      buckets,
      'cloth',
      [centerX - halfWidth, centerY - halfHeight + (fraction + 0.5) * height],
      [centerX + halfWidth, centerY - halfHeight + (fraction + 0.5) * height],
      z,
      0.035,
      0.045,
      P.rope,
    );
  }
  for (const fraction of [-0.65, 0, 0.65]) {
    addBeamXY(
      buckets,
      'cloth',
      [centerX - halfWidth, centerY + fraction * halfHeight],
      [centerX + halfWidth, centerY - fraction * halfHeight],
      z + 0.015,
      0.035,
      0.045,
      P.rope,
    );
  }
}

function addStretchedHide(buckets, x, y, z, width = 1.2, height = 1.75) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  for (const postX of [x - halfWidth, x + halfWidth]) {
    addBox(buckets, 'timber', [0.12, height + 0.38, 0.13], [postX, y, z], P.timberDark);
  }
  for (const railY of [y - halfHeight - 0.12, y + halfHeight + 0.12]) {
    addBox(buckets, 'timber', [width + 0.28, 0.12, 0.13], [x, railY, z], P.timber);
  }

  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth * 0.48, -halfHeight);
  shape.lineTo(-halfWidth * 0.88, -halfHeight * 0.58);
  shape.lineTo(-halfWidth * 0.68, 0);
  shape.lineTo(-halfWidth, halfHeight * 0.66);
  shape.lineTo(-halfWidth * 0.42, halfHeight);
  shape.lineTo(halfWidth * 0.42, halfHeight);
  shape.lineTo(halfWidth, halfHeight * 0.66);
  shape.lineTo(halfWidth * 0.68, 0);
  shape.lineTo(halfWidth * 0.88, -halfHeight * 0.58);
  shape.lineTo(halfWidth * 0.48, -halfHeight);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -0.0275);
  addGeometry(buckets, 'cloth', geometry, P.hide, { position: [x, y, z + 0.07] });

  for (const [from, to] of [
    [
      [-0.48, -0.72],
      [-0.6, -0.98],
    ],
    [
      [0.48, -0.72],
      [0.6, -0.98],
    ],
    [
      [-0.48, 0.72],
      [-0.6, 0.98],
    ],
    [
      [0.48, 0.72],
      [0.6, 0.98],
    ],
  ]) {
    addBeamXY(
      buckets,
      'cloth',
      [x + from[0] * width, y + from[1] * halfHeight],
      [x + to[0] * width, y + to[1] * halfHeight],
      z + 0.12,
      0.035,
      0.035,
      P.rope,
    );
  }
}

function addTanningVat(buckets, x, y, z, scale = 1) {
  addCylinder(buckets, 'timber', 0.63 * scale, 0.7 * scale, 0.68 * scale, 12, [x, y, z], P.timber);
  addCylinder(
    buckets,
    'metal',
    0.53 * scale,
    0.53 * scale,
    0.075 * scale,
    12,
    [x, y + 0.36 * scale, z],
    P.water,
  );
  for (const offset of [-0.22, 0.22]) {
    addCylinder(
      buckets,
      'metal',
      0.7 * scale,
      0.7 * scale,
      0.045 * scale,
      12,
      [x, y + offset * scale, z],
      P.iron,
    );
  }
}

function _addStreamer(buckets, x, y, z, direction, scale = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.08 * scale);
  shape.lineTo(direction * 1.8 * scale, 0.02 * scale);
  shape.lineTo(direction * 1.38 * scale, -0.13 * scale);
  shape.lineTo(direction * 1.82 * scale, -0.32 * scale);
  shape.lineTo(0, -0.17 * scale);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -0.02);
  addGeometry(buckets, 'cloth', geometry, P.clothTeal, { position: [x, y, z] });
}

function _addApothecaryEntryHierarchy(buckets) {
  addPitchedRoof(buckets, 'roof', 2.3, 1.04, 3.12, 3.78, P.roofDeep, {
    ridgeAxis: 'z',
    center: [0, 0, 3.12],
  });
  addBox(buckets, 'timber', [2.16, 0.1, 0.9], [0, 3.08, 3.12], P.timberDark);
  for (const x of [-0.96, 0.96]) {
    addBox(buckets, 'timber', [0.14, 2.5, 0.14], [x, 1.87, 3.47], P.timberDark);
    addDiagonalYZ(buckets, 'timber', x, [2.48, 2.78], [3.05, 3.45], 0.1, 0.11, P.timber);
    addDiagonalYZ(buckets, 'timber', x, [2.48, 3.47], [3.05, 2.83], 0.1, 0.11, P.timber);
  }
  addBox(buckets, 'timber', [2.12, 0.15, 0.15], [0, 3.04, 3.49], P.timberLight);
  addBeamXY(buckets, 'timber', [-1.12, 3.1], [0, 3.8], 3.65, 0.12, 0.12, P.timberLight);
  addBeamXY(buckets, 'timber', [0, 3.8], [1.12, 3.1], 3.65, 0.12, 0.12, P.timberLight);

  for (const x of [-0.95, -0.57, -0.19, 0.19, 0.57, 0.95]) {
    addBox(
      buckets,
      'roof',
      [0.42, 0.055, 0.94],
      [x, 3.36 + (1 - Math.abs(x)) * 0.4, 3.12],
      x < 0 ? P.roof : P.roofLight,
      [0, 0, x < 0 ? 0.52 : -0.52],
    );
  }
  addBox(buckets, 'timber', [2.18, 0.14, 0.84], [0, 0.68, 3.12], P.timberLight);
  for (const [index, x] of [-0.82, -0.28, 0.28, 0.82].entries()) {
    addBox(
      buckets,
      'stone',
      [0.48, 0.32, 0.38],
      [x, 0.42, 3.5],
      index % 2 === 0 ? P.stone : P.stoneLight,
    );
  }
  for (const x of [-1.65, 1.65]) {
    addBox(buckets, 'timber', [0.14, 3.68, 0.14], [x, 2.28, 2.82], P.timber);
  }
  addBox(buckets, 'timber', [3.42, 0.14, 0.14], [0, 3.98, 2.82], P.timberDark);

  addBox(buckets, 'timber', [1.25, 0.12, 0.42], [-1.18, 1.0, 3.02], P.timberLight);
  for (const x of [-1.68, -0.68]) {
    addBox(buckets, 'timber', [0.1, 0.52, 0.1], [x, 0.78, 3.02], P.timberDark);
  }
  addBottle(buckets, [-1.42, 1.23, 3.19], P.potionGlass, 0.68);
  addBottle(buckets, [-0.96, 1.23, 3.19], P.fenlight, 0.68);
  addHerbBundle(buckets, -0.54, 2.55, 3.54, 0.72);
  addHerbBundle(buckets, 0.54, 2.55, 3.54, 0.72);
  addCrate(buckets, [-0.92, 0.52, 3.24], [0.62, 0.52, 0.54]);
}

function _addApothecaryCraftStation(buckets) {
  const benchX = -2.24;
  const benchZ = 3.02;
  addBox(buckets, 'timber', [2.42, 0.18, 0.76], [benchX, 1.02, benchZ], P.timberLight);
  for (const x of [-3.18, -1.3]) {
    addBox(buckets, 'timber', [0.14, 0.82, 0.14], [x, 0.57, benchZ], P.timberDark);
    addBox(buckets, 'timber', [0.15, 2.06, 0.15], [x, 1.92, benchZ + 0.16], P.timberDark);
  }
  addBox(buckets, 'timber', [2.55, 0.14, 0.14], [benchX, 2.82, benchZ + 0.16], P.timberLight);
  addBox(
    buckets,
    'roof',
    [2.7, 0.11, 0.9],
    [benchX, 3.02, benchZ + 0.02],
    P.roofDeep,
    [-0.12, 0, 0],
  );

  for (const [index, x] of [-2.86, -2.35, -1.84, -1.34].entries()) {
    addHerbBundle(buckets, x, 2.37 - (index % 2) * 0.08, 3.26, 0.9);
  }

  addBox(buckets, 'organic', [1.14, 0.24, 0.52], [-1.72, 1.19, 3.25], P.mud);
  for (const [index, x] of [-2.02, -1.68, -1.35].entries()) {
    addCylinder(buckets, 'organic', 0.055, 0.075, 0.27, 6, [x, 1.4, 3.25], P.parchmentDark);
    addSphere(
      buckets,
      'organic',
      0.27,
      [x, 1.59 + (index % 2) * 0.05, 3.25],
      index === 1 ? P.potionGlass : P.herb,
      [1.05, 0.38, 1.05],
    );
  }

  addCylinder(buckets, 'metal', 0.28, 0.42, 1.18, 9, [-2.9, 1.62, 3.2], P.brass);
  addSphere(buckets, 'metal', 0.36, [-2.9, 2.19, 3.2], P.brass, [0.78, 1.18, 0.78]);
  addCylinder(buckets, 'metal', 0.1, 0.15, 0.48, 7, [-2.9, 2.55, 3.2], P.brassLight);
  addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.18, 0.25, 7), P.ironLight, {
    position: [-2.9, 2.88, 3.2],
  });
  addBeamXY(buckets, 'metal', [-2.82, 2.35], [-2.28, 1.9], 3.38, 0.09, 0.1, P.brassLight);
  addBox(buckets, 'metal', [0.1, 0.86, 0.1], [-2.26, 1.54, 3.38], P.brassLight);

  addBox(buckets, 'stone', [1.78, 0.2, 0.62], [-2.16, 0.48, 3.56], P.stoneDeep);
  addBox(buckets, 'stone', [0.14, 0.34, 0.68], [-2.98, 0.59, 3.56], P.stoneLight);
  addBox(buckets, 'stone', [0.14, 0.34, 0.68], [-1.34, 0.59, 3.56], P.stoneLight);
  addBox(buckets, 'metal', [1.5, 0.045, 0.42], [-2.16, 0.64, 3.56], P.water);
}

function _addScoutLookoutMass(buckets) {
  const centerX = -2.85;
  const centerZ = -0.95;
  addBox(buckets, 'stone', [1.95, 0.5, 1.95], [centerX, 0.48, centerZ], P.stoneDeep);
  for (const x of [centerX - 0.78, centerX + 0.78]) {
    for (const z of [centerZ - 0.78, centerZ + 0.78]) {
      addBox(buckets, 'stone', [0.36, 0.55, 0.36], [x, 0.64, z], P.stoneLight);
      addBox(buckets, 'timber', [0.16, 7.0, 0.16], [x, 3.9, z], P.timberDark);
    }
  }
  addBox(buckets, 'timber', [2.15, 0.18, 2.05], [centerX, 6.42, centerZ], P.timberLight);
  for (const y of [1.25, 6.92]) {
    for (const z of [centerZ - 0.82, centerZ + 0.82]) {
      addBox(buckets, 'timber', [1.86, 0.14, 0.14], [centerX, y, z], P.timber);
    }
    for (const x of [centerX - 0.82, centerX + 0.82]) {
      addBox(buckets, 'timber', [0.14, 0.14, 1.86], [x, y, centerZ], P.timberDark);
    }
  }
  const frontZ = centerZ + 0.84;
  addBeamXY(
    buckets,
    'timber',
    [centerX - 0.76, 1.3],
    [centerX + 0.76, 6.0],
    frontZ,
    0.12,
    0.13,
    P.timberLight,
  );
  addBeamXY(
    buckets,
    'timber',
    [centerX - 0.76, 6.0],
    [centerX + 0.76, 1.3],
    frontZ,
    0.12,
    0.13,
    P.timberDark,
  );
  const leftX = centerX - 0.84;
  addDiagonalYZ(
    buckets,
    'timber',
    leftX,
    [1.3, centerZ - 0.76],
    [6.0, centerZ + 0.76],
    0.12,
    0.13,
    P.timberLight,
  );
  addDiagonalYZ(
    buckets,
    'timber',
    leftX,
    [6.0, centerZ - 0.76],
    [1.3, centerZ + 0.76],
    0.12,
    0.13,
    P.timberDark,
  );

  for (const z of [centerZ - 1.0, centerZ + 1.0]) {
    addBox(buckets, 'timber', [2.15, 0.16, 0.16], [centerX, 6.42, z], P.timberLight);
  }
  for (const x of [centerX - 1.0, centerX + 1.0]) {
    addBox(buckets, 'timber', [0.16, 0.16, 2.15], [x, 6.42, centerZ], P.timberLight);
  }
  for (const x of [centerX - 0.82, centerX + 0.82]) {
    for (const z of [centerZ - 0.82, centerZ + 0.82]) {
      addOctahedron(buckets, 'metal', 0.1, [x, 7.22, z], P.brass, [0.7, 1.15, 0.7]);
    }
  }
  for (const z of [centerZ - 0.92, centerZ + 0.92]) {
    addBeamXY(buckets, 'timber', [centerX - 0.82, 7.32], [centerX, 7.74], z, 0.1, 0.11, P.timber);
    addBeamXY(buckets, 'timber', [centerX, 7.74], [centerX + 0.82, 7.32], z, 0.1, 0.11, P.timber);
    addBox(buckets, 'timber', [2.38, 0.12, 0.12], [centerX, 7.28, z], P.timberLight);
  }
  for (const x of [centerX - 1.12, centerX + 1.12]) {
    addBox(buckets, 'timber', [0.12, 0.12, 2.38], [x, 7.28, centerZ], P.timberLight);
  }
  for (const x of [centerX - 0.7, centerX + 0.7]) {
    for (const z of [centerZ - 0.45, centerZ, centerZ + 0.45]) {
      addBox(buckets, 'timber', [0.08, 0.72, 0.08], [x, 6.82, z], P.timberDark);
    }
  }
  for (const x of [centerX - 0.52, centerX, centerX + 0.52]) {
    addBox(buckets, 'timber', [0.09, 0.72, 0.09], [x, 6.58, centerZ + 0.84], P.timberLight);
  }
  addLantern(buckets, [centerX, 4.62, centerZ + 0.93], 0.68);
  addBox(buckets, 'timber', [0.18, 3.4, 0.18], [-2.03, 2.3, -1.55], P.timber);
  addBox(buckets, 'timber', [0.18, 3.4, 0.18], [-2.03, 2.3, -0.35], P.timber);
}

/**
 * Crooked Reed Inn: exterior-only reconstruction from the four admitted
 * turnaround crops. Identity inventory (img2threejs detail-first):
 * raised stone pilings, wrap porch, rope rails, bent seated teal roof,
 * stone chimney, dormer, provision awning, crane + reed basket, dense
 * barrel/crate clutter. Gameplay front-entry socket stays at local x=-2.8.
 * No interior volume is authored.
 */
export function buildCrookedReedInn(buckets) {
  const deckY = 0.82;
  const wallBottom = deckY + 0.06;
  const wallTop = 4.48;
  const peakY = 7.15;
  const bodyW = 7.4;
  const bodyD = 5.4;
  const porchZ = bodyD * 0.5; // front wall
  const porchFront = porchZ + 1.7;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;

  // ---- 1. Raised stilt deck (full footprint, open undercroft) ----
  addRaisedPilingDeck(buckets, 9.2, 7.6, {
    deckY,
    pilingRows: 3,
    pilingsPerRow: 6,
    center: [0, 0.05],
  });
  // Extra perimeter pilings under the porch lip (concept side/front views).
  for (const x of [-4.0, -2.0, 0, 2.0, 4.0]) {
    addBox(buckets, 'stone', [0.32, deckY, 0.32], [x, deckY / 2, porchFront - 0.15], P.stoneDeep);
    addBox(buckets, 'stone', [0.38, 0.14, 0.38], [x, 0.07, porchFront - 0.15], P.moss);
  }
  for (const z of [-bodyD * 0.48, bodyD * 0.15]) {
    for (const x of [-4.25, 4.25]) {
      addBox(buckets, 'stone', [0.3, deckY * 0.95, 0.3], [x, deckY * 0.48, z], P.stone);
    }
  }

  // Front porch deck: fewer wider planks still read as boards.
  for (let index = 0; index < 10; index += 1) {
    const x = -4.2 + index * 0.92;
    addBox(
      buckets,
      'timber',
      [0.82, 0.1, 1.75],
      [x, deckY + 0.05, porchZ + 0.9],
      index % 2 === 0 ? P.timberLight : P.timber,
    );
  }
  // Side deck returns.
  for (let index = 0; index < 5; index += 1) {
    const z = -bodyD * 0.4 + index * 1.1;
    addBox(
      buckets,
      'timber',
      [1.3, 0.1, 0.95],
      [-bodyW * 0.55 - 0.1, deckY + 0.04, z],
      P.timberLight,
    );
    addBox(buckets, 'timber', [1.15, 0.1, 0.95], [bodyW * 0.55 + 0.05, deckY + 0.04, z], P.timber);
  }

  // ---- 2. Porch frame (concept-front: sparse posts, open door/window bays) ----
  // Five posts leave clear bays for the entry at x=-2.8 and the lit windows.
  // No full-height diagonals and no second beam: those read as a wood cage.
  const postXs = [-3.85, -1.55, 0.35, 2.1, 3.75];
  for (const x of postXs) {
    addBox(
      buckets,
      'timber',
      [0.16, wallTop - deckY - 0.55, 0.16],
      [x, (deckY + wallTop - 0.4) / 2, porchFront - 0.22],
      P.timberDark,
    );
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, deckY + 0.07, porchFront - 0.22], P.iron);
    // Short knee brace only (concept has small eaves braces, not X-bracing).
    addBox(
      buckets,
      'timber',
      [0.42, 0.09, 0.09],
      [x + 0.18, wallTop - 0.72, porchFront - 0.22],
      P.timberLight,
      [0, 0, -0.45],
    );
  }
  // Single porch header under the eave + thin secondary purlin (concept eaves).
  addBox(buckets, 'timber', [8.3, 0.14, 0.16], [0, wallTop - 0.55, porchFront - 0.22], P.timber);
  addBox(buckets, 'timber', [8.0, 0.08, 0.1], [0, wallTop - 0.38, porchFront - 0.35], P.timberDark);
  // Low rope rail only; fewer posts so the facade stays readable.
  addRopeRail(buckets, -3.9, 3.9, deckY, porchFront + 0.02, 6);
  // Side rope rails.
  addRopeRail(buckets, -bodyW * 0.55 - 0.55, -bodyW * 0.45, deckY, porchZ + 0.4, 3);
  addRopeRail(buckets, bodyW * 0.45, bodyW * 0.55 + 0.45, deckY, porchZ + 0.4, 3);
  // Clear approach to the gameplay entry socket.
  addSteps(buckets, -2.8, porchFront + 0.35, 1.8, 5, 1, 0.02);
  for (const sx of [-0.95, 0.95]) {
    addBox(buckets, 'stone', [0.14, 0.55, 0.7], [-2.8 + sx, 0.28, porchFront + 0.25], P.stoneDeep);
  }
  // Door bay posts on the facade (readable entry without crowding the porch).
  for (const x of [-3.35, -2.25]) {
    addBox(buckets, 'timber', [0.12, 2.15, 0.12], [x, deckY + 1.15, bodyD * 0.45], P.timberDark);
  }
  addBox(buckets, 'timber', [1.25, 0.1, 0.12], [-2.8, deckY + 2.25, bodyD * 0.46], P.timber);

  // ---- 3. Exterior-only timber shell ----
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.95, bodyD * 0.86],
    [0, wallCy, 0],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.92, wallH, [0, wallCy, bodyD * 0.44], {
    plankCount: 11,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.92, wallH, [0, wallCy, -bodyD * 0.44], {
    plankCount: 11,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.9, wallH, [bodyW * 0.46, wallCy, 0], {
    plankCount: 8,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.9, wallH, [-bodyW * 0.46, wallCy, 0], {
    plankCount: 8,
  });
  for (const x of [-bodyW * 0.46, bodyW * 0.46]) {
    for (const z of [-bodyD * 0.44, bodyD * 0.44]) {
      addBox(buckets, 'timber', [0.24, wallH + 0.18, 0.24], [x, wallCy, z], P.timberDark);
      addBox(buckets, 'metal', [0.12, 0.5, 0.12], [x, wallBottom + 0.4, z], P.iron);
      addBox(buckets, 'metal', [0.12, 0.12, 0.4], [x, wallBottom + 0.55, z * 0.9], P.ironLight);
    }
  }
  for (const z of [-bodyD * 0.44, bodyD * 0.44]) {
    addBox(
      buckets,
      'timber',
      [bodyW * 0.94, 0.15, 0.15],
      [0, wallBottom + wallH * 0.38, z],
      P.timberDark,
    );
    addBox(buckets, 'timber', [bodyW * 0.94, 0.14, 0.16], [0, wallTop - 0.1, z], P.timber);
  }
  // Wall plate the roof seats on (kills floating roof).
  addBox(
    buckets,
    'timber',
    [bodyW * 1.02, 0.16, bodyD * 1.02],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );
  addBeamXY(
    buckets,
    'timber',
    [-bodyW * 0.4, wallBottom + 0.35],
    [-bodyW * 0.1, wallTop - 0.45],
    -bodyD * 0.46,
    0.11,
    0.12,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [bodyW * 0.4, wallBottom + 0.35],
    [bodyW * 0.1, wallTop - 0.45],
    -bodyD * 0.46,
    0.11,
    0.12,
    P.timber,
  );

  // ---- 4. Continuous seated bent roof ----
  addBentConceptRoof(buckets, 8.9, 6.85, wallTop + 0.02, peakY, {
    courses: 8,
    strips: 12,
    profile: [
      [-0.5, 0.48],
      [-0.32, 0.1],
      [-0.1, -0.03],
      [0.12, 0.0],
      [0.34, 0.12],
      [0.5, 0.45],
    ],
  });

  // ---- 5. Stone chimney (left, concept-front silhouette through the eave) ----
  const chimX = -3.55;
  const chimZ = -0.55;
  for (let course = 0; course < 12; course += 1) {
    const y = wallBottom + 0.2 + course * 0.36;
    const taper = course > 9 ? (course - 9) * 0.06 : 0;
    addBox(
      buckets,
      'stone',
      [0.98 - taper, 0.34, 0.88 - taper * 0.5],
      [chimX + course * 0.01, y, chimZ],
      course % 2 === 0 ? P.stoneDeep : course % 3 === 0 ? P.moss : P.stone,
    );
  }
  const chimTop = wallBottom + 0.2 + 12 * 0.36;
  addBox(buckets, 'stone', [1.15, 0.18, 1.05], [chimX + 0.1, chimTop, chimZ], P.stoneLight);
  addBox(buckets, 'stone', [0.72, 0.4, 0.68], [chimX + 0.12, chimTop + 0.28, chimZ], P.stoneDeep);
  // Small cap lip so the stack reads against the sky.
  addBox(buckets, 'stone', [0.85, 0.1, 0.8], [chimX + 0.12, chimTop + 0.52, chimZ], P.stoneLight);

  // ---- 6. Dormer seated on the front roof slope (concept identity) ----
  addDormer(buckets, -0.35, peakY - 1.55, bodyD * 0.18, 1.12);

  // ---- 7. Openings (door bay kept clear; windows in open post bays) ----
  addDoor(buckets, -2.8, deckY + 1.08, bodyD * 0.47, 1.15, 2.08);
  // Door planks for a readable leaf, not a dark hole.
  for (const dx of [-0.22, 0, 0.22]) {
    addBox(
      buckets,
      'timber',
      [0.14, 1.55, 0.04],
      [-2.8 + dx, deckY + 1.0, bodyD * 0.49],
      dx === 0 ? P.timber : P.timberDeep,
    );
  }
  addOctahedron(
    buckets,
    'metal',
    0.07,
    [-2.45, deckY + 1.05, bodyD * 0.51],
    P.brass,
    [0.7, 1, 0.45],
  );
  for (const x of [-0.7, 1.15, 2.75]) {
    addWindow(buckets, x, deckY + 1.92, bodyD * 0.48, 1.0);
    addFrontSill(buckets, x, deckY + 1.34, bodyD * 0.51, 0.92);
  }
  for (const x of [-1.7, 0.15, 1.7]) {
    addExteriorWindow(buckets, [x, deckY + 1.95, -bodyD * 0.46], 0.92, { face: 'rear' });
  }
  addExteriorWindow(buckets, [bodyW * 0.48, deckY + 1.85, 0.35], 0.88, { face: 'right' });
  addExteriorWindow(buckets, [bodyW * 0.48, deckY + 1.85, -1.1], 0.82, { face: 'right' });
  addExteriorWindow(buckets, [-bodyW * 0.48, deckY + 1.85, 0.2], 0.85, { face: 'left' });

  // ---- 8. Side provision counter + teal rain awning (concept side view) ----
  addBox(buckets, 'timber', [2.6, 0.14, 1.55], [2.95, deckY + 0.62, porchZ + 0.55], P.timberLight);
  addBox(buckets, 'timber', [2.45, 0.95, 0.12], [2.95, deckY + 1.05, porchZ + 1.15], P.timberDeep);
  addBox(buckets, 'timber', [0.12, 0.9, 1.4], [1.75, deckY + 1.0, porchZ + 0.55], P.timberDark);
  addBox(buckets, 'timber', [0.12, 0.9, 1.4], [4.15, deckY + 1.0, porchZ + 0.55], P.timberDark);
  addAwning(buckets, 2.95, porchZ + 0.7, 2.7, 1.45, wallTop - 0.95, P.clothTeal);
  // Hanging tools under awning.
  for (const x of [2.35, 2.95, 3.55]) {
    addBox(buckets, 'metal', [0.05, 0.35, 0.05], [x, deckY + 1.55, porchZ + 1.05], P.iron);
    addOctahedron(buckets, 'metal', 0.08, [x, deckY + 1.35, porchZ + 1.05], P.brass, [0.8, 1, 0.5]);
  }

  // ---- 9. Right crane + hanging reed basket (kept clear of the door bay) ----
  addBox(
    buckets,
    'timber',
    [0.18, 3.7, 0.18],
    [4.35, deckY + 1.85, porchFront - 0.35],
    P.timberDark,
  );
  addBox(buckets, 'timber', [0.16, 0.7, 0.16], [4.35, deckY + 3.55, porchFront - 0.35], P.timber);
  addBox(
    buckets,
    'timber',
    [1.45, 0.13, 0.13],
    [3.7, deckY + 3.75, porchFront - 0.35],
    P.timberLight,
    [0, 0, -0.08],
  );
  addCylinder(
    buckets,
    'cloth',
    0.028,
    0.028,
    1.15,
    5,
    [3.15, deckY + 3.05, porchFront - 0.35],
    P.rope,
  );
  addReedBundleSign(buckets, 3.15, deckY + 1.55, porchFront - 0.2, 1.05);
  // Rear-left crane with hanging barrel (concept rear, not on the approach).
  addBox(buckets, 'timber', [0.15, 2.7, 0.15], [-4.2, deckY + 1.45, -bodyD * 0.4], P.timberDark);
  addBox(buckets, 'timber', [1.15, 0.11, 0.11], [-3.7, deckY + 2.8, -bodyD * 0.4], P.timber);
  addCylinder(buckets, 'cloth', 0.024, 0.024, 0.9, 5, [-3.25, deckY + 2.25, -bodyD * 0.4], P.rope);
  addBarrel(buckets, [-3.25, deckY + 1.5, -bodyD * 0.4], 0.82);

  // ---- 10. Exterior clutter at corners only ----
  addBarrel(buckets, [3.85, deckY + 0.38, porchZ + 1.25], 1.0);
  addBarrel(buckets, [4.25, deckY + 0.34, porchZ + 0.9], 0.78);
  addBarrel(buckets, [-3.9, deckY + 0.36, porchZ + 1.2], 0.92);
  addBarrel(buckets, [-3.4, deckY + 0.32, porchZ + 1.4], 0.68);
  // Left hammock under rail (concept front-left).
  addAttachedRopeNet(buckets, -3.35, deckY + 0.52, porchFront + 0.02, 1.25, 0.52);
  // Rear clutter.
  addBarrel(buckets, [-3.55, deckY + 0.35, -bodyD * 0.55], 0.88);
  addBarrel(buckets, [-3.05, deckY + 0.32, -bodyD * 0.62], 0.7);
  addBarrel(buckets, [3.45, deckY + 0.35, -bodyD * 0.55], 0.85);
  addBarrel(buckets, [3.95, deckY + 0.32, -bodyD * 0.48], 0.68);
  addCrate(buckets, [-2.0, deckY + 0.35, -bodyD * 0.55], [0.62, 0.55, 0.58]);
  addCrate(buckets, [1.35, deckY + 0.35, -bodyD * 0.58], [0.7, 0.5, 0.55]);
  addCrate(buckets, [2.65, deckY + 0.88, porchZ + 0.25], [0.48, 0.38, 0.42]);
  addAttachedRopeNet(buckets, 2.15, deckY + 0.75, -bodyD * 0.55 - 0.15, 1.35, 0.62);
  // Ladder on the rear-right wall only.
  addBox(
    buckets,
    'timber',
    [0.1, 2.3, 0.08],
    [bodyW * 0.52, deckY + 1.12, -bodyD * 0.28],
    P.timberLight,
    [0, 0, -0.2],
  );
  for (const ly of [0.45, 0.95, 1.45, 1.95]) {
    addBox(
      buckets,
      'timber',
      [0.4, 0.06, 0.06],
      [bodyW * 0.52, deckY + ly, -bodyD * 0.28],
      P.timberDark,
      [0, 0, -0.2],
    );
  }

  // ---- 11. Lanterns: left arm (concept) + sparse porch accents ----
  // Extended left arm so the warm lantern hangs clear of the door bay.
  addBox(
    buckets,
    'timber',
    [0.9, 0.1, 0.1],
    [-4.15, deckY + 2.85, porchFront - 0.55],
    P.timberDark,
    [0, 0, 0.2],
  );
  addLantern(buckets, [-4.45, deckY + 2.35, porchFront - 0.55], 0.98);
  addLantern(buckets, [2.35, deckY + 2.5, porchFront - 0.48], 0.7);
  addLantern(buckets, [4.15, deckY + 2.25, porchZ + 0.25], 0.65);
  addLantern(buckets, [-4.05, deckY + 2.3, -bodyD * 0.12], 0.62, 'fenlight');

  // R16-30 exterior polish: keep door bay (front-entry x=-2.8) clear.
  addExteriorPolishRounds(buckets, {
    frontZ: bodyD * 0.5,
    rearZ: -bodyD * 0.5,
    wallBottom: deckY + 0.05,
    wallTop: deckY + 3.55,
    bodyW,
    bodyD,
    baseH: deckY,
    clearFront: 1.4,
    density: 0.95,
    fenlight: true,
  });
  // Inn porch post nail heads + chimney iron cap bolts.
  for (const x of [-3.6, -1.9, 1.2, 3.4]) {
    for (const y of [deckY + 0.45, deckY + 1.85]) {
      addBox(buckets, 'metal', [0.05, 0.05, 0.04], [x, y, bodyD * 0.5 + 0.35], P.ironLight);
    }
  }
  for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    addBox(
      buckets,
      'metal',
      [0.08, 0.06, 0.08],
      [Math.cos(a) * 0.35 + 3.2, deckY + 5.1, Math.sin(a) * 0.35 - 0.4],
      P.iron,
    );
  }
}

/**
 * Moonwort Apothecary: stilt shack, crooked teal roof with horns, porch steps,
 * herb counter (socket 1.9,1.2,3), potion bottles, hanging herbs, chimney.
 * Front-entry [0,0,3]. Multi-round exterior rebuild.
 */
export function buildMoonwortApothecary(buckets) {
  const deckY = 0.85;
  const wallBottom = deckY + 0.05;
  const wallTop = 3.55;
  const peakY = 5.85;
  const bodyW = 5.4;
  const bodyD = 4.6;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyD * 0.5;
  const halfW = bodyW * 0.5;

  // R1 stilts + deck
  for (const [x, z] of [
    [-2.3, 1.9],
    [-0.8, 2.0],
    [0.8, 2.0],
    [2.3, 1.9],
    [-2.4, 0],
    [2.4, 0],
    [-2.3, -1.9],
    [0, -2.0],
    [2.3, -1.9],
  ]) {
    addBox(buckets, 'timber', [0.18, deckY + 0.1, 0.18], [x, deckY * 0.5, z], P.timberDark);
    addCylinder(buckets, 'cloth', 0.12, 0.12, 0.08, 5, [x, deckY * 0.65, z], P.rope);
  }
  for (let i = 0; i < 9; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.55, 0.1, 4.4],
      [-2.2 + i * 0.55, deckY + 0.05, 0],
      i % 2 ? P.timberLight : P.timber,
    );
  }
  addSteps(buckets, 0, frontZ + 0.7, 1.7, 5, 1, 0.05);

  // R2-3 shell
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.96, bodyD * 0.86],
    [0, wallCy, 0],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.95, wallH, [0, wallCy, frontZ - 0.04], {
    plankCount: 10,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.95, wallH, [0, wallCy, -frontZ + 0.04], {
    plankCount: 10,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.92, wallH, [-halfW * 0.92, wallCy, 0], {
    plankCount: 8,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.92, wallH, [halfW * 0.92, wallCy, 0], {
    plankCount: 8,
  });
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const z of [-frontZ + 0.04, frontZ - 0.04]) {
      addBox(buckets, 'timber', [0.22, wallH + 0.15, 0.22], [x, wallCy, z], P.timberDark);
    }
  }
  addBox(
    buckets,
    'timber',
    [bodyW * 1.05, 0.14, bodyD * 1.05],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );

  // R4-6 crooked bent roof + horns
  addBentConceptRoof(buckets, bodyW * 1.25, bodyD * 1.2, wallTop + 0.02, peakY, {
    courses: 9,
    strips: 11,
    profile: [
      [-0.5, 0.55],
      [-0.28, 0.1],
      [-0.05, -0.05],
      [0.15, 0.02],
      [0.35, 0.15],
      [0.5, 0.5],
    ],
  });
  // Horn tips
  for (const side of [-1, 1]) {
    addBox(
      buckets,
      'timber',
      [0.55, 0.12, 0.12],
      [side * (halfW * 1.05), peakY + 0.15, 0],
      P.timberLight,
      [0, 0, side * 0.45],
    );
    addOctahedron(buckets, 'metal', 0.08, [side * (halfW * 1.25), peakY + 0.25, 0], P.brass);
  }
  // Chimney mid-ridge
  for (let c = 0; c < 5; c += 1) {
    addBox(
      buckets,
      'stone',
      [0.45, 0.28, 0.4],
      [0.35, wallTop + 0.3 + c * 0.28, -0.4],
      c % 2 ? P.stoneDeep : P.stone,
    );
  }
  addBox(buckets, 'stone', [0.55, 0.1, 0.5], [0.35, wallTop + 1.75, -0.4], P.stoneLight);

  // R7-9 door + herb counter + windows
  addDoor(buckets, -0.85, wallBottom + 1.05, frontZ - 0.02, 1.05, 2.0, 'rounded');
  // Herb service counter (socket ~1.9, 1.2, 3)
  addBox(
    buckets,
    'timber',
    [1.6, 0.7, 0.55],
    [1.7, wallBottom + 0.85, frontZ + 0.15],
    P.timberDeep,
  );
  addBox(buckets, 'cloth', [1.5, 0.06, 0.7], [1.7, wallBottom + 1.35, frontZ + 0.2], P.parchment);
  addBox(
    buckets,
    'cloth',
    [1.7, 0.08, 0.9],
    [1.7, wallBottom + 1.55, frontZ + 0.15],
    P.clothTeal,
    [0.05, 0, 0],
  );
  // Potion bottles (colored glass)
  for (const [dx, c] of [
    [-0.4, P.potionGlass],
    [-0.1, P.fenlight],
    [0.2, P.wax],
    [0.5, P.potionGlass],
  ]) {
    addCylinder(
      buckets,
      'organic',
      0.08,
      0.1,
      0.22,
      6,
      [1.7 + dx, wallBottom + 1.5, frontZ + 0.25],
      c,
    );
  }
  addWindow(buckets, 0.15, wallBottom + 2.35, frontZ - 0.02, 0.7, 'rounded');
  addWindow(buckets, -halfW * 0.95, wallBottom + 1.9, 0.3, 0.7, 'rounded');
  addWindow(buckets, halfW * 0.95, wallBottom + 1.9, -0.2, 0.7, 'rounded');

  // R10-13 hanging herbs, still, fungi, lanterns
  for (const [x, z] of [
    [-2.0, frontZ + 0.1],
    [-1.5, frontZ + 0.15],
    [2.3, 0.5],
    [2.4, -0.8],
  ]) {
    addBox(buckets, 'organic', [0.08, 0.45, 0.08], [x, wallBottom + 1.9, z], P.herb);
    addBox(buckets, 'organic', [0.15, 0.2, 0.1], [x, wallBottom + 1.65, z], P.herb);
  }
  // Distiller still left porch
  addCylinder(
    buckets,
    'metal',
    0.18,
    0.22,
    0.45,
    8,
    [-2.3, wallBottom + 0.7, frontZ + 0.4],
    P.brass,
  );
  addCylinder(
    buckets,
    'metal',
    0.06,
    0.06,
    0.5,
    5,
    [-2.0, wallBottom + 1.1, frontZ + 0.4],
    P.brassLight,
    [0, 0, 0.6],
  );
  // Purple fungi
  for (const [x, z] of [
    [-1.8, frontZ + 0.5],
    [1.2, frontZ + 0.45],
    [2.5, -1.5],
  ]) {
    addCylinder(buckets, 'organic', 0.08, 0.12, 0.12, 5, [x, deckY + 0.2, z], P.wax);
  }
  addLantern(buckets, [-1.8, wallBottom + 2.2, frontZ + 0.2], 0.85);
  addLantern(buckets, [2.2, wallBottom + 2.1, frontZ + 0.15], 0.75);
  addBarrel(buckets, [2.55, deckY + 0.35, -1.6], 0.7);
  addBarrel(buckets, [-2.4, deckY + 0.32, 1.5], 0.55);

  // R14-15 rails + seat
  addRopeRail(buckets, -2.3, -1.0, deckY, frontZ + 0.85, 3);
  addRopeRail(buckets, 1.0, 2.3, deckY, frontZ + 0.85, 3);
  for (const z of [frontZ * 0.98, -frontZ * 0.98]) {
    addBox(buckets, 'timber', [bodyW * 1.1, 0.12, 0.1], [0, wallTop + 0.02, z], P.timberDark);
  }

  // R16-30 exterior polish: herb counter (1.9, front) stays serviceable.
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ: -bodyD * 0.5,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH: deckY,
    clearFront: 1.05,
    density: 1.12,
    fenlight: true,
  });
  for (const [x, y] of [
    [2.15, wallBottom + 2.45],
    [2.35, wallBottom + 2.2],
    [2.0, wallBottom + 2.65],
  ]) {
    addBox(buckets, 'organic', [0.12, 0.35, 0.1], [x, y, frontZ - 0.05], P.herb);
    addCylinder(buckets, 'cloth', 0.02, 0.02, 0.2, 4, [x, y + 0.25, frontZ - 0.05], P.rope);
  }
  for (const dx of [0, 0.18, 0.36]) {
    addCylinder(
      buckets,
      'organic',
      0.06,
      0.06,
      0.18,
      5,
      [2.1 + dx, wallBottom + 1.45, frontZ + 0.35],
      dx === 0.18 ? P.potionGlass : P.herb,
    );
  }
}

/**
 * Hesk Tannery: exterior-only reconstruction from the four admitted turnaround
 * crops (five polish rounds for concept match + performance).
 * Identity: wide raised apron with wood poles in the marsh, left workshop,
 * continuous bent teal roof, tall masonry chimney, front dormer + dual rear
 * dormers, long open right craft bay with forward-facing hide frames, lower
 * lean-to roof, vats, drains, dense exterior craft clutter. Native 12 yd wide.
 * Front-entry x=0; station ~[2.75,2.8]. No walk-in interior.
 */
export function buildHeskTannery(buckets) {
  const deckY = 0.7;
  const wallBottom = deckY + 0.06;
  const wallTop = 4.28;
  const peakY = 6.55;
  // Concept-long: workshop left, elongated open craft bay right.
  const bodyW = 6.5;
  const bodyD = 5.5;
  const bodyCx = -2.05;
  const bodyCz = -0.05;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyCz + bodyD * 0.5;
  const rearZ = bodyCz - bodyD * 0.5;
  const porchFront = frontZ + 1.35;
  const wingCx = 3.65;
  const wingW = 5.0;
  const wingD = 5.5;
  const wingFront = wingD * 0.42;
  const wingRear = -wingD * 0.42;
  // Lean-to roof sits well below main eaves (concept lower wing).
  const wingEaveY = deckY + 2.95;
  const _wingPeakY = deckY + 3.55;

  // ---- Round 1: wide stilt apron ----
  addRaisedPilingDeck(buckets, 11.85, 7.05, {
    deckY,
    pilingRows: 3,
    pilingsPerRow: 9,
    center: [0.15, 0.05],
  });
  // Wider deck boards (fewer, still readable) for performance.
  for (let index = 0; index < 14; index += 1) {
    const x = -5.7 + index * 0.85;
    addBox(
      buckets,
      'timber',
      [0.76, 0.09, 6.8],
      [x, deckY + 0.05, 0.1],
      index % 2 === 0 ? P.timberLight : P.timber,
    );
  }
  addBox(
    buckets,
    'timber',
    [11.6, 0.14, 0.15],
    [0.15, deckY - 0.02, porchFront - 0.04],
    P.timberDark,
  );
  for (const x of [-5.75, 5.9]) {
    addBox(buckets, 'timber', [0.15, 0.14, 6.55], [x, deckY - 0.02, 0.08], P.timberDark);
  }

  // ---- Round 4: wood poles in the marsh water (concept stilts) ----
  // Irregular timber cylinders under the apron read as poles sunk in fen water.
  // Slight height jitter + moss waterline + rope wraps keep them concept-faithful
  // without burning the triangle budget (6-segment cylinders).
  const waterPoles = [
    // Front lip (most visible from street).
    [-5.35, porchFront - 0.08, 0.14, 0.78],
    [-4.15, porchFront - 0.05, 0.12, 0.72],
    [-2.85, porchFront - 0.1, 0.13, 0.8],
    [-1.55, porchFront - 0.06, 0.11, 0.7],
    [-0.35, porchFront - 0.08, 0.13, 0.76],
    [0.95, porchFront - 0.05, 0.12, 0.74],
    [2.15, porchFront - 0.1, 0.14, 0.82],
    [3.35, porchFront - 0.06, 0.12, 0.73],
    [4.55, porchFront - 0.08, 0.13, 0.79],
    [5.55, porchFront - 0.05, 0.12, 0.71],
    // Outer corners + sides.
    [-5.7, 0.4, 0.13, 0.75],
    [-5.65, -1.4, 0.12, 0.7],
    [-5.55, -2.9, 0.14, 0.78],
    [5.85, 0.5, 0.13, 0.76],
    [5.8, -1.3, 0.12, 0.72],
    [5.7, -2.8, 0.13, 0.74],
    // Rear lip.
    [-4.2, rearZ - 0.15, 0.12, 0.7],
    [-1.8, rearZ - 0.12, 0.11, 0.68],
    [1.2, rearZ - 0.15, 0.12, 0.72],
    [3.8, rearZ - 0.1, 0.13, 0.75],
    [5.3, rearZ - 0.12, 0.12, 0.7],
  ];
  for (const [index, [x, z, radius, heightScale]] of waterPoles.entries()) {
    const height = deckY * heightScale + 0.08;
    const color = index % 3 === 0 ? P.timberDeep : index % 2 === 0 ? P.timberDark : P.timber;
    // Pole body: sunk slightly below deck so it reads as standing in water.
    // 5 segments keeps the undercroft dense without overspending tris.
    addCylinder(
      buckets,
      'timber',
      radius,
      radius * 1.08,
      height,
      5,
      [x, height / 2 - 0.02, z],
      color,
    );
    // Moss / waterline ring at the wet base.
    addCylinder(
      buckets,
      'stone',
      radius * 1.25,
      radius * 1.35,
      0.07,
      5,
      [x, 0.05, z],
      index % 2 === 0 ? P.moss : P.stoneDeep,
    );
    // Rope wrap just under the deck joist (concept lashing).
    if (index % 3 === 0) {
      addCylinder(
        buckets,
        'cloth',
        radius * 1.15,
        radius * 1.15,
        0.06,
        5,
        [x, height - 0.08, z],
        P.rope,
      );
    }
  }
  // A few short leaning poles / stakes near the front apron (concept clutter).
  for (const [x, z, lean] of [
    [-5.0, porchFront + 0.15, 0.25],
    [5.2, porchFront + 0.12, -0.22],
    [-4.5, rearZ - 0.35, 0.18],
  ]) {
    addCylinder(buckets, 'timber', 0.07, 0.09, 0.95, 5, [x, 0.42, z], P.timberDark, [0, 0, lean]);
  }

  // ---- Round 1: workshop shell with basestone belt ----
  addBox(
    buckets,
    'timber',
    [bodyW * 0.88, wallH * 0.95, bodyD * 0.86],
    [bodyCx, wallCy, bodyCz],
    P.timberDeep,
  );
  addVerticalPlankFace(buckets, 'front', bodyW * 0.94, wallH, [bodyCx, wallCy, frontZ - 0.08], {
    plankCount: 12,
  });
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.94, wallH, [bodyCx, wallCy, rearZ + 0.08], {
    plankCount: 12,
  });
  addVerticalPlankFace(
    buckets,
    'left',
    bodyD * 0.9,
    wallH,
    [bodyCx - bodyW * 0.46, wallCy, bodyCz],
    {
      plankCount: 8,
    },
  );
  addVerticalPlankFace(
    buckets,
    'right',
    bodyD * 0.9,
    wallH,
    [bodyCx + bodyW * 0.46, wallCy, bodyCz],
    { plankCount: 8 },
  );
  // Stone footing courses (concept wet-stone base).
  for (const face of [
    [0, frontZ - 0.02, bodyW * 0.96, 0.22],
    [0, rearZ + 0.02, bodyW * 0.96, 0.22],
  ]) {
    addMasonryCourse(buckets, face[2], 0.2, wallBottom + 0.18, [bodyCx + face[0], face[1]], {
      blocks: 8,
      height: 0.55,
    });
  }
  for (const x of [bodyCx - bodyW * 0.46, bodyCx + bodyW * 0.46]) {
    for (const z of [rearZ + 0.08, frontZ - 0.08]) {
      addBox(buckets, 'timber', [0.24, wallH + 0.16, 0.24], [x, wallCy, z], P.timberDark);
      addBox(buckets, 'metal', [0.11, 0.5, 0.11], [x, wallBottom + 0.38, z], P.iron);
      addBox(buckets, 'metal', [0.11, 0.11, 0.38], [x, wallBottom + 0.52, z * 0.92], P.ironLight);
    }
  }
  for (const x of [bodyCx - bodyW * 0.2, bodyCx + bodyW * 0.1]) {
    addBox(buckets, 'timber', [0.13, wallH * 0.9, 0.12], [x, wallCy, frontZ - 0.05], P.timberDark);
  }
  for (const z of [rearZ + 0.1, frontZ - 0.1]) {
    addBox(
      buckets,
      'timber',
      [bodyW * 0.96, 0.14, 0.14],
      [bodyCx, wallBottom + wallH * 0.36, z],
      P.timberDark,
    );
    addBox(buckets, 'timber', [bodyW * 0.96, 0.14, 0.15], [bodyCx, wallTop - 0.08, z], P.timber);
  }
  // Horizontal timber log belt (concept half-timber rhythm).
  addBox(
    buckets,
    'timber',
    [bodyW * 0.98, 0.18, 0.16],
    [bodyCx, wallBottom + 0.55, frontZ + 0.02],
    P.timberLight,
  );
  addBox(
    buckets,
    'timber',
    [bodyW * 1.04, 0.16, bodyD * 1.04],
    [bodyCx, wallTop - 0.02, bodyCz],
    P.timberDark,
  );
  addBeamXY(
    buckets,
    'timber',
    [bodyCx - bodyW * 0.4, wallBottom + 0.28],
    [bodyCx - bodyW * 0.12, wallTop - 0.48],
    rearZ + 0.05,
    0.1,
    0.11,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [bodyCx + bodyW * 0.4, wallBottom + 0.28],
    [bodyCx + bodyW * 0.12, wallTop - 0.48],
    rearZ + 0.05,
    0.1,
    0.11,
    P.timber,
  );
  // Front-left bay brace (concept porch frame, clear of door).
  addBeamXY(
    buckets,
    'timber',
    [bodyCx - bodyW * 0.42, wallBottom + 0.4],
    [bodyCx - bodyW * 0.2, wallTop - 0.65],
    frontZ - 0.03,
    0.1,
    0.1,
    P.timberLight,
  );

  // ---- Round 1: continuous bent roof ----
  addBentConceptRoof(buckets, bodyW * 1.18, bodyD * 1.14, wallTop + 0.02, peakY, {
    center: [bodyCx, 0, bodyCz],
    courses: 8,
    strips: 11,
    profile: [
      [-0.5, 0.46],
      [-0.3, 0.1],
      [-0.08, -0.03],
      [0.14, 0.02],
      [0.34, 0.14],
      [0.5, 0.44],
    ],
  });

  // ---- Round 1: massive masonry chimney through the ridge ----
  const chimX = bodyCx - 0.25;
  const chimZ = bodyCz - 0.35;
  for (let course = 0; course < 16; course += 1) {
    const y = wallBottom + 0.1 + course * 0.33;
    const taper = course > 12 ? (course - 12) * 0.055 : 0;
    addBox(
      buckets,
      'stone',
      [1.08 - taper, 0.32, 0.92 - taper * 0.35],
      [chimX + course * 0.005, y, chimZ],
      course % 2 === 0 ? P.stoneDeep : course % 3 === 0 ? P.moss : P.stone,
    );
  }
  const chimTop = wallBottom + 0.1 + 16 * 0.33;
  addBox(buckets, 'stone', [1.22, 0.16, 1.08], [chimX + 0.05, chimTop, chimZ], P.stoneLight);
  addBox(buckets, 'stone', [0.78, 0.42, 0.72], [chimX + 0.07, chimTop + 0.28, chimZ], P.stoneDeep);
  addBox(buckets, 'stone', [0.92, 0.1, 0.86], [chimX + 0.07, chimTop + 0.52, chimZ], P.stoneLight);
  // Small twin flues (concept stack crown, not a thin metal pipe).
  for (const sx of [-0.14, 0.14]) {
    addBox(
      buckets,
      'stone',
      [0.22, 0.28, 0.22],
      [chimX + 0.07 + sx, chimTop + 0.72, chimZ],
      P.stoneDeep,
    );
  }

  // ---- Round 3: front dormer + dual rear dormers (concept rear) ----
  addDormer(buckets, bodyCx + 0.2, peakY - 1.4, frontZ - 0.48, 0.98);
  addDormer(buckets, bodyCx - 1.15, peakY - 1.55, rearZ + 0.55, 0.72);
  addDormer(buckets, bodyCx + 1.05, peakY - 1.55, rearZ + 0.55, 0.72);

  // ---- Round 1+3: porch posts, braces, clear door bay ----
  const porchPosts = [-4.85, -3.65, -2.35, -1.1, 1.2];
  for (const x of porchPosts) {
    addBox(
      buckets,
      'timber',
      [0.16, wallTop - deckY - 0.75, 0.16],
      [x, (deckY + wallTop - 0.48) / 2, porchFront - 0.26],
      P.timberDark,
    );
    addBox(buckets, 'metal', [0.2, 0.08, 0.2], [x, deckY + 0.06, porchFront - 0.26], P.iron);
    addBox(
      buckets,
      'timber',
      [0.42, 0.08, 0.08],
      [x + 0.16, wallTop - 0.88, porchFront - 0.26],
      P.timberLight,
      [0, 0, -0.42],
    );
  }
  addBox(
    buckets,
    'timber',
    [bodyW * 1.04, 0.14, 0.15],
    [bodyCx, wallTop - 0.72, porchFront - 0.26],
    P.timber,
  );
  addBox(
    buckets,
    'timber',
    [bodyW * 0.98, 0.08, 0.1],
    [bodyCx, wallTop - 0.5, porchFront - 0.4],
    P.timberDark,
  );
  // Concept inverted-V braces above the door (high, not blocking approach).
  addBeamXY(
    buckets,
    'timber',
    [-0.95, deckY + 2.35],
    [0, deckY + 3.15],
    porchFront - 0.22,
    0.09,
    0.1,
    P.timberLight,
  );
  addBeamXY(
    buckets,
    'timber',
    [0.95, deckY + 2.35],
    [0, deckY + 3.15],
    porchFront - 0.22,
    0.09,
    0.1,
    P.timberLight,
  );
  // Left workbench canopy eave.
  addBox(
    buckets,
    'roof',
    [3.2, 0.07, 1.4],
    [-3.25, wallTop - 0.5, frontZ + 0.55],
    P.roofDeep,
    [-0.2, 0, 0],
  );
  addBox(
    buckets,
    'timber',
    [3.15, 0.06, 1.34],
    [-3.25, wallTop - 0.58, frontZ + 0.52],
    P.timberDark,
    [-0.2, 0, 0],
  );
  for (const x of [-4.4, -2.9, -1.4, 0.85]) {
    addBox(buckets, 'timber', [0.1, 0.1, 1.3], [x, deckY + 0.12, frontZ + 0.52], P.timberLight);
  }
  addRopeRail(buckets, -5.0, -1.2, deckY, porchFront + 0.02, 5);
  // Rope/chain across bay edge by door (concept).
  addCylinder(
    buckets,
    'cloth',
    0.028,
    0.028,
    1.35,
    5,
    [0.85, deckY + 0.95, porchFront - 0.12],
    P.rope,
    [0, 0, Math.PI / 2],
  );
  addCylinder(
    buckets,
    'cloth',
    0.028,
    0.028,
    1.2,
    5,
    [1.55, deckY + 0.85, porchFront - 0.2],
    P.rope,
    [0, 0, Math.PI / 2],
  );
  addSteps(buckets, 0, porchFront + 0.28, 2.05, 4, 1, 0.02);
  for (const sx of [-1.08, 1.08]) {
    addBox(buckets, 'stone', [0.14, 0.52, 0.72], [sx, 0.27, porchFront + 0.16], P.stoneDeep);
  }

  // ---- Round 3: door with iron straps + windows ----
  addDoor(buckets, 0, deckY + 1.05, frontZ - 0.02, 1.22, 2.18);
  for (const dx of [-0.28, -0.1, 0.1, 0.28]) {
    addBox(
      buckets,
      'timber',
      [0.14, 1.6, 0.045],
      [dx, deckY + 0.98, frontZ + 0.03],
      Math.abs(dx) < 0.15 ? P.timberLight : P.timber,
    );
  }
  // Horizontal iron straps (concept door hardware).
  for (const y of [deckY + 0.55, deckY + 1.05, deckY + 1.55]) {
    addBox(buckets, 'metal', [1.05, 0.07, 0.05], [0, y, frontZ + 0.05], P.iron);
  }
  addOctahedron(buckets, 'metal', 0.07, [0.4, deckY + 1.0, frontZ + 0.07], P.brass, [0.7, 1, 0.45]);
  for (const x of [-0.8, 0.8]) {
    addBox(buckets, 'timber', [0.12, 2.28, 0.12], [x, deckY + 1.2, frontZ - 0.06], P.timberDark);
  }
  addBox(buckets, 'timber', [1.75, 0.1, 0.12], [0, deckY + 2.38, frontZ - 0.05], P.timber);
  addWindow(buckets, -3.65, deckY + 1.9, frontZ - 0.01, 0.9);
  addFrontSill(buckets, -3.65, deckY + 1.32, frontZ + 0.05, 0.88);
  addWindow(buckets, -2.25, deckY + 1.9, frontZ - 0.01, 0.86);
  addFrontSill(buckets, -2.25, deckY + 1.32, frontZ + 0.05, 0.84);
  addExteriorWindow(buckets, [bodyCx - bodyW * 0.48, deckY + 1.92, bodyCz + 0.5], 0.82, {
    face: 'left',
  });
  addExteriorWindow(buckets, [bodyCx - bodyW * 0.48, deckY + 1.92, bodyCz - 0.9], 0.78, {
    face: 'left',
  });
  for (const x of [bodyCx - 1.5, bodyCx + 1.2]) {
    addExteriorWindow(buckets, [x, deckY + 1.95, rearZ + 0.06], 0.78, { face: 'rear' });
  }

  // ---- Round 2+3: left porch workbench ----
  const benchX = -3.25;
  const benchZ = frontZ + 0.72;
  addBox(buckets, 'timber', [2.65, 0.14, 0.8], [benchX, deckY + 0.55, benchZ], P.timberLight);
  for (const x of [benchX - 1.1, benchX + 1.1]) {
    addBox(buckets, 'timber', [0.12, 0.72, 0.12], [x, deckY + 0.3, benchZ], P.timberDark);
  }
  for (const x of [benchX - 1.05, benchX + 1.05]) {
    addBox(buckets, 'timber', [0.1, 1.12, 0.1], [x, deckY + 1.32, benchZ + 0.1], P.timberDark);
  }
  addBox(buckets, 'timber', [2.2, 0.1, 0.1], [benchX, deckY + 1.92, benchZ + 0.1], P.timber);
  for (const [index, x] of [benchX - 0.75, benchX - 0.3, benchX + 0.15, benchX + 0.6].entries()) {
    addBox(buckets, 'metal', [0.05, 0.48, 0.05], [x, deckY + 1.58, benchZ + 0.18], P.iron);
    addBox(
      buckets,
      'metal',
      [0.18, 0.05, 0.05],
      [x + (index % 2 === 0 ? 0.06 : -0.06), deckY + 1.32, benchZ + 0.18],
      index % 2 === 0 ? P.brass : P.ironLight,
    );
  }
  addCylinder(buckets, 'metal', 0.16, 0.2, 0.3, 7, [benchX - 0.7, deckY + 0.82, benchZ], P.iron);
  addCylinder(buckets, 'metal', 0.14, 0.18, 0.28, 7, [benchX + 0.5, deckY + 0.8, benchZ], P.brass);
  addCylinder(
    buckets,
    'metal',
    0.12,
    0.15,
    0.26,
    7,
    [benchX + 0.1, deckY + 0.78, benchZ + 0.08],
    P.ironLight,
  );
  addCylinder(
    buckets,
    'cloth',
    0.15,
    0.15,
    0.72,
    8,
    [benchX - 0.2, deckY + 0.88, benchZ + 0.06],
    P.hide,
    [0, 0, Math.PI / 2],
  );
  addCylinder(buckets, 'cloth', 0.12, 0.12, 0.55, 7, [benchX + 0.9, deckY + 0.85, benchZ], P.hide, [
    0,
    0,
    Math.PI / 2,
  ]);
  addBarrel(buckets, [benchX - 1.5, deckY + 0.34, benchZ + 0.18], 0.76);
  addBarrel(buckets, [benchX + 1.5, deckY + 0.32, benchZ - 0.05], 0.66);
  addBarrel(buckets, [benchX - 1.85, deckY + 0.32, benchZ - 0.22], 0.58);
  addCrate(buckets, [benchX - 0.4, deckY + 0.85, benchZ - 0.04], [0.42, 0.32, 0.38]);
  addCrate(buckets, [benchX + 0.4, deckY + 0.82, benchZ - 0.06], [0.36, 0.28, 0.34]);

  // ---- Round 1+2: long open craft bay ----
  // Post grid is perimeter only. No interior posts so vats stay clear (a mid-front
  // post was piercing the station vat water surface).
  const wingPostXs = [wingCx - wingW * 0.46, wingCx + wingW * 0.46];
  const wingPostZs = [wingRear + 0.25, 0.05, wingFront - 0.18];
  // One mid post at the rear only (behind the hide wall, never through vats).
  const wingPosts = [];
  for (const x of wingPostXs) {
    for (const z of wingPostZs) wingPosts.push([x, z]);
  }
  wingPosts.push([wingCx - wingW * 0.12, wingRear + 0.25]);
  wingPosts.push([wingCx + wingW * 0.12, wingRear + 0.25]);
  for (const [x, z] of wingPosts) {
    addBox(
      buckets,
      'timber',
      [0.15, wingEaveY - deckY - 0.15, 0.15],
      [x, (deckY + wingEaveY) / 2, z],
      P.timberDark,
    );
    addBox(buckets, 'metal', [0.19, 0.08, 0.19], [x, deckY + 0.06, z], P.iron);
  }
  // Headers under lean-to (roof seats on these).
  for (const z of [wingRear + 0.25, 0.05, wingFront - 0.18]) {
    addBox(buckets, 'timber', [wingW * 0.96, 0.13, 0.13], [wingCx, wingEaveY + 0.04, z], P.timber);
  }
  for (const x of wingPostXs) {
    addBox(
      buckets,
      'timber',
      [0.12, 0.12, wingD * 0.88],
      [x, wingEaveY + 0.05, 0.05],
      P.timberLight,
    );
  }
  // Attach lean-to to workshop right wall with ledger beam.
  addBox(
    buckets,
    'timber',
    [0.14, 0.16, wingD * 0.9],
    [bodyCx + bodyW * 0.48, wingEaveY + 0.02, bodyCz],
    P.timberDark,
  );
  // Seated lean-to roof: continuous panels on the header plane (no floating strips).
  // Slight pitch only; every piece stays within the post frame bounds.
  addBox(
    buckets,
    'cloth',
    [wingW * 0.98, 0.08, wingD * 0.92],
    [wingCx, wingEaveY + 0.14, 0.02],
    P.clothTeal,
    [-0.08, 0, 0],
  );
  addBox(
    buckets,
    'roof',
    [wingW * 1.0, 0.05, wingD * 0.94],
    [wingCx, wingEaveY + 0.2, 0.0],
    P.roofDeep,
    [-0.08, 0, 0],
  );
  // Three shallow rafter ribs under the canvas for structure (still on the frame).
  for (const x of [wingCx - wingW * 0.28, wingCx, wingCx + wingW * 0.28]) {
    addBox(
      buckets,
      'timber',
      [0.1, 0.08, wingD * 0.88],
      [x, wingEaveY + 0.1, 0.02],
      P.timberDark,
      [-0.08, 0, 0],
    );
  }
  // Front eave board locks the roof edge to the front header.
  addBox(
    buckets,
    'timber',
    [wingW * 1.0, 0.1, 0.1],
    [wingCx, wingEaveY + 0.08, wingFront - 0.12],
    P.timberLight,
  );
  // Knee braces only on outer posts.
  for (const x of wingPostXs) {
    for (const z of [wingRear + 0.45, wingFront - 0.35]) {
      addBox(
        buckets,
        'timber',
        [0.1, 0.1, 0.48],
        [x, wingEaveY - 0.35, z + (z > 0 ? -0.16 : 0.16)],
        P.timberLight,
        [z > 0 ? 0.45 : -0.45, 0, 0],
      );
    }
  }

  // ---- Round 2: forward-facing hide wall (concept front identity) ----
  // Plank wall mid-bay faces +Z so hides read from the street approach.
  const hideWallZ = 0.35;
  addVerticalPlankFace(buckets, 'front', wingW * 0.88, 2.35, [wingCx, deckY + 1.45, hideWallZ], {
    plankCount: 9,
  });
  addBox(
    buckets,
    'timber',
    [wingW * 0.92, 0.12, 0.12],
    [wingCx, deckY + 2.65, hideWallZ + 0.02],
    P.timberDark,
  );
  addBox(
    buckets,
    'timber',
    [wingW * 0.92, 0.12, 0.12],
    [wingCx, deckY + 0.35, hideWallZ + 0.02],
    P.timber,
  );
  // Mid studs on hide wall.
  for (const x of [wingCx - wingW * 0.28, wingCx, wingCx + wingW * 0.28]) {
    addBox(buckets, 'timber', [0.1, 2.2, 0.1], [x, deckY + 1.4, hideWallZ + 0.03], P.timberDark);
  }
  // Paired stretched hides facing the approach.
  addStretchedHide(buckets, wingCx - 1.1, deckY + 1.7, hideWallZ + 0.12, 1.28, 1.62);
  addStretchedHide(buckets, wingCx + 1.0, deckY + 1.7, hideWallZ + 0.12, 1.28, 1.62);
  for (const x of [wingCx - 0.05, wingCx + 2.2]) {
    addBox(buckets, 'metal', [0.05, 0.18, 0.05], [x, deckY + 2.55, hideWallZ + 0.1], P.iron);
    addCylinder(buckets, 'cloth', 0.04, 0.06, 0.5, 5, [x, deckY + 2.2, hideWallZ + 0.12], P.hide);
  }

  // ---- Round 2: vats, station apron, drains ----
  // Vats sit in the open apron, clear of all posts (post grid is perimeter only).
  addTanningVat(buckets, 3.15, deckY + 0.42, 1.85, 1.15);
  addTanningVat(buckets, 4.85, deckY + 0.4, 1.55, 0.95);
  addTanningVat(buckets, wingCx + 0.55, deckY + 0.36, -1.55, 0.78);
  // Junction bench (off station path).
  addBox(buckets, 'timber', [1.5, 0.14, 0.62], [1.35, deckY + 0.55, 1.7], P.timberLight);
  for (const x of [0.85, 1.85]) {
    addBox(buckets, 'timber', [0.1, 0.68, 0.1], [x, deckY + 0.28, 1.7], P.timberDark);
  }
  addCylinder(buckets, 'cloth', 0.14, 0.14, 0.52, 7, [1.35, deckY + 0.78, 1.75], P.hide, [
    0,
    0,
    Math.PI / 2,
  ]);
  for (const x of [1.1, 1.6]) {
    addBox(buckets, 'metal', [0.05, 0.32, 0.05], [x, deckY + 1.5, 1.9], P.iron);
  }
  // Drain run misses door steps.
  addBox(buckets, 'stone', [0.56, 0.12, 2.6], [3.2, deckY + 0.08, 3.0], P.stoneDeep);
  for (const x of [2.92, 3.48]) {
    addBox(buckets, 'stone', [0.1, 0.2, 2.65], [x, deckY + 0.12, 3.0], P.stoneLight);
  }
  addBox(buckets, 'metal', [0.36, 0.04, 2.4], [3.2, deckY + 0.2, 3.0], P.water);
  addBox(buckets, 'stone', [1.4, 0.1, 0.4], [4.6, deckY + 0.08, 3.2], P.stone);
  addBox(buckets, 'metal', [1.2, 0.035, 0.26], [4.6, deckY + 0.16, 3.2], P.water);

  // ---- Round 3: lanterns on timber arms ----
  addBox(
    buckets,
    'timber',
    [0.55, 0.08, 0.08],
    [-1.15, deckY + 2.55, porchFront - 0.55],
    P.timberDark,
  );
  addLantern(buckets, [-1.45, deckY + 2.2, porchFront - 0.55], 0.72);
  addBox(
    buckets,
    'timber',
    [0.45, 0.08, 0.08],
    [-4.55, deckY + 2.45, porchFront - 0.55],
    P.timberDark,
  );
  addLantern(buckets, [-4.85, deckY + 2.15, porchFront - 0.55], 0.64);
  addLantern(buckets, [wingCx + wingW * 0.4, deckY + 2.45, wingFront - 0.25], 0.76);
  addLantern(buckets, [wingCx - wingW * 0.15, deckY + 2.4, wingFront - 0.2], 0.62);
  addLantern(buckets, [bodyCx - bodyW * 0.42, deckY + 2.35, bodyCz + 0.2], 0.58, 'fenlight');
  addLantern(buckets, [bodyCx + 0.3, deckY + 2.3, rearZ + 0.15], 0.55);

  // ---- Round 3: clutter (corners only; door + station clear) ----
  addBarrel(buckets, [5.55, deckY + 0.34, porchFront - 0.5], 0.8);
  addBarrel(buckets, [5.2, deckY + 0.32, porchFront - 0.95], 0.64);
  addBarrel(buckets, [4.65, deckY + 0.32, porchFront - 0.3], 0.58);
  addBarrel(buckets, [-5.4, deckY + 0.34, porchFront - 0.6], 0.78);
  addBarrel(buckets, [-4.9, deckY + 0.32, porchFront - 1.0], 0.62);
  addBarrel(buckets, [-5.05, deckY + 0.32, rearZ - 0.08], 0.72);
  addBarrel(buckets, [0.3, deckY + 0.34, rearZ - 0.18], 0.68);
  addBarrel(buckets, [5.3, deckY + 0.34, -1.4], 0.66);
  addBarrel(buckets, [wingCx - 1.35, deckY + 0.32, -1.65], 0.6);
  addCrate(buckets, [-4.9, deckY + 0.38, rearZ + 0.18], [0.62, 0.55, 0.58]);
  addCrate(buckets, [bodyCx + 0.5, deckY + 0.36, rearZ - 0.12], [0.58, 0.5, 0.55]);
  addCrate(buckets, [5.05, deckY + 0.36, -0.5], [0.55, 0.48, 0.52]);
  // Rear scraping bench + tools.
  addBox(buckets, 'timber', [2.2, 0.14, 0.56], [bodyCx, deckY + 0.55, rearZ - 0.32], P.timberLight);
  for (const x of [bodyCx - 0.9, bodyCx + 0.9]) {
    addBox(buckets, 'timber', [0.12, 0.7, 0.12], [x, deckY + 0.3, rearZ - 0.32], P.timberDark);
  }
  for (const x of [bodyCx - 0.55, bodyCx, bodyCx + 0.55]) {
    addBox(buckets, 'metal', [0.05, 0.32, 0.05], [x, deckY + 0.98, rearZ - 0.18], P.iron);
  }
  // Ladder rear-right.
  addBox(
    buckets,
    'timber',
    [0.1, 2.15, 0.08],
    [bodyCx + bodyW * 0.5, deckY + 1.12, bodyCz - 0.7],
    P.timberLight,
    [0, 0, -0.15],
  );
  for (const ly of [0.4, 0.85, 1.3, 1.75, 2.1]) {
    addBox(
      buckets,
      'timber',
      [0.38, 0.06, 0.06],
      [bodyCx + bodyW * 0.5, deckY + ly, bodyCz - 0.7],
      P.timberDark,
      [0, 0, -0.15],
    );
  }
  addAttachedRopeNet(buckets, -5.15, deckY + 0.55, porchFront + 0.02, 1.1, 0.48);
  addAttachedRopeNet(buckets, 5.25, deckY + 0.68, wingFront + 0.02, 1.0, 0.52);

  // ---- Round 5: small craft details (concept micro-read) ----
  // Iron nail heads on porch posts (cheap boxes, high gameplay-distance signal).
  for (const x of [-4.85, -2.35, wingCx + wingW * 0.46]) {
    for (const y of [deckY + 0.5, deckY + 1.7]) {
      addBox(buckets, 'metal', [0.05, 0.05, 0.04], [x, y, porchFront - 0.18], P.ironLight);
    }
  }
  // Hanging pots / bowls under the left workbench eave.
  for (const [x, color] of [
    [benchX - 0.55, P.iron],
    [benchX + 0.35, P.brass],
    [benchX + 0.85, P.ironLight],
  ]) {
    addCylinder(buckets, 'metal', 0.1, 0.12, 0.14, 6, [x, deckY + 1.55, benchZ + 0.05], color);
    addCylinder(buckets, 'cloth', 0.02, 0.02, 0.22, 4, [x, deckY + 1.72, benchZ + 0.05], P.rope);
  }
  // Iron rings on craft-bay posts + short hanging hide scraps.
  for (const x of [wingCx - wingW * 0.46, wingCx + wingW * 0.46]) {
    addTorus(buckets, 'metal', 0.09, 0.02, [x, deckY + 1.85, wingFront - 0.2], P.iron, [
      Math.PI / 2,
      0,
      0,
    ]);
    addCylinder(
      buckets,
      'cloth',
      0.035,
      0.05,
      0.38,
      5,
      [x, deckY + 1.55, wingFront - 0.22],
      P.hide,
    );
  }
  // Rope coil on the deck (concept craft clutter, off the door path).
  addTorus(buckets, 'cloth', 0.22, 0.05, [-4.2, deckY + 0.14, porchFront - 0.55], P.rope, [
    Math.PI / 2,
    0,
    0.2,
  ]);
  addTorus(buckets, 'cloth', 0.18, 0.045, [4.9, deckY + 0.14, porchFront - 0.75], P.rope, [
    Math.PI / 2,
    0,
    -0.15,
  ]);
  // Small reed / grass clumps at a few pole bases (marsh waterline).
  for (const [x, z] of [
    [-5.2, porchFront + 0.05],
    [5.4, porchFront + 0.02],
    [-5.5, -2.6],
    [5.5, -2.5],
  ]) {
    for (const ox of [-0.06, 0.05, 0.0]) {
      addCylinder(
        buckets,
        'organic',
        0.02,
        0.03,
        0.35 + Math.abs(ox) * 2,
        4,
        [x + ox, 0.2, z],
        ox === 0 ? P.herb : P.moss,
        [0, 0, ox * 2],
      );
    }
  }
  // Spare scrap hide draped on the wing rail.
  addBox(
    buckets,
    'cloth',
    [0.55, 0.04, 0.35],
    [wingCx + 1.6, deckY + 0.95, 1.4],
    P.hide,
    [0.4, 0.2, 0.15],
  );
  // Bolt heads around the door frame (iron hardware density from concept).
  for (const [x, y] of [
    [-0.7, deckY + 0.55],
    [0.7, deckY + 0.55],
    [-0.7, deckY + 1.9],
    [0.7, deckY + 1.9],
  ]) {
    addBox(buckets, 'metal', [0.06, 0.06, 0.04], [x, y, frontZ + 0.04], P.ironLight);
  }
  // Short cross-brace under the deck front joist (visible between stilts).
  for (const x of [-3.5, 0.5, 3.2]) {
    addBox(
      buckets,
      'timber',
      [1.1, 0.07, 0.07],
      [x, deckY * 0.45, porchFront - 0.35],
      P.timberDark,
      [0, 0, 0.15],
    );
  }

  // R16-30 exterior polish: station apron (~2.75, 2.8) stays clear of new clutter.
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ,
    wallBottom,
    wallTop,
    bodyW: bodyW + wingW * 0.35,
    bodyD,
    baseH: deckY,
    clearFront: 1.2,
    density: 0.9,
    skipClutter: true,
  });
  // Extra hide frames silhouette density on the open bay (exterior only).
  for (let i = 0; i < 3; i += 1) {
    const x = wingCx - 0.8 + i * 0.7;
    addBox(buckets, 'timber', [0.08, 1.55, 0.08], [x, deckY + 1.0, wingFront - 0.15], P.timberDark);
    addBox(buckets, 'cloth', [0.55, 0.9, 0.04], [x, deckY + 1.15, wingFront - 0.12], P.hide);
  }
  // Drain run stones along craft bay front.
  for (let i = 0; i < 6; i += 1) {
    addBox(
      buckets,
      'stone',
      [0.35, 0.08, 0.22],
      [wingCx - 1.4 + i * 0.55, deckY + 0.05, wingFront + 0.35],
      i % 2 ? P.moss : P.stoneDeep,
    );
  }
}

/**
 * Scout Lodge: raised stilts, main lodge + lookout tower left, map lean-to right,
 * pennant mast, weapon racks. Sockets: front-entry [0,0,3.25], map-table [3.2,1.2,3.2].
 * Multi-round exterior rebuild.
 */
export function buildScoutLodge(buckets) {
  const deckY = 0.75;
  const wallBottom = deckY + 0.05;
  const wallTop = 3.75;
  const peakY = 5.95;
  const bodyW = 5.6;
  const bodyD = 4.8;
  const wallH = wallTop - wallBottom;
  const wallCy = wallBottom + wallH / 2;
  const frontZ = bodyD * 0.5;
  const halfW = bodyW * 0.5;

  // R1-2 stilts + wrap deck
  for (const [x, z] of [
    [-3.2, 2.4],
    [-1.2, 2.5],
    [1.2, 2.5],
    [3.5, 2.4],
    [-3.3, 0],
    [3.6, 0],
    [-3.2, -2.2],
    [0, -2.3],
    [3.5, -2.2],
    [3.6, 1.2],
  ]) {
    addBox(buckets, 'timber', [0.16, deckY + 0.08, 0.16], [x, deckY * 0.5, z], P.timberDark);
  }
  for (let i = 0; i < 12; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.55, 0.1, 5.3],
      [-3.0 + i * 0.55, deckY + 0.05, 0.15],
      i % 2 ? P.timberLight : P.timber,
    );
  }
  addSteps(buckets, -0.5, frontZ + 0.75, 1.8, 4, 1, 0.05);

  // R3 main shell
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
  addVerticalPlankFace(buckets, 'rear', bodyW * 0.95, wallH, [0, wallCy, -frontZ + 0.04], {
    plankCount: 11,
  });
  addVerticalPlankFace(buckets, 'left', bodyD * 0.92, wallH, [-halfW * 0.92, wallCy, 0], {
    plankCount: 9,
  });
  addVerticalPlankFace(buckets, 'right', bodyD * 0.92, wallH, [halfW * 0.92, wallCy, 0], {
    plankCount: 9,
  });
  for (const x of [-halfW * 0.92, halfW * 0.92]) {
    for (const z of [-frontZ + 0.04, frontZ - 0.04]) {
      addBox(buckets, 'timber', [0.22, wallH + 0.15, 0.22], [x, wallCy, z], P.timberDark);
      addBox(buckets, 'metal', [0.28, 0.12, 0.28], [x, wallBottom + 0.5, z], P.iron);
    }
  }
  addBox(
    buckets,
    'timber',
    [bodyW * 1.05, 0.14, bodyD * 1.05],
    [0, wallTop - 0.02, 0],
    P.timberDark,
  );

  // R4-6 bent main roof + side wing
  addBentConceptRoof(buckets, bodyW * 1.22, bodyD * 1.18, wallTop + 0.02, peakY, {
    courses: 9,
    strips: 12,
    profile: [
      [-0.5, 0.4],
      [-0.3, 0.08],
      [-0.05, -0.02],
      [0.15, 0.0],
      [0.35, 0.12],
      [0.5, 0.38],
    ],
  });
  // Right map lean-to roof
  addShingledRoof(buckets, 2.8, 2.6, wallTop - 0.2, wallTop + 1.1, {
    ridgeAxis: 'x',
    center: [3.0, 0, 0.6],
    courses: 6,
  });
  // Front dormer
  addBox(buckets, 'timber', [1.1, 0.9, 0.7], [0.2, wallTop + 0.55, frontZ * 0.2], P.timberDark);
  addPitchedRoof(buckets, 'roof', 1.3, 0.85, wallTop + 0.9, wallTop + 1.45, P.roofDeep, {
    ridgeAxis: 'z',
    center: [0.2, 0, frontZ * 0.2],
  });
  addWindow(buckets, 0.2, wallTop + 0.55, frontZ * 0.45, 0.55, 'rounded');

  // R7 lookout tower left
  const tx = -2.6;
  const tz = 0.4;
  for (const [dx, dz] of [
    [-0.45, -0.45],
    [0.45, -0.45],
    [-0.45, 0.45],
    [0.45, 0.45],
  ]) {
    addBox(
      buckets,
      'timber',
      [0.16, 4.2, 0.16],
      [tx + dx, wallBottom + 2.1, tz + dz],
      P.timberDark,
    );
  }
  addBox(buckets, 'timber', [1.15, 0.12, 1.15], [tx, wallBottom + 3.6, tz], P.timberLight);
  for (const [dx, dz] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ]) {
    addBox(buckets, 'timber', [0.1, 0.85, 0.1], [tx + dx, wallBottom + 4.1, tz + dz], P.timber);
  }
  addBox(buckets, 'timber', [1.1, 0.1, 0.1], [tx, wallBottom + 4.5, tz - 0.5], P.timberDark);
  addBox(buckets, 'timber', [1.1, 0.1, 0.1], [tx, wallBottom + 4.5, tz + 0.5], P.timberDark);
  addShingledRoof(buckets, 1.5, 1.5, wallBottom + 4.55, wallBottom + 5.35, {
    ridgeAxis: 'x',
    center: [tx, 0, tz],
    courses: 4,
  });
  addCylinder(buckets, 'timber', 0.05, 0.05, 1.4, 5, [tx, wallBottom + 5.9, tz], P.timberDark);
  addBox(
    buckets,
    'cloth',
    [0.08, 0.7, 0.95],
    [tx + 0.35, wallBottom + 6.2, tz],
    P.clothTeal,
    [0, 0.2, 0],
  );

  // R8-10 door, windows, map table lean-to
  addDoor(buckets, -0.3, wallBottom + 1.05, frontZ - 0.02, 1.1, 2.05, 'rounded');
  addWindow(buckets, -1.5, wallBottom + 2.0, frontZ - 0.02, 0.7, 'rounded');
  addWindow(buckets, 1.1, wallBottom + 2.0, frontZ - 0.02, 0.7, 'rounded');
  addWindow(buckets, -halfW * 0.95, wallBottom + 1.9, 0.2, 0.7, 'rounded');
  // Map lean-to posts + table (socket 3.2, 1.2, 3.2)
  for (const x of [2.4, 3.7]) {
    addBox(
      buckets,
      'timber',
      [0.16, 2.2, 0.16],
      [x, wallBottom + 1.15, frontZ + 0.4],
      P.timberDark,
    );
  }
  addBox(
    buckets,
    'timber',
    [1.6, 0.12, 1.1],
    [3.1, wallBottom + 0.95, frontZ + 0.35],
    P.timberLight,
  );
  addBox(
    buckets,
    'parchment',
    [1.1, 0.04, 0.75],
    [3.15, wallBottom + 1.05, frontZ + 0.4],
    P.parchment,
  );
  // Weapon racks (spears)
  for (let i = 0; i < 5; i += 1) {
    addCylinder(
      buckets,
      'timber',
      0.03,
      0.03,
      1.4,
      4,
      [2.6 + i * 0.12, wallBottom + 1.4, frontZ + 0.1],
      P.timberDark,
      [0.15, 0, 0],
    );
    addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.05, 0.18, 4), P.ironLight, {
      position: [2.6 + i * 0.12, wallBottom + 2.15, frontZ + 0.1],
    });
  }

  // R11-15 lanterns, barrels, rails, seat
  addLantern(buckets, [-2.0, wallBottom + 2.3, frontZ + 0.25], 0.85);
  addLantern(buckets, [3.8, wallBottom + 2.2, frontZ + 0.5], 0.8);
  addBarrel(buckets, [2.5, deckY + 0.35, frontZ + 0.2], 0.6);
  addBarrel(buckets, [3.5, deckY + 0.32, -1.5], 0.55);
  addRopeRail(buckets, -3.0, -1.2, deckY, frontZ + 0.9, 4);
  addRopeRail(buckets, 1.5, 3.5, deckY, frontZ + 0.9, 4);
  for (const z of [frontZ * 0.98, -frontZ * 0.98]) {
    addBox(buckets, 'timber', [bodyW * 1.1, 0.12, 0.1], [0, wallTop + 0.02, z], P.timberDark);
  }
  for (const y of [wallBottom + wallH * 0.4, wallBottom + wallH * 0.7]) {
    addBox(buckets, 'timber', [bodyW * 0.95, 0.12, 0.12], [0, y, frontZ - 0.02], P.timberDark);
  }

  // R16-30 exterior polish: map table lean-to (3.2, front) stays clear.
  addExteriorPolishRounds(buckets, {
    frontZ,
    rearZ: -bodyD * 0.5,
    wallBottom,
    wallTop,
    bodyW,
    bodyD,
    baseH: deckY,
    clearFront: 1.1,
    density: 1.08,
  });
  // Lookout tower rail studs + pennant mast wrap.
  for (const y of [wallTop + 0.4, wallTop + 0.9, wallTop + 1.35]) {
    addBox(buckets, 'metal', [0.5, 0.06, 0.5], [-2.0, y, -0.3], P.ironLight);
  }
  addCylinder(buckets, 'cloth', 0.05, 0.05, 0.9, 5, [-2.0, wallTop + 1.7, -0.3], P.rope);
  addBox(
    buckets,
    'cloth',
    [0.08, 0.55, 0.35],
    [-1.7, wallTop + 1.55, -0.3],
    P.clothTeal,
    [0, 0, -0.2],
  );
}
