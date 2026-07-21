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
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { FISHING_TABLES, FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { DEEPFEN_SHALLOWS_LAKE, LAKE } from '../src/sim/data';
import {
  completeFishing,
  FISHING_BAND_THRESHOLDS,
  FISHING_GAIN_SCHEDULE,
  FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY,
  fishingBandFor,
  fishingCatchGain,
  startFishing,
} from '../src/sim/professions/fishing';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { type Entity, FISHING_CAST_ID, type PlayerClass, type SimEvent } from '../src/sim/types';
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

// South shore of the vale lake, facing the center: fishable water ahead (the
// pin-10 idiom), required by every drive that runs the REAL cast loop.
function teleportToValeShore(sim: Sim): void {
  const pz = LAKE.z - LAKE.radius - 2;
  teleportTo(sim, LAKE.x, pz);
  sim.player.facing = Math.atan2(0, LAKE.z - pz);
}

// Phase 12b live-loop cast: startFishing draws the ONE hidden bite delay, the
// lifecycle's fishing arm fires the bite off the hidden tick deadline, and
// the reel re-press (startFishing's reel arm) rolls the table. Ticks advance
// by assigning sim.tickCount directly and calling the real updateCasting arm,
// so the shared rng stream sees ONLY the fishing draws (draw 2i the bite
// delay, draw 2i+1 the table) and the literal sequences below stay
// band-auditable with zero world noise.
function castOnceLive(sim: Sim, meta: PlayerMeta): { caught: string | null; events: SimEvent[] } {
  const before = new Map(VALE_CATCH_IDS.map((id) => [id, sim.countItem(id)]));
  const evStart = sim.events.length;
  const p = sim.player;
  startFishing(sim.ctx, p, meta); // the bite-delay draw
  if (p.castingAbility !== FISHING_CAST_ID) throw new Error('fishing cast did not start');
  sim.tickCount = p.fishBiteAtTick;
  updateCasting(sim.ctx, p, meta); // fires the bite, arms the reel window
  if (p.fishReelDeadlineTick <= 0) throw new Error('bite did not arm the reel window');
  startFishing(sim.ctx, p, meta); // the reel: the table draw
  if (p.castingAbility !== null) throw new Error('reel did not end the session');
  const events = sim.events.slice(evStart);
  let caught: string | null = null;
  for (const id of VALE_CATCH_IDS) {
    if (sim.countItem(id) > (before.get(id) ?? 0)) caught = id;
  }
  return { caught, events };
}

function catchSequenceLive(sim: Sim, meta: PlayerMeta, n: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) out.push(castOnceLive(sim, meta).caught);
  return out;
}

// The literal band-0 catch sequence at seed 4242 under the Phase 12b LIVE
// loop (re-recorded from the shipped drive by the bite-hunt scratch script,
// then spot-audited): each session consumes TWO draws, draw 2i the hidden
// bite delay and draw 2i+1 the table walk against the SHIPPED Vale rows
// (trout 45 / perch 30 / weed 12 / koi 3 / null 10). Any accidental extra
// draw, band-boundary change, or band-0 table drift breaks this pin.
const B0_SEQ_4242: (string | null)[] = [
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  KOI,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  null,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  null,
  PERCH,
  TROUT,
  WEED,
  WEED,
  PERCH,
  TROUT,
  PERCH,
];

// The literal band-1 live-loop sequence for the SAME seed with fishing
// proficiency 150 (band-1 Vale weights trout 48 / perch 33 / weed 8 / koi 3 /
// null 8). It diverges from B0_SEQ_4242 at index 0 (trout, not perch), so
// matching it proves the live path actually switched tables; index 22 is the
// hunted band DISCRIMINATOR against band 2 (koi here, tangled weed there).
const B1_SEQ_4242: (string | null)[] = [
  TROUT,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  WEED,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  null,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  KOI,
  PERCH,
];

// The literal band-2 live-loop sequence for the SAME seed with fishing
// proficiency 200 (band-2 Vale weights trout 51 / perch 36 / weed 4 / koi 3 /
// null 6) against the same interleaved stream. It diverges from the band-0
// walk at index 0 and, decisively, from the BAND-1 walk at index 22: that
// table draw lands where band 1 yields the koi but band 2 yields tangled
// weed (the hunted divergence index under the two-draw stream), so matching
// this sequence proves the live path resolved FISHING_TABLES_BY_BAND[2], not
// a band-1 collapse (Phase 11 QA: the top-band wiring was previously
// unpinned on the live path).
const B2_SEQ_4242: (string | null)[] = [
  TROUT,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  WEED,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  null,
  PERCH,
  TROUT,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  WEED,
  TROUT,
];

// Probe candidate shore spots around the Deepfen Shallows lake with the REAL
// startFishing (its deny arms are draw-free, so failed probes never touch the
// stream); the single successful probe start (one bite-delay draw) is
// cancelled and its events dropped before returning, leaving the player on a
// dry, fishable spot inside the codfather shore margin.
function teleportToDeepfenShore(sim: Sim, meta: PlayerMeta): void {
  const L = DEEPFEN_SHALLOWS_LAKE;
  for (let r = L.radius * 0.7; r <= L.radius + 10; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = L.x + Math.cos(a) * r;
      const z = L.z + Math.sin(a) * r;
      teleportTo(sim, x, z);
      sim.player.facing = Math.atan2(L.x - x, L.z - z);
      const evLen = sim.events.length;
      startFishing(sim.ctx, sim.player, meta);
      const started = sim.player.castingAbility === FISHING_CAST_ID;
      if (started) {
        sim.player.castingAbility = null;
        sim.player.castRemaining = 0;
        sim.player.fishBiteAtTick = 0;
        sim.player.fishReelDeadlineTick = 0;
      }
      sim.events.length = evLen;
      if (started) return;
    }
  }
  throw new Error('No dry Deepfen Shallows fishing spot found');
}

function codfatherSim(): { sim: Sim; meta: PlayerMeta } {
  const sim = makeSim();
  const meta = sim.meta(sim.playerId)!;
  meta.questLog.set('q_the_codfather', {
    questId: 'q_the_codfather',
    counts: [0],
    state: 'active',
  });
  teleportToDeepfenShore(sim, meta);
  return { sim, meta };
}

describe('fishing determinism (pin 1)', () => {
  it('two fresh Sims with the same seed produce the identical 30-catch live-loop sequence', () => {
    const run = (seed: number) => {
      const sim = makeSim(seed);
      teleportToValeShore(sim);
      return catchSequenceLive(sim, sim.meta(sim.playerId)!, 30);
    };
    const seqA = run(777);
    const seqB = run(777);
    expect(seqA).toEqual(seqB);
    expect(seqA).toHaveLength(30);
    // Non-degenerate: the pinned run actually lands catches.
    expect(seqA.some((c) => c !== null)).toBe(true);
  });

  it('band 0 reproduces the shipped Vale table: literal live-loop sequence at seed 4242', () => {
    const sim = makeSim(4242);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, sim.meta(sim.playerId)!, 30)).toEqual(B0_SEQ_4242);
  });
});

describe('fishing draw contract (pin 2, the Phase 12b bite-and-reel shape)', () => {
  it('a full session draws exactly two rng values: the bite delay at the cast, the table at the reel', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const outcomes: (string | null)[] = [];
    try {
      for (let i = 0; i < 30; i++) {
        const p = sim.player;
        let before = draws;
        startFishing(sim.ctx, p, meta); // the ONE hidden bite-delay draw
        expect(draws - before).toBe(1);
        before = draws;
        sim.tickCount = p.fishBiteAtTick;
        updateCasting(sim.ctx, p, meta); // the bite arm is draw-free
        expect(draws - before).toBe(0);
        const counts = new Map(VALE_CATCH_IDS.map((id) => [id, sim.countItem(id)]));
        before = draws;
        startFishing(sim.ctx, p, meta); // the reel: the single table draw
        expect(draws - before).toBe(1);
        expect(p.castingAbility).toBe(null);
        let caught: string | null = null;
        for (const id of VALE_CATCH_IDS) {
          if (sim.countItem(id) > (counts.get(id) ?? 0)) caught = id;
        }
        outcomes.push(caught);
      }
    } finally {
      sim.rng.setObserver(null);
    }
    // Both branches were actually exercised under the counter.
    expect(outcomes).toContain(null);
    expect(outcomes.some((c) => c !== null)).toBe(true);
  });

  it('a missed reel window draws nothing more: one draw total, and only the cast is lost', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      expect(draws).toBe(1); // the bite delay
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta); // the bite
      sim.tickCount = p.fishReelDeadlineTick + 1;
      updateCasting(sim.ctx, p, meta); // the miss fires at deadline + 1
      expect(draws).toBe(1); // no table roll ever happened
      expect(p.castingAbility).toBe(null);
      expect(sim.events).toContainEqual({ type: 'fishingGotAway', pid: sim.playerId });
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'castStop', success: false }),
      );
      expect(fishingResultsIn(sim.events)).toHaveLength(0);
      expect(meta.pendingGatherGrants).toHaveLength(0);
      // Recast immediately: the miss costs nothing but the session itself.
      startFishing(sim.ctx, p, meta);
      expect(p.castingAbility).toBe(FISHING_CAST_ID);
      expect(draws).toBe(2);
    } finally {
      sim.rng.setObserver(null);
    }
  });

  it('bags full at the reel: both draws still spend, nothing lands, no grant, no fishingResult', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    // Fill every slot with an unstackable tool so no catch can land.
    meta.inventory = Array.from({ length: bagCapacity(meta.bags) }, () => ({
      itemId: 'simple_fishing_pole',
      count: 1,
    }));
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta);
      startFishing(sim.ctx, p, meta); // the reel: capacity gates AFTER the roll
    } finally {
      sim.rng.setObserver(null);
    }
    // The capacity gate sits AFTER the table roll, so the session still spent
    // both draws (bite delay plus table); at seed 4242 the first table draw
    // resolves a perch (B0_SEQ_4242[0]) that simply gets away.
    expect(draws).toBe(2);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Your bags are full.' }),
    );
    expect(sim.countItem(PERCH)).toBe(0);
    expect(fishingResultsIn(sim.events)).toHaveLength(0);
    expect(meta.pendingGatherGrants).toHaveLength(0);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(0);
  });

  it('codfather session: one draw at the cast, zero at the reel, the quest fish force-lands', () => {
    const { sim, meta } = codfatherSim();
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      // The SHIPPED codfather choice (state.md): the cast still rolls its one
      // hidden bite delay (startFishing has no quest special-case) and the
      // reel's completeFishing early return rolls NO table draw.
      expect(draws).toBe(1);
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta);
      startFishing(sim.ctx, p, meta); // the reel
      expect(draws).toBe(1);
    } finally {
      sim.rng.setObserver(null);
    }
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
      // Phase 12c stage 2 appendix re-pin: fishing's enforced cap is 200.
      maxSkill: 200,
    });
  });
});

describe('fishing catch gain schedule (Professions 2.0 Phase 12c)', () => {
  it('fishingCatchGain walks the fractional schedule AT the half-band boundaries', () => {
    expect(fishingCatchGain(0, false)).toBe(1);
    expect(fishingCatchGain(49, false)).toBe(1);
    expect(fishingCatchGain(50, false)).toBe(0.5);
    expect(fishingCatchGain(99, false)).toBe(0.5);
    expect(fishingCatchGain(100, false)).toBe(0.1);
    expect(fishingCatchGain(149, false)).toBe(0.1);
    expect(fishingCatchGain(150, false)).toBe(0.02);
    expect(fishingCatchGain(199, false)).toBe(0.02);
    // At or past the last row the schedule returns 0: the maxSkill cap clamp
    // is the real stop, not this function.
    expect(fishingCatchGain(200, false)).toBe(0);
  });

  it('junk follows the schedule below the cutoff and grants 0 at or past it', () => {
    expect(fishingCatchGain(0, true)).toBe(1);
    expect(fishingCatchGain(99, true)).toBe(0.5);
    expect(fishingCatchGain(100, true)).toBe(0);
    expect(fishingCatchGain(150, true)).toBe(0);
  });

  it('pins the schedule and cutoff literals', () => {
    expect(FISHING_GAIN_SCHEDULE).toEqual([
      { belowProficiency: 50, gain: 1 },
      { belowProficiency: 100, gain: 0.5 },
      { belowProficiency: 150, gain: 0.1 },
      { belowProficiency: 200, gain: 0.02 },
    ]);
    expect(FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY).toBe(100);
  });

  it('live completeFishing queues the schedule amount: 0.5 per landed catch at proficiency 50', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    meta.gatheringProficiency.fishing = 50;
    let caught: string | null = null;
    for (let i = 0; i < 30 && caught === null; i++) caught = castOnce(sim, meta).caught;
    expect(caught).not.toBeNull();
    // Exactly one landed catch so far: one queued grant, at the 50-99 row.
    expect(meta.pendingGatherGrants).toEqual([{ professionId: 'fishing', amount: 0.5 }]);
  });

  it('live junk cutoff: at proficiency 150 a weed queues nothing while a fish queues 0.02', () => {
    // No rod, so the band-1 proficiency silently caps to the band-0 table,
    // which still carries the weed row: junk-ness comes from the caught
    // item's def kind (ItemDef kind 'junk'), never from the band.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    meta.gatheringProficiency.fishing = 150;
    let sawJunk = false;
    let sawFish = false;
    for (let i = 0; i < 60 && !(sawJunk && sawFish); i++) {
      const before = meta.pendingGatherGrants.length;
      const { caught } = castOnce(sim, meta);
      if (caught === null) {
        expect(meta.pendingGatherGrants).toHaveLength(before);
      } else if (caught === WEED) {
        sawJunk = true;
        expect(meta.pendingGatherGrants).toHaveLength(before); // cut off past band 0
      } else {
        sawFish = true;
        expect(meta.pendingGatherGrants).toHaveLength(before + 1);
        expect(meta.pendingGatherGrants[meta.pendingGatherGrants.length - 1]).toEqual({
          professionId: 'fishing',
          amount: 0.02,
        });
      }
    }
    // Decisive only if the drive really saw both kinds (seed 4242's band-0
    // walk lands both well inside 60 casts).
    expect(sawJunk).toBe(true);
    expect(sawFish).toBe(true);
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
  it('proficiency 150 resolves the band-1 Vale table: literal live-loop sequence at seed 4242', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 150;
    // Phase 12: band 1 also needs the tier-2 rod in bags (the silent tool
    // cap); the bag scan is rng-free. The rod narrows the bite-delay range
    // too, but the delay draw is consumed either way, so the table walk is
    // rod-independent given the band.
    sim.addItem('ironreel_fishing_rod', 1);
    teleportToValeShore(sim);
    // B1_SEQ_4242 diverges from B0_SEQ_4242 at index 0 for the same rng
    // stream, so this match proves the live path actually switched tables.
    expect(catchSequenceLive(sim, meta, 24)).toEqual(B1_SEQ_4242);
  });

  it('proficiency 200 resolves the band-2 Vale table: literal live-loop sequence at seed 4242', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 200;
    // Phase 12: band 2 needs the tier-3 rod (band b requires tool tier b + 1).
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    // Index 22 sits in the hunted band-discriminating window (weed here where
    // the band-1 table yields the koi; see the B2_SEQ_4242 derivation
    // comment), so this match proves the live path resolved the TOP band,
    // not a band-1 collapse.
    expect(catchSequenceLive(sim, meta, 24)).toEqual(B2_SEQ_4242);
  });
});

// Phase 12 band tool cap: catch band b requires an owned rod of tier b + 1
// (canGatherTier(rodTier, b + 1)); the effective band is min(proficiency
// band, best band the owned rod covers), capped SILENTLY (no event, no
// denial: the cast still lands a band-capped catch). The simple pole is not a
// gatherTool, so it floors to tier 1: band 0, the shipped table, stays
// reachable with the pole or bare hands.
describe('fishing band tool cap (Professions 2.0 Phase 12)', () => {
  it('proficiency 150 with NO rod silently caps to the band-0 table (literal sequence)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 150;
    teleportToValeShore(sim);
    // B0 and B1 diverge at index 0 (perch vs trout) on this stream, so 12
    // sessions are decisive: band-1 proficiency without the rod still walks
    // the SHIPPED band-0 table, and nothing else changes (no error, no event).
    expect(catchSequenceLive(sim, meta, 12)).toEqual(B0_SEQ_4242.slice(0, 12));
  });

  it('proficiency 250 with the tier-2 rod stays band 1: the discriminator window yields the koi', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 250;
    sim.addItem('ironreel_fishing_rod', 1);
    teleportToValeShore(sim);
    // Index 0 (trout, not band 0's perch) proves the walk left band 0; index
    // 22 is the hunted band DISCRIMINATOR: that table draw lands where band 1
    // yields the koi but band 2 yields tangled weed (the B2_SEQ_4242
    // derivation comment), so the koi there proves the tier-2 rod held the
    // walk at band 1 despite band-2 proficiency.
    expect(catchSequenceLive(sim, meta, 24)).toEqual(B1_SEQ_4242);
  });

  it('proficiency 250 with the tier-3 rod reaches band 2 (the full B2 literal)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 250;
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 24)).toEqual(B2_SEQ_4242);
  });

  it('a high rod never buys bands: proficiency band 0 with the tier-3 rod stays band 0', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // Proficiency 0 resolves band 0 while the silverstream rod allows band 2,
    // so the effective band must take the PROFICIENCY arm of min(profBand,
    // allowedBand): a fresh buyer of the 150c rod cannot fish the band-2
    // table. Every other cap test binds the rod arm or the equal case, so
    // this is the only guard against the min() collapsing to allowedBand
    // alone. B0 diverges from B1/B2 at index 0, so 12 sessions are decisive.
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 12)).toEqual(B0_SEQ_4242.slice(0, 12));
  });

  it('a pole-only proficiency-0 angler is byte-identical to the bare-hands live walk', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // The pole keeps use: { type: 'fishing' }: not a gatherTool, so the bag
    // scan floors to tier 1: band 0 AND the tier-1 bite-delay range, so both
    // draws of every session match the bare-hands B0 recording exactly.
    sim.addItem('simple_fishing_pole', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B0_SEQ_4242);
  });

  it('useItem on each new rod starts the standard fishing cast', () => {
    for (const rodId of ['ironreel_fishing_rod', 'silverstream_fishing_rod']) {
      const sim = makeSim(4242);
      // South shore of the vale lake, facing the center (the pin-10 idiom).
      const pz = LAKE.z - LAKE.radius - 2;
      teleportTo(sim, LAKE.x, pz);
      sim.player.facing = Math.atan2(0, LAKE.z - pz);
      sim.addItem(rodId, 1);
      sim.events = [];
      sim.useItem(rodId);
      expect(sim.player.castingAbility, rodId).toBe(FISHING_CAST_ID);
      // Phase 12b: the visible timer is the 15 s session cap (literal on
      // purpose), which carries no bite information.
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'castStart', ability: FISHING_CAST_ID, time: 15 }),
      );
      // The rod is a permanent tool: never consumed by the cast.
      expect(sim.countItem(rodId)).toBe(1);
    }
  });

  it('useItem on a non-fishing gathering tool stays a safe no-op', () => {
    // The re-homed half of the retired "safe no-op until the gather-node
    // system lands" pin (tests/professions_tools.test.ts): node access gating
    // scans bags (professions/tools.ts bestOwnedGatherToolTier), never an
    // item USE, so using a pick does nothing, casts nothing, and keeps it.
    const sim = makeSim(4242);
    sim.addItem('copper_mining_pick', 1);
    sim.events = [];
    expect(() => sim.useItem('copper_mining_pick')).not.toThrow();
    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(sim.events.some((e) => (e as { type: string }).type === 'castStart')).toBe(false);
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
      let draws = 0;
      sim.rng.setObserver(() => draws++);
      try {
        startFishing(sim.ctx, sim.player, meta);
      } finally {
        sim.rng.setObserver(null);
      }
      expect(sim.events).toContainEqual(expect.objectContaining({ type: 'error', text }));
      // No cast ever starts on a deny (the busy arm's precondition is itself
      // a live castingAbility, so the tooth is the absent castStart event),
      // and a denial never draws: the bite-delay draw sits AFTER every arm.
      expect(sim.events.some((e) => (e as { type: string }).type === 'castStart')).toBe(false);
      expect(draws).toBe(0);
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

  it('facing the vale lake starts the capped session and draws exactly the one bite delay', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // Phase 12b INVERTS the old zero-draw pin: the cast start now draws
    // EXACTLY the one hidden bite delay. The visible timer is the FIXED 15 s
    // session cap (literal on purpose: comparing against the imported
    // constant would pin nothing) and carries zero bite information.
    expect(draws).toBe(1);
    expect(sim.player.castingAbility).toBe('fishing');
    expect(sim.player.castTotal).toBe(15);
    expect(sim.player.castRemaining).toBe(15);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'fishing', time: 15 }),
    );
    // The hidden bite state armed in ticks, strictly ahead of now; the reel
    // window stays unarmed until the bite actually fires.
    expect(sim.player.fishBiteAtTick).toBeGreaterThan(sim.tickCount);
    expect(sim.player.fishReelDeadlineTick).toBe(0);
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
  // Joins two sessions, silences every mob (mob damage cancels a fishing
  // session mid-drive), hands the angler the pole, and probes shore spots
  // around the vale lake with the REAL use_item dispatch until a session
  // starts (deny arms are draw-free). Returns with the probe cast LIVE and
  // both send buffers cleared.
  function setupAngler() {
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
    for (const e of internals.entities.values()) {
      if (e.kind !== 'mob') continue;
      e.dead = true;
      e.hp = 0;
      e.aiState = 'dead';
      e.respawnTimer = 9999;
      e.corpseTimer = 9999;
      e.inCombat = false;
    }
    server.sim.addItem('simple_fishing_pole', 1, sa.pid);
    let started = false;
    for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8 && !started; r += 1) {
      for (let i = 0; i < 72 && !started; i++) {
        const a = (i / 72) * Math.PI * 2;
        const x = LAKE.x + Math.cos(a) * r;
        const z = LAKE.z + Math.sin(a) * r;
        angler.pos.x = x;
        angler.pos.z = z;
        angler.pos.y = terrainHeight(x, z, server.sim.cfg.seed);
        angler.prevPos = { ...angler.pos };
        angler.facing = Math.atan2(LAKE.x - x, LAKE.z - z);
        server.sim.useItem('simple_fishing_pole', sa.pid);
        started = angler.castingAbility === FISHING_CAST_ID;
      }
    }
    expect(started).toBe(true);
    server.sim.drainEvents(); // drop the probe denials and the castStart
    fcA.sent.length = 0;
    fcB.sent.length = 0;
    return { server, fcA, fcB, sa, sb, angler, meta };
  }

  it('the bite routes to the angler only; the reel lands the catch, accrues, and mirrors over gprof', () => {
    const { server, fcA, fcB, sa, sb, angler, meta } = setupAngler();
    server.sim.tick();
    (server as any).routeEvents(server.sim.drainEvents());

    // Baseline mirror: the first snapshot carries gprof with fishing at 0.
    const client = bareClient(sa.pid);
    (server as any).broadcastSnapshots();
    const baseline = lastSnap(fcA.sent);
    expect(baseline).not.toBeNull();
    (client as any).applySnapshot(baseline);
    expect(client.gatheringProficiency).toMatchObject({ fishing: 0 });

    // Sessions repeat (a reeled table draw can still resolve the empty-hook
    // row) until a catch lands. The bite is driven deterministically by seed
    // and tick count through the LIVE loop: tick until the routed personal
    // fishingBite arrives, then reel via the same use_item command. No
    // wall-clock waits anywhere.
    let landed = 0;
    for (let session = 0; session < 10 && landed === 0; session++) {
      if (angler.castingAbility !== FISHING_CAST_ID) {
        server.sim.useItem('simple_fishing_pole', sa.pid);
        expect(angler.castingAbility).toBe(FISHING_CAST_ID);
      }
      fcA.sent.length = 0;
      fcB.sent.length = 0;
      let bit = false;
      for (let i = 0; i < 200 && !bit; i++) {
        (server as any).routeEvents(server.sim.tick());
        bit = deliveredEvents(fcA).some((ev) => ev.type === 'fishingBite');
      }
      expect(bit).toBe(true);
      // Bystander isolation: the personal bite never leaks.
      expect(deliveredEvents(fcB).some((ev) => ev.type === 'fishingBite')).toBe(false);
      server.sim.useItem('simple_fishing_pole', sa.pid); // the reel
      (server as any).routeEvents(server.sim.drainEvents());
      expect(angler.castingAbility).toBe(null);
      landed = meta.pendingGatherGrants.length;
      server.sim.tick(); // drain the grant (and separate the broadcasts)
    }
    expect(landed).toBe(1);

    // The fishingResult reached the angler session and nobody else.
    const mine = fishingResultsIn(deliveredEvents(fcA));
    expect(mine).toHaveLength(1);
    expect(mine[0].pid).toBe(sa.pid);
    expect(typeof mine[0].itemId).toBe('string');
    expect(typeof mine[0].quality).toBe('string');
    expect(fishingResultsIn(deliveredEvents(fcB))).toHaveLength(0);
    expect(sb.pid).not.toBe(sa.pid);
    expect(meta.gatheringProficiency.fishing).toBe(1);

    // The gprof delta carries the accrual to the client mirror.
    (server as any).broadcastSnapshots();
    const delta = lastSnap(fcA.sent);
    expect(delta).not.toBeNull();
    (client as any).applySnapshot(delta);
    expect(client.gatheringProficiency.fishing).toBe(1);
  });

  it('a missed reel window gets away server-side: personal fishingGotAway, no catch, no grant', () => {
    const { server, fcA, fcB, sa, angler, meta } = setupAngler();
    let missed = false;
    for (let i = 0; i < 300 && !missed; i++) {
      (server as any).routeEvents(server.sim.tick());
      missed = deliveredEvents(fcA).some((ev) => ev.type === 'fishingGotAway');
    }
    expect(missed).toBe(true);
    // The bite fired first, the window elapsed untouched, the session ended
    // with no roll, no item, and no grant.
    expect(deliveredEvents(fcA).some((ev) => ev.type === 'fishingBite')).toBe(true);
    expect(angler.castingAbility).toBe(null);
    expect(fishingResultsIn(deliveredEvents(fcA))).toHaveLength(0);
    expect(meta.pendingGatherGrants).toHaveLength(0);
    expect(deliveredEvents(fcB).some((ev) => ev.type === 'fishingGotAway')).toBe(false);
    // Recast immediately: the miss costs nothing but the session itself.
    server.sim.useItem('simple_fishing_pole', sa.pid);
    expect(angler.castingAbility).toBe(FISHING_CAST_ID);
  });
});
