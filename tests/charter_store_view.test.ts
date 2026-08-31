import { describe, expect, it } from 'vitest';
import { charterSectionHtml } from '../src/ui/charter_card_view';
import {
  buildCharterSection,
  type CharterDef,
  type WocStoreItemInput,
} from '../src/ui/woc_store_view';

// The English silence-breaker line (hudChrome.wocStore.charter.someHiddenByFit),
// pinned as a literal so a catalog reword is a deliberate test update.
const HIDDEN_LINE =
  'Charters too large for the room left in the bank of this character are not shown.';

// The live catalog shape (src/sim/content/storage_charters.ts), restated as
// fixture literals: the view core takes the ladder numbers as INPUTS, so the
// test owns them rather than importing them.
const CHARTER_1: CharterDef = { id: 'strongbox_charter_1', grantSlots: 12 };
const CHARTER_2: CharterDef = { id: 'strongbox_charter_2', grantSlots: 24 };
const CHARTER_3: CharterDef = { id: 'strongbox_charter_3', grantSlots: 48 };
const CHARTER_COMPLETE: CharterDef = { id: 'strongbox_charter_complete', grantSlots: 72 };
const ALL_CHARTERS: readonly CharterDef[] = [CHARTER_1, CHARTER_2, CHARTER_3, CHARTER_COMPLETE];
const CEILING = 72;

function storageRow(itemId: string, costClaudium: number, owned = false): WocStoreItemInput {
  return { itemId, name: itemId, kind: 'storage', costClaudium, owned };
}

function ids(section: { rows: { itemId: string }[] }): string[] {
  return section.rows.map((r) => r.itemId);
}

describe('buildCharterSection fit gate', () => {
  it('includes a grant that exactly fills the ceiling', () => {
    // 24 purchased + the 48-slot charter lands exactly on 72.
    const section = buildCharterSection(0, [], {
      purchasedSlots: 24,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(ids(section)).toEqual([
      'strongbox_charter_1',
      'strongbox_charter_2',
      'strongbox_charter_3',
    ]);
    expect(section.rows.find((r) => r.itemId === 'strongbox_charter_3')?.grantSlots).toBe(48);
    expect(section.ladderFull).toBe(false);
    expect(section.fitUnknown).toBe(false);
  });

  it('omits a grant that overshoots the ceiling by a single slot', () => {
    // 25 purchased: the 48-slot charter needs 73 of 72, the 24-slot one fits.
    const section = buildCharterSection(0, [], {
      purchasedSlots: 25,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(ids(section)).not.toContain('strongbox_charter_3');
    // The smaller charter is still offered, so this cannot pass by emitting
    // nothing at all.
    expect(ids(section)).toEqual(['strongbox_charter_1', 'strongbox_charter_2']);
  });

  it('never clamps an overshooting grant down to the remaining room', () => {
    const section = buildCharterSection(0, [storageRow('strongbox_charter_complete', 2000)], {
      purchasedSlots: 66,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    // Only 6 slots remain: every charter grants more, so nothing is offered.
    expect(section.rows).toEqual([]);
    expect(section.ladderFull).toBe(false);
    expect(section.fitUnknown).toBe(false);
  });

  it('counts every fit-gated omission in hiddenByFit, and zero when all fit', () => {
    // All four fit from zero purchased: nothing hidden.
    const allFit = buildCharterSection(0, [], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(allFit.rows).toHaveLength(4);
    expect(allFit.hiddenByFit).toBe(0);
    // 25 purchased: the 48 and 72 grants overshoot, two hidden beside two shown.
    const someHidden = buildCharterSection(0, [], {
      purchasedSlots: 25,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(ids(someHidden)).toEqual(['strongbox_charter_1', 'strongbox_charter_2']);
    expect(someHidden.hiddenByFit).toBe(2);
    // 66 purchased: every charter overshoots, all four hidden, none shown.
    const allHidden = buildCharterSection(0, [], {
      purchasedSlots: 66,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(allHidden.rows).toEqual([]);
    expect(allHidden.hiddenByFit).toBe(4);
    // A fit gate that could not run hides nothing (rows are NOT fit-gated).
    const unknown = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(unknown.fitUnknown).toBe(true);
    expect(unknown.hiddenByFit).toBe(0);
  });

  it('counts the server-refused prune in hiddenByFit too, even with the fit gate off', () => {
    // The refusal tail (grants >= 48) prunes two charters while the count gate
    // cannot run at all; the pruned rungs still report as hidden.
    const section = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
      refusedGrantSlots: new Set([48]),
    });
    expect(ids(section)).toEqual(['strongbox_charter_1', 'strongbox_charter_2']);
    expect(section.fitUnknown).toBe(true);
    expect(section.hiddenByFit).toBe(2);
    // ...and the hidden count reaches the rendered markup on this arm too.
    expect(charterSectionHtml(section, new Set())).toContain(HIDDEN_LINE);
  });

  it('renders the hidden-count line when the refusal prune empties a fitUnknown list', () => {
    // The refusal of the smallest grant prunes ALL four charters while the
    // count gate cannot run: an empty list under fitUnknown used to return ''
    // and vanish every pruned row silently, the exact silence the hidden-count
    // line exists to break.
    const section = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
      refusedGrantSlots: new Set([12]),
    });
    expect(section.rows).toEqual([]);
    expect(section.fitUnknown).toBe(true);
    expect(section.hiddenByFit).toBe(4);
    const html = charterSectionHtml(section, new Set());
    expect(html).toContain(HIDDEN_LINE);
    // The scope line rides along, and it is a real section, not a fragment.
    expect(html).toContain('charter-section');
    expect(html).toContain('charter-scope');

    // The TRUE nothing-known-nothing-hidden silence stays silent.
    const silent = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(silent.rows).not.toEqual([]);
    const empty = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: [],
    });
    expect(empty.fitUnknown).toBe(true);
    expect(empty.hiddenByFit).toBe(0);
    expect(charterSectionHtml(empty, new Set())).toBe('');
  });

  it('reports ladderFull with no rows once the ceiling is reached', () => {
    const section = buildCharterSection(9999, [storageRow('strongbox_charter_1', 400)], {
      purchasedSlots: CEILING,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(section.rows).toEqual([]);
    expect(section.ladderFull).toBe(true);
    expect(section.fitUnknown).toBe(false);
  });

  it('reports ladderFull past the ceiling too', () => {
    const section = buildCharterSection(9999, [], {
      purchasedSlots: CEILING + 6,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(section.rows).toEqual([]);
    expect(section.ladderFull).toBe(true);
  });

  it('runs no fit gate when the purchased count is unobservable', () => {
    const section = buildCharterSection(0, [], {
      purchasedSlots: null,
      ceilingSlots: CEILING,
      charters: ALL_CHARTERS,
    });
    expect(ids(section)).toEqual([
      'strongbox_charter_1',
      'strongbox_charter_2',
      'strongbox_charter_3',
      'strongbox_charter_complete',
    ]);
    expect(section.fitUnknown).toBe(true);
    expect(section.ladderFull).toBe(false);
  });

  it('treats a negative or non-finite purchased count as unknown', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const section = buildCharterSection(0, [], {
        purchasedSlots: bad,
        ceilingSlots: CEILING,
        charters: ALL_CHARTERS,
      });
      expect(section.fitUnknown).toBe(true);
      expect(section.ladderFull).toBe(false);
      expect(section.rows).toHaveLength(ALL_CHARTERS.length);
    }
  });

  it('treats a non-positive or non-finite ceiling as unknown', () => {
    for (const bad of [0, -72, Number.NaN, Number.POSITIVE_INFINITY]) {
      const section = buildCharterSection(0, [], {
        purchasedSlots: 24,
        ceilingSlots: bad,
        charters: ALL_CHARTERS,
      });
      expect(section.fitUnknown).toBe(true);
      expect(section.ladderFull).toBe(false);
      expect(section.rows).toHaveLength(ALL_CHARTERS.length);
    }
  });
});

describe('buildCharterSection pricing', () => {
  it('takes the live service price and marks an affordable charter', () => {
    const section = buildCharterSection(5000, [storageRow('strongbox_charter_2', 800)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_2],
    });
    expect(section.rows).toEqual([
      {
        itemId: 'strongbox_charter_2',
        grantSlots: 24,
        costClaudium: 800,
        purchasable: true,
        affordable: true,
        shortfall: 0,
      },
    ]);
  });

  it('affords a charter when the balance EXACTLY equals the cost', () => {
    // The >= boundary. Under a > comparison a player holding exactly enough
    // Claudium would be told they cannot afford the charter.
    const section = buildCharterSection(800, [storageRow('strongbox_charter_2', 800)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_2],
    });
    expect(section.rows[0].affordable).toBe(true);
    expect(section.rows[0].shortfall).toBe(0);
  });

  it('refuses a charter when the balance is one Claudium short', () => {
    const section = buildCharterSection(799, [storageRow('strongbox_charter_2', 800)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_2],
    });
    expect(section.rows[0].affordable).toBe(false);
    expect(section.rows[0].shortfall).toBe(1);
  });

  it('computes the exact shortfall against a short balance', () => {
    const section = buildCharterSection(300, [storageRow('strongbox_charter_2', 800)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_2],
    });
    expect(section.rows[0].affordable).toBe(false);
    expect(section.rows[0].shortfall).toBe(500);
  });

  it('leaves a charter missing from the service snapshot unpriced but present', () => {
    const section = buildCharterSection(5000, [storageRow('strongbox_charter_1', 400)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_1, CHARTER_3],
    });
    const missing = section.rows.find((r) => r.itemId === 'strongbox_charter_3');
    expect(missing).toBeDefined();
    expect(missing?.costClaudium).toBeNull();
    expect(missing?.purchasable).toBe(false);
    expect(missing?.affordable).toBe(false);
    expect(missing?.shortfall).toBeNull();
  });

  it('rejects a non-positive or non-finite service price as unavailable', () => {
    for (const bad of [0, -400, Number.NaN, Number.POSITIVE_INFINITY]) {
      const section = buildCharterSection(5000, [storageRow('strongbox_charter_1', bad)], {
        purchasedSlots: 0,
        ceilingSlots: CEILING,
        charters: [CHARTER_1],
      });
      expect(section.rows[0].costClaudium).toBeNull();
      expect(section.rows[0].purchasable).toBe(false);
      expect(section.rows[0].affordable).toBe(false);
      expect(section.rows[0].shortfall).toBeNull();
    }
  });

  it('leaves shortfall null when the balance is unknown', () => {
    const section = buildCharterSection(null, [storageRow('strongbox_charter_1', 400)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [CHARTER_1],
    });
    expect(section.rows[0].purchasable).toBe(true);
    expect(section.rows[0].affordable).toBe(false);
    expect(section.rows[0].shortfall).toBeNull();
  });
});

describe('buildCharterSection row selection', () => {
  it('follows the caller charter order', () => {
    const reversed = [CHARTER_COMPLETE, CHARTER_3, CHARTER_2, CHARTER_1];
    const section = buildCharterSection(0, [], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: reversed,
    });
    expect(ids(section)).toEqual(reversed.map((c) => c.id));
  });

  it('ignores owned on a storage row entirely', () => {
    const ctx = { purchasedSlots: 0, ceilingSlots: CEILING, charters: ALL_CHARTERS };
    const notOwned = buildCharterSection(
      5000,
      [storageRow('strongbox_charter_1', 400), storageRow('strongbox_charter_2', 800)],
      ctx,
    );
    const owned = buildCharterSection(
      5000,
      [storageRow('strongbox_charter_1', 400, true), storageRow('strongbox_charter_2', 800, true)],
      ctx,
    );
    // Charters are repeatable and a storage spend writes no grant row, so the
    // service flag is meaningless here and must move nothing.
    expect(owned.rows).toEqual(notOwned.rows);
    expect(owned.rows[0].affordable).toBe(true);
    expect(owned.rows[0].shortfall).toBe(0);
  });

  it('ignores a row that carries a charter id under a non-storage kind', () => {
    const section = buildCharterSection(
      5000,
      [
        {
          itemId: 'strongbox_charter_1',
          name: 'decoy',
          kind: 'skin',
          costClaudium: 400,
          owned: false,
        },
      ],
      { purchasedSlots: 0, ceilingSlots: CEILING, charters: [CHARTER_1] },
    );
    expect(section.rows[0].costClaudium).toBeNull();
    expect(section.rows[0].purchasable).toBe(false);
  });

  it('never emits a rung SKU the service snapshot carries', () => {
    const section = buildCharterSection(
      5000,
      [storageRow('strongbox_rung_01', 200), storageRow('strongbox_charter_1', 400)],
      { purchasedSlots: 0, ceilingSlots: CEILING, charters: ALL_CHARTERS },
    );
    expect(ids(section)).not.toContain('strongbox_rung_01');
    expect(ids(section)).toEqual(ALL_CHARTERS.map((c) => c.id));
  });

  it('drops a server-refused grant and every larger one, even with the fit gate off', () => {
    // The only fit answer available away from a banker: purchasedSlots is null
    // there, so the count gate cannot run at all (fitUnknown stays true). A
    // does_not_fit on 24 proves 24 overshoots, and therefore that 48 and 72 do
    // too, so one verdict prunes the whole tail.
    const section = buildCharterSection(
      9999,
      ALL_CHARTERS.map((c) => storageRow(c.id, 400)),
      {
        purchasedSlots: null,
        ceilingSlots: CEILING,
        charters: ALL_CHARTERS,
        refusedGrantSlots: new Set([24]),
      },
    );
    expect(ids(section)).toEqual(['strongbox_charter_1']);
    expect(section.fitUnknown).toBe(true);
    // NOT ladderFull: the client still knows nothing about the count, and
    // claiming the ladder is full off a single refusal would be a lie.
    expect(section.ladderFull).toBe(false);
  });

  it('is inert for a refusal set that is empty, absent, or nonsense', () => {
    // Each degenerate shape SEPARATELY, because they fail in opposite
    // directions: a NaN compares false against every grant and would silently
    // disable the whole suppression, while a zero or negative entry would hide
    // every charter. Both must behave as if nothing were refused.
    const rows = ALL_CHARTERS.map((c) => storageRow(c.id, 400));
    const base = { purchasedSlots: 0, ceilingSlots: CEILING, charters: ALL_CHARTERS };
    const all = ALL_CHARTERS.map((c) => c.id);
    expect(ids(buildCharterSection(9999, rows, base))).toEqual(all);
    expect(ids(buildCharterSection(9999, rows, { ...base, refusedGrantSlots: new Set() }))).toEqual(
      all,
    );
    expect(
      ids(buildCharterSection(9999, rows, { ...base, refusedGrantSlots: new Set([Number.NaN]) })),
    ).toEqual(all);
    expect(
      ids(buildCharterSection(9999, rows, { ...base, refusedGrantSlots: new Set([0, -6]) })),
    ).toEqual(all);
    // And a real entry alongside the nonsense still prunes: dropping the bad
    // ones must not drop the good one with them.
    expect(
      ids(
        buildCharterSection(9999, rows, {
          ...base,
          refusedGrantSlots: new Set([Number.NaN, 0, 48]),
        }),
      ),
    ).toEqual(['strongbox_charter_1', 'strongbox_charter_2']);
  });

  it('applies the refusal set on top of the count gate, never instead of it', () => {
    // Both gates live, and each one alone would leave a different survivor: the
    // count gate at 48 of 72 clears 48 and 72, and the refusal of 24 clears 24.
    // Only the intersection is offered.
    const section = buildCharterSection(
      9999,
      ALL_CHARTERS.map((c) => storageRow(c.id, 400)),
      {
        purchasedSlots: 48,
        ceilingSlots: CEILING,
        charters: ALL_CHARTERS,
        refusedGrantSlots: new Set([24]),
      },
    );
    expect(ids(section)).toEqual(['strongbox_charter_1']);
    expect(section.fitUnknown).toBe(false);
  });

  it('returns an empty section for an empty charter list without claiming full', () => {
    const section = buildCharterSection(5000, [storageRow('strongbox_charter_1', 400)], {
      purchasedSlots: 0,
      ceilingSlots: CEILING,
      charters: [],
    });
    expect(section.rows).toEqual([]);
    expect(section.ladderFull).toBe(false);
    expect(section.fitUnknown).toBe(false);
  });
});
