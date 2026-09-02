// D062 scratch census: the disenchant INPUT streams by quality on the merged catalog, and
// where the epic/legendary inputs come from (drop tables vs crafted outputs).
import { ITEMS } from '../../../src/sim/data';
import { ALL_RECIPES as RECIPES } from '../../../src/sim/content/recipes';
import { ENCHANTS } from '../../../src/sim/content/enchants';
import { isDisenchantable, baseDisenchantYield } from '../../../src/sim/professions/enchanting';
import { isSunderable } from '../../../src/sim/professions/sundering';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const byQ: Record<string, number> = {};
const de = Object.values(ITEMS).filter((d) => isDisenchantable(d));
for (const d of de) byQ[d.quality ?? 'none'] = (byQ[d.quality ?? 'none'] ?? 0) + 1;
console.log('disenchantable defs by quality:', JSON.stringify(byQ), 'of', Object.keys(ITEMS).length, 'items');
const craftedOut = new Set(RECIPES.map((r: any) => r.resultItemId).filter(Boolean));
const epics = de.filter((d) => d.quality === 'epic' || d.quality === 'legendary');
const crafted = epics.filter((d) => craftedOut.has(d.id));
const sunder = epics.filter((d) => isSunderable(d));
const src = ['src/sim/content/heroic_loot.ts', 'src/sim/content/dungeons.ts', 'src/sim/content/zone1.ts', 'src/sim/content/ignivar_raid.ts']
  .map((f) => { try { return readFileSync(resolve(ROOT, f), 'utf8'); } catch { return ''; } }).join('\n');
const inDrop = epics.filter((d) => src.includes(`'${d.id}'`));
console.log(`epic+legendary disenchantable: ${epics.length}; crafted outputs among them: ${crafted.length}; in heroic/dungeon/raid loot text: ${inDrop.length}; sunderable (competing sink): ${sunder.length}`);
console.log('crafted epic ids (first 12):', crafted.slice(0, 12).map((d) => d.id).join(', '));
console.log('epics in NEITHER crafted nor loot text (first 12):', epics.filter((d) => !craftedOut.has(d.id) && !src.includes(`'${d.id}'`)).slice(0, 12).map((d) => d.id).join(', '));
const rares = de.filter((d) => d.quality === 'rare');
console.log(`rare disenchantable: ${rares.length}; crafted among them: ${rares.filter((d) => craftedOut.has(d.id)).length}`);
// Sub-rare yield scaling for contrast (the quantity-scaled arm).
const sample = de.filter((d) => d.quality === 'uncommon').slice(0, 3).map((d) => `${d.id}:${baseDisenchantYield(d)}`);
console.log('uncommon base yields (sample):', sample.join(' '));
// Consumers re-derived through the merged catalogs (the row's census predicate: reagent rows).
function census(id: string) { let rows = 0, units = 0; const ids: string[] = [];
  for (const r of RECIPES as any[]) for (const g of r.reagents ?? []) if (g.itemId === id) { rows++; units += g.count; ids.push(`${r.id}x${g.count}`); }
  for (const e of Object.values(ENCHANTS) as any[]) for (const g of e.reagents ?? []) if (g.itemId === id) { rows++; units += g.count; ids.push(`${e.id}x${g.count}`); }
  return { rows, units, ids }; }
for (const id of ['arcane_shard', 'arcane_essence', 'arcane_dust']) { const c = census(id); console.log(`${id}: ${c.rows} consumers / ${c.units} units`); if (id === 'arcane_shard') console.log('  ', c.ids.join(', ')); }
