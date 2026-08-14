// The farming ready notice (src/sim/professions/farm_ready.ts): the login
// check, the 1 Hz tick sweep, and the once-per-growth-cycle guarantee the
// persisted `notified` flag exists to make.
//
// REAL TICKS AND A MOVEABLE CLOCK, never a frozen one: every arm below drives
// sim.tick() for the sweep and moves the injected lockoutNowMs for the growth
// window, because a test that asserted against a clock that never advances
// would hang the runner rather than fail it (the sibling suite's banner).
//
// The DRAW CONTRACT clauses this file owns are the two the notice could have
// broken: "the tick sweep draws nothing" and "login / save+load draws
// nothing". Both are counted here against the real rng observer, not reasoned
// about.

import { describe, expect, it } from 'vitest';
import { FARM_CROPS, type FarmCropDef } from '../src/sim/content/farm_crops';
import { farmBedById } from '../src/sim/content/farm_patches';
import type { PlotState } from '../src/sim/professions/farm_projection';
import { harvestCrop, plantCrop } from '../src/sim/professions/farming';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const HOE_ID = 'garden_hoe';
const BED = 'bed_eastbrook_1';
const BED2 = 'bed_eastbrook_2';
const START_MS = 1_700_000_000_000;
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;

type FarmReadyEvent = Extract<SimEvent, { type: 'farmReady' }>;

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  /** Move the injected wall clock forward. */
  advance(ms: number): void;
  now(): number;
  /** Run n real ticks, returning every farmReady they drained. */
  tick(n: number): FarmReadyEvent[];
}

function makeHarness(seed = 41): Harness {
  let nowMs = START_MS;
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => nowMs,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  standAtBed(sim, BED);
  sim.addItem(HOE_ID, 1, pid);
  return {
    sim,
    pid,
    meta,
    advance: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs,
    tick: (n: number) => {
      const out: FarmReadyEvent[] = [];
      for (let i = 0; i < n; i++) {
        for (const ev of sim.tick()) if (ev.type === 'farmReady') out.push(ev);
      }
      return out;
    },
  };
}

function standAtBed(sim: Sim, bedId: string): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  const p = sim.player;
  p.pos.x = bed.x;
  p.pos.z = bed.z;
  p.pos.y = terrainHeight(bed.x, bed.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** Plant, then clear the flavor cast so the busy gate does not eat the next
 *  plant. Real play rides the cast out; these arms are about the sweep. */
function plant(h: Harness, bedId = BED): void {
  plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, CROP_ID);
  h.sim.player.castingAbility = null;
  h.sim.player.castRemaining = 0;
}

function countDraws(sim: Sim, run: () => void): number {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return draws;
}

/** Load a saved character into a fresh Sim standing at `nowMs`, returning the
 *  join's own drained events: the login check runs inside addPlayer, so its
 *  notice is whatever addPlayer left in the queue. */
function joinWith(
  saved: CharacterState,
  nowMs: number,
  seed = 41,
): { sim: Sim; meta: PlayerMeta; joinEvents: FarmReadyEvent[]; joinDraws: number } {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, lockoutNowMs: () => nowMs });
  const joinDraws = countDraws(sim, () => {
    sim.addPlayer('warrior', 'Farmer', { state: saved });
  });
  const meta = [...sim.players.values()][0] as PlayerMeta;
  const joinEvents = sim
    .drainEvents()
    .filter((e): e is FarmReadyEvent => e.type === 'farmReady' && e.pid === meta.entityId);
  return { sim, meta, joinEvents, joinDraws };
}

describe('the ready notice at login', () => {
  it('announces a crop that finished while the farmer was away, exactly once ever', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    // The whole growth window passes with the character logged out: the clock
    // moves, nothing ticks, and the plot's absolute deadline does the work.
    h.advance(CROP.durationMs + 1);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;
    // Non-vacuity: the save really carries an unannounced finished plot, so a
    // notice is genuinely owed below.
    expect(saved.farmPlots?.[BED]?.notified).toBeUndefined();

    const first = joinWith(saved, h.now());
    expect(first.joinEvents).toHaveLength(1);
    expect(first.joinEvents[0]).toEqual({ type: 'farmReady', pid: first.meta.entityId, ready: 1 });
    // The login check is state-derived: it costs the join ZERO draws, the
    // "login / save+load draws nothing" clause of the draw contract.
    expect(first.joinDraws).toBe(0);
    // The flag was flipped on the loaded plot, which is what the next save
    // carries forward.
    expect(first.meta.farmPlots.get(BED)?.notified).toBe(true);

    // The sweep in the SAME session stays silent after the login notice: two
    // full seconds of real ticks cross the 1 Hz boundary twice over a plot
    // that is still sitting ready, and the flag is what keeps them quiet.
    const sweepEvents: FarmReadyEvent[] = [];
    for (let i = 0; i < 40; i++) {
      for (const ev of first.sim.tick()) if (ev.type === 'farmReady') sweepEvents.push(ev);
    }
    expect(sweepEvents).toEqual([]);

    // A SECOND session over the same crop says nothing: the flag persisted
    // through the round trip, so relogging can never re-announce a plot.
    const savedAgain = first.sim.serializeCharacter(first.meta.entityId) as CharacterState;
    expect(savedAgain.farmPlots?.[BED]?.notified).toBe(true);
    const second = joinWith(savedAgain, h.now() + 60_000);
    expect(second.joinEvents).toEqual([]);
    expect(second.joinDraws).toBe(0);
    // And the plot is still there, still ready: silence is the flag talking,
    // not the crop having vanished.
    expect(second.sim.farmPlotsFor(second.meta.entityId)[0]?.status).toBe('ready');
  });

  it('says nothing at all for a plot that is still growing', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    h.advance(CROP.durationMs / 3);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;
    const join = joinWith(saved, h.now());
    expect(join.joinEvents).toEqual([]);
    // The negative arm's own non-vacuity: the plot loaded, and loaded as
    // growing, so the silence is about its status and not about an empty map.
    expect(join.meta.farmPlots.size).toBe(1);
    expect(join.meta.farmPlots.get(BED)?.notified).toBe(false);
    expect(join.sim.farmPlotsFor(join.meta.entityId)[0]?.status).toBe('growing');
  });

  it('counts a mixed allotment honestly: ready and withered in ONE notice', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 2, h.pid);
    plant(h, BED);
    plant(h, BED2);
    // The survival test is `survivalRoll < chance`, and chance at proficiency
    // 0 on a tier-1 crop is the at-gate 0.85: these two literals sit either
    // side of it and pin one plot to each outcome.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.01;
    (h.meta.farmPlots.get(BED2) as PlotState).survivalRoll = 0.99;
    h.advance(CROP.durationMs + 1);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;

    const join = joinWith(saved, h.now());
    expect(join.joinEvents).toHaveLength(1);
    expect(join.joinEvents[0]).toEqual({
      type: 'farmReady',
      pid: join.meta.entityId,
      ready: 1,
      withered: 1,
    });
    // Both flags flipped, so neither bed can be announced a second time.
    expect([...join.meta.farmPlots.values()].every((p) => p.notified)).toBe(true);
  });

  it('omits the withered field entirely when nothing withered', () => {
    // The wire-shape decision, pinned rather than described: `withered` is
    // ABSENT (not 0) on the common all-ready notice, which is what keeps the
    // frame minimal and the parity digest stable.
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    h.advance(CROP.durationMs + 1);
    const join = joinWith(h.sim.serializeCharacter(h.pid) as CharacterState, h.now());
    expect(join.joinEvents).toHaveLength(1);
    expect('withered' in join.joinEvents[0]).toBe(false);
    expect(Object.keys(join.joinEvents[0]).sort()).toEqual(['pid', 'ready', 'type']);
  });
});

describe('the ready notice on the 1 Hz sweep', () => {
  it('fires ONCE as a plot crosses its deadline under real ticks, then never again', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    // A full second of real ticks while the crop is still growing: the sweep
    // runs (tickCount crosses a multiple of 20) and says nothing.
    expect(h.tick(25)).toEqual([]);

    // Cross the deadline. Nothing fires AT the crossing, because there is no
    // timer: the notice arrives on the next sweep tick.
    h.advance(CROP.durationMs);
    const notices = h.tick(20);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({ type: 'farmReady', pid: h.pid, ready: 1 });

    // Two more seconds of ticks over the same untouched, still-ready plot:
    // silence. This is the arm the `notified` flag exists for, and it fails
    // the moment the flag stops gating the emit.
    expect(h.tick(45)).toEqual([]);
    expect(h.sim.farmPlotsFor(h.pid)[0]?.status).toBe('ready');
  });

  it('re-arms for the NEXT crop in the same bed, and only after it finishes', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 2, h.pid);
    plant(h);
    h.advance(CROP.durationMs);
    expect(h.tick(20)).toHaveLength(1);

    // Bring it in and plant again: plantCrop writes a fresh plot with
    // notified false, which is the ONLY thing that re-arms a bed.
    harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    plant(h);
    expect(h.meta.farmPlots.get(BED)?.notified).toBe(false);
    // Still growing: the second cycle stays quiet until it finishes, so the
    // re-arm is not just "any plant announces itself".
    expect(h.tick(40)).toEqual([]);

    h.advance(CROP.durationMs);
    const second = h.tick(20);
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({ type: 'farmReady', pid: h.pid, ready: 1 });
    expect(h.tick(40)).toEqual([]);
  });

  it('reports several beds finishing together as ONE notice carrying the count', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 2, h.pid);
    plant(h, BED);
    plant(h, BED2);
    h.advance(CROP.durationMs);
    const notices = h.tick(20);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({ type: 'farmReady', pid: h.pid, ready: 2 });
  });

  it('counts a withered plot on the sweep path too', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.99; // above the 0.85 gate
    h.advance(CROP.durationMs);
    const notices = h.tick(20);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({ type: 'farmReady', pid: h.pid, ready: 0, withered: 1 });
    // The plot really did read as withered, so the count is not a mislabelled
    // ready plot.
    expect(h.sim.farmPlotsFor(h.pid)[0]?.status).toBe('withered');
    expect(h.tick(40)).toEqual([]);
  });

  it('draws ZERO rng across the sweep that emits, and across the ones that do not', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    h.advance(CROP.durationMs);
    let emitted: FarmReadyEvent[] = [];
    // The whole tick, not just updateFarming: the notice must not move the
    // shared stream by a single draw on the tick it fires.
    const draws = countDraws(h.sim, () => {
      emitted = h.tick(20);
    });
    // Anti-vacuous: the counted window is the one that actually announced.
    expect(emitted).toHaveLength(1);
    expect(draws).toBe(0);
  });
});

describe('the ready notice is invisible to the rng stream', () => {
  it('gives twin Sims on one seed the identical draw count and event stream', () => {
    // One sim carries a finished plot into a notice while its twin runs the
    // same tick span with no plot at all. The notice must cost nothing: same
    // draws, and the twin's stream differs by exactly the farm events.
    //
    // The plot is HAND-PLACED rather than planted, the sibling suite's
    // technique: a real plant draws its two pre-roll values and would move
    // the shared stream position before the counted window even opens, which
    // is the twin's rng history and not the sweep's cost.
    const withPlot = makeHarness(909);
    const without = makeHarness(909);
    withPlot.meta.farmPlots.set(BED, {
      cropId: CROP_ID,
      plantedAtMs: withPlot.now() - CROP.durationMs,
      readyAtMs: withPlot.now(),
      survivalRoll: 0.01,
      yieldSeed: 12_345,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });

    const run = (h: Harness) => {
      let notices: FarmReadyEvent[] = [];
      const draws = countDraws(h.sim, () => {
        notices = h.tick(60);
      });
      return { draws, notices };
    };
    const a = run(withPlot);
    const b = run(without);
    expect(a.draws).toBe(b.draws);
    // Anti-vacuous twice over: the window really drew (so "equal" is not
    // "both zero"), and the plot really did announce inside it.
    expect(a.draws).toBeGreaterThan(0);
    expect(a.notices).toHaveLength(1);
    expect(b.notices).toEqual([]);
  });

  it('gives two identical farming sessions the identical notice stream', () => {
    const a = makeHarness(4242);
    const b = makeHarness(4242);
    const streams = [a, b].map((h) => {
      h.sim.addItem(SEED_ID, 2, h.pid);
      plant(h, BED);
      plant(h, BED2);
      (h.meta.farmPlots.get(BED2) as PlotState).survivalRoll = 0.99;
      h.advance(CROP.durationMs);
      return h.tick(40);
    });
    expect(streams[1]).toEqual(streams[0]);
    // Non-vacuous: the shared script really produced a mixed notice.
    expect(streams[0]).toHaveLength(1);
    expect(streams[0][0].ready).toBe(1);
    expect(streams[0][0].withered).toBe(1);
  });
});
