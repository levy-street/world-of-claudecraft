// The Blossom Temple grove, render-only and fully procedural (no asset files):
// cherry trees, a three-tier temple with upturned eaves, a gate arch, a koi
// pond, a stone path, stone lanterns, and a slow fall of petals. Layout comes
// from src/sim/content/cherry_grove.ts, the same records the sim builds the
// colliders from. Built as part of the Evergarden's zone features
// (garden_features.ts adds this group and drives update(time)).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CHERRY_GATE,
  CHERRY_GROVE_CENTER,
  CHERRY_LANTERNS,
  CHERRY_PATH,
  CHERRY_POND,
  CHERRY_TEMPLE,
  CHERRY_TREES,
} from '../sim/content/cherry_grove';
import { BLOSSOM_TRAINING_MAT } from '../sim/content/blossom_temple';
import { KATANA_TABLE } from '../sim/content/katana_forge';
import { hash2 } from '../sim/rng';
import { terrainHeight } from '../sim/world';
import { GFX } from './gfx';

export interface CherryGroveView {
  group: THREE.Group;
  update(time: number): void;
}

const BLOSSOM_PINKS = [0xf4b6cb, 0xfbdce8];
const BARK = 0x5e4652;
const TEMPLE_RED = 0xa8322a;
const TEMPLE_WOOD = 0x4a2a22;
const ROOF_TILE = 0x2e3440;
const PLASTER = 0xe9e1cf;
const GOLD = 0xd9a441;
const STONE = 0x9c9a92;
const PETAL_COUNT = 240;

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

const plain = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return n;
};
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts.map(plain)) as THREE.BufferGeometry;

function cherryTreeGeo(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const wood: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.32, 2.4, 6);
  trunk.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.12));
  trunk.translate(0.05, 1.2, 0);
  wood.push(trunk);
  const boughs = [
    { yaw: 0.3, lean: 0.8, len: 1.6 },
    { yaw: 2.4, lean: 0.95, len: 1.4 },
    { yaw: 4.4, lean: 0.6, len: 1.3 },
    { yaw: 5.6, lean: 1.05, len: 1.2 },
  ];
  const tips: THREE.Vector3[] = [];
  for (const b of boughs) {
    const g = new THREE.CylinderGeometry(0.05, 0.11, b.len, 4);
    g.translate(0, b.len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(b.lean));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(b.yaw));
    g.translate(0.05, 2.2, 0);
    wood.push(g);
    tips.push(
      new THREE.Vector3(
        0.05 + Math.cos(b.yaw) * Math.sin(b.lean) * b.len,
        2.2 + Math.cos(b.lean) * b.len,
        -Math.sin(b.yaw) * Math.sin(b.lean) * b.len,
      ),
    );
  }
  const puffs: THREE.BufferGeometry[] = [];
  const puff = (s: number, x: number, y: number, z: number) => {
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.scale(1.2, 0.8, 1.2);
    g.translate(x, y, z);
    puffs.push(g);
  };
  tips.forEach((t, i) => {
    puff(0.7 + (i % 2) * 0.12, t.x, t.y, t.z);
    puff(0.5, t.x * 1.2, t.y + 0.35, t.z * 1.2);
    puff(0.42, t.x * 0.7, t.y - 0.3, t.z * 0.7 + 0.2);
  });
  puff(0.6, 0.05, 3.6, 0);
  return { trunk: merge(wood), canopy: merge(puffs) };
}

// One pagoda tier roof: a flat square slab with four upturned corner tips.
function roofTier(half: number, y: number, thick: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const slab = new THREE.CylinderGeometry(half * 0.55, half * 1.42, thick, 4, 1);
  slab.rotateY(Math.PI / 4);
  slab.translate(0, y + thick / 2, 0);
  parts.push(slab);
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const tip = new THREE.ConeGeometry(0.22, 1.1, 4);
    tip.rotateZ(-sx * 0.9);
    tip.rotateX(sz * 0.9);
    tip.translate(sx * half * 1.0, y + 0.35, sz * half * 1.0);
    parts.push(tip);
  }
  return merge(parts);
}

function buildTemple(seed: number): THREE.Group {
  const g = new THREE.Group();
  const { x, z, half, rot } = CHERRY_TEMPLE;
  const y = terrainHeight(x, z, seed);
  g.position.set(x, y - 0.1, z);
  g.rotation.y = rot;

  const stone = mat(STONE, 0.95);
  const red = mat(TEMPLE_RED, 0.7);
  const wood = mat(TEMPLE_WOOD, 0.8);
  const roof = mat(ROOF_TILE, 0.6);
  const plaster = mat(PLASTER, 0.9);
  const gold = mat(GOLD, 0.4);

  // stone plinth with front steps (front is local +z)
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 1.6, 0.9, half * 2 + 1.6), stone);
  plinth.position.y = 0.45;
  g.add(plinth);
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 0.6), stone);
    step.position.set(0, 0.15 + i * 0.3, half + 0.8 + (2 - i) * 0.6);
    g.add(step);
  }

  // three tiers, each narrower: plaster walls, red corner posts, a dark roof
  const tiers = [
    { h: 3.2, w: half },
    { h: 2.6, w: half * 0.78 },
    { h: 2.2, w: half * 0.58 },
  ];
  let base = 0.9;
  const posts: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  for (const t of tiers) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(t.w * 2, t.h, t.w * 2), plaster);
    wall.position.y = base + t.h / 2;
    g.add(wall);
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const p = new THREE.BoxGeometry(0.38, t.h, 0.38);
      p.translate(sx * (t.w + 0.05), base + t.h / 2, sz * (t.w + 0.05));
      posts.push(p);
    }
    // a red beam band under each roof
    const band = new THREE.BoxGeometry(t.w * 2 + 0.3, 0.32, t.w * 2 + 0.3);
    band.translate(0, base + t.h - 0.16, 0);
    posts.push(band);
    roofs.push(roofTier(t.w + 0.9, base + t.h, 0.7));
    base += t.h + 0.7;
  }
  g.add(new THREE.Mesh(merge(posts), red));
  g.add(new THREE.Mesh(merge(roofs), roof));

  // front doorway and lattice on the ground tier
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.4, 0.12), wood);
  door.position.set(0, 0.9 + 1.2, half + 0.02);
  g.add(door);

  // golden spire
  const spireParts: THREE.BufferGeometry[] = [];
  const shaft = new THREE.CylinderGeometry(0.08, 0.14, 2.6, 6);
  shaft.translate(0, base + 1.3, 0);
  spireParts.push(shaft);
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.TorusGeometry(0.3 - i * 0.04, 0.06, 4, 10);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, base + 0.5 + i * 0.45, 0);
    spireParts.push(ring);
  }
  const jewel = new THREE.OctahedronGeometry(0.22, 0);
  jewel.translate(0, base + 2.75, 0);
  spireParts.push(jewel);
  g.add(new THREE.Mesh(merge(spireParts), gold));
  return g;
}

function buildGate(seed: number): THREE.Group {
  const g = new THREE.Group();
  const { x, z, halfSpan, rot } = CHERRY_GATE;
  g.position.set(x, terrainHeight(x, z, seed) - 0.15, z);
  g.rotation.y = rot;
  const red = mat(TEMPLE_RED, 0.7);
  const dark = mat(0x1d1d22, 0.7);
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const pillar = new THREE.CylinderGeometry(0.32, 0.38, 5.2, 8);
    pillar.translate(s * halfSpan, 2.6, 0);
    parts.push(pillar);
  }
  const tie = new THREE.BoxGeometry(halfSpan * 2 + 1.2, 0.36, 0.42);
  tie.translate(0, 4.1, 0);
  parts.push(tie);
  g.add(new THREE.Mesh(merge(parts), red));
  // the top lintel, darker and gently upswept at both ends
  const top = new THREE.BoxGeometry(halfSpan * 2 + 2.6, 0.45, 0.7, 6, 1, 1);
  const pos = top.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / (halfSpan + 1.3);
    pos.setY(i, pos.getY(i) + px * px * 0.45);
  }
  top.computeVertexNormals();
  top.translate(0, 5.35, 0);
  g.add(new THREE.Mesh(plain(top), dark));
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.4, 8), dark);
    foot.position.set(s * halfSpan, 0.2, 0);
    g.add(foot);
  }
  return g;
}

function lanternGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.4, 0.5, 0.25, 6);
  base.translate(0, 0.125, 0);
  parts.push(base);
  const post = new THREE.CylinderGeometry(0.14, 0.18, 0.8, 6);
  post.translate(0, 0.65, 0);
  parts.push(post);
  const box = new THREE.BoxGeometry(0.55, 0.45, 0.55);
  box.translate(0, 1.27, 0);
  parts.push(box);
  const cap = new THREE.ConeGeometry(0.55, 0.38, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 1.68, 0);
  parts.push(cap);
  const knob = new THREE.SphereGeometry(0.1, 5, 4);
  knob.translate(0, 1.92, 0);
  parts.push(knob);
  return merge(parts);
}

export function buildCherryGrove(seed: number): CherryGroveView {
  const group = new THREE.Group();
  group.name = 'cherry-grove';

  const instance = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    spots: { x: number; z: number; y: number; s: number; rot: number }[],
  ) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      v.set(sp.x, sp.y, sp.z);
      sc.setScalar(sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // --- cherry trees, two pinks ---
  {
    const tree = cherryTreeGeo();
    const spots = CHERRY_TREES.map((t) => ({
      x: t.x,
      z: t.z,
      y: terrainHeight(t.x, t.z, seed) - 0.15,
      s: t.scale,
      rot: t.rot,
      variant: t.variant,
    }));
    instance(tree.trunk, mat(BARK, 0.9), spots);
    for (const variant of [0, 1] as const) {
      instance(
        tree.canopy,
        mat(BLOSSOM_PINKS[variant], 0.8),
        spots.filter((sp) => sp.variant === variant),
      );
    }
  }

  group.add(buildTemple(seed));
  group.add(buildGate(seed));

  // --- stone path: flat slabs following the ground ---
  {
    const slabs: { x: number; z: number; y: number; s: number; rot: number }[] = [];
    for (let z = CHERRY_PATH.z0; z <= CHERRY_PATH.z1; z += 1.6) {
      const jitter = (hash2(Math.round(z * 10), 7, seed + 9101) - 0.5) * 0.3;
      const x = CHERRY_PATH.x + jitter;
      slabs.push({ x, z, y: terrainHeight(x, z, seed) + 0.02, s: 1, rot: jitter });
    }
    const slab = new THREE.BoxGeometry(CHERRY_PATH.halfWidth * 2, 0.12, 1.3);
    instance(slab, mat(0xb3ada0, 0.95), slabs);
  }

  // --- the courtyard training mat: a straw tatami with a dark border ---
  {
    const { x, z } = BLOSSOM_TRAINING_MAT;
    const y = terrainHeight(x, z, seed);
    const border = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 3.2), mat(0x3b2a22, 0.9));
    border.position.set(x, y + 0.04, z);
    group.add(border);
    const straw = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.1, 2.9), mat(0xc9b77a, 0.95));
    straw.position.set(x, y + 0.06, z);
    group.add(straw);
  }

  // --- the Katana Table: a low dark-wood table with a two-blade stand ---
  {
    const { x, z } = KATANA_TABLE;
    const y = terrainHeight(x, z, seed);
    const wood = mat(0x3a241a, 0.85);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.2), wood);
    top.position.set(x, y + 0.78, z);
    group.add(top);
    for (const [dx, dz] of [
      [-1.05, -0.48],
      [1.05, -0.48],
      [-1.05, 0.48],
      [1.05, 0.48],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.78, 0.12), wood);
      leg.position.set(x + dx, y + 0.39, z + dz);
      group.add(leg);
    }
    // the stand: two curved rests holding a sheathed blade and a bare one
    const lacquer = mat(0x7a1414, 0.5);
    const steel = mat(0xd0d6e0, 0.25);
    for (const [dz, m] of [
      [-0.25, lacquer],
      [0.2, steel],
    ] as const) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.06), m);
      blade.position.set(x, y + 1.12 + (dz > 0 ? 0.12 : 0), z + dz);
      blade.rotation.z = 0.04;
      group.add(blade);
    }
    for (const dx of [-0.6, 0.6]) {
      const rest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.7), wood);
      rest.position.set(x + dx, y + 1.05, z);
      group.add(rest);
    }
  }

  // --- stone lanterns ---
  instance(
    lanternGeo(),
    mat(STONE, 0.95),
    CHERRY_LANTERNS.map((l) => ({
      x: l.x,
      z: l.z,
      y: terrainHeight(l.x, l.z, seed) - 0.05,
      s: 1,
      rot: 0,
    })),
  );

  // --- koi pond: stone rim, still water, a few koi ---
  let koiRef: { mesh: THREE.InstancedMesh; x: number; z: number; y: number; r: number } | null =
    null;
  {
    const { x, z, r } = CHERRY_POND;
    const y = terrainHeight(x, z, seed);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 5, 20), mat(STONE, 0.95));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, y + 0.15, z);
    group.add(rim);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(r, 20),
      new THREE.MeshBasicMaterial({ color: 0x4f9fae, transparent: true, opacity: 0.85 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, y + 0.2, z);
    group.add(water);
    const koiGeo = new THREE.SphereGeometry(0.22, 6, 4);
    koiGeo.scale(1, 0.4, 2.2);
    const koi = new THREE.InstancedMesh(koiGeo, mat(0xf07a2a, 0.5), 5);
    koi.name = 'cherry-grove-koi';
    group.add(koi);
    koiRef = { mesh: koi, x, z, y: y + 0.12, r: r * 0.6 };
  }

  // --- falling petals: a looping drift over the grove ---
  const petalGeo = new THREE.PlaneGeometry(0.16, 0.12);
  const petals = new THREE.InstancedMesh(
    petalGeo,
    new THREE.MeshBasicMaterial({ color: 0xf8c8d8, side: THREE.DoubleSide }),
    PETAL_COUNT,
  );
  petals.name = 'cherry-grove-petals';
  petals.frustumCulled = false;
  group.add(petals);
  const petalSeeds = Array.from({ length: PETAL_COUNT }, (_, i) => ({
    a: hash2(i, 3, seed + 9201) * Math.PI * 2,
    r: 4 + hash2(i, 5, seed + 9203) * 36,
    phase: hash2(i, 7, seed + 9205),
    spin: 0.5 + hash2(i, 11, seed + 9207) * 2,
  }));
  const baseY = terrainHeight(CHERRY_GROVE_CENTER.x, CHERRY_GROVE_CENTER.z, seed);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const update = (time: number): void => {
    const FALL = 7; // seconds from canopy to ground
    for (let i = 0; i < PETAL_COUNT; i++) {
      const p = petalSeeds[i];
      const t = (time / FALL + p.phase) % 1;
      const x = CHERRY_GROVE_CENTER.x + Math.cos(p.a) * p.r + Math.sin(time * 0.6 + i) * 0.8;
      const z = CHERRY_GROVE_CENTER.z + Math.sin(p.a) * p.r + t * 3;
      v.set(x, baseY + 5.5 - t * 5.5, z);
      e.set(time * p.spin, time * p.spin * 0.7, i);
      q.setFromEuler(e);
      petals.setMatrixAt(i, m.compose(v, q, one));
    }
    petals.instanceMatrix.needsUpdate = true;
    if (koiRef) {
      for (let i = 0; i < 5; i++) {
        const a = time * (0.25 + i * 0.04) + i * 1.3;
        const rr = koiRef.r * (0.5 + (i % 3) * 0.25);
        v.set(koiRef.x + Math.cos(a) * rr, koiRef.y, koiRef.z + Math.sin(a) * rr);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a);
        koiRef.mesh.setMatrixAt(i, m.compose(v, q, one));
      }
      koiRef.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0); // seed instance matrices before attach (zone-feature contract)

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh !== petals) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  petals.castShadow = false;
  return { group, update };
}
