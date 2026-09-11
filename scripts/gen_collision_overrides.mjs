// Regenerate src/sim/asset_collision_overrides.generated.ts from
// data/asset_collision_overrides.json (the Collision Master author file).
// The dev-server save endpoint runs the same emit inline; this script exists
// so a hand-edited/merged JSON can be re-emitted without the editor:
//   node scripts/gen_collision_overrides.mjs
// Deterministic output: sorted asset ids, fixed number rounding, no
// timestamps — two runs on the same JSON are byte-identical.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitCollisionOverridesModule } from './lib/collision_overrides_emit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = path.resolve(root, 'data/asset_collision_overrides.json');
const outPath = path.resolve(root, 'src/sim/asset_collision_overrides.generated.ts');

const overrides = JSON.parse(readFileSync(jsonPath, 'utf8'));
const { source, errors } = emitCollisionOverridesModule(overrides);
if (errors.length > 0) {
  console.error('invalid overrides JSON:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
writeFileSync(outPath, source);
console.log(`wrote ${path.relative(root, outPath)} (${Object.keys(overrides).length} assets)`);
