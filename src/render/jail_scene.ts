// The moderation jail: a stone gaol assembled from the KayKit dungeon kit
// (same GLB modules, shared pack material and instancing pattern as
// src/render/dungeon.ts). Visual counterpart of the sim-side layout in
// src/sim/jail.ts: the outer wall and the cage line up with JAIL_BLOCKERS, so
// what players collide with is what they see. A black backdrop shell just
// outside the walls hides the open-world horizon.
import * as THREE from 'three';
import { JAIL_CAGE_HALF, JAIL_CENTER, JAIL_GATE, JAIL_OUTER_HALF } from '../sim/jail';
import { groundHeight } from '../sim/world';
import { registerPreload } from './assets/preload';
import { buildDungeonPropMesh, ensureDungeonAssets, loadKitModules } from './dungeon';
import { GFX } from './gfx';
import { freezeStaticMatrices } from './static_matrix';
import { radialGlowTexture } from './textures';

// Kit modules the dungeon interiors do not load; fetched on demand alongside
// ensureDungeonAssets() and served through the same registry.
const JAIL_EXTRA_KIT = [
  'bed_floor',
  'bucket',
  'keyring_hanging',
  'post_lantern',
  'stool',
  'table_medium_decorated_a',
] as const;

export function ensureJailAssets(): Promise<void> {
  return Promise.all([ensureDungeonAssets(), loadKitModules(JAIL_EXTRA_KIT)]).then(() => undefined);
}

// Same boot-preload fold as the dungeon kit: the renderer builds the jail
// synchronously right after assetsReady(), so the modules must be resolved.
if (typeof window !== 'undefined') registerPreload(ensureJailAssets());

const MODULE_SCALE = 2; // KayKit walls are 4u tall/long -> 8u here (dungeon.ts convention)
const MODULE_LEN = 4 * MODULE_SCALE;
const FLOOR_CELL = 4; // kit floor tiles are 4x4 at scale 1
const FLOOR_Y = 0.02; // tile tops land ~0.07 above the levelled terrain (no z-fight)
const PILLAR_XZ_SCALE = 1.3;
const TORCH_Y = 5.5;
const FLAME_Y = 6.6;
const BACKDROP_HEIGHT = 30;
const BACKDROP_OFFSET = 2.5; // black shell distance outside the outer wall
const TORCH_LIGHT_COLOR = 0xff9440;
const FLAME_COLOR = 0xffc266;
const FLAME_EMISSIVE = 0xff8830;
// The moderator gate's z in group-local coords (JAIL_GATE is world-space).
const GATE_Z = JAIL_GATE.z - JAIL_CENTER.z;
const GATE_ARCH_SCALE = 1.25;
// Arch proud of the cage wall face (wall is 2u thick at MODULE_SCALE, so the
// face sits at half-thickness 1 from the centreline).
const GATE_ARCH_OFFSET = 1.05;
const FILTH_COLORS = [0x5c431c, 0x46310f];

// Deterministic per-position hash (same trick as dungeon.ts / the prop jitter).
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function pickKind(kinds: [name: string, weight: number][], t: number): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = 0;
  for (const [name, w] of kinds) {
    acc += w;
    if (t * total < acc) return name;
  }
  return kinds[kinds.length - 1][0];
}

const CASTER_KINDS = new Set([
  'wall',
  'wall_cracked',
  'wall_pillar',
  'wall_gated',
  'pillar',
  'post_lantern',
  'table_medium_decorated_a',
  'stool',
  'barrel_large',
  'keg',
  'crates_stacked',
  'box_small',
  'trunk_large_A',
  'sword_shield',
  'bed_floor',
]);
const RECEIVER_KINDS = new Set([
  'floor_tile_large',
  'floor_tile_large_rocks',
  'floor_dirt_large',
  'floor_dirt_large_rocky',
]);

/** Accumulates instance transforms per module kind (dungeon.ts pattern). */
class JailPlacements {
  readonly byKind = new Map<string, THREE.Matrix4[]>();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  add(
    kind: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scale: number | [number, number, number] = MODULE_SCALE,
  ): void {
    const m = new THREE.Matrix4();
    this.pos.set(x, y, z);
    this.quat.setFromEuler(this.euler.set(0, rotY, 0));
    if (typeof scale === 'number') this.scl.set(scale, scale, scale);
    else this.scl.set(scale[0], scale[1], scale[2]);
    m.compose(this.pos, this.quat, this.scl);
    const list = this.byKind.get(kind);
    if (list) list.push(m);
    else this.byKind.set(kind, [m]);
  }
}

function wallKind(t: number): string {
  return pickKind(
    [
      ['wall', 62],
      ['wall_cracked', 22],
      ['wall_pillar', 16],
    ],
    t,
  );
}

function floorKind(t: number): string {
  return pickKind(
    [
      ['floor_tile_large', 66],
      ['floor_tile_large_rocks', 12],
      ['floor_dirt_large', 12],
      ['floor_dirt_large_rocky', 10],
    ],
    t,
  );
}

function placeFloor(p: JailPlacements): void {
  const half = JAIL_OUTER_HALF - FLOOR_CELL / 2;
  const quarter = Math.PI / 2;
  for (let z = -half; z <= half + 0.001; z += FLOOR_CELL) {
    for (let x = -half; x <= half + 0.001; x += FLOOR_CELL) {
      const rot = Math.floor(hash2(z, x) * 4) * quarter;
      p.add(floorKind(hash2(x * 1.31, z)), x, FLOOR_Y, z, rot, 1);
    }
  }
}

function placeOuterWalls(p: JailPlacements): void {
  const half = JAIL_OUTER_HALF;
  const from = -half + MODULE_LEN / 2 - 1; // 10 modules, slight corner overlap
  for (const side of [-1, 1]) {
    const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2; // wall detail faces the room
    for (let z = from; z < half; z += MODULE_LEN) {
      p.add(wallKind(hash2(side * 13.7, z)), side * half, 0, z, ry);
    }
    for (let x = from; x < half; x += MODULE_LEN) {
      p.add(wallKind(hash2(x, side * 3.1)), x, 0, side * half, side < 0 ? 0 : Math.PI);
    }
  }
  for (const cx of [-half, half]) {
    for (const cz of [-half, half]) {
      p.add('pillar', cx, 0, cz, 0, [PILLAR_XZ_SCALE, MODULE_SCALE, PILLAR_XZ_SCALE]);
    }
  }
  // Marshal colors on the visitor-side (east) wall.
  p.add('banner_shield_blue', half, 0, -12, -Math.PI / 2);
  p.add('banner_triple_blue', half, 0, 4, -Math.PI / 2);
}

// The cage: stone-and-bars 'wall_gated' modules stretched to span the sim's
// JAIL_CAGE_HALF square exactly, with kit pillars on the corners. The cage is
// sealed on purpose (players enter and leave only by moderator teleport), so
// there is no door piece; the keyring by the east face marks the "entrance".
function placeCage(p: JailPlacements): void {
  const half = JAIL_CAGE_HALF;
  const count = Math.max(1, Math.round((half * 2) / MODULE_LEN));
  const pitch = (half * 2) / count;
  const stretch: [number, number, number] = [
    (MODULE_SCALE * pitch) / MODULE_LEN,
    MODULE_SCALE,
    MODULE_SCALE,
  ];
  for (let i = 0; i < count; i++) {
    const v = -half + pitch * (i + 0.5);
    p.add('wall_gated', -half, 0, v, -Math.PI / 2, stretch);
    p.add('wall_gated', half, 0, v, Math.PI / 2, stretch);
    p.add('wall_gated', v, 0, -half, Math.PI, stretch);
    p.add('wall_gated', v, 0, half, 0, stretch);
  }
  for (const cx of [-half, half]) {
    for (const cz of [-half, half]) {
      p.add('pillar', cx, 0, cz, 0, [PILLAR_XZ_SCALE, MODULE_SCALE, PILLAR_XZ_SCALE]);
    }
  }
}

// Cell furniture stays outside the jailCageSpawn ring (radius <= 11) so no one
// teleports into a cot.
function placeCellProps(p: JailPlacements): void {
  const wall = JAIL_CAGE_HALF - 2.6;
  for (const z of [-9, 0, 9]) {
    p.add('bed_floor', -wall, 0, z, Math.PI / 2 + (hash2(3.7, z) - 0.5) * 0.18);
  }
  p.add('bucket', wall - 0.6, 0, wall - 0.4, 0, 1.5);
  p.add('skull', -wall + 0.8, 0, -wall + 1.4, hash2(1.1, 2.2) * Math.PI * 2, 1.3);
  p.add('bone_A', -wall + 2.1, 0, -wall + 0.6, hash2(2.3, 4.1) * Math.PI * 2, 1.3);
  p.add('ribcage', -wall + 0.4, 0, -wall + 3.2, hash2(5.2, 1.7) * Math.PI * 2, 1.3);
}

// Guard post in the east aisle, between the cage and the visitor spawn.
function placeGuardPost(p: JailPlacements): void {
  const wall = JAIL_OUTER_HALF - 2.4;
  p.add('table_medium_decorated_a', 28, 0, -8, Math.PI / 2);
  p.add('stool', 25, 0, -6.2, 0.6, 1.7);
  p.add('stool', 30.6, 0, -5.6, -2.2, 1.7);
  p.add('sword_shield', wall, 0, -13, -Math.PI / 2);
  p.add('trunk_large_A', wall, 0, -3, -Math.PI / 2);
  p.add('barrel_large', wall, 0, 6.5, 0, 1.8);
  p.add('keg', wall - 0.4, 0, 9.6, 1.2, 1.8);
  p.add('crates_stacked', wall - 0.2, 0, 14, 0.2);
  p.add('box_small', wall - 2.6, 0, 15.4, 0.9, 1.7);
  // The cell keys, hung on the bars beside the gate arch.
  p.add('keyring_hanging', JAIL_CAGE_HALF + 0.45, 3.4, -9.6, Math.PI / 2);
  // Lanterns flank the walk from the visitor spawn to the gate.
  p.add('post_lantern', 21.5, 0, -0.6);
  p.add('post_lantern', 21.5, 0, -10.5);
}

// The moderator gate (JAIL_GATE): a kit stone arch over the marked bar panel,
// with an additive swirl on each face and a cool light pool. The swirl marks
// the spot for everyone; only sessions with the moderation permission
// actually pass (server/game.ts applyModeratorJailGate).
function placeGateArch(p: JailPlacements): void {
  p.add('arch', JAIL_CAGE_HALF, 0, GATE_Z, Math.PI / 2, GATE_ARCH_SCALE);
}

function addModeratorGate(group: THREE.Group): void {
  const swirlGeo = new THREE.CircleGeometry(1.7, 24);
  const swirlMat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: 0x9cc8ff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const swirl = new THREE.Mesh(swirlGeo, swirlMat);
    swirl.position.set(JAIL_CAGE_HALF + side * GATE_ARCH_OFFSET, 2.5, GATE_Z);
    swirl.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    swirl.scale.set(1, 1.4, 1);
    // Re-enabled after freezeStaticMatrices (see buildJailScene): the swirl
    // spins in place while everything around it stays frozen.
    swirl.userData.jailPortalSpin = true;
    swirl.onBeforeRender = () => {
      swirl.rotation.z = ((performance.now() % 3_600_000) / 1000) * -0.7;
    };
    group.add(swirl);
  }
  // One light on the wall centreline reaches both faces (points ignore
  // occlusion), so the gate glows from either side of the bars.
  const light = new THREE.PointLight(0x86b4ff, 9, 24, 2);
  light.position.set(JAIL_CAGE_HALF, 6, GATE_Z);
  group.add(light);
  const glowGeo = new THREE.CircleGeometry(4.4, 20).rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: 0x6a9cff,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(JAIL_CAGE_HALF + side * 2.2, FLOOR_Y + 0.08, GATE_Z);
    group.add(glow);
  }
}

// Grim latrine-corner stains by the cell bucket: flat, irregular blob decals
// (there is no kit asset for this particular prison amenity).
function stainGeometry(seed: number): THREE.BufferGeometry {
  const segments = 12;
  const geo = new THREE.CircleGeometry(1, segments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < pos.count; i++) {
    const r = 0.6 + hash2(seed, (i - 1) % segments) * 0.55;
    pos.setXY(i, pos.getX(i) * r, pos.getY(i) * r);
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function addFilthStains(group: THREE.Group): void {
  const wall = JAIL_CAGE_HALF - 2.6;
  const stains: [x: number, z: number, scale: number, seed: number][] = [
    [wall - 2.2, wall - 1.4, 0.62, 3.1],
    [wall - 1.0, wall - 2.3, 0.4, 7.7],
    [wall - 2.6, wall + 0.1, 0.3, 5.3],
  ];
  for (let i = 0; i < stains.length; i++) {
    const [x, z, scale, seed] = stains[i];
    const mat = new THREE.MeshLambertMaterial({ color: FILTH_COLORS[i % FILTH_COLORS.length] });
    const stain = new THREE.Mesh(stainGeometry(seed), mat);
    stain.position.set(x, FLOOR_Y + 0.075, z);
    stain.rotation.y = hash2(seed, 1.3) * Math.PI * 2;
    stain.scale.setScalar(scale);
    stain.receiveShadow = true;
    group.add(stain);
  }
}

// Light dressing in the far aisles so they do not read as empty corridors.
function placeAisleProps(p: JailPlacements): void {
  const wall = JAIL_OUTER_HALF - 2.4;
  p.add('box_stacked', -wall, 0, -27, hash2(4.4, 8.8));
  p.add('barrel_small_stack', -wall + 1.2, 0, -23.5, 0, 1.8);
  p.add('rubble_half', -wall + 0.6, 0, 26, hash2(6.1, 3.3) * Math.PI * 2, 0.9);
  p.add('bone_B', -25, 0, wall - 0.4, hash2(9.4, 2.6) * Math.PI * 2, 1.8);
  p.add('crates_stacked', 27, 0, -wall, Math.PI + 0.3);
  p.add('sword_shield_broken', -28, 0, -wall, 0.2);
}

function placeTorches(group: THREE.Group, p: JailPlacements): void {
  const half = JAIL_OUTER_HALF;
  const spots: { x: number; z: number; ry: number; dx: number; dz: number }[] = [];
  for (const v of [-20, 4, 28]) {
    spots.push(
      { x: -half, z: v, ry: Math.PI / 2, dx: 1, dz: 0 },
      { x: half, z: v, ry: -Math.PI / 2, dx: -1, dz: 0 },
      { x: v, z: -half, ry: 0, dx: 0, dz: 1 },
      { x: v, z: half, ry: Math.PI, dx: 0, dz: -1 },
    );
  }
  const flameGeo = new THREE.ConeGeometry(0.22, 0.6, 6);
  const flameMat = new THREE.MeshLambertMaterial({
    color: FLAME_COLOR,
    emissive: FLAME_EMISSIVE,
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.92,
  });
  const glowGeo = new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: TORCH_LIGHT_COLOR,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const s of spots) {
    p.add('torch_mounted', s.x + s.dx * 1.15, TORCH_Y, s.z + s.dz * 1.15, s.ry, 1.6);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(s.x + s.dx * 1.7, FLAME_Y, s.z + s.dz * 1.7);
    group.add(flame);
    if (GFX.tier !== 'low') {
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(s.x + s.dx * 1.7, FLOOR_Y + 0.07, s.z + s.dz * 1.7);
      group.add(glow);
    }
  }
}

// Black shell just outside the walls: blocks the open-world horizon through
// the wall seams and above the parapet without hiding the walls themselves.
function addBackdrop(group: THREE.Group): void {
  const dist = JAIL_OUTER_HALF + BACKDROP_OFFSET;
  const span = dist * 2 + 1;
  const mat = new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.DoubleSide });
  const y = BACKDROP_HEIGHT / 2 - 0.5;
  const panels: [number, number, number, number, number][] = [
    [span, BACKDROP_HEIGHT, 0.3, 0, -dist],
    [span, BACKDROP_HEIGHT, 0.3, 0, dist],
    [0.3, BACKDROP_HEIGHT, span, -dist, 0],
    [0.3, BACKDROP_HEIGHT, span, dist, 0],
  ];
  for (const [w, h, d, x, z] of panels) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
}

// Shared display materials: one tuned clone per pack source material (the
// dungeon interiors keep their own equivalent clones; the source stays
// immutable per the loader cache rule).
const displayMats = new Map<THREE.Material, THREE.Material>();

function displayMaterial(src: THREE.Material): THREE.Material {
  let mat = displayMats.get(src);
  if (mat) return mat;
  if (!GFX.standardMaterials) {
    mat = new THREE.MeshLambertMaterial({
      map: (src as THREE.MeshStandardMaterial).map ?? null,
    });
  } else {
    const std = (src as THREE.MeshStandardMaterial).clone();
    std.vertexColors = false;
    std.metalness = 0;
    std.roughness = Math.max(0.85, std.roughness);
    mat = std;
  }
  displayMats.set(src, mat);
  return mat;
}

function emit(group: THREE.Group, p: JailPlacements): void {
  for (const [kind, mats] of p.byKind) {
    const proto = buildDungeonPropMesh(kind);
    if (!proto) {
      console.warn(`jail: kit module not loaded '${kind}'`);
      continue;
    }
    const src = Array.isArray(proto.material) ? proto.material[0] : proto.material;
    const mesh = new THREE.InstancedMesh(proto.geometry, displayMaterial(src), mats.length);
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = GFX.tier !== 'low' && CASTER_KINDS.has(kind);
    mesh.receiveShadow = RECEIVER_KINDS.has(kind);
    group.add(mesh);
  }
}

export function buildJailScene(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'jail_scene';
  group.position.set(
    JAIL_CENTER.x,
    groundHeight(JAIL_CENTER.x, JAIL_CENTER.z, seed),
    JAIL_CENTER.z,
  );
  const p = new JailPlacements();
  placeFloor(p);
  placeOuterWalls(p);
  placeCage(p);
  placeCellProps(p);
  placeGuardPost(p);
  placeGateArch(p);
  placeAisleProps(p);
  placeTorches(group, p);
  emit(group, p);
  addModeratorGate(group);
  addFilthStains(group);
  addBackdrop(group);
  freezeStaticMatrices(group);
  // The gate swirls animate their own rotation (see addModeratorGate); give
  // them their matrices back after the freeze.
  group.traverse((o) => {
    if (o.userData.jailPortalSpin) o.matrixAutoUpdate = true;
  });
  return group;
}
