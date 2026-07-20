// Professions 2.0 Phase 11: fishing as a full gathering proficiency, the
// catch rarity band ladder, the one-draw rng contract, the text-free
// fishingResult SimEvent, the live-server round trip (gprof mirror + event
// routing), and the deliberately accepted gathering-deed drift. This file is
// the primary Phase 11 home; the shipped fishing cast lifecycle itself stays
// pinned in tests/sim.test.ts.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only live GameServer routing and
// snapshot encoding are under test in the online suite below (the 2033 stub
// trap: an event type must be proven to flow server to client, not just
// emitted into the sim's buffer).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { bagCapacity } from '../src/sim/bags';
import { FISHING_TABLES, FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { DEEPFEN_SHALLOWS_LAKE, LAKE } from '../src/sim/data';
import {
  completeFishing,
  FISHING_BAND_THRESHOLDS,
  fishingBandFor,
  startFishing,
} from '../src/sim/professions/fishing';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(seed = 4242): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

const TROUT = 'raw_mirror_trout';
const PERCH = 'raw_river_perch';
const WEED = 'tangled_weed';
const KOI = 'glimmerfin_koi';
const VALE_CATCH_IDS = [TROUT, PERCH, WEED, KOI];

// The fishingResult contract shape, declared locally so this suite compiles
// and stays decisive independent of the SimEvent union member landing.
interface FishingResultEvent {
  type: 'fishingResult';
  pid: number;
  itemId: string;
  quality: string;
}

function fishingResultsIn(events: readonly SimEvent[]): FishingResultEvent[] {
  return events.filter(
    (e) => (e as { type: string }).type === 'fishingResult',
  ) as unknown as FishingResultEvent[];
}

// One direct completeFishing call at the current position, resolving which
// Vale catch (or null for an empty hook) it produced via the inventory diff,
// plus the events that exact call emitted.
function castOnce(sim: Sim, meta: PlayerMeta): { caught: string | null; events: SimEvent[] } {
  const before = new Map(VALE_CATCH_IDS.map((id) => [id, sim.countItem(id)]));
  const evStart = sim.events.length;
  completeFishing(sim.ctx, sim.player, meta);
  const events = sim.events.slice(evStart);
  let caught: string | null = null;
  for (const id of VALE_CATCH_IDS) {
    if (sim.countItem(id) > (before.get(id) ?? 0)) caught = id;
  }
  return { caught, events };
}

function catchSequence(sim: Sim, meta: PlayerMeta, n: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) out.push(castOnce(sim, meta).caught);
  return out;
}

// The literal band-0 catch sequence at seed 4242, hand-computed from the
// SHIPPED Vale rows (trout 45 / perch 30 / weed 12 / koi 3 / null 10) walked
// against the raw rng stream of a fresh Sim at that seed. Any accidental
// extra draw, band-boundary change, or band-0 table drift breaks this pin.
const B0_SEQ_4242: (string | null)[] = [
  PERCH,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  null,
  PERCH,
  TROUT,
  TROUT,
  PERCH,
  KOI,
  WEED,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  WEED,
  TROUT,
];

// The literal band-1 sequence for the SAME seed with fishing proficiency 150,
// hand-computed from the band-1 Vale weights (trout 48 / perch 33 / weed 8 /
// koi 3 / null 8). It diverges from B0_SEQ_4242 at index 1 (trout, not
// perch), so matching it proves the live path actually switched tables.
const B1_SEQ_4242: (string | null)[] = [
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
];

// The literal band-2 sequence for the SAME seed with fishing proficiency 200,
// hand-computed from the band-2 Vale weights (trout 51 / perch 36 / weed 4 /
// koi 3 / null 6) against the same raw rng stream. It diverges from the
// band-0 walk at index 1 and, decisively, from the BAND-1 walk at index 16:
// that draw lands in the 92-to-94 window where band 2 yields the koi but
// band 1 yields an empty hook, so matching this sequence proves the live
// path resolved FISHING_TABLES_BY_BAND[2], not a band-1 collapse (Phase 11
// QA: the top-band wiring was previously unpinned on the live path).
const B2_SEQ_4242: (string | null)[] = [
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  KOI,
  PERCH,
];

function codfatherSim(): { sim: Sim; meta: PlayerMeta } {
  const sim = makeSim();
  const meta = sim.meta(sim.playerId)!;
  meta.questLog.set('q_the_codfather', {
    questId: 'q_the_codfather',
    counts: [0],
    state: 'active',
  });
  teleportTo(sim, DEEPFEN_SHALLOWS_LAKE.x, DEEPFEN_SHALLOWS_LAKE.z);
  return { sim, meta };
}

describe('fishing determinism (pin 1)', () => {
  it('two fresh Sims with the same seed produce the identical 30-catch sequence', () => {
    const simA = makeSim(777);
    const simB = makeSim(777);
    const seqA = catchSequence(simA, simA.meta(simA.playerId)!, 30);
    const seqB = catchSequence(simB, simB.meta(simB.playerId)!, 30);
    expect(seqA).toEqual(seqB);
    expect(seqA).toHaveLength(30);
    // Non-degenerate: the pinned run actually lands catches.
    expect(seqA.some((c) => c !== null)).toBe(true);
  });

  it('band 0 reproduces the shipped Vale table: literal catch sequence at seed 4242', () => {
    const sim = makeSim(4242);
    expect(catchSequence(sim, sim.meta(sim.playerId)!, 30)).toEqual(B0_SEQ_4242);
  });
});

describe('fishing one-draw rng contract (pin 2)', () => {
  it('draws exactly one rng value per normal cast, including the no-bite outcome', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const outcomes: (string | null)[] = [];
    try {
      for (let i = 0; i < 30; i++) {
        const before = draws;
        outcomes.push(castOnce(sim, meta).caught);
        expect(draws - before).toBe(1);
      }
    } finally {
      sim.rng.setObserver(null);
    }
    // Both branches were actually exercised under the counter.
    expect(outcomes).toContain(null);
    expect(outcomes.some((c) => c !== null)).toBe(true);
  });

  it('bags full: the roll still draws, nothing lands, no grant, no fishingResult', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // Fill every slot with an unstackable tool so no catch can land.
    meta.inventory = Array.from({ length: bagCapacity(meta.bags) }, () => ({
      itemId: 'simple_fishing_pole',
      count: 1,
    }));
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      completeFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // The capacity gate sits AFTER the roll, so the draw still happened; at
    // seed 4242 this draw resolves a perch when there is room (B0_SEQ_4242[0]).
    expect(draws).toBe(1);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Your bags are full.' }),
    );
    expect(sim.countItem(PERCH)).toBe(0);
    expect(fishingResultsIn(sim.events)).toHaveLength(0);
    expect(meta.pendingGatherGrants).toHaveLength(0);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(0);
  });

  it('codfather branch: zero draws, the quest fish force-lands, no grant, no fishingResult', () => {
    const { sim, meta } = codfatherSim();
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      completeFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(sim.countItem('the_codfather')).toBe(1);
    expect(fishingResultsIn(sim.events)).toHaveLength(0);
    expect(meta.pendingGatherGrants).toHaveLength(0);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(0);
  });

  it('codfather force-lands even with full bags (over-capacity tolerated, the soft-lock defense)', () => {
    // The codfather branch deliberately skips the capacity gate: losing the
    // once-ever quest fish to full bags could soft-lock the quest chain. A
    // well-meaning "consistency" change adding a canAddItem gate here would
    // keep every other pin green while recreating the soft-lock; this pin is
    // the tooth.
    const { sim, meta } = codfatherSim();
    meta.inventory = Array.from({ length: bagCapacity(meta.bags) }, () => ({
      itemId: 'simple_fishing_pole',
      count: 1,
    }));
    sim.events = [];
    completeFishing(sim.ctx, sim.player, meta);
    expect(sim.countItem('the_codfather')).toBe(1);
    expect(sim.events.filter((e) => (e as { type: string }).type === 'error')).toHaveLength(0);
  });
});

describe('fishing proficiency accrual (pin 3)', () => {
  it('accrues +1 per landed catch (fish AND junk), 0 on no-bite, through the tick drain', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    let landed = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const before = meta.pendingGatherGrants.length;
      const { caught } = castOnce(sim, meta);
      if (caught === null) {
        expect(meta.pendingGatherGrants).toHaveLength(before);
      } else {
        landed++;
        kinds.add(caught);
        expect(meta.pendingGatherGrants).toHaveLength(before + 1);
        expect(meta.pendingGatherGrants[meta.pendingGatherGrants.length - 1]).toEqual({
          professionId: 'fishing',
          amount: 1,
        });
      }
    }
    // Junk accrues exactly like fish: the seed 4242 run lands tangled_weed.
    expect(kinds.has(WEED)).toBe(true);
    expect(landed).toBeGreaterThan(0);
    // Grants ride the gathering queue: nothing lands before the tick drain.
    expect(meta.gatheringProficiency.fishing).toBe(0);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(landed);
    // The accrual surfaces through both IWorld gathering projections.
    expect(sim.gatheringProficiencyFor(sim.playerId).fishing).toBe(landed);
    expect(sim.professionsStateFor(sim.playerId).skills).toContainEqual({
      professionId: 'fishing',
      skill: landed,
      maxSkill: 300,
    });
  });
});

describe('fishing band function (pin 4)', () => {
  it('FISHING_BAND_THRESHOLDS are literally [0, 100, 200]', () => {
    expect([...FISHING_BAND_THRESHOLDS]).toEqual([0, 100, 200]);
  });

  it('fishingBandFor maps the boundaries exactly and NaN falls to band 0', () => {
    expect(fishingBandFor(0)).toBe(0);
    expect(fishingBandFor(99)).toBe(0);
    expect(fishingBandFor(100)).toBe(1);
    expect(fishingBandFor(199)).toBe(1);
    expect(fishingBandFor(200)).toBe(2);
    expect(fishingBandFor(300)).toBe(2);
    expect(fishingBandFor(Number.NaN)).toBe(0);
    // A negative proficiency (malformed input) also falls to band 0.
    expect(fishingBandFor(-5)).toBe(0);
  });
});

// Literal shipped band-0 rows (order included). NEVER derive these from the
// content table: the whole point is to red-flag drift in the source.
const SHIPPED_B0_ROWS: Record<string, { itemId: string | null; weight: number }[]> = {
  eastbrook_vale: [
    { itemId: TROUT, weight: 45 },
    { itemId: PERCH, weight: 30 },
    { itemId: WEED, weight: 12 },
    { itemId: KOI, weight: 3 },
    { itemId: null, weight: 10 },
  ],
  mirefen_marsh: [
    { itemId: 'raw_marsh_pike', weight: 40 },
    { itemId: 'raw_bog_eel', weight: 30 },
    { itemId: 'soggy_boot', weight: 8 },
    { itemId: WEED, weight: 9 },
    { itemId: KOI, weight: 3 },
    { itemId: null, weight: 10 },
  ],
  thornpeak_heights: [
    { itemId: 'raw_frostgill_trout', weight: 40 },
    { itemId: 'raw_stonescale_carp', weight: 30 },
    { itemId: WEED, weight: 14 },
    { itemId: KOI, weight: 4 },
    { itemId: null, weight: 12 },
  ],
};

const ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'];
const FOOD_FISH: Record<string, string[]> = {
  eastbrook_vale: [TROUT, PERCH],
  mirefen_marsh: ['raw_marsh_pike', 'raw_bog_eel'],
  thornpeak_heights: ['raw_frostgill_trout', 'raw_stonescale_carp'],
};
const JUNK_ROWS: Record<string, string[]> = {
  eastbrook_vale: [WEED],
  mirefen_marsh: ['soggy_boot', WEED],
  thornpeak_heights: [WEED],
};
const KOI_WEIGHT: Record<string, number> = {
  eastbrook_vale: 3,
  mirefen_marsh: 3,
  thornpeak_heights: 4,
};

function weightOf(band: number, zoneId: string, itemId: string | null): number {
  const row = FISHING_TABLES_BY_BAND[band][zoneId].find((r) => r.itemId === itemId);
  expect(row, `missing ${zoneId} band ${band} row for ${itemId ?? 'null'}`).toBeDefined();
  return row?.weight ?? Number.NaN;
}

describe('fishing table structure (pin 5)', () => {
  it('band 0 rows for all three zones literally equal the shipped rows, in order', () => {
    expect(FISHING_TABLES_BY_BAND).toHaveLength(3);
    for (const zoneId of ZONE_IDS) {
      expect(FISHING_TABLES_BY_BAND[0][zoneId]).toEqual(SHIPPED_B0_ROWS[zoneId]);
    }
  });

  it('every band of every zone sums to exactly 100 and keeps the null row at weight 1 or more', () => {
    for (let band = 0; band < 3; band++) {
      expect(Object.keys(FISHING_TABLES_BY_BAND[band]).sort()).toEqual([...ZONE_IDS].sort());
      for (const zoneId of ZONE_IDS) {
        const rows = FISHING_TABLES_BY_BAND[band][zoneId];
        const total = rows.reduce((sum, r) => sum + r.weight, 0);
        expect(total, `${zoneId} band ${band} weight total`).toBe(100);
        expect(weightOf(band, zoneId, null)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('glimmerfin_koi weight never scales with skill: literally 3/3/4 per zone in every band', () => {
    for (let band = 0; band < 3; band++) {
      for (const zoneId of ZONE_IDS) {
        expect(weightOf(band, zoneId, KOI), `${zoneId} band ${band} koi`).toBe(KOI_WEIGHT[zoneId]);
      }
    }
  });

  it('band steps are monotonic: food fish never lose weight, junk and empty hooks never gain', () => {
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 2; band++) {
        for (const id of FOOD_FISH[zoneId]) {
          expect(
            weightOf(band + 1, zoneId, id),
            `${zoneId} ${id} band ${band} to ${band + 1}`,
          ).toBeGreaterThanOrEqual(weightOf(band, zoneId, id));
        }
        for (const id of JUNK_ROWS[zoneId]) {
          expect(
            weightOf(band + 1, zoneId, id),
            `${zoneId} ${id} band ${band} to ${band + 1}`,
          ).toBeLessThanOrEqual(weightOf(band, zoneId, id));
        }
        expect(
          weightOf(band + 1, zoneId, null),
          `${zoneId} empty hook band ${band} to ${band + 1}`,
        ).toBeLessThanOrEqual(weightOf(band, zoneId, null));
      }
    }
  });

  it('FISHING_TABLES is the identical band-0 object (alias identity, not a copy)', () => {
    expect(FISHING_TABLES).toBe(FISHING_TABLES_BY_BAND[0]);
  });

  it('no band introduces an item id outside the shipped band-0 set (zero new items)', () => {
    for (const zoneId of ZONE_IDS) {
      const shipped = new Set(SHIPPED_B0_ROWS[zoneId].map((r) => r.itemId));
      for (let band = 0; band < 3; band++) {
        for (const row of FISHING_TABLES_BY_BAND[band][zoneId]) {
          expect(shipped.has(row.itemId), `${zoneId} band ${band} id ${row.itemId}`).toBe(true);
        }
      }
    }
  });
});

describe('fishing band selection liveness (pin 6)', () => {
  it('proficiency 150 resolves the band-1 Vale table: literal sequence at seed 4242', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 150;
    // B1_SEQ_4242 diverges from B0_SEQ_4242 at index 1 for the same rng
    // stream, so this match proves the live path actually switched tables.
    expect(catchSequence(sim, meta, 12)).toEqual(B1_SEQ_4242);
  });

  it('proficiency 200 resolves the band-2 Vale table: literal sequence at seed 4242', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 200;
    // The koi at index 16 sits where the band-1 table yields an empty hook
    // (see the B2_SEQ_4242 derivation comment), so this match proves the
    // live path resolved the TOP band, not a band-1 collapse.
    expect(catchSequence(sim, meta, 18)).toEqual(B2_SEQ_4242);
  });
});

describe('fishingResult event (pin 7)', () => {
  it('a landed catch emits the text-free fishingResult alongside the item grant', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    sim.events = [];
    const { caught, events } = castOnce(sim, meta);
    expect(caught).toBe(PERCH); // B0_SEQ_4242[0]
    const results = fishingResultsIn(events);
    expect(results).toHaveLength(1);
    // Exact shape: ids plus values only (the gatherResult precedent), so a
    // text field sneaking in breaks this pin.
    expect(results[0]).toEqual({
      type: 'fishingResult',
      pid: sim.playerId,
      itemId: PERCH,
      quality: 'common',
    });
    // The loot grant still happens alongside the event.
    expect(sim.countItem(PERCH)).toBe(1);
  });

  it('quality mirrors the caught ItemDef (poor for weed, uncommon for koi); silent on no-bite', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    let weedEvent: FishingResultEvent | undefined;
    let koiEvent: FishingResultEvent | undefined;
    let sawNoBite = false;
    for (let i = 0; i < 30; i++) {
      const { caught, events } = castOnce(sim, meta);
      const results = fishingResultsIn(events);
      if (caught === null) {
        sawNoBite = true;
        expect(results).toHaveLength(0);
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'log', text: 'No fish are biting.' }),
        );
      } else {
        expect(results).toHaveLength(1);
        expect(results[0].itemId).toBe(caught);
        if (caught === WEED) weedEvent = results[0];
        if (caught === KOI) koiEvent = results[0];
      }
    }
    // The seed 4242 run covers all three arms (see B0_SEQ_4242).
    expect(sawNoBite).toBe(true);
    expect(weedEvent?.quality).toBe('poor');
    expect(koiEvent?.quality).toBe('uncommon');
  });
});

describe('fishing deeds through the extracted module path (pin 9)', () => {
  it('a landed real fish via completeFishing still marks fish:<zone>', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    expect(meta.deedStats.visited.has('fish:eastbrook_vale')).toBe(false);
    const { caught } = castOnce(sim, meta);
    expect(caught).toBe(PERCH); // a real fish, so the ZONE_FISH filter passes
    expect(meta.deedStats.visited.has('fish:eastbrook_vale')).toBe(true);
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('chr_vale_first_cast')).toBe(true);
  });

  it('ACCEPTED DRIFT (documented Phase 11 semantic): a first landed catch completes prog_first_harvest', () => {
    // prog_first_harvest ("Harvest your first gathering node", trigger
    // gathering amount 1) is now also satisfied by a first landed fishing
    // catch, without ever touching a world node: fishing is a full gathering
    // proficiency, and the deed trigger counts any profession at 1 or more.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_first_harvest')).toBe(false);
    const { caught } = castOnce(sim, meta);
    expect(caught).not.toBeNull();
    sim.tick(); // drain the grant
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_first_harvest')).toBe(true);
  });

  it('ACCEPTED DRIFT (documented Phase 11 semantic): prog_master_gatherer counts fishing', () => {
    // The three-at-100 trigger counts EVERY gathering profession, so
    // mining + logging + fishing at 100 completes it without herbalism.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.mining = 100;
    meta.gatheringProficiency.logging = 100;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_master_gatherer')).toBe(false); // two of three
    meta.gatheringProficiency.fishing = 100; // herbalism stays 0
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_master_gatherer')).toBe(true);
  });

  it('a fished glimmerfin koi logs the rare-catch line and completes col_glimmerfin', () => {
    // Acceptance criterion 3: the rare catch and its deed complete unchanged
    // through the extracted module path. col_glimmerfin is a collectItems
    // trigger riding the addItem collection path, so a real completeFishing
    // koi (B0_SEQ_4242 index 21) must credit it end to end.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    let koiAt = -1;
    for (let i = 0; i < 22; i++) {
      if (castOnce(sim, meta).caught === KOI) koiAt = i;
    }
    expect(koiAt).toBe(21);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: 'A rare catch! Something gleams on your line.',
      }),
    );
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(true);
  });
});

describe('startFishing arms through the extracted module path (pin 10)', () => {
  it('all five deny arms refuse with the exact error and never start the cast', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    const denyCase = (mutate: () => void, restore: () => void, text: string) => {
      mutate();
      sim.events = [];
      startFishing(sim.ctx, sim.player, meta);
      expect(sim.events).toContainEqual(expect.objectContaining({ type: 'error', text }));
      // No cast ever starts on a deny (the busy arm's precondition is itself
      // a live castingAbility, so the tooth is the absent castStart event).
      expect(sim.events.some((e) => (e as { type: string }).type === 'castStart')).toBe(false);
      restore();
    };
    denyCase(
      () => {
        sim.player.dead = true;
      },
      () => {
        sim.player.dead = false;
      },
      "You can't do that while dead.",
    );
    denyCase(
      () => {
        sim.player.inCombat = true;
      },
      () => {
        sim.player.inCombat = false;
      },
      "You can't do that while in combat.",
    );
    // Swimming: the vale lake center puts the player in deep water.
    const dry = { ...sim.player.pos };
    denyCase(
      () => {
        teleportTo(sim, LAKE.x, LAKE.z);
      },
      () => {
        sim.player.pos = { ...dry };
        sim.player.prevPos = { ...dry };
      },
      "You can't do that while swimming.",
    );
    denyCase(
      () => {
        sim.player.castingAbility = 'fishing';
      },
      () => {
        sim.player.castingAbility = null;
      },
      'You are busy.',
    );
    // No fishable water: the spawn plaza facing due south is dry land for
    // every sample distance.
    denyCase(
      () => {
        sim.player.facing = Math.PI;
      },
      () => {},
      'You need to face fishable water.',
    );
  });

  it('facing the vale lake starts the fixed 5 s cast and draws no rng', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // South shore of the vale lake, facing the center: fishable water ahead.
    const pz = LAKE.z - LAKE.radius - 2;
    teleportTo(sim, LAKE.x, pz);
    sim.player.facing = Math.atan2(0, LAKE.z - pz);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // The cast timer is a FIXED 5 s constant (literal on purpose: comparing
    // against the imported constant would pin nothing) and the cast start
    // draws zero rng, preserving the draw-order contract.
    expect(draws).toBe(0);
    expect(sim.player.castingAbility).toBe('fishing');
    expect(sim.player.castTotal).toBe(5);
    expect(sim.player.castRemaining).toBe(5);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'fishing', time: 5 }),
    );
  });
});

// --- Online round trip (pin 8): the guild_letter_online / gather_rare_event
// precedent, driving the real GameServer router and snapshot encoder into the
// real ClientWorld mirror.

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function deliveredEvents(fc: FakeClient): SimEvent[] {
  return fc.sent.filter((m) => m.t === 'events').flatMap((m) => m.list as SimEvent[]);
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot
// directly (the bareClient idiom from tests/snapshots.test.ts).
function bareClient(pid: number, playerClass: PlayerClass = 'warrior'): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = playerClass;
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.nodeCooldowns = new Map();
  return c;
}

describe('fishing over the live server (pin 8)', () => {
  it('a landed catch accrues server-side, mirrors over gprof, and routes fishingResult to the angler only', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 91, 'Angler');
    const sb = joinServer(server, fcB, 92, 'Bystander');
    const internals = server.sim as unknown as {
      entities: Map<number, Entity>;
      players: Map<number, PlayerMeta>;
    };
    const angler = internals.entities.get(sa.pid)!;
    const meta = internals.players.get(sa.pid)!;
    server.sim.tick(); // settle the join before the first broadcast

    // Baseline mirror: the first snapshot carries gprof with fishing at 0.
    const client = bareClient(sa.pid);
    (server as any).broadcastSnapshots();
    const baseline = lastSnap(fcA.sent);
    expect(baseline).not.toBeNull();
    (client as any).applySnapshot(baseline);
    expect(client.gatheringProficiency).toMatchObject({ fishing: 0 });
    fcA.sent.length = 0;
    fcB.sent.length = 0;

    // Land at least one catch on the SERVER sim (hunting past no-bite rolls),
    // routing each cast's events through the real per-session router.
    let landed = 0;
    for (let i = 0; i < 50 && landed === 0; i++) {
      completeFishing(server.sim.ctx, angler, meta);
      (server as any).routeEvents(server.sim.drainEvents());
      landed = meta.pendingGatherGrants.length;
    }
    expect(landed).toBeGreaterThan(0);

    // The fishingResult reached the angler session and nobody else.
    const mine = fishingResultsIn(deliveredEvents(fcA));
    expect(mine).toHaveLength(landed);
    expect(mine[0].pid).toBe(sa.pid);
    expect(typeof mine[0].itemId).toBe('string');
    expect(typeof mine[0].quality).toBe('string');
    expect(fishingResultsIn(deliveredEvents(fcB))).toHaveLength(0);
    expect(sb.pid).not.toBe(sa.pid);

    // The tick drains the grant server-side (and separates the two
    // broadcasts, which never fire back to back without a tick between).
    server.sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(landed);

    // The gprof delta carries the accrual to the client mirror.
    (server as any).broadcastSnapshots();
    const delta = lastSnap(fcA.sent);
    expect(delta).not.toBeNull();
    (client as any).applySnapshot(delta);
    expect(client.gatheringProficiency.fishing).toBe(landed);
  });
});
