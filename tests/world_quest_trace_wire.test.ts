import { describe, expect, it } from 'vitest';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import { applyQuestSelfWire } from '../src/net/quest_snapshot_wire';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { WorldQuestProgress, WorldQuestTraceState } from '../src/sim/types';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import {
  freshWorldQuestPlayerState,
  restoreWorldQuestState,
  savedWorldQuestState,
} from '../src/sim/world_quest_state';
import {
  WORLD_QUEST_TRACE_VARIANTS,
  worldQuestTraceShape,
} from '../src/sim/world_quest_trace_variants';
import {
  decodeWorldQuestTrace,
  WORLD_QUEST_TRACE_WIRE_POINT_LIMIT,
} from '../src/sim/world_quest_trace_wire';
import { bareClient } from './helpers/bare_client';

function quest() {
  const def = WORLD_QUESTS.find((entry) => entry.objective.type === 'tracing');
  if (!def) throw new Error('The tracing quest must be authored');
  return def;
}

function trace(): WorldQuestTraceState {
  return {
    questId: quest().id,
    shapeIndex: 0,
    phase: 'drawing',
    previewUntil: 7,
    expiresAt: 97,
    trail: [
      { x: 1, z: 2 },
      { x: 2, z: 3 },
    ],
    lastPosition: { x: 2, z: 3 },
    segment: 1,
    direction: 1,
    started: true,
  };
}

function meta(tracing?: WorldQuestTraceState, traceVariant?: string): PlayerMeta {
  const progress: WorldQuestProgress = {
    questId: quest().id,
    count: tracing?.shapeIndex ?? 0,
    state: 'active',
  };
  if (traceVariant) progress.traceVariant = traceVariant;
  if (tracing) progress.tracing = tracing;
  return {
    ...freshWorldQuestPlayerState(),
    entityId: 1,
    questLog: new Map(),
    questsDone: new Set(),
    unlockedMilestones: new Set(),
    worldQuestCycle: worldQuestCycleOfferingQuest('wq3_0', quest().id),
    worldQuestLog: new Map([[quest().id, progress]]),
  } as PlayerMeta;
}

function selfWire(owner: PlayerMeta): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  emitQuestSelfKeys(
    (key, value) => {
      self[key] = value;
    },
    {
      worldQuestExpiresAtMs: 1_900_000_000_000,
    } as Sim,
    owner,
  );
  return self;
}

describe('session-only world quest trace wire', () => {
  it('round-trips the authoritative owner trace through the real ClientWorld snapshot path', () => {
    const state = trace();
    const owner = meta(state);
    const self = selfWire(owner);
    const client = bareClient(1);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
      t: 'snap',
      time: 8,
      ents: [],
      self: { id: 1, k: 'player', tid: 'warrior', nm: 'Scribe', x: 1, y: 1, z: 2, ...self },
    });
    expect(client.worldQuestLog.get(quest().id)?.tracing).toEqual(state);
    state.trail[0].x = 999;
    expect(client.worldQuestLog.get(quest().id)?.tracing?.trail[0].x).toBe(1);
    const emitted = (self.wqlog as WorldQuestProgress[])[0].tracing!;
    emitted.lastPosition.x = 888;
    expect(client.worldQuestLog.get(quest().id)?.tracing?.lastPosition.x).toBe(2);
    expect((selfWire(meta()).wqlog as WorldQuestProgress[])[0]).not.toHaveProperty('tracing');
  });

  it('retains an omitted delta but clears removed, malformed, and rollover trace fields', () => {
    const client = bareClient(1);
    const owner = meta(trace());
    applyQuestSelfWire(client, selfWire(owner));
    const previous = client.worldQuestLog;
    applyQuestSelfWire(client, {});
    expect(client.worldQuestLog).toBe(previous);
    applyQuestSelfWire(client, {
      wqlog: [{ questId: quest().id, count: 0, state: 'active', tracing: {} }],
    });
    expect(client.worldQuestLog.get(quest().id)).not.toHaveProperty('tracing');
    applyQuestSelfWire(client, selfWire(owner));
    applyQuestSelfWire(client, selfWire(meta()));
    expect(client.worldQuestLog.get(quest().id)).not.toHaveProperty('tracing');
    applyQuestSelfWire(client, selfWire(owner));
    applyQuestSelfWire(client, { wqday: 'wq3_0', wqlog: [] });
    expect(client.worldQuestLog.size).toBe(0);
  });

  it.each([
    ['quest identity', { questId: 'different' }],
    ['missing shape index', { shapeIndex: undefined }],
    ['negative shape index', { shapeIndex: -1 }],
    ['fractional shape index', { shapeIndex: 0.5 }],
    ['string shape index', { shapeIndex: '1' }],
    ['nonfinite shape index', { shapeIndex: Number.NaN }],
    ['past final shape', { shapeIndex: 3 }],
    ['phase', { phase: 'other' }],
    ['negative time', { previewUntil: -1 }],
    ['nonfinite preview', { previewUntil: Number.NaN }],
    ['nonfinite expiry', { expiresAt: Number.POSITIVE_INFINITY }],
    ['reversed times', { expiresAt: 1 }],
    ['trail point', { trail: [{ x: 1, z: Number.NaN }] }],
    ['sparse trail', { trail: new Array(3) }],
    ['trail bound', { trail: Array.from({ length: 257 }, () => ({ x: 0, z: 0 })) }],
    ['last point', { lastPosition: { x: '1', z: 2 } }],
    ['fractional segment', { segment: 0.5 }],
    ['negative segment', { segment: -1 }],
    ['past final segment', { segment: 999 }],
    ['direction', { direction: 2 }],
    ['started', { started: 1 }],
    ['reason', { reason: 'unknown' }],
  ])('drops a malformed %s without retaining a partial readout', (_label, patch) => {
    expect(decodeWorldQuestTrace({ ...trace(), ...patch }, quest().id)).toBeUndefined();
  });

  it('accepts the exact point cap and terminal phases, but not traces on other objective kinds', () => {
    expect(WORLD_QUEST_TRACE_WIRE_POINT_LIMIT).toBe(256);
    const full = { ...trace(), trail: Array.from({ length: 256 }, () => ({ x: 0, z: 0 })) };
    expect(decodeWorldQuestTrace(full, quest().id)?.trail).toHaveLength(256);
    for (const phase of ['preview', 'drawing', 'failed', 'success']) {
      expect(decodeWorldQuestTrace({ ...trace(), phase }, quest().id)?.phase).toBe(phase);
    }
    expect(
      decodeWorldQuestTrace(
        { ...trace(), questId: 'wq_eastbrook_bandits' },
        'wq_eastbrook_bandits',
      ),
    ).toBeUndefined();
    expect(decodeWorldQuestTrace(trace(), 'constructor')).toBeUndefined();
  });

  it('round-trips every shape index and validates segments against that specific outline', () => {
    const objective = quest().objective;
    if (objective.type !== 'tracing') throw new Error('Expected tracing objective');
    expect(objective.shapes).toHaveLength(3);
    for (const [shapeIndex, shape] of objective.shapes.entries()) {
      const state = { ...trace(), shapeIndex, segment: shape.points.length - 1 };
      const client = bareClient(1);
      applyQuestSelfWire(client, selfWire(meta(state)));
      expect(client.worldQuestLog.get(quest().id)?.tracing).toEqual(state);
      expect(
        decodeWorldQuestTrace({ ...state, segment: shape.points.length }, quest().id),
      ).toBeUndefined();
      applyQuestSelfWire(client, {
        wqlog: [
          { questId: quest().id, count: 0, state: 'active', tracing: { ...state, shapeIndex: 3 } },
        ],
      });
      expect(client.worldQuestLog.get(quest().id)).not.toHaveProperty('tracing');
    }
  });

  it('round-trips every advanced final shape and validates its own segment bound', () => {
    for (const traceVariant of WORLD_QUEST_TRACE_VARIANTS) {
      const shape = worldQuestTraceShape(quest(), 2, traceVariant);
      if (!shape) throw new Error(`Expected authored ${traceVariant} outline`);
      const state = { ...trace(), shapeIndex: 2, segment: shape.points.length - 1 };
      const client = bareClient(1);

      applyQuestSelfWire(client, selfWire(meta(state, traceVariant)));

      expect(client.worldQuestLog.get(quest().id)).toMatchObject({ traceVariant, tracing: state });
      applyQuestSelfWire(client, {
        wqlog: [
          {
            questId: quest().id,
            count: 2,
            state: 'active',
            traceVariant,
            tracing: { ...state, segment: shape.points.length },
          },
        ],
      });
      expect(client.worldQuestLog.get(quest().id)).not.toHaveProperty('tracing');
    }
  });

  it('does not persist or restore partial traces and preserves ordinary progress fields', () => {
    const owner = meta(trace());
    const progress = owner.worldQuestLog.get(quest().id)!;
    progress.creditedObjects = ['a'];
    progress.puzzleRotations = [1, 2];
    progress.match3Board = [0, 1];
    progress.match3Moves = 2;
    progress.match3RefillIndex = 3;
    progress.puzzleVariant = 1;
    const saved = savedWorldQuestState(owner);
    if (!('worldQuests' in saved) || !saved.worldQuests)
      throw new Error('Expected world quest save');
    const { tracing: _tracing, ...ordinary } = progress;
    expect(saved.worldQuests.progress[0]).toEqual(ordinary);
    expect(saved.worldQuests.progress[0]).not.toHaveProperty('tracing');
    progress.puzzleRotations[0] = 99;
    expect(saved.worldQuests.progress[0].puzzleRotations).toEqual([1, 2]);
    const restored = meta();
    restored.worldQuestLog.clear();
    restoreWorldQuestState(restored, { cycle: owner.worldQuestCycle, progress: [progress] });
    expect(restored.worldQuestLog.get(quest().id)).toEqual({
      questId: quest().id,
      count: 0,
      state: 'active',
      traceVariant: 'star',
    });
    expect(owner.worldQuestLog.get(quest().id)?.tracing).toBeDefined();
  });

  it.each([
    [0, 'active', 1, 'preview'],
    [1, 'active', 0, 'drawing'],
    [2, 'active', 1, 'failed'],
    [2, 'active', 2, 'success'],
    [3, 'completed', 1, 'success'],
    [3, 'completed', 2, 'drawing'],
    [3, 'completed', 2, 'failed'],
    [Number.NaN, 'active', 1, 'drawing'],
  ] as const)(
    'clears a trace inconsistent with sanitized progress (%s/%s/%s/%s)',
    (count, state, shapeIndex, phase) => {
      const client = bareClient(1);
      applyQuestSelfWire(client, selfWire(meta(trace())));
      applyQuestSelfWire(client, {
        wqlog: [{ questId: quest().id, count, state, tracing: { ...trace(), shapeIndex, phase } }],
      });
      expect(client.worldQuestLog.get(quest().id)).toBeDefined();
      expect(client.worldQuestLog.get(quest().id)).not.toHaveProperty('tracing');
      const owner = meta();
      owner.worldQuestLog.set(quest().id, {
        questId: quest().id,
        count,
        state,
        tracing: { ...trace(), shapeIndex, phase },
      });
      expect((selfWire(owner).wqlog as WorldQuestProgress[])[0]).not.toHaveProperty('tracing');
    },
  );

  it.each([
    [1, 'active', 1, 'preview'],
    [1, 'active', 1, 'drawing'],
    [2, 'active', 2, 'preview'],
    [2, 'active', 2, 'failed'],
    [3, 'completed', 2, 'success'],
  ] as const)(
    'keeps the coherent post-tick snapshot (%s/%s/%s/%s)',
    (count, state, shapeIndex, phase) => {
      const client = bareClient(1);
      const tracing = { ...trace(), shapeIndex, phase };
      applyQuestSelfWire(client, {
        wqday: meta().worldQuestCycle,
        wqlog: [{ questId: quest().id, count, state, tracing }],
      });
      expect(client.worldQuestLog.get(quest().id)?.tracing).toEqual(tracing);
    },
  );
});
