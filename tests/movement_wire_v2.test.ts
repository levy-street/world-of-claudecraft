import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { consumeMovementFramesV2 } from '../server/movement_input_timeline_v2';
import { negotiateMovementWireVersion } from '../server/movement_wire_version';
import { type MovementWireClient, MovementWireGlue } from '../src/game/movement_wire_glue';
import { emptyMoveInput } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';
import type { LatencyLinkConfig } from './helpers/latency_link';
import { joinGroundTruthCharacter } from './helpers/movement_ground_truth';
import { createOnlineHarness } from './helpers/online_harness';
import { stripComments } from './helpers/strip_comments';

function link(rttMs: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed: 1337 },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: 4242 },
  };
}

describe('movement wire v2', () => {
  it('pins production consumption immediately before the simulation tick', () => {
    const source = stripComments(
      readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8'),
    );
    const call = 'consumeMovementFramesV2(this.sim, this.clients.values());';
    const loopStart = source.indexOf('this.interval = setInterval');
    const consumeAt = source.indexOf(call, loopStart);
    const tickAt = source.indexOf('const events = this.sim.tick();', loopStart);

    expect(source.split(call)).toHaveLength(2);
    expect(consumeAt).toBeGreaterThan(loopStart);
    expect(consumeAt).toBeLessThan(tickAt);
  });

  it('registers the movement profiler bucket', () => {
    const source = stripComments(
      readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8'),
    );
    const registrationStart = source.indexOf('new TickProfiler([');
    expect(registrationStart).toBeGreaterThanOrEqual(0);
    const registrationEnd = source.indexOf(']);', registrationStart);
    expect(registrationEnd).toBeGreaterThan(registrationStart);

    expect(source.slice(registrationStart, registrationEnd)).toContain("'movementV2'");
  });

  it('attributes v2 timeline and override work to the movement profiler bucket', () => {
    const source = stripComments(
      readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8'),
    );
    const consumeAt = source.indexOf('consumeMovementFramesV2(this.sim, this.clients.values());');
    const tickAt = source.indexOf('const events = this.sim.tick();', consumeAt);
    const overrideAt = source.indexOf('updateOverrideEpochs(this.sim, this.clients.values());');
    const firstMovementLap = source.indexOf("lap('movementV2');", consumeAt);
    const secondMovementLap = source.indexOf("lap('movementV2');", firstMovementLap + 1);

    expect(firstMovementLap).toBeGreaterThan(consumeAt);
    expect(firstMovementLap).toBeLessThan(tickAt);
    expect(secondMovementLap).toBeGreaterThan(overrideAt);
    expect(source.indexOf("lap('movementV2');", secondMovementLap + 1)).toBe(-1);
  });

  it.each([
    ['accepted v2', 2, 2],
    ['absent offer', undefined, 1],
    ['garbage future offer', 3, 1],
    ['garbage string offer', '2', 1],
  ] as const)('negotiates %s', (_name, offered, expected) => {
    expect(negotiateMovementWireVersion(offered)).toBe(expected);
  });

  it('does not advance while disconnected and resets client ticks on v2 renegotiation', () => {
    const sent: number[] = [];
    let open = false;
    const client: MovementWireClient = {
      movementWireVersion: 2,
      onMovementWireNegotiated: null,
      onMovementWireNeutral: null,
      movementWireIsOpen: () => open,
      sendMovementFrame: (frame) => {
        sent.push(frame.ct);
        return true;
      },
    };
    const glue = new MovementWireGlue();
    glue.connect(client, 0);

    glue.advance(client, 0.1, { ...emptyMoveInput(), forward: true }, null, 0);
    open = true;
    glue.advance(client, 0.05, { ...emptyMoveInput(), forward: true }, null, 50);
    glue.advance(client, 0.05, { ...emptyMoveInput(), forward: true }, null, 100);
    client.onMovementWireNegotiated?.(2, 100);
    glue.advance(client, 0.05, { ...emptyMoveInput(), forward: true }, null, 150);

    expect(sent).toEqual([0, 1, 0]);
  });

  it('hands prediction the exact frame object accepted by the wire client', () => {
    let sentFrame: object | null = null;
    let predictedFrame: object | null = null;
    const client: MovementWireClient = {
      movementWireVersion: 2,
      onMovementWireNegotiated: null,
      onMovementWireNeutral: null,
      movementWireIsOpen: () => true,
      sendMovementFrame: (frame) => {
        sentFrame = frame;
        return true;
      },
    };
    const glue = new MovementWireGlue();
    glue.onFrame = (frame) => {
      predictedFrame = frame;
    };
    glue.connect(client, 0);

    glue.advance(client, 0.05, { ...emptyMoveInput(), forward: true }, 0.25, 50);

    expect(predictedFrame).toBe(sentFrame);
  });

  it('reports whether a non-tick advance emitted an accepted frame', () => {
    const sent: number[] = [];
    const client: MovementWireClient = {
      movementWireVersion: 2,
      onMovementWireNegotiated: null,
      onMovementWireNeutral: null,
      movementWireIsOpen: () => true,
      sendMovementFrame: (frame) => {
        sent.push(frame.ct);
        return true;
      },
    };
    const glue = new MovementWireGlue();
    glue.connect(client, 0);

    expect(glue.advance(client, 0.016, emptyMoveInput(), 0.8, 16)).toBe(false);
    expect(glue.advance(client, 0.034, emptyMoveInput(), 0.8, 50)).toBe(true);
    expect(sent).toEqual([0]);
  });

  it('forces neutral v2 input into the next server consumption before pausing', () => {
    const { server, session } = joinGroundTruthCharacter(2, 'warrior', 2);
    const client = bareClient(session.pid, { movementWireVersion: 2 });
    const previousWebSocket = globalThis.WebSocket;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: { OPEN: 1 } });
    (client as any).ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: (payload: string) => server.handleMessage(session, payload),
    };
    const glue = new MovementWireGlue();
    glue.connect(client, 0);
    try {
      glue.advance(client, 0.05, { ...emptyMoveInput(), forward: true }, null, 50);
      consumeMovementFramesV2(server.sim, [session]);
      expect(server.sim.meta(session.pid)?.moveInput.forward).toBe(true);

      expect(client.neutralizeInputForClientPause(100)).toBe(true);
      consumeMovementFramesV2(server.sim, [session]);
      expect(server.sim.meta(session.pid)?.moveInput).toEqual(emptyMoveInput());
      expect(session.movementTimeline?.consumed).toBe(2);
      expect(session.movementTimeline?.starved).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: previousWebSocket,
      });
    }
  });

  it('consumes one frame per tick at steady RTT 150', () => {
    const harness = createOnlineHarness({ latency: link(150, 20), movementWire: 2 });
    try {
      const timeline = harness.session.movementTimeline;
      if (!timeline) throw new Error('movement v2 did not create an input timeline');
      const before = {
        consumed: timeline.consumed,
        starved: timeline.starved,
        droppedOldest: timeline.droppedOldest,
        rejectedAnchoredWindow: timeline.rejectedAnchoredWindow,
        rejectedSanityBound: timeline.rejectedSanityBound,
        resyncs: timeline.resyncs,
      };
      const run = harness.runScript({
        durationMs: 4000,
        script: [
          { atMs: 0, mi: { forward: true }, facing: 0 },
          { atMs: 3000, mi: { forward: false } },
        ],
      });

      expect(timeline.consumed - before.consumed).toBe(run.tickCount);
      expect(timeline.starved - before.starved).toBe(0);
      expect(timeline.droppedOldest - before.droppedOldest).toBe(0);
      expect(timeline.rejectedAnchoredWindow - before.rejectedAnchoredWindow).toBe(0);
      expect(timeline.rejectedSanityBound - before.rejectedSanityBound).toBe(0);
      expect(timeline.resyncs - before.resyncs).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it('sends no client-tick-less input frames during a v2 harness run', () => {
    const harness = createOnlineHarness({ latency: link(50, 0), movementWire: 2 });
    const receivedInputs: Record<string, unknown>[] = [];
    const handleMessage = harness.server.handleMessage.bind(harness.server);
    harness.server.handleMessage = (receivedSession, payload) => {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (parsed.t === 'input') receivedInputs.push(parsed);
      handleMessage(receivedSession, payload);
    };
    try {
      harness.runScript({
        durationMs: 1000,
        script: [
          { atMs: 0, mi: { forward: true }, facing: 0 },
          { atMs: 500, mi: { forward: false } },
        ],
      });

      expect(receivedInputs.length).toBeGreaterThanOrEqual(15);
      expect(receivedInputs.every((frame) => Number.isSafeInteger(frame.ct))).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it('keeps the harness option to force the legacy v1 display path', () => {
    const harness = createOnlineHarness({ latency: link(50, 0), movementWire: 1 });
    try {
      const run = harness.runScript({
        durationMs: 1000,
        script: [{ atMs: 0, mi: { forward: true }, facing: 0 }],
      });

      expect(harness.client.movementWireVersion).toBe(1);
      expect(harness.session.movementWireVersion).toBe(1);
      expect(run.frames.some((frame) => frame.predictorActive)).toBe(true);
      expect(run.frames.at(-1)?.z).toBeGreaterThan(run.frames[0].z);
    } finally {
      harness.dispose();
    }
  });
});
