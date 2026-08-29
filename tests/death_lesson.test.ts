// The death lesson (q_ps_the_long_walk): the island stages a player's first
// death somewhere nothing is hunting them, then teaches the walk back.
//
// Two properties matter more than the rest, and both are about NOT stranding
// a new player: the rite must refuse anyone who has not been asked for it,
// and the lesson must complete on either resurrection path, because a player
// who took the Spirit Healer has no corpse left to walk to.

import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_ITEMS, PROVING_SHORE_QUESTS } from '../src/sim/content/proving_shore';
import { Sim } from '../src/sim/sim';
import { CORPSE_REZ_RANGE } from '../src/sim/spirit';
import {
  creditDeathLesson,
  DEATH_LESSON_OBJECT_ITEM_ID,
  DEATH_LESSON_QUEST_ID,
  PASSING_STONE_ITEM_ID,
  usePassingStone,
} from '../src/sim/tutorial/death_lesson';
import type { Entity, QuestProgress, SimEvent } from '../src/sim/types';

function makeSim(seed = 7311): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function seedActiveLesson(sim: Sim): QuestProgress {
  const meta = sim.players.get(sim.playerId)!;
  const qp: QuestProgress = { questId: DEATH_LESSON_QUEST_ID, counts: [0], state: 'active' };
  meta.questLog.set(DEATH_LESSON_QUEST_ID, qp);
  return qp;
}

/** The stone works wherever the player is standing, so the fixture just
 *  grounds them somewhere on the island. */
function standAtStone(sim: Sim): Entity {
  const p = sim.entities.get(sim.playerId)!;
  const g = sim.groundPos(-312, -6);
  p.pos.x = g.x;
  p.pos.y = g.y;
  p.pos.z = g.z;
  p.prevPos = { ...p.pos };
  // The quest hands one over; the fixtures below seed it directly.
  sim.ctx.addItem(PASSING_STONE_ITEM_ID, 1, sim.playerId);
  return p;
}

describe('the Passing Stone is a carried, single-use rite', () => {
  it('is a usable quest item, not a fixture to walk to', () => {
    // CX: a new player told to go and die needs the thing that does it in
    // their hand, not a rock somewhere on the map.
    const def = PROVING_SHORE_ITEMS[PASSING_STONE_ITEM_ID];
    expect(def).toBeTruthy();
    expect(def.use?.type).toBe('passingStone');
    expect(def.questId).toBe(DEATH_LESSON_QUEST_ID);
  });

  it('is handed over by the quest, and re-granted if lost', () => {
    expect(PROVING_SHORE_QUESTS[DEATH_LESSON_QUEST_ID].requiredItems).toContain(
      PASSING_STONE_ITEM_ID,
    );
  });
});

describe('the quest is authored the way the credit arm reads it', () => {
  it('carries the sentinel objective the credit keys on', () => {
    const quest = PROVING_SHORE_QUESTS[DEATH_LESSON_QUEST_ID];
    expect(quest).toBeTruthy();
    const objective = quest.objectives[0];
    expect(objective.type).toBe('interact');
    expect(objective.type === 'interact' && objective.targetObjectItemId).toBe(
      DEATH_LESSON_OBJECT_ITEM_ID,
    );
  });

  it('sits after the guild board, where the CX pass asked for it', () => {
    expect(PROVING_SHORE_QUESTS[DEATH_LESSON_QUEST_ID].requiresQuest).toBe('q_ps_the_signpost');
    // ...and before the crossing, so nobody leaves the island without it.
    expect(PROVING_SHORE_QUESTS.q_ps_set_sail.requiresQuest).toBe(DEATH_LESSON_QUEST_ID);
  });
});

describe('usePassingStone', () => {
  it('kills the kneeling player, leaving the body where they knelt', () => {
    const sim = makeSim();
    seedActiveLesson(sim);
    const p = standAtStone(sim);
    const meta = sim.players.get(sim.playerId)!;
    const where = { x: p.pos.x, z: p.pos.z };
    usePassingStone(sim.ctx, p, meta);
    expect(p.dead).toBe(true);
    expect(p.hp).toBe(0);
    // corpsePos is captured when the SPIRIT is released (spirit.ts), not at
    // the moment of death, so the body is pinned after that step.
    sim.releaseSpirit();
    expect(p.corpsePos?.x).toBeCloseTo(where.x, 3);
    expect(p.corpsePos?.z).toBeCloseTo(where.z, 3);
  });

  it('refuses anyone who has not been asked, and says why', () => {
    // A stone that killed a passer-by would be a griefing tool; one that
    // silently did nothing would read as a bug.
    const sim = makeSim();
    const p = standAtStone(sim);
    const meta = sim.players.get(sim.playerId)!;
    sim.tick();
    usePassingStone(sim.ctx, p, meta);
    expect(p.dead).toBe(false);
    const errs = sim
      .tick()
      .filter((e: SimEvent): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
    expect(errs.length).toBeGreaterThan(0);
  });

  it('refuses a player who has already knelt, rather than killing a ghost', () => {
    const sim = makeSim();
    seedActiveLesson(sim);
    const p = standAtStone(sim);
    const meta = sim.players.get(sim.playerId)!;
    usePassingStone(sim.ctx, p, meta);
    expect(p.dead).toBe(true);
    // A second click while dead is consumed but changes nothing.
    usePassingStone(sim.ctx, p, meta);
    expect(p.hp).toBe(0);
  });

  it('does not credit the quest merely for dying', () => {
    // The objective is the WALK BACK, not the death.
    const sim = makeSim();
    const qp = seedActiveLesson(sim);
    const p = standAtStone(sim);
    usePassingStone(sim.ctx, p, sim.players.get(sim.playerId)!);
    expect(qp.counts[0]).toBe(0);
  });
});

describe('creditDeathLesson', () => {
  it('completes the lesson on the corpse run, the path it teaches', () => {
    const sim = makeSim();
    const qp = seedActiveLesson(sim);
    creditDeathLesson(sim.ctx, sim.players.get(sim.playerId)!, true);
    expect(qp.counts[0]).toBe(1);
    expect(qp.state).toBe('ready');
  });

  it('ALSO completes it at the Spirit Healer, so nobody strands', () => {
    // A player who took the Keeper has no corpse left; a lesson that only
    // credited the ideal path would leave them holding a quest they can
    // never finish.
    const sim = makeSim();
    const qp = seedActiveLesson(sim);
    creditDeathLesson(sim.ctx, sim.players.get(sim.playerId)!, false);
    expect(qp.counts[0]).toBe(1);
    expect(qp.state).toBe('ready');
  });

  it('tells the two paths apart in what it says', () => {
    const atCorpse = makeSim();
    seedActiveLesson(atCorpse);
    creditDeathLesson(atCorpse.ctx, atCorpse.players.get(atCorpse.playerId)!, true);
    const corpseLogs = atCorpse
      .tick()
      .filter((e: SimEvent): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
      .map((e) => e.text);

    const atHealer = makeSim();
    seedActiveLesson(atHealer);
    creditDeathLesson(atHealer.ctx, atHealer.players.get(atHealer.playerId)!, false);
    const healerLogs = atHealer
      .tick()
      .filter((e: SimEvent): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
      .map((e) => e.text);

    expect(corpseLogs.join(' ')).not.toEqual(healerLogs.join(' '));
    // The healer arm nudges them toward the free walk next time.
    expect(healerLogs.join(' ')).toMatch(/walk to your body/i);
  });

  it('credits nothing without the lesson active', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    creditDeathLesson(sim.ctx, meta, true);
    expect(meta.questLog.get(DEATH_LESSON_QUEST_ID)).toBeUndefined();
  });

  it('never counts past the objective', () => {
    const sim = makeSim();
    const qp = seedActiveLesson(sim);
    const meta = sim.players.get(sim.playerId)!;
    for (let i = 0; i < 4; i++) creditDeathLesson(sim.ctx, meta, true);
    expect(qp.counts[0]).toBe(1);
  });
});

describe('the whole lesson, end to end through the real sim', () => {
  it('kneel, release, walk back, resurrect: the quest reads ready', () => {
    const sim = makeSim();
    const qp = seedActiveLesson(sim);
    const p = standAtStone(sim);
    const meta = sim.players.get(sim.playerId)!;

    usePassingStone(sim.ctx, p, meta);
    expect(p.dead).toBe(true);
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    // The spirit rises at the graveyard, genuinely away from the body.
    expect(Math.hypot(p.pos.x - p.corpsePos!.x, p.pos.z - p.corpsePos!.z)).toBeGreaterThan(
      CORPSE_REZ_RANGE,
    );
    // Out of range, the resurrect is refused and the lesson stays open.
    sim.resurrectAtCorpse();
    expect(p.ghost).toBe(true);
    expect(qp.counts[0]).toBe(0);

    // Walk the spirit back to the body and step into it.
    p.pos.x = p.corpsePos!.x;
    p.pos.z = p.corpsePos!.z;
    sim.resurrectAtCorpse();
    expect(p.ghost).toBe(false);
    expect(p.dead).toBe(false);
    expect(qp.counts[0]).toBe(1);
    expect(qp.state).toBe('ready');
  });
});
