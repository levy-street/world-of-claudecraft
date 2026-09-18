import { describe, expect, it } from 'vitest';
import { nearbyQuestTraceWireJson } from '../server/quest_snapshot_wire';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { decodeNearbyWorldQuestTraces } from '../src/net/world_quest_trace_public_wire';
import { WORLD_QUEST_CALLIGRAPHY_ID as ID } from '../src/sim/content/world_quest_calligraphy';
import { BUILTIN_WORLD } from '../src/sim/data';
import { createPlayer } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { SpatialGrid } from '../src/sim/spatial';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import {
  activePublicWorldQuestTracePids,
  nearbyWorldQuestTraces,
  PUBLIC_WORLD_QUEST_TRACE_LIMIT,
  PUBLIC_WORLD_QUEST_TRACE_RADIUS,
  PUBLIC_WORLD_QUEST_TRACE_TAIL,
  type PublicTraceWorld,
} from '../src/sim/world_quest_trace_public';
import { WORLD_SEED } from '../src/sim/world_seed';
import { bareClient } from './helpers/bare_client';

function progress(): WorldQuestProgress {
  return {
    questId: ID,
    count: 0,
    state: 'active',
    traceVariant: 'star',
    tracing: {
      questId: ID,
      shapeIndex: 0,
      phase: 'drawing',
      previewUntil: 6,
      expiresAt: 120,
      trail: Array.from({ length: 100 }, (_, x) => ({ x, z: 2 })),
      lastPosition: { x: 99, z: 2 },
      segment: 1,
      direction: 1,
      started: true,
      metrics: { distance: 100, deviationDistance: 1, startedAt: 0 },
    },
  };
}

function worldFixture() {
  const entities = new Map<number, Entity>();
  const players = new Map<number, { worldQuestLog: Map<string, WorldQuestProgress> }>();
  const playerGrid = new SpatialGrid();
  const world: PublicTraceWorld = {
    time: 10,
    entities,
    players,
    playerGrid,
    isHostileTo: () => false,
  };
  function add(id: number, x: number, row = progress()) {
    const player = createPlayer(id, 'warrior', { x, y: 0, z: 0 }, `Scribe${id}`);
    entities.set(id, player);
    players.set(id, { worldQuestLog: new Map([[ID, row]]) });
    playerGrid.insert(player);
    return player;
  }
  add(1, 0);
  return { world, entities, players, add };
}

function publicRow(pid = 2) {
  return {
    pid,
    name: 'Scribe',
    questId: ID,
    shapeIndex: 0,
    variant: 'star',
    phase: 'drawing',
    trail: [{ x: 1, z: 2 }],
  };
}

describe('nearby public calligraphy ink', () => {
  it('selects at most four other players by nearest distance then stable id', () => {
    expect([
      PUBLIC_WORLD_QUEST_TRACE_LIMIT,
      PUBLIC_WORLD_QUEST_TRACE_RADIUS,
      PUBLIC_WORLD_QUEST_TRACE_TAIL,
    ]).toEqual([4, 35, 32]);
    const { world, add } = worldFixture();
    add(10, 35.01);
    add(9, 35);
    add(8, 20);
    add(7, -10);
    add(6, 10);
    add(5, 2);
    expect(nearbyWorldQuestTraces(world, 1).map((trace) => trace.pid)).toEqual([5, 6, 7, 8]);
    expect(nearbyWorldQuestTraces(world, 999)).toEqual([]);
    const isolated = worldFixture();
    isolated.add(2, 35);
    isolated.add(3, 35.01);
    expect(nearbyWorldQuestTraces(isolated.world, 1).map((trace) => trace.pid)).toEqual([2]);
  });

  it('uses the shared broadcast candidates and avoids a dense per-viewer grid scan', () => {
    const { world, players } = worldFixture();
    players.get(1)!.worldQuestLog.clear();
    for (let pid = 2; pid <= 1_002; pid++) {
      players.set(pid, { worldQuestLog: new Map() });
    }
    const denseWorld: PublicTraceWorld = {
      ...world,
      playerGrid: {
        forEachInRadius: () => {
          throw new Error('broadcast candidates must replace the per-viewer grid query');
        },
      },
    };

    expect(activePublicWorldQuestTracePids(denseWorld).size).toBe(0);
    expect(nearbyWorldQuestTraces(denseWorld, 1, [])).toEqual([]);
  });

  it('publishes cloned blue tails only, never preview or private guidance/scoring internals', () => {
    const { world, add, players } = worldFixture();
    const row = progress();
    add(2, 1, row);
    const traces = nearbyWorldQuestTraces(world, 1);
    expect(Object.keys(traces[0]).sort()).toEqual([
      'name',
      'phase',
      'pid',
      'questId',
      'shapeIndex',
      'trail',
      'variant',
    ]);
    expect(traces[0].trail).toHaveLength(32);
    expect(traces[0].trail[0].x).toBe(68);
    row.tracing!.trail[68].x = 999;
    expect(traces[0].trail[0].x).toBe(68);
    traces[0].trail[0].z = 999;
    expect(row.tracing!.trail[68].z).toBe(2);
    for (const phase of ['preview', 'failed'] as const) {
      players.get(2)!.worldQuestLog.get(ID)!.tracing!.phase = phase;
      expect(nearbyWorldQuestTraces(world, 1)).toEqual([]);
    }
  });

  it('shows only unexpired successful results and hides dead, stealth, hostile and other-instance players', () => {
    const { world, add } = worldFixture();
    const row = progress();
    row.state = 'completed';
    row.count = 3;
    row.tracing!.phase = 'success';
    row.tracing!.shapeIndex = 2;
    row.traceResult = { score: 92, rating: 'gold', precision: 99, efficiency: 90, time: 80 };
    const player = add(2, 1, row);
    const result = nearbyWorldQuestTraces(world, 1)[0];
    expect(result).toMatchObject({ phase: 'success', score: 92, rating: 'gold', expiresAt: 120 });
    expect(Object.keys(result).sort()).toEqual([
      'expiresAt',
      'name',
      'phase',
      'pid',
      'questId',
      'rating',
      'score',
      'shapeIndex',
      'trail',
      'variant',
    ]);
    expect(nearbyWorldQuestTraces({ ...world, time: 120 }, 1)).toEqual([]);
    player.dead = true;
    expect(nearbyWorldQuestTraces(world, 1)).toEqual([]);
    player.dead = false;
    player.stealthed = true;
    expect(nearbyWorldQuestTraces(world, 1)).toEqual([]);
    player.stealthed = false;
    player.dungeonId = 'crypt';
    expect(nearbyWorldQuestTraces(world, 1)).toEqual([]);
    player.dungeonId = null;
    expect(nearbyWorldQuestTraces({ ...world, isHostileTo: () => true }, 1)).toEqual([]);
  });

  it.each([
    undefined,
    {},
    new Array(2),
    [publicRow(), publicRow()],
    Array.from({ length: 5 }, (_, i) => publicRow(i + 2)),
    [publicRow(), { ...publicRow(3), pid: 1 }],
    [{ ...publicRow(), pid: 1.5 }],
    [{ ...publicRow(), pid: Number.POSITIVE_INFINITY }],
    [{ ...publicRow(), name: 'x'.repeat(65) }],
    [{ ...publicRow(), name: 'bad\nname' }],
    [{ ...publicRow(), questId: 'constructor' }],
    [{ ...publicRow(), shapeIndex: -1 }],
    [{ ...publicRow(), shapeIndex: 99 }],
    [{ ...publicRow(), variant: 'future' }],
    [{ ...publicRow(), phase: 'preview' }],
    [{ ...publicRow(), phase: 'failed' }],
    [{ ...publicRow(), trail: Array.from({ length: 33 }, () => ({ x: 0, z: 0 })) }],
    [{ ...publicRow(), trail: [{ x: Number.NaN, z: 1 }] }],
    [{ ...publicRow(), trail: new Array(2) }],
    [{ ...publicRow(), phase: 'success', score: 99, rating: 'gold', expiresAt: 120 }],
    [
      {
        ...publicRow(),
        phase: 'success',
        shapeIndex: 2,
        score: 101,
        rating: 'gold',
        expiresAt: 120,
      },
    ],
    [
      {
        ...publicRow(),
        phase: 'success',
        shapeIndex: 2,
        score: 90.1,
        rating: 'gold',
        expiresAt: 120,
      },
    ],
    [
      {
        ...publicRow(),
        phase: 'success',
        shapeIndex: 2,
        score: 90,
        rating: 'future',
        expiresAt: 120,
      },
    ],
    [{ ...publicRow(), phase: 'success', shapeIndex: 2, score: 90, rating: 'gold', expiresAt: 10 }],
  ])('atomically clears a malformed public payload (%j)', (value) => {
    expect(decodeNearbyWorldQuestTraces(value, 1, 10)).toEqual([]);
  });

  it('clears public records on omitted snapshots and reconnect/reset without touching owner deltas', () => {
    const state = new QuestWorldWireState();
    const snapshot = { self: { id: 1 }, time: 10, qtraces: [publicRow()] };
    expect(state.applyNearbyWorldQuestTraceSnapshot(snapshot)).toBe(snapshot.self);
    expect(state.nearbyWorldQuestTraces).toHaveLength(1);
    state.applyNearbyWorldQuestTraceSnapshot({});
    expect(state.nearbyWorldQuestTraces).toEqual([]);
    state.applyNearbyWorldQuestTraceSnapshot(snapshot);
    state.resetQuestWorldWireState();
    expect(state.nearbyWorldQuestTraces).toEqual([]);
  });

  it('keeps even maximal finite coordinate and escaped-name tails below the wire bound', () => {
    const { world, add } = worldFixture();
    for (let pid = 2; pid <= 5; pid++) {
      const row = progress();
      row.tracing!.trail = Array.from({ length: 256 }, () => ({
        x: Number.MAX_VALUE,
        z: -Number.MAX_VALUE,
      }));
      add(pid, pid, row).name = '"'.repeat(64);
    }
    const json = nearbyQuestTraceWireJson(world, 1);
    expect(Buffer.byteLength(json)).toBeLessThan(16 * 1024);
    const rows = JSON.parse(`{${json.slice(1)}}`).qtraces;
    expect(rows).toHaveLength(4);
    expect(rows.every((row: { trail: unknown[] }) => row.trail.length === 32)).toBe(true);
    for (const viewerId of [-1, 0, Number.NaN, '1'])
      expect(decodeNearbyWorldQuestTraces(rows, viewerId, 10)).toEqual([]);
    for (const now of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(decodeNearbyWorldQuestTraces(rows, 1, now)).toEqual([]);
  });

  it('keeps Sim, authoritative server projection and real ClientWorld snapshots identical and bounded', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const viewerId = sim.playerId;
    for (let i = 0; i < 6; i++) {
      const pid = sim.addPlayer('warrior', `Scribe${i}`);
      const player = sim.entities.get(pid)!;
      player.pos = { ...sim.player.pos, x: sim.player.pos.x + i + 1 };
      sim.playerGrid.update(player);
      sim.meta(pid)!.worldQuestLog.set(ID, progress());
    }
    const json = nearbyQuestTraceWireJson(sim, viewerId);
    const snapshot = {
      t: 'snap',
      time: sim.time,
      ents: [],
      self: { id: viewerId, k: 'player', tid: 'warrior', nm: 'Viewer', x: 1, y: 1, z: 1 },
      ...JSON.parse(`{${json.slice(1)}}`),
    };
    expect(Buffer.byteLength(json)).toBeLessThan(16 * 1024);
    const client = bareClient(viewerId);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot(snapshot);
    expect(client.nearbyWorldQuestTraces).toEqual(sim.nearbyWorldQuestTraces);
    expect(client.nearbyWorldQuestTraces).toHaveLength(4);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
      t: 'snap',
      time: sim.time,
      ents: [],
    });
    expect(client.nearbyWorldQuestTraces).toEqual([]);
  });
});
