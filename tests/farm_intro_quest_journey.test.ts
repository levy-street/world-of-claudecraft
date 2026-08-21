// The go-live journey through the REAL content: q_farm_intro at
// farmer_jessica, driven end to end on a live Sim with an injected,
// advanceable clock (the tests/professions_farming.test.ts harness idiom).
// tests/farm_intro_quest_content.test.ts pins the row and its text and
// tests/farm_quest_objective.test.ts pins the credit arm on a synthetic
// quest; this suite is the seam between them: the shipped row, the shipped
// giver, the shipped arm, in the order a new player walks them. Every step
// is a real entry point (talkToNpc, buyItem, plantCrop, the tick sweep,
// harvestCrop, talkToNpc again), never a hand-set quest state.
//
// LAYER HONESTY (Phase 9 QA, state.md deviation (bn)): the entry points here
// are the SIM's. plantCrop and harvestCrop have no client-side caller yet
// (no bed interaction, no plant sheet, no /dev plant), so this suite proves
// the sim half of the journey and cannot see whether a player can reach it;
// the client verb and its browser test are the (bn) follow-up, and until
// they land the phase's "reachable by ordinary players" note is unmet.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS, type FarmCropDef } from '../src/sim/content/farm_crops';
import { farmBedById } from '../src/sim/content/farm_patches';
import { ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { FARMER_TRADE_RANGE } from '../src/sim/professions/farmer_npcs';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const QUEST_ID = 'q_farm_intro';
const GIVER_ID = 'farmer_jessica';
const HOE_ID = 'garden_hoe';
const SEED_ID = 'vale_wheat_seed';
const CROP_ID = 'vale_wheat';
const BED = 'bed_eastbrook_1';
const START_MS = 1_700_000_000_000;
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;
const MAGIC_SENTENCE = 'It keeps growing while you are away, and it never spoils.';
const JOURNAL_POINTER =
  'Your Harvest Journal (Shift+K, or the Farming row of your Professions window) lists every planted bed and its timer.';

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  jessica: Entity;
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
  const jessica = [...sim.entities.values()].find((e) => e.templateId === GIVER_ID);
  if (!jessica) throw new Error('farmer_jessica did not spawn');
  return {
    sim,
    pid,
    meta,
    jessica,
    advance: (ms) => {
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

function standByJessica(h: Harness): void {
  standAt(h.sim, h.jessica.pos.x + 1.5, h.jessica.pos.z);
}

function standAtBed(h: Harness, bedId = BED): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  standAt(h.sim, bed.x, bed.z);
}

function eventsOf<T extends SimEvent['type']>(
  sim: Sim,
  from: number,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return sim.events.slice(from).filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Let the plant cast finish through REAL ticks (bounded), returning every
 *  event those ticks drained (tick() hands the buffer over and clears it,
 *  so a reader that looks at sim.events afterwards sees nothing). */
function tickOutCast(h: Harness): SimEvent[] {
  const drained: SimEvent[] = [];
  for (let i = 0; i < 120 && h.sim.player.castingAbility !== null; i++)
    drained.push(...h.sim.tick());
  expect(h.sim.player.castingAbility, 'the plant cast completes through ticks').toBeNull();
  return drained;
}

/** Run n ticks and return every event they drained. */
function ticks(h: Harness, n: number): SimEvent[] {
  const drained: SimEvent[] = [];
  for (let i = 0; i < n; i++) drained.push(...h.sim.tick());
  return drained;
}

describe('the go-live journey: q_farm_intro at Farmer Jessica, end to end', () => {
  it('walks accept, plant, ripen, harvest, and turn-in through the real entry points', () => {
    const h = makeHarness();
    // A fresh level-1 character: no hoe, no seed, no copper needed.
    expect(h.sim.countItem(HOE_ID, h.pid)).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('available');

    // 1. Talk to Jessica: the quest is accepted and the fallback grant lands.
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    const qp = h.meta.questLog.get(QUEST_ID);
    expect(qp?.state).toBe('active');
    expect(qp?.counts).toEqual([0, 0]);
    expect(h.sim.countItem(HOE_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);

    // 2. Plant the granted seed at the Eastbrook bed (out of Jessica's reach:
    // the plant is a bed action, never an NPC one). The plant credits the
    // FIRST objective through the action arm, not through the bags.
    standAtBed(h);
    expect(
      Math.hypot(h.sim.player.pos.x - h.jessica.pos.x, h.sim.player.pos.z - h.jessica.pos.z),
    ).toBeGreaterThan(FARMER_TRADE_RANGE);
    let from = h.sim.events.length;
    h.sim.plantCrop(BED, CROP_ID, undefined, h.pid);
    // The plant commits (and credits) at the call; the cast is flavor.
    expect(eventsOf(h.sim, from, 'farmPlanted')).toHaveLength(1);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    expect(qp?.counts).toEqual([1, 0]);
    expect(qp?.state).toBe('active');
    const plantProgress = eventsOf(h.sim, from, 'questProgress').filter(
      (e) => e.questId === QUEST_ID,
    );
    expect(plantProgress.map((e) => [e.objectiveIndex, e.current, e.required])).toEqual([
      [0, 1, 1],
    ]);
    tickOutCast(h);

    // 3. Come back whenever: the clock moves past the crop, the 1 Hz sweep
    // announces the ready bed (the Phase 8 notice, live now that seeds are
    // obtainable), and nothing about the quest moves until the harvest.
    h.advance(CROP.durationMs + 1);
    const swept = ticks(h, 25);
    expect(swept.filter((e) => e.type === 'farmReady')).toHaveLength(1);
    expect(qp?.counts).toEqual([1, 0]);

    // 4. Harvest: the SECOND objective credits on the action; the quest turns
    // ready; produce (or husks on a losing roll) lands either way.
    from = h.sim.events.length;
    h.sim.harvestCrop(BED, h.pid);
    const harvested = eventsOf(h.sim, from, 'farmHarvested').length;
    const withered = eventsOf(h.sim, from, 'farmWithered').length;
    expect(harvested + withered).toBe(1);
    // Something really landed in the bags on either outcome: produce (plain or
    // fine) on a survived crop, husks on a withered one.
    expect(
      h.sim.countItem(CROP_ID, h.pid) +
        h.sim.countItem(`fine_${CROP_ID}`, h.pid) +
        h.sim.countItem('withered_husks', h.pid),
    ).toBeGreaterThan(0);
    expect(qp?.counts).toEqual([1, 1]);
    expect(qp?.state).toBe('ready');
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('ready');

    // 5. Back to Jessica: the turn-in pays the intro-template rewards.
    standByJessica(h);
    const xpBefore = h.sim.xp;
    const copperBefore = h.sim.copper;
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('done');
    expect(h.sim.copper - copperBefore).toBe(QUESTS[QUEST_ID].copperReward);
    expect(h.sim.xp - xpBefore).toBe(QUESTS[QUEST_ID].xpReward);
    // The rewards are the q_prof_intro template's, pinned as literals so a
    // retune is a visible edit.
    expect(QUESTS[QUEST_ID].xpReward).toBe(150);
    expect(QUESTS[QUEST_ID].copperReward).toBe(50);
  });

  it('never dead-ends: a lost or planted seed re-grants on the next talk, and the faucet closes at ready', () => {
    const h = makeHarness();
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // A second talk while both items are held grants nothing (no double-grant).
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.countItem(HOE_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // Plant it (the seed is spent), then talk again: the requiredItems
    // fallback re-grants the seed so a withered first crop is never a wall.
    // The re-grant is bounded to the ACTIVE window: it is a 4-copper faucet
    // that closes the moment the quest turns ready.
    standAtBed(h);
    h.sim.plantCrop(BED, CROP_ID, undefined, h.pid);
    tickOutCast(h);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // Ripen and harvest: ready. Sell nothing; drop the seed to prove the
    // ready-state talk does not re-grant (a ready quest talks straight to the
    // turn-in).
    h.advance(CROP.durationMs + 1);
    standAtBed(h);
    h.sim.harvestCrop(BED, h.pid);
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('ready');
    h.sim.removeItem(SEED_ID, 1, h.pid);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('done');
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
  });

  it('the magic sentence and the journal pointer live in BOTH the greeting and the completion text', () => {
    // D20 (state.md): Jessica's dialog states the anti-chore promise, and the
    // Phase 8 (be) carry says both surfaces point at the Harvest Journal so a
    // pre-attunement farmer finds the timer surface without a keyboard.
    expect(NPCS[GIVER_ID].greeting).toContain(MAGIC_SENTENCE);
    expect(NPCS[GIVER_ID].greeting).toContain(JOURNAL_POINTER);
    expect(QUESTS[QUEST_ID].completionText).toContain(MAGIC_SENTENCE);
    expect(QUESTS[QUEST_ID].completionText).toContain(JOURNAL_POINTER);
    // Neither surface promises a notice the sim cannot keep (deviation (bb):
    // a transient banner can be lost while linkdead).
    const promisesANotice = (text: string): boolean =>
      /\balways\b|will be told|you will always/.test(text.toLowerCase());
    // Positive control: the predicate really trips on the wording it bans.
    expect(promisesANotice('You will always be told when a crop is ready.')).toBe(true);
    for (const text of [NPCS[GIVER_ID].greeting, QUESTS[QUEST_ID].completionText]) {
      expect(promisesANotice(text)).toBe(false);
    }
  });

  it('a fresh character can afford the whole first loop from the grant alone', () => {
    // No copper is required to accept, plant, or turn in: the granted hoe
    // and seed are the loop; the intro-quest copper then funds the second
    // seed (buyValue 4) with room to spare.
    const h = makeHarness();
    expect(h.sim.copper).toBe(0);
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    standAtBed(h);
    h.sim.plantCrop(BED, CROP_ID, undefined, h.pid);
    tickOutCast(h);
    h.advance(CROP.durationMs + 1);
    h.sim.harvestCrop(BED, h.pid);
    standByJessica(h);
    h.sim.talkToNpc(h.jessica.id, h.pid);
    expect(h.sim.questState(QUEST_ID, h.pid)).toBe('done');
    expect(h.sim.copper).toBeGreaterThanOrEqual(ITEMS[SEED_ID].buyValue ?? Number.NaN);
    const before = h.sim.copper;
    h.sim.buyItem(h.jessica.id, SEED_ID, undefined, h.pid);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(before - h.sim.copper).toBe(ITEMS[SEED_ID].buyValue);
  });
});
