// Clue Scrolls (world quests, Stage 3) end to end through a real Sim: the
// slate predicate, the once-per-cycle entitlement paid from the world-quest
// credit arm, the scroll use that opens a hunt, every step family resolving
// only under its own condition, the casket at the end and what it pays, the
// save round trip (and what a retired hunt restores to), the daily reset that
// leaves the hunt alone, abandon, and the /dev clue family. The wire half is
// tests/clue_scrolls_wire.test.ts; the design page is docs/design/clue-scrolls.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CASKET_COPPER_BASE,
  CASKET_COPPER_PER_LEVEL,
  CASKET_GEAR_CHANCE,
  CASKET_HEROIC_MARK_CHANCE,
  CASKET_HEROIC_MARKS,
  CASKET_MATERIAL_COUNT,
  CASKET_MATERIAL_POOL,
  CASKET_MOUNT_CHANCE,
  CASKET_MOUNT_REINS_ITEM_ID,
  openTreasureCasket,
  treasureCasketCopper,
} from '../src/sim/clue_casket';
import {
  CLUE_HUNT_STANDING,
  CLUE_HUNT_TEST_POOL,
  clueHuntFaction,
  maybeAwardClueScroll,
  sanitizeClueHunt,
  worldQuestSlateComplete,
} from '../src/sim/clue_scrolls';
import {
  CLUE_HUNTS,
  CLUE_SCROLL_ITEM_ID,
  CLUE_SCROLL_MIN_LEVEL,
  CLUE_SCROLL_STACK_MAX,
  CLUE_STEP_RADIUS,
  type ClueHuntDef,
  TREASURE_CASKET_ITEM_ID,
} from '../src/sim/content/clue_hunts';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { ITEMS } from '../src/sim/data';
import { METER_DIRTY_KEYS } from '../src/sim/deeds';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent, WorldQuestDef, WorldQuestProgress } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { playerActiveWorldQuests } from '../src/sim/world_quest_reroll';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  worldQuestCycleForResetDay,
} from '../src/sim/world_quest_rotation';
import { onMobKilledForWorldQuests } from '../src/sim/world_quests';
import { EMPTY_TEST_WORLD } from './sim_shared';

// A hunt with one step of every shipped family, authored against real
// Drakelands landmarks and NPCs (src/sim/content/drakelands.ts): Wyrmwatch at
// (404, 1900), the Gatewood at (360, 1940), Gatecaptain Brannoc at (407, 1895),
// Quartermaster Sela at (398, 1908). Registered through the test-only pool so
// the suite never depends on what the authored pool ships.
const WYRMWATCH = { x: 404, z: 1900 };
const GATEWOOD = { x: 360, z: 1940 };
const BRANNOC = { x: 407, z: 1895 };
const DIG_SPOT = { x: 330, z: 2100 };
const TEST_HUNT: ClueHuntDef = {
  id: 'hunt_test_wyrmwatch',
  steps: [
    { kind: 'landmark', zoneId: 'drakelands', poiId: 'wyrmwatch' },
    { kind: 'npc', npcId: 'gatecaptain_brannoc' },
    { kind: 'emote', emote: 'salute', zoneId: 'drakelands', poiId: 'the_gatewood' },
    { kind: 'deliver', npcId: 'quartermaster_sela', itemId: 'baked_bread', count: 2 },
    { kind: 'dig', zoneId: 'drakelands', x: DIG_SPOT.x, z: DIG_SPOT.z },
  ],
};
const TOTAL = TEST_HUNT.steps.length;

beforeEach(() => {
  CLUE_HUNT_TEST_POOL.push(TEST_HUNT);
});
afterEach(() => {
  CLUE_HUNT_TEST_POOL.length = 0;
});

function huntSim(seed = 4711, level = CLUE_SCROLL_MIN_LEVEL, autoEquip = true): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip, devCommands: true });
  sim.setPlayerLevel(level);
  sim.utcDay = '2026-08-31';
  sim.resetDay = '2026-08-31';
  placeAt(sim, WYRMWATCH.x + 200, WYRMWATCH.z + 100);
  sim.tick();
  sim.drainEvents();
  return sim;
}

function placeAt(sim: Sim, x: number, z: number): void {
  const player = sim.player;
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return meta;
}

function npcByTemplate(sim: Sim, templateId: string): Entity {
  const npc = [...sim.entities.values()].find(
    (entity) => entity.kind === 'npc' && entity.templateId === templateId,
  );
  if (!npc) throw new Error(`Missing npc ${templateId}`);
  return npc;
}

/** Walks up to the NPC (quest-talk range) and talks, the way a click does. */
function talkTo(sim: Sim, templateId: string): void {
  const npc = npcByTemplate(sim, templateId);
  placeAt(sim, npc.pos.x + 1, npc.pos.z + 1);
  sim.talkToNpc(npc.id);
}

function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T) {
  return evs.filter((ev): ev is Extract<SimEvent, { type: T }> => ev.type === type);
}

function errorTexts(evs: SimEvent[]): string[] {
  return ofType(evs, 'error').map((ev) => ev.text);
}

/** Runs the hunt up to (not including) step `index` through the real hooks. */
function advanceTo(sim: Sim, index: number): void {
  const meta = metaOf(sim);
  if (index > 0 && meta.clueHunt?.step === 0) {
    placeAt(sim, WYRMWATCH.x, WYRMWATCH.z);
    sim.tick();
  }
  if (index > 1 && meta.clueHunt?.step === 1) talkTo(sim, 'gatecaptain_brannoc');
  if (index > 2 && meta.clueHunt?.step === 2) {
    placeAt(sim, GATEWOOD.x, GATEWOOD.z);
    sim.chat('/salute');
  }
  if (index > 3 && meta.clueHunt?.step === 3) {
    sim.addItem('baked_bread', 2);
    talkTo(sim, 'quartermaster_sela');
  }
  sim.drainEvents();
  expect(meta.clueHunt?.step).toBe(index);
}

function startHunt(sim: Sim): SimEvent[] {
  sim.addItem(CLUE_SCROLL_ITEM_ID, 1);
  sim.drainEvents();
  sim.useItem(CLUE_SCROLL_ITEM_ID);
  return sim.drainEvents();
}

// ---------------------------------------------------------------------------
// The slate predicate (pure)

const CYCLE = worldQuestCycleForResetDay('2026-08-31');

function slateMeta(
  completed: readonly string[],
  replacements: Record<string, string> = {},
): Pick<PlayerMeta, 'worldQuestCycle' | 'worldQuestReplacements' | 'worldQuestLog'> {
  const worldQuestLog = new Map<string, WorldQuestProgress>();
  for (const questId of completed) {
    const quest = WORLD_QUESTS_BY_ID[questId];
    worldQuestLog.set(questId, { questId, count: quest.count, state: 'completed' });
  }
  return { worldQuestCycle: CYCLE, worldQuestReplacements: replacements, worldQuestLog };
}

function rotatingSlots(
  meta: Pick<PlayerMeta, 'worldQuestCycle' | 'worldQuestReplacements'>,
  level: number,
): readonly WorldQuestDef[] {
  return playerActiveWorldQuests(meta).filter(
    (quest) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id) && quest.minLevel <= level,
  );
}

describe('worldQuestSlateComplete', () => {
  it('is true only when every rotating zone slot is completed', () => {
    const slots = rotatingSlots(slateMeta([]), 20).map((quest) => quest.id);
    expect(slots.length).toBeGreaterThan(3);
    expect(worldQuestSlateComplete(slateMeta(slots), 20)).toBe(true);
    // One slot short, any slot: false.
    for (const missing of slots) {
      const rest = slots.filter((id) => id !== missing);
      expect(worldQuestSlateComplete(slateMeta(rest), 20), `missing ${missing}`).toBe(false);
    }
    expect(worldQuestSlateComplete(slateMeta([]), 20)).toBe(false);
  });

  it('ignores the always-active dailies in both directions', () => {
    const slots = rotatingSlots(slateMeta([]), 20).map((quest) => quest.id);
    // The dailies completed on top change nothing; the dailies missing block nothing.
    expect(
      worldQuestSlateComplete(slateMeta([...slots, ...ALWAYS_ACTIVE_WORLD_QUEST_IDS]), 20),
    ).toBe(true);
    expect(worldQuestSlateComplete(slateMeta([...ALWAYS_ACTIVE_WORLD_QUEST_IDS]), 20)).toBe(false);
  });

  it('a rerolled slot counts once, through its replacement', () => {
    const base = rotatingSlots(slateMeta([]), 20);
    const original = base.find((quest) => quest.zoneId === 'eastbrook_vale');
    if (!original) throw new Error('Expected an Eastbrook slot');
    const replacementId = ['wq_eastbrook_bandits', 'wq_eastbrook_caravan'].find(
      (id) => id !== original.id,
    ) as string;
    const replacements = { [original.id]: replacementId };
    const others = base.filter((quest) => quest.id !== original.id).map((quest) => quest.id);
    // The original completed no longer counts: its slot now belongs to the replacement.
    expect(worldQuestSlateComplete(slateMeta([...others, original.id], replacements), 20)).toBe(
      false,
    );
    expect(worldQuestSlateComplete(slateMeta([...others, replacementId], replacements), 20)).toBe(
      true,
    );
  });

  it('a slot the character cannot start yet (minLevel above them) is not required', () => {
    const all = rotatingSlots(slateMeta([]), 20);
    const reachable = all.filter((quest) => quest.minLevel <= CLUE_SCROLL_MIN_LEVEL);
    expect(reachable.length).toBeLessThan(all.length);
    const ids = reachable.map((quest) => quest.id);
    expect(worldQuestSlateComplete(slateMeta(ids), CLUE_SCROLL_MIN_LEVEL)).toBe(true);
    expect(worldQuestSlateComplete(slateMeta(ids), 20)).toBe(false);
  });

  it('is false with no cycle at all', () => {
    const meta = slateMeta(rotatingSlots(slateMeta([]), 20).map((quest) => quest.id));
    expect(worldQuestSlateComplete({ ...meta, worldQuestCycle: '' }, 20)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The entitlement through the real credit arm

const THORNPEAK = 'wq_thornpeak_stormcrag';

function slateSim(level: number, seed = 4711): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  sim.setPlayerLevel(level);
  sim.utcDay = '2026-08-31';
  sim.resetDay = '2026-08-31';
  placeAt(sim, quest.area.x, quest.area.z);
  sim.tick();
  sim.drainEvents();
  const meta = metaOf(sim);
  expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('active');
  // Every other rotating slot on this character's board is already turned in.
  for (const slot of rotatingSlots(meta, level)) {
    if (slot.id === THORNPEAK) continue;
    meta.worldQuestLog.set(slot.id, { questId: slot.id, count: slot.count, state: 'completed' });
  }
  return sim;
}

/** Turns Thornpeak in through the real kill-credit path. */
function completeThornpeak(sim: Sim): SimEvent[] {
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  if (quest.objective.type !== 'kill') throw new Error('Expected a kill objective');
  const targetMobId = quest.objective.targetMobId;
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === targetMobId,
  );
  if (!target) throw new Error(`Missing target ${targetMobId}`);
  target.pos.x = quest.area.x;
  target.pos.z = quest.area.z;
  const meta = metaOf(sim);
  for (let i = 0; i < quest.count; i++) onMobKilledForWorldQuests(sim.ctx, target, meta);
  expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');
  return sim.drainEvents();
}

describe('the scroll entitlement (creditWorldQuest completion arm)', () => {
  it('pays one scroll when the last slot turns in, after the rewards, and marks the cycle', () => {
    const sim = slateSim(20);
    const meta = metaOf(sim);
    expect(meta.clueScrollCycle).toBe('');
    const evs = completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    expect(meta.clueScrollCycle).toBe(meta.worldQuestCycle);
    expect(ofType(evs, 'clueScrollEarned')).toHaveLength(1);
    expect(ofType(evs, 'clueScrollLost')).toHaveLength(0);
    // The day's other rewards land first: the quest's own loot line and
    // standing precede the scroll receipt, and the scroll's receipt precedes
    // the earned event.
    const types = evs.map((ev) => ev.type);
    const done = types.indexOf('worldQuestDone');
    const earned = types.indexOf('clueScrollEarned');
    const scrollLoot = evs.findIndex(
      (ev) => ev.type === 'loot' && ev.text.includes(ITEMS[CLUE_SCROLL_ITEM_ID].name),
    );
    expect(scrollLoot).toBeGreaterThan(-1);
    expect(scrollLoot).toBeLessThan(earned);
    expect(earned).toBeLessThan(done);
  });

  it('never pays twice for one cycle', () => {
    const sim = slateSim(20);
    const meta = metaOf(sim);
    completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    maybeAwardClueScroll(sim.ctx, meta, sim.player);
    maybeAwardClueScroll(sim.ctx, meta, sim.player);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    expect(sim.drainEvents().filter((ev) => ev.type.startsWith('clueScroll'))).toHaveLength(0);
  });

  it('pays again on the next cycle', () => {
    const sim = slateSim(20);
    const meta = metaOf(sim);
    completeThornpeak(sim);
    const firstCycle = meta.clueScrollCycle;
    sim.resetDay = '2026-09-01';
    sim.tick();
    sim.tick();
    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-09-01'));
    expect(meta.clueScrollCycle).toBe(firstCycle);
    for (const slot of rotatingSlots(meta, 20)) {
      if (slot.id === THORNPEAK) continue;
      meta.worldQuestLog.set(slot.id, { questId: slot.id, count: slot.count, state: 'completed' });
    }
    sim.drainEvents();
    completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(2);
    expect(meta.clueScrollCycle).toBe(meta.worldQuestCycle);
  });

  it('pays nothing below CLUE_SCROLL_MIN_LEVEL, and leaves the cycle unmarked', () => {
    const sim = slateSim(CLUE_SCROLL_MIN_LEVEL - 1);
    const meta = metaOf(sim);
    const evs = completeThornpeak(sim);
    expect(meta.counters.questsCompleted).toBe(1);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    expect(meta.clueScrollCycle).toBe('');
    expect(evs.filter((ev) => ev.type.startsWith('clueScroll'))).toHaveLength(0);
  });

  it('pays at CLUE_SCROLL_MIN_LEVEL with the unreachable high-level slots not required', () => {
    const sim = slateSim(CLUE_SCROLL_MIN_LEVEL);
    completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
  });

  it('pays nothing while a slot is still open', () => {
    const sim = slateSim(20);
    const meta = metaOf(sim);
    const open = rotatingSlots(meta, 20).find((slot) => slot.id !== THORNPEAK);
    if (!open) throw new Error('Expected a second slot');
    meta.worldQuestLog.delete(open.id);
    completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    expect(meta.clueScrollCycle).toBe('');
  });

  it('a full stack loses the scroll for the day (the cycle is still marked)', () => {
    const sim = slateSim(20);
    const meta = metaOf(sim);
    sim.addItem(CLUE_SCROLL_ITEM_ID, CLUE_SCROLL_STACK_MAX);
    sim.drainEvents();
    const evs = completeThornpeak(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(CLUE_SCROLL_STACK_MAX);
    expect(meta.clueScrollCycle).toBe(meta.worldQuestCycle);
    expect(ofType(evs, 'clueScrollLost')).toHaveLength(1);
    expect(ofType(evs, 'clueScrollEarned')).toHaveLength(0);
    // And the loss is final: nothing pays later in the same cycle.
    maybeAwardClueScroll(sim.ctx, meta, sim.player);
    expect(sim.drainEvents().filter((ev) => ev.type.startsWith('clueScroll'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The hunt

describe('using a scroll', () => {
  it('starts a hunt from the pool, spends the scroll, and bumps the wire revision', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    const rev = meta.wireRev;
    const evs = startHunt(sim);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    expect(meta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(sim.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(ofType(evs, 'clueHuntStarted')).toEqual([
      { type: 'clueHuntStarted', huntId: TEST_HUNT.id, total: TOTAL, pid: sim.playerId },
    ]);
    expect(meta.wireRev).toBeGreaterThan(rev);
  });

  it('draws the hunt through the sim rng, so the same seed opens the same hunt', () => {
    CLUE_HUNT_TEST_POOL.push(
      { id: 'hunt_test_b', steps: [{ kind: 'dig', zoneId: 'drakelands', x: 1, z: 1 }] },
      { id: 'hunt_test_c', steps: [{ kind: 'dig', zoneId: 'drakelands', x: 2, z: 2 }] },
    );
    // The draw needs no world content: an empty world keeps the loop cheap.
    const light = (seed: number) => {
      const sim = new Sim({ seed, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
      sim.setPlayerLevel(CLUE_SCROLL_MIN_LEVEL);
      return sim;
    };
    const picks = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const a = light(seed);
      const b = light(seed);
      startHunt(a);
      startHunt(b);
      expect(metaOf(a).clueHunt?.huntId).toBe(metaOf(b).clueHunt?.huntId);
      picks.add(metaOf(a).clueHunt?.huntId ?? '');
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('refuses with the scroll kept when the pool is empty', () => {
    // The pool is the shipped CLUE_HUNTS once the test hook is empty; the
    // shipped array is emptied for this one case and restored in finally.
    CLUE_HUNT_TEST_POOL.length = 0;
    const shipped = (CLUE_HUNTS as ClueHuntDef[]).splice(0);
    try {
      const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
      const evs = startHunt(sim);
      expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
      expect(metaOf(sim).clueHunt).toBeNull();
      expect(errorTexts(evs)).toEqual(['This scroll has nothing to reveal.']);
    } finally {
      (CLUE_HUNTS as ClueHuntDef[]).push(...shipped);
    }
  });

  it('is refused, nothing spent, while a hunt is on a non-dig step', () => {
    const sim = huntSim();
    startHunt(sim);
    sim.addItem(CLUE_SCROLL_ITEM_ID, 1);
    sim.drainEvents();
    sim.useItem(CLUE_SCROLL_ITEM_ID);
    const evs = sim.drainEvents();
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    expect(metaOf(sim).clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(errorTexts(evs)).toEqual(['You are already following a clue.']);
    expect(ofType(evs, 'clueHuntStarted')).toHaveLength(0);
  });
});

describe('the landmark step (the world-quest tick sweep)', () => {
  it('resolves only inside CLUE_STEP_RADIUS of the poi, in that zone', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    // Far away, in the zone: nothing.
    placeAt(sim, WYRMWATCH.x + CLUE_STEP_RADIUS + 2, WYRMWATCH.z);
    sim.tick();
    expect(meta.clueHunt?.step).toBe(0);
    sim.drainEvents();
    // On the spot: the step completes.
    placeAt(sim, WYRMWATCH.x + CLUE_STEP_RADIUS - 1, WYRMWATCH.z);
    const evs = sim.tick();
    expect(meta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 1 });
    expect(ofType(evs, 'clueHuntStep')).toEqual([
      { type: 'clueHuntStep', huntId: TEST_HUNT.id, step: 0, total: TOTAL, pid: sim.playerId },
    ]);
    // Standing there longer does not re-fire (the cursor moved on).
    sim.tick();
    expect(meta.clueHunt?.step).toBe(1);
  });

  it('never resolves a landmark step for a dead player', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    placeAt(sim, WYRMWATCH.x, WYRMWATCH.z);
    sim.player.dead = true;
    sim.tick();
    expect(meta.clueHunt?.step).toBe(0);
  });
});

describe('the npc step (Sim.talkToNpc)', () => {
  it('advances on the named NPC only, and only within talk range', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 1);
    talkTo(sim, 'quartermaster_sela');
    expect(meta.clueHunt?.step).toBe(1);
    // The right NPC clicked from across the hub: not a talk (server-authoritative).
    placeAt(sim, BRANNOC.x + 30, BRANNOC.z);
    sim.talkToNpc(npcByTemplate(sim, 'gatecaptain_brannoc').id);
    expect(meta.clueHunt?.step).toBe(1);
    sim.drainEvents();
    talkTo(sim, 'gatecaptain_brannoc');
    const evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(2);
    expect(ofType(evs, 'clueHuntStep').map((ev) => ev.step)).toEqual([1]);
  });

  it('a talk on a landmark step is not an npc match', () => {
    const sim = huntSim();
    startHunt(sim);
    talkTo(sim, 'gatecaptain_brannoc');
    expect(metaOf(sim).clueHunt?.step).toBe(0);
  });
});

describe('the emote step (the chat emote arm)', () => {
  it('advances on the matching emote at the landmark, and nowhere else', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 2);
    // Right emote, wrong place.
    placeAt(sim, WYRMWATCH.x, WYRMWATCH.z);
    sim.chat('/salute');
    expect(meta.clueHunt?.step).toBe(2);
    // Wrong emote, right place.
    placeAt(sim, GATEWOOD.x, GATEWOOD.z);
    sim.chat('/wave');
    expect(meta.clueHunt?.step).toBe(2);
    // Plain /say text is not an emote.
    sim.chat('salute');
    expect(meta.clueHunt?.step).toBe(2);
    sim.drainEvents();
    sim.chat('/salute');
    const evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(3);
    expect(ofType(evs, 'clueHuntStep').map((ev) => ev.step)).toEqual([2]);
  });

  it('resolves an emote alias to its canonical key', () => {
    CLUE_HUNT_TEST_POOL.length = 0;
    CLUE_HUNT_TEST_POOL.push({
      id: 'hunt_test_greet',
      steps: [
        { kind: 'emote', emote: 'greet', zoneId: 'drakelands', poiId: 'wyrmwatch' },
        { kind: 'dig', zoneId: 'drakelands', x: DIG_SPOT.x, z: DIG_SPOT.z },
      ],
    });
    const sim = huntSim();
    startHunt(sim);
    placeAt(sim, WYRMWATCH.x, WYRMWATCH.z);
    sim.chat('/hello');
    expect(metaOf(sim).clueHunt?.step).toBe(1);
  });
});

describe('the deliver step (Sim.talkToNpc)', () => {
  it('refuses a short delivery without advancing, then consumes the items and advances', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 3);
    // The starting kit carries bread: clear it so the count is the test's.
    sim.removeItem('baked_bread', sim.countItem('baked_bread'));
    sim.addItem('baked_bread', 1);
    sim.drainEvents();
    talkTo(sim, 'quartermaster_sela');
    let evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(3);
    expect(sim.countItem('baked_bread')).toBe(1);
    expect(errorTexts(evs)).toEqual(['You do not have what the clue asks for.']);
    // The wrong NPC with enough bread: nothing, no refusal either.
    sim.addItem('baked_bread', 2);
    sim.drainEvents();
    talkTo(sim, 'gatecaptain_brannoc');
    evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(3);
    expect(sim.countItem('baked_bread')).toBe(3);
    expect(errorTexts(evs)).toEqual([]);
    talkTo(sim, 'quartermaster_sela');
    evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(4);
    expect(sim.countItem('baked_bread')).toBe(1);
    expect(ofType(evs, 'clueHuntStep').map((ev) => ev.step)).toEqual([3]);
  });
});

describe('the dig step (using the scroll on the spot)', () => {
  it('refuses off the spot, keeps the scroll on a dig, and the last step hands the casket', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 4);
    sim.addItem(CLUE_SCROLL_ITEM_ID, 1);
    sim.drainEvents();
    // Near, but outside the radius.
    placeAt(sim, DIG_SPOT.x + CLUE_STEP_RADIUS + 1, DIG_SPOT.z);
    sim.useItem(CLUE_SCROLL_ITEM_ID);
    let evs = sim.drainEvents();
    expect(meta.clueHunt?.step).toBe(4);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    expect(errorTexts(evs)).toEqual(['There is nothing to dig here.']);
    // On the spot.
    placeAt(sim, DIG_SPOT.x + 2, DIG_SPOT.z - 2);
    const rev = meta.wireRev;
    const standingBefore = meta.factions?.automatons ?? 0;
    const riftBefore = meta.factions?.rift_watch ?? 0;
    sim.useItem(CLUE_SCROLL_ITEM_ID);
    evs = sim.drainEvents();
    expect(meta.clueHunt).toBeNull();
    expect(sim.clueHunt).toBeNull();
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(1);
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID)).toBe(1);
    expect(meta.wireRev).toBeGreaterThan(rev);
    // Emit order: the step, the casket receipt, done, then the standing receipt.
    expect(evs.map((ev) => ev.type)).toEqual(['clueHuntStep', 'loot', 'clueHuntDone', 'loot']);
    // The hunt digs in the Drakelands, so the automaton faction is paid, and
    // only it.
    expect(clueHuntFaction(TEST_HUNT)).toBe('automatons');
    expect((meta.factions?.automatons ?? 0) - standingBefore).toBe(CLUE_HUNT_STANDING);
    expect(meta.factions?.rift_watch ?? 0).toBe(riftBefore);
    expect(ofType(evs, 'loot')[1].text).toBe(`+${CLUE_HUNT_STANDING} Automatons Standing.`);
    expect(ofType(evs, 'clueHuntStep')[0]).toEqual({
      type: 'clueHuntStep',
      huntId: TEST_HUNT.id,
      step: 4,
      total: TOTAL,
      pid: sim.playerId,
    });
    expect(ofType(evs, 'clueHuntDone')[0]).toEqual({
      type: 'clueHuntDone',
      huntId: TEST_HUNT.id,
      pid: sim.playerId,
    });
    // The scroll left over opens a fresh hunt, as with no hunt at all.
    sim.useItem(CLUE_SCROLL_ITEM_ID);
    expect(meta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
  });

  it('a dig in another zone at the same coordinates is refused', () => {
    CLUE_HUNT_TEST_POOL.length = 0;
    CLUE_HUNT_TEST_POOL.push({
      id: 'hunt_test_wrong_zone',
      steps: [{ kind: 'dig', zoneId: 'frostveil', x: DIG_SPOT.x, z: DIG_SPOT.z }],
    });
    const sim = huntSim();
    startHunt(sim);
    sim.addItem(CLUE_SCROLL_ITEM_ID, 1);
    placeAt(sim, DIG_SPOT.x, DIG_SPOT.z);
    sim.drainEvents();
    sim.useItem(CLUE_SCROLL_ITEM_ID);
    expect(errorTexts(sim.drainEvents())).toEqual(['There is nothing to dig here.']);
    expect(metaOf(sim).clueHunt?.step).toBe(0);
  });
});

describe('abandon', () => {
  it('clears the hunt, emits, bumps the revision; a second call is a no-op', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 2);
    const rev = meta.wireRev;
    sim.abandonClueHunt();
    const evs = sim.drainEvents();
    expect(meta.clueHunt).toBeNull();
    expect(meta.wireRev).toBeGreaterThan(rev);
    expect(evs).toEqual([{ type: 'clueHuntAbandoned', huntId: TEST_HUNT.id, pid: sim.playerId }]);
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID)).toBe(0);
    sim.abandonClueHunt();
    expect(sim.drainEvents()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The casket

describe('the Treasure Casket', () => {
  it('pays the copper formula and a stack of one top-tier material, bumps the count and marks deeds dirty', () => {
    const sim = huntSim(4711, 20, false);
    const meta = metaOf(sim);
    sim.addItem(TREASURE_CASKET_ITEM_ID, 1);
    sim.drainEvents();
    const copperBefore = meta.copper;
    expect(meta.clueCasketsOpened).toBe(0);
    sim.useItem(TREASURE_CASKET_ITEM_ID);
    const evs = sim.drainEvents();
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID)).toBe(0);
    expect(meta.copper - copperBefore).toBe(CASKET_COPPER_BASE + CASKET_COPPER_PER_LEVEL * 20);
    expect(treasureCasketCopper(20)).toBe(60_000);
    const opened = ofType(evs, 'clueCasketOpened');
    expect(opened).toHaveLength(1);
    expect(opened[0].copper).toBe(60_000);
    expect(opened[0].pid).toBe(sim.playerId);
    // The guaranteed grant comes first: one material from the pool, stacked.
    const material = opened[0].itemIds[0];
    expect(CASKET_MATERIAL_POOL).toContain(material);
    expect(sim.countItem(material)).toBe(CASKET_MATERIAL_COUNT);
    expect(meta.clueCasketsOpened).toBe(1);
    expect(sim.ctx.deedDirtyPids.has(sim.playerId)).toBe(true);
    // The count is what the deed meter reads, and the first-casket deed lands.
    const tickEvs = sim.tick();
    expect(
      ofType(tickEvs, 'deedUnlocked').some((ev) => ev.deedId === 'exp_clue_first_casket'),
    ).toBe(true);
  });

  it('the clueCasketsOpened meter has no narrow key (the open site marks a full pass)', () => {
    expect(METER_DIRTY_KEYS.clueCasketsOpened).toEqual([]);
  });

  // A fake ctx around a real Rng: the payout is a pure function of the rng,
  // so the odds are pinned across seeds without a Sim per roll.
  function openWithSeed(seed: number, ownedReins = false) {
    const grants: { itemId: string; count: number }[] = [];
    const emits: SimEvent[] = [];
    const meta = {
      entityId: 1,
      cls: 'mage',
      copper: 0,
      clueCasketsOpened: 4,
      inventory: ownedReins ? [{ itemId: CASKET_MOUNT_REINS_ITEM_ID, count: 1 }] : [],
      bank: { inventory: [] },
    } as unknown as PlayerMeta;
    const ctx = {
      rng: new Rng(seed),
      addItem: (itemId: string, count: number) => grants.push({ itemId, count }),
      emit: (ev: SimEvent) => emits.push(ev),
      markDeedsDirty: vi.fn(),
    } as unknown as SimContext;
    let spent = 0;
    openTreasureCasket(ctx, meta, { level: 17 } as Entity, () => spent++);
    return { grants, emits, meta, ctx, spent };
  }

  it('rolls gear, marks and the Lanternback at their pinned odds, in a fixed order', () => {
    expect(CASKET_GEAR_CHANCE).toBe(0.1);
    expect(CASKET_HEROIC_MARK_CHANCE).toBe(0.05);
    expect(CASKET_MOUNT_CHANCE).toBe(0.015);
    const TRIALS = 6000;
    let gear = 0;
    let marks = 0;
    let mount = 0;
    const materials = new Set<string>();
    for (let seed = 1; seed <= TRIALS; seed++) {
      const { grants, emits, meta, ctx, spent } = openWithSeed(seed);
      expect(spent).toBe(1);
      expect(meta.copper).toBe(CASKET_COPPER_BASE + CASKET_COPPER_PER_LEVEL * 17);
      expect(meta.clueCasketsOpened).toBe(5);
      expect(ctx.markDeedsDirty).toHaveBeenCalledWith(1);
      const opened = ofType(emits, 'clueCasketOpened')[0];
      expect(opened.itemIds).toEqual(grants.map((g) => g.itemId));
      // Always first: the material stack.
      expect(CASKET_MATERIAL_POOL).toContain(grants[0].itemId);
      expect(grants[0].count).toBe(CASKET_MATERIAL_COUNT);
      materials.add(grants[0].itemId);
      // Then the extras, each at most once and in gear, marks, mount order.
      const rest = grants.slice(1).map((g) => g.itemId);
      const kinds = rest.map((id) =>
        id === HEROIC_MARK_ITEM_ID ? 'marks' : id === CASKET_MOUNT_REINS_ITEM_ID ? 'mount' : 'gear',
      );
      expect(
        [...kinds].sort(
          (x, y) => ['gear', 'marks', 'mount'].indexOf(x) - ['gear', 'marks', 'mount'].indexOf(y),
        ),
      ).toEqual(kinds);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const g of grants.slice(1)) {
        if (g.itemId === HEROIC_MARK_ITEM_ID) {
          expect(g.count).toBe(CASKET_HEROIC_MARKS);
          marks++;
        } else if (g.itemId === CASKET_MOUNT_REINS_ITEM_ID) {
          expect(g.count).toBe(1);
          mount++;
        } else {
          // A caster's lowest delve rung: one of the two reliquary pieces.
          expect(['reliquary_legs', 'reliquary_shoulder']).toContain(g.itemId);
          gear++;
        }
      }
    }
    expect([...materials].sort()).toEqual([...CASKET_MATERIAL_POOL].sort());
    expect(gear / TRIALS).toBeGreaterThan(CASKET_GEAR_CHANCE - 0.02);
    expect(gear / TRIALS).toBeLessThan(CASKET_GEAR_CHANCE + 0.02);
    expect(marks / TRIALS).toBeGreaterThan(CASKET_HEROIC_MARK_CHANCE - 0.015);
    expect(marks / TRIALS).toBeLessThan(CASKET_HEROIC_MARK_CHANCE + 0.015);
    expect(mount / TRIALS).toBeGreaterThan(CASKET_MOUNT_CHANCE - 0.008);
    expect(mount / TRIALS).toBeLessThan(CASKET_MOUNT_CHANCE + 0.008);
  });

  it('never hands the Lanternback to an owner, and draws the same rng sequence either way', () => {
    let rolledMount = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const fresh = openWithSeed(seed).grants.map((g) => g.itemId);
      const owner = openWithSeed(seed, true).grants.map((g) => g.itemId);
      expect(owner).not.toContain(CASKET_MOUNT_REINS_ITEM_ID);
      // The owner's grants are the fresh grants minus the reins: the mount
      // roll is always drawn, so every other outcome matches seed for seed.
      expect(owner).toEqual(fresh.filter((id) => id !== CASKET_MOUNT_REINS_ITEM_ID));
      if (fresh.includes(CASKET_MOUNT_REINS_ITEM_ID)) rolledMount++;
    }
    expect(rolledMount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Persistence and the daily reset

describe('the character save', () => {
  it('serializes byte-identically to a pre-feature save when nothing is set', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const fresh = sim.serializeCharacter(sim.playerId);
    if (!fresh) throw new Error('Missing serialized character');
    expect(fresh.worldQuests).toBeUndefined();
    const json = JSON.stringify(fresh);
    expect(json).not.toContain('clueHunt');
    expect(json).not.toContain('clueScrollCycle');
    expect(json).not.toContain('clueCasketsOpened');
  });

  it('round-trips the hunt, the paid cycle and the count through serializeCharacter/addPlayer', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 2);
    meta.clueScrollCycle = meta.worldQuestCycle;
    meta.clueCasketsOpened = 3;
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    expect(state.worldQuests?.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 2 });
    expect(state.worldQuests?.clueHunt).not.toBe(meta.clueHunt);
    expect(state.worldQuests?.clueScrollCycle).toBe(meta.worldQuestCycle);
    expect(state.worldQuests?.clueCasketsOpened).toBe(3);

    const restored = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Digger', { state });
    const restoredMeta = restored.meta(pid);
    if (!restoredMeta) throw new Error('Missing restored player');
    expect(restoredMeta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 2 });
    expect(restoredMeta.clueScrollCycle).toBe(meta.worldQuestCycle);
    expect(restoredMeta.clueCasketsOpened).toBe(3);
    expect(restored.serializeCharacter(pid)?.worldQuests?.clueHunt).toEqual({
      huntId: TEST_HUNT.id,
      step: 2,
    });
  });

  it('carries the fields even when the character has no active board', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const meta = metaOf(sim);
    expect(sim.serializeCharacter(sim.playerId)?.worldQuests).toBeUndefined();
    meta.clueCasketsOpened = 2;
    let state = sim.serializeCharacter(sim.playerId);
    expect(state?.worldQuests?.clueCasketsOpened).toBe(2);
    expect(state?.worldQuests?.clueHunt).toBeUndefined();
    expect(state?.worldQuests?.clueScrollCycle).toBeUndefined();
    meta.clueCasketsOpened = 0;
    meta.clueHunt = { huntId: TEST_HUNT.id, step: 1 };
    state = sim.serializeCharacter(sim.playerId);
    expect(state?.worldQuests?.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 1 });
    expect(state?.worldQuests?.clueCasketsOpened).toBeUndefined();
  });

  it('a retired hunt id restores to null; a hostile step is clamped; junk is dropped', () => {
    const sim = huntSim();
    startHunt(sim);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state?.worldQuests) throw new Error('Missing serialized character');
    const load = (patch: Partial<NonNullable<typeof state.worldQuests>>) => {
      const host = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
      const pid = host.addPlayer('warrior', 'Loaded', {
        state: { ...state, worldQuests: { ...state.worldQuests, ...patch } as never },
      });
      return host.meta(pid);
    };
    expect(load({ clueHunt: { huntId: 'hunt_retired', step: 0 } })?.clueHunt).toBeNull();
    expect(load({ clueHunt: { huntId: TEST_HUNT.id, step: 99 } })?.clueHunt).toEqual({
      huntId: TEST_HUNT.id,
      step: TOTAL - 1,
    });
    expect(load({ clueHunt: { huntId: TEST_HUNT.id, step: -1 } })?.clueHunt).toEqual({
      huntId: TEST_HUNT.id,
      step: 0,
    });
    expect(load({ clueHunt: 'junk' as never })?.clueHunt).toBeNull();
    const hostile = load({
      clueScrollCycle: 'not-a-cycle',
      clueCasketsOpened: -4 as never,
    });
    expect(hostile?.clueScrollCycle).toBe('');
    expect(hostile?.clueCasketsOpened).toBe(0);
    expect(load({ clueCasketsOpened: 2.7 })?.clueCasketsOpened).toBe(2);
  });

  it('sanitizeClueHunt is the one rule (shared with the wire decoder)', () => {
    expect(sanitizeClueHunt(null)).toBeNull();
    expect(sanitizeClueHunt({ huntId: 7, step: 0 })).toBeNull();
    expect(sanitizeClueHunt({ huntId: TEST_HUNT.id })).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(sanitizeClueHunt({ huntId: TEST_HUNT.id, step: 2.9 })).toEqual({
      huntId: TEST_HUNT.id,
      step: 2,
    });
  });
});

describe('the daily reset', () => {
  it('a rollover clears the board but never the hunt, the paid cycle, or the count', () => {
    const sim = huntSim();
    const meta = metaOf(sim);
    startHunt(sim);
    advanceTo(sim, 1);
    meta.clueScrollCycle = meta.worldQuestCycle;
    meta.clueCasketsOpened = 1;
    const paid = meta.clueScrollCycle;
    sim.resetDay = '2026-09-01';
    sim.tick();
    sim.tick();
    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-09-01'));
    expect(meta.clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 1 });
    expect(meta.clueScrollCycle).toBe(paid);
    expect(meta.clueCasketsOpened).toBe(1);
    // And the hunt still plays on: the next step resolves on the new day.
    talkTo(sim, 'gatecaptain_brannoc');
    expect(meta.clueHunt?.step).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The /dev clue family

describe('/dev clue', () => {
  function devSim(): Sim {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.drainEvents();
    return sim;
  }

  it('grants a scroll up to the stack cap', () => {
    const sim = devSim();
    for (let i = 0; i < CLUE_SCROLL_STACK_MAX; i++) sim.chat('/dev clue');
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(CLUE_SCROLL_STACK_MAX);
    sim.drainEvents();
    sim.chat('/dev clue');
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(CLUE_SCROLL_STACK_MAX);
    expect(errorTexts(sim.drainEvents())).toEqual(['[dev] You cannot hold another Clue Scroll.']);
  });

  it('hunt <id> starts that hunt directly and lifts a low-level tester to the bracket', () => {
    const sim = devSim();
    expect(sim.player.level).toBeLessThan(CLUE_SCROLL_MIN_LEVEL);
    sim.chat(`/dev clue hunt ${TEST_HUNT.id}`);
    const evs = sim.drainEvents();
    expect(metaOf(sim).clueHunt).toEqual({ huntId: TEST_HUNT.id, step: 0 });
    expect(sim.player.level).toBe(CLUE_SCROLL_MIN_LEVEL);
    expect(ofType(evs, 'clueHuntStarted')).toHaveLength(1);
    expect(sim.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    sim.chat('/dev clue hunt hunt_nope');
    expect(errorTexts(sim.drainEvents())[0]).toContain('Unknown clue hunt "hunt_nope"');
  });

  it('solve completes the current step, through to the casket', () => {
    const sim = devSim();
    sim.chat(`/dev clue hunt ${TEST_HUNT.id}`);
    sim.drainEvents();
    for (let i = 0; i < TOTAL - 1; i++) sim.chat('/dev clue solve');
    expect(metaOf(sim).clueHunt).toEqual({ huntId: TEST_HUNT.id, step: TOTAL - 1 });
    sim.chat('/dev clue solve');
    expect(metaOf(sim).clueHunt).toBeNull();
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID)).toBe(1);
    sim.drainEvents();
    sim.chat('/dev clue solve');
    expect(errorTexts(sim.drainEvents())).toEqual(['[dev] No clue hunt is active.']);
  });

  it('casket grants one, and the family is inert without devCommands', () => {
    const sim = devSim();
    sim.chat('/dev clue casket');
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID)).toBe(1);
    const plain = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: false,
      world: EMPTY_TEST_WORLD,
    });
    plain.chat('/dev clue');
    plain.chat('/dev clue casket');
    plain.chat(`/dev clue hunt ${TEST_HUNT.id}`);
    expect(plain.countItem(CLUE_SCROLL_ITEM_ID)).toBe(0);
    expect(plain.countItem(TREASURE_CASKET_ITEM_ID)).toBe(0);
    expect(metaOf(plain).clueHunt).toBeNull();
  });
});
