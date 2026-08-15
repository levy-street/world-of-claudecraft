// Reliquary Phase 1 foundation: sparse state, mark hooks, serialize omit-empty,
// pure completion helpers. No UI / wire coverage here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { DEEDS } from '../src/sim/content/deeds';
import { delveShopGateUnlocked } from '../src/sim/content/delves/shop';
import { recipeById } from '../src/sim/content/recipes';
import {
  isCataloguedRelicItem,
  RELIQUARY_MARK_IDS,
  RELIQUARY_PAGES,
  type ReliquaryPageDef,
} from '../src/sim/content/reliquary';
import { MECH_CHROMAS, mechChromaItemId } from '../src/sim/content/skins';
import { DELVES, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import {
  checkDeedTrigger,
  grantDeed,
  markItemDiscovered,
  onMobKillCreditForDeeds,
} from '../src/sim/deeds';
import { grantDelveClearTo } from '../src/sim/delves/runs';
import { createMob } from '../src/sim/entity';
import { grantCopies } from '../src/sim/item_instance_transfer';
import { mountItemId, ownedMounts } from '../src/sim/mounts';
import { isCommissionEligible } from '../src/sim/professions/commission';
import {
  acceptCommissionOrder,
  deliverCommissionOrder,
  openCommissionOrder,
} from '../src/sim/professions/commission_order';
import {
  CURATOR_RANK_DEFS,
  CURATOR_RANK_THRESHOLDS,
  catalogCharacterCompletion,
  catalogItemCompletion,
  catalogRankOwned,
  catalogRelicCompletion,
  characterReliquaryOwnership,
  clearCountForSource,
  curatorRankFromOwned,
  curatorSealIdForRank,
  freshReliquaryState,
  isReliquaryStateEmpty,
  noteRelicItemFind,
  noteRelicObtain,
  noteReliquaryMark,
  onItemDiscovered,
  pageCompletion,
  RELIQUARY_COMPLETION_DEED_IDS,
  RELIQUARY_ILLUMINATION_DEED_PAGES,
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_OBTAIN_COUNT_CAP,
  RELIQUARY_PAGES_BY_ID,
  RELIQUARY_RECENT_CAP,
  relicFillScoresForRank,
  reliquaryCatalogIndexProbe,
  reliquaryOwnershipOpts,
  reliquaryScoringPagesProbe,
  reliquaryWireCacheProbe,
  reliquaryWireJson,
  restoreReliquaryMarks,
  restoreReliquaryRecent,
  restoreReliquaryState,
  type SavedReliquaryState,
  serializeReliquaryState,
  syncCuratorRankDeeds,
  syncIlluminatedPages,
  syncReliquaryCompletionDeeds,
  syncReliquaryMarksFromVisited,
} from '../src/sim/reliquary';
import { type CharacterState, Sim } from '../src/sim/sim';
import { runApplyEnchant, runCraft } from './helpers/enchant_family_cast';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function primary(sim: Sim) {
  const meta = sim.players.get(sim.playerId)!;
  const e = sim.entities.get(sim.playerId)!;
  return { meta, e };
}

/** Catalogued Hollow Crypt unique (Phase 2 expanded conquerors_hollow_crypt). */
const CATALOGUE_RELIC = 'cryptbone_helm';
/** A catalogued relic that STACKS (a Professions-shelf specimen), so the
 *  per-copy half of the counting contract is reachable through plain addItem.
 *  File-scoped: the obtain-counts AND determinism describes both drive it. */
const STACKABLE_RELIC = 'pristine_hide';
/** Real stackable item that is NOT a catalogued Reliquary relic. Was
 *  glimmerfin_koi until Phase 21 catalogued the koi on the specimen page;
 *  bone_fragments is boss-table junk the curation-bounds pin in
 *  tests/reliquary_content.test.ts holds OUT of the catalog, so this control
 *  cannot silently become a relic again. */
const NON_RELIC = 'bone_fragments';

describe('Reliquary fresh state + serialize omit-empty', () => {
  it('a new character has empty reliquary state and serializes without the key', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(meta.reliquary.firstFind).toEqual({});
    expect(meta.reliquary.marks.size).toBe(0);
    expect(meta.reliquary.recent).toEqual([]);
    expect(isReliquaryStateEmpty(meta.reliquary)).toBe(true);

    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.reliquary).toBeUndefined();
  });

  it('serializeReliquaryState returns undefined for a fresh state', () => {
    expect(serializeReliquaryState(freshReliquaryState())).toBeUndefined();
  });

  it('restore of undefined yields empty state', () => {
    const restored = restoreReliquaryState(undefined);
    expect(isReliquaryStateEmpty(restored)).toBe(true);
  });
});

describe('Reliquary first discover of a catalogued relic', () => {
  it('writes firstFind + recent on first markItemDiscovered; second is a no-op', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(isCataloguedRelicItem(CATALOGUE_RELIC)).toBe(true);

    // Stamp a known clear count so firstFind.clears is observable.
    meta.deedStats.dungeonClears.hollow_crypt = 3;

    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    // toEqual on the WHOLE entry: Phase 17 dropped the pageId diagnostic, so a
    // stray extra key reds here rather than riding along unnoticed.
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 3 });
    expect(meta.reliquary.recent).toEqual([CATALOGUE_RELIC]);

    // Second discover: no re-stamp, no double recent entry.
    meta.deedStats.dungeonClears.hollow_crypt = 99;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 3 });
    expect(meta.reliquary.recent).toEqual([CATALOGUE_RELIC]);
  });

  it('omits clears entirely when the crediting page clear meter reads zero', () => {
    // The executed ruling (maintainer, 2026-08-08): omit at zero. A zero says
    // nothing about provenance, and the surfaces it reached said something
    // false, that the relic was "first found on clear 0". The two shapes it
    // covers are a provenance-unknown acquisition (bought, traded, mailed) and
    // a drop taken mid first run, before that run's clear was credited. Both
    // now land sparse, which is the same shape the retro seed writes for
    // ownership that predates the system: owned, provenance unknown.
    // Driven through the real discover path.
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(RELIQUARY_PAGES_BY_ID.conquerors_hollow_crypt.clearSource).toEqual({
      kind: 'dungeon',
      dungeonId: 'hollow_crypt',
      difficulty: 'normal',
    });
    expect(meta.deedStats.dungeonClears.hollow_crypt).toBeUndefined();

    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    // toEqual({}), not a key probe: the entry itself must still land (the fill
    // is real membership meta), and a resurrected clears: 0 or a revived
    // pageId both red here.
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});
    // One clear later, the same page stamps for real: the omission is about
    // the meter reading zero, not about this page having no meter at all.
    const other = 'cryptbone_greaves';
    meta.deedStats.dungeonClears.hollow_crypt = 1;
    markItemDiscovered(sim.ctx, meta, other);
    expect(meta.reliquary.firstFind[other]).toEqual({ clears: 1 });
  });

  it('onItemDiscovered alone does not dual-write itemsDiscovered', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const before = meta.deedStats.itemsDiscovered.size;
    onItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    // Still writes firstFind when called directly (catalogued), but never
    // adds the item to the discovery set (that is deeds' job).
    expect(meta.deedStats.itemsDiscovered.size).toBe(before);
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();
  });
});

describe('Reliquary non-catalogued discover', () => {
  it('does not grow firstFind or recent for a non-relic item', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(isCataloguedRelicItem(NON_RELIC)).toBe(false);

    markItemDiscovered(sim.ctx, meta, NON_RELIC);
    expect(meta.deedStats.itemsDiscovered.has(NON_RELIC)).toBe(true);
    expect(meta.reliquary.firstFind[NON_RELIC]).toBeUndefined();
    expect(meta.reliquary.recent).toEqual([]);
    expect(Object.keys(meta.reliquary.firstFind)).toEqual([]);
  });
});

describe('Reliquary retro ownership without inventing firstFind clears', () => {
  it('counts discovered items as owned even when firstFind is absent', () => {
    const owned = new Set([CATALOGUE_RELIC]);
    const page = RELIQUARY_PAGES.find((p) => p.id === 'conquerors_hollow_crypt')!;
    const progress = pageCompletion(page, { itemsDiscovered: owned });
    expect(progress.owned).toBe(1);
    expect(progress.total).toBe(page.relics.length);
    expect(progress.complete).toBe(false);
    // Own every slot: retro completion without firstFind clears.
    const allOwned = new Set(page.relics.filter((r) => r.kind === 'item').map((r) => r.itemId));
    expect(pageCompletion(page, { itemsDiscovered: allOwned }).complete).toBe(true);

    const catalog = catalogItemCompletion(owned);
    expect(catalog.owned).toBe(1);
    expect(catalog.total).toBeGreaterThan(1);
  });

  it('a pre-Reliquary save with discovery loads owned without firstFind clears', () => {
    const held: CharacterState = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 30,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [{ itemId: CATALOGUE_RELIC, count: 1 }],
      questLog: [],
      questsDone: [],
      deedStats: { itemsDiscovered: [CATALOGUE_RELIC] },
      // No reliquary key: veteran ownership predates the system.
    };
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran', { state: held });
    const meta = sim.players.get(pid)!;

    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeUndefined();
    expect(isReliquaryStateEmpty(meta.reliquary)).toBe(true);

    // Pure completion still sees the item as owned (partial page is fine).
    const page = RELIQUARY_PAGES.find((p) => p.id === 'conquerors_hollow_crypt')!;
    const progress = pageCompletion(page, { itemsDiscovered: meta.deedStats.itemsDiscovered });
    expect(progress.owned).toBe(1);
    expect(progress.complete).toBe(false);

    // Re-discover does not invent a late firstFind once already in the set
    // (the hub short-circuits before the Reliquary hook).
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeUndefined();
  });
});

describe('Reliquary serialize / restore round-trip', () => {
  it('round-trips firstFind, marks, and recent; filters unknown ids on load', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.dungeonClears.hollow_crypt = 2;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);

    // Two more obtains of the same relic, so the folded tally has a value that
    // is neither absent nor 1 and a dropped fold cannot pass by coincidence.
    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(2);

    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.reliquary).toBeDefined();
    // The tally rides folded ONTO the entry (count), never as a fourth
    // top-level key; pageId is gone.
    expect(state.reliquary!.firstFind?.[CATALOGUE_RELIC]).toEqual({ clears: 2, count: 2 });
    expect(state.reliquary!.recent).toEqual([CATALOGUE_RELIC]);

    // Hand-edited unknown ids must not grow membership on restore, and a count
    // riding one of them vanishes with the entry it rode in on.
    const dirty: CharacterState = {
      ...state,
      reliquary: {
        firstFind: {
          ...(state.reliquary!.firstFind ?? {}),
          not_a_real_relic: { clears: 9, count: 7 },
        },
        marks: ['not_an_authored_mark'],
        recent: [CATALOGUE_RELIC, 'not_a_real_relic'],
      },
    };
    const sim2 = makeSim();
    const pid = sim2.addPlayer('warrior', 'Reload', { state: dirty });
    const m2 = sim2.players.get(pid)!;
    expect(m2.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 2 });
    expect(m2.reliquary.counts[CATALOGUE_RELIC]).toBe(2);
    expect(m2.reliquary.firstFind.not_a_real_relic).toBeUndefined();
    // The subset invariant, adversarially: counts keys can only ever name an
    // entry that survived, so the uncatalogued row's count is gone too.
    expect(Object.hasOwn(m2.reliquary.counts, 'not_a_real_relic')).toBe(false);
    expect(Object.keys(m2.reliquary.counts).every((id) => id in m2.reliquary.firstFind)).toBe(true);
    expect(m2.reliquary.marks.size).toBe(0);
    expect(m2.reliquary.recent).toEqual([CATALOGUE_RELIC]);
  });

  it('restore sanitizes clears and count per FIELD on catalogued entries', () => {
    // Every id here is catalogued, so the field guards are actually reached
    // (an uncatalogued id is dropped before either filter runs). Snug floor:
    // the slice must fill all thirteen fixtures. Phase 17 retired the pageId
    // fixtures with the field and added the tally's own guards in their place.
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, 13);
    expect(ids.length).toBe(13);
    const [
      negative,
      infinite,
      notANumber,
      fractional,
      zeroClears,
      staleShape,
      stringClears,
      zeroCount,
      hugeCount,
      stringCount,
      nanCount,
      nullCount,
      nonObject,
    ] = ids;

    const restored = restoreReliquaryState({
      firstFind: {
        [negative]: { clears: -3, count: 4 },
        [infinite]: { clears: Number.POSITIVE_INFINITY },
        [notANumber]: { clears: Number.NaN },
        [fractional]: { clears: 2.7, count: 3.9 },
        // The executed omit-at-zero ruling, on the LOAD side: a legacy blob
        // written before it still carries clears: 0, and 0.x floors into the
        // same case. Both drop the field and keep the entry.
        [zeroClears]: { clears: 0.6 },
        // A pre-Phase-17 blob: the retired pageId is simply not read, and the
        // entry loads clean rather than being rejected for carrying it.
        [staleShape]: { clears: 3, pageId: 'conquerors_hollow_crypt' } as never,
        // A string clears fails the typeof gate outright (never coerced).
        [stringClears]: { clears: '5' } as never,
        // A tally of zero is the absent key, never a stored 0.
        [zeroCount]: { count: 0 },
        // Above the cap clamps rather than dropping: the obtain happened.
        [hugeCount]: { count: RELIQUARY_OBTAIN_COUNT_CAP * 10 },
        // A string count fails the typeof gate outright (never coerced: '5'
        // must not floor to 5 and persist), and a NaN count fails the finite
        // gate; each covers a sanitizeObtainCount arm the numeric fixtures
        // above cannot reach.
        [stringCount]: { count: '5' } as never,
        [nanCount]: { count: Number.NaN },
        // The on-disk spelling of numeric corruption: JSON.stringify writes
        // NaN and Infinity as null (and jsonb rejects the bare literals), so
        // null is the form a corrupted tally actually takes in Postgres.
        [nullCount]: { count: null } as never,
        // A non-object entry is dropped WHOLE (the entry guard), unlike every
        // per-field case above, which keeps the entry and drops the field.
        [nonObject]: 'junk' as never,
      },
    });

    // Every catalogued OBJECT entry survives with only the offending field
    // dropped; the non-object entry is dropped whole.
    expect(Object.keys(restored.firstFind).sort()).toEqual(
      ids.filter((id) => id !== nonObject).sort(),
    );
    expect(Object.hasOwn(restored.firstFind, nonObject)).toBe(false);
    // Negative clears are dropped outright (absent key, never clamped to 0),
    // while the valid count on the same entry still lands.
    expect(Object.hasOwn(restored.firstFind[negative], 'clears')).toBe(false);
    expect(restored.counts[negative]).toBe(4);
    // Non-finite clears (Infinity, NaN) are dropped the same way.
    expect(Object.hasOwn(restored.firstFind[infinite], 'clears')).toBe(false);
    expect(Object.hasOwn(restored.firstFind[notANumber], 'clears')).toBe(false);
    // Both numbers floor (2.7 -> 2, 3.9 -> 3), matching the live write paths.
    expect(restored.firstFind[fractional]).toEqual({ clears: 2 });
    expect(restored.counts[fractional]).toBe(3);
    // clears 0 (and 0.x) drop the FIELD; the entry itself still lands.
    expect(restored.firstFind[zeroClears]).toEqual({});
    expect(Object.hasOwn(restored.firstFind, zeroClears)).toBe(true);
    // The stale pageId is neither read nor kept, and its entry is otherwise
    // untouched: a veteran's save loads with its provenance intact.
    expect(restored.firstFind[staleShape]).toEqual({ clears: 3 });
    // The string clears ('5') failed the typeof gate; the field is dropped.
    expect(Object.hasOwn(restored.firstFind[stringClears], 'clears')).toBe(false);
    // count 0 is the absent key, not a stored zero.
    expect(Object.hasOwn(restored.counts, zeroCount)).toBe(false);
    expect(restored.firstFind[zeroCount]).toEqual({});
    // An over-cap tally clamps to the cap.
    expect(restored.counts[hugeCount]).toBe(RELIQUARY_OBTAIN_COUNT_CAP);
    // String and NaN counts drop the FIELD (typeof and finite gates); the
    // entries themselves still land.
    expect(Object.hasOwn(restored.counts, stringCount)).toBe(false);
    expect(restored.firstFind[stringCount]).toEqual({});
    expect(Object.hasOwn(restored.counts, nanCount)).toBe(false);
    expect(restored.firstFind[nanCount]).toEqual({});
    // ...and the null spelling those corruptions take ON DISK drops the same way.
    expect(Object.hasOwn(restored.counts, nullCount)).toBe(false);
    expect(restored.firstFind[nullCount]).toEqual({});
    // counts never outlives firstFind: every key names a surviving entry.
    expect(Object.keys(restored.counts).every((id) => id in restored.firstFind)).toBe(true);
  });
});

describe('Reliquary profession marks (Phase 7)', () => {
  const FIELD_NOTE = 'gather_event:pristine_vein';
  const MASTERWORK_FIRST = 'masterwork:first';

  it('noteReliquaryMark grants catalog marks sparsely and ignores unknown ids', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(noteReliquaryMark(sim.ctx, meta, 'not_an_authored_mark')).toBe(false);
    expect(meta.reliquary.marks.size).toBe(0);

    expect(noteReliquaryMark(sim.ctx, meta, FIELD_NOTE)).toBe(true);
    expect(meta.reliquary.marks.has(FIELD_NOTE)).toBe(true);
    expect(meta.reliquary.recent.at(-1)).toBe(FIELD_NOTE);
    // Second grant is a no-op (idempotent).
    expect(noteReliquaryMark(sim.ctx, meta, FIELD_NOTE)).toBe(false);
    expect(meta.reliquary.marks.size).toBe(1);

    const events = sim.drainEvents().filter((e) => e.type === 'reliquaryUnlock');
    expect(events.some((e) => e.type === 'reliquaryUnlock' && e.markId === FIELD_NOTE)).toBe(true);
    const unlock = events.find((e) => e.type === 'reliquaryUnlock' && e.markId === FIELD_NOTE);
    expect(unlock && 'pageIds' in unlock && unlock.pageIds).toContain('professions_field_notes');
  });

  it('serialize marks sparse + omit-empty; restore drops unknown mark ids', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    noteReliquaryMark(sim.ctx, meta, FIELD_NOTE);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.reliquary?.marks).toEqual([FIELD_NOTE]);
    // Pure mark fill must not invent firstFind noise.
    expect(state.reliquary?.firstFind).toBeUndefined();

    const dirty: CharacterState = {
      ...state,
      reliquary: {
        marks: [FIELD_NOTE, 'not_an_authored_mark', 'masterwork:cooking'],
        recent: [FIELD_NOTE, 'not_an_authored_mark'],
      },
    };
    const sim2 = makeSim();
    const pid = sim2.addPlayer('warrior', 'Reload', { state: dirty });
    const m2 = sim2.players.get(pid)!;
    expect([...m2.reliquary.marks]).toEqual([FIELD_NOTE]);
    expect(m2.reliquary.recent).toEqual([FIELD_NOTE]);
  });

  it('syncReliquaryMarksFromVisited retro-fills every catalog mark on the visit ledger', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.visited.add(FIELD_NOTE);
    meta.deedStats.visited.add('gather_event:moonlit_bloom');
    // Masterwork marks now retro-fill too: the live proc arm in crafting.ts
    // stamps the visit ledger beside the mark, so the visit is PROOF the proc
    // happened. A sparse blob that lost the mark heals from that history
    // instead of stranding a lifetime trophy; nothing is invented, because
    // only a real proc ever writes the visit.
    meta.deedStats.visited.add(MASTERWORK_FIRST);
    meta.deedStats.visited.add('masterwork:weaponcrafting');
    meta.deedStats.visited.add('gather:eastbrook:ore'); // not a Reliquary mark
    const added = syncReliquaryMarksFromVisited(meta);
    expect(added).toBe(4);
    expect(meta.reliquary.marks.has(FIELD_NOTE)).toBe(true);
    expect(meta.reliquary.marks.has('gather_event:moonlit_bloom')).toBe(true);
    expect(meta.reliquary.marks.has(MASTERWORK_FIRST)).toBe(true);
    expect(meta.reliquary.marks.has('masterwork:weaponcrafting')).toBe(true);
    // A visited id outside the catalog is still refused.
    expect(meta.reliquary.marks.has('gather:eastbrook:ore')).toBe(false);
    expect(meta.reliquary.recent).toEqual([]); // silent retro, no recent push
    // Idempotent.
    expect(syncReliquaryMarksFromVisited(meta)).toBe(0);
  });

  it('pageCompletion counts mark ownership for profession pages', () => {
    const page = RELIQUARY_PAGES.find((p) => p.id === 'professions_field_notes')!;
    expect(page).toBeDefined();
    const empty = pageCompletion(page, {
      itemsDiscovered: new Set(),
      marks: new Set(),
    });
    expect(empty.owned).toBe(0);
    expect(empty.complete).toBe(false);
    const marks = new Set(page.relics.filter((r) => r.kind === 'mark').map((r) => r.markId));
    const full = pageCompletion(page, { itemsDiscovered: new Set(), marks });
    expect(full.owned).toBe(full.total);
    expect(full.complete).toBe(true);
  });

  it('catalogRelicCompletion includes marks in overview totals', () => {
    // The item-side oracle walks the SCORING pages only: completion pairs
    // exclude every excludeFromCompletion page on both sides, while the raw
    // catalogItemCompletion helper deliberately counts whatever table it is
    // handed (the catalog-index memo pins depend on that), so the filter lives
    // here in the oracle, mirroring the production scoring rule.
    const scoringPages = RELIQUARY_PAGES.filter((p) => p.excludeFromCompletion === undefined);
    const itemsOnly = catalogItemCompletion(new Set(), scoringPages);
    const withMarks = catalogRelicCompletion({
      itemsDiscovered: new Set(),
      marks: new Set([FIELD_NOTE]),
    });
    // Load-bearing: every authored mark, mount, skin, and title slot is a unique
    // catalogued relic. total must include all kinds (Horizons Phase 8).
    const horizonExtra = scoringPages.reduce((n, p) => {
      for (const r of p.relics) {
        if (r.kind === 'mount' || r.kind === 'weapon_skin' || r.kind === 'title') n++;
      }
      return n;
    }, 0);
    expect(withMarks.total).toBe(itemsOnly.total + RELIQUARY_MARK_IDS.size + horizonExtra);
    expect(withMarks.owned).toBe(1);
    expect(withMarks.owned).toBeLessThan(withMarks.total);
  });

  it('pageCompletion owns mounts / skins / titles from live seams only', () => {
    const mountsPage = RELIQUARY_PAGES.find((p) => p.id === 'horizons_mounts')!;
    const skinsPage = RELIQUARY_PAGES.find((p) => p.id === 'horizons_weapon_skins')!;
    const titlesPage = RELIQUARY_PAGES.find((p) => p.id === 'horizons_titles')!;
    expect(mountsPage.relics.length).toBeGreaterThan(0);
    expect(skinsPage.relics.length).toBeGreaterThan(0);
    expect(titlesPage.relics.length).toBeGreaterThan(0);

    const empty = {
      itemsDiscovered: new Set<string>(),
      marks: new Set<string>(),
    };
    expect(pageCompletion(mountsPage, empty).owned).toBe(0);
    expect(pageCompletion(skinsPage, empty).owned).toBe(0);
    expect(pageCompletion(titlesPage, empty).owned).toBe(0);

    const firstMount = mountsPage.relics.find((r) => r.kind === 'mount')!.mountId;
    const firstSkin = skinsPage.relics.find((r) => r.kind === 'weapon_skin')!.skinId;
    const firstTitle = titlesPage.relics.find((r) => r.kind === 'title')!.deedId;

    expect(pageCompletion(mountsPage, { ...empty, ownedMounts: new Set([firstMount]) }).owned).toBe(
      1,
    );
    // Skins empty when account cosmetics absent (no weaponSkins lookup).
    expect(pageCompletion(skinsPage, empty).owned).toBe(0);
    expect(pageCompletion(skinsPage, { ...empty, weaponSkins: new Set([firstSkin]) }).owned).toBe(
      1,
    );
    expect(pageCompletion(titlesPage, { ...empty, deedsEarned: new Set([firstTitle]) }).owned).toBe(
      1,
    );

    // Full fill via live ownership seams only (no invented second discovery set).
    const allMounts = new Set(
      mountsPage.relics.filter((r) => r.kind === 'mount').map((r) => r.mountId),
    );
    const allSkins = new Set(
      skinsPage.relics.filter((r) => r.kind === 'weapon_skin').map((r) => r.skinId),
    );
    const allTitles = new Set(
      titlesPage.relics.filter((r) => r.kind === 'title').map((r) => r.deedId),
    );
    expect(pageCompletion(mountsPage, { ...empty, ownedMounts: allMounts }).complete).toBe(true);
    expect(pageCompletion(skinsPage, { ...empty, weaponSkins: allSkins }).complete).toBe(true);
    expect(pageCompletion(titlesPage, { ...empty, deedsEarned: allTitles }).complete).toBe(true);
  });

  it('catalogRelicCompletion counts Horizons fills for Overview totals', () => {
    const base = catalogRelicCompletion({
      itemsDiscovered: new Set(),
      marks: new Set(),
    });
    const withHorizons = catalogRelicCompletion({
      itemsDiscovered: new Set(),
      marks: new Set(),
      ownedMounts: new Set(['valorsteed']),
      weaponSkins: new Set(['guildmark_arming_sword']),
      deedsEarned: new Set(['prog_veteran']),
    });
    expect(withHorizons.total).toBe(base.total);
    expect(withHorizons.owned).toBe(3);
    expect(base.owned).toBe(0);
  });

  it('catalogCharacterCompletion excludes skin slots from both sides of the pair', () => {
    const items = new Set<string>(['cryptbone_helm']);
    const char = catalogCharacterCompletion({ itemsDiscovered: items });
    const full = catalogRelicCompletion({ itemsDiscovered: items });
    // Exact skin-slot delta: every unique weapon_skin relic is out of total.
    const skinSlots = new Set<string>();
    for (const page of RELIQUARY_PAGES) {
      for (const relic of page.relics) {
        if (relic.kind === 'weapon_skin') skinSlots.add(relic.skinId);
      }
    }
    expect(skinSlots.size).toBeGreaterThan(0);
    expect(char.total).toBe(full.total - skinSlots.size);
    expect(char.owned).toBe(1);
    // Host-shaped skins present must not raise owned or total.
    const withSkins = catalogCharacterCompletion(
      reliquaryOwnershipOpts({
        itemsDiscovered: items,
        weaponSkinIds: [...skinSlots],
      }),
    );
    // catalogCharacterCompletion ignores weaponSkins even if smuggled via opts shape:
    // it only accepts character-durable fields; re-call with skins only via full.
    expect(withSkins.owned).toBe(1);
    expect(withSkins.total).toBe(char.total);
  });

  it('the retired vault sits outside BOTH completion pairs (the skins-pin sibling)', () => {
    // The Vault of Ages (excludeFromCompletion) is the retired-page arm of
    // the same both-sides discipline the skin subtraction pins above: its
    // slots count in NEITHER owned nor total of either pair. The smuggled-key
    // shape mirrors the withSkins arm: vault ids arriving on itemsDiscovered
    // (exactly where a veteran's real discovery ledger carries them) must not
    // raise owned in either pair, and the totals must read as if the page did
    // not exist. The measured-totals and all-owned arms live in
    // tests/reliquary_content.test.ts beside the catalog totals pin.
    const vault = RELIQUARY_PAGES_BY_ID.horizons_vault_of_ages;
    expect(vault).toBeDefined();
    expect(vault.excludeFromCompletion).toBe('retired');
    const vaultIds = vault.relics.flatMap((r) => (r.kind === 'item' ? [r.itemId] : []));
    expect(vaultIds.length).toBe(4);

    const base = catalogRelicCompletion({ itemsDiscovered: new Set([CATALOGUE_RELIC]) });
    const smuggled = catalogRelicCompletion({
      itemsDiscovered: new Set([CATALOGUE_RELIC, ...vaultIds]),
    });
    expect(smuggled).toEqual(base);
    expect(smuggled.owned).toBe(1);
    const charBase = catalogCharacterCompletion({
      itemsDiscovered: new Set([CATALOGUE_RELIC]),
    });
    const charSmuggled = catalogCharacterCompletion({
      itemsDiscovered: new Set([CATALOGUE_RELIC, ...vaultIds]),
    });
    expect(charSmuggled).toEqual(charBase);
    expect(charSmuggled.owned).toBe(1);
    // Vault ownership alone never moves the curator-rank input either.
    expect(catalogRankOwned({ itemsDiscovered: new Set(vaultIds) })).toBe(0);
    // The PAGE-LOCAL pair deliberately still counts: the vault row shows its
    // own owned/total to the veterans who hold the pieces.
    const local = pageCompletion(vault, {
      itemsDiscovered: new Set(vaultIds),
      marks: new Set(),
    });
    expect(local).toEqual({ owned: 4, total: 4, complete: true });
  });

  it('catalogRankOwned excludes account weapon skins (grant/display rank align)', () => {
    // Host-shaped opts (Sim + ClientWorld pass full surfaces including skins).
    // The strip in catalogRankOwned must ignore weaponSkins even when present.
    const hostOpts = reliquaryOwnershipOpts({
      itemsDiscovered: new Set(),
      ownedMounts: ['valorsteed'],
      weaponSkinIds: ['guildmark_arming_sword'],
      deedsEarned: new Set(['prog_veteran']),
    });
    expect(hostOpts.weaponSkins?.has('guildmark_arming_sword')).toBe(true);
    expect(catalogRelicCompletion(hostOpts).owned).toBe(3);
    expect(catalogRankOwned(hostOpts)).toBe(2);

    // Empty ownership stays 0 (skins alone cannot invent rank without strip).
    expect(
      catalogRankOwned(
        reliquaryOwnershipOpts({
          itemsDiscovered: new Set(),
          weaponSkinIds: ['guildmark_arming_sword'],
        }),
      ),
    ).toBe(0);
    expect(
      catalogRelicCompletion(
        reliquaryOwnershipOpts({
          itemsDiscovered: new Set(),
          weaponSkinIds: ['guildmark_arming_sword'],
        }),
      ).owned,
    ).toBe(1);
  });

  it('characterReliquaryOwnership uses live ownedMounts (bags + bank reins)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // No skins field: character path never carries account cosmetics.
    const empty = characterReliquaryOwnership(meta);
    expect(empty.ownedMounts.has('valorsteed')).toBe(false);
    expect(empty).not.toHaveProperty('weaponSkins');

    sim.addItem('reins_valorsteed', 1);
    expect(characterReliquaryOwnership(meta).ownedMounts.has('valorsteed')).toBe(true);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(1);

    // Bank-only reins still count (ownedMounts = bags + bank).
    const sim2 = makeSim();
    const m2 = primary(sim2).meta;
    sim2.addItem('reins_grag_bear', 1);
    const slot = m2.inventory.find((s) => s.itemId === 'reins_grag_bear');
    expect(slot).toBeTruthy();
    if (!slot) throw new Error('expected grag reins in bags');
    m2.inventory.splice(m2.inventory.indexOf(slot), 1);
    m2.bank.inventory.push(slot);
    expect(characterReliquaryOwnership(m2).ownedMounts.has('grag_bear')).toBe(true);
  });

  it('live mount first-discover and title grant sync Curator rank deeds', () => {
    const catalogIds = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ];
    expect(catalogIds.length).toBeGreaterThanOrEqual(9);

    // Mount path: 9 catalogued items + first reins grant crosses rank 2.
    const simMount = makeSim();
    const mMount = primary(simMount).meta;
    for (const id of catalogIds.slice(0, 9)) {
      markItemDiscovered(simMount.ctx, mMount, id);
    }
    expect(mMount.deedsEarned.has('col_reliquary_rank_2')).toBe(false);
    const renownBeforeMount = mMount.renown;
    simMount.addItem('reins_valorsteed', 1);
    // 9 items + mount (+ rank-2 title bridge, itself a Horizons title relic).
    expect(catalogRankOwned(characterReliquaryOwnership(mMount))).toBeGreaterThanOrEqual(10);
    expect(mMount.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(mMount.renown).toBe(renownBeforeMount);
    // No invent of firstFind / unlock toast for mount membership.
    expect(mMount.reliquary.firstFind.reins_valorsteed).toBeUndefined();
    const mountUnlocks = simMount
      .drainEvents()
      .filter(
        (e) => e.type === 'reliquaryUnlock' && 'itemId' in e && e.itemId === 'reins_valorsteed',
      );
    expect(mountUnlocks).toEqual([]);

    // Title path: 9 catalogued items + Horizons title deed crosses rank 2.
    const simTitle = makeSim();
    const mTitle = primary(simTitle).meta;
    for (const id of catalogIds.slice(0, 9)) {
      markItemDiscovered(simTitle.ctx, mTitle, id);
    }
    expect(mTitle.deedsEarned.has('col_reliquary_rank_2')).toBe(false);
    const renownBeforeTitle = mTitle.renown;
    expect(grantDeed(simTitle.ctx, mTitle, 'prog_veteran')).toBe(true);
    // Title fill + rank-2 title bridge both score; rank is at least 2.
    expect(catalogRankOwned(characterReliquaryOwnership(mTitle))).toBeGreaterThanOrEqual(10);
    expect(mTitle.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(mTitle.renown).toBe(renownBeforeTitle + (DEEDS.prog_veteran.renown ?? 0));
  });

  it('a live masterwork proc writes masterwork:first and the per-craft mark (real craft path)', () => {
    // Seed 21: the recorded signed-reagent hunt window shared with
    // tests/professions_masterwork.test.ts (bounded scan from seed 1; the
    // single output-side proc draw lands in [0.03, 0.05), so one self-signed
    // reagent's 2 percent term lifts the vestments roll to 0.05 and the
    // craft procs deterministically). Re-hunt there and re-record here
    // together whenever a content commit shifts the construction-time draw
    // sequence; the release/v0.35.0 private-scatter sync moved the window
    // from the old seed 151 (whose spares went stale with it).
    const SEED = 21;
    // Premise anchors from live content: the derived per-craft id this
    // recipe produces, and its catalog membership (an uncatalogued id can
    // never land in marks, so the derived-arm assertions below would be
    // vacuous without it).
    expect(recipeById('recipe_eastbrook_ritual_vestments')!.professionId).toBe('tailoring');
    expect(RELIQUARY_MARK_IDS.has('masterwork:tailoring')).toBe(true);

    const sim = makeSim(SEED);
    const { meta } = primary(sim);
    const pid = sim.playerId;
    sim.addItemInstance('linen_scrap', { signer: meta.name }, pid);
    sim.addItem('linen_scrap', 1, pid);
    sim.addItem('spider_leg', 1, pid);
    sim.addItem('homespun_cloth', 3, pid);
    sim.addItem('spool_of_thread', 5, pid);
    expect(meta.reliquary.marks.size).toBe(0);
    runCraft(sim, 'recipe_eastbrook_ritual_vestments', false, pid);
    expect(sim.lastCraftResult?.ok).toBe(true);
    // The hunted window held: the proc fired (a draw-order shift that
    // collapses the window fails HERE, not in the mark assertions below).
    expect(sim.lastCraftResult?.masterwork).toBe(true);
    // Both marks land through the live write path (nothing here hand-sets
    // reliquary state): the ungated first-proc trophy and the catalog-gated
    // per-craft one, in production write order on the recent ring.
    expect([...meta.reliquary.marks].sort()).toEqual([MASTERWORK_FIRST, 'masterwork:tailoring']);
    expect(meta.reliquary.recent).toEqual([MASTERWORK_FIRST, 'masterwork:tailoring']);
    // The visit ledger rides beside each mark on the same proc arm (the
    // durable proof the proc happened; join-time retro-fill reads it).
    expect(meta.deedStats.visited.has(MASTERWORK_FIRST)).toBe(true);
    expect(meta.deedStats.visited.has('masterwork:tailoring')).toBe(true);

    // Control at the SAME seed, no signed copy held: the roll sits above the
    // 3 percent base and misses, and a miss writes NO mark or visit, so the
    // writes provably sit on the proc arm, not on every successful craft.
    // The control holds THREE plain scraps where the primary held two: the
    // #1145 self-signed reduction discounts the signed arm's required count,
    // so an unsigned control holding the primary's count is refused outright
    // (insufficient_materials). Reagent parity between the arms is impossible
    // by design; the load-bearing difference is the signature.
    const control = makeSim(SEED);
    const mControl = primary(control).meta;
    const cid = control.playerId;
    for (let i = 0; i < 3; i++) control.addItem('linen_scrap', 1, cid);
    control.addItem('spider_leg', 1, cid);
    control.addItem('homespun_cloth', 3, cid);
    control.addItem('spool_of_thread', 5, cid);
    runCraft(control, 'recipe_eastbrook_ritual_vestments', false, cid);
    expect(control.lastCraftResult?.ok).toBe(true);
    expect(control.lastCraftResult?.masterwork).toBeUndefined();
    expect(mControl.reliquary.marks.size).toBe(0);
    expect(mControl.deedStats.visited.has(MASTERWORK_FIRST)).toBe(false);
    expect(mControl.deedStats.visited.has('masterwork:tailoring')).toBe(false);
  });

  it('craft and gather call sites note catalog marks only (source pins)', () => {
    // Full-line // comments are stripped so a line-commented arm cannot
    // satisfy the literal-order pin (a /* */ block or a trailing comment
    // still could). The behavioral proc test above drives the REAL craft
    // path, so the writes and their proc-arm placement are pinned by
    // behavior (the parity golden professions_craft.json backstops them
    // too, embedding the masterwork visited ids in pinned state hashes).
    // The load this regex still carries is the isCataloguedRelicMark gate
    // on the derived visit write, which no behavioral case can reach while
    // every masterwork-capable craft has an authored mark (only equippable
    // outputs can proc, and all four gear-capable professions sit in
    // RELIQUARY_PROFESSION_MARKS.masterworkByCraft; its fifth entry,
    // engineering, is the pended tool-only craft that can never proc, see
    // the gear-capability pin in tests/reliquary_content.test.ts).
    const craftSrc = fs
      .readFileSync(path.join(__dirname, '../src/sim/professions/crafting.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    // Marks must sit on the live masterwork success arm (applyCraftSuccessHooks
    // after craft-cast), not a cold path. meta is the cast-complete hook param
    // (was r.meta when craftItem still resolved instantly). The visit write
    // rides beside each mark (the gather_events and interaction arms below use
    // the same idiom): the per-craft one is CATALOG-GATED, since a craft with
    // no authored mark must not write ledger noise nothing can read back.
    const masterworkArm = craftSrc.match(
      /if \(result\.masterwork\) \{[\s\S]*?ctx\.markVisited\(meta, 'masterwork:first'\);[\s\S]*?noteReliquaryMark\(ctx, meta, 'masterwork:first'\);[\s\S]*?const markId = `masterwork:\$\{craftId\}`;[\s\S]*?if \(isCataloguedRelicMark\(markId\)\) ctx\.markVisited\(meta, markId\);[\s\S]*?noteReliquaryMark\(ctx, meta, markId\);[\s\S]*?\}/,
    );
    expect(masterworkArm, 'masterwork arm visits + notes first and per-craft marks').toBeTruthy();
    expect(craftSrc).toContain('noteReliquaryMark');
    expect(craftSrc).toContain('masterwork:first');
    expect(craftSrc).toContain('masterwork:${craftId}');

    const gatherSrc = fs
      .readFileSync(path.join(__dirname, '../src/sim/professions/gather_events.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    // announceGatherEvent writes visit then the Reliquary mark together.
    expect(gatherSrc).toMatch(
      /const visitMark = `gather_event:\$\{flavor\}`;[\s\S]*?ctx\.markVisited\(finder, visitMark\);[\s\S]*?noteReliquaryMark\(ctx, finder, visitMark\);/,
    );

    const interactionSrc = fs
      .readFileSync(path.join(__dirname, '../src/sim/interaction.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    // Perfect specimen land: deed visit + Reliquary mark on the same arm.
    expect(interactionSrc).toMatch(
      /ctx\.markVisited\(meta, 'gather_event:perfect_specimen'\);[\s\S]*?noteReliquaryMark\(ctx, meta, 'gather_event:perfect_specimen'\);/,
    );

    // The Phase 21 fourth dual-write site: the rare kill-credit arm in
    // deeds.ts writes the visited mark and the Reliquary mark together for
    // EVERY eligible member (the per-member loop is inside the match, so a
    // refactor that moved the note outside the loop, crediting only one
    // member, reds here). The behavioral kill tests below drive the real
    // path; this pin holds the visit beside the note on the same arm.
    const deedsSrc = fs
      .readFileSync(path.join(__dirname, '../src/sim/deeds.ts'), 'utf8')
      // Strip BOTH comment forms before matching, so neither a line comment
      // (whole-line OR trailing) nor a /* */ block holding the old code can
      // satisfy the pin (the source-text-pin-comment-gameable trap). Line
      // comments FIRST: a /* inside a // comment must not open a block match
      // that swallows code.
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(deedsSrc).toMatch(
      /if \(RARE_SLAIN_TEMPLATES\.has\(mob\.templateId\)\) \{\s*for \(const meta of eligible\) \{\s*markVisited\(ctx, meta, `slain:\$\{mob\.templateId\}`\);\s*noteReliquaryMark\(ctx, meta, `slain:\$\{mob\.templateId\}`\);\s*\}\s*\}/,
    );
  });
});

describe('rare kill credit fills the Reliquary (the Phase 21 dual write)', () => {
  function spawnRare(sim: Sim, templateId: string) {
    const mob = createMob(sim.ctx.nextId++, MOBS[templateId], 5, { x: 0, y: 0, z: 0 });
    sim.addEntity(mob);
    return mob;
  }

  it('one real kill credit lands the mark, the visit, and the recent push', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Premise: the mark is catalogued (an uncatalogued id would no-op in
    // noteReliquaryMark and this test would be checking the visit alone).
    expect(RELIQUARY_MARK_IDS.has('slain:old_greyjaw')).toBe(true);
    expect(meta.reliquary.marks.size).toBe(0);
    const mob = spawnRare(sim, 'old_greyjaw');
    onMobKillCreditForDeeds(sim.ctx, mob, null, meta, [meta]);
    expect(meta.reliquary.marks.has('slain:old_greyjaw')).toBe(true);
    expect(meta.deedStats.visited.has('slain:old_greyjaw')).toBe(true);
    // The live fill pushes the recent ring (unlike the silent join retro).
    expect(meta.reliquary.recent).toEqual(['slain:old_greyjaw']);
  });

  it('a party kill credits EVERY eligible member (the two-member arm)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const pid2 = sim.addPlayer('warrior', 'Secondwright');
    const meta2 = sim.players.get(pid2)!;
    const mob = spawnRare(sim, 'mogger');
    onMobKillCreditForDeeds(sim.ctx, mob, null, meta, [meta, meta2]);
    expect(meta.reliquary.marks.has('slain:mogger')).toBe(true);
    expect(meta2.reliquary.marks.has('slain:mogger')).toBe(true);
    expect(meta2.deedStats.visited.has('slain:mogger')).toBe(true);
  });

  it('a non-rare kill writes neither ledger (the RARE_SLAIN_TEMPLATES gate)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const wolf = spawnRare(sim, 'forest_wolf');
    onMobKillCreditForDeeds(sim.ctx, wolf, null, meta, [meta]);
    expect(meta.reliquary.marks.size).toBe(0);
    expect(meta.deedStats.visited.has('slain:forest_wolf')).toBe(false);
  });

  it('join retro fills a slain mark from the visited ledger, silently', () => {
    // A veteran who slew the rare before Phase 21 shipped: the visit exists
    // (the chr_*_rares deeds wrote it), the Reliquary mark does not. The join
    // sweep copies it in with no recent push and no toast (nothing is
    // invented: the visit is proof the kill really happened).
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.visited.add('slain:brutok_skullsmasher');
    expect(meta.reliquary.marks.size).toBe(0);
    expect(syncReliquaryMarksFromVisited(meta)).toBe(1);
    expect(meta.reliquary.marks.has('slain:brutok_skullsmasher')).toBe(true);
    expect(meta.reliquary.recent).toEqual([]);
  });
});

describe('Reliquary recent ring cap', () => {
  it('drops the oldest finds once distinct catalogued finds exceed the cap', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Literal: the shipped ring cap is 12; a drifted constant must fail here
    // instead of silently re-deriving every expectation below.
    expect(RELIQUARY_RECENT_CAP).toBe(12);

    // Distinct catalogued item ids straight from the live catalog, so content
    // churn cannot rot the fixture. Snug floor: the slice must actually fill.
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, RELIQUARY_RECENT_CAP + 3);
    expect(ids.length).toBe(RELIQUARY_RECENT_CAP + 3);

    // One find per id through noteRelicItemFind, the write seam the
    // markItemDiscovered hook calls (the interleave test below drives the
    // full hook path for real).
    for (const id of ids) {
      expect(noteRelicItemFind(meta, id)).toBe(true);
    }

    // Exactly the cap survives: the oldest three finds are evicted, relative
    // order is preserved, and the newest find sits at the tail.
    expect(meta.reliquary.recent.length).toBe(RELIQUARY_RECENT_CAP);
    expect(meta.reliquary.recent).toEqual(ids.slice(3));
    for (const evicted of ids.slice(0, 3)) {
      expect(meta.reliquary.recent).not.toContain(evicted);
    }
    expect(meta.reliquary.recent.at(-1)).toBe(ids.at(-1));
  });

  // The ring pushes at the tail and drops the head, so index 0 is the OLDEST
  // entry. A refresh guard written against index 0 refuses to move the oldest
  // id and instead leaves the ring in an order the window then paints wrong.
  // Reaching the refresh from a LIVE caller takes a desynced blob (both call
  // sites early-return when the find or mark is already held, so a re-push
  // needs recent to hold an id whose firstFind entry is absent: a hand-edited
  // or legacy save); the guard exists so pushRecent and restore agree on one
  // semantic regardless of how the ring got its contents.
  it('re-noting refreshes mid-ring AND oldest entries, and leaves the newest alone', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, 3);
    const [a, b, c] = ids;
    // noteRelicItemFind is the public write seam; it short-circuits on an
    // existing firstFind entry, so a re-find clears that entry first (the
    // sibling cap test above drives the ring the same way).
    const reNote = (id: string) => {
      delete meta.reliquary.firstFind[id];
      noteRelicItemFind(meta, id);
    };
    for (const id of ids) noteRelicItemFind(meta, id);
    expect(meta.reliquary.recent).toEqual([a, b, c]);

    reNote(b); // mid-ring
    expect(meta.reliquary.recent).toEqual([a, c, b]);

    reNote(a); // the OLDEST entry: the index-0 guard used to drop this move
    expect(meta.reliquary.recent).toEqual([c, b, a]);

    reNote(a); // already newest: nothing moves
    expect(meta.reliquary.recent).toEqual([c, b, a]);
  });

  it('restore de-dupes the recent ring on pushRecent semantics (last wins, newest survive)', () => {
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ];
    const [a, b, c] = ids;
    // A blob that repeats an id must not burn two of the twelve slots: the
    // live ring holds each id exactly once. Which occurrence survives is not
    // a free choice: pushRecent moves a repeat to the TAIL, so the LAST
    // occurrence is the one that carries the id's real recency.
    expect(restoreReliquaryState({ recent: [a, b, a, c, b] }).recent).toEqual([a, c, b]);

    // Over the cap, the NEWEST survivors are kept (the head is the oldest end,
    // exactly what pushRecent's shift drops). Interleaved duplicates so the
    // de-dupe and the truncation are both load-bearing: a first-occurrence
    // de-dupe would keep the same set but a head-side cut would return
    // many.slice(0, CAP) instead.
    const many = ids.slice(0, RELIQUARY_RECENT_CAP + 4);
    expect(many.length, 'the catalog must supply more item ids than the cap').toBe(
      RELIQUARY_RECENT_CAP + 4,
    );
    expect(restoreReliquaryState({ recent: many.flatMap((id) => [id, id]) }).recent).toEqual(
      many.slice(-RELIQUARY_RECENT_CAP),
    );
  });

  it('restore truncates an over-cap all-distinct recent blob to the newest cap entries', () => {
    // Literal: the shipped cap (12) re-pinned line-adjacent, so this test's
    // slice arithmetic cannot self-agree with a drifted constant.
    expect(RELIQUARY_RECENT_CAP).toBe(12);
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ];
    const many = ids.slice(0, RELIQUARY_RECENT_CAP + 3);
    expect(many.length, 'the catalog must supply more item ids than the cap').toBe(
      RELIQUARY_RECENT_CAP + 3,
    );
    // No duplicates in the blob, so this pins the truncation arm alone: the
    // restore walk is newest-first and stops at the cap, which keeps the
    // NEWEST twelve (the head, the oldest side, is what gets cut) in their
    // original relative order.
    expect(restoreReliquaryState({ recent: many }).recent).toEqual(
      many.slice(-RELIQUARY_RECENT_CAP),
    );
  });

  it('interleaved item and mark writes share one capped ring in production order', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Both live write paths push the SAME ring: markItemDiscovered's hook for
    // item finds and noteReliquaryMark for authored marks. Interleave them
    // across the cap boundary so the cap provably applies to the union (never
    // per kind) and the surviving order is the exact production write order.
    const itemIds = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, 8);
    const markIds = [...RELIQUARY_MARK_IDS].slice(0, 7);
    // Snug floors: 8 + 7 = cap + 3 writes, so three entries must evict.
    expect(itemIds.length).toBe(8);
    expect(markIds.length).toBe(7);
    const writes: string[] = [];
    for (let i = 0; i < itemIds.length; i++) {
      markItemDiscovered(sim.ctx, meta, itemIds[i]);
      writes.push(itemIds[i]);
      if (i < markIds.length) {
        expect(noteReliquaryMark(sim.ctx, meta, markIds[i])).toBe(true);
        writes.push(markIds[i]);
      }
    }
    expect(writes.length).toBe(RELIQUARY_RECENT_CAP + 3);
    // Exactly the cap survives; the evicted head (item, mark, item) crosses
    // both kinds, and the survivors keep the interleaved write order intact.
    expect(meta.reliquary.recent.length).toBe(RELIQUARY_RECENT_CAP);
    expect(meta.reliquary.recent).toEqual(writes.slice(3));
    expect(meta.reliquary.recent.at(-1)).toBe(writes.at(-1));
    for (const evicted of writes.slice(0, 3)) {
      expect(meta.reliquary.recent).not.toContain(evicted);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 20: the narrow restore helpers the public character sheet reads
// ---------------------------------------------------------------------------

describe('Reliquary narrow restore helpers (public character-sheet path)', () => {
  const itemIds = [
    ...new Set(
      RELIQUARY_PAGES.flatMap((p) =>
        p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
      ),
    ),
  ];
  const markIds = [...RELIQUARY_MARK_IDS];

  /** One blob that exercises every arm at once: junk entries, an uncatalogued
   *  id on each surface, a repeated recent id, and an over-cap ring. */
  function richBlob(): SavedReliquaryState {
    const many = itemIds.slice(0, RELIQUARY_RECENT_CAP + 3);
    expect(many.length, 'the catalog must supply more item ids than the cap').toBe(
      RELIQUARY_RECENT_CAP + 3,
    );
    return {
      firstFind: { [CATALOGUE_RELIC]: { clears: 3, count: 2 } },
      illuminatedPages: ['conquerors_hollow_crypt'],
      marks: [markIds[0], 'not_a_mark', 7 as unknown as string, markIds[1]],
      recent: [
        many[0],
        NON_RELIC,
        ...many,
        9 as unknown as string,
        many[1],
        markIds[0],
      ] as string[],
    };
  }

  it('the narrow helpers answer exactly what the full restore answers', () => {
    // The sheet path calls the narrow helpers instead of restoring the whole
    // state for two of its four surfaces; this is what keeps the extraction a
    // MOVE. Both arms carry survivors and dropped junk, so the equality is
    // never empty === empty.
    const blob = richBlob();
    const full = restoreReliquaryState(blob);
    expect(full.marks.size).toBeGreaterThan(0);
    expect(full.recent.length).toBe(RELIQUARY_RECENT_CAP);
    expect([...restoreReliquaryMarks(blob)]).toEqual([...full.marks]);
    expect(restoreReliquaryRecent(blob)).toEqual(full.recent);
    // The junk really was dropped on both sides (a helper that skipped the
    // catalog filter would still satisfy the equality above only if the full
    // restore skipped it too, which the next two lines refuse).
    expect([...full.marks]).not.toContain('not_a_mark');
    expect(full.recent).not.toContain(NON_RELIC);
  });

  it('each narrow helper reads only its own field', () => {
    // Decisive against a copy/paste swap in the extraction: marks must not
    // fill from the recent ring, and recent must not fill from marks.
    expect(restoreReliquaryMarks({ recent: [CATALOGUE_RELIC, markIds[0]] }).size).toBe(0);
    expect(restoreReliquaryRecent({ marks: [markIds[0]] })).toEqual([]);
  });

  it('a corrupt marks or recent value drops whole in the narrow helpers too', () => {
    // Same tolerance as the full restore (see the character-sheet reach note
    // on the corrupt-marks test below): a stored blob reached from the public
    // sheet must never throw.
    const corrupt = { marks: 5, recent: 5 } as unknown as SavedReliquaryState;
    expect(restoreReliquaryMarks(corrupt).size).toBe(0);
    expect(restoreReliquaryRecent(corrupt)).toEqual([]);
    expect(restoreReliquaryState(corrupt).marks.size).toBe(0);
    expect(restoreReliquaryState(corrupt).recent).toEqual([]);
    expect(restoreReliquaryMarks(undefined).size).toBe(0);
    expect(restoreReliquaryRecent(undefined)).toEqual([]);
  });
});

describe('Reliquary pure completion + curator rank', () => {
  it('pageCompletion tracks missing and complete pages', () => {
    const page: ReliquaryPageDef = {
      id: 'fixture',
      shelf: 'conquerors',
      name: 'Fixture',
      relics: [
        { kind: 'item', itemId: 'a' },
        { kind: 'item', itemId: 'b' },
      ],
    };
    expect(pageCompletion(page, { itemsDiscovered: new Set() })).toEqual({
      owned: 0,
      total: 2,
      complete: false,
    });
    expect(pageCompletion(page, { itemsDiscovered: new Set(['a']) })).toEqual({
      owned: 1,
      total: 2,
      complete: false,
    });
    expect(pageCompletion(page, { itemsDiscovered: new Set(['a', 'b']) })).toEqual({
      owned: 2,
      total: 2,
      complete: true,
    });
  });

  it('curatorRankFromOwned is pure and threshold-driven', () => {
    expect(CURATOR_RANK_THRESHOLDS).toEqual([1, 10, 25, 50, 100]);
    expect(CURATOR_RANK_DEFS.map((d) => d.threshold)).toEqual([...CURATOR_RANK_THRESHOLDS]);
    expect(curatorRankFromOwned(0)).toBe(0);
    expect(curatorRankFromOwned(1)).toBe(1);
    expect(curatorRankFromOwned(9)).toBe(1);
    expect(curatorRankFromOwned(10)).toBe(2);
    expect(curatorRankFromOwned(24)).toBe(2);
    expect(curatorRankFromOwned(25)).toBe(3);
    expect(curatorRankFromOwned(49)).toBe(3);
    expect(curatorRankFromOwned(50)).toBe(4);
    expect(curatorRankFromOwned(99)).toBe(4);
    expect(curatorRankFromOwned(100)).toBe(5);
    // Live catalog must make the highest threshold reachable (no dead Eternal rank).
    expect(catalogItemCompletion(new Set()).total).toBeGreaterThanOrEqual(100);
    // Seal chrome is pure and cosmetic-only (no power fields on defs).
    expect(curatorSealIdForRank(0)).toBeNull();
    expect(curatorSealIdForRank(1)).toBe('apprentice');
    expect(curatorSealIdForRank(2)).toBe('keeper');
    expect(curatorSealIdForRank(3)).toBe('master');
    expect(curatorSealIdForRank(4)).toBe('grand');
    expect(curatorSealIdForRank(5)).toBe('eternal');
    expect(CURATOR_RANK_DEFS.map((d) => d.deedId)).toEqual([
      undefined,
      'col_reliquary_rank_2',
      'col_reliquary_rank_3',
      'col_reliquary_rank_4',
      'col_reliquary_rank_5',
    ]);
    for (const def of CURATOR_RANK_DEFS) {
      expect(def).not.toHaveProperty('stats');
      expect(def).not.toHaveProperty('dropRate');
      expect(def).not.toHaveProperty('pity');
    }
  });

  it('rank-up emit includes curatorRank and grants zero-Renown deed bridges', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Seed 9 non-catalog discoveries do not affect rank; seed 9 catalogued
    // uniques so the next catalogued fill crosses rank 2 (threshold 10).
    const catalogIds = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ];
    expect(catalogIds.length).toBeGreaterThanOrEqual(10);
    for (const id of catalogIds.slice(0, 9)) {
      markItemDiscovered(sim.ctx, meta, id);
    }
    sim.drainEvents();
    expect(curatorRankFromOwned(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned)).toBe(
      1,
    );
    // Rank 1 has no deed bridge; rank 2 does.
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(false);

    const renownBeforeRank2 = meta.renown;
    markItemDiscovered(sim.ctx, meta, catalogIds[9]!);
    const events = sim.drainEvents();
    const unlocks = events.filter((e) => e.type === 'reliquaryUnlock');
    // Exactly one: emitReliquaryUnlock fires once per fill, and the rank-up
    // rides the same event via curatorRank rather than a second emit.
    expect(unlocks.length).toBe(1);
    const rankUp = unlocks.find((e) => e.type === 'reliquaryUnlock' && e.curatorRank === 2);
    expect(rankUp).toBeTruthy();
    expect(rankUp && 'curatorRank' in rankUp && rankUp.curatorRank).toBe(2);
    // Zero-Renown title bridge: renown must not move from the rank-2 grant.
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(meta.renown).toBe(renownBeforeRank2);
    expect(DEEDS.col_reliquary_rank_2.renown).toBe(0);
    expect(DEEDS.col_reliquary_rank_3.renown).toBe(0);
    expect(DEEDS.col_reliquary_rank_4.renown).toBe(0);
    expect(DEEDS.col_reliquary_rank_5.renown).toBe(0);
    expect(DEEDS.col_reliquary_rank_2.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS.col_reliquary_rank_3.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS.col_reliquary_rank_4.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS.col_reliquary_rank_5.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS.col_reliquary_rank_2.reward).toEqual({ kind: 'title', text: 'Spoilskeeper' });
    expect(DEEDS.col_reliquary_rank_3.reward).toEqual({
      kind: 'title',
      text: 'the Cataloguer',
    });
    expect(DEEDS.col_reliquary_rank_4.reward).toEqual({ kind: 'title', text: 'Arch-Curator' });
    expect(DEEDS.col_reliquary_rank_5.reward).toEqual({
      kind: 'border',
      slug: 'reliquary_gilt',
    });
    // Sticky grants live on deedsEarned only; no rankRewardsGranted blob.
    expect(meta.reliquary).not.toHaveProperty('rankRewardsGranted');
    const serialized = serializeReliquaryState(meta.reliquary);
    expect(serialized).toBeDefined();
    if (!serialized) throw new Error('expected sparse serialize after catalog fills');
    expect(serialized).not.toHaveProperty('rankRewardsGranted');
    // illuminatedPages joined the allowed key set in Phase 18 (the first five
    // fills above complete the Hollow Crypt page, so the sticky record is
    // non-empty here); rank rewards themselves still serialize NOTHING.
    const allowed = new Set(['firstFind', 'illuminatedPages', 'marks', 'recent']);
    for (const key of Object.keys(serialized)) {
      expect(allowed.has(key)).toBe(true);
    }
    // Idempotent: re-sync does not double-grant.
    const sizeBefore = meta.deedsEarned.size;
    syncCuratorRankDeeds(sim.ctx, meta);
    expect(meta.deedsEarned.size).toBe(sizeBefore);
  });

  it('a fill that scores nowhere never fires a rank-up, even at an exact threshold', () => {
    // The Phase 21 QA parity leg's catch: onItemDiscovered assumed every
    // catalogued fill moved the rank count by one, so a riftbound band
    // (catalogued, but on an excludeFromCompletion page) landing while the
    // scoring count sits EXACTLY on a Curator threshold derived a
    // previousRank one tier low and re-announced the rank the player already
    // held. The band is the live-mintable case (first-clear race loot).
    const band = RELIQUARY_PAGES_BY_ID.horizons_riftbound.relics.flatMap((r) =>
      r.kind === 'item' ? [r.itemId] : [],
    )[0]!;
    expect(relicFillScoresForRank('item', band)).toBe(false);
    // Premise pins: 25 is a threshold (rank 3 starts there, 24 is still 2).
    expect(curatorRankFromOwned(25)).toBe(3);
    expect(curatorRankFromOwned(24)).toBe(2);
    const scoringIds = [...RELIQUARY_ITEM_TO_PAGES.keys()]
      .filter((id) => relicFillScoresForRank('item', id))
      .slice(0, 25);
    expect(scoringIds.length).toBe(25);
    const sim = makeSim();
    const { meta } = primary(sim);
    // Seed the ledger DIRECTLY rather than through the fill chain: a chain
    // crossing rank 2 and 3 lands the bridge TITLES, which are catalogued
    // fills themselves and push owned past the threshold. The stable
    // at-threshold state is real regardless (rank 5's bridge is a border,
    // which never scores, so a veteran parks at exactly 100), and
    // onItemDiscovered reads the live ledger the same way however it got
    // there; 25 keeps the rig small.
    for (const id of scoringIds) meta.deedStats.itemsDiscovered.add(id);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(25);
    markItemDiscovered(sim.ctx, meta, band);
    const unlock = sim
      .drainEvents()
      .find((e) => e.type === 'reliquaryUnlock' && 'itemId' in e && e.itemId === band);
    // The fill itself still toasts (it is a real first find)...
    expect(unlock).toBeDefined();
    // ...but carries NO rank-up, and the true rank never moved.
    expect(unlock && 'curatorRank' in unlock ? unlock.curatorRank : undefined).toBeUndefined();
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(25);

    // Positive control on the same boundary: a character at 24 scoring fills
    // whose 25th fill SCORES still gets the rank-3 announcement (the fix must
    // not mute real crossings).
    const sim2 = makeSim();
    const { meta: meta2 } = primary(sim2);
    for (const id of scoringIds.slice(0, 24)) meta2.deedStats.itemsDiscovered.add(id);
    expect(catalogRankOwned(characterReliquaryOwnership(meta2))).toBe(24);
    markItemDiscovered(sim2.ctx, meta2, scoringIds[24]!);
    const crossing = sim2
      .drainEvents()
      .find((e) => e.type === 'reliquaryUnlock' && 'itemId' in e && e.itemId === scoringIds[24]);
    expect(crossing && 'curatorRank' in crossing ? crossing.curatorRank : undefined).toBe(3);
  });

  it('relicFillScoresForRank: flagged-page ids score nothing, every authored mark scores', () => {
    // Direct pins on the helper both fill paths consult. The mark loop is the
    // compensating guard for the dead arm in noteReliquaryMark (no authored
    // mark sits on a flagged page today, the M4 pattern): if a mark ever
    // lands on an excludeFromCompletion page, this loop reds and the arm
    // becomes live and testable.
    for (const page of ['horizons_riftbound', 'horizons_vault_of_ages'] as const) {
      for (const relic of RELIQUARY_PAGES_BY_ID[page].relics) {
        // Item-only asserted, not skipped: a mount/title/skin relic on a
        // flagged page would have NO helper arm at all, so the loop must red
        // on it rather than pass vacuously.
        expect(relic.kind, `${page} carries a non-item relic`).toBe('item');
        if (relic.kind !== 'item') continue;
        expect(relicFillScoresForRank('item', relic.itemId), relic.itemId).toBe(false);
      }
    }
    expect(relicFillScoresForRank('item', CATALOGUE_RELIC)).toBe(true);
    for (const markId of RELIQUARY_MARK_IDS) {
      expect(relicFillScoresForRank('mark', markId), markId).toBe(true);
    }
  });

  it('first catalogued fill ranks up to 1 without a deed bridge', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const renownBefore = meta.renown;
    expect(CURATOR_RANK_DEFS.find((d) => d.rank === 1)?.deedId).toBeUndefined();
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    const events = sim.drainEvents();
    const unlock = events.find((e) => e.type === 'reliquaryUnlock');
    expect(unlock).toMatchObject({ itemId: CATALOGUE_RELIC, curatorRank: 1 });
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(false);
    expect(meta.renown).toBe(renownBefore);
  });

  it('non-catalog discoveries never raise Curator rank', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    markItemDiscovered(sim.ctx, meta, NON_RELIC);
    expect(isCataloguedRelicItem(NON_RELIC)).toBe(false);
    expect(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned).toBe(0);
    expect(curatorRankFromOwned(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned)).toBe(
      0,
    );
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    expect(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned).toBe(1);
    expect(curatorRankFromOwned(1)).toBe(1);
  });

  it('clear meters alone never raise Curator rank', () => {
    // Rank is unique catalogued relic fills only (never kill/clear count alone).
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.dungeonClears.hollow_crypt = 999;
    meta.deedStats.dungeonClears['hollow_crypt:heroic'] = 999;
    meta.deedStats.counters.thunzharrKills = 999;
    // The real writer's tiered key shape (runs.ts `${delveId}:${tierId}`), so
    // the delve-clears meter is provably nonzero under the production reader.
    meta.delveClears = { ...meta.delveClears, 'collapsed_reliquary:normal': 999 };
    expect(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned).toBe(0);
    expect(curatorRankFromOwned(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned)).toBe(
      0,
    );
    expect(sim.reliquaryCuratorRank()).toBe(0);
  });

  it('veteran retro sync grants all zero-Renown rank bridges up to owned count', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const catalogIds = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ];
    // 25 unique catalogued fills => rank 3; seed discovery without live rank-up
    // celebration path (direct set membership) so only retro sync grants deeds.
    for (const id of catalogIds.slice(0, 25)) {
      meta.deedStats.itemsDiscovered.add(id);
    }
    expect(curatorRankFromOwned(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned)).toBe(
      3,
    );
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(false);
    expect(meta.deedsEarned.has('col_reliquary_rank_3')).toBe(false);
    const renownBefore = meta.renown;
    syncCuratorRankDeeds(sim.ctx, meta, { retro: true });
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_rank_3')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_rank_4')).toBe(false);
    expect(meta.renown).toBe(renownBefore);
    const retroUnlocks = sim
      .drainEvents()
      .filter((e) => e.type === 'deedUnlocked' && e.retro === true);
    expect(
      retroUnlocks.some((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_rank_2'),
    ).toBe(true);
    expect(
      retroUnlocks.some((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_rank_3'),
    ).toBe(true);
  });

  it('clearCountForSource reads dungeon clears without inventing state', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(
      clearCountForSource(meta, { kind: 'dungeon', dungeonId: 'hollow_crypt', difficulty: 'any' }),
    ).toBe(0);
    meta.deedStats.dungeonClears.hollow_crypt = 1;
    meta.deedStats.dungeonClears['hollow_crypt:heroic'] = 2;
    expect(
      clearCountForSource(meta, { kind: 'dungeon', dungeonId: 'hollow_crypt', difficulty: 'any' }),
    ).toBe(3);
    expect(
      clearCountForSource(meta, {
        kind: 'dungeon',
        dungeonId: 'hollow_crypt',
        difficulty: 'heroic',
      }),
    ).toBe(2);
    expect(clearCountForSource(meta, { kind: 'none' })).toBeUndefined();
    // World-boss kills ride deedStats.counters.thunzharrKills.
    expect(clearCountForSource(meta, { kind: 'deed_stat', stat: 'thunzharrKills' })).toBe(0);
    meta.deedStats.counters.thunzharrKills = 5;
    expect(clearCountForSource(meta, { kind: 'deed_stat', stat: 'thunzharrKills' })).toBe(5);
    expect(clearCountForSource(meta, { kind: 'deed_stat', stat: 'not_a_real_stat' })).toBe(0);
  });

  it('delve pages read floored delveClears through the public page readout', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Live content pin: the page really rides the delve arm.
    expect(RELIQUARY_PAGES_BY_ID.conquerors_collapsed_reliquary?.clearSource).toEqual({
      kind: 'delve',
      delveId: 'collapsed_reliquary',
    });
    expect(sim.reliquaryPageClearCount('conquerors_collapsed_reliquary')).toBe(0);
    // The ONLY production writer is grantDelveClearTo (src/sim/delves/runs.ts),
    // whose clearKey is `${delveId}:${tierId}`; the lifetime read must
    // aggregate exactly like delveShopGateUnlocked's clears:N arm
    // (src/sim/content/delves/shop.ts): sum every `${delveId}:` prefixed key,
    // sibling delves excluded. On top of that prefix-sum the Reliquary read
    // floors each entry and drops junk, so the expectation is
    // floor(7.9) + floor(2.2) = 9, never floor(7.9 + 2.2) = 10.
    meta.delveClears['collapsed_reliquary:normal'] = 7.9;
    meta.delveClears['collapsed_reliquary:heroic'] = 2.2;
    // Hand-edited junk under the prefix is guarded out per entry: a
    // non-number never coerces, a negative never subtracts, a non-finite
    // never poisons the total.
    (meta.delveClears as Record<string, unknown>)['collapsed_reliquary:junk'] = 'oops';
    meta.delveClears['collapsed_reliquary:negative'] = -5;
    meta.delveClears['collapsed_reliquary:infinite'] = Number.POSITIVE_INFINITY;
    // A sibling delve's clears never leak into this page.
    meta.delveClears['drowned_litany:normal'] = 50;
    // The bare-id shape has no production writer (runs.ts always writes
    // tiered keys) and stays unread, matching delveShopGateUnlocked.
    meta.delveClears.collapsed_reliquary = 999;
    expect(sim.reliquaryPageClearCount('conquerors_collapsed_reliquary')).toBe(9);
  });

  it('every delve-clears reader agrees on one clear driven through the real writer', () => {
    // Three modules sum meta.delveClears under three different key rules: the
    // shop gate (content/delves/shop.ts) and the Reliquary read (reliquary.ts)
    // sum the `${delveId}:` prefix, while the deed counter (deeds.ts) matches
    // the head segment and so would also count a bare `${delveId}` key. The
    // shared key SHAPE is what keeps them in agreement, and nothing pinned it,
    // so the write here goes through the one production writer,
    // grantDelveClearTo (src/sim/delves/runs.ts), reached from a real run:
    // change the writer's clearKey and every reader below is re-scored.
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const DELVE_ID = 'collapsed_reliquary';
    sim.setPlayerLevel(DELVES[DELVE_ID].minLevel);
    sim.enterDelve(DELVE_ID, 'normal');
    const run = sim.delveRunForPlayer(sim.playerId);
    expect(run, 'a real delve run to grant the clear on').not.toBeNull();
    if (!run) return;
    grantDelveClearTo(sim.ctx, run, DELVES[DELVE_ID], meta, sim.playerId);
    const clears = sim.delveClearsFor(sim.playerId);
    expect(clears[`${DELVE_ID}:normal`]).toBe(1);

    // Reader 1: the Reliquary page readout (public seam plus the pure read).
    expect(sim.reliquaryPageClearCount('conquerors_collapsed_reliquary')).toBe(1);
    expect(clearCountForSource(meta, { kind: 'delve', delveId: DELVE_ID })).toBe(1);
    // Reader 2: the shop gate, bracketed to exactly one clear.
    expect(delveShopGateUnlocked(clears, DELVE_ID, 'clears:1')).toBe(true);
    expect(delveShopGateUnlocked(clears, DELVE_ID, 'clears:2')).toBe(false);
    // Reader 3: the deed counter, same bracket through the live trigger shape.
    expect(checkDeedTrigger(meta, e, { kind: 'delveClears', delveId: DELVE_ID, count: 1 })).toBe(
      true,
    );
    expect(checkDeedTrigger(meta, e, { kind: 'delveClears', delveId: DELVE_ID, count: 2 })).toBe(
      false,
    );
  });

  it('a heroic-only dungeonClears key never leaks into the normal page readout', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(RELIQUARY_PAGES_BY_ID.conquerors_hollow_crypt?.clearSource).toEqual({
      kind: 'dungeon',
      dungeonId: 'hollow_crypt',
      difficulty: 'normal',
    });
    // ONLY the heroic key exists; the bare normal key stays absent.
    meta.deedStats.dungeonClears['hollow_crypt:heroic'] = 4;
    expect(meta.deedStats.dungeonClears.hollow_crypt).toBeUndefined();
    expect(sim.reliquaryPageClearCount('conquerors_hollow_crypt')).toBe(0);
    // The heroic page still reads the same key, so the zero above is the
    // difficulty filter at work, never a dead key.
    expect(sim.reliquaryPageClearCount('conquerors_hollow_crypt_heroic')).toBe(4);
  });

  it('illumination scans past an incomplete first page to the completing page', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // deathlord_warplate sits on two pages and table order puts the (large)
    // Gravewyrm Sanctum page BEFORE the four-slot set page, so the set page
    // can complete while the first pageIds entry stays incomplete.
    const ITEM = 'deathlord_warplate';
    const COMPLETING_PAGE = 'conquerors_set_deathlord';
    const pageIds = RELIQUARY_ITEM_TO_PAGES.get(ITEM);
    expect(pageIds, 'the set member must stay catalogued').toBeDefined();
    const completingIdx = pageIds!.indexOf(COMPLETING_PAGE);
    expect(completingIdx, 'the completing page must not be first in pageIds').toBeGreaterThan(0);
    const setPage = RELIQUARY_PAGES_BY_ID[COMPLETING_PAGE];

    // Own every OTHER set member first, through the real discover path.
    for (const relic of setPage.relics) {
      if (relic.kind === 'item' && relic.itemId !== ITEM) {
        markItemDiscovered(sim.ctx, meta, relic.itemId);
      }
    }
    sim.drainEvents();

    markItemDiscovered(sim.ctx, meta, ITEM);
    // The fill completes ONLY the set page: every pageIds entry ahead of it
    // stays incomplete, so the emit has to scan past them.
    const ownership = characterReliquaryOwnership(meta);
    for (const pageId of pageIds!.slice(0, completingIdx)) {
      expect(
        pageCompletion(RELIQUARY_PAGES_BY_ID[pageId], ownership).complete,
        `${pageId} must stay incomplete for the scan to matter`,
      ).toBe(false);
    }
    expect(pageCompletion(setPage, ownership).complete).toBe(true);

    const unlock = sim.drainEvents().find((e) => e.type === 'reliquaryUnlock' && e.itemId === ITEM);
    expect(unlock).toBeDefined();
    expect(unlock && unlock.type === 'reliquaryUnlock' && unlock.illuminatedPageId).toBe(
      COMPLETING_PAGE,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 17: per-relic obtain counts. World-sourced acquisitions only, and
// information rather than a score: no page, rank, deed, or drop rate reads it.
// ---------------------------------------------------------------------------

describe('Reliquary obtain counts', () => {
  /** A catalogued WEAPON relic, so the enchant re-mint arm can be driven. */
  const WEAPON_RELIC = 'mistcallers_fang';

  it('counts a world-sourced grant per COPY, and only for catalogued relics', () => {
    const sim = makeSim();
    const { meta } = primary(sim);

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    // A second acquisition of a relic already owned still counts: the tally is
    // about obtains, not about membership (which stopped moving at the first).
    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(2);
    expect(meta.reliquary.recent).toEqual([CATALOGUE_RELIC]); // no second find moment

    // Per COPY, not per call: a stacked grant of three is three acquisitions.
    expect(stackSizeOf(ITEMS[STACKABLE_RELIC])).toBeGreaterThan(1);
    sim.addItem(STACKABLE_RELIC, 3, sim.playerId);
    expect(meta.reliquary.counts[STACKABLE_RELIC]).toBe(3);

    // A real item that is not catalogued never enters the map at all.
    sim.addItem(NON_RELIC, 2, sim.playerId);
    expect(Object.hasOwn(meta.reliquary.counts, NON_RELIC)).toBe(false);
    expect(Object.keys(meta.reliquary.counts).sort()).toEqual(
      [CATALOGUE_RELIC, STACKABLE_RELIC].sort(),
    );
  });

  it('counts every copy of one instanced grant', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.addItemInstance(STACKABLE_RELIC, { signer: 'Gatherer' }, sim.playerId, 3);
    expect(meta.reliquary.counts[STACKABLE_RELIC]).toBe(3);
  });

  it('bank round trips, bag moves, and partial-stack splits never move the tally', () => {
    // The phase's stopping rule names these expressly: container moves ride
    // moveBetweenContainers / moveInventoryItem and bypass the grant hubs, so
    // nothing on these routes can reach noteRelicObtain. That is the property
    // a future refactor breaks silently (funnel a bank withdraw through
    // addItem and a player-visible number inflates on every bank visit), and
    // nothing else in the tree pinned it.
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const banker = [...sim.entities.values()].find(
      (x) => x.kind === 'npc' && x.templateId === 'bursar_fernando',
    );
    expect(banker, 'the banker the deposit gate needs must exist').toBeDefined();
    e.pos = { ...banker!.pos };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);

    sim.addItem(STACKABLE_RELIC, 2, sim.playerId);
    expect(meta.reliquary.counts[STACKABLE_RELIC]).toBe(2);
    const bagSlot = () => meta.inventory.findIndex((s) => s.itemId === STACKABLE_RELIC);
    const bankSlot = () => meta.bank.inventory.findIndex((s) => s.itemId === STACKABLE_RELIC);
    const bagCount = () =>
      meta.inventory.filter((s) => s.itemId === STACKABLE_RELIC).reduce((n, s) => n + s.count, 0);

    // A partial deposit SPLITS the stack across the two containers...
    sim.bankDeposit(bagSlot(), 1);
    expect(bagCount()).toBe(1);
    expect(meta.bank.inventory.some((s) => s.itemId === STACKABLE_RELIC)).toBe(true);
    // ...the remainder follows as a whole-slot deposit...
    sim.bankDeposit(bagSlot());
    expect(bagCount()).toBe(0);
    // ...and both copies come back across a partial and a whole withdrawal.
    sim.bankWithdraw(bankSlot(), 1);
    sim.bankWithdraw(bankSlot());
    expect(bagCount()).toBe(2);
    expect(bankSlot()).toBe(-1);

    // A bag reorder is a container move too, through its own seam. The
    // post-condition keeps this arm live: a silently refused move would make
    // the tally assertion below vacuously true for this leg. The move writes
    // the stack's CELL (InvSlot.slot), never the array order, so that is the
    // observable to pin.
    sim.moveInventoryItem(bagSlot(), 0);
    expect(meta.inventory.find((s) => s.itemId === STACKABLE_RELIC)?.slot).toBe(0);

    // Four bank legs and a reorder later, the tally has not moved.
    expect(meta.reliquary.counts[STACKABLE_RELIC]).toBe(2);
  });

  it('a MOVEMENT grant discovers but never counts, on both hub arms', () => {
    const sim = makeSim();
    const { meta } = primary(sim);

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId, { movement: true });
    // Discovery is deliberately unaffected: seeing a relic for the first time
    // across a trade window still fills the page and still toasts.
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();
    expect(meta.reliquary.counts).toEqual({});

    sim.addItemInstance(STACKABLE_RELIC, { signer: 'Someone' }, sim.playerId, 2, {
      movement: true,
    });
    expect(meta.deedStats.itemsDiscovered.has(STACKABLE_RELIC)).toBe(true);
    expect(meta.reliquary.counts).toEqual({});
  });

  it('the exchange pipes (market buy / cancel / collect, mail claim) never count', () => {
    // grantCopies is the ONE grant all four share, so covering it covers them.
    const sim = makeSim();
    const { meta } = primary(sim);
    grantCopies(sim.ctx, sim.playerId, CATALOGUE_RELIC, 1);
    grantCopies(sim.ctx, sim.playerId, STACKABLE_RELIC, 2, { signer: 'Seller' });
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(meta.deedStats.itemsDiscovered.has(STACKABLE_RELIC)).toBe(true);
    expect(meta.reliquary.counts).toEqual({});
  });

  it('a completed trade never counts for the receiver', () => {
    const sim = makeSim();
    const giver = primary(sim);
    const takerPid = sim.addPlayer('warrior', 'Taker');
    const taker = sim.players.get(takerPid)!;
    // Stand the two next to each other: the trade guards are range-checked.
    const takerEntity = sim.entities.get(takerPid)!;
    takerEntity.pos.x = giver.e.pos.x;
    takerEntity.pos.z = giver.e.pos.z;

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(giver.meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    // The INSTANCED arm of the same handover: grantOffer routes a unit that
    // carries an instance payload through ctx.addItemInstance, a SEPARATE call
    // site with its own movement flag, so a plain-only offer would leave that
    // flag untested (a traded signed specimen takes exactly this arm).
    sim.addItemInstance(STACKABLE_RELIC, { signer: 'Giver' }, sim.playerId, 1);
    expect(giver.meta.reliquary.counts[STACKABLE_RELIC]).toBe(1);

    sim.tradeRequest(takerPid, sim.playerId);
    sim.tradeAccept(takerPid);
    sim.tradeSetOffer(
      [
        { itemId: CATALOGUE_RELIC, count: 1 },
        { itemId: STACKABLE_RELIC, count: 1 },
      ],
      0,
      sim.playerId,
    );
    sim.tradeConfirm(sim.playerId);
    sim.tradeConfirm(takerPid);

    // BOTH handovers really happened (otherwise the count claim is vacuous).
    expect(taker.inventory.some((s) => s.itemId === CATALOGUE_RELIC)).toBe(true);
    expect(taker.inventory.some((s) => s.itemId === STACKABLE_RELIC)).toBe(true);
    // Premise for the INSTANCED arm: the received unit still carries its
    // payload, so the handover really took grantOffer's addItemInstance branch
    // (a unit that lost its payload would fall into the plain branch and leave
    // that call site's movement flag untested).
    expect(taker.inventory.find((s) => s.itemId === STACKABLE_RELIC)?.instance?.signer).toBe(
      'Giver',
    );
    expect(taker.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    // ...and the receiving side gained membership without gaining a tally on
    // EITHER arm (plain and instanced).
    expect(taker.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();
    expect(taker.reliquary.firstFind[STACKABLE_RELIC]).toBeDefined();
    expect(taker.reliquary.counts).toEqual({});
    // The giver's own tally is untouched by giving it away: the number counts
    // what the world handed you, and nothing takes that back.
    expect(giver.meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    expect(giver.meta.reliquary.counts[STACKABLE_RELIC]).toBe(1);
  });

  it('an apply-enchant re-mint of a relic never counts', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.addItem(WEAPON_RELIC, 1, sim.playerId);
    sim.addItem('arcane_dust', 20, sim.playerId);
    expect(meta.reliquary.counts[WEAPON_RELIC]).toBe(1);

    runApplyEnchant(sim, WEAPON_RELIC, 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    expect(meta.reliquary.counts[WEAPON_RELIC]).toBe(1);

    // The REPLACE arm mints through the same hub on a separate path.
    runApplyEnchant(sim, WEAPON_RELIC, 'enchant_weapon_intellect', undefined, true);
    expect(sim.lastEnchantResult?.ok).toBe(true);
    expect(meta.reliquary.counts[WEAPON_RELIC]).toBe(1);
  });

  it('a vendor buyback NEVER counts, but still discovers', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    // Stand at Trader Wilkes so the sell / buyback proximity gates pass (the
    // tests/items.test.ts idiom: dist2d over pos.x / pos.z is the whole gate).
    const wilkes = [...sim.entities.values()].find((x) => x.templateId === 'trader_wilkes');
    expect(wilkes, 'trader_wilkes must exist in the seeded world').toBeDefined();
    e.pos.x = wilkes!.pos.x + 2;
    e.pos.z = wilkes!.pos.z;
    (sim as unknown as { rebucket(entity: typeof e): void }).rebucket(e);

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    meta.copper = 100000;
    const copperBeforeSale = meta.copper;

    sim.sellItem(CATALOGUE_RELIC, 1, sim.playerId);
    expect(meta.vendorBuyback.some((s) => s.itemId === CATALOGUE_RELIC)).toBe(true);
    // Unchanged by the sale: selling is not an obtain in either direction.
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);

    sim.buyBackItem(CATALOGUE_RELIC, undefined, undefined, sim.playerId);
    expect(meta.inventory.some((s) => s.itemId === CATALOGUE_RELIC)).toBe(true);
    // Buyback is MOVEMENT (maintainer, 2026-08-08): sell credits sellValue and
    // buyback charges the same sellValue back, so the cycle is copper neutral
    // and repeatable without limit. Counting it would let one player inflate a
    // tally for free, the single-player form of the two-player loop the whole
    // movement rule exists to refuse.
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    // Copper-neutral, asserted rather than assumed: this is the premise the
    // ruling rests on, so it must red here if vendor pricing ever changes.
    expect(meta.copper).toBe(copperBeforeSale);
    // Discovery is untouched on every movement path, buyback included.
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);

    // Ten more cycles do not move it either: the refusal is per acquisition,
    // not a one-shot that a repeat could slip past.
    for (let i = 0; i < 10; i++) {
      sim.sellItem(CATALOGUE_RELIC, 1, sim.playerId);
      sim.buyBackItem(CATALOGUE_RELIC, undefined, undefined, sim.playerId);
    }
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    expect(meta.copper).toBe(copperBeforeSale);
  });

  it('a heroic variant counts its BASE, the slot its discovery fills', () => {
    // The catalog deliberately lists base ids only (pinned in
    // tests/reliquary_content.test.ts), and markItemDiscovered's heroic walk is
    // what fills the base slot from a heroic drop. The tally runs the SAME walk
    // (maintainer delegation, 2026-08-08) so the number agrees with the slot
    // the fill landed in; keying on the granted id alone left 63 of the 135
    // catalogued relics with an owned page and a tally frozen at zero.
    const heroicId = 'heroic_tideguard_greaves';
    const baseId = ITEMS[heroicId]?.heroicOf;
    expect(baseId).toBe('tideguard_greaves');
    // No heroic id is itself catalogued, so the chain has exactly one scoring
    // id here; the walk still increments EVERY catalogued id it visits, which
    // is what a catalogued variant would need.
    expect(isCataloguedRelicItem(heroicId)).toBe(false);
    expect(isCataloguedRelicItem(baseId!)).toBe(true);

    const sim = makeSim();
    const { meta } = primary(sim);
    sim.addItem(heroicId, 1, sim.playerId);

    expect(meta.deedStats.itemsDiscovered.has(baseId!)).toBe(true);
    expect(meta.reliquary.firstFind[baseId!]).toBeDefined();
    expect(meta.reliquary.counts).toEqual({ [baseId!]: 1 });
    // The uncatalogued variant never enters the map under its own id.
    expect(Object.hasOwn(meta.reliquary.counts, heroicId)).toBe(false);

    // A second heroic drop keeps crediting the base, so a heroic farmer's
    // number climbs exactly like a normal-difficulty farmer's.
    sim.addItem(heroicId, 1, sim.playerId);
    expect(meta.reliquary.counts[baseId!]).toBe(2);

    // And a MOVEMENT heroic grant still counts nothing, so the new walk did
    // not smuggle the tally past the movement gate.
    const traded = makeSim();
    const tradedMeta = primary(traded).meta;
    traded.addItem(heroicId, 1, traded.playerId, { movement: true });
    expect(tradedMeta.deedStats.itemsDiscovered.has(baseId!)).toBe(true);
    expect(tradedMeta.reliquary.counts).toEqual({});
  });

  it('a relic discovered before the Reliquary shipped starts its tally on re-obtain', () => {
    // The common veteran shape, and the one case where a count has no entry to
    // ride: markItemDiscovered fires the first-find hook only on an id's FIRST
    // ever discovery, so a pre-rollout relic can never grow a firstFind entry
    // through the seed. The obtain writes the empty carrier itself, or the
    // tally would be dropped by every save.
    const held: CharacterState = {
      ...makeSim().serializeCharacter(makeSim().playerId)!,
      inventory: [{ itemId: CATALOGUE_RELIC, count: 1 }],
      deedStats: { itemsDiscovered: [CATALOGUE_RELIC] },
      reliquary: undefined,
    };
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran', { state: held });
    const meta = sim.players.get(pid)!;
    // Premise: the join really left the blob empty.
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeUndefined();
    expect(isReliquaryStateEmpty(meta.reliquary)).toBe(true);

    sim.addItem(CATALOGUE_RELIC, 1, pid);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    // The carrier landed, sparse: owned, provenance unknown.
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});
    expect(isReliquaryStateEmpty(meta.reliquary)).toBe(false);

    // And it survives the round trip, which is the whole point of the carrier.
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.reliquary?.firstFind?.[CATALOGUE_RELIC]).toEqual({ count: 1 });
    const reloaded = makeSim();
    const rid = reloaded.addPlayer('warrior', 'Reload', { state: saved });
    expect(reloaded.meta(rid)!.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
  });

  it('a MOVEMENT first find stamps NO clears, at any meter value', () => {
    // The executed provenance ruling (maintainer, 2026-08-08), extending the
    // omit-at-zero one: the stamp answers "which clear did you find this on",
    // so a relic that arrived from somewhere else has no answer even when the
    // meter is high. A player sitting on twelve Hollow Crypt clears who BUYS
    // the drop did not find it on clear twelve.
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.dungeonClears.hollow_crypt = 12;
    // Premise: the meter really is turned over, so a sparse entry below cannot
    // be the omit-at-zero rule passing by coincidence.
    expect(sim.reliquaryPageClearCount('conquerors_hollow_crypt')).toBe(12);

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId, { movement: true });
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});

    // CONTRAST, same meter, same relic id, world-sourced: the stamp lands.
    // Without this arm the assertion above would also pass if clears had
    // simply stopped working.
    const world = makeSim();
    const worldMeta = primary(world).meta;
    worldMeta.deedStats.dungeonClears.hollow_crypt = 12;
    world.addItem(CATALOGUE_RELIC, 1, world.playerId);
    expect(worldMeta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 12 });
  });

  it('a MOVEMENT first find still toasts and still pushes recent', () => {
    // Scope guard for the ruling above: only PROVENANCE is unknown. The
    // catalogue fill itself is real, so the unlock event, its page ids, and
    // the recent ring are all unchanged. Narrowing those too would silently
    // delete a player's "you filled a slot" moment on every market purchase.
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.drainEvents();

    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId, { movement: true });

    const unlocks = sim
      .drainEvents()
      .filter((e) => e.type === 'reliquaryUnlock' && e.itemId === CATALOGUE_RELIC);
    expect(unlocks.length).toBe(1);
    expect(unlocks[0].type === 'reliquaryUnlock' && unlocks[0].retro).toBeUndefined();
    expect(meta.reliquary.recent).toEqual([CATALOGUE_RELIC]);
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
  });

  it('the trade and market pipes land their first finds sparse', () => {
    // The ruling through the REAL relocation seams rather than the raw opt, so
    // a site that stopped passing the flag reds here even though the hub-level
    // test above would stay green.
    const traded = makeSim();
    const tradedMeta = primary(traded).meta;
    tradedMeta.deedStats.dungeonClears.hollow_crypt = 7;
    grantCopies(traded.ctx, traded.playerId, CATALOGUE_RELIC, 1);
    expect(tradedMeta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});

    const instanced = makeSim();
    const instancedMeta = primary(instanced).meta;
    instancedMeta.deedStats.dungeonClears.hollow_crypt = 7;
    grantCopies(instanced.ctx, instanced.playerId, CATALOGUE_RELIC, 1, { signer: 'Seller' });
    expect(instancedMeta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});
  });

  it('clamps at the cap and ignores a non-positive copy count', () => {
    // The cap bounds a PERSISTED field and production clamps with the same
    // imported constant, so without this literal a cap retune moves both
    // sides of every clamp assertion together and nothing reds.
    expect(RELIQUARY_OBTAIN_COUNT_CAP).toBe(1e9);
    const sim = makeSim();
    const { meta } = primary(sim);
    noteRelicObtain(meta, CATALOGUE_RELIC, RELIQUARY_OBTAIN_COUNT_CAP);
    noteRelicObtain(meta, CATALOGUE_RELIC, 5);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(RELIQUARY_OBTAIN_COUNT_CAP);
    noteRelicObtain(meta, STACKABLE_RELIC, 0);
    noteRelicObtain(meta, STACKABLE_RELIC, -3);
    noteRelicObtain(meta, STACKABLE_RELIC, Number.NaN);
    expect(Object.hasOwn(meta.reliquary.counts, STACKABLE_RELIC)).toBe(false);
    // Fractional copies floor (2.5 grants two whole units, matching the hub's
    // integer stack semantics), and the floor happens before the increment.
    noteRelicObtain(meta, STACKABLE_RELIC, 2.5);
    expect(meta.reliquary.counts[STACKABLE_RELIC]).toBe(2);
  });

  it('is information only: the tally scores no completion, rank, or deed', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const rankBefore = catalogRankOwned(characterReliquaryOwnership(meta));
    const deedsBefore = meta.deedsEarned.size;
    // Two hundred obtains of ONE relic: a tally that fed rank or completion
    // anywhere would have to move something here.
    for (let i = 0; i < 200; i++) noteRelicObtain(meta, CATALOGUE_RELIC);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(200);
    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBe(rankBefore);
    expect(curatorRankFromOwned(catalogRankOwned(characterReliquaryOwnership(meta)))).toBe(0);
    expect(meta.deedsEarned.size).toBe(deedsBefore);
    expect(catalogItemCompletion(meta.deedStats.itemsDiscovered).owned).toBe(0);
    // And it is never a top-level saved key: the blob still has three.
    const serialized = serializeReliquaryState(meta.reliquary)!;
    expect(Object.keys(serialized).sort()).toEqual(['firstFind']);
    expect(serialized).not.toHaveProperty('counts');
  });
});

describe('Reliquary legacy blob migration and the counts/firstFind invariant', () => {
  it('a pre-Phase-17 blob is STRIPPED by one round trip, and restore is a fixed point', () => {
    // The one-release tolerance, pinned by composition rather than by reading
    // the restore code: a save written before Phase 17 carries the retired
    // pageId and a clears: 0 the omit-at-zero ruling now refuses, and both
    // must be gone from what the next autosave writes, without the entries
    // themselves being dropped (they are real membership meta).
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, 3);
    const [zeroClears, realClears, counted] = ids;
    const legacy = {
      firstFind: {
        [zeroClears]: { clears: 0, pageId: 'conquerors_hollow_crypt' },
        [realClears]: { clears: 4, pageId: 'conquerors_hollow_crypt' },
        [counted]: { clears: 2, pageId: 'conquerors_hollow_crypt', count: 5 },
      },
      marks: [...RELIQUARY_MARK_IDS].slice(0, 1),
      recent: [zeroClears],
    } as never as SavedReliquaryState;

    const restored = restoreReliquaryState(legacy);
    const rewritten = serializeReliquaryState(restored)!;
    expect(rewritten).toBeDefined();

    // Stripped: no pageId anywhere, and the zero clears is gone while its
    // entry survives. Whole-object toEqual, so a surviving stale key reds.
    expect(rewritten.firstFind).toEqual({
      [zeroClears]: {},
      [realClears]: { clears: 4 },
      [counted]: { clears: 2, count: 5 },
    });
    expect(JSON.stringify(rewritten)).not.toContain('pageId');

    // FIXED POINT: restoring what we just wrote lands on the same state as
    // restoring the legacy blob did, so the migration converges in one pass
    // and a later load can never drift further.
    const second = restoreReliquaryState(rewritten);
    expect(second.firstFind).toEqual(restored.firstFind);
    expect(second.counts).toEqual(restored.counts);
    expect([...second.marks]).toEqual([...restored.marks]);
    expect(second.recent).toEqual(restored.recent);
    // ...and serializing again is byte-stable, the property the wire memo and
    // the delta gate both lean on.
    expect(JSON.stringify(serializeReliquaryState(second))).toBe(JSON.stringify(rewritten));
  });

  it('an ARRAY entry is dropped whole, not loaded as an empty carrier', () => {
    // typeof [] === 'object', so an array row used to pass the entry guard and
    // land as {}, inventing membership for a relic whose row was junk.
    const id = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ][0];
    const restored = restoreReliquaryState({
      firstFind: { [id]: [] as never } as never,
    });
    expect(Object.hasOwn(restored.firstFind, id)).toBe(false);
    expect(restored.counts).toEqual({});
    // A populated array is refused the same way (no numeric-key salvage).
    const withEntries = restoreReliquaryState({
      firstFind: { [id]: [{ clears: 3 }] as never } as never,
    });
    expect(Object.hasOwn(withEntries.firstFind, id)).toBe(false);
  });

  it('counts keys stay a SUBSET of firstFind across a mixed obtain/find sequence', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, 6);
    // Interleaved deliberately: obtains before finds, finds before obtains,
    // repeats, a movement grant, and a retro fill, so no single ordering can
    // be the only one the invariant survives.
    noteRelicObtain(meta, ids[0]);
    noteRelicItemFind(meta, ids[1]);
    noteRelicObtain(meta, ids[1], 2);
    sim.addItem(ids[2], 1, sim.playerId);
    sim.addItem(ids[3], 1, sim.playerId, { movement: true });
    noteRelicItemFind(meta, ids[4], { retro: true });
    noteRelicObtain(meta, ids[4]);
    noteRelicObtain(meta, ids[0], 3);
    markItemDiscovered(sim.ctx, meta, ids[5]);

    expect(Object.keys(meta.reliquary.counts).length).toBeGreaterThanOrEqual(4);
    for (const key of Object.keys(meta.reliquary.counts)) {
      expect(key in meta.reliquary.firstFind, `${key} counted with no carrier entry`).toBe(true);
    }
    // And the invariant survives the round trip it exists to protect.
    const saved = sim.serializeCharacter(sim.playerId)!;
    const reloaded = restoreReliquaryState(saved.reliquary);
    for (const key of Object.keys(reloaded.counts)) {
      expect(key in reloaded.firstFind).toBe(true);
    }
    expect(reloaded.counts).toEqual(meta.reliquary.counts);
  });

  it('a count with NO carrier entry is silently LOST by serialize (the trap this documents)', () => {
    // Hand-built state, reachable only by a future writer that increments
    // counts without writing the carrier firstFind entry noteRelicObtain
    // writes. The blob folds each tally ONTO its entry, so a tally with no
    // entry has nowhere to ride and vanishes at the next autosave, with
    // nothing red anywhere. Pinned so the loss is a documented consequence
    // rather than a surprise, and so the carrier write is understood as
    // load-bearing rather than as defensive noise.
    const id = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ][0];
    const orphaned = freshReliquaryState();
    orphaned.counts[id] = 9;
    orphaned.marks.add([...RELIQUARY_MARK_IDS][0]);

    const saved = serializeReliquaryState(orphaned)!;
    expect(saved).toBeDefined();
    // The mark carried the blob past omit-empty, so this is a real save that
    // simply has no home for the tally.
    expect(saved.firstFind).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('9');
    expect(restoreReliquaryState(saved).counts).toEqual({});
    // Contrast: the same tally written through noteRelicObtain DOES survive,
    // because that function writes the carrier.
    const proper = freshReliquaryState();
    const meta = { reliquary: proper } as unknown as Parameters<typeof noteRelicObtain>[0];
    noteRelicObtain(meta, id, 9);
    expect(restoreReliquaryState(serializeReliquaryState(proper)!).counts[id]).toBe(9);
  });
});

describe('Reliquary movement flag at the remaining relocation sites', () => {
  it('unequipping a mech chroma re-grants without counting (offline arm)', () => {
    // Equipping a chroma CONSUMES its item; unequipping mints it back. Pure
    // relocation of a copy the account already owns. Latent for the tally
    // today (no chroma item id is catalogued) and pinned anyway, because the
    // flag's absence is invisible until content makes one catalogued.
    const sim = makeSim();
    const { meta } = primary(sim);
    const chromaId = sim.accountCosmetics.mechChromaIds[0] ?? 'amber_crimson';
    sim.accountCosmetics = { ...sim.accountCosmetics, mechChromaIds: [chromaId] };
    const before = { ...meta.reliquary.counts };

    expect(sim.unequipMechChroma(chromaId, sim.playerId)).toBe(true);
    // The re-grant really happened (otherwise the count claim is vacuous).
    const itemId = mechChromaItemId(chromaId);
    expect(itemId).toBeTruthy();
    expect(meta.inventory.some((s) => s.itemId === itemId)).toBe(true);
    // Discovery fires as on every movement path; the tally does not move.
    expect(meta.deedStats.itemsDiscovered.has(itemId!)).toBe(true);
    expect(meta.reliquary.counts).toEqual(before);

    // Content premise that ARMS the pin above (and its server-arm sibling in
    // tests/reliquary_wire.test.ts): no chroma plate id is catalogued today,
    // so those movement flags are latent and the counts assertions would hold
    // with or without them. The day a plate lands in the catalog, this reds
    // and the flags gain a live test (the unbind-peel pattern).
    const cataloguedChromaPlates = MECH_CHROMAS.map((c) => mechChromaItemId(c.id))
      .filter((id): id is string => id !== null)
      .filter((id) => isCataloguedRelicItem(id));
    expect(cataloguedChromaPlates).toEqual([]);
    // Vacuity floor: the chroma table itself is populated.
    expect(MECH_CHROMAS.length).toBeGreaterThan(0);
  });

  it('the commission-order delivery hands over without counting, and the CRAFT counts', () => {
    // Two catalogued relics are craftable (boundstone_helm here), which makes
    // this flow reachable with a real relic rather than a stand-in: the
    // crafter's mint is world-sourced and COUNTS, while the delivery to the
    // requester is a handover and must not.
    const sim = makeSim();
    const crafter = primary(sim);
    const requesterPid = sim.addPlayer('warrior', 'Requester');
    const requester = sim.players.get(requesterPid)!;
    const requesterEntity = sim.entities.get(requesterPid)!;
    requesterEntity.pos.x = crafter.e.pos.x;
    requesterEntity.pos.z = crafter.e.pos.z;

    const RELIC = 'boundstone_helm';
    const RECIPE = 'recipe_ironbound_warplate_helm';
    expect(isCataloguedRelicItem(RELIC)).toBe(true);
    crafter.meta.knownRecipes.add(RECIPE);
    // The recipe carries a combo requirement (armorcrafting + weaponcrafting),
    // so the crafter needs the attuned pair AND skill in both, exactly as a
    // real crafter would; comboEligibility refuses on identity before it ever
    // looks at the skills.
    crafter.meta.archetype.activeArchetype = 'armorcrafting';
    crafter.meta.archetype.pairedMajor = 'weaponcrafting';
    crafter.meta.craftSkills.armorcrafting = 300;
    crafter.meta.craftSkills.weaponcrafting = 300;
    sim.addItem('arcanite_bar', 2, sim.playerId);
    sim.addItem('thorium_ore', 10, sim.playerId);
    sim.addItem('wolf_fang', 8, sim.playerId);
    sim.addItem('smithing_flux', 4, sim.playerId);

    // The board keys on the RECIPE, and an 'open' order any crafter may take.
    const order = openCommissionOrder(sim.ctx, RECIPE, 'open', undefined, requesterPid);
    expect(order.ok, order.reason).toBe(true);
    const orderId = order.orderId;
    expect(orderId).toBeDefined();
    expect(acceptCommissionOrder(sim.ctx, orderId!, sim.playerId).ok).toBe(true);

    runCraft(sim, RECIPE, true, sim.playerId);
    expect(sim.lastCraftResult?.ok, sim.lastCraftResult?.reason).toBe(true);
    // The crafter's own mint COUNTS: world-sourced, and unlike the buyback
    // loop it is not free, because the reagents were consumed.
    expect(crafter.meta.reliquary.counts[RELIC]).toBe(1);
    expect(requester.reliquary.counts).toEqual({});

    const delivered = deliverCommissionOrder(sim.ctx, orderId!, sim.playerId);
    expect(delivered.ok, delivered.reason).toBe(true);
    // The requester really received it, and gained membership without a tally.
    expect(requester.inventory.some((s) => s.itemId === RELIC)).toBe(true);
    expect(requester.deedStats.itemsDiscovered.has(RELIC)).toBe(true);
    expect(requester.reliquary.firstFind[RELIC]).toBeDefined();
    expect(requester.reliquary.counts).toEqual({});
    // ...and no provenance was fabricated for the handover either.
    expect(requester.reliquary.firstFind[RELIC]).toEqual({});
    // The crafter's tally is unchanged by giving it away.
    expect(crafter.meta.reliquary.counts[RELIC]).toBe(1);
  });

  it('the quest fallback re-grant can never reach a catalogued relic (content)', () => {
    // acceptQuest and the turn-in recovery both re-grant missing
    // quest.requiredItems through a bare ctx.addItem: a re-mint of a copy the
    // player already obtained, movement semantics without the flag. Safe today
    // because every declared requiredItem is a quest-kind item and none is
    // catalogued; this pins that premise (the unbind-peel pattern) so the day
    // a catalogued relic becomes a requiredItem, the site gains a real
    // classification decision instead of silently counting the re-mint.
    const offenders: string[] = [];
    for (const [questId, quest] of Object.entries(QUESTS)) {
      for (const itemId of quest.requiredItems ?? []) {
        if (isCataloguedRelicItem(itemId)) offenders.push(`${questId}:${itemId}`);
      }
    }
    expect(offenders).toEqual([]);
    // Vacuity floor: requiredItems declarations DO exist to be swept.
    const declaring = Object.values(QUESTS).filter((q) => (q.requiredItems?.length ?? 0) > 0);
    expect(declaring.length).toBeGreaterThan(0);
  });

  it('the unbind stack-split peel can never reach a catalogued relic (content)', () => {
    // commission.ts only peels when a bound slot holds MORE than one copy, and
    // unbind is offered only for commission-eligible kinds. Those kinds never
    // stack past one, so the peel arm is unreachable for every catalogued
    // relic: its movement flag is correct but defensive. This pins the content
    // fact rather than scraping the source, so the day a stackable relic
    // becomes commission-eligible, this reds and the flag gets a real test.
    const offenders: string[] = [];
    for (const page of RELIQUARY_PAGES) {
      for (const relic of page.relics) {
        if (relic.kind !== 'item') continue;
        const def = ITEMS[relic.itemId];
        if (isCommissionEligible(def) && stackSizeOf(def) > 1) offenders.push(relic.itemId);
      }
    }
    expect(offenders).toEqual([]);
    // Vacuity floor: commission-eligible relics DO exist, so the premise is
    // about stacking rather than about the eligible set being empty.
    const eligible = RELIQUARY_PAGES.flatMap((p) =>
      p.relics.filter((r) => r.kind === 'item' && isCommissionEligible(ITEMS[r.itemId])),
    );
    expect(eligible.length).toBeGreaterThan(100);
  });

  it('a guild-bank-shaped first find through buyback lands sparse and uncounted', () => {
    // The hole the buyback comment used to deny: guild bank withdrawals move
    // items with moveBetweenContainers and never touch the discovery ledger,
    // so an UNDISCOVERED relic can reach a player's bags. Selling and buying
    // it back then fires its first-ever discovery through the vendor path. The
    // fixture models that arrival directly (bags mutated with no ledger write),
    // because the state, not the route, is what the vendor path sees.
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const wilkes = [...sim.entities.values()].find((x) => x.templateId === 'trader_wilkes');
    e.pos.x = wilkes!.pos.x + 2;
    e.pos.z = wilkes!.pos.z;
    (sim as unknown as { rebucket(entity: typeof e): void }).rebucket(e);
    meta.copper = 100000;
    meta.deedStats.dungeonClears.hollow_crypt = 9;

    // Arrives with NO discovery credit, the guild-bank shape.
    meta.inventory.push({ itemId: CATALOGUE_RELIC, count: 1 });
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);

    sim.sellItem(CATALOGUE_RELIC, 1, sim.playerId);
    sim.buyBackItem(CATALOGUE_RELIC, undefined, undefined, sim.playerId);

    // The first-ever discovery really happened HERE, on the vendor path.
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();
    // ...and it invented neither provenance nor a tally, despite a meter
    // reading 9 that the old opts-free seam call would have stamped.
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});
    expect(meta.reliquary.counts).toEqual({});
  });
});

describe('Reliquary fill-chain ownership hoist premise', () => {
  // The hoist in src/sim/reliquary.ts (onItemDiscovered / noteReliquaryMark /
  // maybeSyncCuratorRankDeeds each build characterReliquaryOwnership ONCE and
  // thread it) rests on a stated premise, quoted from the comment there:
  // three of the snapshot's four surfaces are LIVE references, so a write
  // inside the chain is visible through it, and the fourth, ownedMounts, is a
  // COPY that "cannot change inside a fill chain at all, since nothing here
  // moves a reins item". Only that fourth surface can go stale, and only if
  // some step of the chain grants or removes an item. Today nothing does:
  // noteRelicItemFind writes firstFind and recent, emitReliquaryUnlock reads
  // and queues an event, and grantDeed touches deedsEarned / renown /
  // milestones. This pins the premise itself, so a future deed reward that
  // hands out an item reds HERE, next to the rationale, instead of silently
  // under-reporting Curator rank.
  it('a rank-granting fill chain moves no item in bags, bank, or equipment', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Hold reins so ownedMounts is non-empty and a staleness bug would have
    // something to lose (an empty copy could not disagree with a live read).
    sim.addItem('reins_valorsteed', 1, sim.playerId);
    meta.bank.inventory.push({ itemId: 'reins_swiftpaw', count: 1 });

    const snapshot = () => ({
      inventory: JSON.stringify(meta.inventory),
      bank: JSON.stringify(meta.bank.inventory),
      equipment: JSON.stringify(meta.equipment),
      mounts: [...ownedMounts(meta)].sort().join(','),
    });
    const rank = () => curatorRankFromOwned(catalogRankOwned(characterReliquaryOwnership(meta)));

    const ids = [
      ...new Set(
        RELIQUARY_PAGES.flatMap((p) =>
          p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
        ),
      ),
    ].slice(0, CURATOR_RANK_DEFS[2].threshold);
    // Every fill is a chain; each is checked in isolation so the assertion
    // names the exact call that moved something, and the rank-crossing ones
    // (the chains that actually reach emit + syncCuratorRankDeeds off the
    // hoisted snapshot) are counted so this cannot pass vacuously.
    let rankUps = 0;
    for (const id of ids) {
      const before = snapshot();
      const rankBefore = rank();
      markItemDiscovered(sim.ctx, meta, id);
      if (rank() > rankBefore) rankUps++;
      // Equality on CONTENTS, not lengths: a swap preserving counts would
      // still falsify the premise.
      expect(snapshot(), `fill of ${id} moved an item`).toEqual(before);
    }
    // The chains under test really did grant rank deeds, which is the step
    // that reuses the snapshot furthest from where it was built.
    expect(rankUps).toBeGreaterThanOrEqual(2);
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_rank_3')).toBe(true);
  });
});

describe('Reliquary ownership snapshot liveness', () => {
  it('the snapshot surfaces the fill chain depends on are LIVE references', () => {
    // noteReliquaryMark builds its ownership snapshot BEFORE marks.add and
    // hands the SAME object to emitReliquaryUnlock and syncCuratorRankDeeds,
    // which need the post-add view. That is correct only while
    // characterReliquaryOwnership returns live references for these three
    // surfaces: a future defensive copy (an entirely safe-looking change)
    // would kill page-completion illumination and rank deeds on the MARK path
    // silently, with the whole suite green, because every illumination test
    // drives the ITEM path where the ledger write precedes the snapshot.
    const sim = makeSim();
    const { meta } = primary(sim);
    const ownership = characterReliquaryOwnership(meta);
    expect(ownership.marks).toBe(meta.reliquary.marks);
    expect(ownership.itemsDiscovered).toBe(meta.deedStats.itemsDiscovered);
    expect(ownership.deedsEarned).toBe(meta.deedsEarned);
  });

  it('a MARK that completes its page illuminates it (the liveness in behavior)', () => {
    // The behavioral arm of the identity pin above: professions_field_notes
    // is all-mark, so its LAST fill goes through noteReliquaryMark, whose
    // hoisted pre-add snapshot must still see the add (the live marks Set)
    // for pageCompletion to read complete. A defensive copy in
    // characterReliquaryOwnership kills exactly this emit.
    const sim = makeSim();
    const { meta } = primary(sim);
    const page = RELIQUARY_PAGES_BY_ID.professions_field_notes;
    const markIds = page.relics.filter((r) => r.kind === 'mark').map((r) => r.markId);
    expect(markIds.length, 'the all-mark page premise').toBe(page.relics.length);
    expect(markIds.length).toBeGreaterThan(1);
    for (const markId of markIds.slice(0, -1)) {
      expect(noteReliquaryMark(sim.ctx, meta, markId)).toBe(true);
    }
    sim.drainEvents();
    const last = markIds[markIds.length - 1];
    expect(noteReliquaryMark(sim.ctx, meta, last)).toBe(true);
    const unlock = sim.drainEvents().find((e) => e.type === 'reliquaryUnlock' && e.markId === last);
    expect(unlock).toBeDefined();
    expect(unlock && unlock.type === 'reliquaryUnlock' && unlock.illuminatedPageId).toBe(
      'professions_field_notes',
    );
  });
});

describe('Reliquary wire memo revision bumps', () => {
  // The memo's failure mode is SILENT: the server compares the string
  // reliquaryWireJson returns against session.lastSent, so a writer that forgets
  // to bump the revision ships nothing at all and the client keeps a stale blob
  // forever, with no error anywhere. This drives each of the four public writers
  // in turn and asserts the built JSON actually moved, which is the observable
  // the server depends on (rather than the private revision counter).
  it('every public writer moves the built blob', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const state = meta.reliquary;
    meta.deedStats.dungeonClears.hollow_crypt = 3;

    const build = () => reliquaryWireJson(state);
    // A build with nothing written yet, so each step below has a prior string
    // to differ from and the cache record exists to be reused.
    expect(build()).toBe('{}');
    expect(reliquaryWireCacheProbe(state)).toBeDefined();

    // 1. noteRelicItemFind (the first-find write seam).
    const afterEmpty = build();
    expect(noteRelicItemFind(meta, CATALOGUE_RELIC)).toBe(true);
    const afterFind = build();
    expect(afterFind).not.toBe(afterEmpty);
    expect(JSON.parse(afterFind).firstFind[CATALOGUE_RELIC]).toEqual({ clears: 3 });

    // 2. noteRelicObtain (the tally).
    noteRelicObtain(meta, CATALOGUE_RELIC);
    const afterObtain = build();
    expect(afterObtain).not.toBe(afterFind);
    expect(JSON.parse(afterObtain).firstFind[CATALOGUE_RELIC]).toEqual({ clears: 3, count: 1 });

    // 3. noteReliquaryMark (a mark plus its recent push).
    const markId = [...RELIQUARY_MARK_IDS][0];
    expect(noteReliquaryMark(sim.ctx, meta, markId)).toBe(true);
    const afterMark = build();
    expect(afterMark).not.toBe(afterObtain);
    expect(JSON.parse(afterMark).marks).toEqual([markId]);

    // 4. syncReliquaryMarksFromVisited (the silent join-time refill).
    const second = [...RELIQUARY_MARK_IDS][1];
    expect(second).toBeDefined();
    meta.deedStats.visited.add(second);
    expect(syncReliquaryMarksFromVisited(meta)).toBe(1);
    const afterSync = build();
    expect(afterSync).not.toBe(afterMark);
    expect(JSON.parse(afterSync).marks).toContain(second);

    // 5. A fill that newly COMPLETES a page (Phase 18): the sticky
    // illuminatedPages record appears in the built blob, and the memo record
    // identity churns exactly like the other arms. professions_field_notes is
    // all-mark, so its last fill runs through noteReliquaryMark.
    const fieldNotes = RELIQUARY_PAGES_BY_ID.professions_field_notes.relics
      .filter((r) => r.kind === 'mark')
      .map((r) => r.markId);
    for (const markId of fieldNotes.slice(0, -1)) {
      expect(noteReliquaryMark(sim.ctx, meta, markId)).toBe(true);
    }
    const beforeIllum = build();
    expect(JSON.parse(beforeIllum).illuminatedPages).toBeUndefined();
    const recordBeforeIllum = reliquaryWireCacheProbe(state);
    expect(noteReliquaryMark(sim.ctx, meta, fieldNotes[fieldNotes.length - 1]!)).toBe(true);
    const afterIllum = build();
    expect(afterIllum).not.toBe(beforeIllum);
    expect(reliquaryWireCacheProbe(state)).not.toBe(recordBeforeIllum);
    expect(JSON.parse(afterIllum).illuminatedPages).toEqual(['professions_field_notes']);

    // A build with nothing written in between reuses the cached record, so the
    // assertions above are about the WRITES moving it, not about every call
    // rebuilding regardless.
    const record = reliquaryWireCacheProbe(state);
    expect(build()).toBe(afterIllum);
    expect(reliquaryWireCacheProbe(state)).toBe(record);
  });

  it('the memoized wire JSON is byte-identical to the direct serialize expression', () => {
    // The maybe-to-maybeRaw swap in server/game.ts rests on this equality: a
    // byte mismatch would fail every session's lastSent comparison once at
    // deploy and spuriously re-ship the blob to every connected client. The
    // equality arm pins that the memo wraps serializeReliquaryState with the
    // `?? {}` default (it shares the serializer, so it cannot see a drift
    // INSIDE it); the literal arm below is what pins the actual bytes.
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.dungeonClears.hollow_crypt = 2;
    sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
    sim.addItem(STACKABLE_RELIC, 3, sim.playerId);
    expect(noteReliquaryMark(sim.ctx, meta, [...RELIQUARY_MARK_IDS][0])).toBe(true);
    expect(reliquaryWireJson(meta.reliquary)).toBe(
      JSON.stringify(serializeReliquaryState(meta.reliquary) ?? {}),
    );

    // The LITERAL byte pin: key order, the fold shape, and the sparse-field
    // omissions, spelled out so a serializer field-order or shape drift reds
    // here even though both expressions above share the implementation. Note
    // the firstFind key order: RESTORE iterates the saved keys SORTED (the
    // recorded live-vs-restored insertion-order property), so greaves lands
    // before helm even though the fixture lists helm first.
    const state = restoreReliquaryState({
      firstFind: { cryptbone_helm: { clears: 2, count: 3 }, cryptbone_greaves: {} },
      marks: ['gather_event:pristine_vein'],
      recent: ['cryptbone_helm'],
    });
    // This fixture completes NO page, so the Phase 18 illuminatedPages field
    // is OMITTED and the pre-Phase-18 bytes are unchanged (verified: two
    // owned crypt relics of five). Byte-stability across the field's arrival
    // is the point of keeping this arm untouched.
    expect(reliquaryWireJson(state)).toBe(
      '{"firstFind":{"cryptbone_greaves":{},"cryptbone_helm":{"clears":2,"count":3}},' +
        '"marks":["gather_event:pristine_vein"],"recent":["cryptbone_helm"]}',
    );

    // The illuminated arm: the sticky record serializes SORTED, in its
    // ALPHABETICAL key position (firstFind, illuminatedPages, marks, recent).
    const illuminated = restoreReliquaryState({
      firstFind: { cryptbone_helm: { clears: 2 } },
      illuminatedPages: ['conquerors_thunzharr', 'conquerors_hollow_crypt'],
      marks: ['gather_event:pristine_vein'],
      recent: ['cryptbone_helm'],
    });
    expect(reliquaryWireJson(illuminated)).toBe(
      '{"firstFind":{"cryptbone_helm":{"clears":2}},' +
        '"illuminatedPages":["conquerors_hollow_crypt","conquerors_thunzharr"],' +
        '"marks":["gather_event:pristine_vein"],"recent":["cryptbone_helm"]}',
    );
  });
});

// The catalog-index memo: the second sanctioned module global in reliquary.ts,
// a WeakMap keyed on the PAGES ARRAY identity. It matters beyond speed because
// catalogCharacterCompletion reads the index for the `owned === total` gate that
// grants col_reliquary_complete (a persisted deed and its permanent title), so
// an index answering for the wrong page table would hand out or withhold that
// grant. Two properties are pinned here: a repeat read REUSES the build, and no
// page table can ever answer with another's index.
describe('Reliquary catalog index memo', () => {
  /** Independent oracle for the default catalog's unique item-relic count,
   *  walked here rather than read back off the thing under test. */
  const uniqueDefaultItemIds = (): number => {
    const ids = new Set<string>();
    for (const page of RELIQUARY_PAGES) {
      for (const relic of page.relics) {
        if (relic.kind === 'item') ids.add(relic.itemId);
      }
    }
    return ids.size;
  };

  /** A two-slot page table with ids the real catalog does not carry, so a
   *  poisoned index shows up as a wrong TOTAL and not merely a wrong count. */
  const customPages = (): ReliquaryPageDef[] => [
    {
      id: 'probe_page',
      shelf: 'conquerors',
      name: 'Probe Page',
      relics: [
        { kind: 'item', itemId: 'probe_relic_alpha' },
        { kind: 'item', itemId: 'probe_relic_beta' },
      ],
    },
  ];

  it('reuses the built index across two default-pages reads (identity, not equal bytes)', () => {
    // Deliberately NOT asserting the probe is undefined first: this module is
    // shared with every describe above, so the default index may already exist.
    // What is pinned is that a read between two probes does not REPLACE the
    // entry, which is exactly what a rebuild would do (catalogIndexFor sets on
    // every build). Equal contents would pass with no memo at all.
    catalogItemCompletion(new Set());
    const first = reliquaryCatalogIndexProbe(RELIQUARY_PAGES);
    expect(first, 'a completion read must populate the memo').toBeDefined();
    catalogItemCompletion(new Set());
    expect(reliquaryCatalogIndexProbe(RELIQUARY_PAGES)).toBe(first);
    // And the shared lists are frozen, since every reader gets these exact
    // arrays: one caller's in-place write would move every later total.
    expect(Object.isFrozen(first?.items)).toBe(true);
    expect(Object.isFrozen(first?.marks)).toBe(true);
    expect(Object.isFrozen(first?.mounts)).toBe(true);
    expect(Object.isFrozen(first?.skins)).toBe(true);
    expect(Object.isFrozen(first?.titles)).toBe(true);
  });

  it('interleaved custom and default reads never poison each other, in either direction', () => {
    const oracle = uniqueDefaultItemIds();
    const pages = customPages();
    // Default first, so the custom read below has a live shared entry to
    // clobber if the memo ever keyed on anything but identity.
    expect(catalogItemCompletion(new Set()).total).toBe(oracle);
    expect(catalogItemCompletion(new Set(), pages).total).toBe(2);
    // The default answer must survive the custom read...
    expect(catalogItemCompletion(new Set()).total).toBe(oracle);
    // ...and the custom answer must survive the default read.
    expect(catalogItemCompletion(new Set(), pages).total).toBe(2);
    expect(reliquaryCatalogIndexProbe(pages)).toBeDefined();
    expect(reliquaryCatalogIndexProbe(pages)).not.toBe(reliquaryCatalogIndexProbe(RELIQUARY_PAGES));
  });

  it('memoizes a custom page table too (a second custom read reuses its own entry)', () => {
    // The old identity special-case (`pages === RELIQUARY_PAGES`) rebuilt on
    // every custom-pages read; the WeakMap gives every array its own entry.
    const pages = customPages();
    catalogItemCompletion(new Set(), pages);
    const first = reliquaryCatalogIndexProbe(pages);
    expect(first).toBeDefined();
    catalogItemCompletion(new Set(), pages);
    expect(reliquaryCatalogIndexProbe(pages)).toBe(first);
  });

  it('gives a structurally identical COPY of the default table its own entry', () => {
    // Same page objects in the same order, a different array: the key is the
    // ARRAY, so the copy builds its own index rather than inheriting the
    // default's. Equal answers, separate entries.
    const copy = [...RELIQUARY_PAGES];
    expect(catalogItemCompletion(new Set(), copy).total).toBe(uniqueDefaultItemIds());
    const copyIndex = reliquaryCatalogIndexProbe(copy);
    expect(copyIndex).toBeDefined();
    expect(copyIndex).not.toBe(reliquaryCatalogIndexProbe(RELIQUARY_PAGES));
  });

  it('the scoring-pages memo answers by identity, and never with the default catalog', () => {
    // The layer ABOVE the index memo, pinned the same way. Identity is the
    // whole point: catalogIndexFor keys on the array this returns, so an equal
    // but fresh array would rebuild the catalog index on every read.
    catalogRelicCompletion({ itemsDiscovered: new Set() });
    const first = reliquaryScoringPagesProbe(RELIQUARY_PAGES);
    expect(first, 'a completion read must populate the scoring memo').toBeDefined();
    catalogRelicCompletion({ itemsDiscovered: new Set() });
    expect(reliquaryScoringPagesProbe(RELIQUARY_PAGES)).toBe(first);
    // The live catalog HAS flagged pages, so the answer is a filtered copy and
    // it is frozen (every reader gets this exact array).
    expect(first).not.toBe(RELIQUARY_PAGES);
    expect(Object.isFrozen(first)).toBe(true);
    // A hand-carried literal, not the production filter restated (which would
    // prove nothing): 35 pages minus the vault and riftbound flags.
    expect(first?.length).toBe(33);
    expect(first?.some((p) => p.excludeFromCompletion !== undefined)).toBe(false);

    // An UNFLAGGED synthetic table answers the caller's own array by identity:
    // nothing to filter means nothing to allocate.
    const unflagged = customPages();
    catalogRelicCompletion({ itemsDiscovered: new Set() }, unflagged);
    expect(reliquaryScoringPagesProbe(unflagged)).toBe(unflagged);

    // A FLAGGED synthetic table gets its own filtered, frozen answer, and
    // never the default catalog's.
    const flagged: ReliquaryPageDef[] = [
      ...customPages(),
      {
        id: 'probe_flagged',
        shelf: 'horizons',
        name: 'Probe Flagged',
        excludeFromCompletion: 'personal',
        relics: [{ kind: 'item', itemId: 'probe_relic_gamma' }],
      },
    ];
    expect(catalogRelicCompletion({ itemsDiscovered: new Set() }, flagged).total).toBe(2);
    const flaggedAnswer = reliquaryScoringPagesProbe(flagged);
    expect(flaggedAnswer).toBeDefined();
    expect(flaggedAnswer).not.toBe(flagged);
    expect(flaggedAnswer).not.toBe(first);
    expect(Object.isFrozen(flaggedAnswer)).toBe(true);
    expect(flaggedAnswer?.map((p) => p.id)).toEqual(['probe_page']);
  });

  it('the outer scoring filter keeps a flagged skin slot out of the character subtraction', () => {
    // catalogCharacterCompletion subtracts the SCORING index's skin slots
    // from the full pair; the inner catalogRelicCompletion filters again, so
    // the only observable work of the OUTER filter is that subtraction. A
    // flagged page carrying a weapon_skin separates the two: its skin slot
    // was never counted, so subtracting it would deflate total below owned
    // (here 1 owned over a phantom total of 0). No live flagged page carries
    // a skin today, so this synthetic arm is what keeps the outer filter
    // live and pinned (the testable sibling of the M4 dead guard).
    const pages: ReliquaryPageDef[] = [
      {
        id: 'probe_scored',
        shelf: 'conquerors',
        name: 'Probe Scored',
        relics: [{ kind: 'item', itemId: 'probe_relic_alpha' }],
      },
      {
        id: 'probe_flagged_skin',
        shelf: 'horizons',
        name: 'Probe Flagged Skin',
        excludeFromCompletion: 'retired',
        relics: [
          { kind: 'weapon_skin', skinId: 'probe_skin' },
          { kind: 'item', itemId: 'probe_relic_beta' },
        ],
      },
    ];
    const pair = catalogCharacterCompletion({ itemsDiscovered: { has: () => true } }, pages);
    expect(pair).toEqual({ owned: 1, total: 1 });
  });
});

describe('Reliquary determinism', () => {
  it('identical seeds and discover order produce identical firstFind, recent, and counts', () => {
    function run(): { first: string; recent: string[]; counts: string } {
      const sim = makeSim(99);
      const { meta } = primary(sim);
      meta.deedStats.dungeonClears.hollow_crypt = 4;
      markItemDiscovered(sim.ctx, meta, NON_RELIC);
      markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
      // The tally is new Phase 17 sim state written on the grant path: it
      // rides the same-seed pin like the surfaces it is folded beside.
      sim.addItem(CATALOGUE_RELIC, 1, sim.playerId);
      sim.addItem(STACKABLE_RELIC, 2, sim.playerId);
      return {
        first: JSON.stringify(meta.reliquary.firstFind),
        recent: [...meta.reliquary.recent],
        counts: JSON.stringify(meta.reliquary.counts),
      };
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // No wall-clock or Math.random in the path: two runs stay bit-equal.
    expect(a.first).toContain(CATALOGUE_RELIC);
    expect(a.recent).toEqual([CATALOGUE_RELIC, STACKABLE_RELIC]);
    expect(JSON.parse(a.counts)[STACKABLE_RELIC]).toBe(2);
  });
});

// The join seed drives real Sim.addPlayer with a veteran-shaped save: relics
// HELD in bags and bank, discovery ledger predating them. Behavioral on
// purpose, replacing the two source scrapes that only proved retroFallbackGrants
// mentioned the right function names.
describe('Reliquary join seed is silent, flagged, and provenance-honest', () => {
  const catalogItemIds = [
    ...new Set(
      RELIQUARY_PAGES.flatMap((p) =>
        p.relics.filter((r) => r.kind === 'item').map((r) => r.itemId),
      ),
    ),
  ];
  // Twelve fills clear the rank-2 threshold, so the join also has to produce
  // rank-bridge deeds; without that the retro deed assertion would be vacuous.
  const SEEDED = catalogItemIds.slice(0, 12);

  /** A real save, then desynced the way a pre-rollout character reads. */
  function veteranState(): CharacterState {
    const donor = makeSim();
    const state = donor.serializeCharacter(donor.playerId)!;
    return {
      ...state,
      inventory: SEEDED.slice(0, 8).map((itemId) => ({ itemId, count: 1 })),
      bank: {
        inventory: SEEDED.slice(8).map((itemId) => ({ itemId, count: 1 })),
        purchasedSlots: 0,
        bonusSlots: 0,
      },
      // The whole point of the fixture: the ledger has not heard of them.
      deedStats: undefined,
      reliquary: undefined,
    };
  }

  it('seeds held relics with retro events, an untouched recent ring, and no invented clears', () => {
    const sim = makeSim();
    sim.drainEvents(); // discard the host sim's own join events
    const pid = sim.addPlayer('warrior', 'Veteran', { state: veteranState() });
    const meta = sim.players.get(pid)!;
    const events = sim.drainEvents().filter((e) => e.pid === pid);

    const unlocks = events.filter((e) => e.type === 'reliquaryUnlock');
    // Exact, not a floor: the seed fires once per held relic and the base
    // character contributes no catalogued relic of its own, so a stray extra
    // unlock (a double-walk of a container, say) has to red here.
    expect(unlocks.length).toBe(SEEDED.length);
    for (const ev of unlocks) {
      expect(ev.type === 'reliquaryUnlock' && ev.retro).toBe(true);
    }
    const rankBridges = events.filter(
      (e) => e.type === 'deedUnlocked' && e.deedId.startsWith('col_reliquary_rank_'),
    );
    // Twelve fills reach rank 2 and no further, and rank 1 has no bridge deed,
    // so exactly one bridge is correct; more would mean a threshold moved.
    expect(rankBridges.length).toBe(1);
    for (const ev of rankBridges) {
      expect(ev.type === 'deedUnlocked' && ev.retro).toBe(true);
    }

    // Silent: logging in is not a find moment.
    expect(meta.reliquary.recent).toEqual([]);
    // Provenance is never fabricated: today's clear count is not the count at
    // the real first obtain, so the key is absent entirely (not zero).
    const seededEntries = Object.entries(meta.reliquary.firstFind);
    expect(seededEntries.length).toBe(SEEDED.length);
    for (const [itemId, entry] of seededEntries) {
      expect(Object.hasOwn(entry, 'clears'), `${itemId} must carry no clears`).toBe(false);
    }
    // The serialized blob stays honest too (no clears key round-trips out).
    // Count first: an empty firstFind would pass the loop vacuously.
    const saved = sim.serializeCharacter(pid)!;
    expect(Object.keys(saved.reliquary?.firstFind ?? {}).length).toBe(SEEDED.length);
    for (const [itemId, entry] of Object.entries(saved.reliquary?.firstFind ?? {})) {
      // hasOwn, not toBeUndefined: an explicit `clears: undefined` key would
      // survive the round trip and still read as undefined.
      expect(Object.hasOwn(entry, 'clears'), `saved ${itemId} must carry no clears`).toBe(false);
    }
    // And the full round trip: reload the save into a fresh sim and prove the
    // sparse entries stay sparse (restore must not synthesize a clears key).
    // The ledger already holds the ids, so the reload seeds nothing new.
    const reloaded = new Sim({ seed: 43, playerClass: 'warrior', autoEquip: false });
    const rid = reloaded.addPlayer('warrior', 'reloaded', { state: saved });
    const rentries = Object.entries(reloaded.meta(rid)!.reliquary.firstFind);
    expect(rentries.length).toBe(SEEDED.length);
    for (const [itemId, entry] of rentries) {
      expect(Object.hasOwn(entry, 'clears'), `reloaded ${itemId} must carry no clears`).toBe(false);
    }
    // "Seeds nothing new" asserted directly, not inferred from counts: a
    // re-login must not re-emit the retro batch (that is one spurious
    // catch-up line per relog). The itemsDiscovered short-circuit makes the
    // seed idempotent, and this pins it at the event surface.
    expect(
      reloaded.drainEvents().filter((e) => e.pid === rid && e.type === 'reliquaryUnlock'),
    ).toEqual([]);
  });

  it('refills marks from the visit ledger BEFORE scoring rank, so mark fills can rank up', () => {
    // Ordering guard with teeth: syncReliquaryMarksFromVisited has to run
    // ahead of the rank sync, or these marks score zero and the veteran is
    // stranded below the bridge they already earned.
    const catalogMarks = [...RELIQUARY_MARK_IDS];
    expect(catalogMarks.length).toBeGreaterThanOrEqual(CURATOR_RANK_DEFS[1].threshold);
    const donor = makeSim();
    const base = donor.serializeCharacter(donor.playerId)!;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Fieldhand', {
      state: { ...base, deedStats: { visited: catalogMarks }, reliquary: undefined },
    });
    const meta = sim.players.get(pid)!;

    for (const mark of catalogMarks) expect(meta.reliquary.marks.has(mark)).toBe(true);
    expect(meta.reliquary.recent).toEqual([]); // still silent
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
    const bridge = sim
      .drainEvents()
      .filter((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_rank_2');
    expect(bridge.length).toBe(1);
    expect(bridge[0].type === 'deedUnlocked' && bridge[0].retro).toBe(true);
  });

  it('a LIVE find after the same join toasts without retro, pushes recent, and stamps clears', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran', { state: veteranState() });
    const meta = sim.players.get(pid)!;
    sim.drainEvents();
    expect(meta.reliquary.recent).toEqual([]);

    // A catalogued relic the seed did not cover, on a page whose clear meter is
    // a normal-difficulty dungeon, so this test can TURN THAT METER OVER and
    // the stamped-clears half of the contract is observable. Since the Phase 17
    // ruling omits clears at zero, a page left at zero would prove nothing
    // here: a stamp only exists once a clear does.
    const liveRelic = catalogItemIds.find((id) => {
      if (SEEDED.includes(id)) return false;
      const pageId = RELIQUARY_ITEM_TO_PAGES.get(id)?.[0];
      const source = pageId ? RELIQUARY_PAGES_BY_ID[pageId]?.clearSource : undefined;
      return source !== undefined && source.kind === 'dungeon' && source.difficulty !== 'heroic';
    });
    expect(liveRelic, 'a dungeon-sourced catalogued relic outside the seed').toBeDefined();
    const source = RELIQUARY_PAGES_BY_ID[RELIQUARY_ITEM_TO_PAGES.get(liveRelic!)![0]].clearSource;
    expect(source?.kind).toBe('dungeon');
    if (source?.kind !== 'dungeon') throw new Error('expected a dungeon clear source');
    meta.deedStats.dungeonClears[source.dungeonId] = 5;

    sim.addItem(liveRelic!, 1, pid);
    const unlocks = sim
      .drainEvents()
      .filter((e) => e.type === 'reliquaryUnlock' && e.itemId === liveRelic);
    expect(unlocks.length).toBe(1);
    expect(unlocks[0].type === 'reliquaryUnlock' && unlocks[0].retro).toBeUndefined();
    expect(meta.reliquary.recent).toEqual([liveRelic]);
    expect(meta.reliquary.firstFind[liveRelic!]).toEqual({ clears: 5 });
    // The same live grant is a world-sourced obtain, so the tally starts at 1
    // while every seeded (retro) relic stays uncounted: logging in holding a
    // relic is not an acquisition.
    expect(meta.reliquary.counts[liveRelic!]).toBe(1);
    for (const seeded of SEEDED) {
      expect(Object.hasOwn(meta.reliquary.counts, seeded), `${seeded} must stay uncounted`).toBe(
        false,
      );
    }
  });

  it('a join that only holds mount reins keeps its rank-up retro-flagged', () => {
    // Mount reins are not catalogued item relics, so the seed takes the early
    // mount arm (onItemDiscovered -> maybeSyncCuratorRankDeeds), which runs
    // BEFORE retroFallbackGrants and grants first (grantDeed is idempotent).
    // This pins the retro PASS-THROUGH on that arm: drop the opts there and
    // the grant lands unflagged from the earlier call, reddening this test.
    // It does not pin the arm's existence (delete the call and the later
    // retro fallback grants the same bridge, flagged); the live mount test
    // above owns arm liveness. The empty unlock list below proves no
    // catalogued item arm fired on this join.
    const marks = [...RELIQUARY_MARK_IDS].slice(0, CURATOR_RANK_DEFS[1].threshold - 1);
    expect(marks.length).toBe(CURATOR_RANK_DEFS[1].threshold - 1);
    const donor = makeSim();
    const base = donor.serializeCharacter(donor.playerId)!;
    const sim = makeSim();
    sim.drainEvents();
    const pid = sim.addPlayer('warrior', 'Stablehand', {
      state: {
        ...base,
        inventory: [],
        // Reins in the BANK: the seed walks it like any other container.
        bank: {
          inventory: [{ itemId: 'reins_valorsteed', count: 1 }],
          purchasedSlots: 0,
          bonusSlots: 0,
        },
        // Marks arrive already restored, so they plus the one mount sit at the
        // rank-2 threshold the moment the seed reaches the bank.
        reliquary: { marks },
        deedStats: undefined,
      },
    });
    const meta = sim.players.get(pid)!;
    const events = sim.drainEvents().filter((e) => e.pid === pid);

    expect(catalogRankOwned(characterReliquaryOwnership(meta))).toBeGreaterThanOrEqual(
      CURATOR_RANK_DEFS[1].threshold,
    );
    // No catalogued item relic was seeded, so the item arm never synced rank.
    expect(events.filter((e) => e.type === 'reliquaryUnlock')).toEqual([]);
    const bridges = events.filter(
      (e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_rank_2',
    );
    expect(bridges.length).toBe(1);
    expect(bridges[0].type === 'deedUnlocked' && bridges[0].retro).toBe(true);
    // Mount membership stays live-seam only: no invented firstFind entry.
    expect(meta.reliquary.firstFind.reins_valorsteed).toBeUndefined();
  });

  it('a firstFind blob ahead of the ledger stays silent but still syncs rank', () => {
    // The desync a veteran save can carry: the sparse blob already knows these
    // relics, itemsDiscovered does not. The unlock event is the first-find
    // MOMENT, so it must stay silent, while the rank sync keys on the ledger
    // add instead and still credits the threshold this discover just crossed.
    const sim = makeSim();
    const { meta } = primary(sim);
    const threshold = CURATOR_RANK_DEFS[1].threshold;
    const ids = catalogItemIds.slice(0, threshold);
    expect(ids.length).toBe(threshold);
    for (const id of ids) {
      expect(meta.deedStats.itemsDiscovered.has(id), `${id} must start undiscovered`).toBe(false);
      // A sparse entry is the whole desync: the blob knows the relic, the
      // ledger does not. Phase 17 left the entry with no fields at all.
      meta.reliquary.firstFind[id] = {};
    }
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(false);
    sim.drainEvents();

    for (const id of ids) markItemDiscovered(sim.ctx, meta, id);

    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'reliquaryUnlock')).toEqual([]);
    expect(meta.deedsEarned.has('col_reliquary_rank_2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 18: the sticky illuminated-pages record
// ---------------------------------------------------------------------------

/** Item ids of one page, in authored order (item pages only). */
function pageItemIds(pageId: string): string[] {
  const page = RELIQUARY_PAGES_BY_ID[pageId];
  expect(page, pageId).toBeDefined();
  const ids = page.relics.filter((r) => r.kind === 'item').map((r) => r.itemId);
  expect(ids.length, `${pageId} must be an item page`).toBe(page.relics.length);
  return ids;
}

describe('Reliquary illuminated pages (Phase 18 sticky record)', () => {
  it('a pre-Phase-18 blob restores to an empty set and round-trips as a fixed point', () => {
    const saved: SavedReliquaryState = {
      firstFind: { cryptbone_helm: {} },
      marks: ['gather_event:pristine_vein'],
      recent: ['cryptbone_helm'],
    };
    const restored = restoreReliquaryState(saved);
    expect(restored.illuminatedPages.size).toBe(0);
    const serialized = serializeReliquaryState(restored);
    expect(serialized).toBeDefined();
    expect(serialized).not.toHaveProperty('illuminatedPages');
    // Fixed point in BYTES, not just structure: the wire memo's literal pin
    // depends on key insertion order, so the round trip must reproduce the
    // exact string, never a re-keyed equivalent.
    expect(JSON.stringify(serializeReliquaryState(restoreReliquaryState(serialized)))).toBe(
      JSON.stringify(serialized),
    );
  });

  it('a page id that left the catalog is dropped once and the trimmed blob is a new fixed point', () => {
    // Catalog-churn discipline, same as marks and firstFind: restore filters
    // to live page ids, so a retired or renamed page loses its sticky record
    // permanently on the next save. Deliberate and recorded (page ids are
    // append-only by authoring rule); this arm pins that the trim happens
    // exactly once and the result is byte-stable.
    const restored = restoreReliquaryState({
      illuminatedPages: ['conquerors_hollow_crypt', 'retired_page_of_yore'],
    });
    expect([...restored.illuminatedPages]).toEqual(['conquerors_hollow_crypt']);
    const trimmed = serializeReliquaryState(restored);
    expect(trimmed).toEqual({ illuminatedPages: ['conquerors_hollow_crypt'] });
    expect(JSON.stringify(serializeReliquaryState(restoreReliquaryState(trimmed)))).toBe(
      JSON.stringify(trimmed),
    );
  });

  it('an illuminated-only state is non-empty and keeps its record through serialize', () => {
    // The contrast with counts documented on isReliquaryStateEmpty: the set
    // has no carrier entry, so it must count toward non-emptiness or an
    // illuminated-only blob would serialize to undefined and lose the record.
    const state = restoreReliquaryState({ illuminatedPages: ['conquerors_hollow_crypt'] });
    expect(isReliquaryStateEmpty(state)).toBe(false);
    expect(serializeReliquaryState(state)).toEqual({
      illuminatedPages: ['conquerors_hollow_crypt'],
    });
  });

  it('hostile blobs are filtered: non-array, non-string entries, unknown ids, duplicates', () => {
    const nonArray = restoreReliquaryState({
      illuminatedPages: { evil: true } as unknown as string[],
    });
    expect(nonArray.illuminatedPages.size).toBe(0);

    const mixed = restoreReliquaryState({
      illuminatedPages: [
        'conquerors_hollow_crypt',
        42 as unknown as string,
        null as unknown as string,
        'not_a_page',
        // Prototype keys index truthy on a plain object; the hasOwn guard
        // must drop them like any other unknown id.
        '__proto__',
        'constructor',
        // A boxed String NAMES a live page but is not a string: Object.hasOwn
        // coerces its key argument, so only the typeof gate rejects it. This
        // member is what makes that gate decisive (JSON.parse can never
        // produce one; the guard exists for clone-mangled callers).
        new String('conquerors_nythraxis_heroic') as unknown as string,
        'conquerors_hollow_crypt',
        'conquerors_thunzharr',
      ],
    });
    expect([...mixed.illuminatedPages].sort()).toEqual([
      'conquerors_hollow_crypt',
      'conquerors_thunzharr',
    ]);
  });

  it('a re-completion after catalog growth emits NO illuminatedPageId (once-ever)', () => {
    // The catalog-growth shape: the page was illuminated once (the sticky
    // record has it), then content appended a relic, so the live read is
    // incomplete again. Filling the missing relic re-completes the page but
    // must NOT re-celebrate: the event stays silent and the set gains nothing.
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.reliquary = restoreReliquaryState({ illuminatedPages: ['conquerors_thunzharr'] });
    const items = pageItemIds('conquerors_thunzharr');
    for (const id of items.slice(0, -1)) markItemDiscovered(sim.ctx, meta, id);
    sim.drainEvents();
    const last = items[items.length - 1]!;
    markItemDiscovered(sim.ctx, meta, last);
    const unlock = sim.drainEvents().find((e) => e.type === 'reliquaryUnlock' && e.itemId === last);
    expect(unlock).toBeDefined();
    if (!unlock || unlock.type !== 'reliquaryUnlock') throw new Error('expected reliquaryUnlock');
    // The page really is complete now, so silence can only come from the
    // sticky record, not from an incomplete read.
    expect(
      pageCompletion(RELIQUARY_PAGES_BY_ID.conquerors_thunzharr, characterReliquaryOwnership(meta))
        .complete,
    ).toBe(true);
    expect('illuminatedPageId' in unlock).toBe(false);
    expect([...meta.reliquary.illuminatedPages]).toEqual(['conquerors_thunzharr']);
  });

  it('syncIlluminatedPages self-heals a veteran blob once, then no-ops', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Pre-Phase-18 veteran shape: the discovery ledger owns a whole page while
    // the record set is empty (the blob predates the field). Ledger-only
    // writes on purpose: the discovery hub would record the illumination live.
    for (const id of pageItemIds('conquerors_hollow_crypt')) {
      meta.deedStats.itemsDiscovered.add(id);
    }
    expect(meta.reliquary.illuminatedPages.size).toBe(0);
    const before = reliquaryWireJson(meta.reliquary);

    expect(syncIlluminatedPages(meta)).toBe(1);
    expect(meta.reliquary.illuminatedPages.has('conquerors_hollow_crypt')).toBe(true);
    const after = reliquaryWireJson(meta.reliquary);
    expect(after).not.toBe(before);
    expect(JSON.parse(after).illuminatedPages).toEqual(['conquerors_hollow_crypt']);

    // Second sweep: nothing added, NO revision bump: the memoized record is
    // reused by object identity, which only holds if the sweep stayed silent.
    const record = reliquaryWireCacheProbe(meta.reliquary);
    expect(syncIlluminatedPages(meta)).toBe(0);
    expect(reliquaryWireJson(meta.reliquary)).toBe(after);
    expect(reliquaryWireCacheProbe(meta.reliquary)).toBe(record);
  });

  it('the join sweep DOES illuminate a filled retired vault, and cannot illuminate riftbound', () => {
    // Direction pin for the outside-completion flag. The flag removes a page
    // from the completion PAIRS; it does not remove it from illumination, and
    // the difference is deliberate: a veteran who still holds all four retired
    // relics gets the celebration for the page they filled, while their score
    // is untouched. So this asserts the sweep records the vault rather than
    // asserting it stays out.
    const sim = makeSim();
    const { meta } = primary(sim);
    for (const id of pageItemIds('horizons_vault_of_ages')) {
      meta.deedStats.itemsDiscovered.add(id);
    }
    expect(syncIlluminatedPages(meta)).toBeGreaterThanOrEqual(1);
    expect([...meta.reliquary.illuminatedPages]).toContain('horizons_vault_of_ages');

    // The other flagged page runs the SAME direction and lands the other way,
    // for a reason that is content, not policy: a character holds exactly one
    // band, so pageCompletion is 1 of 3 and the page can never complete. No
    // celebration is reachable for it, by construction rather than by a skip.
    const other = makeSim();
    const { meta: bandOwner } = primary(other);
    const bandIds = pageItemIds('horizons_riftbound');
    expect(bandIds.length).toBe(3);
    bandOwner.deedStats.itemsDiscovered.add(bandIds[0]!);
    syncIlluminatedPages(bandOwner);
    expect([...bandOwner.reliquary.illuminatedPages]).not.toContain('horizons_riftbound');
  });

  it('one fill completing two pages records BOTH but the event names only the FIRST', () => {
    // The accepted edge documented on emitReliquaryUnlock: the single-id
    // event shape means a simultaneous double completion celebrates one page
    // while the second is recorded sticky and can never fire later. This pin
    // holds a future refactor to changing that DELIBERATELY in either
    // direction, never by accident.
    const sim = makeSim();
    const { meta } = primary(sim);
    let sharedId: string | undefined;
    let sharedPages: readonly string[] = [];
    for (const [itemId, pages] of RELIQUARY_ITEM_TO_PAGES) {
      if (
        pages.length >= 2 &&
        pages.every((p) => RELIQUARY_PAGES_BY_ID[p]?.shelf === 'conquerors')
      ) {
        sharedId = itemId;
        sharedPages = pages;
        break;
      }
    }
    // Content premise: the set pages share members with dungeon pages.
    if (!sharedId) throw new Error('catalog premise broken: no two-page conquerors relic');
    for (const pageId of sharedPages) {
      for (const id of pageItemIds(pageId)) {
        if (id !== sharedId) markItemDiscovered(sim.ctx, meta, id);
      }
    }
    // Neither candidate page can be complete yet: both still miss sharedId.
    for (const pageId of sharedPages) {
      expect(meta.reliquary.illuminatedPages.has(pageId), pageId).toBe(false);
    }
    sim.drainEvents();
    markItemDiscovered(sim.ctx, meta, sharedId);
    const unlock = sim
      .drainEvents()
      .find((e) => e.type === 'reliquaryUnlock' && e.itemId === sharedId);
    if (!unlock || unlock.type !== 'reliquaryUnlock') throw new Error('expected reliquaryUnlock');
    expect(unlock.illuminatedPageId).toBe(sharedPages[0]);
    for (const pageId of sharedPages) {
      expect(meta.reliquary.illuminatedPages.has(pageId), pageId).toBe(true);
    }
  });

  it('the sticky record survives the REAL character save/load path, silently', () => {
    // Not just the unit serializer: serializeCharacter wraps the blob into
    // CharacterState and addPlayer restores it through the actual join
    // (restore, seed pass, retro grants, join sweep). The anti-repeat must
    // hold across that whole boundary: no join event re-celebrates a page
    // the saved blob already records.
    const donor = makeSim();
    const { meta } = primary(donor);
    for (const id of pageItemIds('conquerors_hollow_crypt')) {
      markItemDiscovered(donor.ctx, meta, id);
    }
    expect(meta.reliquary.illuminatedPages.has('conquerors_hollow_crypt')).toBe(true);
    const saved = donor.serializeCharacter(donor.playerId)!;
    expect(saved.reliquary?.illuminatedPages).toEqual(['conquerors_hollow_crypt']);

    const host = makeSim();
    host.drainEvents();
    const pid = host.addPlayer('warrior', 'Returner', {
      state: JSON.parse(JSON.stringify(saved)) as CharacterState,
    });
    const restored = host.players.get(pid)!;
    expect(restored.reliquary.illuminatedPages.has('conquerors_hollow_crypt')).toBe(true);
    const joinIllums = host
      .drainEvents()
      .filter((e) => e.pid === pid && e.type === 'reliquaryUnlock' && e.illuminatedPageId);
    expect(joinIllums).toEqual([]);
  });

  /** A pre-Phase-18 veteran CharacterState: the discovery ledger owns the
   *  whole flagship page, but the blob predates BOTH Phase 18 surfaces (no
   *  illuminatedPages key, no ladder deed). Built from a real serialize so
   *  the shape can never drift from production, then stripped to the old
   *  save's field set. */
  function prePhase18VeteranState(): CharacterState {
    const donor = makeSim();
    const { meta } = primary(donor);
    for (const id of pageItemIds('conquerors_thunzharr')) {
      markItemDiscovered(donor.ctx, meta, id);
    }
    const saved = JSON.parse(JSON.stringify(donor.serializeCharacter(donor.playerId)!)) as Record<
      string,
      unknown
    >;
    const reliq = saved.reliquary as Record<string, unknown>;
    delete reliq.illuminatedPages;
    const deeds = saved.deeds as Record<string, string>;
    for (const id of RELIQUARY_COMPLETION_DEED_IDS) delete deeds[id];
    return saved as unknown as CharacterState;
  }

  it('the REAL join self-heals a pre-Phase-18 blob: recorded by the sweep, never celebrated', () => {
    // This is the seam pin for the syncIlluminatedPages call inside
    // retroFallbackGrants (src/sim/deeds.ts): every other test drives the
    // sweep directly, so without this arm that call could be deleted green
    // and a veteran's first catalog-growth re-completion would marquee as a
    // FIRST illumination.
    const host = makeSim();
    host.drainEvents();
    const pid = host.addPlayer('warrior', 'Veteran', { state: prePhase18VeteranState() });
    const meta = host.players.get(pid)!;
    expect(meta.reliquary.illuminatedPages.has('conquerors_thunzharr')).toBe(true);
    const joinIllums = host
      .drainEvents()
      .filter((e) => e.pid === pid && e.type === 'reliquaryUnlock' && e.illuminatedPageId);
    expect(joinIllums).toEqual([]);
  });

  it('the REAL join grants ladder credit retroactively, flagged retro', () => {
    // Seam pin for the syncReliquaryCompletionDeeds call inside
    // retroFallbackGrants: a finished collection must not wait for a next
    // fill that may never come, and the join credit must ride the retro flag
    // so the server never fans it out.
    const host = makeSim();
    host.drainEvents();
    const pid = host.addPlayer('warrior', 'Veteran', { state: prePhase18VeteranState() });
    const meta = host.players.get(pid)!;
    expect(meta.deedsEarned.has('col_reliquary_illum_thunzharr')).toBe(true);
    const ev = host
      .drainEvents()
      .find(
        (e) =>
          e.pid === pid &&
          e.type === 'deedUnlocked' &&
          e.deedId === 'col_reliquary_illum_thunzharr',
      );
    expect(ev).toBeDefined();
    if (!ev || ev.type !== 'deedUnlocked') throw new Error('expected deedUnlocked');
    expect(ev.retro).toBe(true);
  });

  it('a candidate page already recorded is skipped: the event names the SECOND page', () => {
    // The mixed arm of the candidate sweep: first candidate sticky, second
    // newly complete. The `continue` on the recorded page must not consume
    // the event's single id slot, or the genuinely new illumination would be
    // silently lost.
    const sim = makeSim();
    const { meta } = primary(sim);
    let sharedId: string | undefined;
    let sharedPages: readonly string[] = [];
    for (const [itemId, pages] of RELIQUARY_ITEM_TO_PAGES) {
      if (
        pages.length >= 2 &&
        pages.every((p) => RELIQUARY_PAGES_BY_ID[p]?.shelf === 'conquerors')
      ) {
        sharedId = itemId;
        sharedPages = pages;
        break;
      }
    }
    if (!sharedId) throw new Error('catalog premise broken: no two-page conquerors relic');
    meta.reliquary = restoreReliquaryState({ illuminatedPages: [sharedPages[0]!] });
    for (const pageId of sharedPages) {
      for (const id of pageItemIds(pageId)) {
        if (id !== sharedId) markItemDiscovered(sim.ctx, meta, id);
      }
    }
    sim.drainEvents();
    markItemDiscovered(sim.ctx, meta, sharedId);
    const unlock = sim
      .drainEvents()
      .find((e) => e.type === 'reliquaryUnlock' && e.itemId === sharedId);
    if (!unlock || unlock.type !== 'reliquaryUnlock') throw new Error('expected reliquaryUnlock');
    expect(unlock.illuminatedPageId).toBe(sharedPages[1]);
    for (const pageId of sharedPages) {
      expect(meta.reliquary.illuminatedPages.has(pageId), pageId).toBe(true);
    }
  });

  it('a corrupt marks value drops whole instead of throwing (character-sheet reach)', () => {
    // restoreReliquaryState also runs on stored blobs from the public
    // character-sheet path, so every surface must tolerate a corrupt value.
    // marks gained its Array.isArray guard at the Phase 18 QA; this arm is
    // what makes the guard decisive.
    const state = restoreReliquaryState({ marks: 5 as unknown as string[] });
    expect(state.marks.size).toBe(0);
    expect(isReliquaryStateEmpty(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 18: the completion-ladder deeds
// ---------------------------------------------------------------------------

describe('Reliquary completion ladder deeds (Phase 18)', () => {
  const FLAGSHIPS: ReadonlyArray<readonly [string, string]> = [
    ['col_reliquary_illum_nythraxis_heroic', 'conquerors_nythraxis_heroic'],
    ['col_reliquary_illum_thunzharr', 'conquerors_thunzharr'],
    ['col_reliquary_illum_gravewyrm_heroic', 'conquerors_gravewyrm_sanctum_heroic'],
  ] as const;
  // The grant-check ORDER is load-bearing (illuminations, then the shelf,
  // then the catalog: each check may read a title the same pass just
  // granted), so pin the full literal before deriving the positional slice:
  // a reorder must red HERE, never silently retarget the slice below.
  it('RELIQUARY_COMPLETION_DEED_IDS keeps its load-bearing grant-check order', () => {
    expect([...RELIQUARY_COMPLETION_DEED_IDS]).toEqual([
      'col_reliquary_illum_nythraxis_heroic',
      'col_reliquary_illum_thunzharr',
      'col_reliquary_illum_gravewyrm_heroic',
      'col_reliquary_conquerors',
      'col_reliquary_complete',
    ]);
  });
  const ILLUMINATION_IDS = RELIQUARY_COMPLETION_DEED_IDS.slice(0, 3);
  const LADDER_IDS = new Set<string>(RELIQUARY_COMPLETION_DEED_IDS);

  it('the ladder id list and the pairing table stay in dispatch lockstep', () => {
    // DATA-side totality only: the sync dispatches on
    // RELIQUARY_ILLUMINATION_DEED_PAGES membership, then the two named
    // branches, then a fail-closed continue, and this pin holds the two
    // constants to that shape. Both drift directions red here: a pairing key
    // outside the id list would never be checked (its deed could never
    // grant), and an id with no pairing and no named branch would silently
    // fall to the continue. The BRANCHES themselves are pinned behaviorally
    // by the ladder grant tests below, not by this data check.
    const ids: readonly string[] = RELIQUARY_COMPLETION_DEED_IDS;
    const pageKeys = Object.keys(RELIQUARY_ILLUMINATION_DEED_PAGES).sort();
    expect(pageKeys).toEqual([...ids.slice(0, 3)].sort());
    const armed = new Set([...pageKeys, 'col_reliquary_conquerors', 'col_reliquary_complete']);
    expect(ids.filter((id) => !armed.has(id))).toEqual([]);
  });

  /** Every character-durable slot the catalog carries, split by surface. */
  const CATALOG_SLOTS = (() => {
    const itemIds = new Set<string>();
    const mountIds = new Set<string>();
    const titleIds = new Set<string>();
    for (const page of RELIQUARY_PAGES) {
      for (const relic of page.relics) {
        if (relic.kind === 'item') itemIds.add(relic.itemId);
        else if (relic.kind === 'mount') mountIds.add(relic.mountId);
        else if (relic.kind === 'title') titleIds.add(relic.deedId);
      }
    }
    return { itemIds: [...itemIds], mountIds: [...mountIds], titleIds: [...titleIds] };
  })();

  /**
   * Fill every character-durable catalog slot through the REAL grant paths
   * (the discovery hub, the mark writer, reins into bags, grantDeed), except
   * the slots named in `skip`. The four on-page ladder titles are never
   * granted directly: the sync under test is their only legitimate writer, so
   * the rig earning them by hand would vacuous-green every assertion below.
   * masterwork:engineering is granted directly like every other mark: its
   * live write site is pended (13b QA owner ruling), and direct mark grants
   * are the sanctioned test route to owned === total.
   */
  function grantWholeCharacterCatalog(sim: Sim, skip: ReadonlySet<string> = new Set()): void {
    const { meta } = primary(sim);
    for (const itemId of CATALOG_SLOTS.itemIds) {
      if (skip.has(itemId)) continue;
      markItemDiscovered(sim.ctx, meta, itemId);
    }
    for (const markId of RELIQUARY_MARK_IDS) {
      if (skip.has(markId)) continue;
      expect(noteReliquaryMark(sim.ctx, meta, markId)).toBe(true);
    }
    for (const mountId of CATALOG_SLOTS.mountIds) {
      if (skip.has(mountId)) continue;
      const reins = mountItemId(mountId);
      expect(reins, mountId).toBeTruthy();
      sim.addItem(reins!, 1, sim.playerId);
    }
    for (const deedId of CATALOG_SLOTS.titleIds) {
      if (skip.has(deedId) || LADDER_IDS.has(deedId)) continue;
      grantDeed(sim.ctx, meta, deedId);
    }
  }

  it('the ladder completes on the last item fill: conquerors, then complete, one pass', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    grantWholeCharacterCatalog(sim, new Set([CATALOGUE_RELIC]));

    // At total-1: the three Illumination deeds landed mid-rig (their flagship
    // pages completed under the item pass), while the shelf and catalog deeds
    // wait on the one missing Hollow Crypt relic.
    for (const id of ILLUMINATION_IDS) {
      expect(meta.deedsEarned.has(id), id).toBe(true);
    }
    expect(meta.deedsEarned.has('col_reliquary_conquerors')).toBe(false);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(false);
    const pair = catalogCharacterCompletion(characterReliquaryOwnership(meta));
    // The missing relic plus the unearned shelf title (itself a page slot).
    expect(pair.total - pair.owned).toBe(2);

    sim.drainEvents();
    const renownBefore = meta.renown;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);

    // Both land in the SAME pass, shelf before catalog: the ownership
    // snapshot's live deedsEarned lets the conquerors title count toward the
    // catalog read later in the pass, which is exactly the pinned order.
    const deedIds = sim
      .drainEvents()
      .filter((e) => e.type === 'deedUnlocked')
      .map((e) => (e as { deedId: string }).deedId);
    const conqIdx = deedIds.indexOf('col_reliquary_conquerors');
    const compIdx = deedIds.indexOf('col_reliquary_complete');
    expect(conqIdx).toBeGreaterThanOrEqual(0);
    expect(compIdx).toBeGreaterThanOrEqual(0);
    expect(conqIdx).toBeLessThan(compIdx);
    expect(meta.deedsEarned.has('col_reliquary_conquerors')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(true);
    // Zero-Renown ladder: the whole two-deed pass moves no Renown.
    expect(meta.renown).toBe(renownBefore);
    const after = catalogCharacterCompletion(characterReliquaryOwnership(meta));
    expect(after.owned).toBe(after.total);
  });

  it('a MARK as the last missing relic completes the catalog (noteReliquaryMark path)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const lastMark = 'gather_event:perfect_specimen';
    expect(RELIQUARY_MARK_IDS.has(lastMark)).toBe(true);
    grantWholeCharacterCatalog(sim, new Set([lastMark]));
    // All items landed, so the shelf deed is already earned; only the mark
    // (and with it the catalog deed) is missing.
    expect(meta.deedsEarned.has('col_reliquary_conquerors')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(false);

    sim.drainEvents();
    expect(noteReliquaryMark(sim.ctx, meta, lastMark)).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(true);
    const ev = sim
      .drainEvents()
      .find((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_complete');
    expect(ev).toBeDefined();
    if (!ev || ev.type !== 'deedUnlocked') throw new Error('expected deedUnlocked');
    expect('retro' in ev).toBe(false);
  });

  it('a MOUNT reins as the last missing relic completes the catalog (the reins discover arm)', () => {
    // The fourth fill order: the mount arm of onItemDiscovered is the only
    // caller of the ladder sync on a reins pickup, so without this arm that
    // call could be deleted green and a mount-last capstone would slip to the
    // next join, silent.
    const sim = makeSim();
    const { meta } = primary(sim);
    const lastMount = CATALOG_SLOTS.mountIds[0]!;
    grantWholeCharacterCatalog(sim, new Set([lastMount]));
    // Every item landed, so the shelf deed is already earned; only the reins
    // (and with it the catalog deed) is missing.
    expect(meta.deedsEarned.has('col_reliquary_conquerors')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(false);

    sim.drainEvents();
    const reins = mountItemId(lastMount);
    expect(reins, lastMount).toBeTruthy();
    sim.addItem(reins!, 1, sim.playerId);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(true);
    const ev = sim
      .drainEvents()
      .find((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_complete');
    expect(ev).toBeDefined();
    if (!ev || ev.type !== 'deedUnlocked') throw new Error('expected deedUnlocked');
    expect('retro' in ev).toBe(false);
  });

  it('a TITLE deed granted anywhere completes the catalog (the grantDeed hook path)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const lastTitle = 'pvp_honor_field_marshal';
    grantWholeCharacterCatalog(sim, new Set([lastTitle]));
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(false);

    sim.drainEvents();
    // The pvp ladder title is the last missing relic; its own grant site is
    // nowhere near the Reliquary, so only the grantDeed title hook can carry
    // the catalog completion here.
    expect(grantDeed(sim.ctx, meta, lastTitle)).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(true);
    const ev = sim
      .drainEvents()
      .find((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_complete');
    expect(ev).toBeDefined();
  });

  it('the capstone ignores BOTH flagged pages: a reachable holding still completes', () => {
    // The Vault of Ages slots are excludeFromCompletion, so a character who
    // owns every countable slot but NONE of the four retired ids must earn
    // col_reliquary_complete: the retired page can never dead-end the
    // capstone (rule 7, the reason the flag exists). The riftbound bands are
    // skipped too, ALL BUT ONE: a real character holds exactly their own
    // class's band, so granting all three would prove the deed on an
    // ownership state no character can reach and hide a personal-page
    // dead-end (the Phase 21 QA coverage catch). The whole-catalog check
    // routes through catalogCharacterCompletion, whose scoring set skips
    // both flagged pages on both sides.
    const vault = RELIQUARY_PAGES_BY_ID.horizons_vault_of_ages;
    const vaultIds = vault.relics.flatMap((r) => (r.kind === 'item' ? [r.itemId] : []));
    expect(vaultIds.length).toBe(4);
    const riftbound = RELIQUARY_PAGES_BY_ID.horizons_riftbound;
    const bandIds = riftbound.relics.flatMap((r) => (r.kind === 'item' ? [r.itemId] : []));
    expect(bandIds.length).toBe(3);
    const sim = makeSim();
    const { meta } = primary(sim);
    grantWholeCharacterCatalog(sim, new Set([...vaultIds, ...bandIds.slice(1)]));
    for (const id of [...vaultIds, ...bandIds.slice(1)]) {
      expect(meta.deedStats.itemsDiscovered.has(id), id).toBe(false);
    }
    expect(meta.deedStats.itemsDiscovered.has(bandIds[0]!)).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_conquerors')).toBe(true);
    expect(meta.deedsEarned.has('col_reliquary_complete')).toBe(true);
    const pair = catalogCharacterCompletion(characterReliquaryOwnership(meta));
    expect(pair.owned).toBe(pair.total);
  });

  it('each Illumination deed grants on the live fill that completes its flagship page', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (const [deedId, pageId] of FLAGSHIPS) {
      const items = pageItemIds(pageId);
      for (const itemId of items.slice(0, -1)) {
        markItemDiscovered(sim.ctx, meta, itemId);
      }
      expect(meta.deedsEarned.has(deedId), `${deedId} must wait for the last fill`).toBe(false);
      sim.drainEvents();
      markItemDiscovered(sim.ctx, meta, items[items.length - 1]!);
      expect(meta.deedsEarned.has(deedId), deedId).toBe(true);
      const ev = sim.drainEvents().find((e) => e.type === 'deedUnlocked' && e.deedId === deedId);
      expect(ev, deedId).toBeDefined();
      if (!ev || ev.type !== 'deedUnlocked') throw new Error('expected deedUnlocked');
      // A live grant carries NO retro flag (the event key is omitted, not false).
      expect('retro' in ev).toBe(false);
    }
  });

  it('the retro path grants with retro:true on the deedUnlocked event (silent join credit)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // The pre-ladder veteran shape retroFallbackGrants sees at join: the
    // discovery ledger already owns the flagship page, nothing earned yet.
    for (const id of pageItemIds('conquerors_thunzharr')) {
      meta.deedStats.itemsDiscovered.add(id);
    }
    expect(meta.deedsEarned.has('col_reliquary_illum_thunzharr')).toBe(false);
    sim.drainEvents();
    syncReliquaryCompletionDeeds(sim.ctx, meta, { retro: true });
    expect(meta.deedsEarned.has('col_reliquary_illum_thunzharr')).toBe(true);
    const ev = sim
      .drainEvents()
      .find((e) => e.type === 'deedUnlocked' && e.deedId === 'col_reliquary_illum_thunzharr');
    expect(ev).toBeDefined();
    if (!ev || ev.type !== 'deedUnlocked') throw new Error('expected deedUnlocked');
    expect(ev.retro).toBe(true);
  });

  it('the ladder sync and the join sweep draw nothing from Rng (determinism)', () => {
    // Zero-draw pin through the real seam: an observer on the live Rng counts
    // every draw, so the same-seed world digest cannot fork on the sync path.
    const sim = makeSim();
    const { meta } = primary(sim);
    const items = pageItemIds('conquerors_thunzharr');
    for (const id of items.slice(0, -1)) markItemDiscovered(sim.ctx, meta, id);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    markItemDiscovered(sim.ctx, meta, items[items.length - 1]!);
    syncReliquaryCompletionDeeds(sim.ctx, meta);
    syncIlluminatedPages(meta);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(meta.deedsEarned.has('col_reliquary_illum_thunzharr')).toBe(true);
  });
});

describe('reliquaryRarity (offline facet arm)', () => {
  it('always resolves null: a sandbox has no population to aggregate', async () => {
    // The deedsRarity stub doctrine: deterministic, no fetch, no clock, and
    // null is the value the window's omission arm keys on, so the offline
    // Reliquary renders zero rarity nodes rather than fabricated zeros.
    const sim = makeSim();
    await expect(sim.reliquaryRarity()).resolves.toBeNull();
  });
});
