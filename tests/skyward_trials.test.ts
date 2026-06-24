import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import type { Entity, SimEvent } from '../src/sim/types';
import { COURSES } from '../src/sim/content/courses';

// Phase 6 — the "Skyward Trials" flight questline: a finish_course objective type
// credited by the solo course-finish path, with a par-time gate and a Charter
// capstone. Real end-to-end: accept → fly → credit → turn in → reward.

const CAST_TICKS = 40;

type P = { pos: { x: number; y: number; z: number }; prevPos: { x: number; y: number; z: number }; mountTier?: number; mountId?: string };

function makeFlyer(level = 10) {
  const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(level);
  const p = sim.player as unknown as P;
  p.pos.x = 40; p.pos.z = 40; p.pos.y = terrainHeight(40, 40, sim.cfg.seed); p.prevPos = { ...p.pos };
  (p as unknown as { mountTier: number }).mountTier = 11;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.aiState = 'idle'; }
  }
  sim.summonMount('sovereign');
  for (let i = 0; i < CAST_TICKS; i++) sim.tick();
  expect(sim.player.mountId).toBe('sovereign');
  return { sim, p };
}

// The Skytrial Master stands at (44,138); stand on him so accept/turn-in pass the
// proximity gate (talk range is 2D, so the rider's flight altitude is irrelevant).
function standAtMaster(sim: Sim, p: P): Entity {
  let npc: Entity | undefined;
  for (const e of sim.entities.values()) if (e.templateId === 'skytrial_master') npc = e;
  if (!npc) throw new Error('skytrial_master NPC was not spawned');
  p.pos.x = npc.pos.x; p.pos.z = npc.pos.z; p.prevPos = { ...p.pos };
  return npc;
}

// Fly a full course (all laps) by teleporting gate to gate — the fast clean line.
function flyCourse(sim: Sim, p: P, courseId: string): SimEvent[] {
  const def = COURSES[courseId];
  expect(sim.startCourse(courseId)).toBe(true);
  const evs: SimEvent[] = [];
  for (let lap = 0; lap < def.laps; lap++) {
    for (const g of def.checkpoints) {
      p.pos.x = g.x; p.pos.y = g.y; p.pos.z = g.z;
      for (const ev of sim.tick()) evs.push(ev);
    }
  }
  return evs;
}

function counts(sim: Sim, questId: string): number[] {
  return [...sim.questLog.values()].find((q) => q.questId === questId)?.counts ?? [];
}

describe('Skyward Trials questline', () => {
  it('credits the intro quest on any clean completion, then turns in', () => {
    const { sim, p } = makeFlyer();
    standAtMaster(sim, p);
    expect(sim.questState('q_skyward_first_flight')).toBe('available');
    sim.acceptQuest('q_skyward_first_flight');
    expect(counts(sim, 'q_skyward_first_flight')).toEqual([0]);

    const evs = flyCourse(sim, p, 'skytrial_vale');
    expect(evs.some((e) => e.type === 'courseFinish')).toBe(true);
    expect(counts(sim, 'q_skyward_first_flight')).toEqual([1]);
    expect(sim.questState('q_skyward_first_flight')).toBe('ready');

    standAtMaster(sim, p);
    const copperBefore = sim.players.get(sim.playerId)!.copper;
    sim.turnInQuest('q_skyward_first_flight');
    expect(sim.questState('q_skyward_first_flight')).toBe('done');
    expect(sim.players.get(sim.playerId)!.copper).toBe(copperBefore + 800);
  });

  it('par gate: a fast run credits Beat the Clock; a slow run does not', () => {
    const { sim, p } = makeFlyer();
    standAtMaster(sim, p);
    // clear the prerequisite
    sim.acceptQuest('q_skyward_first_flight');
    flyCourse(sim, p, 'skytrial_vale');
    standAtMaster(sim, p);
    sim.turnInQuest('q_skyward_first_flight');

    // PASS: a clean teleport line finishes far under the 720-tick par
    sim.acceptQuest('q_skyward_time_trial');
    flyCourse(sim, p, 'skytrial_vale');
    expect(counts(sim, 'q_skyward_time_trial')).toEqual([1]);
    standAtMaster(sim, p);
    sim.turnInQuest('q_skyward_time_trial');
    expect(sim.questState('q_skyward_time_trial')).toBe('done');
  });

  it('par gate: a run slower than par does NOT credit', () => {
    const { sim, p } = makeFlyer();
    standAtMaster(sim, p);
    sim.acceptQuest('q_skyward_first_flight');
    flyCourse(sim, p, 'skytrial_vale');
    standAtMaster(sim, p);
    sim.turnInQuest('q_skyward_first_flight');

    sim.acceptQuest('q_skyward_time_trial');
    const def = COURSES.skytrial_vale;
    // cross the first gate (starts the clock), dawdle past par, then finish
    expect(sim.startCourse('skytrial_vale')).toBe(true);
    const g0 = def.checkpoints[0];
    p.pos.x = g0.x; p.pos.y = g0.y; p.pos.z = g0.z; sim.tick();
    for (let i = 0; i < 730; i++) sim.tick(); // hover past the 720-tick par
    for (const g of def.checkpoints.slice(1)) { p.pos.x = g.x; p.pos.y = g.y; p.pos.z = g.z; sim.tick(); }

    expect(counts(sim, 'q_skyward_time_trial')).toEqual([0]); // too slow — no credit
    expect(sim.questState('q_skyward_time_trial')).toBe('active');
  });

  it('the chain gates: Beat the Clock is unavailable until First Flight is done', () => {
    const { sim, p } = makeFlyer();
    standAtMaster(sim, p);
    expect(sim.questState('q_skyward_time_trial')).toBe('unavailable');
    expect(sim.questState('q_skyward_ascendant')).toBe('unavailable');

    sim.acceptQuest('q_skyward_first_flight');
    flyCourse(sim, p, 'skytrial_vale');
    standAtMaster(sim, p);
    sim.turnInQuest('q_skyward_first_flight');
    expect(sim.questState('q_skyward_time_trial')).toBe('available'); // now unlocked
    expect(sim.questState('q_skyward_ascendant')).toBe('unavailable'); // still gated
  });

  it('the capstone awards a Goldcrest Charter + gold on turn-in', () => {
    const { sim, p } = makeFlyer();
    // run the whole chain
    standAtMaster(sim, p); sim.acceptQuest('q_skyward_first_flight');
    flyCourse(sim, p, 'skytrial_vale'); standAtMaster(sim, p); sim.turnInQuest('q_skyward_first_flight');
    standAtMaster(sim, p); sim.acceptQuest('q_skyward_time_trial');
    flyCourse(sim, p, 'skytrial_vale'); standAtMaster(sim, p); sim.turnInQuest('q_skyward_time_trial');
    standAtMaster(sim, p); sim.acceptQuest('q_skyward_ascendant');
    flyCourse(sim, p, 'vale_circuit');
    expect(counts(sim, 'q_skyward_ascendant')).toEqual([1]);

    standAtMaster(sim, p);
    const copperBefore = sim.players.get(sim.playerId)!.copper;
    sim.turnInQuest('q_skyward_ascendant');
    expect(sim.questState('q_skyward_ascendant')).toBe('done');
    expect(sim.countItem('charter_goldcrest', sim.playerId)).toBe(1);
    expect(sim.players.get(sim.playerId)!.copper).toBe(copperBefore + 50000);
  });

  it('a RACE finish does not credit the quest (solo runs only)', () => {
    const { sim, p } = makeFlyer();
    standAtMaster(sim, p);
    sim.acceptQuest('q_skyward_first_flight');

    // run the course as a (solo) race instead of a solo time-trial
    expect(sim.startRace('skytrial_vale')).toBe(true);
    for (let i = 0; i < 61; i++) sim.tick(); // countdown → GO
    const def = COURSES.skytrial_vale;
    for (const g of def.checkpoints) { p.pos.x = g.x; p.pos.y = g.y; p.pos.z = g.z; sim.tick(); }

    expect(counts(sim, 'q_skyward_first_flight')).toEqual([0]); // race path never credits
    expect(sim.questState('q_skyward_first_flight')).toBe('active');
  });
});
