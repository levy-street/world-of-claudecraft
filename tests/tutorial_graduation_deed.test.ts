// "Ready for an Adventure" (content/deeds.ts prog_ready_for_an_adventure):
// granted when the whole Proving Shore rail is handed in AND the island
// ferry bell is rung for the ride home (interactions/ferry_bell.ts bumps the
// tutorialGraduations stat on exactly that crossing), and never on a
// mid-lesson misclick ride.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import {
  PROVING_SHORE_NPCS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
} from '../src/sim/content/proving_shore';
import { Sim } from '../src/sim/sim';

const DEED_ID = 'prog_ready_for_an_adventure';

function makeSim(seed = 4120): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function islandBell(sim: Sim) {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'object' && e.objectItemId === 'ps_ferry_bell' && e.pos.x < -180,
  )!;
}

function ringIslandBell(sim: Sim): void {
  const p = sim.entities.get(sim.playerId)!;
  const bell = islandBell(sim);
  p.pos.x = bell.pos.x + 1;
  p.pos.z = bell.pos.z;
  sim.pickUpObject(bell.id);
  // Let the deed evaluator's dirty-key pass run.
  for (let i = 0; i < 40; i++) sim.tick();
}

function completeRail(sim: Sim): void {
  const p = sim.entities.get(sim.playerId)!;
  for (const questId of PROVING_SHORE_QUEST_ORDER) {
    const giver = PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS[questId].giverNpcId];
    p.pos.x = giver.pos.x + 1;
    p.pos.z = giver.pos.z + 1;
    sim.acceptQuest(questId);
    sim.completeQuestForDev(questId);
  }
}

describe('Ready for an Adventure', () => {
  it('is authored as a visible progression deed on the graduation stat', () => {
    const deed = DEEDS[DEED_ID];
    expect(deed).toBeTruthy();
    expect(deed.category).toBe('progression');
    expect(deed.hidden).toBeUndefined();
    expect(deed.trigger).toEqual({ kind: 'stat', stat: 'tutorialGraduations', count: 1 });
  });

  it('grants on the bell ride home after the whole rail is handed in', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    completeRail(sim);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
    ringIslandBell(sim);
    expect(meta.deedStats.counters.tutorialGraduations).toBe(1);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(true);
  });

  it('never grants on a ride home with the rail unfinished', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    ringIslandBell(sim);
    expect(meta.deedStats.counters.tutorialGraduations).toBe(0);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
  });

  it('the whole rail except Set Sail is NOT a graduation (the discriminating arm)', () => {
    // A regression to "any rail quest done" (or "all but the last") must fail
    // here: everything handed in except the final quest, then the ride home,
    // no bump (PR #3467 review, finding 11).
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    const p = sim.entities.get(sim.playerId)!;
    const allButLast = PROVING_SHORE_QUEST_ORDER.slice(0, -1);
    for (const questId of allButLast) {
      const giver = PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS[questId].giverNpcId];
      p.pos.x = giver.pos.x + 1;
      p.pos.z = giver.pos.z + 1;
      sim.acceptQuest(questId);
      sim.completeQuestForDev(questId);
    }
    expect(meta.questsDone.size).toBe(allButLast.length);
    ringIslandBell(sim);
    expect(meta.deedStats.counters.tutorialGraduations).toBe(0);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
  });

  it('the TOWN bell never graduates, even a full graduate riding back out', () => {
    // The stat is authored on the home ride specifically: a graduate ringing
    // the town bell for an island refresher must not bump it again from the
    // town side (the bump lives only in the island-bell arm).
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    completeRail(sim);
    const p = sim.entities.get(sim.playerId)!;
    const townBell = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'ps_ferry_bell' && e.pos.x >= -180,
    )!;
    p.pos.x = townBell.pos.x + 1;
    p.pos.z = townBell.pos.z;
    sim.pickUpObject(townBell.id);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.deedStats.counters.tutorialGraduations).toBe(0);
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
  });
});
