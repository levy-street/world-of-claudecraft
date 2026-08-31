// The positional item-name catalog guard (Phase 18).
//
// src/ui/i18n.catalog/items.ts pairs item ids with their display names BY INDEX:
// `itemTranslations(names)` walks ITEM_ENTITY_IDS and hands position i its name
// from names[i]. Two parallel arrays with nothing tying a row to its id, so
// inserting an id in the MIDDLE of ITEM_ENTITY_IDS re-points every following item
// to its predecessor's name: nine hundred wrong item names at once, in bags,
// tooltips, loot, the vendor and the wiki. `itemTranslations` throws only on a
// LENGTH mismatch, which is exactly the check a mid-array insertion satisfies once
// its name is appended anywhere in the list, and the documented authoring rule
// (src/sim/content/CLAUDE.md, "Item names") says APPEND for this reason.
//
// The pairing is derivable, so this guard derives it rather than pinning 895
// literals: `ITEMS[id].name` in the sim catalog is the same English string, and a
// shift of any size breaks the correspondence for every row past the insertion.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemNames } from '../src/ui/i18n.catalog/items';

const SRC = path.resolve(process.cwd(), 'src/ui/i18n.catalog/items.ts');
const source = fs.readFileSync(SRC, 'utf8');

// The id array read from source, so a DUPLICATE id is visible (Object.keys over
// the built table would silently collapse one, and a duplicate consumes two name
// slots and shifts the tail exactly like an insertion does).
function itemEntityIdsFromSource(): string[] {
  const start = source.indexOf('const ITEM_ENTITY_IDS = [');
  expect(start, 'ITEM_ENTITY_IDS declaration').toBeGreaterThan(-1);
  const end = source.indexOf('] as const;', start);
  expect(end, 'ITEM_ENTITY_IDS terminator').toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/^\s*'([a-z0-9_]+)',$/gm)].map((m) => m[1]);
}

const rows = itemNames.en.entities.items as Record<string, { name: string }>;
const items = ITEMS as Record<string, { name?: string } | undefined>;

describe('the positional item-name catalog stays aligned with its ids', () => {
  it('reads a real id list, with no duplicate', () => {
    const ids = itemEntityIdsFromSource();
    // Vacuity floor near the real count (892 today): a parse that returned a
    // handful of ids would make every arm below pass over almost nothing.
    expect(ids.length, 'parsed ITEM_ENTITY_IDS').toBeGreaterThan(850);
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    ids.forEach((id, i) => {
      const first = seen.get(id);
      if (first === undefined) seen.set(id, i);
      else dupes.push(`${id} at ${first} and ${i}`);
    });
    expect(dupes, 'a duplicate id consumes two name slots and shifts the tail').toEqual([]);
    // Every parsed id reached the built table, and the table adds only the three
    // en-only extras itemTranslationsEn appends after the positional walk.
    for (const id of ids) expect(rows[id], `${id} missing from the built table`).toBeTruthy();
    expect(Object.keys(rows).length - ids.length).toBe(3);
  });

  it('every position pairs with its own item, not its neighbour', () => {
    // The decisive arm. An insertion anywhere but the end makes every row past it
    // carry the previous item's name, and each one lands here by id.
    const wrong: string[] = [];
    let checked = 0;
    for (const [id, row] of Object.entries(rows)) {
      const def = items[id];
      // The three en-only extras (conjured_water4, conjured_bread4, soul_stone)
      // are appended outside the positional walk and have no ITEMS row to pair
      // against; nothing positional can go wrong with them.
      if (!def?.name) continue;
      checked++;
      if (def.name !== row.name) wrong.push(`${id}: ITEMS '${def.name}' vs catalog '${row.name}'`);
    }
    expect(checked, 'no row had an ITEMS name to compare: the arm is vacuous').toBeGreaterThan(850);
    expect(wrong.slice(0, 15), `${wrong.length} rows carry another item's name`).toEqual([]);
  });

  it('every catalogued id is a live item', () => {
    // The other half of a shift: an id that survives in ITEM_ENTITY_IDS after its
    // content record is deleted still holds a name slot and offsets the rest.
    const orphans = Object.keys(rows).filter((id) => !items[id]);
    expect(orphans, 'catalogued ids with no ITEMS record').toEqual([]);
  });

  it('the pairing check actually rejects a shifted catalog', () => {
    // Self-test: prove the comparison above has teeth without mutating the source.
    // Rebuild the table one position out, the exact shape of a mid-array
    // insertion, and confirm the same comparison condemns it.
    const ids = Object.keys(rows).filter((id) => items[id]?.name);
    const shifted = new Map<string, string>();
    ids.forEach((id, i) => {
      shifted.set(id, rows[ids[Math.max(0, i - 1)]].name);
    });
    const wrong = ids.filter((id) => items[id]?.name !== shifted.get(id));
    // Not "some": a one-position shift must be caught almost everywhere, or the
    // comparison is too weak to notice a small insertion far up the array.
    expect(wrong.length).toBeGreaterThan(ids.length * 0.9);
  });
});
