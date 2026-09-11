// Re-seat hand-authored Tidehold building collision onto the model BASE.
//
// The sim's override space has y=0 at the model's LOWEST vertex (the loader
// seats that on the ground). The Blender restyle gave several buildings a
// base course that hangs below their origin (castle -0.872, market -0.457,
// bank -0.148, houses -0.925), while their decks/boxes were authored from the
// origin - so every deck sat that far under the visible floor and the player
// waded waist-deep through the castle ("clipping into the ground").
// For each building: measure minY and maxDim from the shipped GLB, find the
// dominant up-facing floor plane, and if the lowest authored deck sits under it
// by about -minY, shift every box and deck up by -minY * norm. Idempotent:
// once the deck matches the floor nothing moves. Then gen_collision_overrides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

/** minY, maxDim and the up-facing floor planes (y from base -> area) of a GLB. */
export async function measureFloors(file) {
  const d = await io.read(file);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const hist = new Map();
  const walk = (n, mat) => {
    const m = mul(mat, n.getMatrix());
    const mesh = n.getMesh();
    if (mesh)
      for (const pr of mesh.listPrimitives()) {
        const a = pr.getAttribute('POSITION');
        const arr = a.getArray(),
          cnt = a.getCount();
        const P = [];
        for (let i = 0; i < cnt; i++) {
          const x = arr[i * 3],
            y = arr[i * 3 + 1],
            z = arr[i * 3 + 2];
          const p = [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          ];
          P.push(p);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
          }
        }
        const I = pr.getIndices()?.getArray() ?? null;
        const tri = I ? I.length / 3 : cnt / 3;
        for (let t = 0; t < tri; t++) {
          const A = P[I ? I[t * 3] : t * 3],
            B = P[I ? I[t * 3 + 1] : t * 3 + 1],
            C = P[I ? I[t * 3 + 2] : t * 3 + 2];
          const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
            v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
          const nx = u[1] * v[2] - u[2] * v[1],
            ny = u[2] * v[0] - u[0] * v[2],
            nz = u[0] * v[1] - u[1] * v[0];
          const len = Math.hypot(nx, ny, nz);
          if (len < 1e-9) continue;
          if (ny / len > 0.95) {
            const y = Math.round(((A[1] + B[1] + C[1]) / 3) * 10) / 10;
            hist.set(y, (hist.get(y) ?? 0) + len / 2);
          }
        }
      }
    n.listChildren().forEach((c) => {
      walk(c, m);
    });
  };
  for (const sc of d.getRoot().listScenes())
    sc.listChildren().forEach((n) => {
      walk(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    });
  const size = max.map((v, i) => v - min[i]);
  const floors = [...hist.entries()]
    .map(([y, area]) => ({ y: y - min[1], area }))
    .sort((a, b) => b.area - a.area);
  return { minY: min[1], maxDim: Math.max(...size), size, floors };
}

const BUILDINGS = ['castle', 'castle_b', 'hall', 'bank', 'market', 'smithy', 'tavern'];
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const overridesPath = path.join(root, 'data/asset_collision_overrides.json');
  const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
  const r4 = (v) => Math.round(v * 10000) / 10000;
  let changed = 0;
  for (const b of BUILDINGS) {
    const id = `tidehold/${b}`;
    const o = overrides[id];
    if (!o) continue;
    const m = await measureFloors(path.join(root, `public/models/tidehold/${b}.glb`));
    const norm = 2.2 / m.maxDim;
    const floor = m.floors[0].y; // dominant floor plane, yards from base
    const ramps = o.ramps ?? [];
    // the authored ground floor: the LARGEST flat deck (threshold aprons and
    // stair decks are small and can dip under the floor line by design)
    const main = ramps
      .filter((r) => Math.abs(r.y1 - r.y0) < 1e-6)
      .sort((a, b) => b.hx * b.hz - a.hx * a.hz)[0];
    if (!main) {
      console.log(`${id}: no flat deck, skipped`);
      continue;
    }
    const lowest = main.y0 / norm;
    const gap = floor - lowest;
    const want = -m.minY;
    const status =
      Math.abs(gap - want) < 0.2 && want > 0.05 ? 'SHIFT' : Math.abs(gap) < 0.25 ? 'ok' : 'unclear';
    console.log(
      `${id}: minY ${m.minY.toFixed(3)} floor ${floor.toFixed(2)} main deck ${lowest.toFixed(2)} gap ${gap.toFixed(2)} -> ${status}`,
    );
    if (status !== 'SHIFT') continue;
    const dy = want * norm;
    for (const bx of o.boxes ?? []) bx.y = r4(bx.y + dy);
    for (const r of ramps) {
      r.y0 = r4(r.y0 + dy);
      r.y1 = r4(r.y1 + dy);
    }
    changed++;
  }
  fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
  console.log(`re-seated ${changed} building(s)`);
}
