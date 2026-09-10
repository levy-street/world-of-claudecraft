// The ten per-locale item-name arrays in src/ui/i18n.catalog/items.ts are
// POSITIONAL against the legacy slice of ITEM_ENTITY_IDS. The merge took them
// from upstream, which still lists whistle_dragon; this branch removed that
// buddy, so every array carries one orphan translation and the build's own
// count guard refuses to run. Drop that one slot from each array.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/ui/i18n.catalog/items.ts';

function parse(source) {
  const idBlock = /const ITEM_ENTITY_IDS = \[([\s\S]*?)\n\] as const;/.exec(source);
  if (!idBlock) throw new Error('ITEM_ENTITY_IDS not found');
  const ids = [...idBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const appendedBlock = /APPENDED_ITEM_NAMES[^=]*= \{([\s\S]*?)\n\};/.exec(source);
  if (!appendedBlock) throw new Error('APPENDED_ITEM_NAMES not found');
  const appended = new Set([...appendedBlock[1].matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]));
  return { ids, appended };
}

const upstream = parse(execSync(`git show main:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 }));
const upstreamLegacy = upstream.ids.filter((id) => !upstream.appended.has(id));
const orphanIndex = upstreamLegacy.indexOf('whistle_dragon');
if (orphanIndex < 0) throw new Error('whistle_dragon is not in the upstream legacy slice');

const merged = readFileSync(path, 'utf8');
const eol = merged.includes('\r\n') ? '\r\n' : '\n';
const m = parse(merged);
const mergedLegacy = m.ids.filter((id) => !m.appended.has(id));
console.log(
  `orphan at legacy index ${orphanIndex}; upstream legacy ${upstreamLegacy.length}, merged legacy ${mergedLegacy.length}`,
);

const lines = merged.split(eol);
const out = [];
let inArray = false;
let entry = -1;
let removed = 0;
for (const line of lines) {
  if (/items: itemTranslations\(\[/.test(line)) {
    inArray = true;
    entry = -1;
    out.push(line);
    continue;
  }
  if (inArray) {
    if (/^\s*\]\),?\s*$/.test(line)) {
      inArray = false;
      out.push(line);
      continue;
    }
    if (line.trim() !== '') {
      entry++;
      if (entry === orphanIndex) {
        removed++;
        continue;
      }
    }
  }
  out.push(line);
}
writeFileSync(path, out.join(eol));
console.log(`dropped the orphan slot from ${removed} locale arrays`);
