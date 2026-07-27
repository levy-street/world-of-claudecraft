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
  addGableFrame,
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

function addBankChest(buckets, x, y, z) {
  addBox(buckets, 'timber', [1.05, 0.48, 0.62], [x, y + 0.24, z], P.timberDeep);
  addGeometry(
    buckets,
    'roof',
    new THREE.CylinderGeometry(0.32, 0.32, 1.05, 8, 1, false, 0, Math.PI),
    P.roof,
    { position: [x, y + 0.52, z], rotation: [0, 0, Math.PI / 2] },
  );
  for (const offset of [-0.43, 0, 0.43]) {
    addBox(buckets, 'metal', [0.08, 0.78, 0.68], [x + offset, y + 0.4, z], P.gold);
  }
  addOctahedron(buckets, 'metal', 0.09, [x, y + 0.39, z + 0.36], P.goldLight, [0.8, 1.2, 0.35]);
}

function addBanner(buckets, x, y, z) {
  addBox(buckets, 'metal', [0.08, 0.08, 0.7], [x, y + 0.55, z], P.gold);
  addBox(buckets, 'roof', [0.52, 0.88, 0.06], [x, y, z + 0.28], P.roof);
  addOctahedron(buckets, 'metal', 0.09, [x, y + 0.55, z + 0.38], P.goldLight, [1, 0.75, 0.5]);
}

export function buildBank(buckets) {
  addFoundation(buckets, 6.8, 7.35, { height: 0.24 });
  addGableShell(buckets, {
    width: 6.4,
    depth: 6.1,
    wallHeight: 3.45,
    peakY: 5.28,
    ridgeAxis: 'x',
    centerZ: -0.25,
    bodyColor: P.plasterLight,
  });

  const facadeZ = 2.48;
  addArchedDoor(buckets, {
    center: [-1.62, 1.47, facadeZ + 0.08],
    width: 1.42,
    height: 2.35,
    frameBucket: 'stone',
    frameColor: P.stoneLight,
  });
  addArchedWindow(buckets, {
    center: [0.15, 1.75, facadeZ + 0.08],
    width: 0.78,
    height: 1.24,
    frameBucket: 'stone',
    frameColor: P.stone,
  });
  addArchedWindow(buckets, {
    center: [1.25, 1.75, facadeZ + 0.08],
    width: 0.78,
    height: 1.24,
    frameBucket: 'stone',
    frameColor: P.stone,
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [-1.35, 1.7, -3.38],
    width: 0.72,
    height: 1.2,
    frameBucket: 'stone',
  });
  addArchedWindow(buckets, {
    face: 'back',
    center: [1.35, 1.7, -3.38],
    width: 0.72,
    height: 1.2,
    frameBucket: 'stone',
  });
  addArchedWindow(buckets, {
    face: 'left',
    center: [-2.94, 1.76, -0.65],
    width: 0.75,
    height: 1.22,
    frameBucket: 'stone',
  });

  addGeometry(buckets, 'plaster', makeArchedPanel(2.05, 2.85, 0.42, 'pointed'), P.plaster, {
    position: [-1.62, 1.82, 2.7],
  });
  addGeometry(buckets, 'roof', makePitchedRoof(2.85, 2.0, 3.18, 4.24, 'z'), P.roofLight, {
    position: [-1.62, 0, 2.75],
  });
  addGableFrame(buckets, {
    width: 2.72,
    wallHeight: 3.18,
    peakY: 4.24,
    z: 3.72,
    beam: 0.14,
  });
  for (const x of [-2.8, -0.44]) {
    addBox(buckets, 'timber', [0.24, 2.65, 0.25], [x, 1.66, 3.2], P.timberDark);
    addBox(buckets, 'stone', [0.43, 0.38, 0.45], [x, 0.25, 3.2], P.stoneLight);
  }
  addSteps(buckets, -1.62, 3.65, 2.35, 3, 1);
  addLantern(buckets, [-2.52, 1.85, 3.58], 0.72);
  addLantern(buckets, [-0.72, 1.85, 3.58], 0.72);

  addBox(buckets, 'timber', [2.36, 0.18, 0.22], [1.05, 2.48, 3.0], P.timberDark);
  addBox(buckets, 'roof', [2.5, 0.12, 1.28], [1.05, 2.68, 3.42], P.roof, [-0.18, 0, 0]);
  for (const x of [0.05, 2.05]) {
    addBox(buckets, 'timber', [0.16, 1.6, 0.16], [x, 1.48, 3.32], P.timber);
    addTimberBracket(buckets, x, 2.42, 3.38, x < 1 ? 1 : -1);
  }
  addBox(buckets, 'timber', [2.1, 0.13, 0.48], [1.05, 1.02, 3.05], P.timberLight);
  addBox(buckets, 'timber', [2.0, 0.08, 0.08], [1.05, 1.32, 3.36], P.timberDark);
  addBox(buckets, 'warm', [1.7, 0.58, 0.06], [1.05, 1.73, 3.39], P.warm);
  for (const x of [0.48, 1.05, 1.62]) {
    addBox(buckets, 'timber', [0.055, 0.72, 0.08], [x, 1.73, 3.44], P.timberDark);
  }

  addBox(buckets, 'roof', [1.72, 0.12, 2.0], [2.35, 2.42, 1.55], P.roofDeep, [-0.2, 0, 0]);
  for (const z of [0.75, 2.25]) {
    addBox(buckets, 'timber', [0.18, 2.05, 0.18], [2.92, 1.25, z], P.timberDark);
    addBox(buckets, 'stone', [0.32, 0.24, 0.32], [2.92, 0.12, z], P.stoneDeep);
  }
  addBankChest(buckets, 2.18, 0.35, 1.55);

  addBanner(buckets, -3.15, 2.55, 2.8);
  addGoldPostCaps(buckets, [
    [-2.98, 3.42, 2.48],
    [2.98, 3.42, 2.48],
    [-2.98, 3.42, -3.0],
    [2.98, 3.42, -3.0],
  ]);
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
