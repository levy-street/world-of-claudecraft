import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  WORLD_QUEST_CALLIGRAPHY_ID as ID,
  WORLD_QUEST_CALLIGRAPHY_QUEST as QUEST,
  WORLD_QUEST_CALLIGRAPHY_ADVANCED,
  WORLD_QUEST_CALLIGRAPHY_NPC_IDS,
  WORLD_QUEST_CALLIGRAPHY_NPCS,
} from '../src/sim/content/world_quest_calligraphy';
import { BUILTIN_WORLD, CAMPS, GROUND_OBJECTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { INTERACT_RANGE } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';
import { worldQuestTraceShape } from '../src/sim/world_quest_trace_variants';
import { WORLD_SEED } from '../src/sim/world_seed';

const NPC_ID = WORLD_QUEST_CALLIGRAPHY_NPC_IDS.calligraphy_instructor;
const SHAPES = QUEST.objective.type === 'tracing' ? QUEST.objective.shapes : [];
const POINTS = SHAPES[0].points;
const WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: WORLD_QUEST_CALLIGRAPHY_NPCS,
  groundObjects: [],
};

function setup(devCommands = true) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands, world: WORLD });
  sim.resetDay = '2026-09-04';
  sim.chat('/dev calligraphy');
  sim.player.pos = sim.groundPos(172, -35);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  return sim;
}

function talk(sim: Sim) {
  sim.targetEntity(NPC_ID);
  sim.interact();
}

function walk(sim: Sim, point: { x: number; z: number }) {
  const meta = sim.meta(sim.playerId)!;
  for (let tick = 0; tick < 200; tick++) {
    if (Math.hypot(sim.player.pos.x - point.x, sim.player.pos.z - point.z) < 0.3) break;
    sim.player.facing = Math.atan2(point.x - sim.player.pos.x, point.z - sim.player.pos.z);
    meta.moveInput.forward = true;
    sim.tick();
  }
  meta.moveInput.forward = false;
  expect(Math.hypot(sim.player.pos.x - point.x, sim.player.pos.z - point.z)).toBeLessThan(0.3);
}

function beginDrawing(sim: Sim) {
  talk(sim);
  prepareRound(sim, 0);
}

function prepareRound(sim: Sim, shapeIndex: number) {
  expect(sim.worldQuestLog.get(ID)?.tracing?.phase).toBe('preview');
  expect(sim.worldQuestLog.get(ID)?.tracing?.shapeIndex).toBe(shapeIndex);
  walk(
    sim,
    worldQuestTraceShape(QUEST, shapeIndex, sim.worldQuestLog.get(ID)?.traceVariant)!.points[0],
  );
  for (let i = 0; i < 125; i++) sim.tick();
  expect(sim.worldQuestLog.get(ID)?.tracing?.phase).toBe('drawing');
  expect(sim.worldQuestLog.get(ID)?.tracing?.started).toBe(true);
}

function finishLesson(sim: Sim, reverse = false) {
  const xp = sim.meta(sim.playerId)!.xp;
  for (const shapeIndex of SHAPES.keys()) {
    const shape = worldQuestTraceShape(QUEST, shapeIndex, sim.worldQuestLog.get(ID)?.traceVariant)!;
    if (shapeIndex > 0) prepareRound(sim, shapeIndex);
    const points = reverse ? [...shape.points].reverse() : shape.points;
    for (const point of points.slice(1)) walk(sim, point);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(shapeIndex + 1);
    if (shapeIndex < SHAPES.length - 1) {
      expect(sim.worldQuestLog.get(ID)?.state).toBe('active');
      expect(sim.worldQuestLog.get(ID)?.tracing).toMatchObject({
        phase: 'preview',
        shapeIndex: shapeIndex + 1,
        trail: [],
        segment: 0,
      });
      expect(sim.meta(sim.playerId)!.xp).toBe(xp);
      expect(sim.meta(sim.playerId)!.counters.questsCompleted).toBe(0);
    }
  }
}

describe('authoritative calligraphy world quest', () => {
  it.each(WORLD_QUEST_CALLIGRAPHY_ADVANCED)(
    'walks the selected $kind variant both ways with final-only rewards',
    (advanced) => {
      for (const reverse of [false, true]) {
        const sim = setup();
        sim.worldQuestLog.get(ID)!.traceVariant = advanced.kind;
        beginDrawing(sim);
        finishLesson(sim, reverse);
        expect(sim.worldQuestLog.get(ID)).toMatchObject({
          count: 3,
          state: 'completed',
          traceVariant: advanced.kind,
        });
        expect(sim.worldQuestLog.get(ID)?.traceScores).toHaveLength(3);
        expect(sim.worldQuestLog.get(ID)?.traceResult?.score).toBeGreaterThan(0);
      }
    },
  );

  it('a Bronze legacy-score completion receives normal XP and deed without the optional Gold title', () => {
    const sim = setup();
    const meta = sim.meta(sim.playerId)!;
    const xp = meta.xp;
    beginDrawing(sim);
    for (const point of SHAPES[0].points.slice(1)) walk(sim, point);
    prepareRound(sim, 1);
    for (const point of SHAPES[1].points.slice(1)) walk(sim, point);
    delete sim.worldQuestLog.get(ID)!.traceScores;
    prepareRound(sim, 2);
    for (const point of worldQuestTraceShape(
      QUEST,
      2,
      sim.worldQuestLog.get(ID)?.traceVariant,
    )!.points.slice(1))
      walk(sim, point);
    expect(sim.worldQuestLog.get(ID)?.traceResult?.rating).toBe('bronze');
    expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
    expect(meta.xp).toBeGreaterThan(xp);
    expect(meta.deedsEarned.has('exp_arcane_calligraphy')).toBe(true);
    expect(meta.deedsEarned.has('exp_arcane_calligraphy_gold')).toBe(false);
  });

  it('directs dev testers to a visible interaction-range approach instead of inside Elian', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: WORLD,
    });
    sim.chat('/dev calligraphy');
    const armed = sim
      .drainEvents()
      .find((event) => event.type === 'log' && event.text.includes('[dev] Calligraphy armed.'));
    expect(armed?.type).toBe('log');
    if (armed?.type !== 'log') throw new Error('missing calligraphy dev guidance');
    const match = /\/dev tp (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/.exec(armed.text);
    expect(match).not.toBeNull();
    if (!match) throw new Error('missing calligraphy approach coordinates');
    const distance = Math.hypot(
      Number(match[1]) - WORLD_QUEST_CALLIGRAPHY_NPCS.calligraphy_instructor.pos.x,
      Number(match[2]) - WORLD_QUEST_CALLIGRAPHY_NPCS.calligraphy_instructor.pos.z,
    );
    expect(distance).toBeGreaterThan(2);
    expect(distance).toBeLessThanOrEqual(INTERACT_RANGE);
  });

  it('preserves the ordinary NPC-talk reset of the chronicler streak', () => {
    const sim = setup();
    sim.deedRuntime.saulTalks.set(sim.playerId, 3);
    talk(sim);
    expect(sim.worldQuestLog.get(ID)?.tracing?.phase).toBe('preview');
    expect(sim.deedRuntime.saulTalks.has(sim.playerId)).toBe(false);
  });

  it('replays actual walking with identical trace, reward and RNG stream for the same seed', () => {
    const replay = () => {
      const sim = setup();
      const meta = sim.meta(sim.playerId)!;
      const xpBefore = meta.xp;
      const draws: number[] = [];
      sim.rng.setObserver((value) => draws.push(value));
      beginDrawing(sim);
      finishLesson(sim);
      sim.rng.setObserver(null);
      expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
      expect(meta.xp).toBeGreaterThan(xpBefore);
      expect(meta.counters.questsCompleted).toBe(1);
      return {
        time: sim.time,
        position: { ...sim.player.pos },
        progress: structuredClone(sim.worldQuestLog.get(ID)),
        xpGained: meta.xp - xpBefore,
        completed: meta.counters.questsCompleted,
        draws,
        rngTail: Array.from({ length: 4 }, () => sim.rng.next()),
      };
    };
    const first = replay();
    const second = replay();
    expect(first.progress?.tracing?.trail.length).toBeGreaterThan(30);
    expect(first.rngTail).toHaveLength(4);
    expect(second).toEqual(first);
  });

  it.each([false, true])(
    'walks the real terrain in either direction (reverse=%s), pays once',
    (reverse) => {
      const sim = setup();
      const meta = sim.meta(sim.playerId)!;
      const xp = meta.xp;
      const nextId = (sim as unknown as { nextId: number }).nextId;
      beginDrawing(sim);
      finishLesson(sim, reverse);
      expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
      expect(sim.worldQuestLog.get(ID)?.tracing?.phase).toBe('success');
      expect(meta.xp).toBeGreaterThan(xp);
      expect(meta.counters.questsCompleted).toBe(1);
      expect((sim as unknown as { nextId: number }).nextId).toBe(nextId);
      const paid = meta.xp;
      sim.talkToNpc(NPC_ID);
      for (let i = 0; i < 110; i++) sim.tick();
      expect(meta.xp).toBe(paid);
      expect(meta.counters.questsCompleted).toBe(1);
      expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
    },
  );

  it('fails a real walked shortcut, keeps its trail, then starts a clean retry', () => {
    const sim = setup();
    beginDrawing(sim);
    walk(sim, { x: 172, z: -28 });
    expect(sim.worldQuestLog.get(ID)?.tracing?.reason).toBe('off-path');
    expect(sim.worldQuestLog.get(ID)?.tracing?.trail.length).toBeGreaterThan(1);
    expect(sim.meta(sim.playerId)?.counters.questsCompleted).toBe(0);
    walk(sim, { x: 172, z: -35 });
    talk(sim);
    expect(sim.worldQuestLog.get(ID)?.tracing).toMatchObject({
      phase: 'preview',
      trail: [],
      segment: 0,
    });
  });

  it('retries only the failed square, retaining the triangle even after failure readout expires', () => {
    const sim = setup();
    beginDrawing(sim);
    for (const point of POINTS.slice(1)) walk(sim, point);
    prepareRound(sim, 1);
    walk(sim, { x: 171, z: -26 });
    expect(sim.worldQuestLog.get(ID)?.tracing).toMatchObject({ phase: 'failed', shapeIndex: 1 });
    expect(sim.worldQuestLog.get(ID)?.count).toBe(1);
    sim.time = sim.worldQuestLog.get(ID)!.tracing!.expiresAt;
    sim.tick();
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
    expect(sim.worldQuestLog.get(ID)?.count).toBe(1);
    walk(sim, { x: 172, z: -35 });
    talk(sim);
    expect(sim.worldQuestLog.get(ID)?.tracing).toMatchObject({
      phase: 'preview',
      shapeIndex: 1,
      trail: [],
      segment: 0,
      direction: 0,
    });
    prepareRound(sim, 1);
    for (const point of SHAPES[1].points.slice(1)) walk(sim, point);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(2);
    expect(sim.worldQuestLog.get(ID)?.state).toBe('active');
    prepareRound(sim, 2);
    for (const point of worldQuestTraceShape(
      QUEST,
      2,
      sim.worldQuestLog.get(ID)?.traceVariant,
    )!.points.slice(1))
      walk(sim, point);
    expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
  });

  it('rejects a trace whose round does not match earned authoritative progress', () => {
    const sim = setup();
    beginDrawing(sim);
    sim.worldQuestLog.get(ID)!.tracing!.shapeIndex = 2;
    sim.tick();
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
    expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
    expect(sim.meta(sim.playerId)!.counters.questsCompleted).toBe(0);
  });

  it.each(['teleport', 'mount', 'combat', 'death', 'leave', 'rollover'] as const)(
    'cannot finish after %s',
    (mode) => {
      const sim = setup();
      beginDrawing(sim);
      const meta = sim.meta(sim.playerId)!;
      if (mode === 'teleport') sim.player.pos = sim.groundPos(178, -31);
      if (mode === 'mount') sim.player.mountKey = 'valorsteed';
      if (mode === 'combat') sim.player.inCombat = true;
      if (mode === 'death') sim.player.dead = true;
      if (mode === 'leave') sim.player.pos = sim.groundPos(140, -35);
      if (mode === 'rollover') meta.devWorldQuestCycle = 'wq3_0';
      sim.tick();
      expect(sim.worldQuestLog.get(ID)?.tracing?.phase).not.toBe('drawing');
      expect(sim.worldQuestLog.get(ID)?.state).not.toBe('completed');
      expect(meta.counters.questsCompleted).toBe(0);
    },
  );

  it('gates dev activation and rejects direct remote/dead/forged instructor talks', () => {
    const disabled = setup(false);
    expect(disabled.worldQuestLog.has(ID)).toBe(false);
    expect(disabled.entities.has(NPC_ID)).toBe(false);
    const sim = setup();
    const npc = sim.entities.get(NPC_ID)!;
    sim.player.pos = sim.groundPos(0, 0);
    sim.talkToNpc(NPC_ID);
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
    sim.player.pos = sim.groundPos(172, -35);
    sim.player.dead = true;
    sim.talkToNpc(NPC_ID);
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
    sim.player.dead = false;
    npc.pos.x += 1;
    sim.talkToNpc(NPC_ID);
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
  });

  it('separates two players, does not restart on double-click, and times out without progress', () => {
    const sim = setup();
    const second = sim.addPlayer('warrior', 'Second');
    sim.chat('/dev calligraphy', second);
    const other = sim.entities.get(second)!;
    other.pos = sim.groundPos(172, -35);
    sim.talkToNpc(NPC_ID, second);
    talk(sim);
    const firstTrace = sim.worldQuestLog.get(ID)!.tracing!;
    const secondTrace = sim.meta(second)!.worldQuestLog.get(ID)!.tracing!;
    expect(firstTrace).not.toBe(secondTrace);
    const deadline = firstTrace.previewUntil;
    sim.tick();
    talk(sim);
    expect(firstTrace.previewUntil).toBe(deadline);
    sim.time = firstTrace.expiresAt;
    sim.tick();
    expect(firstTrace.reason).toBe('timeout');
    expect(firstTrace.trail).toHaveLength(1); // Failure endpoint, not earned outline progress.
    expect(firstTrace.segment).toBe(0);
    expect(sim.meta(sim.playerId)?.counters.questsCompleted).toBe(0);
    sim.time = firstTrace.expiresAt;
    sim.tick();
    expect(sim.worldQuestLog.get(ID)?.tracing).toBeUndefined();
  });
});

describe('calligraphy content placement and rotation', () => {
  it('offers calligraphy in its zone rotation cycle', () => {
    expect(activeWorldQuestsForCycle('wq1_2').some((q) => q.id === ID)).toBe(true);
    expect(activeWorldQuestsForCycle('wq3_6').some((q) => q.id === ID)).toBe(true);
    expect(activeWorldQuestsForCycle('wq1_1').some((q) => q.id === 'wq_willowfen_caravan')).toBe(
      true,
    );
    expect(activeWorldQuestsForCycle('wq1_2')).toHaveLength(16);
    expect(POINTS).toHaveLength(4);
    expect(POINTS[0]).toEqual(POINTS[3]);
    expect(SHAPES.map((shape) => shape.kind)).toEqual(['triangle', 'square', 'star']);
    expect(SHAPES.map((shape) => shape.points.length)).toEqual([4, 5, 6]);
    expect(QUEST.count).toBe(3);
  });

  it('fits the whole line and walking tolerance on dry clear gentle ground', () => {
    expect(POINTS).toHaveLength(4);
    for (const shape of [...SHAPES.slice(0, 2), ...WORLD_QUEST_CALLIGRAPHY_ADVANCED]) {
      for (let edge = 1; edge < shape.points.length; edge++) {
        const a = shape.points[edge - 1];
        const b = shape.points[edge];
        for (let step = 0; step <= 48; step++) {
          const x = a.x + ((b.x - a.x) * step) / 48;
          const z = a.z + ((b.z - a.z) * step) / 48;
          expect(x + 1.5).toBeLessThanOrEqual(180);
          expect(isBlocked(WORLD_SEED, x, z, 1.5)).toBe(false);
          expect(terrainHeight(x, z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
          const dx = terrainHeight(x + 0.1, z, WORLD_SEED) - terrainHeight(x - 0.1, z, WORLD_SEED);
          const dz = terrainHeight(x, z + 0.1, WORLD_SEED) - terrainHeight(x, z - 0.1, WORLD_SEED);
          expect(Math.hypot(dx, dz) / 0.2, `${shape.kind} slope at ${x},${z}`).toBeLessThan(0.3);
          expect(
            Math.min(...CAMPS.map((c) => Math.hypot(x - c.center.x, z - c.center.z) - c.radius)),
          ).toBeGreaterThan(30);
        }
      }
    }
    const objectIds = new Set(GROUND_OBJECTS.flatMap((o) => o.entityIds ?? []));
    for (const [id, def] of Object.entries(WORLD_QUEST_CALLIGRAPHY_NPCS)) {
      expect(def.dynamic).toBe(true);
      expect(objectIds.has(WORLD_QUEST_CALLIGRAPHY_NPC_IDS[id])).toBe(false);
      expect(isBlocked(WORLD_SEED, def.pos.x, def.pos.z, 1.5)).toBe(false);
    }
  });
});
