import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CharacterSheetInput,
  characterSheet,
  RELIQUARY_MARK_ENGLISH,
  SHEET_RECENT_RELICS,
  sheetCuratorRankText,
  sheetRecentRelicsFromRing,
  sheetRecentRelicsFromSaved,
  sheetRelicRecentText,
  sheetReliquaryFromState,
  splitCopper,
} from '../server/character_sheet';
import type { CharacterRow } from '../server/db';
import { DEEDS } from '../src/sim/content/deeds';
import { talentsFor } from '../src/sim/content/talents';
import { ITEMS, MOBS, zoneAt } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import {
  CURATOR_RANK_DEFS,
  catalogCharacterCompletion,
  isCataloguedRelicItem,
  RELIQUARY_MARK_IDS,
  RELIQUARY_PAGES,
  RELIQUARY_RECENT_CAP,
} from '../src/sim/reliquary';
import type { CharacterState } from '../src/sim/sim';
import { type PlayerClass, virtualLevel } from '../src/sim/types';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

function makeState(over: Partial<CharacterState> = {}): CharacterState {
  return {
    level: 20,
    xp: 0,
    lifetimeXp: 50_000,
    prestigeRank: 1,
    copper: 123456,
    hp: 500,
    resource: 200,
    pos: { x: 5, z: 0 },
    facing: 0,
    equipment: {},
    inventory: [{ itemId: 'wolf_pelt', qty: 3 } as any],
    questLog: [{ questId: 'q1', counts: [1], state: 'active' }],
    questsDone: [],
    arena1v1Rating: 1600,
    arena1v1Wins: 10,
    arena1v1Losses: 4,
    arena1v1Draws: 2,
    ...over,
  } as CharacterState;
}

/** Distinct catalogued relic ITEM ids from the LIVE catalog, in page order, so
 *  the recent-strip fixtures below cannot drift away from real content. */
function cataloguedItemIds(): string[] {
  return [
    ...new Set(
      RELIQUARY_PAGES.flatMap((page) =>
        page.relics.flatMap((relic) => (relic.kind === 'item' ? [relic.itemId] : [])),
      ),
    ),
  ];
}

function makeRow(cls: PlayerClass, level: number, state: CharacterState): CharacterRow {
  return {
    id: 7,
    account_id: 1,
    name: 'Thrallish',
    class: cls,
    level,
    state,
    is_gm: false,
    force_rename: false,
  };
}

function input(over: Partial<CharacterSheetInput> = {}): CharacterSheetInput {
  return {
    row: makeRow('shaman', 20, makeState()),
    visibility: 'owner',
    realm: 'Claudemoon',
    origin: 'https://worldofclaudecraft.com',
    guild: 'Echoes of Claude',
    rank: { scope: 'realm', rank: 27, total: 4012 },
    updatedAt: '2026-06-23T00:00:00.000Z',
    ...over,
  };
}

describe('splitCopper', () => {
  it('splits copper into gold/silver/copper', () => {
    expect(splitCopper(123456)).toEqual({ gold: 12, silver: 34, copper: 56 });
    expect(splitCopper(0)).toEqual({ gold: 0, silver: 0, copper: 0 });
    expect(splitCopper(99)).toEqual({ gold: 0, silver: 0, copper: 99 });
  });
});

describe('characterSheet: shared fields', () => {
  it('derives classLabel, zone, virtualLevel, prestige, spec, avatar + profile urls', () => {
    const sheet = characterSheet(input());
    expect(sheet.name).toBe('Thrallish');
    expect(sheet.realm).toBe('Claudemoon');
    expect(sheet.class).toBe('shaman');
    expect(sheet.classLabel).toBe('Shaman');
    expect(sheet.level).toBe(20);
    expect(sheet.virtualLevel).toBe(virtualLevel(50_000));
    expect(sheet.prestigeRank).toBe(1);
    expect(sheet.zone).toBe(zoneAt(0, 0).name);
    expect(sheet.guild).toBe('Echoes of Claude');
    expect(sheet.rank).toEqual({ scope: 'realm', rank: 27, total: 4012 });
    expect(sheet.avatarUrl).toBe('https://worldofclaudecraft.com/avatar/shaman/0.png');
    expect(sheet.profileUrl).toBe('https://worldofclaudecraft.com/c/Thrallish');
    expect(sheet.arena['1v1']).toEqual({ rating: 1600, wins: 10, losses: 4, draws: 2 });
  });

  it('backfills virtualLevel from level when lifetimeXp is absent', () => {
    const sheet = characterSheet(
      input({ row: makeRow('mage', 12, makeState({ lifetimeXp: undefined, level: 12 })) }),
    );
    expect(sheet.virtualLevel).toBe(12);
  });

  it('preserves a valid specialization while ignoring legacy point-tree state', () => {
    const fury = talentsFor('warrior')?.specs.find((spec) => spec.id === 'fury');
    if (!fury) throw new Error('warrior Fury fixture missing');
    const canonical = characterSheet(
      input({
        row: makeRow('warrior', 20, makeState({ talents: { spec: 'fury', rows: {} } })),
      }),
    );
    const legacy = characterSheet(
      input({
        row: makeRow(
          'warrior',
          20,
          makeState({
            talents: {
              spec: 'fury',
              ranks: {},
              choices: {},
            } as unknown as CharacterState['talents'],
          }),
        ),
      }),
    );

    expect(canonical.spec).toBe(fury.name);
    expect(legacy.spec).toBe(fury.name);
  });
});

describe('characterSheet: owner variant', () => {
  it('includes stats, vitals, gold, and exact position', () => {
    const sheet = characterSheet(input({ visibility: 'owner' }));
    expect(sheet.gold).toEqual({ gold: 12, silver: 34, copper: 56 });
    expect(sheet.pos).toEqual({ x: 5, z: 0 });
    expect(sheet.stats).toBeDefined();
    expect(sheet.stats).toMatchObject({ pvpOffense: 0, pvpDefense: 0 });
    expect(sheet.vitals).toBeDefined();
    expect(sheet.vitals!.hp).toBe(500);
  });

  it('stats equal recalcPlayerStats output for the same class/level/gear', () => {
    const cls: PlayerClass = 'warrior';
    const level = 18;
    const sheet = characterSheet(
      input({ row: makeRow(cls, level, makeState({ level, talents: undefined, equipment: {} })) }),
    );
    // Independently derive via the engine's one true function.
    const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
    e.level = level;
    recalcPlayerStats(e, cls, {}, undefined, {});
    expect(sheet.stats).toEqual({ ...e.stats });
    expect(sheet.vitals!.maxHp).toBe(e.maxHp);
    expect(sheet.vitals!.resource.max).toBe(e.maxResource);
  });
});

describe('characterSheet: public variant leaks nothing sensitive', () => {
  it('omits stats, vitals, gold, and exact position', () => {
    const sheet = characterSheet(input({ visibility: 'public' }));
    expect(sheet.stats).toBeUndefined();
    expect(sheet.vitals).toBeUndefined();
    expect(sheet.gold).toBeUndefined();
    expect(sheet.pos).toBeUndefined();
    // but keeps the safe public subset
    expect(sheet.name).toBe('Thrallish');
    expect(sheet.zone).toBe(zoneAt(0, 0).name);
    expect(sheet.virtualLevel).toBe(virtualLevel(50_000));
    expect(sheet.guild).toBe('Echoes of Claude');
  });

  it('serialized public JSON contains no inventory, questLog, pos, gold, stats, or vitals', () => {
    const json = JSON.stringify(characterSheet(input({ visibility: 'public' })));
    for (const leak of ['inventory', 'questLog', 'stats', 'vitals', 'gold', '"pos"']) {
      expect(json).not.toContain(leak);
    }
  });

  it('property check: no owner-only key survives across many class/level combos', () => {
    const classes: PlayerClass[] = [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ];
    for (const cls of classes) {
      for (const level of [1, 10, 20]) {
        const sheet = characterSheet(
          input({ visibility: 'public', row: makeRow(cls, level, makeState({ level })) }),
        );
        expect('stats' in sheet).toBe(false);
        expect('vitals' in sheet).toBe(false);
        expect('gold' in sheet).toBe(false);
        expect('pos' in sheet).toBe(false);
      }
    }
  });
});

describe('characterSheet: reliquary completion pair + rank', () => {
  it('reads reliquary through the two NARROW restore helpers, never the whole state', () => {
    // Source-pinned because the narrowing is invisible in behavior: the sheet
    // needs marks and recent only, and restoreReliquaryState would rebuild
    // firstFind, counts, and illuminatedPages as well on every public sheet
    // read. Positive control first, so a mistyped path or an empty read cannot
    // satisfy the negative on its own.
    const src = readFileSync(new URL('../server/character_sheet.ts', import.meta.url), 'utf8');
    expect(src).toContain('restoreReliquaryMarks');
    expect(src).toContain('restoreReliquaryRecent');
    expect(src).not.toContain('restoreReliquaryState');
  });

  it('emits character-scoped zero completion and unranked on a fresh save', () => {
    const sheet = characterSheet(input({ visibility: 'public' }));
    const emptyTotal = catalogCharacterCompletion({ itemsDiscovered: new Set() }).total;
    // `recent: []` (Phase 20): a state blob with no reliquary key has no ring,
    // and the strip is an empty array rather than an absent field, so every
    // consumer sees one shape.
    expect(sheet.reliquary).toEqual({ owned: 0, total: emptyTotal, curatorRank: 0, recent: [] });
    expect(Object.keys(sheet.reliquary).sort()).toEqual([
      'curatorRank',
      'owned',
      'recent',
      'total',
    ]);
  });

  it('counts catalogued discoveries and rank without inventing firstFind', () => {
    const sheet = characterSheet(
      input({
        visibility: 'public',
        row: makeRow(
          'shaman',
          20,
          makeState({
            deedStats: {
              itemsDiscovered: ['boundstone_helm', 'cryptbone_helm'],
            } as CharacterState['deedStats'],
          }),
        ),
      }),
    );
    expect(sheet.reliquary.owned).toBe(2);
    expect(sheet.reliquary.curatorRank).toBe(1);
    // 'recent' joined the block in Phase 20 (the recent-finds strip); this
    // fixture has no ring, so ownership alone still publishes an empty one.
    expect(Object.keys(sheet.reliquary).sort()).toEqual([
      'curatorRank',
      'owned',
      'recent',
      'total',
    ]);
    expect(sheet.reliquary.recent).toEqual([]);
  });

  it('publishes the recent strip but never firstFind, the obtain tally, or the marks set', () => {
    // Phase 20 changed what "personal" means for ONE of these surfaces: the
    // recent ring's ids and kinds are now deliberately public (the strip), on
    // the finding that every id it can hold is public catalog content already.
    // Nothing else moved, so the rest of the blob is still forbidden here.
    const state = makeState({
      deedStats: {
        itemsDiscovered: ['cryptbone_helm'],
      } as CharacterState['deedStats'],
      reliquary: {
        firstFind: { cryptbone_helm: { clears: 3, count: 2 } },
        // TWO marks, only ONE of them in the ring: the strip is a window on
        // the recent ring, never a dump of mark membership, and the mark that
        // is owned but not recent is what makes that decisive.
        marks: ['masterwork:first', 'gather_event:pristine_vein'],
        recent: ['cryptbone_helm', 'masterwork:first'],
      },
    });
    const sheet = characterSheet(
      input({ visibility: 'public', row: makeRow('shaman', 20, state) }),
    );
    expect(Object.keys(sheet.reliquary).sort()).toEqual([
      'curatorRank',
      'owned',
      'recent',
      'total',
    ]);
    // Mark ownership scores (one item + two marks); personal meta never
    // appears on the wire object.
    expect(sheet.reliquary.owned).toBeGreaterThanOrEqual(3);
    expect(sheet.reliquary.recent).toEqual([
      { id: 'masterwork:first', kind: 'mark' },
      { id: 'cryptbone_helm', kind: 'item' },
    ]);
    const json = JSON.stringify(sheet.reliquary);
    expect(json).not.toContain('firstFind');
    expect(json).not.toContain('clears');
    // The owned-but-not-recent mark: present in the blob, scored into `owned`,
    // and absent from the JSON. A strip that ever published the marks SET
    // instead of the ring window reds here.
    expect(json).not.toContain('gather_event:pristine_vein');
    expect(json).not.toContain('"marks"');
    // The Phase 17 obtain tally is personal meta too: it rides folded into a
    // firstFind entry, so a sheet that ever dumped the blob would leak it.
    // Quoted so a future benign field like accountId (which contains the bare
    // substring) cannot turn this into a false failure.
    expect(json).not.toContain('"count"');
  });

  it('strips the ring to the newest SHEET_RECENT_RELICS entries, newest first', () => {
    // Literal: the shipped bound re-pinned line-adjacent, so this test's slice
    // arithmetic cannot self-agree with a drifted constant.
    expect(SHEET_RECENT_RELICS).toBe(5);
    const ids = cataloguedItemIds().slice(0, SHEET_RECENT_RELICS + 3);
    expect(ids.length, 'the catalog must supply more item ids than the strip bound').toBe(
      SHEET_RECENT_RELICS + 3,
    );
    // The stored ring is OLDEST-first, so the strip is the TAIL, reversed.
    const reliquary = sheetReliquaryFromState(
      makeState({ reliquary: { firstFind: {}, marks: [], recent: ids } }),
    );
    expect(reliquary.recent).toEqual(
      ids
        .slice(-SHEET_RECENT_RELICS)
        .reverse()
        .map((id) => ({ id, kind: 'item' })),
    );
  });

  it('dedupes a repeated id through the full restore-then-strip composition', () => {
    // An over-cap ring carrying the newest id a second time inside the strip
    // window, driven through sheetReliquaryFromState so the last-occurrence
    // dedupe and the take-5 window run TOGETHER (each half is pinned alone
    // elsewhere; this is the composition). The RELIQUARY_RECENT_CAP trim runs
    // on this input but cannot change the strip's output (the take-5 window
    // is smaller than the cap); its own literal pin lives in
    // tests/reliquary_state.test.ts.
    const ids = cataloguedItemIds().slice(0, RELIQUARY_RECENT_CAP + 3);
    expect(ids.length, 'the catalog must overfill the ring cap').toBe(RELIQUARY_RECENT_CAP + 3);
    const ring = [...ids];
    ring[ids.length - 3] = ids[ids.length - 1]; // newest id repeats two slots down
    const reliquary = sheetReliquaryFromState(
      makeState({ reliquary: { firstFind: {}, marks: [], recent: ring } }),
    );
    // Newest-first, the repeat surviving exactly ONCE at the head; the entry
    // it displaced (ids[len-3]) must not appear, and the window backfills from
    // the next-older distinct ids instead of shifting a duplicate in.
    const len = ids.length;
    expect(reliquary.recent).toEqual(
      [ids[len - 1], ids[len - 2], ids[len - 4], ids[len - 5], ids[len - 6]].map((id) => ({
        id,
        kind: 'item',
      })),
    );
  });

  it('classifies an item id and a mark id by kind', () => {
    // Fixture-guard both exemplars against the live catalog, so a content move
    // that unlists either one fails here instead of silently reclassifying it.
    expect(isCataloguedRelicItem('cryptbone_helm')).toBe(true);
    expect(RELIQUARY_MARK_IDS.has('cryptbone_helm')).toBe(false);
    expect(RELIQUARY_MARK_IDS.has('masterwork:first')).toBe(true);
    expect(isCataloguedRelicItem('masterwork:first')).toBe(false);
    const reliquary = sheetReliquaryFromState(
      makeState({
        reliquary: { firstFind: {}, marks: [], recent: ['masterwork:first', 'cryptbone_helm'] },
      }),
    );
    expect(reliquary.recent).toEqual([
      { id: 'cryptbone_helm', kind: 'item' },
      { id: 'masterwork:first', kind: 'mark' },
    ]);
  });

  it('fails closed on an id the live catalog does not know, without spending a slot', () => {
    // Fixture-guard the unknown id against BOTH predicates: it must be neither
    // a catalogued item nor an authored mark for this to test what it claims.
    expect(isCataloguedRelicItem('gone_relic')).toBe(false);
    expect(RELIQUARY_MARK_IDS.has('gone_relic')).toBe(false);
    const ids = cataloguedItemIds().slice(0, SHEET_RECENT_RELICS);
    expect(ids.length).toBe(SHEET_RECENT_RELICS);
    // The drifted id sits in the MIDDLE of the ring: dropping it must not cost
    // one of the five slots (a slice-then-filter strip would return four).
    const recent = [ids[0], ids[1], 'gone_relic', ids[2], ids[3], ids[4]];
    const reliquary = sheetReliquaryFromState(
      makeState({ reliquary: { firstFind: {}, marks: [], recent } }),
    );
    expect(reliquary.recent.map((r) => r.id)).toEqual([...ids].reverse());
    expect(JSON.stringify(reliquary)).not.toContain('gone_relic');
  });

  it('drops a RING id that is neither a catalogued item nor an authored mark', () => {
    // The fail-closed arm of sheetRecentRelicsFromRing, pinned DIRECTLY on the
    // arm rather than through the sheet. It is unreachable from the saved-blob
    // side, because restoreReliquaryRecent applies the identical predicate to
    // the blob first, so no fixture fed through sheetReliquaryFromState can
    // exercise it: the ring core takes the RING for exactly this reason, and
    // this hands it the input no restore would ever produce.
    // Fixture-guard the intruder against BOTH predicates, or the test claims
    // something it does not test.
    expect(isCataloguedRelicItem('gone_relic')).toBe(false);
    expect(RELIQUARY_MARK_IDS.has('gone_relic')).toBe(false);
    // Positive control in the same call: a valid id of EACH kind flanks the
    // intruder, so an arm that dropped everything (or a classifier that answers
    // undefined for real ids) fails here instead of passing on an empty result.
    expect(isCataloguedRelicItem('cryptbone_helm')).toBe(true);
    expect(RELIQUARY_MARK_IDS.has('masterwork:first')).toBe(true);
    expect(sheetRecentRelicsFromRing(['cryptbone_helm', 'gone_relic', 'masterwork:first'])).toEqual(
      [
        { id: 'masterwork:first', kind: 'mark' },
        { id: 'cryptbone_helm', kind: 'item' },
      ],
    );
    // And the skip does not spend one of the five slots: the intruder sits in
    // the middle of a ring that is otherwise exactly the bound, so a
    // slice-then-filter arm returns four here.
    const ids = cataloguedItemIds().slice(0, SHEET_RECENT_RELICS);
    expect(ids.length).toBe(SHEET_RECENT_RELICS);
    const padded = [ids[0], ids[1], 'gone_relic', ids[2], ids[3], ids[4]];
    expect(sheetRecentRelicsFromRing(padded).map((r) => r.id)).toEqual([...ids].reverse());
  });

  it('sheetRecentRelicsFromSaved fails closed on a SAVED id of neither kind', () => {
    // The composition of the two halves. The drop happens one step earlier here
    // (inside restoreReliquaryRecent), which is the whole reason the arm above
    // needed its own ring-level pin; this one says the end-to-end contract
    // still holds, with both kinds surviving so it cannot pass by returning
    // nothing at all.
    expect(
      sheetRecentRelicsFromSaved({
        firstFind: {},
        marks: [],
        recent: ['cryptbone_helm', 'gone_relic', 'masterwork:first'],
      }),
    ).toEqual([
      { id: 'masterwork:first', kind: 'mark' },
      { id: 'cryptbone_helm', kind: 'item' },
    ]);
  });

  it('publishes an empty strip for an absent ring and for an all-drifted one', () => {
    expect(sheetReliquaryFromState(makeState()).recent).toEqual([]);
    expect(
      sheetReliquaryFromState(makeState({ reliquary: { firstFind: {}, marks: [], recent: [] } }))
        .recent,
    ).toEqual([]);
    expect(
      sheetReliquaryFromState(
        makeState({ reliquary: { firstFind: {}, marks: [], recent: ['gone_relic'] } }),
      ).recent,
    ).toEqual([]);
  });

  it('owner and public carry the identical strip (no hidden concept to strip)', () => {
    // Unlike deeds.recent, which drops hidden ids on the public arm: hidden
    // deeds never enter the Reliquary catalog, so the two arms are the same
    // list by design, and this pin is what says so out loud.
    const state = makeState({
      reliquary: { firstFind: {}, marks: [], recent: ['cryptbone_helm', 'masterwork:first'] },
    });
    const pub = characterSheet(input({ visibility: 'public', row: makeRow('shaman', 20, state) }));
    const own = characterSheet(input({ visibility: 'owner', row: makeRow('shaman', 20, state) }));
    expect(pub.reliquary.recent).toEqual([
      { id: 'masterwork:first', kind: 'mark' },
      { id: 'cryptbone_helm', kind: 'item' },
    ]);
    expect(pub.reliquary.recent).toEqual(own.reliquary.recent);
  });

  it('sheetRelicRecentText resolves English names and fails closed on drift', () => {
    // Items carry their English content name; marks resolve through the
    // hand-maintained RELIQUARY_MARK_ENGLISH table (content authors marks as
    // bare ids, with no English name field of their own).
    expect(sheetRelicRecentText({ id: 'cryptbone_helm', kind: 'item' })).toBe(
      ITEMS.cryptbone_helm.name,
    );
    expect(sheetRelicRecentText({ id: 'masterwork:first', kind: 'mark' })).toBe('First Masterwork');
    // A Phase 21 rare-slain proof resolves its 'Slain: <mob name>' label.
    expect(sheetRelicRecentText({ id: 'slain:old_greyjaw', kind: 'mark' })).toBe(
      'Slain: Old Greyjaw',
    );
    expect(sheetRelicRecentText({ id: 'gone_relic', kind: 'item' })).toBeNull();
    expect(sheetRelicRecentText({ id: 'gone_mark', kind: 'mark' })).toBeNull();
    // A prototype key must fail closed rather than resolving through
    // Object.prototype (which would render the string 'Object').
    expect(sheetRelicRecentText({ id: 'constructor', kind: 'item' })).toBeNull();
    expect(sheetRelicRecentText({ id: 'constructor', kind: 'mark' })).toBeNull();
  });

  it('every authored mark has a server English name, matching the client catalog', () => {
    // Growth cross-pin: a new mark id in the catalog must grow the server
    // table, or the /c/ page would silently drop that find from the strip.
    // The client catalog side is the drift pin (two independently maintained
    // sources), mirroring the Curator rank-name pair above.
    const markFind = hudChromeStrings.reliquary.markFind as Record<string, string>;
    expect(RELIQUARY_MARK_IDS.size).toBeGreaterThan(0);
    for (const markId of RELIQUARY_MARK_IDS) {
      const english = sheetRelicRecentText({ id: markId, kind: 'mark' });
      expect(english, `server English name for ${markId}`).not.toBeNull();
      expect(english, `client catalog name for ${markId}`).toBe(
        markFind[markId.replace(/:/g, '_')],
      );
    }
  });

  it('every RELIQUARY_MARK_ENGLISH key is still a live mark id', () => {
    // The REVERSE of the growth pin above, and it needs the table's own KEYS:
    // a sweep that only looks ids up (which is all sheetRelicRecentText can do)
    // is blind to a row whose id content has RETIRED, so a stale entry would sit
    // in the table forever naming something no character can hold. Collected
    // into an array rather than asserted per id, so a failure prints the
    // offending key instead of a bare false.
    expect(RELIQUARY_MARK_ENGLISH.size).toBeGreaterThan(0);
    const retired = [...RELIQUARY_MARK_ENGLISH.keys()].filter((id) => !RELIQUARY_MARK_IDS.has(id));
    expect(retired).toEqual([]);
    // Forward (above) plus reverse (here) is set equality; the size pin says so
    // once and additionally catches a table that lost a row to a duplicate key.
    expect(RELIQUARY_MARK_ENGLISH.size).toBe(RELIQUARY_MARK_IDS.size);
  });

  it('every slain mark row reads Slain: <live mob display name> (derived, not restated)', () => {
    // The Phase 21 rows embed mob display names by hand in three tables (this
    // server one, the client markFind catalog, and the wiki generator; the
    // markFind cross-pin above holds server == client). Deriving the expected
    // string from MOBS here is what reds a renamed rare or a name typo in the
    // hand rows, which the presence pins alone can never see.
    let slainRows = 0;
    for (const [markId, english] of RELIQUARY_MARK_ENGLISH) {
      if (!markId.startsWith('slain:')) continue;
      slainRows += 1;
      const templateId = markId.slice('slain:'.length);
      const mob = MOBS[templateId];
      expect(mob, markId).toBeDefined();
      expect(english, markId).toBe(`Slain: ${mob.name}`);
    }
    // Snug floor: the 19 Rares of the Realm proofs.
    expect(slainRows).toBe(19);
  });

  it('scores marks through sheetReliquaryFromState', () => {
    const base = sheetReliquaryFromState(makeState());
    const withMark = sheetReliquaryFromState(
      makeState({
        reliquary: { firstFind: {}, marks: ['masterwork:first'], recent: [] },
      }),
    );
    expect(withMark.owned).toBe(base.owned + 1);
    expect(withMark.total).toBe(base.total);
  });

  it('scores a bank reins mount through sheetReliquaryFromState', () => {
    // Fixture-guard the exemplar against the live tables: the reins item is a
    // real mount item whose mount key fills a catalogued mount relic slot.
    const reinsDef = ITEMS.reins_valorsteed;
    if (reinsDef.kind !== 'mount') throw new Error('reins_valorsteed mount fixture missing');
    const cataloguedMountIds = RELIQUARY_PAGES.flatMap((page) =>
      page.relics.flatMap((relic) => (relic.kind === 'mount' ? [relic.mountId] : [])),
    );
    expect(cataloguedMountIds).toContain(reinsDef.mount);
    // Delta against the same fixture without the reins: dropping the
    // ownedMounts wiring from the sheet opts reds exactly this test.
    const base = sheetReliquaryFromState(makeState());
    const withReins = sheetReliquaryFromState(
      makeState({
        bank: {
          inventory: [{ itemId: 'reins_valorsteed', count: 1 }],
          purchasedSlots: 0,
          bonusSlots: 0,
        },
      }),
    );
    expect(withReins.owned).toBe(base.owned + 1);
    // Ownership moves, the catalog size does not.
    expect(withReins.total).toBe(base.total);
  });

  it('scores a bag reins mount through sheetReliquaryFromState', () => {
    // The sheet unions bags AND bank before reading mounts; the bank sibling
    // above covers one arm, this covers the other, so dropping either half of
    // the union reds exactly one of the two.
    const reinsDef = ITEMS.reins_valorsteed;
    if (reinsDef.kind !== 'mount') throw new Error('reins_valorsteed mount fixture missing');
    const cataloguedMountIds = RELIQUARY_PAGES.flatMap((page) =>
      page.relics.flatMap((relic) => (relic.kind === 'mount' ? [relic.mountId] : [])),
    );
    expect(cataloguedMountIds).toContain(reinsDef.mount);
    const base = sheetReliquaryFromState(makeState());
    const withReins = sheetReliquaryFromState(
      makeState({ inventory: [{ itemId: 'reins_valorsteed', count: 1 }] }),
    );
    expect(withReins.owned).toBe(base.owned + 1);
    expect(withReins.total).toBe(base.total);
  });

  it('scores an earned title deed through sheetReliquaryFromState', () => {
    // Fixture-guard the exemplar against the live tables: prog_veteran is a
    // real title-reward deed filling a catalogued title relic slot.
    expect(DEEDS.prog_veteran.reward?.kind).toBe('title');
    const cataloguedTitleDeedIds = RELIQUARY_PAGES.flatMap((page) =>
      page.relics.flatMap((relic) => (relic.kind === 'title' ? [relic.deedId] : [])),
    );
    expect(cataloguedTitleDeedIds).toContain('prog_veteran');
    // Delta against the same fixture without the deed: dropping the
    // deedsEarned wiring from the sheet opts reds exactly this test.
    const base = sheetReliquaryFromState(makeState());
    const withTitleDeed = sheetReliquaryFromState(
      makeState({ deeds: { prog_veteran: '2026-07-08' } }),
    );
    expect(withTitleDeed.owned).toBe(base.owned + 1);
    // Ownership moves, the catalog size does not.
    expect(withTitleDeed.total).toBe(base.total);
  });

  it('owner and public share the same reliquary numbers for the same blob', () => {
    const state = makeState({
      deedStats: {
        itemsDiscovered: ['boundstone_helm'],
      } as CharacterState['deedStats'],
    });
    const pub = characterSheet(input({ visibility: 'public', row: makeRow('shaman', 20, state) }));
    const own = characterSheet(input({ visibility: 'owner', row: makeRow('shaman', 20, state) }));
    expect(pub.reliquary).toEqual(own.reliquary);
  });

  it('sheetCuratorRankText returns English names for ranks 1 to 5 and null otherwise', () => {
    expect(sheetCuratorRankText(0)).toBeNull();
    expect(sheetCuratorRankText(1)).toBe('Apprentice Curator');
    expect(sheetCuratorRankText(2)).toBe('Spoilskeeper');
    expect(sheetCuratorRankText(3)).toBe('Master Curator');
    expect(sheetCuratorRankText(4)).toBe('Grand Curator');
    expect(sheetCuratorRankText(5)).toBe('Eternal Curator');
    // Literal 6 = today's out-of-range boundary; the derived pins below own
    // growth, so on a sixth rank this literal moves to 7 and a rank-6 name
    // literal joins the list above (the derived pair stays untouched).
    expect(sheetCuratorRankText(6)).toBeNull();
    expect(sheetCuratorRankText(99)).toBeNull();
    // Growth cross-pin against the live rank table: if a sixth rank ships in
    // CURATOR_RANK_DEFS, the module-private English list must grow with it
    // instead of silently rendering a rank-6 character as Unranked (the
    // literal 6 above would keep passing through the `?? null` fallback).
    expect(sheetCuratorRankText(CURATOR_RANK_DEFS.length)).not.toBeNull();
    expect(sheetCuratorRankText(CURATOR_RANK_DEFS.length + 1)).toBeNull();
  });

  it('server rank names match the client hudChrome catalog rank names', () => {
    // The server's English list and the client i18n catalog are maintained as
    // two independent sources, so this is a real drift pin: a rename on either
    // side alone turns it red. The literal pins above stay alongside it so a
    // synchronized rename of both sides still shows up in review.
    const clientRankNames = [
      hudChromeStrings.reliquary.curatorRankName1,
      hudChromeStrings.reliquary.curatorRankName2,
      hudChromeStrings.reliquary.curatorRankName3,
      hudChromeStrings.reliquary.curatorRankName4,
      hudChromeStrings.reliquary.curatorRankName5,
    ];
    // Growth pin for the CLIENT side of the pair: a sixth rank in
    // CURATOR_RANK_DEFS must grow this hand list (and so the catalog key it
    // reads) before this test goes green again.
    expect(clientRankNames.length).toBe(CURATOR_RANK_DEFS.length);
    for (let rank = 1; rank <= CURATOR_RANK_DEFS.length; rank++) {
      expect(sheetCuratorRankText(rank), `curator rank ${rank}`).toBe(clientRankNames[rank - 1]);
    }
  });
});

describe('characterSheet: deeds.recent hidden/unknown filter', () => {
  // A known non-hidden deed, a known hidden deed, and an id with no live
  // DeedDef (newer content on a mixed-version fleet, or a rollback).
  const recent = [
    { deedId: 'prog_veteran', earnedAt: '2026-06-01T00:00:00.000Z' },
    { deedId: 'hid_saul_footnote', earnedAt: '2026-06-02T00:00:00.000Z' },
    { deedId: 'gone_deed', earnedAt: '2026-06-03T00:00:00.000Z' },
  ];

  it('public visibility keeps only the known non-hidden row (fails closed on hidden and unknown)', () => {
    // Fixture-guard the exemplars against the real catalog.
    expect(DEEDS.prog_veteran.hidden).not.toBe(true);
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);
    expect(DEEDS.gone_deed).toBeUndefined();
    const sheet = characterSheet(input({ visibility: 'public', deedsRecent: recent }));
    expect(sheet.deeds.recent.map((r) => r.deedId)).toEqual(['prog_veteran']);
  });

  it('owner visibility keeps all three rows, including the earner own hidden and drifted deeds', () => {
    const sheet = characterSheet(input({ visibility: 'owner', deedsRecent: recent }));
    expect(sheet.deeds.recent.map((r) => r.deedId)).toEqual([
      'prog_veteran',
      'hid_saul_footnote',
      'gone_deed',
    ]);
  });

  it('public visibility coarsens earnedAt to the UTC day; owner keeps the exact stamp', () => {
    const stamped = [{ deedId: 'prog_veteran', earnedAt: '2026-06-01T13:45:22.318Z' }];
    const pub = characterSheet(input({ visibility: 'public', deedsRecent: stamped }));
    expect(pub.deeds.recent).toEqual([{ deedId: 'prog_veteran', earnedAt: '2026-06-01' }]);
    const own = characterSheet(input({ visibility: 'owner', deedsRecent: stamped }));
    expect(own.deeds.recent).toEqual([
      { deedId: 'prog_veteran', earnedAt: '2026-06-01T13:45:22.318Z' },
    ]);
  });
});
