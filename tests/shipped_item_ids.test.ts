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
// The golden is APPEND-ONLY, and it is re-minted PER CONTENT CHANGE, not after
// a release: any change that mints an item id re-mints here in the SAME commit,
// with `UPDATE_SHIPPED_ITEMS=1 npx vitest run tests/shipped_item_ids.test.ts`,
// and the diff reviewed for ADDITIONS ONLY. A removed line means a shipped id
// died and the fix is a retirement, never a re-mint.
//
// THE CADENCE CHANGED because the tree had already changed what it meant
// (masterwrought ruling qr-19-shipped-id-golden-remint-cadence, 2026-09-01).
// The header used to say "after new items ship in a release", which five phase
// ledgers deviated to while the branch's own content commits re-minted per
// change anyway, and there was never anything behind the cadence: the check
// below is a SUBSET filter, so an un-re-minted golden simply never reds. The
// doctrine now says what the repo does.
//
// THE CONSEQUENCE, worth stating where the next reader is: pinning an id here
// makes it permanent API, and every branch-only id already IS pinned. So the
// escape at src/sim/content/CLAUDE.md ("only an item that never left your
// unmerged feature branch may be deleted outright") is closed in practice, and
// cutting one of those ids is a RETIREMENT (keep the def, drop its acquisition
// paths) plus its merge-deletion-list row, never a delete.
//
// AND THE OTHER HALF, which is what a merge engineer will actually hit: the
// equality arm below reds for ANY id reaching ITEMS from ANY source, so a
// RELEASE SYNC that brings a new item id reds this suite and owes
// `UPDATE_SHIPPED_ITEMS=1` in the SAME merge commit. That coupling is the
// accepted cost of having enforcement at all, ruled with the cadence: before
// it, a forgotten re-mint went unnoticed for five phases.
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
    // THE OTHER DIRECTION, which is what makes the cadence real. The filter above
    // is a SUBSET check, so an un-re-minted golden simply never reds: that is
    // exactly why five phase ledgers could deviate to a release-time cadence with
    // nothing noticing (masterwrought qr-19-shipped-id-golden-remint-cadence).
    // With every id already pinned, the golden and ITEMS are EQUAL, so the
    // stronger claim is the true one and a change that mints an id without
    // re-minting here reds on the spot.
    const pinned = new Set(shipped);
    const unpinned = Object.keys(ITEMS).filter((id) => !pinned.has(id));
    expect(
      unpinned,
      'item id(s) live in ITEMS but not in the golden. Shipped ids are permanent API, so re-mint in the SAME change that mints them: UPDATE_SHIPPED_ITEMS=1 npx vitest run tests/shipped_item_ids.test.ts, then review the diff as additions-only',
    ).toEqual([]);
  });
});
