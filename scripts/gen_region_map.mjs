#!/usr/bin/env node
// Regenerate a region's authored module from a saved map file, without the
// editor. Same pure core the "Export to production" button uses
// (src/editor/regions/region_export_core.ts), so the bytes are identical.
//
//   node scripts/gen_region_map.mjs path/to/ravenrift.wocmap.json
//   node scripts/gen_region_map.mjs path/to/map.json --check
//
// --check writes nothing and exits non-zero when the module on disk is stale,
// which is what a CI gate wants.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const mapPath = args.find((a) => !a.startsWith('--'));

if (!mapPath) {
  console.error('usage: node scripts/gen_region_map.mjs <map.json> [--check]');
  process.exit(2);
}

// The core is TypeScript; bundle it to a temp module so node can import it.
// Same trick the collision bake script uses to share one implementation
// between the browser and a node script.
const outDir = mkdtempSync(path.join(tmpdir(), 'woc-region-'));
const outFile = path.join(outDir, 'region_export_core.mjs');
try {
  await build({
    entryPoints: [path.join(root, 'src/editor/regions/region_export_core.ts')],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { emitRegionModule, regionExportFromMap, regionModulePath } = await import(
    pathToFileURL(outFile).href
  );

  const map = JSON.parse(readFileSync(path.resolve(mapPath), 'utf8'));
  if (!map.regionSource) {
    console.error(`${mapPath} is not a region map (no regionSource)`);
    process.exit(1);
  }
  const source = emitRegionModule(regionExportFromMap(map));
  const target = path.join(root, regionModulePath(map.regionSource));

  if (check) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = '';
    }
    if (current === source) {
      console.log(`${map.regionSource}: up to date`);
      process.exit(0);
    }
    console.error(`${map.regionSource}: ${regionModulePath(map.regionSource)} is stale`);
    process.exit(1);
  }

  writeFileSync(target, source);
  console.log(
    `${map.regionSource}: wrote ${regionModulePath(map.regionSource)} ` +
      `(${(source.length / 1024).toFixed(0)}KB)`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
