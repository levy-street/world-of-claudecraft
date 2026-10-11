import { describe, expect, it } from 'vitest';
import {
  GLIDER_COURSE,
  GLIDER_LAUNCH_SITE,
  GLIDER_QUEST_ID,
} from '../src/sim/content/world_quest_glider';
import { GLIDER_COURSES } from '../src/sim/content/world_quest_glider_levels';
import { BUILTIN_WORLD } from '../src/sim/data';
import { createPlayer } from '../src/sim/entity';
import { applyGliderBoost } from '../src/sim/minigames/glider_boost';
import { createGliderFlightState, tickGliderFlight } from '../src/sim/minigames/glider_flight';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { emptyMoveInput, normAngle } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import {
  advanceGliderMovement,
  clearGliderEncounter,
  updateGliderEncounter,
} from '../src/sim/world_quest_glider';
import { gliderCourseById } from '../src/sim/world_quest_glider_levels';
import { decodeGliderState } from '../src/sim/world_quest_glider_wire';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('glider practice courses', () => {
  it('selects a course through the public activity command and refuses remote or mid-flight switches', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    sim.resetDay = '2026-09-28';
    sim.chat('/dev glider');
    const start = { ...sim.player.pos };
    sim.player.pos.x += 100;
    sim.startWorldQuestActivity(GLIDER_QUEST_ID, { courseId: GLIDER_COURSES[1].id });
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.phase).not.toBe('countdown');
    sim.player.pos = start;
    sim.startWorldQuestActivity(GLIDER_QUEST_ID, { courseId: 'unknown' });
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.phase).not.toBe('countdown');
    sim.startWorldQuestActivity(GLIDER_QUEST_ID, { courseId: GLIDER_COURSES[1].id });
    const flight = sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider;
    expect(flight).toMatchObject({ phase: 'countdown', courseId: GLIDER_COURSES[1].id });
    sim.startWorldQuestActivity(GLIDER_QUEST_ID, { courseId: GLIDER_COURSES[2].id });
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBe(flight);
  });

  it('keeps a public replay visible and boost-enabled without a second reward', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    sim.resetDay = '2026-09-28';
    sim.chat('/dev glider');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    progress.state = 'completed';
    progress.count = 1;
    const copper = sim.copper;
    sim.startWorldQuestActivity(GLIDER_QUEST_ID, { courseId: GLIDER_COURSES[2].id });
    expect(progress.state).toBe('active');
    expect(progress.glider?.practiceOnly).toBe(true);
    const state = progress.glider!;
    state.phase = 'flying';
    state.speed = 10;
    sim.boostWorldQuestGlider();
    expect(state.speed).toBe(24);
    state.phase = 'won';
    state.passedRings = GLIDER_COURSES[2].rings.map((r) => r.id);
    state.result = {
      passedRings: 11,
      totalRings: 11,
      elapsedSeconds: 30,
      rating: 'silver',
      score: 1000,
    };
    sim.tick();
    expect(progress.state).toBe('completed');
    expect(sim.copper).toBe(copper);
  });

  it('emits one timed record and saves personal times even when the saved points score is better', async () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    sim.resetDay = '2026-09-28';
    sim.chat('/dev glider start');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const state = progress.glider!;
    state.phase = 'won';
    state.passedRings = GLIDER_COURSE.rings.map((ring) => ring.id);
    state.result = {
      rating: 'silver',
      score: 100,
      elapsedSeconds: 60,
      passedRings: state.passedRings.length,
      totalRings: GLIDER_COURSE.rings.length,
    };
    progress.gliderResult = { ...state.result, score: 10000 };
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    sim.drainEvents();
    updateGliderEncounter(ctx, sim.meta(sim.playerId)!, sim.player, progress);
    updateGliderEncounter(ctx, sim.meta(sim.playerId)!, sim.player, progress);
    expect(
      sim
        .drainEvents()
        .filter((ev) => ev.type === 'worldQuestScore' && ev.board.startsWith('glider_')),
    ).toMatchObject([{ board: 'glider_downs_v2_lifetime', metric: 60, resetDay: '2026-09-28' }]);
    const board = await sim.worldQuestLeaderboard('glider_downs_v2_daily');
    expect(board.leaders).toMatchObject([{ metric: 60 }]);
    const saved = sim.serializeCharacter(sim.playerId)!;
    const restored = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = '2026-09-29';
    restored.addPlayer('warrior', 'Returning Pilot', { state: saved });
    expect((await restored.worldQuestLeaderboard('glider_downs_v2_daily')).leaders).toEqual([]);
    expect(
      (await restored.worldQuestLeaderboard('glider_downs_v2_lifetime')).leaders,
    ).toMatchObject([{ metric: 60 }]);
    expect(restored.drainEvents().filter((e) => e.type === 'worldQuestScore')).toEqual([]);
  });
  it('preserves the original default and resolves every authored session identity', () => {
    expect(GLIDER_COURSES[0]).toBe(GLIDER_COURSE);
    expect(gliderCourseById()).toBe(GLIDER_COURSE);
    expect(gliderCourseById('unknown')).toBe(GLIDER_COURSE);
    for (const course of GLIDER_COURSES) {
      expect(gliderCourseById(course.id)).toBe(course);
      expect(
        decodeGliderState({ ...createGliderFlightState(), courseId: course.id }, GLIDER_QUEST_ID)
          ?.courseId,
      ).toBe(course.id);
      expect(course.rings.every((ring) => ring.radius >= 4)).toBe(true);
      expect(course.landingPad).toEqual(GLIDER_COURSE.landingPad);
    }
  });

  it.each(GLIDER_COURSES.slice(1))('$id has terrain-clear rings and a distinct route', (course) => {
    expect(course.rings).not.toEqual(GLIDER_COURSE.rings);
    expect(course.minRings).toBe(course.rings.length);
    for (const ring of course.rings)
      expect(
        ring.y - ring.radius - groundHeight(ring.x, ring.z, WORLD_SEED),
        `ring ${ring.id}`,
      ).toBeGreaterThan(2);
  });

  it.each(GLIDER_COURSES.slice(1))(
    '$id can be flown with bounded steering and pitch, without teleporting',
    (course) => {
      const player = createPlayer(1, 'warrior', { ...GLIDER_LAUNCH_SITE.playerLaunch }, 'Pilot');
      player.facing = GLIDER_LAUNCH_SITE.playerFacing;
      const state = createGliderFlightState(false);
      let targetIndex = 0;
      for (let tick = 0; tick < 2200 && state.phase === 'flying'; tick++) {
        if (state.passedRings.includes(course.rings[targetIndex]?.id)) targetIndex++;
        const target = course.rings[targetIndex] ?? course.landingPad;
        const distance = Math.hypot(target.x - player.pos.x, target.z - player.pos.z);
        const angle = normAngle(
          Math.atan2(target.x - player.pos.x, target.z - player.pos.z) - player.facing,
        );
        const wantedVy = (target.y - player.pos.y) / Math.max(0.4, distance / state.speed);
        const climbRate =
          (7 + Math.max(0, state.speed - 22) * 0.7) *
          Math.max(0.1, Math.min(1, (state.speed - 10) / 8));
        const pitch = Math.max(
          -1,
          Math.min(1, (wantedVy + 0.55) / (wantedVy >= -0.55 ? climbRate : 14)),
        );
        if (state.speed < 22) applyGliderBoost(state);
        tickGliderFlight(
          state,
          player,
          {
            ...emptyMoveInput(),
            turnLeft: angle > 0.06,
            turnRight: angle < -0.06,
            gliderPitch: pitch,
          },
          course,
          WORLD_SEED,
        );
      }
      expect({
        phase: state.phase,
        rings: state.passedRings,
        position: player.pos,
        tick: state.tick,
      }).toMatchObject({ phase: 'won', rings: course.rings.map((ring) => ring.id) });
    },
  );

  it('selects, switches and retries through the real dev chat path', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    sim.resetDay = '2026-09-12';
    sim.chat('/dev wq glider 2');
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toMatchObject({
      phase: 'countdown',
      courseId: GLIDER_COURSES[1].id,
    });
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    const meta = sim.meta(sim.playerId);
    if (!progress?.glider || !meta) throw new Error('Expected armed glider session');
    expect(worldQuestProgressForWire(progress).glider?.courseId).toBe(GLIDER_COURSES[1].id);
    const state = progress.glider;
    state.phase = 'flying';
    state.speed = 22;
    state.passedRings = [GLIDER_COURSES[1].rings[0].id];
    const ring = GLIDER_COURSES[1].rings[1];
    sim.player.pos = { x: ring.x, y: ring.y, z: ring.z - 0.5 };
    sim.player.facing = 0;
    advanceGliderMovement((sim as unknown as { ctx: SimContext }).ctx, sim.player, meta);
    expect(state.passedRings).toContain(ring.id);
    sim.chat('/dev wq glider 3');
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toMatchObject({
      phase: 'countdown',
      courseId: GLIDER_COURSES[2].id,
      passedRings: [],
    });
    sim.chat('/dev glider start');
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.courseId).toBe(GLIDER_COURSES[2].id);
    const before = sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider;
    sim.chat('/dev wq glider 16');
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBe(before);
    sim.chat('/dev wq glider 1');
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.courseId).toBe(GLIDER_COURSE.id);
  });

  it('does not expose practice commands without dev authorization', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: false,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    const pos = { ...sim.player.pos };
    sim.chat('/dev wq glider 2');
    expect(sim.player.pos).toEqual(pos);
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBeUndefined();
  });

  it('reopens an earned daily completion for visible, boost-enabled practice without paying twice', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
    });
    sim.resetDay = '2026-09-12';
    sim.chat('/dev wq glider 1');
    const first = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    if (!first?.glider) throw new Error('Expected first flight');
    const result = {
      passedRings: 20,
      totalRings: 20,
      elapsedSeconds: 60,
      rating: 'silver' as const,
      score: 6000,
    };
    first.glider.phase = 'won';
    first.glider.result = result;
    sim.tick();
    expect(first.state).toBe('completed');
    const copper = sim.copper;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Expected player metadata');
    const claims = [...meta.unlockedMilestones];
    sim.chat('/dev wq glider 2');
    const replay = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    if (!replay?.glider) throw new Error('Expected practice replay');
    expect(replay.state).toBe('active');
    expect(replay.glider.practiceOnly).toBe(true);
    replay.glider.phase = 'failed';
    sim.chat('/dev glider start');
    const retry = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    if (!retry?.glider) throw new Error('Expected practice retry');
    expect(retry.glider.practiceOnly).toBe(true);
    expect(retry.glider.courseId).toBe(GLIDER_COURSES[1].id);
    retry.glider.phase = 'flying';
    retry.glider.speed = 10;
    sim.boostWorldQuestGlider();
    expect(retry.glider.speed).toBe(24);
    retry.glider.phase = 'won';
    retry.glider.result = result;
    sim.tick();
    expect(retry.state).toBe('completed');
    expect(sim.copper).toBe(copper);
    expect([...meta.unlockedMilestones]).toEqual(claims);
    const revision = meta.wireRev;
    updateGliderEncounter((sim as unknown as { ctx: SimContext }).ctx, meta, sim.player, retry);
    expect(meta.wireRev).toBe(revision);
    sim.chat('/dev wq glider 3');
    const cancelled = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    if (!cancelled?.glider) throw new Error('Expected another practice flight');
    expect(cancelled.state).toBe('active');
    clearGliderEncounter(meta, cancelled);
    expect(cancelled.glider).toBeUndefined();
    expect(cancelled.state).toBe('completed');
    expect(cancelled.count).toBe(1);
    expect(sim.copper).toBe(copper);
  });
});
