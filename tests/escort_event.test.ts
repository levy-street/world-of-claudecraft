// Escort runs (src/sim/events/escort.ts) driven end-to-end on the shipped
// Ironpass tollroad route: proximity start, waypoint walking, the scripted
// ambush, pause when the escort is left alone, failure on the escortee's
// death (with the cooldown respawn at start), and completion credit.

import { describe, expect, it } from 'vitest';
import { ESCORT_ROUTES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

const ROUTE = ESCORT_ROUTES.ironpass_tollroad;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function teleport(sim: AnySim, e: any, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function state(sim: AnySim) {
  return (sim as any).escortRuns.get(ROUTE.id)!;
}

function escortee(sim: AnySim) {
  return sim.entities.get(state(sim).escorteeEntityId)!;
}

function beginRun(sim: AnySim): void {
  sim.setPlayerLevel(32);
  const giver = [...sim.entities.values()].find(
    (e: any) =>
      e.kind === 'npc' && e.templateId === ROUTE.questId.replace(/^q_.*/, 'tollkeeper_brann'),
  )!;
  teleport(sim, sim.player, giver.pos.x - 1, giver.pos.z - 1);
  sim.acceptQuest(ROUTE.questId);
  expect(sim.questState(ROUTE.questId)).toBe('active');
  teleport(sim, sim.player, ROUTE.start.x + 2, ROUTE.start.z + 1);
  for (let i = 0; i < 5 && state(sim).phase === 'waiting'; i++) sim.tick();
  expect(state(sim).phase).toBe('walking');
}

// Keep the player glued to the escortee so the walk never pauses.
function followUntil(sim: AnySim, pred: () => boolean, maxSeconds: number): boolean {
  for (let i = 0; i < 20 * maxSeconds; i++) {
    const c = escortee(sim);
    teleport(sim, sim.player, c.pos.x + 2, c.pos.z - 2);
    sim.tick();
    if (pred()) return true;
  }
  return false;
}

describe('escort runs: the Ironpass tollroad', () => {
  it('starts on quest-holder proximity and walks the first waypoints', () => {
    const sim = makeSim();
    beginRun(sim);
    const advanced = followUntil(sim, () => state(sim).wpIndex >= 1, 60);
    expect(advanced).toBe(true);
  });

  it('springs the declared ambush at its waypoint, aggroed on the carter', () => {
    const sim = makeSim();
    beginRun(sim);
    const ambushed = followUntil(sim, () => state(sim).ambushMobIds.length > 0, 120);
    expect(ambushed).toBe(true);
    const mob = sim.entities.get(state(sim).ambushMobIds[0])!;
    expect(mob.aggroTargetId).toBe(state(sim).escorteeEntityId);
    // the carter turns to fight: combat preempts walking (pause-in-combat)
  });

  it('pauses when every quest-holder falls behind, resumes when they return', () => {
    const sim = makeSim();
    beginRun(sim);
    teleport(sim, sim.player, ROUTE.start.x - 120, ROUTE.start.z - 120);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(state(sim).phase).toBe('paused');
    const c = escortee(sim);
    teleport(sim, sim.player, c.pos.x + 2, c.pos.z);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(state(sim).phase).toBe('walking');
  });

  it('fails when the carter dies and respawns him at the start after the cooldown', () => {
    const sim = makeSim();
    beginRun(sim);
    const c = escortee(sim);
    const killer = [...sim.entities.values()].find(
      (e: any) => e.kind === 'mob' && e.hostile && !e.dead,
    )!;
    sim.dealDamage(killer, c, 9999999, false, 'physical', null, 'hit');
    expect(c.dead).toBe(true);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(state(sim).phase).toBe('cooldown');
    expect(sim.questLog.get(ROUTE.questId)!.counts[ROUTE.objectiveIndex]).toBe(0);
    // step away so the fresh carter does not immediately restart the walk
    teleport(sim, sim.player, ROUTE.start.x - 150, ROUTE.start.z - 150);
    for (let i = 0; i < 20 * (ROUTE.cooldownSeconds + 2); i++) sim.tick();
    expect(state(sim).phase).toBe('waiting');
    const fresh = escortee(sim);
    expect(fresh.dead).toBe(false);
    expect(Math.hypot(fresh.pos.x - ROUTE.start.x, fresh.pos.z - ROUTE.start.z)).toBeLessThan(4);
  });

  it('completes the objective for the accumulated participants at route end', () => {
    const sim = makeSim();
    beginRun(sim);
    // clear each ambush as it lands so the walk continues
    const done = followUntil(
      sim,
      () => {
        for (const id of [...state(sim).ambushMobIds]) {
          const m = sim.entities.get(id);
          if (m && !m.dead) sim.dealDamage(sim.player, m, 9999999, false, 'physical', null, 'hit');
        }
        return state(sim).phase === 'cooldown';
      },
      600,
    );
    expect(done).toBe(true);
    const qp = sim.questLog.get(ROUTE.questId)!;
    expect(qp.counts[ROUTE.objectiveIndex]).toBe(1);
    expect(qp.state).toBe('ready');
  });
});
