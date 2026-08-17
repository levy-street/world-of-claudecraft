import { describe, expect, it } from 'vitest';
import { RELIQUARY_HORIZON_MOUNTS, RELIQUARY_HORIZON_TITLES } from '../src/sim/content/reliquary';
import { catalogCharacterCompletion, catalogRelicCompletion } from '../src/sim/reliquary';
import {
  buildReliquarySheetModel,
  reliquarySheetProgressionHtml,
  selfCuratorStanding,
} from '../src/ui/reliquary_sheet_view';

function world(
  over: {
    items?: string[];
    marks?: string[];
    mounts?: string[];
    // Offline Sim exposes deedsEarned as a Map (deed id -> earned day) and the
    // online ClientWorld mirrors the same Map shape; a plain Set stands in for
    // the minimal OwnedIdLookup. Both shapes must build identical models.
    deeds?: string[] | Map<string, string>;
  } = {},
) {
  const items = new Set(over.items ?? []);
  const marks = new Set(over.marks ?? []);
  const mounts = over.mounts ?? [];
  const deeds = over.deeds instanceof Map ? over.deeds : new Set(over.deeds ?? []);
  return {
    deedStats: { itemsDiscovered: items },
    reliquaryMarks: marks,
    ownedMounts: () => mounts,
    deedsEarned: deeds,
  };
}

describe('buildReliquarySheetModel', () => {
  it('is empty and unranked with no ownership', () => {
    const model = buildReliquarySheetModel(world());
    const empty = catalogCharacterCompletion({ itemsDiscovered: new Set() });
    expect(model.owned).toBe(0);
    expect(model.total).toBe(empty.total);
    expect(model.curatorRank).toBe(0);
  });

  it('ranks from character-durable fills; total excludes account skin slots', () => {
    const model = buildReliquarySheetModel(world({ items: ['cryptbone_helm'] }));
    expect(model.owned).toBe(1);
    expect(model.curatorRank).toBe(1);
    const full = catalogRelicCompletion({ itemsDiscovered: new Set(['cryptbone_helm']) });
    const char = catalogCharacterCompletion({ itemsDiscovered: new Set(['cryptbone_helm']) });
    expect(model.total).toBe(char.total);
    expect(model.total).toBeLessThan(full.total);
    const withMany = buildReliquarySheetModel(
      world({
        items: Array.from({ length: 12 }, (_, i) => `fake_${i}`),
      }),
    );
    expect(withMany.owned).toBe(0);
  });

  it('scores marks independently of items', () => {
    const base = buildReliquarySheetModel(world());
    const withMark = buildReliquarySheetModel(world({ marks: ['masterwork:first'] }));
    expect(withMark.owned).toBe(base.owned + 1);
  });

  it('counts a catalogued Horizons mount from the ownedMounts seam', () => {
    // Membership pin: valorsteed must stay a live horizons_mounts relic
    // (RELIQUARY_HORIZON_MOUNTS), so catalog churn fails loudly right here.
    expect(RELIQUARY_HORIZON_MOUNTS).toContain('valorsteed');
    const base = buildReliquarySheetModel(world());
    const withMount = buildReliquarySheetModel(world({ mounts: ['valorsteed'] }));
    expect(withMount.owned).toBe(base.owned + 1);
    expect(withMount.total).toBe(base.total);
  });

  it('counts catalogued titles from a ClientWorld-shaped deedsEarned Map, matching a Set', () => {
    // Real title-relic deed ids from the live horizons_titles page. Membership
    // is pinned explicitly so catalog churn fails loudly at this assertion,
    // not indirectly through the owned count below.
    expect(RELIQUARY_HORIZON_TITLES).toContain('prog_veteran');
    expect(RELIQUARY_HORIZON_TITLES).toContain('dgn_korzul_flawless');
    const asMap = buildReliquarySheetModel(
      world({
        deeds: new Map<string, string>([
          ['prog_veteran', '2026-08-01'],
          ['dgn_korzul_flawless', '2026-08-02'],
        ]),
      }),
    );
    const asSet = buildReliquarySheetModel(
      world({ deeds: ['prog_veteran', 'dgn_korzul_flawless'] }),
    );
    // Model parity between the online Map shape and the plain Set shape.
    expect(asMap).toEqual(asSet);
    // The earned titles actually move the sheet: 2 owned over an empty baseline,
    // and rank thresholds (1, 10, 25, 50, 100) put 2 owned at rank 1.
    const empty = buildReliquarySheetModel(world());
    expect(empty.owned).toBe(0);
    expect(asMap.owned).toBe(2);
    expect(asMap.curatorRank).toBe(1);
    expect(asMap.total).toBe(empty.total);
  });
});

describe('selfCuratorStanding', () => {
  // Behavioral arm, not a source scrape: the adapter feeds the inspect card the
  // viewer's OWN standing, so a transposed field here would print the pair
  // backwards on every self-inspect while the wire path for other players
  // stays green. Three DISTINCT values (owned 2, rank 1, total = the full
  // character-scoped catalog) make any field swap observable.
  it('mirrors the sheet model triple field by field', () => {
    const w = world({ items: ['cryptbone_helm'], marks: ['masterwork:first'] });
    const model = buildReliquarySheetModel(w);
    const standing = selfCuratorStanding(w);
    expect(standing).toEqual({
      curatorRank: model.curatorRank,
      owned: model.owned,
      total: model.total,
    });
    // Anchor the fixture so the distinctness premise cannot rot silently: a
    // swap of owned and total flips 2 against the catalog size.
    expect(standing.owned).toBe(2);
    expect(standing.curatorRank).toBe(1);
    expect(standing.total).toBeGreaterThan(standing.owned);
  });

  it('builds the same standing from the online Map-shaped deedsEarned', () => {
    const asMap = selfCuratorStanding(world({ deeds: new Map([['prog_veteran', '2026-08-01']]) }));
    const asSet = selfCuratorStanding(world({ deeds: ['prog_veteran'] }));
    expect(asMap).toEqual(asSet);
    expect(asMap.owned).toBe(1);
  });
});

describe('reliquarySheetProgressionHtml', () => {
  it('emits labeled completion, rank, and open button with t() chrome keys', () => {
    const html = reliquarySheetProgressionHtml({ owned: 3, total: 100, curatorRank: 1 });
    expect(html).toContain('data-act="open-reliquary"');
    expect(html).toContain('cp-reliquary');
    expect(html).toContain('data-rank="1"');
    expect(html).toContain('3/100');
    expect(html).toContain('Apprentice Curator');
    expect(html).toContain('The Reliquary');
  });

  it('shows unranked chrome at rank 0', () => {
    const html = reliquarySheetProgressionHtml({ owned: 0, total: 100, curatorRank: 0 });
    expect(html).toContain('data-rank="0"');
    expect(html).toContain('Unranked Curator');
  });
});
