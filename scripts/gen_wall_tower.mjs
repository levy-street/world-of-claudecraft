// Generate public/models/city/wall_tower.glb, the City Build castle wall
// tower with a WALK-THROUGH arcade top. The upper level is an open colonnade
// (six pillars under an overhanging hex roof) whose floor the wall's rampart
// deck aligns to (city_build_core.ts WALL_TOWER_SRC mirrors these numbers, and
// wallTowerFit() scales the placement so deckY lands exactly on the wall's
// walk height). Authored in real yards; render/asset_scale.ts pins the
// normalization target to the model height so placement scale 1 = these yards.
//
// Run: node scripts/gen_wall_tower.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

// ---- blueprint (KEEP IN SYNC with WALL_TOWER_SRC in city_build_core.ts) ----
const HEIGHT = 9.6;
const BASE = { r0: 1.95, r1: 1.8, y0: 0, y1: 0.5 };
const SHAFT = { r0: 1.8, r1: 1.58, y0: 0.5, y1: 4.2 };
const DECK = { r: 2.05, y0: 4.2, y1: 4.5 };
const PILLAR = { r: 1.7, half: 0.17, y0: 4.5, y1: 7.2 };
const LINTEL = { r: 1.88, y0: 7.2, y1: 7.5 };
const ROOF = { r: 2.5, y0: 7.5, y1: HEIGHT };

// Flat-shaded triangle soup per material bucket.
function bucket() {
  return { pos: [], nrm: [], idx: [] };
}
function pushTri(b, a, c, d) {
  const ux = c[0] - a[0];
  const uy = c[1] - a[1];
  const uz = c[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const base = b.pos.length / 3;
  for (const p of [a, c, d]) {
    b.pos.push(p[0], p[1], p[2]);
    b.nrm.push(nx, ny, nz);
  }
  b.idx.push(base, base + 1, base + 2);
}
function pushQuad(b, a, c, d, e) {
  pushTri(b, a, c, d);
  pushTri(b, a, d, e);
}

// Hex ring vertex at slot k (flat sides face the six cardinal-ish directions;
// pillars sit on the same +30deg vertex angles as wallTowerFit's hitboxes).
function hexPoint(r, y, k) {
  const a = (Math.PI / 3) * k + Math.PI / 6;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

function hexPrism(b, r0, r1, y0, y1, { capTop = false, capBottom = false } = {}) {
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    pushQuad(
      b,
      hexPoint(r0, y0, k),
      hexPoint(r0, y0, k2),
      hexPoint(r1, y1, k2),
      hexPoint(r1, y1, k),
    );
  }
  if (capTop) {
    const c = [0, y1, 0];
    for (let k = 0; k < 6; k++) pushTri(b, c, hexPoint(r1, y1, (k + 1) % 6), hexPoint(r1, y1, k));
  }
  if (capBottom) {
    const c = [0, y0, 0];
    for (let k = 0; k < 6; k++) pushTri(b, c, hexPoint(r0, y0, k), hexPoint(r0, y0, (k + 1) % 6));
  }
}

function hexCone(b, r, y0, apexY, { capBottom = false } = {}) {
  const apex = [0, apexY, 0];
  for (let k = 0; k < 6; k++) {
    pushTri(b, hexPoint(r, y0, k), hexPoint(r, y0, (k + 1) % 6), apex);
  }
  if (capBottom) {
    const c = [0, y0, 0];
    for (let k = 0; k < 6; k++) pushTri(b, c, hexPoint(r, y0, k), hexPoint(r, y0, (k + 1) % 6));
  }
}

function box(b, cx, cy, cz, hx, hy, hz) {
  const v = (sx, sy, sz) => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
  pushQuad(b, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); // +z
  pushQuad(b, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); // -z
  pushQuad(b, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); // +x
  pushQuad(b, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); // -x
  pushQuad(b, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); // +y
  pushQuad(b, v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)); // -y
}

const stone = bucket();
const stoneDark = bucket();
const roof = bucket();

hexPrism(stoneDark, BASE.r0, BASE.r1, BASE.y0, BASE.y1, { capTop: true });
hexPrism(stone, SHAFT.r0, SHAFT.r1, SHAFT.y0, SHAFT.y1);
hexPrism(stoneDark, DECK.r, DECK.r, DECK.y0, DECK.y1, { capBottom: true });
// The arcade floor players walk across (its own cap so it reads lighter).
{
  const c = [0, DECK.y1, 0];
  for (let k = 0; k < 6; k++) {
    pushTri(stone, c, hexPoint(DECK.r, DECK.y1, (k + 1) % 6), hexPoint(DECK.r, DECK.y1, k));
  }
}
for (let k = 0; k < 6; k++) {
  const a = (Math.PI / 3) * k + Math.PI / 6;
  box(
    stone,
    Math.cos(a) * PILLAR.r,
    (PILLAR.y0 + PILLAR.y1) / 2,
    Math.sin(a) * PILLAR.r,
    PILLAR.half,
    (PILLAR.y1 - PILLAR.y0) / 2,
    PILLAR.half,
  );
}
hexPrism(stoneDark, LINTEL.r, LINTEL.r, LINTEL.y0, LINTEL.y1, { capBottom: true, capTop: true });
hexCone(roof, ROOF.r, ROOF.y0, ROOF.y1, { capBottom: true });

// ---- write the GLB ---------------------------------------------------------
const doc = new Document();
const gltfBuffer = doc.createBuffer();
const scene = doc.createScene('wall_tower');
// baseColorFactor is LINEAR; author in sRGB (what the eye expects) and convert.
const srgb = (r, g, b) => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2, 1];
const matStone = doc
  .createMaterial('tower_stone')
  .setBaseColorFactor(srgb(139, 142, 150))
  .setRoughnessFactor(0.95)
  .setMetallicFactor(0);
const matStoneDark = doc
  .createMaterial('tower_stone_dark')
  .setBaseColorFactor(srgb(96, 99, 108))
  .setRoughnessFactor(0.95)
  .setMetallicFactor(0);
const matRoof = doc
  .createMaterial('tower_roof')
  .setBaseColorFactor(srgb(74, 140, 92))
  .setRoughnessFactor(0.85)
  .setMetallicFactor(0);

const mesh = doc.createMesh('wall_tower');
for (const [b, mat] of [
  [stone, matStone],
  [stoneDark, matStoneDark],
  [roof, matRoof],
]) {
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(b.pos))
    .setBuffer(gltfBuffer);
  const normal = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(b.nrm))
    .setBuffer(gltfBuffer);
  const indices = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array(b.idx))
    .setBuffer(gltfBuffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setIndices(indices)
    .setMaterial(mat);
  mesh.addPrimitive(prim);
}
scene.addChild(doc.createNode('wall_tower').setMesh(mesh));

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outPath = path.resolve(root, 'public/models/city/wall_tower.glb');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const glb = await new NodeIO().writeBinary(doc);
fs.writeFileSync(outPath, glb);
console.log(`wrote ${outPath} (${glb.byteLength} bytes)`);
