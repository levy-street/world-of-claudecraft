// Props for delve interactable entities.
// All geometry is deterministic: any randomness uses entityId as a seed,
// never Math.random. Procedural materials go through surfaceMat() for dedup.
// The chest prefers the real dungeon-kit GLB (chest_gold) when loaded and falls
// back to procedural geometry otherwise. No DOM, no sim imports (render-only).

import * as THREE from 'three';
import { buildDungeonPropMesh } from './dungeon';
import { GFX, surfaceMat } from './gfx';

// ---------------------------------------------------------------------------
// Shared material helpers
// ---------------------------------------------------------------------------

function stoneMat(color: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: !GFX.standardMaterials,
  });
}

function ironMat(color: number, emissive?: number, emissiveIntensity?: number): THREE.Material {
  return surfaceMat({
    color,
    roughness: 0.65,
    metalness: 0.55,
    flatShading: !GFX.standardMaterials,
    emissive,
    emissiveIntensity,
  });
}

function glowMat(color: number, opacity = 0.28): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// delve_locked_door, iron portcullis spanning the full aisle
//
// The collider uses hw=14 (~28 units wide), floor to ceiling (~8 units tall).
// The portcullis MUST visually cover that span so the invisible wall is not
// invisible. Bars run every 2.5 units across 28 u (13 inner bars + 2 edge posts).
// ---------------------------------------------------------------------------
function buildLockedDoor(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  // Dimensions to match the collider: spans the full walkable aisle (|x|<24).
  const totalW = 48;
  const totalH = 8;

  const darkIron = ironMat(0x2a2a2e, 0x3a1810, 0.08);
  const rustyIron = ironMat(0x3a2820, 0x200a04, 0.05);

  // Top lintel bar, thick horizontal beam spanning the full width.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.55, 0.45), darkIron);
  lintel.position.set(0, totalH - 0.28, 0);
  lintel.castShadow = true;
  lintel.receiveShadow = true;
  group.add(lintel);

  // Bottom threshold bar, matches lintel.
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.45, 0.45), darkIron);
  threshold.position.set(0, 0.22, 0);
  threshold.castShadow = true;
  threshold.receiveShadow = true;
  group.add(threshold);

  // Mid horizontal crossbar.
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.32, 0.38), rustyIron);
  crossbar.position.set(0, totalH * 0.5, 0);
  crossbar.castShadow = true;
  group.add(crossbar);

  // Edge posts (left and right).
  for (const sx of [-totalW / 2 + 0.25, totalW / 2 - 0.25]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, totalH, 0.5), darkIron);
    post.position.set(sx, totalH / 2, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }

  // Vertical bars, one every 2.5 units across the inner span.
  const barW = 0.28;
  const barH = totalH - 0.9; // leaves gap at top/bottom for lintel/threshold
  const barSpacing = 2.5;
  const innerHalfW = totalW / 2 - 0.55;
  const barCount = Math.floor((innerHalfW * 2) / barSpacing) - 1;
  const barStartX = -((barCount - 1) * barSpacing) / 2;

  for (let i = 0; i < barCount; i++) {
    const bx = barStartX + i * barSpacing;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(barW, barH, barW), rustyIron);
    bar.position.set(bx, totalH / 2, 0);
    bar.castShadow = true;
    group.add(bar);

    // Pointed tips at top of every bar.
    const tip = new THREE.Mesh(new THREE.ConeGeometry(barW * 0.55, 0.6, 4), darkIron);
    tip.position.set(bx, totalH - 0.28, 0);
    tip.rotation.y = Math.PI / 4;
    group.add(tip);
  }

  // Subtle red-ember glow plane in the gate aperture (dark fantasy mood).
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(totalW - 1, totalH - 1),
    glowMat(0x5a1008, 0.06),
  );
  glow.position.set(0, totalH / 2, -0.1);
  group.add(glow);

  // Chain decorations near each post.
  for (const sx of [-totalW / 2 + 1.2, totalW / 2 - 1.2]) {
    for (let ci = 0; ci < 4; ci++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 4, 6), darkIron);
      link.position.set(sx, 2.5 + ci * 0.5, 0.0);
      link.rotation.z = ci % 2 === 0 ? 0 : Math.PI / 2;
      group.add(link);
    }
  }

  return { group, height: totalH + 0.5 };
}

// ---------------------------------------------------------------------------
// delve_pressure_plate, flush stone floor plate, low profile
// ---------------------------------------------------------------------------
function buildPressurePlate(
  triggered: boolean,
  entityId: number,
): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  // Deterministic small rotation using entityId.
  const rotY = ((entityId * 17) % 6) * 0.1 - 0.3;

  const slabMat = stoneMat(triggered ? 0x3a4830 : 0x6a6460);
  const rimMat = stoneMat(triggered ? 0x505c3a : 0x504c48);

  // Main slab, large, nearly flush with floor.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 2.8), slabMat);
  slab.position.y = 0.06;
  slab.rotation.y = rotY;
  slab.receiveShadow = true;
  group.add(slab);

  // Rim border (slightly lower).
  const rim = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.07, 3.2), rimMat);
  rim.position.y = 0.035;
  rim.rotation.y = rotY;
  rim.receiveShadow = true;
  group.add(rim);

  if (triggered) {
    // Green glow inset when triggered.
    const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), glowMat(0x22aa44, 0.32));
    glowPlane.rotation.x = -Math.PI / 2;
    glowPlane.position.y = 0.14;
    glowPlane.rotation.z = rotY;
    group.add(glowPlane);

    // Rune lines (emissive slits).
    const runeMat = surfaceMat({
      color: 0x44ff88,
      emissive: 0x22cc55,
      emissiveIntensity: 1.2,
      roughness: 0.4,
      metalness: 0,
      flatShading: !GFX.standardMaterials,
    });
    for (let ri = 0; ri < 2; ri++) {
      const rune = new THREE.Mesh(
        new THREE.BoxGeometry(ri === 0 ? 1.8 : 0.08, 0.025, ri === 0 ? 0.08 : 1.8),
        runeMat,
      );
      rune.position.y = 0.135;
      rune.rotation.y = rotY;
      group.add(rune);
    }

    const light = new THREE.PointLight(0x44ff88, 1.2, 6, 2);
    light.position.y = 0.5;
    group.add(light);
  }

  return { group, height: 0.4 };
}

// ---------------------------------------------------------------------------
// delve_cracked_grave, broken/tilted tombstone over disturbed earth
// ---------------------------------------------------------------------------
function buildCrackedGrave(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  const tilt = ((entityId * 13) % 10) * 0.025 - 0.12; // -0.12 .. +0.1 rad

  const stoneDark = stoneMat(0x4a4642);
  const stoneCracked = stoneMat(0x3e3a36);
  const dirtMat = stoneMat(0x4a3a2a);

  // Disturbed earth mound.
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 0.28, 12), dirtMat);
  mound.position.y = 0.14;
  mound.receiveShadow = true;
  group.add(mound);

  // Main stone body, tilted.
  const stone = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.22), stoneDark);
  stone.position.y = 1.05;
  stone.rotation.z = tilt;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  // Rounded top cap.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.22, 12), stoneDark);
  cap.rotation.z = tilt;
  cap.position.set(Math.sin(tilt) * 0.9, 1.95 + Math.cos(tilt) * 0.1, 0);
  cap.castShadow = true;
  group.add(cap);

  // Crack slit across the stone body.
  const crack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.24), stoneCracked);
  crack.position.set(0.12, 1.2, 0);
  crack.rotation.z = tilt + 0.15;
  group.add(crack);

  // Rubble chips.
  const chipPositions = [
    [-0.7, 0, 0.4],
    [0.5, 0, -0.5],
    [-0.3, 0, -0.8],
  ] as const;
  for (const [cx, , cz] of chipPositions) {
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.22), stoneCracked);
    chip.position.set(cx, 0.06, cz);
    chip.rotation.y = ((entityId + cx * 10) % 12) * 0.3;
    chip.receiveShadow = true;
    group.add(chip);
  }

  return { group, height: 2.2 };
}

// ---------------------------------------------------------------------------
// delve_module_exit, sealed passage / rubble-blocked doorway
// ---------------------------------------------------------------------------
function buildModuleExit(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  const archStone = stoneMat(0x6a6260);
  const rubbleMat = stoneMat(0x5a5450);
  const mortarMat = stoneMat(0x807a74);

  // Arch surround, simplified portal frame.
  // Side pillars.
  for (const sx of [-1.8, 1.8]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.0, 0.55), archStone);
    pillar.position.set(sx, 2.5, 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);
  }

  // Top lintel.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 0.55), archStone);
  lintel.position.set(0, 5.28, 0);
  lintel.castShadow = true;
  group.add(lintel);

  // Rubble fill inside the arch, staggered blocks.
  const rubbleLayout: [number, number, number][] = [
    [-0.9, 0.25, 0],
    [0.2, 0.25, 0],
    [0.9, 0.35, 0],
    [-0.5, 0.95, 0],
    [0.5, 0.85, 0],
    [-1.0, 0.9, 0],
    [0.0, 1.55, 0],
    [-0.7, 1.6, 0],
    [0.8, 1.45, 0],
    [-0.2, 2.25, 0],
    [0.6, 2.2, 0],
    [-0.9, 2.3, 0],
    [0.2, 2.95, 0],
    [-0.4, 2.9, 0],
    [0.9, 3.0, 0],
    [-0.6, 3.55, 0],
    [0.3, 3.6, 0],
    [0.0, 4.25, 0],
    [-0.5, 4.2, 0],
  ];
  for (const [rx, ry] of rubbleLayout) {
    const bw = 0.9 + (Math.abs(rx * 7 + ry * 3) % 5) * 0.12;
    const bh = 0.6 + (Math.abs(rx * 5 + ry * 11) % 4) * 0.08;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, 0.48),
      (rx + ry) % 2 > 0 ? rubbleMat : mortarMat,
    );
    block.position.set(rx, ry + bh / 2, 0);
    block.rotation.y = ((rx * 5 + ry * 7) % 3) * 0.08 - 0.08;
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);
  }

  return { group, height: 5.5 };
}

// ---------------------------------------------------------------------------
// delve_reward_chest / delve_locked_chest, reliquary chest.
//
// Prefer the real KayKit GLB (chest_gold) so it matches the dungeon dressing;
// fall back to procedural geometry when the interior kit has not loaded yet.
// The GLB is normalized to a target height so it sits right whatever its native
// scale, and re-seated on the floor. The locked variant overlays a ward seal.
// ---------------------------------------------------------------------------
const CHEST_TARGET_H = 2.8; // grand reliquary chest (2x the base 1.4 height)

function buildGlbChest(locked: boolean): { group: THREE.Group; height: number } | null {
  const mesh = buildDungeonPropMesh('chest_gold');
  if (!mesh) return null;
  const group = new THREE.Group();
  group.add(mesh);
  // Normalize size to CHEST_TARGET_H regardless of the GLB's native scale.
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(mesh).getSize(size);
  if (size.y > 1e-3) mesh.scale.setScalar(CHEST_TARGET_H / size.y);
  // Re-seat the base on the floor (KayKit origin is not always at the base).
  const seated = new THREE.Box3().setFromObject(mesh);
  mesh.position.y -= seated.min.y;
  group.rotation.y = 0; // face south (toward the entrance)
  if (locked) {
    const half = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getSize(half);
    addWardSeal(group, CHEST_TARGET_H * 0.6, half.z / 2 + 0.05);
  }
  return { group, height: CHEST_TARGET_H + (locked ? 0.4 : 0.2) };
}

// Red ward seal overlaid on the locked chest's front face.
function addWardSeal(group: THREE.Group, y: number, frontZ: number): void {
  const wardMat = surfaceMat({
    color: 0xff4422,
    emissive: 0xdd2200,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.0,
    flatShading: !GFX.standardMaterials,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 6, 18), wardMat);
  ring.position.set(0, y, frontZ);
  group.add(ring);
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), glowMat(0xff3300, 0.3));
  seal.position.set(0, y, frontZ + 0.01);
  group.add(seal);
  for (let wi = 0; wi < 3; wi++) {
    const wline = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.04), wardMat);
    wline.rotation.z = (wi / 3) * Math.PI;
    wline.position.set(0, y, frontZ);
    group.add(wline);
  }
  const light = new THREE.PointLight(0xff2200, 1.0, 4, 2);
  light.position.set(0, y + 0.5, frontZ + 0.2);
  group.add(light);
}

function buildRewardChest(entityId: number): { group: THREE.Group; height: number } {
  return buildGlbChest(false) ?? buildProceduralRewardChest(entityId);
}

function buildLockedChest(entityId: number): { group: THREE.Group; height: number } {
  return buildGlbChest(true) ?? buildProceduralLockedChest(entityId);
}

function buildProceduralRewardChest(_entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  group.rotation.y = 0; // face south (toward the entrance)

  const woodMat = stoneMat(0x4a3018);
  const ironBandMat = ironMat(0x2a2420, 0x200808, 0.06);
  const goldMat = ironMat(0xc8860a, 0x805008, 0.3);
  const gemMat = surfaceMat({
    color: 0x8822cc,
    emissive: 0x6010a0,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
    flatShading: !GFX.standardMaterials,
  });

  // Body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.1), woodMat);
  body.position.y = 0.45;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Lid (slightly arched via scale).
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.42, 1.12), woodMat);
  lid.position.y = 1.11;
  lid.castShadow = true;
  group.add(lid);

  // Iron bands.
  for (const bx of [-0.75, 0, 0.75]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.38, 1.14), ironBandMat);
    band.position.set(bx, 0.69, 0);
    group.add(band);
  }

  // Corner studs.
  for (const sx of [-0.82, 0.82]) {
    for (const sz of [-0.54, 0.54]) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.35, 6), ironBandMat);
      stud.position.set(sx, 0.68, sz);
      group.add(stud);
    }
  }

  // Gold latch on front.
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.1), goldMat);
  latch.position.set(0, 0.9, 0.57);
  group.add(latch);

  // Gem on lid center.
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), gemMat);
  gem.position.set(0, 1.36, 0);
  gem.rotation.y = Math.PI / 4;
  group.add(gem);

  const light = new THREE.PointLight(0x9933dd, 0.8, 4, 2);
  light.position.set(0, 1.8, 0);
  group.add(light);

  return { group, height: 1.6 };
}

// ---------------------------------------------------------------------------
// delve_locked_chest, warded reliquary chest (chest + glowing ward seal)
// ---------------------------------------------------------------------------
function buildProceduralLockedChest(entityId: number): { group: THREE.Group; height: number } {
  const { group } = buildProceduralRewardChest(entityId);

  // Overlay a glowing ward seal on the front face.
  const wardMat = surfaceMat({
    color: 0xff4422,
    emissive: 0xdd2200,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.0,
    flatShading: !GFX.standardMaterials,
  });

  // Seal ring.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 6, 18), wardMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0, 0.9, 0.6);
  group.add(ring);

  // Seal glow plane.
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), glowMat(0xff3300, 0.3));
  seal.position.set(0, 0.9, 0.61);
  group.add(seal);

  // Ward lines (crossed).
  for (let wi = 0; wi < 3; wi++) {
    const wline = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.04), wardMat);
    wline.rotation.y = Math.PI / 2;
    wline.rotation.z = (wi / 3) * Math.PI;
    wline.position.set(0, 0.9, 0.59);
    group.add(wline);
  }

  const light = new THREE.PointLight(0xff2200, 1.0, 4, 2);
  light.position.set(0, 1.4, 0.8);
  group.add(light);

  return { group, height: 1.8 };
}

// ---------------------------------------------------------------------------
// delve_surface_exit, ascending stairs / stairwell upward
// ---------------------------------------------------------------------------
function buildSurfaceExit(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  group.rotation.y = Math.PI; // face the player as they enter (steps ascend toward them)

  const stairMat = stoneMat(0x7a7470);
  const walledMat = stoneMat(0x5e5a56);
  const archMat = stoneMat(0x6a6260);
  const glowAscend = surfaceMat({
    color: 0xffee88,
    emissive: 0xddcc44,
    emissiveIntensity: 0.7,
    roughness: 0.5,
    metalness: 0.0,
    flatShading: !GFX.standardMaterials,
  });

  // Side walls flanking the stairwell.
  for (const sx of [-1.8, 1.8]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 4.5), walledMat);
    wall.position.set(sx, 2.25, 1.0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Arch top.
  const archTop = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 0.5), archMat);
  archTop.position.set(0, 4.25, -1.0);
  archTop.castShadow = true;
  group.add(archTop);

  // 5 stair steps ascending into the back.
  for (let s = 0; s < 5; s++) {
    const stepW = 3.0;
    const stepH = 0.55;
    const stepD = 0.85;
    const step = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH * (s + 1), stepD), stairMat);
    step.position.set(0, (stepH * (s + 1)) / 2, -s * stepD + 1.5);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  // Warm glow at the top of the stairs (light beyond).
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), glowMat(0xffee44, 0.22));
  glowPlane.position.set(0, 3.5, -3.2);
  group.add(glowPlane);

  // Arrow marker (pointing up) on each side wall.
  for (const sx of [-1.3, 1.3]) {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 3), glowAscend);
    arrow.position.set(sx, 2.0, -0.5);
    arrow.rotation.z = sx < 0 ? 0 : 0;
    group.add(arrow);
  }

  const light = new THREE.PointLight(0xffdd88, 1.4, 8, 2);
  light.position.set(0, 3.5, -2.0);
  group.add(light);

  return { group, height: 5.0 };
}

// ---------------------------------------------------------------------------
// delve_destructible_wall, cracked masonry wall section (80 HP breakable)
// ---------------------------------------------------------------------------
function buildDestructibleWall(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  const wallMat = stoneMat(0x6a6460);
  const crackMat = stoneMat(0x3a3632);
  const chunkMat = stoneMat(0x5a5450);

  // Main wall section, wide and tall, slightly less than the aisle width.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(7.0, 6.0, 0.8), wallMat);
  wall.position.y = 3.0;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // Stone block grid lines (darker strips to show masonry courses).
  const blockWide = 1.8;
  const blockTall = 1.0;
  // Horizontal mortar lines.
  for (let row = 1; row < 6; row++) {
    const mortar = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.06, 0.86), crackMat);
    mortar.position.y = row * blockTall;
    group.add(mortar);
  }
  // Vertical mortar lines (staggered per row).
  for (let row = 0; row < 6; row++) {
    const offset = (row % 2) * (blockWide / 2);
    for (let col = 0; col < 5; col++) {
      const mortar = new THREE.Mesh(new THREE.BoxGeometry(0.06, blockTall, 0.86), crackMat);
      mortar.position.set(-3.5 + offset + col * blockWide, row * blockTall + blockTall / 2, 0);
      group.add(mortar);
    }
  }

  // Crack fissures across the face.
  const crackDefs = [
    { x: 0.4, y: 3.2, w: 0.1, h: 2.8, rz: 0.15 },
    { x: -0.8, y: 2.0, w: 0.08, h: 1.8, rz: -0.2 },
    { x: 1.5, y: 1.5, w: 0.07, h: 1.4, rz: 0.08 },
  ] as const;
  for (const c of crackDefs) {
    const fissure = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, 0.9), crackMat);
    fissure.position.set(c.x, c.y, 0);
    fissure.rotation.z = c.rz;
    group.add(fissure);
  }

  // Fallen rubble chunks at the base.
  const chunkDefs: [number, number, number][] = [
    [-2.0, 0, 0.6],
    [0.5, 0, 0.8],
    [2.5, 0, 0.5],
    [-0.8, 0, -0.5],
    [1.8, 0, -0.3],
  ];
  for (const [cx, , cz] of chunkDefs) {
    const cw = 0.5 + (Math.abs(cx * entityId) % 5) * 0.08;
    const ch = 0.25 + (Math.abs(cz * entityId) % 4) * 0.06;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.4), chunkMat);
    chunk.position.set(cx, ch / 2, cz);
    chunk.rotation.y = ((cx * 7 + cz * 11) % 6) * 0.2;
    chunk.receiveShadow = true;
    group.add(chunk);
  }

  return { group, height: 6.5 };
}

// ---------------------------------------------------------------------------
// Fallback crate (for unknown delve_* ids)
// ---------------------------------------------------------------------------
function buildFallbackCrate(entityId: number): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  group.rotation.y = ((entityId * 17) % 7) * 0.45;

  const woodMat = stoneMat(0x5a4228);
  const ironMat2 = ironMat(0x303030);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.0), woodMat);
  body.position.y = 0.45;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  for (const sy of [0.18, 0.72]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 1.02), ironMat2);
    band.position.y = sy;
    group.add(band);
  }

  return { group, height: 1.0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a procedural Three.js mesh for a delve interactable entity.
 * `templateId` is the entity's templateId (e.g. 'delve_locked_door').
 * `entityId` drives any deterministic variation (no Math.random).
 * Returns `{ group, height }` where height is used to place the nameplate.
 */
export function buildDelveInteractable(
  templateId: string,
  entityId: number,
): { group: THREE.Group; height: number } {
  switch (templateId) {
    case 'delve_locked_door':
      return buildLockedDoor();
    case 'delve_pressure_plate':
      return buildPressurePlate(false, entityId);
    case 'delve_pressure_plate_triggered':
      return buildPressurePlate(true, entityId);
    case 'delve_cracked_grave':
      return buildCrackedGrave(entityId);
    case 'delve_module_exit':
      return buildModuleExit();
    case 'delve_reward_chest':
      return buildRewardChest(entityId);
    case 'delve_locked_chest':
      return buildLockedChest(entityId);
    case 'delve_surface_exit':
      return buildSurfaceExit();
    case 'delve_destructible_wall':
      return buildDestructibleWall(entityId);
    default:
      return buildFallbackCrate(entityId);
  }
}
