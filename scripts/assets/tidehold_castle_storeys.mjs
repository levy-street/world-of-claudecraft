// Re-seat the castle's UPPER storeys onto their own floors.
//
// Companion to tidehold_rebase_overrides.mjs, which fixes the whole building's
// base drift. This one fixes the second failure the restyle caused: the tile
// floors of the gallery and the terrace are ~0.3yd thicker than the floors
// bl_castle.py authored its colliders against, and those two surfaces are
// BOXES. A grounded mover steps DOWN onto a box top and never UP, so a slab
// topping 0.27yd under its own tiles drops the player through the gallery
// floor; the flights then summit on the OLD tops and end in mid-air.
//
// Both re-runs are needed after ANY castle re-export, because a re-merge
// rewrites the override from the build script's authored numbers:
//   node scripts/assets/tidehold_rebase_overrides.mjs
//   node scripts/assets/tidehold_castle_storeys.mjs
//   node scripts/gen_collision_overrides.mjs
//
// Idempotent, and derived from the GLB rather than pinned: it lifts only THIN
// slabs (under 1yd thick, the perimeter wall boxes share the 14.37 top and
// must not move) that sit just under a real floor plane, and re-ends only real
// FLIGHTS (a rise over 2yd) that stop just under one. Pinned to tests
// tidehold_ring_city ("walks the hall floor up the west flight...").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureFloors } from './tidehold_rebase_overrides.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const overridesPath = path.join(root, 'data/asset_collision_overrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const o = overrides['tidehold/castle'];
if (!o) {
  console.log('tidehold/castle: no override, nothing to do');
  process.exit(0);
}
const m = await measureFloors(path.join(root, 'public/models/tidehold/castle.glb'));
const norm = 2.2 / m.maxDim;
const r4 = (v) => Math.round(v * 10000) / 10000;
// The storey floors a player actually stands on: big planes, above the ground
// floor. Small planes are table tops and stair treads.
const decks = m.floors.filter((f) => f.y > 5 && (f.area ?? 0) > 100).map((f) => f.y);
// The plane just ABOVE `y`, if the gap is a floor's thickness rather than a storey.
const above = (y) => decks.filter((d) => d - y > 0.1 && d - y < 0.6).sort((a, b) => a - b)[0];
console.log(`storey floors (yd from base): ${decks.map((d) => d.toFixed(2)).join(', ')}`);

let moved = 0;
for (const b of o.boxes ?? []) {
  const top = (b.y + b.hy) / norm;
  if (top < 5 || 2 * (b.hy / norm) >= 1) continue; // only the thin storey slabs
  const deck = above(top);
  if (deck === undefined) continue;
  b.y = r4(b.y + (deck - top) * norm);
  console.log(`  slab top ${top.toFixed(2)} -> ${deck.toFixed(2)}`);
  moved++;
}
for (const r of o.ramps ?? []) {
  const y0 = r.y0 / norm;
  const y1 = r.y1 / norm;
  if (Math.abs(y1 - y0) < 2) continue; // a threshold lip, not a flight
  for (const key of ['y0', 'y1']) {
    const y = r[key] / norm;
    const deck = above(y);
    if (deck === undefined) continue;
    r[key] = r4((deck + 0.02) * norm); // land a hair PROUD of the boards
    console.log(`  flight ${key} ${y.toFixed(2)} -> ${(deck + 0.02).toFixed(2)}`);
    moved++;
  }
}
fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
console.log(`re-seated ${moved} castle storey shape(s)`);
