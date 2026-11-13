// Export the Hammer vein as the game places it (src/render/smith_heart/
// hammer_kit_plan_core.ts) plus its walked floors as a height grid, for the
// Blender review scene (docs/design/raid/kit/open_quarry_in_blender.py).
// Evidence tooling, not a repo test.
//
//   npx tsx scripts/smith_heart_hammer_scene_export.ts <out.json> [x0 x1 z0 z1]

import { writeFileSync } from 'node:fs';
import { planHammerKit } from '../src/render/smith_heart/hammer_kit_plan_core';
import { SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const out = process.argv[2] ?? 'tmp/smith_heart_hammer_scene.json';
const [x0, x1, z0, z1] = (
  process.argv.slice(3).map(Number).length === 4
    ? process.argv.slice(3).map(Number)
    : [-60, 110, -250, -105]
) as [number, number, number, number];
const step = 1.5;
const heights: (number | null)[][] = [];
for (let z = z0; z <= z1; z += step) {
  const row: (number | null)[] = [];
  for (let x = x0; x <= x1; x += step) {
    row.push(
      authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)
        ? authoredFieldHeight(SMITH_HEART_FIELD, x, z)
        : null,
    );
  }
  heights.push(row);
}
const placements = planHammerKit().filter(
  (p) => p.x >= x0 - 20 && p.x <= x1 + 20 && p.z >= z0 - 20 && p.z <= z1 + 20,
);
writeFileSync(out, JSON.stringify({ grid: { x0, z0, step, heights }, placements }));
console.log(`${out}: ${placements.length} placements, ${heights.length} grid rows`);
