import {
  addArchedDoor,
  addArchedWindow,
  addBarrel,
  addBox,
  addCrate,
  addCrystal,
  addCylinder,
  addFoundation,
  addGableFrame,
  addGableShell,
  addGeometry,
  addLantern,
  addOctahedron,
  addSphere,
  addSteps,
  makeArchedPanel,
  TOWN_PALETTE as P,
} from './shared.js';

function addButtress(buckets, x, z, height = 2.55) {
  addBox(buckets, 'stone', [0.38, height, 0.46], [x, height / 2, z], P.stone);
  addBox(buckets, 'stone', [0.56, 0.36, 0.64], [x, 0.18, z], P.stoneLight);
  addBox(buckets, 'stone', [0.46, 0.24, 0.54], [x, height - 0.12, z], P.stoneDeep);
}

function addFlowerBox(buckets, x, y, z, face = 'front') {
  const side = face === 'front' || face === 'back';
  addBox(
    buckets,
    'timber',
    side ? [1.05, 0.28, 0.35] : [0.35, 0.28, 1.05],
    [x, y, z],
    P.timberDark,
  );
  for (const offset of [-0.34, 0, 0.34]) {
    const px = side ? x + offset : x;
    const pz = side ? z : z + offset;
    addCylinder(buckets, 'plaster', 0.035, 0.045, 0.22, 6, [px, y + 0.24, pz], P.sackGreen);
    addSphere(
      buckets,
      'plaster',
      0.09,
      [px, y + 0.39, pz],
      offset === 0 ? P.clothCream : offset < 0 ? P.roofLight : P.warm,
      [1, 0.62, 1],
    );
  }
}

export function buildChapel(buckets) {
  addFoundation(buckets, 5.35, 6.75, { height: 0.25 });
  addGableShell(buckets, {
    width: 5.05,
    depth: 6.25,
    wallHeight: 3.65,
    peakY: 5.42,
    ridgeAxis: 'z',
    centerZ: -0.08,
    bodyColor: P.plasterLight,
  });
  addGableFrame(buckets, {
    width: 4.82,
    wallHeight: 3.62,
    peakY: 5.38,
    z: 3.08,
    beam: 0.14,
  });
  addGableFrame(buckets, {
    width: 4.82,
    wallHeight: 3.62,
    peakY: 5.38,
    z: -3.24,
    beam: 0.14,
    color: P.timber,
  });
  addArchedDoor(buckets, {
    center: [0, 1.55, 3.05],
    width: 1.55,
    height: 2.5,
    kind: 'pointed',
    frameBucket: 'stone',
    frameColor: P.stoneLight,
  });
  for (const x of [-1.55, 1.55]) {
    addArchedWindow(buckets, {
      center: [x, 1.85, 3.08],
      width: 0.72,
      height: 1.4,
      kind: 'pointed',
      frameBucket: 'timber',
    });
    addFlowerBox(buckets, x, 1.06, 3.28);
  }
  for (const face of ['left', 'right']) {
    for (const z of [-1.85, 0, 1.85]) {
      addArchedWindow(buckets, {
        face,
        center: [face === 'left' ? -2.34 : 2.34, 1.86, z - 0.08],
        width: 0.68,
        height: 1.42,
        kind: 'pointed',
        frameBucket: 'timber',
      });
    }
  }
  addArchedWindow(buckets, {
    face: 'back',
    center: [0, 2.3, -3.24],
    width: 0.78,
    height: 1.32,
    kind: 'pointed',
    frameBucket: 'timber',
  });
  addGeometry(buckets, 'timber', makeArchedPanel(1.04, 1.68, 0.08, 'pointed'), P.timberDeep, {
    position: [0, 1.15, -3.29],
    rotation: [0, Math.PI, 0],
  });
  addSteps(buckets, 0, 3.55, 2.42, 3, 1);
  addSteps(buckets, 0, -3.55, 1.48, 2, -1);
  addLantern(buckets, [-1.1, 2.02, 3.34], 0.65);
  addLantern(buckets, [1.1, 2.02, 3.34], 0.65);

  for (const x of [-2.42, 2.42]) {
    for (const z of [-2.65, -0.88, 0.88, 2.65]) addButtress(buckets, x, z, 2.42);
  }
  addBox(buckets, 'roof', [0.48, 0.22, 0.48], [0, 5.48, 0], P.roofDeep);
  addCrystal(buckets, [0, 5.58, 0], 0.62);
  addOctahedron(buckets, 'metal', 0.18, [0, 3.95, 3.25], P.roofLight, [1.1, 1.35, 0.28]);
}

function addFabricRoll(buckets, position, color, scale = 1) {
  const [x, y, z] = position;
  addCylinder(buckets, 'roof', 0.23 * scale, 0.23 * scale, 0.62 * scale, 10, [x, y, z], color, [
    0,
    0,
    Math.PI / 2,
  ]);
  addCylinder(
    buckets,
    'timber',
    0.08 * scale,
    0.08 * scale,
    0.66 * scale,
    8,
    [x, y, z],
    P.timberDark,
    [0, 0, Math.PI / 2],
  );
}

function addLoom(buckets, center) {
  const [x, y, z] = center;
  for (const dx of [-0.68, 0.68]) {
    addBox(buckets, 'timber', [0.16, 1.72, 0.2], [x + dx, y + 0.86, z], P.timberDark);
  }
  for (const dy of [0.26, 0.86, 1.58]) {
    addBox(buckets, 'timber', [1.48, 0.13, 0.2], [x, y + dy, z], P.timber);
  }
  for (let index = 0; index < 7; index++) {
    const px = x - 0.54 + index * 0.18;
    addBox(
      buckets,
      'roof',
      [0.12, 0.76, 0.045],
      [px, y + 1.07, z + 0.13],
      index % 3 === 0 ? P.clothBlue : index % 3 === 1 ? P.clothCream : P.clothRed,
    );
  }
  addCylinder(buckets, 'timber', 0.1, 0.1, 1.3, 8, [x, y + 1.47, z + 0.19], P.timberLight, [
    0,
    0,
    Math.PI / 2,
  ]);
  addBox(buckets, 'timber', [1.2, 0.14, 0.52], [x, y + 0.1, z + 0.25], P.timberLight);
}

export function buildWeavingWorkshop(buckets) {
  addFoundation(buckets, 5.35, 5.62, { height: 0.22 });
  addGableShell(buckets, {
    width: 5.12,
    depth: 5.2,
    wallHeight: 2.95,
    peakY: 4.34,
    ridgeAxis: 'x',
    centerZ: -0.1,
    bodyColor: P.plaster,
  });
  const frontZ = 2.38;
  addArchedDoor(buckets, {
    center: [-1.3, 1.34, frontZ + 0.1],
    width: 1.02,
    height: 2.0,
    frameBucket: 'stone',
  });
  addArchedWindow(buckets, {
    center: [-2.0, 1.55, frontZ + 0.1],
    width: 0.68,
    height: 1.02,
    frameBucket: 'timber',
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [-1.2, 1.55, -2.58],
    width: 0.7,
    height: 1.02,
    frameBucket: 'timber',
  });
  addArchedDoor(buckets, {
    face: 'back',
    center: [1.15, 1.32, -2.58],
    width: 0.98,
    height: 1.94,
    frameBucket: 'timber',
    frameColor: P.timberDark,
  });
  addArchedWindow(buckets, {
    face: 'left',
    center: [-2.38, 1.55, -0.25],
    width: 0.7,
    height: 1.02,
    frameBucket: 'timber',
  });
  addArchedWindow(buckets, {
    face: 'right',
    center: [2.38, 1.55, -0.25],
    width: 0.7,
    height: 1.02,
    frameBucket: 'timber',
  });
  addSteps(buckets, -1.3, 2.88, 1.45, 2, 1);

  addBox(buckets, 'timber', [2.12, 0.16, 0.16], [1.15, 2.58, 2.58], P.timberDark);
  for (const x of [0.22, 2.08]) {
    addBox(buckets, 'timber', [0.18, 2.34, 0.18], [x, 1.35, 2.55], P.timberDark);
    addBox(buckets, 'stone', [0.32, 0.28, 0.32], [x, 0.14, 2.55], P.stoneLight);
  }
  addBox(buckets, 'roof', [2.28, 0.12, 1.15], [1.15, 2.82, 2.93], P.roofDeep, [-0.14, 0, 0]);
  addLoom(buckets, [1.15, 0.32, 2.48]);
  addFabricRoll(buckets, [-0.02, 0.62, 2.8], P.clothBlue, 0.86);
  addFabricRoll(buckets, [-0.02, 1.0, 2.8], P.clothCream, 0.86);
  addFabricRoll(buckets, [-0.02, 1.38, 2.8], P.clothRed, 0.86);
  addBarrel(buckets, [2.32, 0.34, 2.55], 0.86);
  addLantern(buckets, [-0.62, 1.9, 2.7], 0.58);
}

function addToolDisplay(buckets, center, faceZ) {
  const [x, y] = center;
  addBox(buckets, 'timber', [2.15, 0.16, 0.55], [x, y + 0.78, faceZ], P.timberLight);
  for (const dx of [-0.86, 0.86]) {
    addBox(buckets, 'timber', [0.14, 0.88, 0.14], [x + dx, y + 0.38, faceZ], P.timberDark);
  }
  addBox(buckets, 'timber', [2.02, 1.18, 0.12], [x, y + 1.58, faceZ - 0.18], P.timberDeep);
  const tools = [
    { dx: -0.72, length: 0.78, blade: [0.2, 0.17, 0.07], angle: -0.04 },
    { dx: -0.26, length: 0.9, blade: [0.1, 0.3, 0.07], angle: 0.08 },
    { dx: 0.22, length: 0.72, blade: [0.24, 0.12, 0.07], angle: -0.08 },
    { dx: 0.7, length: 0.82, blade: [0.12, 0.24, 0.07], angle: 0.12 },
  ];
  for (const tool of tools) {
    addBox(
      buckets,
      'timber',
      [0.06, tool.length, 0.06],
      [x + tool.dx, y + 1.55, faceZ + 0.02],
      P.timberLight,
      [0, 0, tool.angle],
    );
    addBox(buckets, 'metal', tool.blade, [x + tool.dx, y + 1.93, faceZ + 0.04], P.ironLight, [
      0,
      0,
      tool.angle,
    ]);
  }
}

export function buildToolworks(buckets) {
  addFoundation(buckets, 5.35, 5.62, { height: 0.22 });
  addGableShell(buckets, {
    width: 5.12,
    depth: 5.2,
    wallHeight: 2.92,
    peakY: 4.34,
    ridgeAxis: 'x',
    centerZ: -0.1,
    bodyColor: P.plaster,
  });
  const frontZ = 2.38;
  addArchedDoor(buckets, {
    center: [0.72, 1.34, frontZ + 0.1],
    width: 1.06,
    height: 1.98,
    frameBucket: 'timber',
    frameColor: P.timberDeep,
  });
  addArchedWindow(buckets, {
    center: [1.85, 1.52, frontZ + 0.1],
    width: 0.7,
    height: 1.02,
    frameBucket: 'timber',
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [-1.45, 1.54, -2.58],
    width: 0.68,
    height: 1.02,
    frameBucket: 'timber',
  });
  addArchedDoor(buckets, {
    face: 'back',
    center: [0.8, 1.3, -2.58],
    width: 1.0,
    height: 1.92,
    frameBucket: 'timber',
  });
  for (const face of ['left', 'right']) {
    addArchedWindow(buckets, {
      face,
      center: [face === 'left' ? -2.38 : 2.38, 1.54, -0.32],
      width: 0.68,
      height: 1.02,
      frameBucket: 'timber',
    });
  }
  addSteps(buckets, 0.72, 2.86, 1.55, 2, 1);

  addBox(buckets, 'roof', [2.65, 0.12, 2.8], [-1.35, 2.62, 1.48], P.roofDeep, [-0.12, 0, 0]);
  for (const x of [-2.38, -0.28]) {
    for (const z of [0.5, 2.48]) {
      addBox(buckets, 'timber', [0.18, 2.36, 0.18], [x, 1.34, z], P.timberDark);
      addBox(buckets, 'stone', [0.32, 0.28, 0.32], [x, 0.14, z], P.stoneLight);
    }
  }
  addToolDisplay(buckets, [-1.32, 0.24], 2.48);
  addCrate(buckets, [1.92, 0.32, 2.76], [0.58, 0.55, 0.55]);
  addBarrel(buckets, [2.42, 0.33, 2.45], 0.84);
  addCrate(buckets, [-1.55, 0.3, -2.74], [0.64, 0.54, 0.62]);
  addBox(buckets, 'timber', [1.25, 0.15, 0.56], [-1.28, 0.92, -2.78], P.timberLight);
  for (const x of [-1.74, -0.82]) {
    addBox(buckets, 'timber', [0.14, 0.85, 0.14], [x, 0.48, -2.78], P.timberDeep);
  }
  addLantern(buckets, [0.02, 1.9, 2.7], 0.58);
}
