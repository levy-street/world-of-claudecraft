// Shipped item ids are permanent API. Player saves persist raw item ids in
// equipment, bags, bank, mail attachments, and market listings, load them
// verbatim with no validation, and an id that stops resolving in ITEMS renders
// as an Empty slot with zero stats while sitting dormant in the save. That is
// exactly how v0.25.0 broke 18 prod characters: the heroic loot swap deleted
// four standalone heroic defs and every gate stayed green.
//
// This golden pins every id that has shipped: if a def deletion (or a mob-loot
// removal that silently kills a generated heroic_<id> variant) makes a shipped
// id unresolvable, this test fails. To REMOVE an item from the game, retire it
// instead: keep the def and remove its acquisition paths (exemplar:
// RETIRED_HEROIC_ITEMS in src/sim/content/heroic_loot.ts).
//
// The golden is APPEND-ONLY. After new items ship in a release, re-mint with
// `UPDATE_SHIPPED_ITEMS=1 npx vitest run tests/shipped_item_ids.test.ts` and
// review the diff: additions only. A removed line means a shipped id died and
// the fix is a retirement, never a re-mint.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'shipped_item_ids.golden.json');
const UPDATE = process.env.UPDATE_SHIPPED_ITEMS === '1';

describe('shipped item ids stay resolvable forever', () => {
  it('resolves every shipped id in ITEMS (retire items, never delete them)', () => {
    if (UPDATE) {
      const current = JSON.parse(readFileSync(GOLDEN, 'utf8')) as string[];
      const union = [...new Set([...current, ...Object.keys(ITEMS)])].sort();
      writeFileSync(GOLDEN, `${JSON.stringify(union, null, 2)}\n`);
    }
    const shipped = JSON.parse(readFileSync(GOLDEN, 'utf8')) as string[];
    // Sanity floor: an emptied or truncated golden must not pass silently.
    expect(shipped.length).toBeGreaterThan(500);
    const missing = shipped.filter((id) => !ITEMS[id]);
    expect(missing).toEqual([]);
  });
});
