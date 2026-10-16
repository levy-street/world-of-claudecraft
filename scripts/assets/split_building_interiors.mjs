// Split the furniture out of the explorable Tidehold buildings so the renderer
// can leave it undrawn until someone is near (SPACEY, 2026-09-18: "all of the
// buildings that have interiors shouldnt render the interior assets until you
// are 50yds away from the building or in the building ... only exception is
// the market building as that is open").
//
// The shipped GLBs merge every kit piece of a storey into one mesh per
// material, so furniture and walls share draws. The prefab-piece manifest
// (data/prefab_pieces/<name>.json, the record behind Studio's "Edit pieces")
// still knows every piece: its kit, seat and bounds. A triangle whose three
// vertices all sit inside one INTERIOR piece's box (a furniture-family kit
// standing inside the building's interior volume) moves to a sibling mesh
// under a new `G_INT` group inside the same storey group; walls, floors and
// roofs are far too large to fit any furniture box, so the shell is
// untouched. render/placed_assets.ts toggles every `G_INT*` node.
//
//   node scripts/assets/split_building_interiors.mjs [--dry] [name ...]
//
// Idempotent: a GLB that already carries G_INT groups is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const named = args.filter((a) => !a.startsWith('--'));
// The market is open-sided: its stalls ARE its look from the street.
const BUILDINGS = ['tavern', 'tavern_b', 'bank', 'smithy', 'hall', 'castle_b'];
const INTERIOR_FAMILIES =
  /^(Furniture|Candle|Carpet|Light|Table|Barrel|BarCounter|Bed|Lantern|Box|Weapon|Bottle|Shield|Chest|Cup|Book|Fire|PlateFood|Bag|Blacksmith|Scroll|Fireplace|Firewood|Helmet|Ink|Throne|Food|Altar|Potion|Pot|Flag|FlowerPot|Pointer)/;
const STOREY_GROUPS = ['G_L0', 'G_H1', 'G_H3'];
const BOX_PAD = 0.06;
const VOLUME_INSET = 0.25;

// The interior volumes, read from the one place that defines them.
function interiorVolumes() {
  const src = fs.readFileSync(path.join(root, 'src/render/interior_reveal.ts'), 'utf8');
  const out = {};
  for (const name of BUILDINGS) {
    const at = src.indexOf(`'/models/tidehold/${name}.glb'`);
    if (at < 0) continue;
    const end = src.indexOf('},\n  ', src.indexOf('volumes:', at));
    const block = src.slice(at, src.indexOf('],', at));
    out[name] = [
      ...block.matchAll(
        /x0:\s*(-?[\d.]+),\s*x1:\s*(-?[\d.]+),\s*y0:\s*(-?[\d.]+),\s*y1:\s*(-?[\d.]+),\s*z0:\s*(-?[\d.]+),\s*z1:\s*(-?[\d.]+)/g,
      ),
    ].map((m) => ({ x0: +m[1], x1: +m[2], y0: +m[3], y1: +m[4], z0: +m[5], z1: +m[6] }));
    void end;
  }
  return out;
}

function pieceBox(p) {
  const s = p.s ?? 1;
  const sx = s;
  const sy = s * (p.sy ?? 1);
  const sz = s * (p.sz ?? 1);
  const c = Math.cos(p.rotY ?? 0);
  const sn = Math.sin(p.rotY ?? 0);
  const b = {
    x0: Infinity,
    x1: -Infinity,
    y0: Infinity,
    y1: -Infinity,
    z0: Infinity,
    z1: -Infinity,
  };
  for (let i = 0; i < 8; i++) {
    const lx = (i & 1 ? p.max[0] : p.min[0]) * sx;
    const ly = (i & 2 ? p.max[1] : p.min[1]) * sy;
    const lz = (i & 4 ? p.max[2] : p.min[2]) * sz;
    // three's Y rotation: x' = x cos + z sin, z' = -x sin + z cos
    const wx = p.x + lx * c + lz * sn;
    const wz = p.z - lx * sn + lz * c;
    const wy = p.y + ly;
    b.x0 = Math.min(b.x0, wx);
    b.x1 = Math.max(b.x1, wx);
    b.y0 = Math.min(b.y0, wy);
    b.y1 = Math.max(b.y1, wy);
    b.z0 = Math.min(b.z0, wz);
    b.z1 = Math.max(b.z1, wz);
  }
  b.x0 -= BOX_PAD;
  b.y0 -= BOX_PAD;
  b.z0 -= BOX_PAD;
  b.x1 += BOX_PAD;
  b.y1 += BOX_PAD;
  b.z1 += BOX_PAD;
  return b;
}

const inBox = (b, x, y, z) =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const volumes = interiorVolumes();

for (const name of named.length > 0 ? named : BUILDINGS) {
  const file = path.join(root, 'public/models/tidehold', `${name}.glb`);
  const manifestFile = path.join(root, 'data/prefab_pieces', `${name}.json`);
  if (!fs.existsSync(file) || !fs.existsSync(manifestFile) || !volumes[name]) {
    console.log(`${name}: missing GLB, manifest or interior volume, skipped`);
    continue;
  }
  const doc = await io.read(file);
  const nodes = doc.getRoot().listNodes();
  if (nodes.some((n) => n.getName().startsWith('G_INT'))) {
    console.log(`${name}: already split, skipped`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const vols = volumes[name].map((v) => ({
    x0: v.x0 + VOLUME_INSET,
    x1: v.x1 - VOLUME_INSET,
    y0: v.y0 - 0.5,
    y1: v.y1,
    z0: v.z0 + VOLUME_INSET,
    z1: v.z1 - VOLUME_INSET,
  }));
  const boxes = [];
  for (const p of manifest.pieces) {
    const leaf = String(p.kit).split('/').pop();
    if (!INTERIOR_FAMILIES.test(leaf)) continue;
    const b = pieceBox(p);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    if (!vols.some((v) => inBox(v, cx, cy, cz))) continue;
    boxes.push(b);
  }
  // a coarse XZ grid over the boxes keeps the per-triangle test cheap
  const CELL = 2;
  const grid = new Map();
  boxes.forEach((b, i) => {
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++)
      for (let gz = Math.floor(b.z0 / CELL); gz <= Math.floor(b.z1 / CELL); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  let moved = 0;
  let total = 0;
  const buffer = doc.getRoot().listBuffers()[0];
  for (const groupName of STOREY_GROUPS) {
    const group = nodes.find((n) => n.getName() === groupName);
    if (!group) continue;
    let intGroup = null;
    for (const node of group.listChildren()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const world = node.getWorldMatrix();
      let intMesh = null;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!pos || !idx || prim.getMode() !== 4) continue;
        const n = pos.getCount();
        const wp = new Float32Array(n * 3);
        const e = [0, 0, 0];
        for (let v = 0; v < n; v++) {
          pos.getElement(v, e);
          wp[v * 3] = world[0] * e[0] + world[4] * e[1] + world[8] * e[2] + world[12];
          wp[v * 3 + 1] = world[1] * e[0] + world[5] * e[1] + world[9] * e[2] + world[13];
          wp[v * 3 + 2] = world[2] * e[0] + world[6] * e[1] + world[10] * e[2] + world[14];
        }
        const src = idx.getArray();
        const keep = [];
        const take = [];
        for (let t = 0; t + 2 < src.length; t += 3) {
          const a = src[t];
          const b = src[t + 1];
          const c = src[t + 2];
          total++;
          const cell = grid.get(
            `${Math.floor(wp[a * 3] / CELL)},${Math.floor(wp[a * 3 + 2] / CELL)}`,
          );
          let inside = false;
          if (cell) {
            for (const bi of cell) {
              const bx = boxes[bi];
              if (
                inBox(bx, wp[a * 3], wp[a * 3 + 1], wp[a * 3 + 2]) &&
                inBox(bx, wp[b * 3], wp[b * 3 + 1], wp[b * 3 + 2]) &&
                inBox(bx, wp[c * 3], wp[c * 3 + 1], wp[c * 3 + 2])
              ) {
                inside = true;
                break;
              }
            }
          }
          (inside ? take : keep).push(a, b, c);
        }
        if (take.length === 0) continue;
        moved += take.length / 3;
        if (!intGroup) {
          intGroup = doc.createNode(`G_INT_${groupName.slice(2)}`);
          group.addChild(intGroup);
        }
        if (!intMesh) {
          intMesh = doc.createMesh(`INT_${mesh.getName() || node.getName()}`);
          const intNode = doc
            .createNode(`INT_${node.getName()}`)
            .setMesh(intMesh)
            .setTranslation(node.getTranslation())
            .setRotation(node.getRotation())
            .setScale(node.getScale());
          intGroup.addChild(intNode);
        }
        const Arr = n > 65535 ? Uint32Array : Uint16Array;
        const taken = prim.clone();
        taken.setIndices(
          doc.createAccessor().setType('SCALAR').setArray(Arr.from(take)).setBuffer(buffer),
        );
        intMesh.addPrimitive(taken);
        if (keep.length === 0) mesh.removePrimitive(prim);
        else
          prim.setIndices(
            doc.createAccessor().setType('SCALAR').setArray(Arr.from(keep)).setBuffer(buffer),
          );
      }
    }
  }
  console.log(
    `${name}: ${boxes.length} interior pieces, ${moved} of ${total} storey triangles (${Math.round((100 * moved) / Math.max(1, total))}%) moved under G_INT${DRY ? ' [dry]' : ''}`,
  );
  if (DRY || moved === 0) continue;
  await doc.transform(
    prune({ keepLeaves: true, keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const before = fs.statSync(file).size;
  await io.write(file, doc);
  console.log(
    `   written ${(before / 1e6).toFixed(2)} MB -> ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`,
  );
}
