// A won Fire and Fly run's score (src/sim/fire_and_fly_score.ts, called from
// completeWorldQuestTurret): once per run for a seat the instructor seated for today,
// paid or practice, never for a dev seat or a loss; the offline records it keeps and
// the save they ride in.
import { describe, expect, it } from 'vitest';
import {
  TURRET_SCENARIO_INTRODUCTION,
  TURRET_SCENARIO_STANDARD,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_TOWER_POINTS } from '../src/sim/content/turret_defense';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../src/sim/content/world_quest_fire_and_fly';
import { positionAt } from '../src/sim/minigames/thrown_body';
import { turretResult } from '../src/sim/minigames/turret_result';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent, TurretSession } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { restoreWorldQuestState, savedWorldQuestState } from '../src/sim/world_quest_state';
import { WORLD_SEED } from '../src/sim/world_seed';
import type { IWorldVehicles } from '../src/world_api/vehicles';

const DAY = '2026-09-06';
const RUN_BOUND = 20 * 60 * 8;
const RUN_TIMEOUT_MS = 120_000;
const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };

function atTheGate(): { sim: Sim; meta: PlayerMeta } {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = DAY;
  sim.setPlayerLevel(WORLD_QUEST_FIRE_AND_FLY.minLevel);
  sim.player.pos = sim.groundPos(FIRE_AND_FLY_NPC_DEF.pos.x - 2, FIRE_AND_FLY_NPC_DEF.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  sim.drainEvents();
  const meta = sim.meta(sim.playerId)!;
  // A recruited gunner: every trial is open (the locks are fire_and_fly_recruitment.test.ts's).
  meta.fireAndFlyRecruitment = { trialsWon: 3, recruited: true };
  return { sim, meta };
}

function seat(meta: PlayerMeta): TurretSession {
  if (meta.vehicle?.kind !== 'turret') throw new Error('expected a turret seat');
  return meta.vehicle;
}

function scores(events: readonly SimEvent[]) {
  return events.filter((e) => e.type === 'worldQuestScore');
}

/** Ends the seated run as won with the given tower points kept, as any winning path would. */
function forceWin(meta: PlayerMeta, integrity: number, kills = 20): void {
  const defense = seat(meta).defense;
  defense.integrity = integrity;
  defense.phase = 'won';
  defense.result = turretResult(defense.plan, {
    phase: 'won',
    integrity,
    stats: { kills, barrelKills: 0, bowled: 0, shockwaves: 0, frags: 0, resupplies: 0 },
  });
}

/** Ticks the seat to its end, firing at the monster nearest the tower; returns every event. */
function playOut(sim: Sim): SimEvent[] {
  const world: IWorldVehicles = sim;
  const events: SimEvent[] = [];
  const phase = () => world.turretSession?.defense.phase ?? 'gone';
  for (let i = 0; i < RUN_BOUND && phase() !== 'won' && phase() !== 'lost'; i++) {
    events.push(...sim.tick());
    const view = world.turretSession;
    if (!view || sim.tickCount < view.defense.readyTick) continue;
    let best: { x: number; z: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const m of view.defense.monsters) {
      if (m.hp <= 0) continue;
      const p = positionAt(m.seg, sim.tickCount, ground);
      const d = Math.hypot(p.x - view.defense.cx, p.z - view.defense.cz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) world.useVehicleAction('turret_fire', best);
  }
  for (let i = 0; i < 3; i++) events.push(...sim.tick());
  return events;
}

describe('the score of a won run', () => {
  it(
    'emits one lifetime event for a credited win, with the medal, the points and the day',
    () => {
      const { sim, meta } = atTheGate();
      sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, {
        courseId: TURRET_SCENARIO_INTRODUCTION.id,
      });
      const events = playOut(sim);
      const result = seat(meta).defense.result;
      expect(result?.won).toBe(true);
      expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
      expect(scores(events)).toEqual([
        {
          type: 'worldQuestScore',
          pid: meta.entityId,
          board: 'fire_and_fly_introduction_v2_lifetime',
          medal: result!.medal,
          metric: result!.points,
          resetDay: DAY,
        },
      ]);
      expect(meta.fireAndFlyRecords).toEqual({
        fire_and_fly_introduction_v2_daily: {
          metric: result!.points,
          medal: result!.medal,
          day: DAY,
        },
        fire_and_fly_introduction_v2_lifetime: {
          metric: result!.points,
          medal: result!.medal,
          day: DAY,
        },
      });
    },
    RUN_TIMEOUT_MS,
  );

  it('scores a practice win after the day reward, as the glider practice feeds its ladders', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceWin(meta, 69);
    const paid = sim.tick();
    expect(scores(paid)).toHaveLength(1);
    expect(meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID)?.state).toBe('completed');
    sim.leaveVehicle();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    expect(seat(meta).worldQuest?.practice).toBe(true);
    forceWin(meta, 50);
    const practice = sim.tick();
    expect(scores(practice)).toEqual([
      expect.objectContaining({
        board: 'fire_and_fly_standard_v2_lifetime',
        medal: 'silver',
        metric: 50 * 200 + 20 * 20,
      }),
    ]);
    // The day's best stays the gold run.
    expect(meta.fireAndFlyRecords.fire_and_fly_standard_v2_daily?.medal).toBe('gold');
  });

  it('emits once per run however many won ticks follow', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceWin(meta, TURRET_TOWER_POINTS);
    const events = [...sim.tick(), ...sim.tick(), ...sim.tick(), ...sim.tick()];
    expect(scores(events)).toHaveLength(1);
    expect(seat(meta).worldQuest?.scored).toBe(true);
  });

  it('never scores a dev seat', () => {
    const { sim, meta } = atTheGate();
    sim.chat('/dev turret');
    forceWin(meta, TURRET_TOWER_POINTS);
    expect(scores([...sim.tick(), ...sim.tick()])).toEqual([]);
    expect(meta.fireAndFlyRecords).toEqual({});
  });

  it('never scores a lost run', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    const defense = seat(meta).defense;
    defense.phase = 'lost';
    defense.integrity = 0;
    defense.result = turretResult(defense.plan, {
      phase: 'lost',
      integrity: 0,
      stats: { kills: 5, barrelKills: 0, bowled: 0, shockwaves: 0, frags: 0, resupplies: 0 },
    });
    expect(scores([...sim.tick(), ...sim.tick()])).toEqual([]);
    expect(meta.fireAndFlyRecords).toEqual({});
  });

  it('never scores a win on the tick the day rolls over', () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceWin(meta, TURRET_TOWER_POINTS);
    sim.resetDay = '2026-09-07';
    expect(scores([...sim.tick(), ...sim.tick()])).toEqual([]);
    expect(meta.fireAndFlyRecords).toEqual({});
  });

  it('keeps the records in the world quest save and restores them', () => {
    const { sim, meta } = atTheGate();
    sim.startWorldQuestActivity(FIRE_AND_FLY_QUEST_ID, { courseId: TURRET_SCENARIO_STANDARD.id });
    forceWin(meta, 69);
    sim.tick();
    const saved = savedWorldQuestState(meta).worldQuests;
    expect(saved?.fireAndFlyRecords).toEqual(meta.fireAndFlyRecords);
    const restored = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const target = restored.meta(restored.playerId)!;
    restoreWorldQuestState(target, JSON.parse(JSON.stringify(saved)));
    expect(target.fireAndFlyRecords).toEqual(meta.fireAndFlyRecords);
  });

  it('serves the offline personal page through IWorld', async () => {
    const { sim, meta } = atTheGate();
    sim.talkToNpc(FIRE_AND_FLY_NPC_ID);
    forceWin(meta, 69);
    sim.tick();
    const page = await sim.worldQuestLeaderboard('fire_and_fly_standard_v2_daily');
    expect(page).toMatchObject({ board: 'fire_and_fly_standard_v2_daily', personal: true });
    expect(page.self).toMatchObject({ rank: 1, medal: 'gold', metric: 69 * 200 + 20 * 20 });
  });
});
