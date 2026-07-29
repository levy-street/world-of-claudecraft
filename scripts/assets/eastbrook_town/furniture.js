import * as THREE from 'three';
import {
  addBarrel,
  addBox,
  addCrate,
  addCrystal,
  addCylinder,
  addFoundation,
  addGeometry,
  addLantern,
  addOctahedron,
  addSack,
  addTorus,
  TOWN_PALETTE as P,
} from './shared.js';

export function buildCivicWellBeacon(buckets) {
  addCylinder(buckets, 'stone', 1.18, 1.34, 0.3, 12, [0, 0.15, 0], P.stoneDeep);
  addTorus(buckets, 'stone', 0.92, 0.28, [0, 0.56, 0], P.stone, [Math.PI / 2, 0, 0]);
  addCylinder(buckets, 'plaster', 0.82, 0.82, 0.08, 18, [0, 0.38, 0], P.water);
  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    const radius = 1.05;
    addBox(
      buckets,
      'stone',
      [0.52, 0.36, 0.42],
      [Math.cos(angle) * radius, 0.45, Math.sin(angle) * radius],
      index % 3 === 0 ? P.stoneLight : index % 3 === 1 ? P.stone : P.stoneDeep,
      [0, -angle, 0],
    );
  }
  addCylinder(buckets, 'stone', 0.18, 0.24, 1.32, 8, [0, 1.28, 0], P.stoneDeep);
  addCylinder(buckets, 'metal', 0.25, 0.25, 0.12, 8, [0, 1.93, 0], P.gold);
  addCrystal(buckets, [0, 2.02, 0], 0.72);
}

function addCanopyPanel(buckets, x, color) {
  addBox(buckets, 'roof', [0.82, 0.08, 2.48], [x, 2.12, 0], color, [0, 0, x * -0.03]);
  addBox(buckets, 'roof', [0.82, 0.32, 0.08], [x, 1.94, 1.2], color);
}

export function buildMarketStall(buckets) {
  addFoundation(buckets, 2.7, 2.54, { height: 0.12 });
  for (const x of [-1.18, 1.18]) {
    for (const z of [-1.02, 1.02]) {
      addBox(buckets, 'timber', [0.18, 1.98, 0.18], [x, 1.08, z], P.timberDark);
      addBox(buckets, 'stone', [0.3, 0.22, 0.3], [x, 0.11, z], P.stoneLight);
      addBox(buckets, 'metal', [0.22, 0.12, 0.22], [x, 2.05, z], P.gold);
    }
  }
  addBox(buckets, 'timber', [2.58, 0.14, 0.16], [0, 1.98, 1.02], P.timberDark);
  addBox(buckets, 'timber', [2.58, 0.14, 0.16], [0, 1.98, -1.02], P.timber);
  addBox(buckets, 'timber', [0.16, 0.14, 2.22], [-1.18, 1.98, 0], P.timberDark);
  addBox(buckets, 'timber', [0.16, 0.14, 2.22], [1.18, 1.98, 0], P.timber);
  addCanopyPanel(buckets, -0.82, P.clothBlue);
  addCanopyPanel(buckets, 0, P.clothCream);
  addCanopyPanel(buckets, 0.82, P.clothRed);

  addBox(buckets, 'timber', [2.45, 0.18, 0.7], [0, 0.98, 0.68], P.timberLight);
  addBox(buckets, 'timber', [2.3, 0.82, 0.16], [0, 0.54, 0.93], P.timberDeep);
  addBox(buckets, 'timber', [2.3, 0.12, 0.76], [0, 1.38, -0.35], P.timber);
  for (const x of [-0.92, 0, 0.92]) {
    addBox(buckets, 'timber', [0.14, 0.82, 0.14], [x, 0.55, 0.68], P.timberDark);
  }
  for (const x of [-0.9, 0.9]) {
    addBox(buckets, 'timber', [0.12, 0.88, 0.12], [x, 1.02, -0.35], P.timberDeep);
  }

  addSack(buckets, [-0.77, 1.02, 0.55], P.sackGreen, 0.7);
  addSack(buckets, [-0.28, 1.02, 0.55], P.sackOchre, 0.7);
  addSack(buckets, [0.23, 1.02, 0.55], P.sackClay, 0.7);
  addSack(buckets, [0.72, 1.02, 0.55], P.clothCream, 0.7);
  addCrate(buckets, [0.36, 1.44, -0.35], [0.58, 0.46, 0.48]);
  addBarrel(buckets, [0.92, 0.4, -0.58], 0.72);
  addGeometry(buckets, 'stone', new THREE.ConeGeometry(0.22, 0.28, 5, 1, false), P.stoneDeep, {
    position: [-0.45, 1.58, -0.34],
  });
  addGeometry(buckets, 'plaster', new THREE.ConeGeometry(0.2, 0.24, 5, 1, false), P.sackGreen, {
    position: [-0.08, 1.56, -0.34],
  });
  addLantern(buckets, [-1.34, 1.45, 0.62], 0.52);
  addCrystal(buckets, [1.34, 1.42, 0.62], 0.34);
}

function makeFrontPanel(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -halfWidth,
        -halfHeight,
        0,
        halfWidth,
        -halfHeight,
        0,
        halfWidth,
        halfHeight,
        0,
        -halfWidth,
        halfHeight,
        0,
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function makeOpenPost(width, height, depth) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z],
      3,
    ),
  );
  geometry.setIndex([4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 0, 4, 7, 0, 7, 3, 5, 1, 2, 5, 2, 6]);
  return geometry;
}

function makeSquarePyramid(width, height, depth) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, 0, y, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]);
  return geometry;
}

function addFrontPanel(buckets, bucket, size, position, color) {
  addGeometry(buckets, bucket, makeFrontPanel(size[0], size[1]), color, { position });
}

function addWallPillar(buckets, x, tall = false) {
  const height = tall ? 2.25 : 2.05;
  addBox(buckets, 'stone', [0.58, height, 0.56], [x, height / 2, 0], tall ? P.stone : P.stoneLight);
  addBox(buckets, 'stone', [0.72, 0.2, 0.64], [x, height + 0.02, 0], P.stoneLight);
  if (!tall) return;

  addBox(buckets, 'timber', [0.56, 0.58, 0.5], [x, height + 0.42, 0], P.timberDark);
  addFrontPanel(buckets, 'warm', [0.26, 0.28], [x, height + 0.43, 0.255], P.warm);
  addGeometry(buckets, 'roof', makeSquarePyramid(0.72, 0.55, 0.72), P.roof, {
    position: [x, height + 0.985, 0],
  });
}

export function buildWallWing(buckets) {
  addBox(buckets, 'stone', [6.35, 0.2, 0.6], [0, 0.1, 0], P.stoneDeep);
  addBox(buckets, 'stone', [5.45, 1.52, 0.5], [-0.18, 0.92, 0], P.stone);
  addBox(buckets, 'stone', [5.62, 0.18, 0.58], [-0.18, 1.72, 0], P.stoneLight);
  addWallPillar(buckets, -2.9, false);
  addWallPillar(buckets, 2.62, true);

  const reliefRows = [
    {
      y: 0.48,
      panels: [
        [-1.67, 2.28],
        [0.75, 2.4],
      ],
    },
    {
      y: 0.9,
      panels: [
        [-1.38, 2.82],
        [1.06, 1.96],
      ],
    },
    {
      y: 1.32,
      panels: [
        [-1.74, 2.16],
        [0.7, 2.52],
      ],
    },
  ];
  for (const [rowIndex, row] of reliefRows.entries()) {
    for (const [panelIndex, [x, width]] of row.panels.entries()) {
      addFrontPanel(
        buckets,
        'stone',
        [width, 0.16],
        [x, row.y, 0.264],
        (rowIndex + panelIndex) % 2 === 0 ? P.stoneLight : P.stoneDeep,
      );
    }
  }
  addBox(buckets, 'timber', [5.45, 0.17, 0.18], [-0.18, 1.87, 0], P.timberDark);
  addBox(buckets, 'metal', [5.45, 0.1, 0.14], [-0.18, 2.16, 0], P.iron);
  for (const x of [-2.2, -1.0, 0.2, 1.4]) {
    addGeometry(buckets, 'metal', makeOpenPost(0.14, 0.28, 0.16), P.iron, {
      position: [x, 2.02, 0],
    });
  }

  addBox(buckets, 'timber', [0.72, 1.68, 0.16], [2.92, 0.98, 0.19], P.timberDeep);
  for (const y of [0.42, 1.36]) {
    addFrontPanel(buckets, 'metal', [0.82, 0.14], [2.92, y, 0.276], P.iron);
    for (const x of [2.58, 3.26]) {
      addFrontPanel(buckets, 'metal', [0.085, 0.085], [x, y, 0.278], P.ironLight);
    }
  }
  addFrontPanel(buckets, 'metal', [0.12, 0.3], [2.18, 1.48, 0.28], P.gold);
  addOctahedron(buckets, 'arcane', 0.12, [2.18, 1.62, 0.29], P.arcanePale, [0.72, 1.45, 0.45]);
}
