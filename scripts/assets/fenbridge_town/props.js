import * as THREE from 'three';
import {
  addBarrel,
  addBox,
  addCrate,
  addCylinder,
  addGeometry,
  addLantern,
  addShingledRoof,
  FENBRIDGE_PALETTE as P,
} from './shared.js';

/**
 * Provision stall: open market counter, teal canvas canopy, baskets/goods,
 * vendor rear / customer front. Sockets: vendor [0,0,-0.8], customer [0,0,0.8].
 * Multi-round exterior prop rebuild.
 */
export function buildProvisionStall(buckets) {
  // R1-3: frame + deck
  for (const [x, z] of [
    [-1.35, 0.55],
    [1.35, 0.55],
    [-1.35, -0.55],
    [1.35, -0.55],
  ]) {
    addCylinder(buckets, 'timber', 0.1, 0.12, 2.35, 6, [x, 1.15, z], P.timberDark);
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, 0.08, z], P.iron);
    addCylinder(buckets, 'cloth', 0.13, 0.13, 0.08, 5, [x, 0.55, z], P.rope);
    addCylinder(buckets, 'cloth', 0.13, 0.13, 0.08, 5, [x, 1.85, z], P.rope);
  }
  // R4-5: canopy poles crossbeam + teal cloth
  addBox(buckets, 'timber', [2.9, 0.12, 0.12], [0, 2.35, 0.55], P.timber);
  addBox(buckets, 'timber', [2.9, 0.12, 0.12], [0, 2.35, -0.55], P.timber);
  addBox(buckets, 'cloth', [2.7, 0.06, 1.35], [0, 2.42, 0], P.clothTeal, [0.08, 0, 0]);
  addBox(buckets, 'cloth', [2.5, 0.04, 0.2], [0, 2.35, 0.7], P.roofDeep);
  // R6-8: counters + shelves
  addBox(buckets, 'timber', [2.85, 0.12, 1.35], [0, 1.05, 0], P.timberLight);
  addBox(buckets, 'timber', [2.7, 0.7, 0.12], [0, 0.55, -0.55], P.timberDeep);
  for (let i = 0; i < 5; i += 1) {
    addBox(
      buckets,
      'timber',
      [0.48, 0.08, 1.2],
      [-1.1 + i * 0.55, 1.12, 0.05],
      i % 2 ? P.timber : P.timberLight,
    );
  }
  // R9-12: denser exterior goods (no readable text)
  addBox(buckets, 'organic', [0.35, 0.2, 0.25], [-0.9, 1.28, 0.15], P.hide);
  addBox(buckets, 'organic', [0.28, 0.18, 0.22], [-0.5, 1.26, -0.1], P.herb);
  addCylinder(buckets, 'organic', 0.12, 0.12, 0.2, 6, [0.1, 1.28, 0.2], P.parchment);
  addCylinder(buckets, 'organic', 0.1, 0.1, 0.28, 5, [0.45, 1.32, -0.15], P.potionGlass);
  addBox(buckets, 'timber', [0.4, 0.18, 0.3], [0.95, 1.25, 0.1], P.timber);
  addBox(buckets, 'organic', [0.22, 0.15, 0.4], [-0.2, 1.25, 0.35], P.herb);
  // Loaves / baskets / hanging fish silhouettes
  for (const dx of [-0.75, -0.55, -0.35]) {
    addBox(buckets, 'organic', [0.12, 0.08, 0.28], [dx, 1.35, 0.25], P.parchmentDark, [0, 0.2, 0]);
  }
  for (let i = 0; i < 4; i += 1) {
    addBox(
      buckets,
      'organic',
      [0.06, 0.35, 0.1],
      [0.2 + i * 0.12, 1.55, -0.1],
      i % 2 ? P.hide : P.herb,
    );
  }
  addCylinder(buckets, 'organic', 0.16, 0.18, 0.16, 8, [0.85, 1.3, 0.25], P.parchment);
  addBox(buckets, 'organic', [0.2, 0.15, 0.2], [1.1, 1.3, -0.2], P.herb);
  // Under-counter sacks/crates
  addBox(buckets, 'organic', [0.35, 0.28, 0.28], [-0.9, 0.35, 0.2], P.hide);
  addBox(buckets, 'timber', [0.4, 0.22, 0.32], [0.2, 0.32, 0.15], P.timberLight);
  addCylinder(buckets, 'organic', 0.08, 0.08, 0.25, 5, [0.7, 0.35, 0.25], P.potionGlass);
  addBox(buckets, 'organic', [0.3, 0.22, 0.25], [-0.4, 0.32, -0.15], P.hide);
  addCylinder(buckets, 'organic', 0.07, 0.07, 0.2, 5, [1.0, 0.32, 0.1], P.potionGlass);
  // R13-15: lanterns both sides + iron rings + canopy edge rope
  addLantern(buckets, [-1.45, 1.7, 0.55], 0.75);
  addLantern(buckets, [1.45, 1.65, -0.4], 0.7);
  addBox(buckets, 'metal', [0.1, 0.1, 0.1], [-1.35, 2.25, 0.55], P.ironLight);
  for (const x of [-1.0, 0, 1.0]) {
    addBox(buckets, 'metal', [0.08, 0.08, 0.08], [x, 1.05, 0.65], P.iron);
  }
  addCylinder(buckets, 'cloth', 0.04, 0.04, 2.6, 5, [0, 2.2, 0.55], P.rope, [0, 0, Math.PI / 2]);

  // R16-30 exterior densify: denser goods, canopy tassels, post wraps, rain streaks.
  for (const x of [-1.2, -0.4, 0.4, 1.2]) {
    addBox(buckets, 'cloth', [0.06, 0.22, 0.06], [x, 2.2, 0.65], P.clothTeal);
  }
  for (const [x, z] of [
    [-1.35, 0.55],
    [1.35, 0.55],
    [-1.35, -0.55],
    [1.35, -0.55],
  ]) {
    addCylinder(buckets, 'cloth', 0.14, 0.14, 0.08, 5, [x, 1.15, z], P.rope);
    addBox(buckets, 'metal', [0.12, 0.08, 0.12], [x, 2.3, z], P.ironLight);
  }
  addBox(buckets, 'organic', [0.3, 0.18, 0.22], [-1.1, 1.28, -0.2], P.hide);
  addBox(buckets, 'organic', [0.25, 0.16, 0.2], [0.55, 1.28, 0.3], P.herb);
  addCylinder(buckets, 'organic', 0.1, 0.1, 0.22, 6, [-0.15, 1.3, -0.25], P.parchment);
  addCrate(buckets, [1.0, 0.05, 0.35], [0.35, 0.28, 0.3]);
  addBarrel(buckets, [-1.15, 0.28, -0.35], 0.55);
  // Canopy underside battens
  for (const z of [-0.35, 0.15]) {
    addBox(buckets, 'timber', [2.5, 0.05, 0.06], [0, 2.28, z], P.timberDark);
  }
  // Customer-side kickboard bolts
  for (const x of [-1.0, 0, 1.0]) {
    addBox(buckets, 'metal', [0.07, 0.07, 0.05], [x, 0.55, 0.68], P.iron);
  }
}

/**
 * Palisade wing: instanced wall segment, pointed stakes, cross rails, iron,
 * rope, optional teal scrap. Joins at ±3 on X.
 */
export function buildPalisadeWing(buckets) {
  const count = 11;
  const span = 5.2;
  for (let i = 0; i < count; i += 1) {
    const x = -span / 2 + (span * i) / (count - 1);
    const h = 2.55 + (i % 3) * 0.12;
    addCylinder(
      buckets,
      'timber',
      0.16,
      0.18,
      h,
      6,
      [x, h / 2, 0],
      i % 2 ? P.timberDark : P.timberDeep,
    );
    addGeometry(buckets, 'timber', new THREE.ConeGeometry(0.14, 0.38, 5), P.timberDark, {
      position: [x, h + 0.12, 0],
    });
    if (i % 3 === 0) {
      addBox(buckets, 'stone', [0.28, 0.12, 0.28], [x, 0.08, 0], P.moss);
    }
  }
  // End posts thicker
  for (const x of [-2.85, 2.85]) {
    addBox(buckets, 'timber', [0.38, 3.1, 0.38], [x, 1.55, 0], P.timberDark);
    addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.2, 0.4, 4), P.ironLight, {
      position: [x, 3.25, 0],
    });
    for (const y of [0.5, 1.5, 2.5]) {
      addBox(buckets, 'metal', [0.45, 0.14, 0.45], [x, y, 0], P.iron);
    }
  }
  // Cross rails
  for (const y of [1.0, 1.85]) {
    addBox(buckets, 'timber', [5.4, 0.14, 0.14], [0, y, 0.12], P.timber);
    for (const x of [-1.5, 0, 1.5]) {
      addBox(buckets, 'metal', [0.16, 0.16, 0.16], [x, y, 0.18], P.ironLight);
    }
  }
  // Rope X on left bay + teal scrap banner
  addCylinder(buckets, 'cloth', 0.04, 0.04, 1.1, 5, [-1.6, 1.5, 0.2], P.rope, [0, 0, 0.7]);
  addCylinder(buckets, 'cloth', 0.04, 0.04, 1.1, 5, [-1.6, 1.5, 0.2], P.rope, [0, 0, -0.7]);
  addBox(buckets, 'cloth', [0.08, 0.55, 0.28], [1.7, 1.35, 0.22], P.clothTeal, [0, 0, -0.15]);

  // R16-30 densify (budget-tight instanced wall): sparse hardware + moss only.
  for (const x of [-2.0, 0, 2.0]) {
    addBox(buckets, 'metal', [0.2, 0.1, 0.2], [x, 1.4, 0], P.iron);
    addBox(buckets, 'stone', [0.3, 0.08, 0.26], [x, 0.06, 0.12], P.moss);
  }
  addBox(buckets, 'timber', [5.0, 0.08, 0.08], [0, 0.7, -0.1], P.timberDark);
}

/**
 * Gate arch: open 6-yd lane, timber jambs, shingled cap, signal horn, lanterns,
 * blank teal banners. Jambs only (no blocking volume in lane).
 */
export function buildGateArch(buckets) {
  // Jambs
  for (const sx of [-1, 1]) {
    for (const sz of [-0.25, 0.25]) {
      addBox(buckets, 'timber', [0.45, 3.6, 0.4], [sx * 2.85, 1.85, sz], P.timberDark);
      addBox(buckets, 'stone', [0.55, 0.55, 0.5], [sx * 2.85, 0.28, sz], P.stoneDeep);
      for (const y of [0.7, 1.7, 2.7]) {
        addBox(buckets, 'metal', [0.52, 0.14, 0.48], [sx * 2.85, y, sz], P.iron);
      }
    }
    // Diagonal brace inward
    addBox(buckets, 'timber', [0.18, 1.8, 0.18], [sx * 2.2, 2.4, 0], P.timber, [0, 0, sx * 0.55]);
    // Spike pickets on outer face
    for (let i = 0; i < 3; i += 1) {
      addBox(buckets, 'timber', [0.12, 0.7, 0.12], [sx * 3.15, 0.9 + i * 0.55, 0], P.timberDeep);
      addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.08, 0.2, 4), P.ironLight, {
        position: [sx * 3.15, 1.35 + i * 0.55, 0],
      });
    }
  }
  // Lintels
  addBox(buckets, 'timber', [6.4, 0.28, 0.35], [0, 3.55, 0], P.timber);
  addBox(buckets, 'timber', [6.2, 0.2, 0.25], [0, 3.85, 0], P.timberDark);
  // Shingled cap roof (denser courses for exterior read)
  addShingledRoof(buckets, 6.6, 1.45, 3.95, 4.65, { ridgeAxis: 'x', courses: 7 });
  // Extra short shingle tiles along cap
  for (let c = 0; c < 6; c += 1) {
    const t = (c + 0.5) / 6;
    const z = -0.55 + t * 1.1;
    addBox(
      buckets,
      'roof',
      [6.3, 0.04, 0.18],
      [0, 4.05 + t * 0.35, z],
      c % 2 ? P.roofDeep : P.roofLight,
      [0.15 * (z > 0 ? 1 : -1), 0, 0],
    );
  }
  // Signal horn under lintel (larger, more readable)
  addCylinder(buckets, 'metal', 0.1, 0.16, 0.65, 7, [0, 3.3, 0.2], P.brass, [Math.PI / 2, 0.35, 0]);
  addCylinder(buckets, 'metal', 0.05, 0.05, 0.28, 5, [0.35, 3.3, 0.28], P.brassLight, [
    Math.PI / 2,
    0.35,
    0,
  ]);
  addCylinder(buckets, 'cloth', 0.03, 0.03, 0.4, 5, [0, 3.55, 0.05], P.rope);
  // Side lantern arms
  for (const sx of [-1, 1]) {
    addBox(buckets, 'timber', [0.9, 0.12, 0.12], [sx * 3.3, 3.2, 0.15], P.timberDark);
    addCylinder(buckets, 'metal', 0.025, 0.025, 0.55, 5, [sx * 3.7, 2.85, 0.15], P.iron);
    addLantern(buckets, [sx * 3.7, 2.45, 0.15], 0.85);
    // Blank teal banner
    addBox(buckets, 'cloth', [0.08, 0.85, 0.4], [sx * 3.4, 2.2, -0.15], P.clothTeal, [
      0,
      0,
      sx * 0.08,
    ]);
  }
  // Rope wraps
  for (const sx of [-1, 1]) {
    addCylinder(buckets, 'cloth', 0.2, 0.2, 0.1, 5, [sx * 2.85, 1.2, 0], P.rope);
  }

  // R16-30 densify: denser jamb hardware, ridge finials, lane-edge moss (lane stays open).
  for (const sx of [-1, 1]) {
    for (const y of [0.95, 2.15, 3.1]) {
      addBox(buckets, 'metal', [0.55, 0.1, 0.5], [sx * 2.85, y, 0], P.ironLight);
    }
    addCylinder(buckets, 'cloth', 0.22, 0.22, 0.1, 5, [sx * 2.85, 2.4, 0], P.rope);
    addBox(buckets, 'stone', [0.45, 0.12, 0.4], [sx * 2.85, 0.08, 0.35], P.moss);
    addBox(buckets, 'stone', [0.45, 0.12, 0.4], [sx * 2.85, 0.08, -0.35], P.moss);
  }
  for (const x of [-2.0, 0, 2.0]) {
    addBox(buckets, 'metal', [0.12, 0.1, 0.12], [x, 4.55, 0], P.brass);
  }
  addBox(buckets, 'timber', [6.5, 0.1, 0.12], [0, 3.35, 0.2], P.timberLight);
  addBox(buckets, 'timber', [6.5, 0.1, 0.12], [0, 3.35, -0.2], P.timberLight);
}

/**
 * Boardwalk module: ground-seated wet-margin planks, nonblocking.
 * Joins at ±2 on X.
 */
export function buildBoardwalk(buckets) {
  for (let i = 0; i < 8; i += 1) {
    const x = -1.75 + i * 0.5;
    addBox(buckets, 'timber', [0.42, 0.08, 1.25], [x, 0.06, 0], i % 2 ? P.timberLight : P.timber);
  }
  for (const z of [-0.55, 0.55]) {
    addBox(buckets, 'timber', [3.9, 0.1, 0.12], [0, 0.02, z], P.timberDark);
  }
  // Edge piles slightly below for wet read
  for (const x of [-1.6, -0.5, 0.5, 1.6]) {
    for (const z of [-0.6, 0.6]) {
      addCylinder(buckets, 'timber', 0.06, 0.07, 0.2, 5, [x, -0.02, z], P.timberDeep);
    }
  }
  addBox(buckets, 'stone', [3.8, 0.04, 1.35], [0, -0.01, 0], P.moss);

  // R16-30 densify (budget-tight module): seam boards + wet mud only.
  for (const x of [-1.0, 0, 1.0]) {
    addBox(buckets, 'timber', [0.04, 0.05, 1.1], [x, 0.09, 0], P.timberDeep);
  }
  for (const z of [-0.62, 0.62]) {
    for (const x of [-1.2, 1.2]) {
      addBox(buckets, 'stone', [0.3, 0.04, 0.12], [x, 0.0, z], P.mud);
    }
  }
}

/**
 * Muster board: roofed notice frame, blank sealed notices (no readable text),
 * hanging lantern. Interaction at +Z.
 */
export function buildMusterBoard(buckets) {
  for (const x of [-0.95, 0.95]) {
    addBox(buckets, 'timber', [0.22, 2.35, 0.22], [x, 1.2, 0], P.timberDark);
    addBox(buckets, 'stone', [0.35, 0.25, 0.35], [x, 0.12, 0], P.moss);
    addGeometry(buckets, 'metal', new THREE.ConeGeometry(0.14, 0.32, 4), P.ironLight, {
      position: [x, 2.5, 0],
    });
    for (const y of [0.55, 1.4, 2.15]) {
      addBox(buckets, 'metal', [0.28, 0.12, 0.28], [x, y, 0], P.iron);
    }
  }
  addBox(buckets, 'timber', [2.1, 0.14, 0.14], [0, 2.15, 0], P.timber);
  addBox(buckets, 'timber', [1.85, 1.25, 0.12], [0, 1.35, 0.05], P.timberLight);
  // Iron frame corners
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      addBox(buckets, 'metal', [0.2, 0.2, 0.08], [sx * 0.85, 1.35 + sy * 0.55, 0.12], P.ironLight);
    }
  }
  // Blank sealed notices
  for (const [x, y, w, h] of [
    [-0.45, 1.55, 0.4, 0.55],
    [0.05, 1.45, 0.35, 0.65],
    [0.5, 1.5, 0.38, 0.5],
  ]) {
    addBox(buckets, 'parchment', [w, h, 0.04], [x, y, 0.14], P.parchment);
    addCylinder(buckets, 'organic', 0.05, 0.05, 0.04, 5, [x, y + h * 0.35, 0.18], P.wax);
  }
  // Teal shingle cap
  addShingledRoof(buckets, 2.35, 0.95, 2.25, 2.75, { ridgeAxis: 'x', courses: 4 });
  // Lantern arm left
  addBox(buckets, 'timber', [0.7, 0.1, 0.1], [-1.25, 1.85, 0.1], P.timberDark);
  addCylinder(buckets, 'cloth', 0.03, 0.03, 0.45, 5, [-1.55, 1.55, 0.1], P.rope);
  addLantern(buckets, [-1.55, 1.2, 0.1], 0.9);
  // Rope wraps on posts
  for (const x of [-0.95, 0.95]) {
    addCylinder(buckets, 'cloth', 0.14, 0.14, 0.1, 5, [x, 0.85, 0], P.rope);
  }

  // R16-30 densify: more sealed notices, rain cap trim, post hardware.
  for (const [x, y, w, h] of [
    [-0.55, 1.25, 0.28, 0.35],
    [0.35, 1.7, 0.3, 0.28],
  ]) {
    addBox(buckets, 'parchment', [w, h, 0.03], [x, y, 0.15], P.parchmentDark);
    addCylinder(buckets, 'organic', 0.04, 0.04, 0.03, 5, [x, y + h * 0.3, 0.18], P.wax);
  }
  for (const x of [-0.95, 0.95]) {
    for (const y of [0.9, 1.75]) {
      addBox(buckets, 'metal', [0.26, 0.1, 0.26], [x, y, 0], P.ironLight);
    }
  }
  addBox(buckets, 'timber', [2.2, 0.08, 0.1], [0, 2.35, 0.08], P.timber);
  addBox(buckets, 'roof', [2.0, 0.05, 0.7], [0, 2.55, 0], P.roofDeep);
  addLantern(buckets, [1.45, 1.35, 0.15], 0.7);
}

/**
 * Muster order: sealed quest packet on board backer (pickup prop).
 * Sockets: pickup [0,0.22,0], sparkle [0,0.38,0].
 */
export function buildMusterOrder(buckets) {
  addBox(buckets, 'timber', [0.85, 0.06, 0.55], [0, 0.04, 0], P.timberDark);
  addBox(buckets, 'parchment', [0.7, 0.04, 0.45], [0, 0.1, 0.02], P.parchment);
  addBox(buckets, 'parchment', [0.62, 0.03, 0.4], [0.04, 0.14, 0], P.parchmentDark, [0, 0.08, 0]);
  addBox(buckets, 'cloth', [0.75, 0.05, 0.12], [0, 0.16, 0], P.clothTeal);
  addCylinder(buckets, 'organic', 0.07, 0.07, 0.05, 6, [0.15, 0.2, 0.05], P.wax);
  addBox(buckets, 'metal', [0.08, 0.02, 0.08], [-0.2, 0.18, 0.08], P.brass);

  // R16-30 densify: layered papers, ribbon tails, seal facets, corner tacks.
  addBox(
    buckets,
    'parchment',
    [0.55, 0.02, 0.35],
    [-0.05, 0.17, 0.04],
    P.parchment,
    [0, -0.1, 0.05],
  );
  addBox(buckets, 'cloth', [0.12, 0.03, 0.35], [0.28, 0.16, 0], P.clothTeal);
  addBox(buckets, 'cloth', [0.1, 0.02, 0.2], [-0.3, 0.15, 0.1], P.rope, [0, 0.3, 0]);
  addCylinder(buckets, 'organic', 0.05, 0.05, 0.04, 6, [-0.12, 0.2, -0.08], P.wax);
  for (const [x, z] of [
    [-0.35, 0.18],
    [0.35, 0.18],
    [-0.35, -0.18],
    [0.35, -0.18],
  ]) {
    addBox(buckets, 'metal', [0.05, 0.02, 0.05], [x, 0.08, z], P.brassLight);
  }
  addBox(buckets, 'timber', [0.9, 0.03, 0.58], [0, 0.015, 0], P.timber);
}
