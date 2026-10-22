// Compile reviewed Studio spatial edits against current game definitions.
// --audit writes a migration report (including unresolved work).
// --write emits only a completely reconciled module; --check verifies freshness.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { canonicalWorldLayoutBase } from './lib/world_layout_base.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['--audit', '--check', '--write'].includes(mode) || process.argv.length > 5) {
  console.error(
    'Usage: node scripts/export_world_layout.mjs --audit|--check|--write [map.json] [review.json]',
  );
  process.exit(1);
}
const sourcePath = path.resolve(
  root,
  process.argv[3] ?? 'data/maps/eastbrook_and_mirefen_changes.map.json',
);
const reviewPath = path.resolve(
  root,
  process.argv[4] ?? 'data/world_layout/eastbrook_and_mirefen.review.json',
);
const source = readFileSync(sourcePath, 'utf8');
const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
if (
  !/^[0-9a-f]{40}$/.test(review.baseRevision) ||
  spawnSync('git', ['merge-base', '--is-ancestor', review.baseRevision, 'HEAD'], { cwd: root })
    .status !== 0
)
  throw new Error('The reviewed game base must be an ancestor of this checkout.');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
if (sourceSha256 !== review.sourceSha256)
  throw new Error(
    'Map changed since layout review. Review the new source before exporting; camp array bindings are snapshot-specific.',
  );
const scratch = mkdtempSync(path.join(tmpdir(), 'woc-layout-export-'));
try {
  const entry = path.join(scratch, 'compiler.mjs');
  await build({
    stdin: {
      contents: `
      import { BUILTIN_WORLD } from './src/sim/data';
      import { AUTHORED_TOWNS } from './src/sim/authored_town_registry';
      import { assetById } from './src/editor/asset_catalog.generated';
      import { compileWorldLayout, emitWorldLayoutModule } from './src/editor/world_layout_export';
      import { currentLayoutScenery } from './src/editor/world_layout_snapshot';
      export { emitWorldLayoutModule };
      export function compile(map, review) {
        const scenery = review.preserveMatchingScenery || review.collisionAdoptions?.length || review.decorationReplacements?.length || review.propReplacements?.length || review.streetlampBindings?.length || review.civicBindings?.length ? currentLayoutScenery() : undefined;
        const result = compileWorldLayout(map, BUILTIN_WORLD, AUTHORED_TOWNS.flatMap(t => t.buildings), review, scenery);
        const assets = map.placements.map(p => ({ uid: p.uid, assetId: p.assetId, path: assetById(p.assetId)?.path }));
        return { result, assets };
      }
    `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: entry,
    logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    // Always compile against current canonical content, never against the last
    // export's already-moved camps/buildings. Re-export must be idempotent.
    plugins: [canonicalWorldLayoutBase()],
  });
  const compiler = await import(pathToFileURL(entry).href);
  const { result, assets } = compiler.compile(JSON.parse(source), review);
  for (const asset of assets) {
    if (Object.hasOwn(review.excludedPlacements, asset.uid)) continue;
    const file = asset.path && path.resolve(root, 'public', asset.path.replace(/^\//, ''));
    const publicRoot = `${path.join(root, 'public')}${path.sep}`;
    if (!file?.startsWith(publicRoot) || !existsSync(file)) {
      result.issues.push({
        id: asset.uid ?? asset.assetId,
        reason: `Missing asset: ${asset.assetId}`,
      });
    }
  }
  if (mode === '--audit') {
    mkdirSync(path.join(root, 'tmp'), { recursive: true });
    const report = path.join(root, 'tmp/world-layout-export.json');
    writeFileSync(
      report,
      `${JSON.stringify({ sourceSha256, baseRevision: review.baseRevision, ...result }, null, 2)}\n`,
    );
    console.log(
      `Reviewed: ${Object.keys(result.layout.buildings).length} buildings, ${Object.keys(result.layout.npcs).length} NPC moves, ${result.layout.camps.length} camp edits, ${Object.keys(result.layout.groundObjects).length} ground objects, ${Object.keys(result.layout.objectMoves).length} object moves, ${result.layout.roads?.edits.length ?? 0} road edits, ${result.layout.roads?.additions.length ?? 0} new paths.`,
    );
    console.log(`${result.issues.length} unresolved checks. Report: ${report}`);
    for (const issue of result.issues) console.log(`- ${issue.id}: ${issue.reason}`);
  } else {
    const output = compiler.emitWorldLayoutModule(result, sourceSha256);
    const destination = path.join(root, 'src/sim/world_layout/active.ts');
    if (mode === '--write') writeFileSync(destination, output);
    else if (!existsSync(destination) || readFileSync(destination, 'utf8') !== output)
      throw new Error(
        'Generated world layout is stale. Run --write after resolving review issues.',
      );
    console.log(`${mode === '--write' ? 'Wrote' : 'Verified'} ${destination}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
