// Fire and Fly's ended seat leaves on its own (turret_defense_session.ts turretSeatExpired):
// an ended run's result stands TURRET_TIMING.endedSeatTicks from the tick it ended (its
// phaseEndTick), then the seat leaves through Leave's own path, not one tick before; a
// Replay starts the clock again; a live run never leaves on it; a dev seat and an
// instructor's seat follow the same rule.
import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TURRET_SCENARIO_INTRODUCTION } from '../src/sim/content/fire_and_fly_scenarios';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { TURRET_TIMING } from '../src/sim/content/turret_defense';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { BUILTIN_WORLD, DUNGEONS, dungeonAt } from '../src/sim/data';
import { positionAt } from '../src/sim/minigames/thrown_body';
import { mountItemId, summonMountItem } from '../src/sim/mounts';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { turretSeatExpired } from '../src/sim/turret_defense_session';
import { type SimEvent, TICK_RATE, type TurretSession, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const RUN_BOUND = 20 * 60 * 8;
const AMBERFALL = { x: -340, z: 1945 };
/** Each case plays thousands of ticks; under a loaded run it can pass the default 20 s. */
const TIMEOUT_MS = 60_000;
// The arena reads no world spawn, so the dev seats skip ticking the open world's crowds.
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function rig() {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    world: EMPTY_WORLD,
  });
  sim.chat(`/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`);
  return { sim, meta: sim.meta(sim.playerId) as PlayerMeta };
}

function seat(meta: PlayerMeta): TurretSession {
  if (meta.vehicle?.kind !== 'turret') throw new Error('expected a turret seat');
  return meta.vehicle;
}

function arenaClaims(sim: Sim) {
  return sim.ctx.instances.filter(
    (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.partyKey !== null,
  );
}

/** Lets the run fall (one tower point left, no shot) and returns the tick its end was emitted on. */
function loseRun(sim: Sim, meta: PlayerMeta): number {
  seat(meta).defense.integrity = 1;
  for (let i = 0; i < RUN_BOUND; i++) {
    for (const e of sim.tick()) {
      if (e.type === 'turretDefense' && e.event.type === 'ended') return e.tick;
    }
  }
  throw new Error('the run never ended');
}

const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };

/** Fires at the monster nearest the tower until the run ends; returns the ending tick's events. */
function winRun(sim: Sim, meta: PlayerMeta): SimEvent[] {
  for (let i = 0; i < RUN_BOUND; i++) {
    const events = sim.tick();
    if (events.some((e) => e.type === 'turretDefense' && e.event.type === 'ended')) return events;
    const defense = seat(meta).defense;
    if (sim.tickCount < defense.readyTick) continue;
    let best: { x: number; z: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const m of defense.monsters) {
      if (m.hp <= 0) continue;
      const p = positionAt(m.seg, sim.tickCount, ground);
      const d = Math.hypot(p.x - defense.cx, p.z - defense.cz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) sim.useVehicleAction('turret_fire', best);
  }
  throw new Error('the run never ended');
}

function tickTo(sim: Sim, tick: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.tickCount < tick) events.push(...sim.tick());
  return events;
}

describe('an ended seat leaves on its own', { timeout: TIMEOUT_MS }, () => {
  it('waits two minutes of sim ticks, named beside the other turret timings', () => {
    expect(TURRET_TIMING.endedSeatTicks).toBe(120 * TICK_RATE);
  });

  it('leaves a dev seat exactly two minutes after the run ended, through Leave, never a tick before', () => {
    const { sim, meta } = rig();
    meta.ridingTrained = true;
    sim.addItem(mountItemId(DEFAULT_MOUNT) as string, 1);
    expect(summonMountItem(sim.ctx, sim.playerId, DEFAULT_MOUNT)).toBe(true);
    for (let i = 0; i < 40 && sim.player.mountKey === ''; i++) sim.tick();
    expect(sim.player.mountKey).toBe(DEFAULT_MOUNT);
    sim.chat('/dev turret');
    const session = seat(meta);
    const home = session.returnTo;
    const ended = loseRun(sim, meta);
    const deadline = ended + TURRET_TIMING.endedSeatTicks;
    expect(session.defense.phase).toBe('lost');
    expect(session.defense.phaseEndTick).toBe(ended);

    tickTo(sim, deadline - 1);
    expect(seat(meta)).toBe(session);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(arenaClaims(sim)).toHaveLength(1);

    const events = sim.tick();
    expect(sim.tickCount).toBe(deadline);
    expect(meta.vehicle).toBeNull();
    expect(sim.turretSession).toBeNull();
    expect(sim.player.pos).toEqual({ x: home.x, y: home.y, z: home.z });
    expect(sim.player.facing).toBe(home.facing);
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
    expect(arenaClaims(sim)).toHaveLength(0);
    expect(sim.player.mountKey).toBe(DEFAULT_MOUNT);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'log', text: DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].leaveText }),
    );
  });

  it('restarts the clock on a Replay: the new run stays past the old deadline', () => {
    const { sim, meta } = rig();
    sim.chat('/dev turret');
    const ended = loseRun(sim, meta);
    tickTo(sim, ended + TURRET_TIMING.endedSeatTicks - 20);
    expect(sim.useVehicleAction('turret_replay', { x: 0, z: 0 })).toBe(true);
    const replayed = seat(meta);
    tickTo(sim, ended + TURRET_TIMING.endedSeatTicks + 20);
    expect(seat(meta)).toBe(replayed);
    expect(replayed.defense.phase).not.toBe('lost');

    const again = loseRun(sim, meta);
    tickTo(sim, again + TURRET_TIMING.endedSeatTicks - 1);
    expect(seat(meta)).toBe(replayed);
    sim.tick();
    expect(meta.vehicle).toBeNull();
  });

  it('never leaves a live run, however long past its last countdown', () => {
    const { sim, meta } = rig();
    sim.chat('/dev turret');
    const session = seat(meta);
    session.defense.integrity = 1e6;
    tickTo(sim, session.defense.startTick + TURRET_TIMING.endedSeatTicks + 100);
    expect(seat(meta)).toBe(session);
    expect(['wave', 'between']).toContain(session.defense.phase);
    expect(sim.tickCount).toBeGreaterThan(session.defense.phaseEndTick);
    expect(turretSeatExpired(session, sim.tickCount + 1e6)).toBe(false);
  });

  it("leaves an instructor's seat by the same rule", () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.resetDay = '2026-09-06';
    sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
    sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    const before = { ...sim.player.pos };
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, {
      courseId: TURRET_SCENARIO_INTRODUCTION.id,
    });
    expect(seat(meta).worldQuest).toBeDefined();
    const ended = loseRun(sim, meta);
    tickTo(sim, ended + TURRET_TIMING.endedSeatTicks - 1);
    expect(meta.vehicle?.kind).toBe('turret');
    sim.tick();
    expect(meta.vehicle).toBeNull();
    expect(sim.player.pos.x).toBeCloseTo(before.x, 6);
    expect(sim.player.pos.z).toBeCloseTo(before.z, 6);
  });

  it("leaves a WON instructor seat by the same rule, after the day's credit paid on the winning tick", () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.resetDay = '2026-09-06';
    sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
    sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, {
      courseId: TURRET_SCENARIO_INTRODUCTION.id,
    });
    const session = seat(meta);
    const events = winRun(sim, meta);
    const ended = sim.tickCount;
    expect(session.defense.phase).toBe('won');
    expect(session.defense.phaseEndTick).toBe(ended);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'worldQuestDone', questId: FIRE_AND_FLY_QUEST_ID }),
    );
    expect(meta.fireAndFlyRecruitment?.trialsWon).toBe(1);

    tickTo(sim, ended + TURRET_TIMING.endedSeatTicks - 1);
    expect(seat(meta)).toBe(session);
    sim.tick();
    expect(meta.vehicle).toBeNull();
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
  });
});
