// One-off helper: inject Guide (guide.*) translations into the sparse locale overlays.
// Reads a JSON file { "<locale>": { "guide.x": "translation", ... }, ... } and appends
// the entries to src/ui/i18n.locales/<locale>.ts just before the closing `};`, skipping
// any key already present. Run: node scripts/wiki/apply_guide_locales.mjs <json> [...locales]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonPath = process.argv[2];
if (!jsonPath) { console.error('usage: apply_guide_locales.mjs <translations.json>'); process.exit(1); }
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));

let total = 0;
for (const [locale, map] of Object.entries(data)) {
  const file = path.join(root, 'src', 'ui', 'i18n.locales', `${locale}.ts`);
  if (!existsSync(file)) { console.error(`skip ${locale}: no overlay file`); continue; }
  let src = readFileSync(file, 'utf8');
  const closeIdx = src.lastIndexOf('};');
  if (closeIdx < 0) { console.error(`skip ${locale}: no closing brace`); continue; }

  // Only add keys not already present in the overlay.
  const lines = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string') continue;
    const needle = `${JSON.stringify(key)}:`;
    if (src.includes(needle)) continue;
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  if (!lines.length) { console.log(`${locale}: nothing to add`); continue; }

  const before = src.slice(0, closeIdx).replace(/\s*$/, '\n');
  const after = src.slice(closeIdx);
  src = `${before}  // Guide (/guide) localization.\n${lines.join('\n')}\n${after}`;
  writeFileSync(file, src);
  total += lines.length;
  console.log(`${locale}: added ${lines.length} guide keys`);
}
console.log(`done: ${total} entries across ${Object.keys(data).length} locales`);
