import * as THREE from 'three';
import {
  addArchedDoor,
  addArchedWindow,
  addBarrel,
  addBeamXY,
  addBox,
  addCrate,
  addCylinder,
  addFoundation,
  addGableShell,
  addGeometry,
  addLantern,
  addOctahedron,
  addRoofCourses,
  addRoofTrim,
  addSack,
  addSteps,
  makeArchedFrame,
  makeArchedPanel,
  makePitchedRoof,
  TOWN_PALETTE as P,
} from './shared.js';

function addGoldPostCaps(buckets, posts) {
  for (const [x, y, z, size = 0.16] of posts) {
    addBox(buckets, 'metal', [size, size * 0.45, size], [x, y, z], P.goldLight);
  }
}

function addTimberBracket(buckets, x, y, z, mirror = 1) {
  addBeamXY(buckets, 'timber', [x, y - 0.42], [x + mirror * 0.38, y], z, 0.1, 0.12, P.timberDark);
}

// makePitchedRoof's first 4 triangles (12 indices) are the two slope quads on
// both ridge axes today; the last 4 are the gable end caps this bank canopy
// deliberately drops (open underside, see addBankVaultAlcove/teller-bay
// canopy callers). This assumes makePitchedRoof keeps emitting the slopes
// first with no local guard of its own, so if that ordering ever changes the
// bank would silently ship wrong roof geometry with only the GLB sha pin,
// several steps removed, to notice. The assertion below catches a reorder
// immediately: the 4 sliced slope triangles must reference all 6 of the
// roof's vertices (the two full slope faces do; either gable cap alone only
// touches 3 or 4 of them), so a reorder that swaps in cap triangles instead
// fails loudly here rather than shipping silently.
function makeOpenPitchedRoof(width, depth, eaveY, peakY, ridgeAxis) {
  const geometry = makePitchedRoof(width, depth, eaveY, peakY, ridgeAxis);
  const index = geometry.getIndex();
  if (!index) throw new Error('bank roof geometry is missing its index');
  const sloped = Array.from(index.array).slice(0, 12);
  const referenced = new Set(sloped);
  if (referenced.size !== 6) {
    throw new Error(
      `bank open roof: expected the first 4 triangles to reference all 6 roof vertices (slopes only), got ${referenced.size}; makePitchedRoof's triangle order may have changed`,
    );
  }
  geometry.setIndex(sloped);
  geometry.computeVertexNormals();
  return geometry;
}

function makeBankGablePanel(width, rise, depth, shoulderRise = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  if (shoulderRise > 0) shape.lineTo(width / 2, shoulderRise);
  shape.lineTo(0, rise);
  if (shoulderRise > 0) shape.lineTo(-width / 2, shoulderRise);
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

function makeBankSideGablePanel({
  rearRun,
  frontRun,
  peakRise,
  rearShoulderRise,
  frontShoulderRise,
  depth,
}) {
  const shape = new THREE.Shape();
  shape.moveTo(-frontRun, 0);
  shape.lineTo(rearRun, 0);
  shape.lineTo(rearRun, rearShoulderRise);
  shape.lineTo(0, peakRise);
  shape.lineTo(-frontRun, frontShoulderRise);
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

function addBankBeamYZ(buckets, x, start, end, thickness, depth, color) {
  const deltaZ = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const length = Math.hypot(deltaZ, deltaY);
  const angle = -Math.atan2(deltaY, deltaZ);
  addBox(
    buckets,
    'timber',
    [depth, thickness, length],
    [x, (start[1] + end[1]) / 2, (start[0] + end[0]) / 2],
    color,
    [angle, 0, 0],
  );
}

function addBankFrontGableFrame(buckets, centerX, width, eaveY, peakY, z) {
  const halfWidth = width / 2;
  addBeamXY(
    buckets,
    'timber',
    [centerX - halfWidth, eaveY],
    [centerX, peakY],
    z,
    0.15,
    0.14,
    P.timberDark,
  );
  addBeamXY(
    buckets,
    'timber',
    [centerX, peakY],
    [centerX + halfWidth, eaveY],
    z,
    0.15,
    0.14,
    P.timberDark,
  );
  addBox(
    buckets,
    'timber',
    [0.15, peakY - eaveY, 0.14],
    [centerX, eaveY + (peakY - eaveY) / 2, z],
    P.timberDeep,
  );
  addBeamXY(
    buckets,
    'timber',
    [centerX, eaveY + 0.08],
    [centerX - 0.62, eaveY + 0.62],
    z,
    0.11,
    0.13,
    P.timber,
  );
  addBeamXY(
    buckets,
    'timber',
    [centerX, eaveY + 0.08],
    [centerX + 0.62, eaveY + 0.62],
    z,
    0.11,
    0.13,
    P.timber,
  );
  addBox(buckets, 'timber', [width + 0.1, 0.19, 0.16], [centerX, eaveY, z], P.timberDark);
}

function addBankSideGableFrame(buckets, options) {
  const { x, rearZ, ridgeZ, frontZ, eaveY, rearShoulderY, peakY, frontShoulderY } = options;
  addBox(
    buckets,
    'timber',
    [0.15, peakY - eaveY, 0.15],
    [x, eaveY + (peakY - eaveY) / 2, ridgeZ],
    P.timberDeep,
  );
  for (const [z, shoulderY] of [
    [rearZ, rearShoulderY],
    [frontZ, frontShoulderY],
  ]) {
    addBox(
      buckets,
      'timber',
      [0.15, shoulderY - eaveY, 0.15],
      [x, eaveY + (shoulderY - eaveY) / 2, z],
      P.timberDark,
    );
  }
  addBankBeamYZ(
    buckets,
    x,
    [ridgeZ, eaveY + 0.08],
    [ridgeZ - 0.9, eaveY + 1.08],
    0.11,
    0.14,
    P.timber,
  );
  addBankBeamYZ(
    buckets,
    x,
    [ridgeZ, eaveY + 0.08],
    [ridgeZ + 0.9, eaveY + 1.08],
    0.11,
    0.14,
    P.timber,
  );
  addBox(
    buckets,
    'timber',
    [0.16, 0.2, frontZ - rearZ + 0.1],
    [x, eaveY, (rearZ + frontZ) / 2],
    P.timberDark,
  );
}

function addBankMainRoofBargeboards(buckets, options) {
  const { xOffset, boardDepth, roofDepth, eaveY, peakY, centerZ, surfaceOffset } = options;
  const halfDepth = roofDepth / 2;
  const rise = peakY - eaveY;
  const slopeLength = Math.hypot(halfDepth, rise);
  const boardThickness = 0.18;
  const offsetY = (halfDepth / slopeLength) * surfaceOffset;
  const offsetZ = (rise / slopeLength) * surfaceOffset;
  for (const side of [-1, 1]) {
    const x = side * xOffset;
    addBankBeamYZ(
      buckets,
      x,
      [centerZ - halfDepth - offsetZ, eaveY + offsetY],
      [centerZ - offsetZ, peakY + offsetY],
      boardThickness,
      boardDepth,
      P.timberDark,
    );
    addBankBeamYZ(
      buckets,
      x,
      [centerZ + offsetZ, peakY + offsetY],
      [centerZ + halfDepth + offsetZ, eaveY + offsetY],
      boardThickness,
      boardDepth,
      P.timberDark,
    );
  }
}

// Matches addRoofCourses' surface offset (shared.js) so the bank's courses sit
// as far off the roof as every other building's, instead of the 0.003 this
// used to use: an order of magnitude tighter, which review measured as only
// a few post-quantization steps clear of the roof surface itself (a real
// z-fighting risk at range, since the town has no logarithmic depth buffer
// and is drawn well past the depth-precision distance where that gap matters).
const ROOF_COURSE_SURFACE_OFFSET = 0.025;

function addBankMainRoofCourses(buckets, width, depth, eaveY, peakY, centerZ) {
  const rise = peakY - eaveY;
  const halfDepth = depth / 2;
  const slopeLength = Math.hypot(halfDepth, rise);
  const normalY = halfDepth / slopeLength;
  const normalZ = rise / slopeLength;
  for (const side of [-1, 1]) {
    for (const fraction of [0.18, 0.38, 0.58, 0.78]) {
      const halfCourse = 0.006;
      const lowerFraction = fraction - halfCourse;
      const upperFraction = fraction + halfCourse;
      const lowerY = eaveY + rise * lowerFraction + normalY * ROOF_COURSE_SURFACE_OFFSET;
      const upperY = eaveY + rise * upperFraction + normalY * ROOF_COURSE_SURFACE_OFFSET;
      const lowerZ =
        centerZ +
        side * halfDepth * (1 - lowerFraction) +
        side * normalZ * ROOF_COURSE_SURFACE_OFFSET;
      const upperZ =
        centerZ +
        side * halfDepth * (1 - upperFraction) +
        side * normalZ * ROOF_COURSE_SURFACE_OFFSET;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            -width / 2,
            lowerY,
            lowerZ,
            width / 2,
            lowerY,
            lowerZ,
            -width / 2,
            upperY,
            upperZ,
            width / 2,
            upperY,
            upperZ,
          ],
          3,
        ),
      );
      geometry.setIndex(side > 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3]);
      geometry.computeVertexNormals();
      addGeometry(buckets, 'roof', geometry, fraction === 0.58 ? P.roofLight : P.roofDeep);
    }
  }
}

function addBankMasonryCourses(buckets, z) {
  const rows = [
    { y: 0.58, centers: [-2.54, -1.52, -0.5, 0.52, 1.54, 2.56], width: 0.96 },
    { y: 0.88, centers: [-2.45, -1.225, 0, 1.225, 2.45], width: 1.16 },
    { y: 1.18, centers: [-2.54, -1.52, -0.5, 0.52, 1.54, 2.56], width: 0.96 },
  ];
  for (const [rowIndex, row] of rows.entries()) {
    for (const x of row.centers) {
      addBox(
        buckets,
        'stone',
        [row.width, 0.27, 0.14],
        [x, row.y, z],
        rowIndex === 1 ? P.stone : P.stoneLight,
      );
    }
  }
}

function addBankEntranceSteps(buckets, centerX) {
  const courses = [
    { width: 2.64, height: 0.16, depth: 0.44, y: 0.08, z: 2.53 },
    { width: 2.38, height: 0.16, depth: 0.4, y: 0.24, z: 2.39 },
    { width: 2.12, height: 0.16, depth: 0.36, y: 0.4, z: 2.27 },
  ];
  for (const [index, course] of courses.entries()) {
    addBox(
      buckets,
      'stone',
      [course.width, course.height, course.depth],
      [centerX, course.y, course.z],
      index === 1 ? P.stone : P.stoneLight,
    );
  }
}

function addBankVoussoirs(buckets, centerX, z) {
  const shoulderY = 1.92;
  for (let index = 0; index < 7; index++) {
    const angle = Math.PI * (0.11 + index * 0.13);
    addBox(
      buckets,
      'stone',
      [0.34, 0.24, 0.15],
      [centerX + Math.cos(angle) * 0.76, shoulderY + Math.sin(angle) * 1.03, z],
      index % 2 === 0 ? P.stoneLight : P.stone,
      [0, 0, angle - Math.PI / 2],
    );
  }
  for (const side of [-1, 1]) {
    for (let course = 0; course < 4; course++) {
      addBox(
        buckets,
        'stone',
        [0.3, 0.31, 0.15],
        [centerX + side * 0.72, 0.68 + course * 0.33, z],
        course % 2 === 0 ? P.stone : P.stoneLight,
      );
    }
  }
}

function addBankTellerBay(buckets, centerX, facadeZ) {
  addBox(buckets, 'timber', [1.92, 1.08, 0.08], [centerX, 2.04, facadeZ], P.timberDeep);
  addBox(buckets, 'timber', [2.04, 0.17, 0.18], [centerX, 2.62, facadeZ + 0.08], P.timberDark);
  addBox(
    buckets,
    'timber',
    [0.17, 1.18, 0.18],
    [centerX - 0.95, 2.08, facadeZ + 0.08],
    P.timberDark,
  );
  addBox(
    buckets,
    'timber',
    [0.17, 1.18, 0.18],
    [centerX + 0.95, 2.08, facadeZ + 0.08],
    P.timberDark,
  );
  addBox(buckets, 'timber', [2.14, 0.19, 0.46], [centerX, 1.45, facadeZ + 0.2], P.timberLight);
  addBox(buckets, 'timber', [1.78, 0.11, 0.12], [centerX, 1.75, facadeZ + 0.14], P.timber);
  addBox(buckets, 'warm', [1.26, 0.3, 0.035], [centerX, 2.17, facadeZ + 0.055], P.warm);
  for (const x of [centerX - 0.46, centerX + 0.46]) {
    addBox(buckets, 'timber', [0.055, 0.72, 0.1], [x, 2.18, facadeZ + 0.13], P.timber);
  }
  addLantern(buckets, [centerX + 0.52, 2.16, facadeZ + 0.19], 0.42);
  addBox(buckets, 'metal', [0.3, 0.14, 0.12], [centerX - 0.48, 1.91, facadeZ + 0.2], P.gold);
  addBox(
    buckets,
    'plaster',
    [0.22, 0.2, 0.12],
    [centerX - 0.15, 1.94, facadeZ + 0.2],
    P.plasterLight,
  );

  addGeometry(buckets, 'roof', makeOpenPitchedRoof(2.18, 0.84, 3.03, 3.42, 'x'), P.roof, {
    position: [centerX, 0, facadeZ + 0.12],
  });
  addBox(buckets, 'timber', [2.26, 0.14, 0.15], [centerX, 3.03, facadeZ + 0.53], P.timberDark);
  addBox(buckets, 'timber', [2.24, 0.13, 0.13], [centerX, 3.38, facadeZ + 0.12], P.timberDeep);
  addTimberBracket(buckets, centerX - 0.91, 3.0, facadeZ + 0.35, 1);
  addTimberBracket(buckets, centerX + 0.91, 3.0, facadeZ + 0.35, -1);
}

function addBankVaultAlcove(buckets, centerX, facadeZ) {
  addBox(buckets, 'timber', [1.16, 0.96, 0.08], [centerX, 1.4, facadeZ], P.timberDeep);
  addBox(buckets, 'metal', [0.92, 0.58, 0.06], [centerX, 1.43, facadeZ + 0.07], P.iron);
  addBox(buckets, 'metal', [0.68, 0.08, 0.1], [centerX, 1.43, facadeZ + 0.12], P.gold);
  addBox(buckets, 'metal', [0.08, 0.48, 0.1], [centerX, 1.43, facadeZ + 0.12], P.gold);
  addOctahedron(
    buckets,
    'metal',
    0.09,
    [centerX, 1.43, facadeZ + 0.18],
    P.goldLight,
    [0.85, 1.1, 0.45],
  );
  addBox(buckets, 'stone', [1.42, 0.18, 0.58], [centerX, 0.59, facadeZ + 0.27], P.stone);
  addGeometry(buckets, 'roof', makeOpenPitchedRoof(1.4, 0.82, 2.62, 3.02, 'x'), P.roofDeep, {
    position: [centerX, 0, facadeZ + 0.18],
  });
  // One pier only, deliberately not a mirrored pair: the alcove sits at the
  // teller bay's edge, so a mirror pier at centerX - 0.6 would land inside
  // the teller bay itself.
  addBox(buckets, 'timber', [0.16, 1.92, 0.17], [centerX + 0.6, 1.66, facadeZ + 0.4], P.timberDark);
  addBox(buckets, 'stone', [0.3, 0.36, 0.31], [centerX + 0.6, 0.68, facadeZ + 0.4], P.stoneLight);
  addBox(buckets, 'timber', [1.52, 0.14, 0.14], [centerX, 2.62, facadeZ + 0.58], P.timberDark);
}

function addBanner(buckets, x, y, z, showCoin = false) {
  addBox(buckets, 'metal', [0.08, 0.08, 0.7], [x, y + 0.55, z], P.gold);
  const flagCenterZ = z + 0.28;
  const flagDepth = 0.06;
  addBox(buckets, 'roof', [0.52, 0.88, flagDepth], [x, y, flagCenterZ], P.roof);
  if (showCoin) {
    const coinSurfaceOffset = flagDepth / 2 + 0.002;
    for (const side of [-1, 1]) {
      addGeometry(buckets, 'metal', new THREE.CircleGeometry(0.13, 12), P.goldLight, {
        position: [x, y, flagCenterZ + side * coinSurfaceOffset],
        rotation: side > 0 ? [0, 0, 0] : [0, Math.PI, 0],
      });
    }
  }
  addOctahedron(buckets, 'metal', 0.09, [x, y + 0.55, z + 0.38], P.goldLight, [1, 0.75, 0.5]);
}

export function buildBank(buckets) {
  const entranceX = -1.48;
  const tellerX = 0.72;
  const hallCenterZ = -0.16;
  const facadeZ = 2.08;
  const eaveY = 4.52;
  const roofPeakY = 7.68;
  const mainRoofWidth = 6.7;
  const mainRoofSurfaceWidth = 6.5;
  const mainRoofDepth = 5.18;
  const mainRoofCenterZ = -0.08;
  const mainRoofBargeboardX = 3.19;
  const mainRoofBargeboardDepth = 0.28;
  const mainRoofBargeboardSurfaceOffset = 0.03;
  const rearGableZ = -2.34;
  const frontGableZ = 2.02;
  const sideGableBaseY = 4.5;
  const sideGableRoofClearance = 0.025;
  const roofHalfDepth = mainRoofDepth / 2;
  const roofRise = roofPeakY - eaveY;
  const sideGableRearShoulderY =
    eaveY + roofRise * (1 - Math.abs(rearGableZ - mainRoofCenterZ) / roofHalfDepth);
  const sideGableFrontShoulderY =
    eaveY + roofRise * (1 - Math.abs(frontGableZ - mainRoofCenterZ) / roofHalfDepth);

  addBox(buckets, 'stone', [7, 0.18, 5.5], [0, 0.09, 0], P.stoneDeep);
  addBox(buckets, 'stone', [6.7, 0.32, 5.18], [0, 0.34, -0.03], P.stoneLight);
  addBox(buckets, 'plaster', [6.05, 4.04, 4.45], [0, 2.5, hallCenterZ], P.plasterLight);
  addBox(buckets, 'stone', [6.15, 0.87, 4.55], [0, 0.915, hallCenterZ], P.stone);

  addGeometry(
    buckets,
    'roof',
    makeOpenPitchedRoof(mainRoofSurfaceWidth, mainRoofDepth, eaveY, roofPeakY, 'x'),
    P.roof,
    {
      position: [0, 0, mainRoofCenterZ],
    },
  );
  addBankMainRoofBargeboards(buckets, {
    xOffset: mainRoofBargeboardX,
    boardDepth: mainRoofBargeboardDepth,
    roofDepth: mainRoofDepth,
    eaveY,
    peakY: roofPeakY,
    centerZ: mainRoofCenterZ,
    surfaceOffset: mainRoofBargeboardSurfaceOffset,
  });
  addRoofTrim(buckets, {
    width: mainRoofWidth,
    depth: mainRoofDepth,
    wallHeight: eaveY,
    peakY: roofPeakY,
    ridgeAxis: 'x',
    centerZ: mainRoofCenterZ,
  });
  addBankMainRoofCourses(buckets, 5.2, mainRoofDepth, eaveY, roofPeakY, mainRoofCenterZ);
  addBox(buckets, 'timber', [6.84, 0.18, 0.18], [0, 7.7, mainRoofCenterZ], P.timberDeep);
  for (const x of [-3.38, 3.38]) {
    addBox(buckets, 'metal', [0.22, 0.2, 0.22], [x, 7.7, mainRoofCenterZ], P.gold);
  }

  for (const side of [-1, 1]) {
    addGeometry(
      buckets,
      'plaster',
      makeBankSideGablePanel({
        rearRun: mainRoofCenterZ - rearGableZ,
        frontRun: frontGableZ - mainRoofCenterZ,
        peakRise: roofPeakY - sideGableBaseY - sideGableRoofClearance,
        rearShoulderRise: sideGableRearShoulderY - sideGableBaseY - sideGableRoofClearance,
        frontShoulderRise: sideGableFrontShoulderY - sideGableBaseY - sideGableRoofClearance,
        depth: 0.1,
      }),
      P.plaster,
      {
        position: [side * 3, sideGableBaseY, mainRoofCenterZ],
        rotation: [0, Math.PI / 2, 0],
      },
    );
    addBankSideGableFrame(buckets, {
      x: side * 3.14,
      rearZ: rearGableZ,
      ridgeZ: mainRoofCenterZ,
      frontZ: frontGableZ,
      eaveY,
      rearShoulderY: sideGableRearShoulderY,
      peakY: roofPeakY,
      frontShoulderY: sideGableFrontShoulderY,
    });
  }

  for (const x of [-2.95, 2.95]) {
    for (const z of [rearGableZ, frontGableZ]) {
      addBox(buckets, 'timber', [0.23, 4.05, 0.23], [x, 2.47, z], P.timberDark);
      addBox(buckets, 'stone', [0.48, 1.04, 0.48], [x, 0.87, z], P.stoneLight);
      addGoldPostCaps(buckets, [[x, 4.58, z, 0.2]]);
    }
  }
  addBox(buckets, 'timber', [6.22, 0.22, 0.24], [0, 4.42, 2.04], P.timberDark);
  addBox(buckets, 'timber', [6.22, 0.22, 0.24], [0, 4.42, -2.36], P.timber);
  addBox(buckets, 'timber', [0.23, 0.22, 4.5], [-3.01, 4.42, hallCenterZ], P.timberDark);
  addBox(buckets, 'timber', [0.23, 0.22, 4.5], [3.01, 4.42, hallCenterZ], P.timber);
  addBankMasonryCourses(buckets, 2.13);

  addArchedDoor(buckets, {
    center: [entranceX, 1.76, facadeZ + 0.04],
    width: 1.48,
    height: 2.58,
    frameBucket: 'stone',
    frameColor: P.stoneLight,
  });
  addBankVoussoirs(buckets, entranceX, facadeZ + 0.2);
  addOctahedron(
    buckets,
    'metal',
    0.065,
    [entranceX - 0.18, 1.52, facadeZ + 0.26],
    P.goldLight,
    [0.7, 1, 0.35],
  );
  addOctahedron(
    buckets,
    'metal',
    0.065,
    [entranceX + 0.18, 1.52, facadeZ + 0.26],
    P.goldLight,
    [0.7, 1, 0.35],
  );

  addArchedWindow(buckets, {
    face: 'back',
    center: [-1.65, 2.02, -2.43],
    width: 0.82,
    height: 1.36,
    frameBucket: 'stone',
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [1.65, 2.02, -2.43],
    width: 0.82,
    height: 1.36,
    frameBucket: 'stone',
  });
  for (const side of [-1, 1]) {
    addArchedWindow(buckets, {
      face: side < 0 ? 'left' : 'right',
      center: [side * 3.08, 2.02, hallCenterZ],
      width: 0.88,
      height: 1.42,
      frameBucket: 'stone',
    });
  }

  addBox(buckets, 'timber', [1.06, 2.24, 0.09], [0, 1.59, -2.44], P.timberDeep);
  addBox(buckets, 'timber', [1.28, 0.18, 0.15], [0, 2.78, -2.49], P.timberDark);
  for (const x of [-0.57, 0.57]) {
    addBox(buckets, 'timber', [0.16, 2.34, 0.15], [x, 1.65, -2.49], P.timberDark);
  }
  for (const x of [-0.28, 0, 0.28]) {
    addBox(buckets, 'timber', [0.045, 1.72, 0.07], [x, 1.6, -2.51], P.timber);
  }
  for (const y of [1.0, 2.08]) {
    addBox(buckets, 'metal', [0.22, 0.08, 0.07], [-0.39, y, -2.54], P.gold);
  }
  addOctahedron(buckets, 'metal', 0.07, [0.26, 1.62, -2.55], P.gold, [0.7, 1, 0.35]);

  addGeometry(buckets, 'roof', makeOpenPitchedRoof(2.7, 1.38, 3.6, 4.85, 'z'), P.roofLight, {
    position: [entranceX, 0, 2.05],
  });
  addRoofTrim(buckets, {
    width: 2.7,
    depth: 1.38,
    wallHeight: 3.6,
    peakY: 4.85,
    ridgeAxis: 'z',
    centerX: entranceX,
    centerZ: 2.05,
  });
  addRoofCourses(buckets, {
    width: 2.7,
    depth: 1.38,
    wallHeight: 3.6,
    peakY: 4.85,
    ridgeAxis: 'z',
    centerX: entranceX,
    centerZ: 2.05,
  });
  addGeometry(buckets, 'plaster', makeBankGablePanel(2.42, 1.08, 0.1), P.plaster, {
    position: [entranceX, 3.58, 2.62],
  });
  addBankFrontGableFrame(buckets, entranceX, 2.48, 3.58, 4.76, 2.68);
  for (const x of [-2.55, -0.41]) {
    addBox(buckets, 'timber', [0.24, 3.14, 0.24], [x, 2.04, 2.46], P.timberDark);
    addBox(buckets, 'stone', [0.44, 0.74, 0.44], [x, 0.87, 2.46], P.stoneLight);
    addGoldPostCaps(buckets, [[x, 3.64, 2.46, 0.19]]);
  }
  addBankEntranceSteps(buckets, entranceX);
  addLantern(buckets, [entranceX - 0.94, 2.1, 2.36], 0.7);
  addLantern(buckets, [entranceX + 0.94, 2.1, 2.36], 0.7);

  addBankTellerBay(buckets, tellerX, facadeZ);
  addBankVaultAlcove(buckets, 2.28, facadeZ);
  addBanner(buckets, -3.18, 3.12, 2.02, true);
}

function addAnvil(buckets, x, y, z) {
  addBox(buckets, 'metal', [0.82, 0.2, 0.32], [x, y + 0.76, z], P.ironLight);
  addBox(buckets, 'metal', [0.42, 0.54, 0.24], [x - 0.06, y + 0.44, z], P.iron);
  addBox(buckets, 'stone', [0.62, 0.18, 0.48], [x - 0.06, y + 0.09, z], P.stoneDeep);
  addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.2, 0.48, 6, 1, false), P.ironLight, {
    position: [x + 0.53, y + 0.76, z],
    rotation: [0, 0, -Math.PI / 2],
  });
}

function addToolRack(buckets, x, y, z) {
  addBox(buckets, 'timber', [1.25, 0.12, 0.12], [x, y + 0.78, z], P.timberDark);
  for (const [offset, length, color] of [
    [-0.44, 0.78, P.ironLight],
    [-0.15, 0.92, P.iron],
    [0.15, 0.7, P.ironLight],
    [0.43, 0.84, P.iron],
  ]) {
    addBox(buckets, 'metal', [0.07, length, 0.07], [x + offset, y + 0.36, z + 0.06], color);
    addBox(buckets, 'metal', [0.18, 0.13, 0.08], [x + offset, y + 0.02, z + 0.06], color, [
      0,
      0,
      offset * 0.3,
    ]);
  }
}

export function buildSmithy(buckets) {
  addFoundation(buckets, 6.8, 7.25, { height: 0.22 });
  addGableShell(buckets, {
    width: 4.5,
    depth: 6.2,
    wallHeight: 3.35,
    peakY: 5.18,
    ridgeAxis: 'x',
    centerX: -1.05,
    centerZ: -0.28,
    bodyColor: P.plaster,
  });
  const facadeZ = 2.55;
  addArchedDoor(buckets, {
    center: [-1.45, 1.45, facadeZ + 0.12],
    width: 1.25,
    height: 2.22,
    frameBucket: 'stone',
    frameColor: P.stoneLight,
  });
  addArchedWindow(buckets, {
    center: [-0.1, 1.72, facadeZ + 0.12],
    width: 0.66,
    height: 1.08,
    kind: 'pointed',
    frameBucket: 'timber',
  });
  addArchedWindow(buckets, {
    face: 'left',
    center: [-3.15, 1.68, -0.65],
    width: 0.68,
    height: 1.08,
    kind: 'pointed',
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [-1.05, 1.68, -3.32],
    width: 0.68,
    height: 1.08,
    kind: 'pointed',
  });
  addSteps(buckets, -1.45, 3.25, 1.8, 3, 1);

  addBox(buckets, 'stone', [0.86, 2.6, 0.82], [0.05, 4.08, -0.75], P.stone);
  addBox(buckets, 'stone', [1.02, 0.22, 0.98], [0.05, 5.24, -0.75], P.stoneLight);
  addBox(buckets, 'metal', [0.72, 0.22, 0.7], [0.05, 5.46, -0.75], P.soot);
  for (const y of [3.25, 3.78, 4.31]) {
    addBox(
      buckets,
      'stone',
      [0.9, 0.08, 0.86],
      [0.05, y, -0.75],
      y === 3.78 ? P.stoneLight : P.stoneDeep,
    );
  }

  addBox(buckets, 'roof', [2.95, 0.14, 4.25], [1.95, 3.23, 0.68], P.roofDeep, [0, 0, -0.18]);
  for (const x of [0.65, 3.15]) {
    for (const z of [-1.05, 2.35]) {
      addBox(buckets, 'timber', [0.2, 2.82, 0.2], [x, 1.58, z], P.timberDark);
      addBox(buckets, 'stone', [0.36, 0.28, 0.36], [x, 0.14, z], P.stoneLight);
    }
  }
  addBox(buckets, 'stone', [2.05, 1.08, 0.72], [1.72, 0.9, 1.25], P.stoneDeep);
  addGeometry(
    buckets,
    'stone',
    makeArchedFrame(1.42, 1.18, 1.02, 0.82, 0.2, 'pointed'),
    P.stoneLight,
    { position: [1.72, 1.04, 1.65] },
  );
  addGeometry(buckets, 'warm', makeArchedPanel(0.98, 0.78, 0.1, 'pointed'), P.warmBright, {
    position: [1.72, 1.04, 1.78],
  });
  addBox(buckets, 'metal', [1.0, 0.1, 0.55], [1.72, 1.46, 1.82], P.iron);
  addAnvil(buckets, 1.45, 0.31, 2.45);
  addBox(buckets, 'timber', [1.45, 0.18, 0.64], [2.62, 0.9, 2.15], P.timberLight);
  for (const x of [2.08, 3.16]) {
    addBox(buckets, 'timber', [0.15, 0.84, 0.15], [x, 0.49, 2.15], P.timberDark);
  }
  addToolRack(buckets, 2.56, 1.72, 0.08);

  addBarrel(buckets, [-0.2, 0.32, 3.0], 0.82);
  addBox(buckets, 'timber', [1.52, 1.02, 0.62], [1.85, 0.72, -3.42], P.timberDeep);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5 - row; col++) {
      addCylinder(
        buckets,
        'timber',
        0.12,
        0.12,
        0.6,
        8,
        [1.35 + col * 0.25 + row * 0.12, 0.38 + row * 0.22, -3.76],
        row % 2 === 0 ? P.timberLight : P.timber,
        [Math.PI / 2, 0, 0],
      );
    }
  }
}

function addDormer(buckets, x, z, baseY) {
  addBox(buckets, 'plaster', [1.35, 0.94, 0.82], [x, baseY + 0.42, z], P.plasterLight);
  addGeometry(
    buckets,
    'roof',
    makePitchedRoof(1.72, 1.08, baseY + 0.82, baseY + 1.54, 'z'),
    P.roofLight,
    { position: [x, 0, z + 0.05] },
  );
  addArchedWindow(buckets, {
    center: [x, baseY + 0.42, z + 0.47],
    width: 0.66,
    height: 0.82,
    frameBucket: 'timber',
  });
}

function addInnServiceTable(buckets, x, z) {
  addBox(buckets, 'timber', [1.45, 0.16, 0.64], [x, 0.92, z], P.timberLight);
  addBox(buckets, 'timber', [1.35, 0.75, 0.1], [x, 0.48, z - 0.25], P.timberDark);
  for (const dx of [-0.56, 0.56]) {
    addBox(buckets, 'timber', [0.14, 0.86, 0.14], [x + dx, 0.48, z], P.timberDeep);
  }
  addCylinder(buckets, 'metal', 0.14, 0.2, 0.22, 8, [x - 0.34, 1.11, z], P.ironLight);
  addCylinder(buckets, 'plaster', 0.11, 0.15, 0.18, 8, [x + 0.05, 1.08, z], P.plasterLight);
  addCrate(buckets, [x + 0.82, 0.32, z], [0.55, 0.5, 0.52]);
}

export function buildInn(buckets) {
  addFoundation(buckets, 7.3, 8.18, { height: 0.25 });
  addGableShell(buckets, {
    width: 7.0,
    depth: 7.45,
    wallHeight: 3.7,
    peakY: 5.82,
    ridgeAxis: 'x',
    centerZ: -0.2,
    bodyColor: P.plaster,
  });
  addBox(buckets, 'stone', [6.75, 1.55, 7.02], [0, 1.15, -0.2], P.stone);
  addBox(buckets, 'timber', [6.82, 0.2, 7.04], [0, 2.02, -0.2], P.timberDark);
  for (const x of [-3.2, -1.62, 0, 1.62, 3.2]) {
    addBox(buckets, 'timber', [0.16, 1.6, 0.18], [x, 2.88, 3.23], P.timberDark);
    addBox(buckets, 'timber', [0.16, 1.6, 0.18], [x, 2.88, -3.63], P.timber);
  }

  const frontZ = 3.32;
  addArchedDoor(buckets, {
    center: [0, 1.52, frontZ + 0.08],
    width: 1.5,
    height: 2.42,
    frameBucket: 'stone',
    frameColor: P.stoneDeep,
  });
  for (const x of [-2.15, 2.15]) {
    addArchedWindow(buckets, {
      center: [x, 1.65, frontZ + 0.08],
      width: 0.78,
      height: 1.16,
      kind: 'pointed',
      frameBucket: 'stone',
    });
  }
  for (const x of [-2.15, 0, 2.15]) {
    addArchedWindow(buckets, {
      face: 'back',
      center: [x, 1.65, -3.72],
      width: 0.7,
      height: 1.08,
      kind: 'pointed',
      frameBucket: 'stone',
    });
  }
  for (const face of ['left', 'right']) {
    for (const z of [-1.35, 1.35]) {
      addArchedWindow(buckets, {
        face,
        center: [face === 'left' ? -3.22 : 3.22, 1.65, z],
        width: 0.72,
        height: 1.1,
        kind: 'pointed',
        frameBucket: 'stone',
      });
    }
  }

  addBox(buckets, 'roof', [6.25, 0.14, 1.78], [0, 3.22, 3.78], P.roofDeep, [-0.12, 0, 0]);
  for (const x of [-2.75, -1.35, 1.35, 2.75]) {
    addBox(buckets, 'timber', [0.2, 2.45, 0.2], [x, 1.55, 3.68], P.timberDark);
    addBox(buckets, 'stone', [0.42, 0.36, 0.42], [x, 0.2, 3.68], P.stoneLight);
    addGoldPostCaps(buckets, [[x, 2.72, 3.68, 0.18]]);
  }
  addSteps(buckets, 0, 4.12, 2.75, 4, 1);
  addLantern(buckets, [-1.08, 2.12, 3.76], 0.72);
  addLantern(buckets, [1.08, 2.12, 3.76], 0.72);
  addBanner(buckets, 0, 2.65, 4.03);

  addDormer(buckets, 0, 3.48, 4.05);
  addBox(buckets, 'stone', [0.78, 1.38, 0.72], [2.45, 5.05, -0.8], P.stone);
  addGeometry(
    buckets,
    'metal',
    new THREE.CylinderGeometry(0.52, 0.34, 0.7, 4, 1, false),
    P.ironLight,
    { position: [2.45, 5.86, -0.8], rotation: [0, Math.PI / 4, 0] },
  );
  addBox(buckets, 'metal', [0.78, 0.1, 0.78], [2.45, 5.5, -0.8], P.soot);

  addInnServiceTable(buckets, -2.35, 3.82);
  addBarrel(buckets, [-3.15, 0.34, -2.68], 0.92);
  addBarrel(buckets, [-2.55, 0.34, -3.15], 0.85);
  addSack(buckets, [2.75, 0.28, -3.35], P.clothCream, 0.9);
  addSack(buckets, [3.15, 0.26, -3.1], P.sackOchre, 0.8);
  addCrate(buckets, [2.3, 0.32, -3.25], [0.58, 0.52, 0.54]);

  addRoofTrim(buckets, {
    width: 7.15,
    depth: 7.62,
    wallHeight: 3.72,
    peakY: 5.9,
    ridgeAxis: 'x',
  });
  addRoofCourses(buckets, {
    width: 7.05,
    depth: 7.52,
    wallHeight: 3.72,
    peakY: 5.88,
    ridgeAxis: 'x',
  });
}
