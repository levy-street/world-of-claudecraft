// The farm ACTION quest objective (Farming go-live): the { type: 'farm' }
// objective shape in src/sim/types.ts is credited by the plant and harvest
// ACTIONS in src/sim/professions/farming.ts through
// onCropFarmedForQuests (src/sim/quests/quest_credit.ts), the gather
// precedent: inventory cannot prove the deed (the seed is spent, produce is a
// fungible material), so bag contents never move a farm objective and a
// denied action never credits. A harvest credits on EVERY outcome, withered
// included: the visit is the deed. patchId is marker guidance only
// (src/sim/quest_targets.ts encloses that patch's beds; without it every
// farming patch draws) and never gates the credit.
//
// The quest is SYNTHETIC, injected into the mutable QUESTS record for the
// test's lifetime (the tests/profession_quest_objectives.test.ts idiom):
// the shipped intro quest is content owned elsewhere, and this suite is
// about the arm, not the row. Its giver is a real Eastbrook NPC so the
// accept/turn-in arm can ride the real quest command path.
//
// The farming harness is the tests/professions_farming.test.ts one: an
// injected, ALWAYS advanceable lockoutNowMs clock, the tier-1 hoe in bags,
// and the player standing on an Eastbrook bed.

import { afterEach, describe, expect, it } from 'vitest';
import { FARM_CROPS, type FarmCropDef } from '../src/sim/content/farm_crops';
import { FARM_PATCHES, farmBedById } from '../src/sim/content/farm_patches';
import { QUESTS } from '../src/sim/data';
import type { PlotState } from '../src/sim/professions/farm_projection';
import {
  FARM_WITHERED_HUSK_COUNT,
  FARM_WITHERED_HUSK_ITEM_ID,
  harvestCrop,
  plantCrop,
} from '../src/sim/professions/farming';
import { questObjectiveAreas } from '../src/sim/quest_targets';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { QuestDef, QuestObjective, QuestProgress, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const QUEST_ID = 'q_test_farm_objective';
const GIVER_ID = 'foreman_odell';
const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const PRODUCE_ID = 'vale_wheat';
const OTHER_CROP_ID = 'brook_carrot';
const OTHER_SEED_ID = 'brook_carrot_seed';
const HOE_ID = 'garden_hoe';
const BED = 'bed_eastbrook_1';
const PATCH_ID = 'patch_eastbrook';
const START_MS = 1_700_000_000_000;
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;

// The two-step intro shape: plant one Vale Wheat, then harvest one, both
// pinned to the Eastbrook patch for the map.
const INTRO_OBJECTIVES: QuestObjective[] = [
  {
    type: 'farm',
    action: 'plant',
    cropId: CROP_ID,
    patchId: PATCH_ID,
    count: 1,
    label: 'Vale Wheat planted',
  },
  {
    type: 'farm',
    action: 'harvest',
    cropId: CROP_ID,
    patchId: PATCH_ID,
    count: 1,
    label: 'Vale Wheat harvested',
  },
];

const originalQuest = QUESTS[QUEST_ID];
afterEach(() => {
  if (originalQuest) QUESTS[QUEST_ID] = originalQuest;
  else delete QUESTS[QUEST_ID];
});

function installQuest(objectives: QuestObjective[], opts: { retired?: boolean } = {}): QuestDef {
  const quest: QuestDef = {
    id: QUEST_ID,
    name: 'Test Farm Actions',
    giverNpcId: GIVER_ID,
    turnInNpcId: GIVER_ID,
    text: 'Test only.',
    completionText: 'Test complete.',
    objectives,
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    // Retired keeps the row invisible to the accept path (the sibling suite's
    // default); the command-path arm below installs it live instead.
    ...(opts.retired === false ? {} : { retired: true }),
  };
  QUESTS[QUEST_ID] = quest;
  return quest;
}

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  advance(ms: number): void;
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
  // The step-12 hoe gate: every plant here is about the credit, not the
  // tool. addItem draws no rng.
  sim.addItem(HOE_ID, 1, pid);
  return {
    sim,
    pid,
    meta,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function standAt(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function standAtBed(sim: Sim, bedId: string): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  standAt(sim, bed.x, bed.z);
}

/** Put the synthetic quest in the harness log directly (the sibling suite's
 *  idiom), returning the live progress row the crediter mutates. */
function trackQuest(h: Harness, objectives: QuestObjective[] = INTRO_OBJECTIVES): QuestProgress {
  installQuest(objectives);
  const qp: QuestProgress = {
    questId: QUEST_ID,
    counts: objectives.map(() => 0),
    state: 'active',
  };
  h.meta.questLog.set(QUEST_ID, qp);
  return qp;
}

function plant(h: Harness, cropId = CROP_ID, bedId = BED): void {
  plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, cropId);
}

function harvest(h: Harness, bedId = BED): void {
  harvestCrop(h.sim.ctx, h.sim.player, h.meta, bedId);
}

/** Clear the plant cast so the busy gate does not eat the NEXT plant. */
function clearCast(sim: Sim): void {
  sim.player.castingAbility = null;
  sim.player.castRemaining = 0;
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

function eventsOf<T extends SimEvent['type']>(
  sim: Sim,
  from: number,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return sim.events.slice(from).filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** The questProgress events this suite's quest emitted since `from`. */
function progressEvents(sim: Sim, from: number): Extract<SimEvent, { type: 'questProgress' }>[] {
  return eventsOf(sim, from, 'questProgress').filter((e) => e.questId === QUEST_ID);
}

/** Plant, clear the flavor cast, and move the clock past the crop's growth. */
function plantAndRipen(h: Harness): void {
  h.sim.addItem(SEED_ID, 1, h.pid);
  plant(h);
  clearCast(h.sim);
  h.advance(CROP.durationMs);
}

// ---------------------------------------------------------------------------

describe('the farm ACTION objective: plant credit', () => {
  it('a committed plant credits the plant objective once, and never the harvest one', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    h.sim.addItem(SEED_ID, 1, h.pid);
    const before = h.meta.counters.questProgress;
    const from = h.sim.events.length;
    plant(h);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    expect(qp.counts).toEqual([1, 0]);
    expect(qp.state).toBe('active');
    expect(h.meta.counters.questProgress).toBe(before + 1);
    const progress = progressEvents(h.sim, from);
    expect(progress).toEqual([
      {
        type: 'questProgress',
        questId: QUEST_ID,
        objectiveIndex: 0,
        current: 1,
        required: 1,
        text: 'Vale Wheat planted: 1/1',
        pid: h.pid,
      },
    ]);
    // Order: the credit lands AFTER the plant is committed and announced, so
    // a client sees the planted bed before the objective advances.
    const since = h.sim.events.slice(from);
    const plantedAt = since.findIndex((e) => e.type === 'farmPlanted');
    const creditAt = since.findIndex((e) => e.type === 'questProgress');
    expect(plantedAt).toBeGreaterThanOrEqual(0);
    expect(creditAt).toBeGreaterThan(plantedAt);
  });

  it('a second plant past the count does not overshoot the objective', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    h.sim.addItem(SEED_ID, 2, h.pid);
    plant(h);
    clearCast(h.sim);
    plant(h, CROP_ID, 'bed_eastbrook_2');
    expect(h.meta.farmPlots.size).toBe(2);
    expect(qp.counts).toEqual([1, 0]);
  });

  it('bag contents never credit: holding the seed and the produce proves nothing', () => {
    // The gather precedent, stated for farming: onInventoryChangedForQuests
    // counts only collect objectives, and the farm crediter never reads bags.
    const h = makeHarness();
    const qp = trackQuest(h);
    const before = h.meta.counters.questProgress;
    const from = h.sim.events.length;
    h.sim.addItem(SEED_ID, 5, h.pid);
    h.sim.addItem(PRODUCE_ID, 5, h.pid);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(5);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(5);
    expect(qp.counts).toEqual([0, 0]);
    expect(h.meta.counters.questProgress).toBe(before);
    expect(progressEvents(h.sim, from)).toEqual([]);
  });

  it('a DENIED plant credits nothing: no seed, and out of range', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    // No seed in bags: the no_seed arm returns before anything commits.
    let from = h.sim.events.length;
    plant(h);
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['no_seed']);
    expect(qp.counts).toEqual([0, 0]);
    expect(progressEvents(h.sim, from)).toEqual([]);
    // Twenty yards off the bed with the seed in hand: the range arm.
    h.sim.addItem(SEED_ID, 1, h.pid);
    const bed = farmBedById(BED);
    if (!bed) throw new Error('bed missing');
    standAt(h.sim, bed.x + 20, bed.z);
    from = h.sim.events.length;
    plant(h);
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['range']);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(qp.counts).toEqual([0, 0]);
    expect(progressEvents(h.sim, from)).toEqual([]);
  });

  it('cropId narrows the credit to one crop; an unnamed cropId credits any crop', () => {
    // The named objective (Vale Wheat) ignores a Brook Carrot plant.
    const narrow = makeHarness();
    const narrowQp = trackQuest(narrow);
    narrow.sim.addItem(OTHER_SEED_ID, 1, narrow.pid);
    plant(narrow, OTHER_CROP_ID);
    expect(narrow.meta.farmPlots.get(BED)?.cropId).toBe(OTHER_CROP_ID);
    expect(narrowQp.counts).toEqual([0, 0]);
    // The unnamed objective takes any crop, the same Brook Carrot included.
    const wide = makeHarness();
    const wideQp = trackQuest(wide, [
      { type: 'farm', action: 'plant', count: 1, label: 'Any crop planted' },
    ]);
    wide.sim.addItem(OTHER_SEED_ID, 1, wide.pid);
    const from = wide.sim.events.length;
    plant(wide, OTHER_CROP_ID);
    expect(wide.meta.farmPlots.get(BED)?.cropId).toBe(OTHER_CROP_ID);
    expect(wideQp.counts).toEqual([1]);
    expect(wideQp.state).toBe('ready');
    expect(progressEvents(wide.sim, from).map((e) => e.text)).toEqual(['Any crop planted: 1/1']);
  });

  it('patchId never gates the credit: a Vale Wheat planted at another patch still counts', () => {
    // The types.ts contract: patchId is MARKER guidance only. The intro
    // quest names patch_eastbrook so the map circles those beds, but a
    // player who sows the wheat in Fenbridge's paddies has done the deed.
    // Pinned so the marker/credit split cannot be read as a bug later (the
    // parity and architecture reviews both asked for the pin).
    const h = makeHarness();
    const qp = trackQuest(h);
    standAtBed(h.sim, 'bed_mirefen_1');
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h, CROP_ID, 'bed_mirefen_1');
    expect(h.meta.farmPlots.get('bed_mirefen_1')?.cropId).toBe(CROP_ID);
    expect(qp.counts).toEqual([1, 0]);
    // And the marker still encloses only the named patch (Eastbrook), never
    // the bed the credit came from.
    const areas = questObjectiveAreas(h.meta.questLog);
    expect(areas).toHaveLength(1);
    const eastbrook = FARM_PATCHES.find((p) => p.id === PATCH_ID);
    if (!eastbrook) throw new Error('patch_eastbrook missing');
    const cx = eastbrook.beds.reduce((sum, b) => sum + b.x, 0) / eastbrook.beds.length;
    expect(areas[0].center.x).toBeCloseTo(cx, 6);
  });
});

describe('the farm ACTION objective: harvest credit', () => {
  it('a survived harvest credits the harvest objective (the plot leaves, the produce lands)', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    plantAndRipen(h);
    expect(qp.counts).toEqual([1, 0]);
    // Force the survived outcome so the arm is about the credit, not the roll.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    const before = h.meta.counters.questProgress;
    const from = h.sim.events.length;
    harvest(h);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
    expect(
      h.sim.countItem(PRODUCE_ID, h.pid) + h.sim.countItem('fine_vale_wheat', h.pid),
    ).toBeGreaterThan(0);
    expect(qp.counts).toEqual([1, 1]);
    expect(h.meta.counters.questProgress).toBe(before + 1);
    expect(progressEvents(h.sim, from)).toEqual([
      {
        type: 'questProgress',
        questId: QUEST_ID,
        objectiveIndex: 1,
        current: 1,
        required: 1,
        text: 'Vale Wheat harvested: 1/1',
        pid: h.pid,
      },
    ]);
    // Order: after the harvest event, so the credit describes a committed visit.
    const since = h.sim.events.slice(from);
    expect(since.findIndex((e) => e.type === 'questProgress')).toBeGreaterThan(
      since.findIndex((e) => e.type === 'farmHarvested'),
    );
    // Both objectives done: the crediter flips the quest ready itself.
    expect(qp.state).toBe('ready');
    expect(eventsOf(h.sim, from, 'questReady').map((e) => e.questId)).toEqual([QUEST_ID]);
  });

  it('a WITHERED harvest credits too: the visit is the deed', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    plantAndRipen(h);
    // At skill 0 the tier-1 survival chance is 0.85, so a 0.99 roll loses
    // (the tests/professions_farming.test.ts withered fixture).
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.99;
    const from = h.sim.events.length;
    harvest(h);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(eventsOf(h.sim, from, 'farmWithered')).toHaveLength(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toEqual([]);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    expect(qp.counts).toEqual([1, 1]);
    expect(qp.state).toBe('ready');
    expect(progressEvents(h.sim, from).map((e) => [e.objectiveIndex, e.text])).toEqual([
      [1, 'Vale Wheat harvested: 1/1'],
    ]);
    const since = h.sim.events.slice(from);
    expect(since.findIndex((e) => e.type === 'questProgress')).toBeGreaterThan(
      since.findIndex((e) => e.type === 'farmWithered'),
    );
  });

  it('the defensive retired-crop harvest credits an unnamed harvest objective', () => {
    // The !crop arm in harvestCrop (a plot whose catalog row vanished
    // between plant and harvest) is a third terminal branch; every outcome
    // credits, so it does too. Unnamed cropId, because the retired id can
    // match nothing by name.
    const h = makeHarness();
    const qp = trackQuest(h, [
      { type: 'farm', action: 'harvest', count: 1, label: 'Any crop harvested' },
    ]);
    plantAndRipen(h);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    plot.cropId = 'retired_crop';
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmWithered').map((e) => e.cropId)).toEqual(['retired_crop']);
    expect(qp.counts).toEqual([1]);
    expect(qp.state).toBe('ready');
  });

  it('a harvest denied as not_ready credits nothing', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    h.sim.addItem(SEED_ID, 1, h.pid);
    plant(h);
    clearCast(h.sim);
    expect(qp.counts).toEqual([1, 0]);
    // One millisecond short of ready.
    h.advance(CROP.durationMs - 1);
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['not_ready']);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    expect(qp.counts).toEqual([1, 0]);
    expect(progressEvents(h.sim, from)).toEqual([]);
    // And an empty bed (no_plot) after the plot is gone credits nothing more.
    h.advance(1);
    harvest(h);
    expect(qp.counts).toEqual([1, 1]);
    const again = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, again, 'farmDenied').map((e) => e.reason)).toEqual(['no_plot']);
    expect(qp.counts).toEqual([1, 1]);
    expect(progressEvents(h.sim, again)).toEqual([]);
  });

  it('cropId narrows the harvest credit to one crop', () => {
    const h = makeHarness();
    const qp = trackQuest(h);
    h.sim.addItem(OTHER_SEED_ID, 1, h.pid);
    plant(h, OTHER_CROP_ID);
    clearCast(h.sim);
    h.advance((FARM_CROPS[OTHER_CROP_ID] as FarmCropDef).durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested').map((e) => e.cropId)).toEqual([OTHER_CROP_ID]);
    expect(qp.counts).toEqual([0, 0]);
    expect(progressEvents(h.sim, from)).toEqual([]);
  });

  it('the credit adds no rng draw: a plant stays 2 and a tier-1 harvest 0 with the quest active', () => {
    // The D4 draw contract pinned in tests/professions_farming.test.ts, re-read
    // WITH a crediting farm objective in the log: the crediter is pure state
    // and event work.
    const h = makeHarness();
    const qp = trackQuest(h);
    h.sim.addItem(SEED_ID, 1, h.pid);
    expect(countDraws(h.sim, () => plant(h))).toBe(2);
    expect(qp.counts).toEqual([1, 0]);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(qp.counts).toEqual([1, 1]);
  });
});

describe('the farm ACTION objective through the quest command path', () => {
  function standAtGiver(h: Harness): void {
    const npc = [...h.sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === GIVER_ID,
    );
    if (!npc) throw new Error(`no ${GIVER_ID} entity`);
    standAt(h.sim, npc.pos.x, npc.pos.z);
  }

  it('accept, plant, harvest, turn in: the two-step intro shape completes end to end', () => {
    const h = makeHarness();
    installQuest(INTRO_OBJECTIVES, { retired: false });
    // Accept at the giver through the real command (state, range, log write).
    standAtGiver(h);
    let from = h.sim.events.length;
    h.sim.acceptQuest(QUEST_ID, h.pid);
    expect(eventsOf(h.sim, from, 'questAccepted').map((e) => e.questId)).toEqual([QUEST_ID]);
    const qp = h.meta.questLog.get(QUEST_ID);
    expect(qp).toBeTruthy();
    if (!qp) return;
    expect(qp.counts).toEqual([0, 0]);
    expect(qp.state).toBe('active');
    // Not ready before the deeds: turn-in refuses without touching the log.
    from = h.sim.events.length;
    h.sim.turnInQuest(QUEST_ID, h.pid);
    expect(eventsOf(h.sim, from, 'questDone')).toEqual([]);
    expect(h.meta.questLog.has(QUEST_ID)).toBe(true);
    // Walk to the bed, plant, ripen, harvest.
    standAtBed(h.sim, BED);
    plantAndRipen(h);
    expect(qp.counts).toEqual([1, 0]);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    harvest(h);
    expect(qp.counts).toEqual([1, 1]);
    expect(qp.state).toBe('ready');
    // Back to the giver: the turn-in completes it.
    standAtGiver(h);
    from = h.sim.events.length;
    h.sim.turnInQuest(QUEST_ID, h.pid);
    expect(eventsOf(h.sim, from, 'questDone').map((e) => e.questId)).toEqual([QUEST_ID]);
    expect(h.meta.questLog.has(QUEST_ID)).toBe(false);
    expect(h.meta.questsDone.has(QUEST_ID)).toBe(true);
  });
});

describe('the farm objective marker (questObjectiveAreas)', () => {
  function log(objectives: QuestObjective[], counts?: number[]): Map<string, QuestProgress> {
    installQuest(objectives);
    return new Map([
      [
        QUEST_ID,
        {
          questId: QUEST_ID,
          counts: counts ?? objectives.map(() => 0),
          state: 'active' as const,
        },
      ],
    ]);
  }

  it('a patchId objective draws ONE circle enclosing every bed of that patch, carrying the refs', () => {
    const areas = questObjectiveAreas(log(INTRO_OBJECTIVES));
    expect(areas).toHaveLength(1);
    const [area] = areas;
    // The expectation is recomputed from the content table, never read back
    // from the function: the centroid of the Eastbrook beds, and a radius
    // covering the farthest of them.
    const patch = FARM_PATCHES.find((p) => p.id === PATCH_ID);
    expect(patch).toBeTruthy();
    if (!patch) return;
    expect(patch.beds.length).toBe(4);
    const cx = patch.beds.reduce((sum, b) => sum + b.x, 0) / patch.beds.length;
    const cz = patch.beds.reduce((sum, b) => sum + b.z, 0) / patch.beds.length;
    expect(area.center).toEqual({ x: cx, z: cz });
    for (const bed of patch.beds) {
      expect(Math.hypot(bed.x - cx, bed.z - cz)).toBeLessThanOrEqual(area.radius);
    }
    // Both incomplete objectives name the same patch, so they MERGE onto the
    // one circle (the shared-circle dedupe) rather than stacking two fills.
    expect(area.objectives).toEqual([
      { questId: QUEST_ID, objectiveIndex: 0 },
      { questId: QUEST_ID, objectiveIndex: 1 },
    ]);
    // The content row is deep-frozen, so an arm that tried to write into a
    // bed while enclosing it would throw here rather than pass quietly (an
    // alias check on the returned center is unobservable: the area carries
    // only the computed centroid and radius, never the input points).
    expect(Object.isFrozen(patch.beds[0])).toBe(true);
  });

  it('a patchless objective draws one circle per farming patch (four), each over its own beds', () => {
    const areas = questObjectiveAreas(
      log([{ type: 'farm', action: 'plant', count: 1, label: 'Any crop planted' }]),
    );
    expect(FARM_PATCHES.length).toBe(4);
    expect(areas).toHaveLength(4);
    for (const patch of FARM_PATCHES) {
      const cx = patch.beds.reduce((sum, b) => sum + b.x, 0) / patch.beds.length;
      const cz = patch.beds.reduce((sum, b) => sum + b.z, 0) / patch.beds.length;
      const area = areas.find((a) => a.center.x === cx && a.center.z === cz);
      expect(area, `expected an area centred on ${patch.id}`).toBeTruthy();
      if (!area) continue;
      for (const bed of patch.beds) {
        expect(Math.hypot(bed.x - cx, bed.z - cz)).toBeLessThanOrEqual(area.radius);
      }
      expect(area.objectives).toEqual([{ questId: QUEST_ID, objectiveIndex: 0 }]);
    }
  });

  it('a completed objective draws nothing; a ready quest draws nothing', () => {
    // Plant done, harvest pending: the one circle carries only the harvest ref.
    const partial = questObjectiveAreas(log(INTRO_OBJECTIVES, [1, 0]));
    expect(partial).toHaveLength(1);
    expect(partial[0].objectives).toEqual([{ questId: QUEST_ID, objectiveIndex: 1 }]);
    // Both done (the log row is still 'active' until the crediter flips it):
    // nothing to guide toward.
    expect(questObjectiveAreas(log(INTRO_OBJECTIVES, [1, 1]))).toEqual([]);
    // And a ready quest contributes nothing (the '?' marker guides those).
    const ready = log(INTRO_OBJECTIVES);
    (ready.get(QUEST_ID) as QuestProgress).state = 'ready';
    expect(questObjectiveAreas(ready)).toEqual([]);
  });

  it('an unknown patchId draws nothing rather than a garbage circle', () => {
    const areas = questObjectiveAreas(
      log([
        {
          type: 'farm',
          action: 'plant',
          patchId: 'patch_nowhere',
          count: 1,
          label: 'Nowhere planted',
        },
      ]),
    );
    expect(areas).toEqual([]);
  });
});
