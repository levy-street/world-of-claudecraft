// One-time (and re-runnable) step for change-only pushes: give every repo map
// in data/maps permanent item ids (src/editor/map_item_ids.ts) and rewrite it
// in the repo layout (src/editor/persist.ts serializeMapForRepo, one
// placement, stamp and grass clearing per line).
//
// Refuses to write a map whose game-ready world would change (the ids never
// reach the game: the projection drops them, so the generated modules stay as
// they are), or one holding data the editor's loader would normalize away.
//
//   node scripts/vite_ssr_run.mjs scripts/map_item_ids_migrate.ts            every map
//   node scripts/vite_ssr_run.mjs scripts/map_item_ids_migrate.ts <slug>...  just those
// (through Vite's loader: the editor modules read import.meta.env)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { ensureMapItemIds } from '../src/editor/map_item_ids';
import { canonicalJson } from '../src/editor/map_merge_core';
import { parseMap, serializeMapCompact, serializeMapForRepo } from '../src/editor/persist';

const dataDir = path.resolve('data/maps');
const self = process.argv.findIndex((a) => a.endsWith('map_item_ids_migrate.ts'));
const asked = process.argv.slice(self + 1);
const slugs =
  asked.length > 0
    ? asked
    : readdirSync(dataDir)
        .filter((f) => f.endsWith('.map.json'))
        .map((f) => f.slice(0, -'.map.json'.length));

let failed = false;
for (const slug of slugs) {
  const file = path.join(dataDir, `${slug}.map.json`);
  const text = readFileSync(file, 'utf8');
  const map = parseMap(text);
  if (!map) {
    console.error(`${slug}: unreadable, skipped`);
    failed = true;
    continue;
  }
  // A file holding data the editor's loader would drop or normalize (it was
  // not written by Studio) would quietly lose it here: leave it for its owner.
  if (canonicalJson(JSON.parse(serializeMapCompact(map))) !== canonicalJson(JSON.parse(text))) {
    console.error(`${slug}: holds data the editor would normalize, not written`);
    failed = true;
    continue;
  }
  const before = canonicalJson(customMapToWorldContent(structuredClone(map)));
  const minted = ensureMapItemIds(map);
  const after = canonicalJson(customMapToWorldContent(structuredClone(map)));
  if (before !== after) {
    console.error(`${slug}: the game-ready world would change, not written`);
    failed = true;
    continue;
  }
  const out = serializeMapForRepo(map);
  if (out === text) {
    console.log(`${slug}: already migrated`);
    continue;
  }
  writeFileSync(file, out);
  console.log(`${slug}: ${minted} ids minted, rewritten in the repo layout`);
}
if (failed) process.exitCode = 1;
