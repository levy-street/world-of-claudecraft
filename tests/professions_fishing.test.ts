// Professions 2.0: fishing as a full gathering proficiency, the
// catch rarity band ladder, the one-draw rng contract, the text-free
// fishingResult SimEvent, the live-server round trip (gprof mirror + event
// routing), and the deliberately accepted gathering-deed drift. This file is
// this arc's primary home; the shipped fishing cast lifecycle itself stays
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
import { bagCapacity } from '../src/sim/bags';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  FISHING_BAND_INTRODUCED_CATCH,
  FISHING_TABLES,
  FISHING_TABLES_BY_BAND,
  introducedCatchFor,
  isRawCookingCatch,
} from '../src/sim/content/items';
import { GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import { DEEPFEN_SHALLOWS_LAKE, ITEMS, LAKE } from '../src/sim/data';
import {
  completeFishing,
  FISH_BITE_DELAY_MIN_SEC,
  FISH_EARLY_REEL_GRACE_SEC,
  FISH_REEL_WINDOW_SEC,
  FISHING_BAND_THRESHOLDS,
  FISHING_GAIN_SCHEDULE,
  FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY,
  fishBiteMaxSecFor,
  fishingBandFor,
  fishingCatchGain,
  fishingCatchGainAt,
  fishingRodBandFor,
  fishingTeachingCeilingFor,
  startFishing,
} from '../src/sim/professions/fishing';
import {
  FISHING_CATCH_BAND_THRESHOLDS,
  fishingCatchBandFor,
} from '../src/sim/professions/fishing_bands';
import {
  PROFICIENCY_BAND_THRESHOLDS,
  proficiencyBandFor,
} from '../src/sim/professions/proficiency_bands';
import { canGatherTier } from '../src/sim/professions/tools';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { DT, type Entity, FISHING_CAST_ID, GATHER_CAST_ID, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';

function makeSim(seed = 467): Sim {
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
  /** The water the cast resolved against, which the tier-2 R19 drive below
   *  reads to prove it fished Mirefen rather than the Vale fallback. */
  zoneId: string;
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

// Live-loop cast: startFishing draws the ONE hidden bite delay, the
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

// The literal band-0 catch sequence at seed 36 under the LIVE loop: each
// session consumes TWO draws, draw 2i the hidden bite delay and draw 2i+1 the
// table walk against the band-0 Vale rows (trout 46 / perch 31 / weed 12 /
// koi 1 / null 10). Any accidental extra draw, band-boundary change, or
// band-0 table drift breaks this pin.
//
// The seed moved 467 to 36 with the Galecrest quest-camp content pass
// (062f6180ef): its four new camps draw at world gen, and under the shifted
// stream seed 467's band-0 and band-1 walks landed IDENTICAL, which would
// have left the band pins below green on equal arrays and proved nothing.
// Seed 36 was hunted for the property 467 lost: all three band walks differ,
// and they differ inside the first twelve sessions.
const B0_SEQ_36: (string | null)[] = [
  PERCH,
  TROUT,
  null,
  TROUT,
  WEED,
  null,
  PERCH,
  TROUT,
  PERCH,
  WEED,
  TROUT,
  null,
  null,
  TROUT,
  TROUT,
  PERCH,
  WEED,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  null,
  PERCH,
  null,
];

// The literal band-1 live-loop sequence for the SAME seed with fishing
// proficiency 150 (band-1 Vale weights trout 49 / perch 32 / weed 8 / koi 3 /
// null 8). It first diverges from B0_SEQ_36 at index 6 (the perch where band 0
// draws tangled weed: the junk row falls 12 to 8, so the perch span's ceiling
// climbs 77 to 81 and swallows that draw), again at 9 by the same step, and at
// 14 (trout where band 0 draws a perch: the trout row rises 46 to 49), so
// matching the full 30-cast walk proves the live path actually switched
// tables; index 7 is the hunted band DISCRIMINATOR against band 2 (the tangled
// weed here, the rare koi there). The divergence is asserted rather than
// described: see the discriminator pin below, which fails if the walks ever
// collapse onto each other.
const B1_SEQ_36: (string | null)[] = [
  PERCH,
  TROUT,
  null,
  TROUT,
  WEED,
  null,
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  KOI,
  null,
  TROUT,
  TROUT,
  PERCH,
  WEED,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  null,
  PERCH,
  null,
];

// The literal band-2 live-loop sequence for the SAME seed with fishing
// proficiency 200 (band-2 Vale weights trout 50 / perch 34 / weed 4 / koi 6 /
// null 6) against the same interleaved stream. It diverges, decisively, from
// BOTH the band-0 and band-1 walks at index 7: that table draw lands where
// the lower bands yield tangled weed but band 2 yields the rare koi (the junk
// row falls 8 to 4 while the koi row rises 3 to 6, so the koi span's floor
// drops 89 to 88 and takes that draw, the hunted divergence cell under the
// two-draw stream), so matching this sequence proves the live path resolved
// FISHING_TABLES_BY_BAND[2], not a band-1 collapse (the top-band wiring was
// previously unpinned on the live path).
const B2_SEQ_36: (string | null)[] = [
  PERCH,
  TROUT,
  null,
  TROUT,
  PERCH,
  null,
  PERCH,
  TROUT,
  PERCH,
  PERCH,
  TROUT,
  KOI,
  null,
  TROUT,
  TROUT,
  PERCH,
  PERCH,
  PERCH,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  TROUT,
  PERCH,
  TROUT,
  PERCH,
  null,
  PERCH,
  null,
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
  // The shore probe drives the REAL startFishing, whose implement gate
  // (#2343) needs tackle in bags AND whose zone gate needs a rod the water
  // takes. The Deepfen Shallows sit in Mirefen, which asks for tier 2, so the
  // simple pole alone can no longer reach this quest's water: the Ironreel is
  // the tackle the Codfather now costs. Pinned on its own below.
  sim.addItem('ironreel_fishing_rod', 1);
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
      // The implement gate (#2343) needs tackle in bags; the pole is
      // mechanically identical to bare hands (not a gatherTool, tier floors
      // to 1), so it perturbs no draw and no literal.
      sim.addItem('simple_fishing_pole', 1);
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

  it('band 0 reproduces the shipped Vale table: literal live-loop sequence at seed 36', () => {
    const sim = makeSim(36);
    // The pole satisfies the implement gate (#2343) and is mechanically
    // identical to bare hands, so the recorded literals hold byte-identical.
    sim.addItem('simple_fishing_pole', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, sim.meta(sim.playerId)!, 30)).toEqual(B0_SEQ_36);
  });
});

describe('fishing draw contract (pin 2, the bite-and-reel shape)', () => {
  it('a full session draws exactly two rng values: the bite delay at the cast, the table at the reel', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    // The implement gate (#2343): the pole is a draw-free bag scan hit and
    // never a gatherTool, so the two-draw shape below is untouched.
    sim.addItem('simple_fishing_pole', 1);
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

  it('no skilling while dead: a dead player cannot start a fishing session (R31)', () => {
    // Already enforced (the dead gate at the top of startFishing); pinned
    // beside the harvest twin (tests/gather_node_harvest.test.ts) so the pair
    // cannot rot apart: R31 leans on death actually stopping the skilling.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    p.dead = true;
    p.hp = 0;
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta);
      expect(p.castingAbility).toBeNull();
      expect(draws).toBe(0);
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'error', text: "You can't do that while dead." }),
      );
      // The positive control: the same fixture alive really can cast, so the
      // refusal above is the dead gate and not a broken shore or missing pole.
      p.dead = false;
      p.hp = 1;
      startFishing(sim.ctx, p, meta);
      expect(p.castingAbility).toBe(FISHING_CAST_ID);
    } finally {
      sim.rng.setObserver(null);
    }
  });

  it('a missed reel window draws nothing more: one draw total, and only the cast is lost', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1); // the implement gate (#2343); draw-free, tier stays 1
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
      expect(sim.events).toContainEqual({
        type: 'fishingGotAway',
        pid: sim.playerId,
        zoneId: 'eastbrook_vale',
        band: 0,
      });
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
    const sim = makeSim(467);
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
    // both draws (bite delay plus table); at seed 467 the first table draw
    // resolves a river perch that simply gets away. Pinned to the row that
    // actually rolls, so the count below stays a real gate rather than a
    // vacuous zero for a row the walk never reaches.
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
      // The SHIPPED codfather behavior: the cast still rolls its one
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
  it('accrues the band-0 schedule amount per landed catch (fish AND junk), 0 on no-bite', () => {
    const sim = makeSim(467);
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
          // Read off the schedule's first row rather than restated: this arm
          // is about the FAUCET running once per landed catch, and the value
          // it queues is DECISION F's business, pinned as a literal in
          // 'pins the schedule and cutoff literals' below.
          amount: FISHING_GAIN_SCHEDULE[0].gain,
        });
      }
    }
    // Junk accrues exactly like fish: the seed 467 run lands tangled_weed.
    expect(kinds.has(WEED)).toBe(true);
    expect(landed).toBeGreaterThan(0);
    // One landed catch, one schedule amount. Since DECISION F the amount is
    // FRACTIONAL, so the accrued total is a float sum and must be compared
    // with a tolerance rather than an equality: 29 catches at 0.08 is
    // 2.3200000000000007 in IEEE754, and pinning the exact bit pattern would
    // be pinning the summation order rather than the behavior.
    const accrued = landed * FISHING_GAIN_SCHEDULE[0].gain;
    // Grants ride the gathering queue: nothing lands before the tick drain.
    expect(meta.gatheringProficiency.fishing).toBe(0);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBeCloseTo(accrued, 10);
    // The accrual surfaces through both IWorld gathering projections.
    expect(sim.gatheringProficiencyFor(sim.playerId).fishing).toBeCloseTo(accrued, 10);
    // NOT toContainEqual against a value read back off meta: that would be
    // the projection compared with its own input. Find the row by profession
    // id, then hold its two fields against the independently computed accrual
    // and the literal cap.
    const fishingSkillRow = sim
      .professionsStateFor(sim.playerId)
      .skills.find((row) => row.professionId === 'fishing');
    expect(fishingSkillRow).toBeDefined();
    expect(fishingSkillRow?.skill).toBeCloseTo(accrued, 10);
    // The enforced fishing cap is 200.
    expect(fishingSkillRow?.maxSkill).toBe(200);
  });
});

describe('fishing character XP: the deliberate zero', () => {
  it('grants no character XP on any branch, through both the direct and live cast paths', () => {
    // Fishing is the only UNCAPPED gathering faucet (no node, no per-player
    // respawn), so it pays zero character XP by design: at a world-node
    // harvest's per-action XP it would be worth several times the XP per hour
    // of every other gathering profession. completeFishing carries that as a
    // comment; this is the pin, so a later change touching fishing cannot
    // quietly turn the prose false.
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    const before = meta.counters.xpGained;

    // The direct path: enough casts to cover landed fish, landed junk, and
    // the no-bite branch at this seed.
    let landed = 0;
    let empty = 0;
    for (let i = 0; i < 30; i++) {
      if (castOnce(sim, meta).caught === null) empty++;
      else landed++;
    }
    expect(landed).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
    expect(meta.counters.xpGained).toBe(before);

    // The live cast lifecycle (bite, armed reel window, landed catch) too, so
    // the zero is not an artifact of calling completeFishing directly. The
    // implement gate (#2343) needs tackle in bags; the simple pole is
    // mechanically identical to bare hands, so it perturbs no draw.
    sim.addItem('simple_fishing_pole', 1);
    teleportToValeShore(sim);
    for (let i = 0; i < 5; i++) castOnceLive(sim, meta);
    expect(meta.counters.xpGained).toBe(before);

    // The proficiency faucet DID run: this is a real zero on a live path, not
    // a run where nothing happened.
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBeGreaterThan(0);

    // Non-vacuity: the same counter is live and does move when something
    // actually grants character XP, so the assertions above are a genuine
    // zero rather than a probe that can never increment.
    sim.ctx.grantXp(10, meta);
    expect(meta.counters.xpGained).toBeGreaterThan(before);
  });
});

describe('fishing catch gain schedule (Professions 2.0)', () => {
  it('fishingCatchGain walks the fractional schedule AT the half-band boundaries', () => {
    expect(fishingCatchGain(0, false)).toBe(0.08);
    expect(fishingCatchGain(49, false)).toBe(0.08);
    expect(fishingCatchGain(50, false)).toBe(0.05);
    expect(fishingCatchGain(99, false)).toBe(0.05);
    expect(fishingCatchGain(100, false)).toBe(0.04);
    expect(fishingCatchGain(149, false)).toBe(0.04);
    expect(fishingCatchGain(150, false)).toBe(0.03);
    expect(fishingCatchGain(199, false)).toBe(0.03);
    // At or past the last row the schedule returns 0: the maxSkill cap clamp
    // is the real stop, not this function.
    expect(fishingCatchGain(200, false)).toBe(0);
  });

  it('junk follows the schedule below the cutoff and grants 0 at or past it', () => {
    expect(fishingCatchGain(0, true)).toBe(0.08);
    expect(fishingCatchGain(99, true)).toBe(0.05);
    expect(fishingCatchGain(100, true)).toBe(0);
    expect(fishingCatchGain(150, true)).toBe(0);
  });

  it('pins the schedule and cutoff literals', () => {
    expect(FISHING_GAIN_SCHEDULE).toEqual([
      { belowProficiency: 50, gain: 0.08 },
      { belowProficiency: 100, gain: 0.05 },
      { belowProficiency: 150, gain: 0.04 },
      { belowProficiency: 200, gain: 0.03 },
    ]);
    expect(FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY).toBe(100);
  });

  it('live completeFishing queues the schedule amount: 0.05 per landed catch at proficiency 50', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    meta.gatheringProficiency.fishing = 50;
    let caught: string | null = null;
    for (let i = 0; i < 30 && caught === null; i++) caught = castOnce(sim, meta).caught;
    expect(caught).not.toBeNull();
    // Exactly one landed catch so far: one queued grant, at the 50-99 row.
    expect(meta.pendingGatherGrants).toEqual([{ professionId: 'fishing', amount: 0.05 }]);
  });

  it('live R19 ceiling: at proficiency 150 tier-1 water teaches NOTHING, fish and weed alike', () => {
    // Before R19 this drive pinned the junk cutoff (the fish queued 0.02
    // while the weed queued nothing). Tier-1 water now grays entirely at 100,
    // which SWALLOWS the junk cutoff here: both kinds queue nothing, and the
    // junk-versus-fish discrimination above the ceiling only exists in
    // higher-tier water, where the pure arms below pin it (a live tier-2
    // drive would need a rod and a junk row in that band's table, which the
    // shipped tables do not guarantee). The drive still lands both kinds so
    // the zero is proven for each, not vacuously.
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    meta.gatheringProficiency.fishing = 150;
    let sawJunk = false;
    let sawFish = false;
    for (let i = 0; i < 60 && !(sawJunk && sawFish); i++) {
      const before = meta.pendingGatherGrants.length;
      const { caught } = castOnce(sim, meta);
      if (caught === WEED) sawJunk = true;
      else if (caught !== null) sawFish = true;
      expect(meta.pendingGatherGrants).toHaveLength(before);
    }
    expect(sawJunk).toBe(true);
    expect(sawFish).toBe(true);
  });

  it('live R19 in TIER-2 water: Mirefen still teaches 0.04 at proficiency 120', () => {
    // The live evidence every drive above is blind to: they all fish tier-1
    // Vale water, so replacing the rodTierRequiredForZone(zoneId) read at
    // completeFishing's gain call with the literal 1 kept the whole suite
    // green. 120 is past tier-1's ceiling of 100 and inside tier-2's 150, so
    // that mutation zeroes the grant this arm requires. Driven in the Deepfen
    // Shallows (Mirefen), through the shore probe that runs the REAL
    // startFishing, so the zone rod gate is satisfied for real by the Ironreel
    // the water demands.
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    sim.addItem('ironreel_fishing_rod', 1);
    teleportToDeepfenShore(sim, meta);
    meta.gatheringProficiency.fishing = 120;
    // The Mirefen-EXCLUSIVE band-1 rows, off the live table: a silent fallback
    // to the Vale rows (the zone key the table pick falls back to) must not be
    // mistakable for a Mirefen catch, and the koi sits in both tables.
    const bandRows = FISHING_TABLES_BY_BAND[1];
    const valeIds = new Set(bandRows.eastbrook_vale.map((e) => e.itemId));
    const mirefenOnly = bandRows.mirefen_marsh
      .map((e) => e.itemId)
      .filter((id): id is string => id !== null && !valeIds.has(id));
    expect(mirefenOnly.length).toBeGreaterThan(0); // non-vacuity of the filter
    let landedFish = 0;
    for (let i = 0; i < 60 && landedFish === 0; i++) {
      const before = meta.pendingGatherGrants.length;
      const [result] = fishingResultsIn(castOnce(sim, meta).events);
      if (!result) continue; // an empty hook queues nothing on any tier
      // Grey fishing junk only (weed/boot by literal id). Raw cooking catches
      // are also kind junk but still teach; do not recompute production's
      // isGreyFishingJunk formula here or a co-edit can keep both green.
      if (result.itemId === WEED || result.itemId === 'soggy_boot') {
        // The junk cutoff composing with the ceiling INSIDE teaching water,
        // which no live drive covered before: past 100 a boot teaches nothing
        // even where the water itself still teaches.
        expect(meta.pendingGatherGrants).toHaveLength(before);
        expect(isRawCookingCatch(result.itemId)).toBe(false);
      } else if (mirefenOnly.includes(result.itemId)) {
        expect(isRawCookingCatch(result.itemId)).toBe(true);
        landedFish++;
        // The water the GAIN itself resolved against, straight off the event:
        // the catch table, the deed credit, the telemetry and the gain all read
        // one zoneId local, so pinning it here rules out a silent fallback to
        // the Vale rows being mistaken for tier-2 teaching.
        expect(result.zoneId).toBe('mirefen_marsh');
        expect(meta.pendingGatherGrants.slice(before)).toEqual([
          { professionId: 'fishing', amount: 0.04 },
        ]);
      }
    }
    expect(landedFish, 'the drive must land a Mirefen fish').toBe(1);
  });

  it('the R19 teaching ceilings derive from the schedule rows: 100, 150, then the cap', () => {
    // Walked off the composed gain, not restated: the first proficiency at
    // which a legal-band fish teaches nothing in each water tier.
    const grayPoint = (zoneTier: number): number => {
      for (let p = 0; p <= 200; p++) {
        if (fishingCatchGainAt(p, false, zoneTier) === 0) return p;
      }
      return Number.POSITIVE_INFINITY;
    };
    expect(grayPoint(1)).toBe(100);
    expect(grayPoint(2)).toBe(150);
    expect(grayPoint(3)).toBe(200);
    // Each is a true boundary and equals its schedule row's edge, the
    // derivation the ceiling is defined by.
    for (const tier of [1, 2, 3]) {
      expect(fishingCatchGainAt(grayPoint(tier) - 1, false, tier)).toBeGreaterThan(0);
      expect(fishingTeachingCeilingFor(tier)).toBe(FISHING_GAIN_SCHEDULE[tier].belowProficiency);
    }
    // Tier-3 water teaches to the cap: the ceiling IS the cap, so only the
    // maxSkill clamp stops the climb there.
    expect(fishingTeachingCeilingFor(3)).toBe(GATHERING_PROFESSIONS.fishing.maxSkill);
    // Out-of-ladder tiers clamp instead of throwing: below 1 reads tier 1,
    // above 3 reads tier 3 (a future tier-4 zone teaches to the cap until
    // the schedule itself grows a row).
    expect(fishingTeachingCeilingFor(0)).toBe(100);
    expect(fishingTeachingCeilingFor(4)).toBe(200);
  });

  it('below its water ceiling the composed gain IS the schedule amount (the D12 arm)', () => {
    // R19 composes with the schedule: teaching stops at the water's edge and
    // takes nothing off the value below it. masterwrought Phase 11i retuned
    // the four VALUES (DECISION F) and left this composition alone, which is
    // what this arm is for: the numbers below are the schedule's, read at
    // each row, and the ceiling only ever turns one into 0. Junk composition
    // included: the cutoff still bites above 100 wherever the water teaches.
    expect(fishingCatchGainAt(0, false, 1)).toBe(0.08);
    expect(fishingCatchGainAt(49, false, 1)).toBe(0.08);
    expect(fishingCatchGainAt(50, false, 1)).toBe(0.05);
    expect(fishingCatchGainAt(99, false, 1)).toBe(0.05);
    expect(fishingCatchGainAt(100, false, 2)).toBe(0.04);
    expect(fishingCatchGainAt(149, false, 2)).toBe(0.04);
    expect(fishingCatchGainAt(150, false, 3)).toBe(0.03);
    expect(fishingCatchGainAt(199, false, 3)).toBe(0.03);
    // The junk cutoff survives inside higher water's teaching range.
    expect(fishingCatchGainAt(120, true, 2)).toBe(0);
    expect(fishingCatchGainAt(120, false, 2)).toBe(0.04);
    expect(fishingCatchGainAt(99, true, 1)).toBe(0.05);
  });
});

describe('fishing band function (pin 4)', () => {
  // THE LADDER PIN MOVED ONTO FISHING'S OWN LEAF (masterwrought Phase 11i
  // DECISION B). It used to read [0, 100, 200] because
  // FISHING_BAND_THRESHOLDS aliased PROFICIENCY_BAND_THRESHOLDS; the two are
  // separate arrays now, and pinning them apart is the whole point of the
  // split. Both literals below are written out rather than derived from each
  // other, so an edit to either array has to visit this file.
  it('FISHING_CATCH_BAND_THRESHOLDS are literally [0, 100, 150, 200, 200, 200]', () => {
    expect([...FISHING_CATCH_BAND_THRESHOLDS]).toEqual([0, 100, 150, 200, 200, 200]);
    expect(FISHING_CATCH_BAND_THRESHOLDS).toHaveLength(6);
    // The re-export fishing.ts keeps for its existing importers IS the leaf's
    // array, not a copy that could drift from it.
    expect(FISHING_BAND_THRESHOLDS).toBe(FISHING_CATCH_BAND_THRESHOLDS);
    // One table per band, so the ladder and the tables cannot disagree about
    // how many bands there are.
    expect(FISHING_TABLES_BY_BAND).toHaveLength(FISHING_CATCH_BAND_THRESHOLDS.length);
  });

  it('the SHARED proficiency ladder is untouched at [0, 100, 200] and still drives land gathering', () => {
    // DECISION B's whole reason: PROFICIENCY_BAND_THRESHOLDS is read by
    // professions/gathering.ts for the land gather-cast duration and by
    // proficiency_display_heal.ts, so carrying fishing's new bands on it
    // would have retuned land gathering silently.
    expect([...PROFICIENCY_BAND_THRESHOLDS]).toEqual([0, 100, 200]);
    expect(PROFICIENCY_BAND_THRESHOLDS).toHaveLength(3);
    // And the two arrays really are different objects, so neither pin above
    // is reading the other one.
    expect(PROFICIENCY_BAND_THRESHOLDS).not.toBe(FISHING_CATCH_BAND_THRESHOLDS);
    // The land band each proficiency resolves to, at every boundary the
    // shared ladder names plus the two values fishing moved (150 and 200):
    // a land gatherer sees exactly what they saw before this phase.
    for (const [proficiency, band] of [
      [0, 0],
      [99, 0],
      [100, 1],
      [149, 1],
      [150, 1],
      [199, 1],
      [200, 2],
    ] as const) {
      expect(proficiencyBandFor(proficiency), `land band at ${proficiency}`).toBe(band);
    }
    // 150 is the case that matters: fishing's ladder promotes it to band 2
    // and the land ladder must still read band 1.
    expect(proficiencyBandFor(150)).toBe(1);
    expect(fishingCatchBandFor(150)).toBe(2);
  });

  it('fishingBandFor maps every boundary exactly and NaN falls to band 0', () => {
    expect(fishingBandFor(0)).toBe(0);
    expect(fishingBandFor(99)).toBe(0);
    expect(fishingBandFor(100)).toBe(1);
    expect(fishingBandFor(149)).toBe(1);
    expect(fishingBandFor(150)).toBe(2);
    expect(fishingBandFor(199)).toBe(2);
    // Bands 3, 4 and 5 all gate at 200, so proficiency alone tops out at the
    // LAST of them and the rod is the only axis left above the cap.
    expect(fishingBandFor(200)).toBe(5);
    expect(fishingBandFor(300)).toBe(5);
    expect(fishingBandFor(Number.NaN)).toBe(0);
    // A negative proficiency (malformed input) also falls to band 0.
    expect(fishingBandFor(-5)).toBe(0);
    // fishing.ts's export IS the leaf's function, not a re-implementation.
    expect(fishingBandFor).toBe(fishingCatchBandFor);
  });

  it('fishingRodBandFor rides the shipped band-b-takes-tier-b-plus-1 gate at every rung', () => {
    // The gate is the shipped one, reused rather than replaced: this is what
    // retroactively gives the two crafted rods a catch band to open.
    for (const [rodTier, band] of [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
      [7, 5],
    ] as const) {
      expect(fishingRodBandFor(rodTier), `rod tier ${rodTier}`).toBe(band);
    }
    // Derived from canGatherTier rather than restated: every rung's answer is
    // the highest band b whose required tier b + 1 the rod covers, so a change
    // to the comparator reds here instead of quietly re-gating the tables.
    for (let rodTier = 1; rodTier <= 7; rodTier++) {
      let expected = 0;
      for (let band = 1; band <= 5; band++) if (canGatherTier(rodTier, band + 1)) expected = band;
      expect(fishingRodBandFor(rodTier), `derived rod tier ${rodTier}`).toBe(expected);
    }
  });
});

// The DECISION B acceptance, and it is a TEST rather than a paragraph: the
// claim "no angler alive resolves to a lower catch band than they did before
// Phase 11i" is only worth anything if something walks the whole domain and
// says so.
//
// THE REFERENCE LADDER IS HARD-CODED HERE, NEVER IMPORTED. Importing the new
// constants and comparing them to themselves is the constant-self-comparison
// trap this packet has already been bitten by twice; these two functions are
// the pre-phase source transcribed, and they are what make the walk decisive.
const PRE_PHASE_PROFICIENCY_THRESHOLDS = [0, 100, 200] as const;
const PRE_PHASE_BAND_COUNT = 3;
function prePhaseProficiencyBand(proficiency: number): number {
  if (proficiency >= PRE_PHASE_PROFICIENCY_THRESHOLDS[2]) return 2;
  if (proficiency >= PRE_PHASE_PROFICIENCY_THRESHOLDS[1]) return 1;
  return 0;
}
function prePhaseRodBand(rodTier: number): number {
  let band = 0;
  for (let b = 1; b < PRE_PHASE_BAND_COUNT; b++) if (canGatherTier(rodTier, b + 1)) band = b;
  return band;
}
const prePhaseEffectiveBand = (proficiency: number, rodTier: number): number =>
  Math.min(prePhaseProficiencyBand(proficiency), prePhaseRodBand(rodTier));

// The DECISION F derivation (Phase 11i, qr-11i-PACE): the four
// FISHING_GAIN_SCHEDULE values are DERIVED from a measured casts-to-200 model,
// and this is the arm that reproduces the model rather than restating its
// output. The derivation below is authoritative; the literals in fishing.ts
// are what it is held against.
//
// EVERY INPUT IS A SHIPPED CONSTANT, imported rather than transcribed, so a
// retune of the bite ladder or the reel window reds this instead of leaving a
// stale model behind. The one thing written out is the reference PATH (which
// water and which rod each fifty-point segment is climbed with), because that
// is a statement about how the game is played and cannot be read off a
// constant.
// FISHING_BAND_INTRODUCED_CATCH (masterwrought Phase 11i): the derived table the
// rod tooltip reads to name what a rung unlocks. It is computed at module scope
// over the cell tables, so it is exactly the kind of derived export that can go
// quietly wrong; every claim it makes is pinned here rather than trusted to the
// one consumer.
describe('the catch each band introduces (Phase 11i)', () => {
  it('is one id per HIGH band and nothing at all below them', () => {
    expect(FISHING_BAND_INTRODUCED_CATCH).toHaveLength(FISHING_TABLES_BY_BAND.length);
    // Band 0 reads null because it introduces EVERYTHING (nothing sits below
    // it), bands 1 and 2 because they introduce nothing at all: those two move
    // WEIGHT, not membership, so every shipped catch is already on the band-0
    // table. Same value, two different reasons, and the band-0 one is the
    // normal case rather than the multi-id error arm.
    expect(FISHING_BAND_INTRODUCED_CATCH.slice(0, 3)).toEqual([null, null, null]);
    expect(FISHING_BAND_INTRODUCED_CATCH.slice(3)).toEqual([
      'raw_deepbarb_catfish',
      'raw_hollowgill_sturgeon',
      'raw_stillmere_salmon',
    ]);
  });

  it('is DERIVED from the tables, not a second hand-written list', () => {
    // Recompute it here from the live tables and compare. Read this arm for
    // exactly what it is: the recomputation walks the SAME algorithm the export
    // does (union of the bands below, ids band b adds, single-introducer or
    // null), so it proves the export is DERIVED rather than hand-written, and
    // nothing more. It cannot rule on whether that algorithm is the right one.
    // The literal-contents arm above is the decisive half.
    for (const [band, byZone] of FISHING_TABLES_BY_BAND.entries()) {
      const below = new Set<string>();
      for (let b = 0; b < band; b++) {
        for (const rows of Object.values(FISHING_TABLES_BY_BAND[b])) {
          for (const row of rows) if (row.itemId) below.add(row.itemId);
        }
      }
      const added = new Set<string>();
      for (const rows of Object.values(byZone)) {
        for (const row of rows) if (row.itemId && !below.has(row.itemId)) added.add(row.itemId);
      }
      expect(FISHING_BAND_INTRODUCED_CATCH[band], `band ${band}`).toBe(
        added.size === 1 ? [...added][0] : null,
      );
    }
  });

  it('every id it names is a real, market-listable raw cooking catch', () => {
    let named = 0;
    for (const id of FISHING_BAND_INTRODUCED_CATCH) {
      if (id === null) continue;
      named += 1;
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, id).toBe('junk');
      expect(isRawCookingCatch(id), id).toBe(true);
      // R18: a catch a rod tooltip advertises must be one a player can buy.
      expect(def.soulbound ?? false, id).toBe(false);
      expect(def.noMarketList ?? false, id).toBe(false);
    }
    // Non-vacuity: the loop above must actually have run three times.
    expect(named).toBe(3);
  });

  it('a band introducing TWO ids reads null rather than picking a winner', () => {
    // The ambiguity arm, driving the SHIPPED rule. This used to re-type the
    // export's body as a local helper and assert against that, which proved
    // only that the test's own copy behaved: rv-tests deleted the `size === 1`
    // rule from src/sim/content/items.ts and the whole suite stayed green. The
    // fix was structural rather than another assertion. `introducedCatchFor`
    // is the real rule, taking the table set as a parameter, and the exported
    // constant is now its thin consumer over the live tables, so this fixture
    // reaches the production code the tooltip reads.
    //
    // The branch matters because no shipped table exercises it: every high band
    // adds exactly one catch today, so without a fixture the refusal-to-choose
    // rule would ship untested and a future two-catch band would silently name
    // one of them at random in the rod tooltip.
    const twoNew = [
      { eastbrook_vale: [{ itemId: 'raw_mirror_trout', weight: 100 }] },
      {
        eastbrook_vale: [
          { itemId: 'raw_mirror_trout', weight: 50 },
          { itemId: 'raw_river_perch', weight: 25 },
          { itemId: 'raw_marsh_pike', weight: 25 },
        ],
      },
    ];
    expect(introducedCatchFor(twoNew, 1)).toBeNull();
    // And the same shape with ONE new id does resolve, so the null above is
    // the ambiguity rule rather than the function never resolving anything.
    const oneNew = [
      { eastbrook_vale: [{ itemId: 'raw_mirror_trout', weight: 100 }] },
      {
        eastbrook_vale: [
          { itemId: 'raw_mirror_trout', weight: 60 },
          { itemId: 'raw_river_perch', weight: 40 },
        ],
      },
    ];
    expect(introducedCatchFor(oneNew, 1)).toBe('raw_river_perch');
    // Band 0 is null BY DEFINITION, not by ambiguity: a fixture whose band 0
    // adds exactly one id still reads null there, which is the arm that keeps
    // the early return from being mistaken for a case of the rule above.
    expect(introducedCatchFor(oneNew, 0)).toBeNull();
    // THE SEAM IS REAL: the shipped constant is this same function over the
    // live tables, every band. Without this the extraction could drift into two
    // rules, one tested and one shipped, which is the defect it exists to fix.
    expect(
      FISHING_TABLES_BY_BAND.map((_t, band) => introducedCatchFor(FISHING_TABLES_BY_BAND, band)),
    ).toEqual([...FISHING_BAND_INTRODUCED_CATCH]);
  });
});

describe('the DECISION F casts-to-200 model (Phase 11i)', () => {
  // Which water the R19 teaching ceiling FORCES for each fifty-point segment,
  // and the cheapest rod that water takes (fishing_zones.ts). Deliberately the
  // minimum rod: a better-equipped angler climbs faster, so this is the slow
  // reference, not an optimistic one.
  const SEGMENTS = [
    { from: 0, zoneId: 'eastbrook_vale', rodTier: 1 },
    { from: 50, zoneId: 'eastbrook_vale', rodTier: 1 },
    { from: 100, zoneId: 'mirefen_marsh', rodTier: 2 },
    { from: 150, zoneId: 'thornpeak_heights', rodTier: 3 },
  ] as const;

  /** The reference cast cycle: the mean seeded bite wait for this rod tier,
   *  plus the shipped BASE reel window (a better rod's wider window is margin,
   *  not time spent), plus the one tick the re-press lands on. */
  const cycleSecFor = (rodTier: number): number =>
    (FISH_BITE_DELAY_MIN_SEC + fishBiteMaxSecFor(rodTier)) / 2 + FISH_REEL_WINDOW_SEC + DT;

  /** The share of casts that TEACH, read off the live cell table for the band
   *  the segment fishes: everything but the empty hook, minus the grey junk
   *  once the junk cutoff bites. */
  const teachShareFor = (zoneId: string, band: number, proficiency: number): number => {
    const rows = FISHING_TABLES_BY_BAND[band][zoneId];
    const total = rows.reduce((sum, r) => sum + r.weight, 0);
    let teaching = 0;
    for (const row of rows) {
      if (row.itemId === null) continue;
      const isGreyJunk = ITEMS[row.itemId]?.kind === 'junk' && !isRawCookingCatch(row.itemId);
      if (isGreyJunk && proficiency >= FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY) continue;
      teaching += row.weight;
    }
    return teaching / total;
  };

  /** Seconds the reference angler spends on one fifty-point segment. */
  const segmentSeconds = (index: number, gain: number): number => {
    const seg = SEGMENTS[index];
    const band = Math.min(fishingCatchBandFor(seg.from), fishingRodBandFor(seg.rodTier));
    const catches = 50 / gain;
    const casts = catches / teachShareFor(seg.zoneId, band, seg.from);
    return casts * cycleSecFor(seg.rodTier);
  };

  const evaluate = (gains: readonly number[]) => {
    const sec = gains.map((g, i) => segmentSeconds(i, g));
    const total = sec.reduce((a, b) => a + b, 0);
    return { sec, total, hours: total / 3600, shares: sec.map((x) => x / total) };
  };

  const SPAN_MIN_HOURS = 10;
  const SPAN_MAX_HOURS = 12;
  const BAND_SHARE_CAP = 1 / 3;

  it('the model reproduces the SHIPPED schedule as the chore the ruling describes', () => {
    // Non-vacuity for everything below: the model has to be able to SEE the
    // defect, or its verdict on the fix means nothing. Under the pre-phase
    // values the last fifty points are the overwhelming majority of the climb.
    const shipped = evaluate([1, 0.5, 0.1, 0.02]);
    expect(shipped.shares[3]).toBeGreaterThan(0.75);
    expect(shipped.sec[3] / 3600).toBeGreaterThan(5);
  });

  it('the SHIPPED literals satisfy the settled span and the one-third cap', () => {
    const gains = FISHING_GAIN_SCHEDULE.map((row) => row.gain);
    const r = evaluate(gains);
    expect(r.hours).toBeGreaterThanOrEqual(SPAN_MIN_HOURS);
    expect(r.hours).toBeLessThanOrEqual(SPAN_MAX_HOURS);
    for (const [i, share] of r.shares.entries()) {
      expect(share, `band ${i} share`).toBeLessThanOrEqual(BAND_SHARE_CAP);
    }
    // A genuine RAMP, not a flat curve: each band costs at least the one
    // before it, which is what keeps the early climb the cheapest.
    for (let i = 1; i < r.sec.length; i++) expect(r.sec[i]).toBeGreaterThanOrEqual(r.sec[i - 1]);
    // Strictly decreasing gains: a real curve, not two rungs sharing a value.
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1]);
    // Every value sits on the 0.01 grid the search ran over.
    for (const g of gains) expect(Math.round(g * 100)).toBeCloseTo(g * 100, 10);
  });

  it('the four literals ARE the search result: re-run the selection and get them back', () => {
    // THE DERIVATION, run rather than described. Among 0.01-grid
    // non-increasing schedules inside the span, with a genuine ramp and no
    // band over a third, take the STRICTLY decreasing ones (a real curve) and
    // of those the one nearest the span midpoint. That is a total order, so
    // the answer is unique and it must be what ships.
    const grid: number[] = [];
    for (let v = 1; v <= 100; v++) grid.push(v / 100);
    const midpoint = (SPAN_MIN_HOURS + SPAN_MAX_HOURS) / 2;
    let legal = 0;
    let strict = 0;
    let best: { gains: number[]; distance: number } | null = null;
    for (const g0 of grid)
      for (const g1 of grid) {
        if (g1 > g0) continue;
        for (const g2 of grid) {
          if (g2 > g1) continue;
          for (const g3 of grid) {
            if (g3 > g2) continue;
            const r = evaluate([g0, g1, g2, g3]);
            if (r.hours < SPAN_MIN_HOURS || r.hours > SPAN_MAX_HOURS) continue;
            let ramp = true;
            for (let i = 1; i < 4; i++) if (r.sec[i] < r.sec[i - 1]) ramp = false;
            if (!ramp) continue;
            if (Math.max(...r.shares) > BAND_SHARE_CAP) continue;
            legal++;
            if (!(g1 < g0 && g2 < g1 && g3 < g2)) continue;
            strict++;
            const distance = Math.abs(r.hours - midpoint);
            if (!best || distance < best.distance) best = { gains: [g0, g1, g2, g3], distance };
          }
        }
      }
    // The search space really is narrow, and it really does discriminate:
    // sixteen schedules clear every constraint and only three of those are
    // strictly decreasing. Pinned so a loosened constraint (which would let
    // hundreds through and make the pick arbitrary) reds here.
    expect(legal).toBe(16);
    expect(strict).toBe(3);
    expect(best).not.toBeNull();
    expect(best?.gains).toEqual(FISHING_GAIN_SCHEDULE.map((row) => row.gain));
  });

  it('the per-band hours are what the ledger recorded, to the minute', () => {
    // PREDICTED IN THE LEDGER BEFORE THIS RAN: 1.55 / 2.48 / 3.29 / 3.61
    // hours, 10.94 total, shares 14.2 / 22.7 / 30.1 / 33.0 percent.
    const r = evaluate(FISHING_GAIN_SCHEDULE.map((row) => row.gain));
    const hours = r.sec.map((s) => Math.round((s / 3600) * 100) / 100);
    expect(hours).toEqual([1.55, 2.48, 3.29, 3.61]);
    expect(Math.round(r.hours * 100) / 100).toBe(10.94);
    expect(r.shares.map((s) => Math.round(s * 1000) / 10)).toEqual([14.2, 22.7, 30.1, 33]);
  });

  it('the band BOUNDARIES did not move, and the teaching ceilings still derive from them', () => {
    // DECISION F moves VALUES only. fishingTeachingCeilingFor reads the
    // boundaries, so a moved one would silently re-gate which water teaches.
    expect(FISHING_GAIN_SCHEDULE.map((row) => row.belowProficiency)).toEqual([50, 100, 150, 200]);
    expect(fishingTeachingCeilingFor(1)).toBe(100);
    expect(fishingTeachingCeilingFor(2)).toBe(150);
    expect(fishingTeachingCeilingFor(3)).toBe(200);
    // And the junk cutoff is untouched.
    expect(FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY).toBe(100);
  });
});

describe('the DECISION B regression walk: nobody loses access (Phase 11i)', () => {
  const MAX_ROD_TIER = 6;
  const walk = () => {
    const lower: string[] = [];
    const moved: { proficiency: number; rodTier: number; from: number; to: number }[] = [];
    let pairs = 0;
    for (let proficiency = 0; proficiency <= 200; proficiency++) {
      for (let rodTier = 1; rodTier <= MAX_ROD_TIER; rodTier++) {
        pairs++;
        const before = prePhaseEffectiveBand(proficiency, rodTier);
        const after = Math.min(fishingCatchBandFor(proficiency), fishingRodBandFor(rodTier));
        if (after < before) lower.push(`p${proficiency} t${rodTier}: ${before} -> ${after}`);
        else if (after > before) moved.push({ proficiency, rodTier, from: before, to: after });
      }
    }
    return { pairs, lower, moved };
  };

  it('every (proficiency, rod tier) pair resolves AT OR ABOVE its pre-phase band', () => {
    const { pairs, lower } = walk();
    // THE DOMAIN, AS A LITERAL. `201 * MAX_ROD_TIER` re-derives the count from
    // the same two bounds the walk loops over, so it held whatever the walk
    // did: shrink the walk to one rod tier and both sides fell together. The
    // ledger's claim is that the acceptance domain is 1206 pairs, so that is
    // the number pinned, with the composition kept beside it as the reason
    // rather than as the assertion.
    expect(pairs, 'proficiency 0..200 crossed with rod tier 1..6').toBe(1206);
    expect(201 * MAX_ROD_TIER, 'and the bounds still compose to it').toBe(1206);
    expect(lower).toEqual([]);
  });

  it('the pairs that MOVE are exactly the set the ledger predicted, and it is not empty', () => {
    // Predicted from the derivation above before this ran: 203 pairs move and
    // nothing else does.
    //   200 pairs  proficiency 150-199 x rod tier 3-6   band 1 -> 2
    //     1 pair   proficiency 200     x rod tier 4     band 2 -> 3
    //     1 pair   proficiency 200     x rod tier 5     band 2 -> 4
    //     1 pair   proficiency 200     x rod tier 6     band 2 -> 5
    const { moved } = walk();
    expect(moved).toHaveLength(203);
    // Non-vacuity, stated as its own assertion rather than implied by the
    // count: a walk that moved NOTHING would make the arm above pass too.
    expect(moved.length).toBeGreaterThan(0);

    const midClimb = moved.filter((m) => m.proficiency >= 150 && m.proficiency <= 199);
    expect(midClimb).toHaveLength(200);
    expect(new Set(midClimb.map((m) => m.rodTier))).toEqual(new Set([3, 4, 5, 6]));
    expect(new Set(midClimb.map((m) => `${m.from}->${m.to}`))).toEqual(new Set(['1->2']));

    const atCap = moved
      .filter((m) => m.proficiency === 200)
      .sort((a, b) => a.rodTier - b.rodTier)
      .map((m) => [m.rodTier, m.from, m.to]);
    expect(atCap).toEqual([
      [4, 2, 3],
      [5, 2, 4],
      [6, 2, 5],
    ]);

    // The two shipped crafted rods are the point of the whole phase: before
    // it, tier 4 and tier 5 resolved to the SAME band a tier-3 rod did.
    expect(prePhaseEffectiveBand(200, 3)).toBe(prePhaseEffectiveBand(200, 5));
    expect(Math.min(fishingCatchBandFor(200), fishingRodBandFor(3))).not.toBe(
      Math.min(fishingCatchBandFor(200), fishingRodBandFor(5)),
    );
  });

  it('land gathering is untouched at every proficiency the walk covers', () => {
    // The other half of DECISION B: fishing moved, the SHARED ladder did not.
    for (let proficiency = 0; proficiency <= 200; proficiency++) {
      expect(proficiencyBandFor(proficiency), `land band at ${proficiency}`).toBe(
        prePhaseProficiencyBand(proficiency),
      );
    }
  });
});

// Literal band-0 rows (order included). NEVER derive these from the content
// table: the whole point is to red-flag drift in the source. Eastbrook asks
// for band 0, so its row is the starter table it has always been apart from
// the koi, which moved onto the skill scale; Mirefen and Thornpeak are what a
// band-0 angler gets for fishing one and two bands over their head.
const B0_ROWS: Record<string, { itemId: string | null; weight: number }[]> = {
  eastbrook_vale: [
    { itemId: TROUT, weight: 46 },
    { itemId: PERCH, weight: 31 },
    { itemId: WEED, weight: 12 },
    { itemId: KOI, weight: 1 },
    { itemId: null, weight: 10 },
  ],
  mirefen_marsh: [
    { itemId: 'raw_marsh_pike', weight: 22 },
    { itemId: 'raw_bog_eel', weight: 17 },
    { itemId: 'soggy_boot', weight: 12 },
    { itemId: WEED, weight: 13 },
    { itemId: KOI, weight: 1 },
    { itemId: null, weight: 35 },
  ],
  thornpeak_heights: [
    { itemId: 'raw_frostgill_trout', weight: 9 },
    { itemId: 'raw_stonescale_carp', weight: 7 },
    { itemId: WEED, weight: 28 },
    { itemId: KOI, weight: 1 },
    { itemId: null, weight: 55 },
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
// The rare catch is the one row that reads SKILL alone: identical in every
// zone, rising with the band, because it is the rod ladder's reagent and the
// angler who earned the band should be the one who farms it.
// Six rungs since masterwrought Phase 11i, flat at 6 from band 2 up. The
// authoring RULE behind these numbers (and the extended empty-hook, junk and
// food schedules the same phase added) is enforced in tests/fishing_zones.test.ts,
// which is the D9 authoring home; this list is the copy the liveness arms in
// THIS file read, and it must agree with that one.
const KOI_WEIGHT_BY_BAND = [1, 3, 6, 6, 6, 6];
/** Every band the live ladder actually has, so a loop cannot fall short of it. */
const ALL_BANDS = FISHING_TABLES_BY_BAND.map((_, band) => band);

function weightOf(band: number, zoneId: string, itemId: string | null): number {
  const row = FISHING_TABLES_BY_BAND[band][zoneId].find((r) => r.itemId === itemId);
  expect(row, `missing ${zoneId} band ${band} row for ${itemId ?? 'null'}`).toBeDefined();
  return row?.weight ?? Number.NaN;
}

describe('fishing table structure (pin 5)', () => {
  it('band 0 rows for all three zones literally equal the authored rows, in order', () => {
    // SIX bands since masterwrought Phase 11i. The band-0 image below is
    // untouched, which is the point: growing the ladder must leave every
    // shipped cell byte identical, and this literal walk is what says so.
    expect(FISHING_TABLES_BY_BAND).toHaveLength(6);
    for (const zoneId of ZONE_IDS) {
      expect(FISHING_TABLES_BY_BAND[0][zoneId]).toEqual(B0_ROWS[zoneId]);
    }
  });

  it('every band of every zone sums to exactly 100 and keeps the null row at weight 1 or more', () => {
    // ALL SIX BANDS. This loop stopped at 3 through masterwrought Phase 11i's
    // first pass, which meant the nine cells the phase ADDED were the only ones
    // in the game whose weights summed to nothing in particular: rv-tests moved
    // 50/34 to 49/35 in the top Vale cell and nothing anywhere reddened.
    for (const band of ALL_BANDS) {
      expect(Object.keys(FISHING_TABLES_BY_BAND[band]).sort()).toEqual([...ZONE_IDS].sort());
      for (const zoneId of ZONE_IDS) {
        const rows = FISHING_TABLES_BY_BAND[band][zoneId];
        const total = rows.reduce((sum, r) => sum + r.weight, 0);
        expect(total, `${zoneId} band ${band} weight total`).toBe(100);
        expect(weightOf(band, zoneId, null)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('glimmerfin_koi weight scales with SKILL and nothing else: 1/3/6 then flat, in every zone', () => {
    for (const band of ALL_BANDS) {
      for (const zoneId of ZONE_IDS) {
        expect(weightOf(band, zoneId, KOI), `${zoneId} band ${band} koi`).toBe(
          KOI_WEIGHT_BY_BAND[band],
        );
      }
    }
    // The row really moves, so the loop above is not six copies of one
    // number, and it moves UP: this is the only row a shortfall never touches.
    expect(KOI_WEIGHT_BY_BAND[0]).toBeLessThan(KOI_WEIGHT_BY_BAND[2]);
    // The list covers the live ladder rather than a prefix of it, which is the
    // check that would have caught this loop reading three of six bands.
    expect(KOI_WEIGHT_BY_BAND).toHaveLength(FISHING_TABLES_BY_BAND.length);
  });

  it('band steps are monotonic: food fish never lose weight, junk and empty hooks never gain', () => {
    // EVERY step, not just 0-to-1 and 1-to-2. The three steps this loop used to
    // skip are the ones where the new catches enter, so they are exactly where
    // a cell could have paid for a new row by quietly shaving an old one.
    let stepsChecked = 0;
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < FISHING_TABLES_BY_BAND.length - 1; band++) {
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
        stepsChecked += 1;
      }
    }
    // 3 zones over 5 steps. Non-vacuity: a loop bound that fell back to the old
    // 2 would report 6 here.
    expect(stepsChecked).toBe(15);
  });

  it('the three literal walks really do diverge, at the indices their comments name', () => {
    // The band pins below are only decisive because these sequences differ.
    // Asserting WHERE they differ turns that from a comment into a test: a
    // reweight that collapsed band 1 onto band 2 would leave every toEqual
    // above green on identical arrays and prove nothing about band selection.
    expect(B0_SEQ_36).not.toEqual(B1_SEQ_36);
    expect(B1_SEQ_36).not.toEqual(B2_SEQ_36);
    expect(B0_SEQ_36[9]).not.toBe(B1_SEQ_36[9]);
    expect(B1_SEQ_36[4]).not.toBe(B2_SEQ_36[4]);
    // The EXACT divergence sets, so every comment naming an index is held to
    // the recording rather than trusted: bands 0 and 1 part at 9 and 11
    // only; the two upper bands part at 4 and 16. Both sets sit inside the first
    // twelve sessions, which is what makes the 12-session slice below decisive.
    const differing01 = B0_SEQ_36.map((v, i) => (v === B1_SEQ_36[i] ? -1 : i)).filter(
      (i) => i >= 0,
    );
    expect(differing01).toEqual([9, 11]);
    const differing = B1_SEQ_36.map((v, i) => (v === B2_SEQ_36[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differing).toEqual([4, 16]);
    // The 12-session slice pins band 0 against band 2 directly, so record where
    // THAT pair parts too under the same stream.
    const differing02 = B0_SEQ_36.map((v, i) => (v === B2_SEQ_36[i] ? -1 : i)).filter(
      (i) => i >= 0,
    );
    expect(differing02).toEqual([4, 9, 11, 16]);
  });

  it('FISHING_TABLES is the identical band-0 object (alias identity, not a copy)', () => {
    expect(FISHING_TABLES).toBe(FISHING_TABLES_BY_BAND[0]);
  });

  it('the shipped bands introduce nothing, and the new bands introduce EXACTLY the three catches', () => {
    // This arm used to read "no band introduces an item id outside the band-0
    // set" and loop bands 0 to 2, which was true when three bands was the whole
    // ladder. Masterwrought Phase 11i made the title false of the game while
    // leaving it true of the loop, and a loop bound is the worst place for a
    // claim to be scoped: the arm keeps passing and stops meaning what it says.
    //
    // So it is split. The old invariant survives UNCHANGED over the bands it
    // was written about (a shipped cell may still never introduce an id), and
    // the new bands get the matching exact claim: they add these three ids and
    // no others, in this order, and no zone is exempt.
    const NEW_CATCHES = ['raw_deepbarb_catfish', 'raw_hollowgill_sturgeon', 'raw_stillmere_salmon'];
    for (const zoneId of ZONE_IDS) {
      const shipped = new Set(B0_ROWS[zoneId].map((r) => r.itemId));
      for (let band = 0; band < 3; band++) {
        for (const row of FISHING_TABLES_BY_BAND[band][zoneId]) {
          expect(shipped.has(row.itemId), `${zoneId} band ${band} id ${row.itemId}`).toBe(true);
        }
      }
      const introducedByBand: string[] = [];
      const seen = new Set(shipped);
      for (let band = 3; band < FISHING_TABLES_BY_BAND.length; band++) {
        for (const row of FISHING_TABLES_BY_BAND[band][zoneId]) {
          if (seen.has(row.itemId)) continue;
          seen.add(row.itemId);
          introducedByBand.push(row.itemId as string);
        }
      }
      expect(introducedByBand, `${zoneId} high-band introductions`).toEqual(NEW_CATCHES);
    }
    // And the three really are new to the whole table, not just to one zone: a
    // catch that already sat in a shipped cell somewhere would make the claim
    // above accidental.
    const shippedEverywhere = new Set<string | null>();
    for (let band = 0; band < 3; band++) {
      for (const rows of Object.values(FISHING_TABLES_BY_BAND[band])) {
        for (const row of rows) shippedEverywhere.add(row.itemId);
      }
    }
    for (const id of NEW_CATCHES) {
      expect(shippedEverywhere.has(id), `${id} must be new to the ladder`).toBe(false);
    }
  });
});

describe('fishing band selection liveness (pin 6)', () => {
  it('proficiency 150 resolves the band-1 Vale table: literal live-loop sequence at seed 36', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 150;
    // Band 1 also needs the tier-2 rod in bags (the silent tool
    // cap); the bag scan is rng-free. The rod narrows the bite-delay range
    // too, but the delay draw is consumed either way, so the table walk is
    // rod-independent given the band.
    sim.addItem('ironreel_fishing_rod', 1);
    teleportToValeShore(sim);
    // B1_SEQ_36 first diverges from B0_SEQ_36 at index 6 for the same rng
    // stream, so this full-walk match proves the live path actually switched
    // tables.
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B1_SEQ_36);
  });

  it('proficiency 200 resolves the band-2 Vale table: literal live-loop sequence at seed 36', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 200;
    // Band 2 needs the tier-3 rod (band b requires tool tier b + 1).
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    // Index 7 is the hunted band-discriminating cell (the rare koi here, where
    // both lower tables yield tangled weed; see the B2_SEQ_36 derivation
    // comment), so this match proves the live path resolved the TOP band, not
    // a band-1 collapse.
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B2_SEQ_36);
  });
});

// Band tool cap: catch band b requires an owned rod of tier b + 1
// (canGatherTier(rodTier, b + 1)); the effective band is min(proficiency
// band, best band the owned rod covers), capped SILENTLY (no event, no
// denial: the cast still lands a band-capped catch). The simple pole is not a
// gatherTool, so it floors to tier 1: band 0, the shipped table, stays
// reachable with just the pole (#2343 ended bare-hands casting entirely; see
// the denial pin below).
describe('fishing band tool cap (Professions 2.0)', () => {
  it('proficiency 150 with only the pole (no rod) silently caps to the band-0 table (literal sequence)', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 150;
    // The pole satisfies the implement gate (#2343) but is NOT a gatherTool,
    // so the band cap still sees no rod (tier floors to 1): the old no-rod
    // arm's intent, unchanged.
    sim.addItem('simple_fishing_pole', 1);
    teleportToValeShore(sim);
    // B0 and B1 diverge at indices 6, 9, and 14 on this stream, so the
    // full 30-session walk is decisive: band-1 proficiency without a rod
    // still walks the SHIPPED band-0 table, and nothing else changes (no
    // error, no event).
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B0_SEQ_36);
  });

  it('proficiency 250 with the tier-2 rod stays band 1: the discriminator cell yields weed', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 250;
    sim.addItem('ironreel_fishing_rod', 1);
    teleportToValeShore(sim);
    // Indices 6, 9, and 14 (perch and trout, not band 0's weed and perch)
    // prove the walk left band 0; index 7 is the hunted band DISCRIMINATOR:
    // that table draw lands where band 2 yields the rare koi but band 1 still
    // yields tangled weed (the B2_SEQ_36 derivation comment), so that cell
    // proves the tier-2 rod held the walk at band 1 despite band-2
    // proficiency.
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B1_SEQ_36);
  });

  it('proficiency 250 with the tier-3 rod reaches band 2 (the full B2 literal)', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 250;
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B2_SEQ_36);
  });

  it('a high rod never buys bands: proficiency band 0 with the tier-3 rod stays band 0', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    // Proficiency 0 resolves band 0 while the silverstream rod allows band 2,
    // so the effective band must take the PROFICIENCY arm of min(profBand,
    // allowedBand): a fresh buyer of the 150c rod cannot fish the band-2
    // table. Every other cap test binds the rod arm or the equal case, so
    // this is the only guard against the min() collapsing to allowedBand
    // alone. B0 diverges from B2 at index 6 (tangled weed against the perch)
    // and again at 7 (tangled weed against the rare koi), so 12 sessions are
    // decisive.
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 12)).toEqual(B0_SEQ_36.slice(0, 12));
  });

  it('a pole-only proficiency-0 angler still reproduces the B0 literal walk exactly', () => {
    const sim = makeSim(36);
    const meta = sim.meta(sim.playerId)!;
    // The pole keeps use: { type: 'fishing' }: it satisfies the implement
    // gate (#2343) but is not a gatherTool, so the bag scan floors to tier 1:
    // band 0 AND the tier-1 bite-delay range, so both draws of every session
    // match the B0 recording byte for byte.
    sim.addItem('simple_fishing_pole', 1);
    teleportToValeShore(sim);
    expect(catchSequenceLive(sim, meta, 30)).toEqual(B0_SEQ_36);
  });

  it('bare hands are denied at the cast: exactly one gatherDenied, zero draws, no session (#2343)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // Facing fishable water with NO implement in bags: every arm before the
    // implement gate passes and the water check would too, so the denial
    // below is attributable to the implement arm alone (and proves it sits
    // BEFORE the water check and the bite-delay draw).
    teleportToValeShore(sim);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // Exactly the one text-free denial: no error, no castStart, nothing else.
    expect(sim.events).toEqual([
      {
        type: 'gatherDenied',
        pid: sim.playerId,
        surface: 'fishing',
        professionId: 'fishing',
        requiredTier: 1,
      },
    ]);
    expect(draws).toBe(0);
    expect(sim.player.castingAbility).toBe(null);
  });

  it('useItem on every tiered rod starts the standard fishing cast', () => {
    // Derived over the live item table rather than a hand list, so a rod
    // added later cannot skip this by not being written down here.
    const rodIds = Object.values(ITEMS)
      .filter((def) => def.use?.type === 'gatherTool' && def.use.professionId === 'fishing')
      .map((def) => def.id);
    expect(rodIds.sort()).toEqual([
      'clockreel_fishing_rod',
      'ironreel_fishing_rod',
      'silverstream_fishing_rod',
      'stormreel_fishing_rod',
      'tidewrought_fishing_rod',
    ]);
    for (const rodId of rodIds) {
      const sim = makeSim(4242);
      // South shore of the vale lake, facing the center (the pin-10 idiom).
      const pz = LAKE.z - LAKE.radius - 2;
      teleportTo(sim, LAKE.x, pz);
      sim.player.facing = Math.atan2(0, LAKE.z - pz);
      sim.addItem(rodId, 1);
      sim.events = [];
      sim.useItem(rodId);
      expect(sim.player.castingAbility, rodId).toBe(FISHING_CAST_ID);
      // The visible timer is the 16 s session cap (literal on purpose), which
      // carries no bite information. It moved from 15 at masterwrought Phase
      // 11i, forced by the tier-6 rod pushing the worst legal session to 301
      // ticks against a 300-tick cap; recorded there as a ratify-or-revert.
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'castStart', ability: FISHING_CAST_ID, time: 16 }),
      );
      // The rod is a permanent tool: never consumed by the cast.
      expect(sim.countItem(rodId)).toBe(1);
    }
  });

  it('useItem on a mining pick with no vein in range: one gatherToolNoNode, no cast, no draw (#2343)', () => {
    // INVERTS the retired "safe no-op" pin: using a pick from the bags now
    // behaves like the interact press, scoped to ore veins (useGatherToolItem,
    // professions/gathering.ts). At the spawn plaza no vein sits within
    // interact range, so the click resolves to the text-free gatherToolNoNode
    // event (never a silent no-op), draws nothing, casts nothing, and keeps
    // the tool.
    const sim = makeSim(467);
    sim.addItem('copper_mining_pick', 1);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem('copper_mining_pick');
    } finally {
      sim.rng.setObserver(null);
    }
    expect(sim.events).toEqual([
      { type: 'gatherToolNoNode', pid: sim.playerId, professionId: 'mining' },
    ]);
    expect(draws).toBe(0);
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.countItem('copper_mining_pick')).toBe(1);
  });

  it('useItem on the pick standing at an ore vein starts the standard gather cast (#2343)', () => {
    const sim = makeSim(4242);
    sim.addItem('copper_mining_pick', 1);
    const vein = GATHER_NODES.find((n) => n.id === 'ore_eastbrook_1');
    if (!vein) throw new Error('missing ore_eastbrook_1');
    teleportTo(sim, vein.pos.x, vein.pos.z);
    sim.events = [];
    sim.useItem('copper_mining_pick');
    // The tier-1 pick at the tier-1 vein casts the 2.5 s base (no tool-tier
    // surplus, band 0). Asserted synchronously with zero ticks run, so the
    // nearby camp mobs can never damage-cancel the cast mid-check.
    expect(sim.player.castingAbility).toBe(GATHER_CAST_ID);
    expect(sim.player.castTotal).toBe(2.5);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: GATHER_CAST_ID, time: 2.5 }),
    );
    // The pick is a permanent tool: never consumed by the cast.
    expect(sim.countItem('copper_mining_pick')).toBe(1);
  });
});

describe('fishingResult event (pin 7)', () => {
  it('a landed catch emits the text-free fishingResult alongside the item grant', () => {
    const sim = makeSim(8);
    const meta = sim.meta(sim.playerId)!;
    sim.events = [];
    const { caught, events } = castOnce(sim, meta);
    // The first shared-stream table draw at seed 8, re-hunted after the
    // release-content sync: the tangled weed, which is still a landed catch.
    // The junk row is the deliberate choice here, since it proves junk emits
    // the event too, at its own def quality (poor), and not just food fish.
    expect(caught).toBe(WEED);
    const results = fishingResultsIn(events);
    expect(results).toHaveLength(1);
    // Exact shape: ids plus values only (the gatherResult precedent), so a
    // text field sneaking in breaks this pin.
    expect(results[0]).toEqual({
      type: 'fishingResult',
      pid: sim.playerId,
      itemId: WEED,
      quality: 'poor',
      zoneId: 'eastbrook_vale',
      band: 0,
    });
    // The loot grant still happens alongside the event.
    expect(sim.countItem(WEED)).toBe(1);
  });

  it('quality mirrors the caught ItemDef (poor for weed, uncommon for koi); silent on no-bite', () => {
    const sim = makeSim(1);
    const meta = sim.meta(sim.playerId)!;
    // Band 2, because the koi is a skill-scaled row now: at band 0 it is one
    // weight in a hundred and a short walk would not reach one. The event
    // shape under test is band-agnostic; only how long you wait is not.
    meta.gatheringProficiency.fishing = 200;
    sim.addItem('silverstream_fishing_rod', 1);
    let weedEvent: FishingResultEvent | undefined;
    let koiEvent: FishingResultEvent | undefined;
    let sawNoBite = false;
    for (let i = 0; i < 32; i++) {
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
    // The seed 4242 band-2 run covers all three arms (re-recorded after the
    // Galecrest quest-camp content pass): the weed at 11, the empty hook at
    // 13, the koi at 14 and again at 16.
    expect(sawNoBite).toBe(true);
    expect(weedEvent?.quality).toBe('poor');
    expect(koiEvent?.quality).toBe('uncommon');
  });
});

describe('landed-catch grant flags (pin 11)', () => {
  // #2430. Fishing was the one profession grant that passed NO opts to the
  // grant hub, so a landed catch printed the bite line, the hub's
  // "You receive:" line AND the reel-in line, while the generic loot ding
  // played on top of the reel cue. The catch grant now passes both stand-down
  // flags, so the fishingResult arm owns the single line and the single cue.
  // Nothing pinned this path before, which is how the double-cue shipped.
  const lootIn = (events: readonly SimEvent[]) =>
    events.filter((e) => (e as { type: string }).type === 'loot') as unknown as Array<{
      silent?: boolean;
      callerLogs?: boolean;
      text: string;
    }>;

  it('a landed catch grants silent and caller-logged, so the reel line is the only line', () => {
    const sim = makeSim(1);
    const meta = sim.meta(sim.playerId)!;
    sim.events = [];
    const { caught, events } = castOnce(sim, meta);
    // Seed 1's first band-0 cast, re-recorded after the release-content sync.
    // quest-camp content pass (any content add moves the shared rng before
    // the cast). Pinned to the fish rather than "not null" so the case still
    // proves a real catch landed, which is what makes the grant flags below
    // meaningful.
    expect(caught).toBe(TROUT);
    const loot = lootIn(events);
    expect(loot).toHaveLength(1);
    expect(loot[0].silent).toBe(true);
    expect(loot[0].callerLogs).toBe(true);
    // The event still CARRIES its text: only the client elides the line.
    expect(loot[0].text).toContain('You receive:');
    // Exactly ONE fish. Sim.addItem only appends " xN" past one unit, so the
    // absent suffix is the count. This is what makes catchLine the one
    // grant-line family that needs no quantity variant; a multi-fish catch
    // would have to add one, or the count would go unreported now that the
    // hub line no longer prints it (#2430).
    expect(loot[0].text).not.toMatch(/ x\d+\.$/);
  });

  it('a no-bite cast grants nothing at all (no loot event to flag)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    let sawNoBite = false;
    for (let i = 0; i < 30 && !sawNoBite; i++) {
      sim.events = [];
      const { caught, events } = castOnce(sim, meta);
      if (caught !== null) continue;
      sawNoBite = true;
      expect(lootIn(events)).toHaveLength(0);
    }
    expect(sawNoBite).toBe(true);
  });

  it('the Codfather quest catch keeps BOTH the hub line and the hub cue', () => {
    // The once-ever quest catch returns before the fishingResult emit, so the
    // hub line and ding are its ONLY feedback. Flagging it too (the tempting
    // "make fishing consistent" edit) would make the grant invisible and could
    // read as a lost quest item, so pin the ABSENCE of both flags.
    const { sim, meta } = codfatherSim();
    sim.events = [];
    completeFishing(sim.ctx, sim.player, meta);
    expect(sim.countItem('the_codfather')).toBe(1);
    const loot = lootIn(sim.events);
    expect(loot).toHaveLength(1);
    expect(loot[0].silent).toBeUndefined();
    expect(loot[0].callerLogs).toBeUndefined();
    // And it has no result event of its own to own a line with.
    expect(fishingResultsIn(sim.events)).toHaveLength(0);
  });
});

describe('fishing deeds through the extracted module path (pin 9)', () => {
  it('a landed real fish via completeFishing still marks fish:<zone>', () => {
    // Seed 4, re-hunted after the release-content sync: the first cast lands
    // the perch.
    const sim = makeSim(4);
    const meta = sim.meta(sim.playerId)!;
    expect(meta.deedStats.visited.has('fish:eastbrook_vale')).toBe(false);
    const { caught } = castOnce(sim, meta);
    expect(caught).toBe(PERCH); // a real fish, so the ZONE_FISH filter passes
    expect(meta.deedStats.visited.has('fish:eastbrook_vale')).toBe(true);
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('chr_vale_first_cast')).toBe(true);
  });

  it('ACCEPTED DRIFT, NARROWED BY DECISION F: fishing still completes prog_first_harvest, no longer on the first catch', () => {
    // prog_first_harvest ("Harvest your first gathering node", trigger
    // gathering amount 1) is satisfied by fishing at all because fishing is a
    // full gathering proficiency and the trigger counts any profession at 1
    // or more. That was DRIFT rather than design, and 11i's gain retune
    // narrows it without closing it: one catch used to grant a whole point,
    // so the deed fired on the very first fish; band 0 now grants 0.08, so it
    // takes ceil(1 / 0.08) = 13 landed catches. A first LAND node still
    // grants it instantly (the land curve is untouched), and the deed that
    // should fire on a first cast, chr_vale_first_cast, still does (the arm
    // above). Both halves are asserted so the narrowing is pinned in both
    // directions rather than described.
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_first_harvest')).toBe(false);

    // ONE catch is no longer enough, which is the half a re-tune upward would
    // silently undo.
    let landed = 0;
    for (let i = 0; i < 60 && landed < 1; i++) if (castOnce(sim, meta).caught !== null) landed++;
    expect(landed).toBe(1);
    sim.tick();
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBe(FISHING_GAIN_SCHEDULE[0].gain);
    expect(meta.deedsEarned.has('prog_first_harvest')).toBe(false);

    // And the deed is still REACHABLE by fishing alone, at the catch count
    // the schedule's first row derives.
    const needed = Math.ceil(1 / FISHING_GAIN_SCHEDULE[0].gain);
    expect(needed).toBe(13);
    for (let i = 0; i < 400 && landed < needed; i++) {
      if (castOnce(sim, meta).caught !== null) landed++;
    }
    expect(landed, 'the drive must land the full count').toBe(needed);
    sim.tick();
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.gatheringProficiency.fishing).toBeGreaterThanOrEqual(1);
    expect(meta.deedsEarned.has('prog_first_harvest')).toBe(true);
  });

  it('ACCEPTED DRIFT (documented semantic): prog_master_gatherer counts fishing', () => {
    // The three-at-100 trigger counts EVERY gathering profession, so
    // mining + logging + fishing at 100 completes it without herbalism.
    const sim = makeSim(467);
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

  it('a fished sunglint koi logs the rare-catch line and completes col_glimmerfin', () => {
    // Acceptance criterion 3: the rare catch and its deed complete unchanged
    // through the extracted module path. col_glimmerfin is a collectItems
    // trigger riding the addItem collection path, so a real completeFishing
    // koi must credit it end to end. Driven at band 2, the band the koi row is
    // now weighted for; the deed itself has no band condition.
    const sim = makeSim(4);
    const meta = sim.meta(sim.playerId)!;
    meta.gatheringProficiency.fishing = 200;
    sim.addItem('silverstream_fishing_rod', 1);
    let koiAt = -1;
    // Seed 4, re-hunted after the release-content sync: the band-2 walk still
    // lands a single koi inside the same six casts.
    for (let i = 0; i < 6; i++) {
      if (castOnce(sim, meta).caught === KOI) koiAt = i;
    }
    expect(koiAt).toBe(5);
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
  it('all five text deny arms refuse with the exact error and never start the cast', () => {
    // The dead/combat/swimming/busy cases below run TOOLLESS on purpose:
    // each still gets its exact text error, pinning that those arms precede
    // the #2343 implement gate (which would otherwise emit gatherDenied).
    // The implement arm itself is text-free and pinned in the band tool cap
    // suite's bare-hands denial test.
    const sim = makeSim(467);
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
    // every sample distance. Reaching this arm now requires tackle in bags
    // (#2343: the implement gate sits between the busy arm and the water
    // check), so the pole goes in first.
    sim.addItem('simple_fishing_pole', 1);
    denyCase(
      () => {
        sim.player.facing = Math.PI;
      },
      () => {},
      'You need to face fishable water.',
    );
  });

  it('facing the vale lake starts the capped session and draws exactly the one bite delay', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1); // the implement gate (#2343); draw-free, tier stays 1
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // The live-loop cast INVERTS the old zero-draw pin: the cast start draws
    // EXACTLY the one hidden bite delay. The visible timer is the FIXED 15 s
    // session cap (literal on purpose: comparing against the imported
    // constant would pin nothing) and carries zero bite information.
    expect(draws).toBe(1);
    expect(sim.player.castingAbility).toBe('fishing');
    // 16 since masterwrought Phase 11i: the defensive session cap took a second
    // so the tier-6 epic rung's reel window cannot be truncated by the timeout
    // (the derivation is in professions/fishing.ts).
    expect(sim.player.castTotal).toBe(16);
    expect(sim.player.castRemaining).toBe(16);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'fishing', time: 16 }),
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
    // The accrual is the schedule's band-0 row, read off it rather than
    // restated: this arm is about the value REACHING the mirror intact, and
    // the value itself is DECISION F's, pinned as a literal in the schedule
    // arm. A fractional amount is the interesting case for the wire, because
    // an integer field would have truncated it to zero.
    const bandZeroGain = FISHING_GAIN_SCHEDULE[0].gain;
    expect(bandZeroGain).toBe(0.08);
    expect(meta.gatheringProficiency.fishing).toBe(bandZeroGain);

    // The gprof delta carries the accrual to the client mirror.
    (server as any).broadcastSnapshots();
    const delta = lastSnap(fcA.sent);
    expect(delta).not.toBeNull();
    (client as any).applySnapshot(delta);
    expect(client.gatheringProficiency.fishing).toBe(bandZeroGain);
  });

  it('an empty-hook reel routes the personal fishingEmptyHook to the angler only', () => {
    // The telemetry-only sibling of the routed trio above: no client handler
    // exists by design (the player-visible half is the "No fish are biting."
    // log line), but the event still rides the same personal routing, and
    // this is the one arm of the four that had no online pin.
    // Explicit budget (vite.config.ts's "deliberately long walkers keep their own explicit
    // budgets"): the loop is seeded and deterministic, so it always runs its full 100
    // sessions * 200 ticks, measured at about 5.2s, which occasionally brushes the shared
    // 20s default under full-suite parallel load.
    const { server, fcA, fcB, sa, angler } = setupAngler();
    let empty = false;
    for (let session = 0; session < 100 && !empty; session++) {
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
      server.sim.useItem('simple_fishing_pole', sa.pid); // the reel
      (server as any).routeEvents(server.sim.drainEvents());
      empty = deliveredEvents(fcA).some((ev) => ev.type === 'fishingEmptyHook');
      expect(deliveredEvents(fcB).some((ev) => ev.type === 'fishingEmptyHook')).toBe(false);
      server.sim.tick();
    }
    expect(empty).toBe(true);
  }, 60_000);

  it('a pre-bite re-press over the live server reels in early: personal fishingEarlyReel, no busy error, recast allowed', () => {
    const { server, fcA, fcB, sa, angler } = setupAngler();
    // The probe cast is live and pre-bite straight out of setup. Ride the
    // real loop past the grace but under the 3 s bite floor.
    expect(angler.castingAbility).toBe(FISHING_CAST_ID);
    expect(angler.fishBiteAtTick).toBeGreaterThan(0);
    for (let i = 0; i < 25; i++) server.sim.tick();
    expect(angler.fishBiteAtTick).toBeGreaterThan(server.sim.tickCount);
    server.sim.useItem('simple_fishing_pole', sa.pid); // the spam press
    (server as any).routeEvents(server.sim.drainEvents());
    expect(angler.castingAbility).toBe(null);
    // The personal event reached the angler only, and no busy error did.
    expect(deliveredEvents(fcA).some((ev) => ev.type === 'fishingEarlyReel')).toBe(true);
    expect(deliveredEvents(fcB).some((ev) => ev.type === 'fishingEarlyReel')).toBe(false);
    expect(deliveredEvents(fcA).some((ev) => ev.type === 'error')).toBe(false);
    // The early reel costs only the cast: the recast starts immediately.
    server.sim.useItem('simple_fishing_pole', sa.pid);
    expect(angler.castingAbility).toBe(FISHING_CAST_ID);
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

describe('the reel is exempt from the in-combat gate', () => {
  it('aggro during the bite wait no longer eats a valid reel', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta); // the bite-delay draw
      expect(p.castingAbility).toBe(FISHING_CAST_ID);
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta); // fires the bite, arms the reel window
      expect(p.fishReelDeadlineTick).toBeGreaterThan(0);
      // Something aggroes during the wait: proximity aggro sets inCombat
      // with no landed hit, so the armed reel is still valid.
      p.inCombat = true;
      sim.events = [];
      startFishing(sim.ctx, p, meta); // the reel: the table draw
    } finally {
      sim.rng.setObserver(null);
    }
    // The catch LANDS: session ended cleanly, the table draw was spent, and
    // no combat denial fired.
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(2);
    expect(
      sim.events.some(
        (e) =>
          (e as { type: string; success?: boolean }).type === 'castStop' &&
          (e as { success?: boolean }).success === true,
      ),
    ).toBe(true);
    expect(
      sim.events.some(
        (e) =>
          (e as { type: string; text?: string }).type === 'error' &&
          (e as { text?: string }).text === "You can't do that while in combat.",
      ),
    ).toBe(false);
    p.inCombat = false;
  });

  it('in combat with NO armed reel, a re-press reels in early instead of a free denial (order pin)', () => {
    // Pre-bite: the session runs but the deadline is unarmed. The early-reel
    // arm sits ABOVE the combat denial for the same reason the reel arm does:
    // were the denial to win, an in-combat spammer would get free no-op
    // presses until the bite armed the window and the hoisted reel arm landed
    // the catch anyway (the spam-click exploit, combat variant).
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.fishReelDeadlineTick).toBe(0);
    // Past the grace (aggro can arrive any time during the 3 to 8 s wait).
    for (let t = 0; t < Math.round(FISH_EARLY_REEL_GRACE_SEC / DT); t++) {
      sim.tickCount += 1;
      updateCasting(sim.ctx, p, meta);
    }
    p.inCombat = true;
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    // The session ended as an early reel: no combat denial, no draw spent.
    expect(sim.events.some((e) => (e as { type: string }).type === 'error')).toBe(false);
    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'fishingEarlyReel' }));
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(0);
    p.inCombat = false;
  });

  it('a reel past the deadline still gets the busy error, in combat or not (the miss arm owns that tick)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    // One past the deadline: the miss arm owns this tick, not the reel.
    sim.tickCount = p.fishReelDeadlineTick + 1;
    sim.events = [];
    startFishing(sim.ctx, p, meta);
    expect(
      sim.events.some(
        (e) =>
          (e as { type: string; text?: string }).type === 'error' &&
          (e as { text?: string }).text === 'You are busy.',
      ),
    ).toBe(true);
  });
});

describe('a pre-bite re-press reels in early: the spam-click exploit stays closed', () => {
  // THE EXPLOIT THIS PINS SHUT: a re-press before the bite used to fall
  // through to the free "You are busy." no-op, so holding the pole button on
  // a spam cadence was a guaranteed catch: one of the presses always fell
  // inside the armed reel window, and the reaction minigame (attention over
  // reflexes, docs/design/professions.md) never happened. Now every pre-bite
  // press reels the line in empty and ends the session, so spam casts and
  // cancels forever and only a press that answers the BITE can land a fish.
  it('spam-pressing the pole never lands a reel', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    const before = new Map(VALE_CATCH_IDS.map((id) => [id, sim.countItem(id)]));
    // 100 press cycles at 4 ticks (0.2 s) apart: pre-fix the first session's
    // bite (3 to 8 s in) always armed the window under a live session and the
    // next spam press landed the reel. Post-fix a session survives only the
    // grace (1 s): presses inside it are busy no-ops, the first press past
    // it reels in early, and no session ever reaches the 3 s bite floor.
    for (let i = 0; i < 100; i++) {
      if (p.castingAbility !== FISHING_CAST_ID) startFishing(sim.ctx, p, meta);
      for (let t = 0; t < 4; t++) {
        sim.tickCount += 1;
        updateCasting(sim.ctx, p, meta);
      }
      startFishing(sim.ctx, p, meta); // the spam press
    }
    const earlyReels = sim.events.filter(
      (e) => (e as { type: string }).type === 'fishingEarlyReel',
    ).length;
    // No reel ever resolved: no landed catch, no empty hook, no successful
    // castStop, no item, no proficiency grant. Sessions die on the first
    // press past the grace: 5 cycles each (ages 4/8/12/16 busy, 20 reels
    // early), so 100 cycles is exactly 20 early reels.
    expect(fishingResultsIn(sim.events)).toHaveLength(0);
    expect(sim.events.some((e) => (e as { type: string }).type === 'fishingEmptyHook')).toBe(false);
    expect(sim.events.some((e) => (e as { type: string }).type === 'fishingBite')).toBe(false);
    expect(
      sim.events.some(
        (e) =>
          (e as { type: string; success?: boolean }).type === 'castStop' &&
          (e as { success?: boolean }).success === true,
      ),
    ).toBe(false);
    for (const id of VALE_CATCH_IDS) expect(sim.countItem(id)).toBe(before.get(id));
    expect(meta.pendingGatherGrants).toHaveLength(0);
    expect(earlyReels).toBe(20);
  });

  it('the grace stays strictly under the bite floor, or spam would be free again (derivation pin)', () => {
    // Were FISH_EARLY_REEL_GRACE_SEC ever tuned to reach
    // FISH_BITE_DELAY_MIN_SEC, presses inside the grace would be free no-ops
    // all the way to an armed reel window and the spam-click exploit would
    // reopen. The margin is two full seconds today.
    expect(FISH_EARLY_REEL_GRACE_SEC).toBeLessThan(FISH_BITE_DELAY_MIN_SEC);
  });

  it('inside the grace a re-press is the busy no-op and the session survives (double-press guard)', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    // One tick in (a bag double-click, key auto-repeat): still the busy
    // denial, session untouched, no draw.
    sim.tickCount += 1;
    updateCasting(sim.ctx, p, meta);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You are busy.' }),
    );
    expect(sim.events.some((e) => (e as { type: string }).type === 'fishingEarlyReel')).toBe(false);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(draws).toBe(0);
  });

  it('the grace boundary is exact: the last in-grace tick denies, the first past it reels early', () => {
    const graceTicks = Math.round(FISH_EARLY_REEL_GRACE_SEC / DT);
    // One tick short of the grace: still the busy denial.
    {
      const sim = makeSim(467);
      const meta = sim.meta(sim.playerId)!;
      teleportToValeShore(sim);
      sim.addItem('simple_fishing_pole', 1);
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      for (let t = 0; t < graceTicks - 1; t++) {
        sim.tickCount += 1;
        updateCasting(sim.ctx, p, meta);
      }
      sim.events = [];
      startFishing(sim.ctx, p, meta);
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'error', text: 'You are busy.' }),
      );
      expect(p.castingAbility).toBe(FISHING_CAST_ID);
    }
    // Exactly the grace: the early reel ends the session.
    {
      const sim = makeSim(467);
      const meta = sim.meta(sim.playerId)!;
      teleportToValeShore(sim);
      sim.addItem('simple_fishing_pole', 1);
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      for (let t = 0; t < graceTicks; t++) {
        sim.tickCount += 1;
        updateCasting(sim.ctx, p, meta);
      }
      sim.events = [];
      startFishing(sim.ctx, p, meta);
      expect(sim.events).toContainEqual(expect.objectContaining({ type: 'fishingEarlyReel' }));
      expect(p.castingAbility).toBeNull();
    }
  });

  it('the early reel ends the session draw-free with the pinned zone and no busy error', () => {
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    const pinnedZone = p.fishCastZoneId;
    expect(pinnedZone).not.toBe('');
    // Ride past the double-press grace (1 s), still well before the 3 s
    // bite floor.
    for (let t = 0; t < Math.round(FISH_EARLY_REEL_GRACE_SEC / DT); t++) {
      sim.tickCount += 1;
      updateCasting(sim.ctx, p, meta);
    }
    expect(p.fishBiteAtTick).toBeGreaterThan(sim.tickCount); // still pre-bite
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta); // the early re-press
    } finally {
      sim.rng.setObserver(null);
    }
    // Session over, hidden state cleared, zero draws (the one-draw-per-cast
    // contract: a session that ends early spent only its bite-delay draw).
    expect(draws).toBe(0);
    expect(p.castingAbility).toBeNull();
    expect(p.fishBiteAtTick).toBe(0);
    expect(p.fishReelDeadlineTick).toBe(0);
    expect(p.fishCastZoneId).toBe('');
    // The event carries the rod-gate-validated cast zone and the effective
    // band, exactly like the miss family it sits beside.
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'fishingEarlyReel',
        pid: sim.playerId,
        zoneId: pinnedZone,
        band: 0,
      }),
    );
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStop', entityId: sim.playerId, success: false }),
    );
    // The old free no-op is gone, and the miss family is untouched: an early
    // reel is not a got-away (the telemetry counts them apart).
    expect(sim.events.some((e) => (e as { type: string }).type === 'error')).toBe(false);
    expect(sim.events.some((e) => (e as { type: string }).type === 'fishingGotAway')).toBe(false);
    // Recasting is immediate: the early reel costs only the cast itself.
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
  });

  it('a direct-assigned session with inert hidden state still gets the busy error', () => {
    // The parity/cancel drives assign castingAbility directly and never arm
    // fishBiteAtTick; the early-reel arm keys on a LIVE pre-bite session
    // (fishBiteAtTick > 0), so those drives keep the plain busy denial.
    const sim = makeSim(467);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    p.castingAbility = FISHING_CAST_ID;
    expect(p.fishBiteAtTick).toBe(0);
    sim.events = [];
    startFishing(sim.ctx, p, meta);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You are busy.' }),
    );
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    p.castingAbility = null;
  });
});

describe('fishing breaks stealth and action-locked forms refuse it', () => {
  it('an action-locked form refuses with the shapeshifted literal and zero draws', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    const p = sim.player;
    p.auras.push({
      id: 'fireball_form',
      name: 'Ember Form',
      kind: 'form_fireball',
      value: 0,
      remaining: 600,
      duration: 600,
      sourceId: p.id,
      school: 'physical',
    } as Entity['auras'][number]);
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, sim.player, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(
      sim.events.some(
        (e) =>
          (e as { type: string; text?: string }).type === 'error' &&
          (e as { text?: string }).text === "You can't do that while shapeshifted.",
      ),
    ).toBe(true);
    expect(sim.events.some((e) => (e as { type: string }).type === 'castStart')).toBe(false);
    expect(draws).toBe(0);
    // Shift out in the SAME fixture: the form was the operative cause.
    p.auras.splice(0, p.auras.length);
    startFishing(sim.ctx, sim.player, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
  });

  it('casting a line breaks stealth; a denied cast does not', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    const p = sim.player;
    const stealthAura = () =>
      ({
        id: 'stealth',
        name: 'Stealth',
        kind: 'stealth',
        value: 0,
        remaining: 600,
        duration: 600,
        sourceId: p.id,
        school: 'physical',
      }) as Entity['auras'][number];
    // Denied first (toolless: the implement gate refuses): stealth survives.
    teleportToValeShore(sim);
    p.auras.push(stealthAura());
    p.stealthed = true;
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    // Granted next: the cast start breaks it, still exactly one draw.
    sim.addItem('simple_fishing_pole', 1);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(p.stealthed).toBe(false);
    expect(draws).toBe(1);
  });
});

describe('fishing telemetry events (empty hook and the bags-full got-away)', () => {
  it('an empty hook emits the structured fishingEmptyHook beside the log line', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    // Walk the deterministic band-0 table until the null row resolves.
    let sawEmpty = false;
    for (let i = 0; i < 60 && !sawEmpty; i++) {
      const { caught, events } = castOnce(sim, meta);
      const empties = events.filter((e) => (e as { type: string }).type === 'fishingEmptyHook');
      if (caught === null && events.some((e) => (e as { type: string }).type === 'log')) {
        sawEmpty = true;
        expect(empties).toEqual([
          { type: 'fishingEmptyHook', pid: sim.playerId, zoneId: 'eastbrook_vale', band: 0 },
        ]);
      } else {
        // Non-empty outcomes never emit it.
        expect(empties).toHaveLength(0);
      }
    }
    expect(sawEmpty, 'the band-0 walk never resolved an empty hook').toBe(true);
  });

  it('a bags-full catch emits fishingGotAway (the draw was spent, the catch was lost)', () => {
    const sim = makeSim(4242);
    const meta = sim.meta(sim.playerId)!;
    const capacity = bagCapacity(
      (sim as unknown as { players: Map<number, { bags: unknown[] }> }).players.get(sim.playerId)!
        .bags as never,
    );
    const m = sim.meta(sim.playerId)! as unknown as { inventory: unknown[] };
    while (m.inventory.length < capacity) sim.addItem('bone_fragments', 20);
    // Deterministic: walk until a non-null row resolves against full bags.
    let sawGotAway = false;
    for (let i = 0; i < 60 && !sawGotAway; i++) {
      const { caught, events } = castOnce(sim, meta);
      expect(caught).toBeNull(); // nothing can land in full bags
      const aways = events.filter((e) => (e as { type: string }).type === 'fishingGotAway');
      if (aways.length > 0) {
        sawGotAway = true;
        expect(aways).toEqual([
          { type: 'fishingGotAway', pid: sim.playerId, zoneId: 'eastbrook_vale', band: 0 },
        ]);
        expect(
          events.some(
            (e) =>
              (e as { type: string; text?: string }).type === 'error' &&
              (e as { text?: string }).text === 'Your bags are full.',
          ),
        ).toBe(true);
      }
    }
    expect(sawGotAway, 'no non-null row resolved against full bags').toBe(true);
  });
});

describe('the swim deny holds for the whole session (the jump-cast bypass, round 7)', () => {
  it('a live cast cancels the tick the caster ends up swimming', () => {
    // A cast pressed mid-leap over deep water passes the press-time deny
    // (the airborne y-term sits above the surface) and used to splash into
    // a live session: the vertical splash is not the move input the
    // ordinary cancel watches. The session upkeep now enforces the same
    // deny across the session's lifetime.
    const sim = makeSim(4242);
    teleportToValeShore(sim);
    sim.addItem('simple_fishing_pole', 1);
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility, 'the cast started legally on land').toBe('fishing');
    // The splash: the player ends up in the lake's deep water mid-session.
    teleportTo(sim, LAKE.x, LAKE.z);
    sim.tick();
    expect(sim.player.castingAbility, 'the session cancelled on swim entry').toBeNull();
    // And a fresh legal cast still works afterward (cancel left no residue).
    const dry = teleportToValeShore(sim);
    void dry;
    sim.useItem('simple_fishing_pole');
    expect(sim.player.castingAbility).toBe('fishing');
  });
});
