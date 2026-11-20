// Export the Ring as the game places it (src/render/smith_heart/
// ring_kit_plan_core.ts: the Ring's kit, the seal's quarters and heart, the
// spires with their veins), the mountain's rock and needles round it
// (heart_rock_plan_core.ts) and the walked floors as a height grid, for the
// Blender review scene (docs/design/raid/kit/open_ring_in_blender.py).
// Evidence tooling, not a repo test.
//
//   npx tsx scripts/smith_heart_ring_scene_export.ts <out.json>

import { writeFileSync } from 'node:fs';
import {
  planHeartLips,
  planHeartNeedles,
  planHeartRock,
  planHeartUnderCliffs,
} from '../src/render/smith_heart/heart_rock_plan_core';
import { HEART_SEAL_QUARTERS } from '../src/render/smith_heart/heart_seal_core';
import { planRingKit, ringSpireSpots } from '../src/render/smith_heart/ring_kit_plan_core';
import {
  SEAL_DAIS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEIN_COLORS,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const out = process.argv[2] ?? 'tmp/smith_heart_ring_scene.json';
const R = 150;
const x0 = -R;
const z0 = -R;
const step = 2;
const heights: (number | null)[][] = [];
for (let z = z0; z <= R; z += step) {
  const row: (number | null)[] = [];
  for (let x = x0; x <= R; x += step) {
    row.push(
      authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)
        ? authoredFieldHeight(SMITH_HEART_FIELD, x, z)
        : null,
    );
  }
  heights.push(row);
}
const near = (p: { x: number; z: number }, r: number) => Math.hypot(p.x, p.z) < r;
const ring = planRingKit().map((p) => ({ ...p, kit: 'ring' }));
// The seal: two veins lit (the Hammer's and the Breath's), as in the captures.
const lit = new Set(['hammer', 'breath']);
const seal = [
  ...HEART_SEAL_QUARTERS.map((q) => ({
    piece: 'Kit_SealQuarter',
    x: 0,
    y: SEAL_DAIS.h + 0.012,
    z: 0,
    rot: (q.bearingDeg * Math.PI) / 180,
    kit: 'ring',
    tint: SMITH_HEART_VEIN_COLORS[q.vein],
    lit: lit.has(q.vein),
  })),
  {
    piece: 'Kit_SealHeart',
    x: 0,
    y: SEAL_DAIS.h + 0.012,
    z: 0,
    rot: 0,
    kit: 'ring',
    tint: 0xfff0d0,
    lit: false,
  },
  ...ringSpireSpots().map((s) => ({
    piece: 'Kit_SealSpire',
    x: s.x,
    y: s.y,
    z: s.z,
    rot: s.rot,
    kit: 'ring',
    tint: SMITH_HEART_VEIN_COLORS[s.vein],
    lit: lit.has(s.vein),
  })),
];
const rock = [
  ...planHeartRock(),
  ...planHeartUnderCliffs(),
  ...planHeartLips(),
  ...planHeartNeedles(),
]
  .filter((p) => near(p, 260))
  .map((p) => ({ ...p, kit: 'rock' }));
const placements = [...ring, ...seal, ...rock];
writeFileSync(out, JSON.stringify({ grid: { x0, z0, step, heights }, placements }));
console.log(`${out}: ${placements.length} placements, ${heights.length} grid rows`);
