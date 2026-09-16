import { describe, expect, it } from 'vitest';
import { createDungeonEntryFacingFence } from '../../server/dungeon_entry_facing';
import {
  consumeMovementFramesV2,
  createMovementInputSessionState,
  MOVEMENT_CT_SANITY_BOUND_TICKS,
  MOVEMENT_INPUT_TIMELINE_DEPTH,
  MovementInputTimeline,
  resetMovementInputSessionState,
  STARVE_RESYNC_TICKS,
} from '../../server/movement_input_timeline_v2';
import { BG_GRAVEYARDS } from '../../src/sim/battleground_layout';
import { resolvePosition } from '../../src/sim/colliders';
import { battlegroundOrigin, isBgPos } from '../../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../../src/sim/pathfind';
import { Sim } from '../../src/sim/sim';
import { emptyMoveInput, type MoveInput, type SimEvent } from '../../src/sim/types';
import { UNSTUCK_COUNTDOWN_SECONDS } from '../../src/sim/unstuck';
import { EMPTY_TEST_WORLD } from '../sim_shared';

function frame(ct: number, forward = false): { ct: number; mi: MoveInput; facing: number } {
  return { ct, mi: { ...emptyMoveInput(), forward }, facing: ct / 10 };
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(label);
  return value;
}

function activeBattleground(): { sim: Sim; pid: number } {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % classes.length], `P${i}`);
    const e = must(sim.entities.get(pid), 'battleground player');
    e.level = 20;
    e.pos = sim.groundPos((i % 5) * 2 - 4, -40);
    e.prevPos = { ...e.pos };
    sim.ctx.rebucket(e);
    sim.bgQueueJoin(pid);
    pids.push(pid);
  }
  sim.tick();
  for (const pid of pids) sim.bgRespond(true, pid);
  const match = must(sim.bgMatchFor(pids[0]), 'accepted battleground match');
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
  expect(match.state).toBe('active');
  return { sim, pid: match.teams[0][0] };
}

function placeAtReportedWallContact(sim: Sim, pid: number): number {
  const match = must(sim.bgMatchFor(pid), 'battleground match');
  const origin = battlegroundOrigin(match.slot);
  const e = must(sim.entities.get(pid), 'battleground player');
  e.pos = sim.groundPos(origin.x - 48.5, origin.z - 133.5);
  e.prevPos = { ...e.pos };
  e.facing = -Math.PI / 2;
  e.prevFacing = e.facing;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
  e.jumping = false;
  e.inCombat = false;
  e.combatTimer = 999;
  sim.ctx.rebucket(e);
  const resolved = resolvePosition(sim.cfg.seed, e.pos.x, e.pos.z, PLAYER_BODY_RADIUS);
  expect(Math.hypot(resolved.x - e.pos.x, resolved.z - e.pos.z)).toBeLessThanOrEqual(1e-6);
  return e.facing;
}

describe('MovementInputTimeline', () => {
  it('pins the timeline depth and starvation resync threshold', () => {
    expect(MOVEMENT_INPUT_TIMELINE_DEPTH).toBe(6);
    expect(STARVE_RESYNC_TICKS).toBe(3);
    expect(MOVEMENT_CT_SANITY_BOUND_TICKS).toBe(1200);
  });

  it('consumes exactly one frame in client tick order', () => {
    const timeline = new MovementInputTimeline();
    timeline.enqueue(frame(0, true));
    timeline.enqueue(frame(1));

    expect(timeline.consumeNext()).toEqual(frame(0, true));
    expect(timeline.consumeNext()).toEqual(frame(1));
    expect(timeline.consumed).toBe(2);
  });

  it('drops the oldest frame when the depth cap overflows', () => {
    const timeline = new MovementInputTimeline();
    for (let ct = 0; ct <= MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) timeline.enqueue(frame(ct));

    expect(timeline.droppedOldest).toBe(1);
    expect(timeline.rejectedAnchoredWindow).toBe(0);
    expect(timeline.rejectedSanityBound).toBe(0);
    expect(timeline.discardedLate).toBe(0);
    expect(Array.from({ length: 6 }, () => timeline.consumeNext()?.ct)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('holds through starvation and resyncs to the oldest buffered frame', () => {
    const timeline = new MovementInputTimeline();
    timeline.enqueue(frame(2, true));

    for (let tick = 0; tick < STARVE_RESYNC_TICKS; tick++) {
      expect(timeline.consumeNext()).toBeNull();
    }
    expect(timeline.starved).toBe(STARVE_RESYNC_TICKS);
    expect(timeline.resyncs).toBe(1);
    expect(timeline.consumeNext()).toEqual(frame(2, true));
  });

  it('accepts out-of-order frames and consumes them by client tick', () => {
    const timeline = new MovementInputTimeline();
    timeline.enqueue(frame(2));
    timeline.enqueue(frame(0));
    timeline.enqueue(frame(1));

    expect([
      timeline.consumeNext()?.ct,
      timeline.consumeNext()?.ct,
      timeline.consumeNext()?.ct,
    ]).toEqual([0, 1, 2]);
  });

  it('rejects invalid and replayed client ticks', () => {
    const timeline = new MovementInputTimeline();

    expect(timeline.enqueue(frame(-1))).toBe(false);
    expect(timeline.enqueue(frame(0.5))).toBe(false);
    expect(timeline.enqueue(frame(Number.MAX_SAFE_INTEGER + 1))).toBe(false);
    expect(timeline.enqueue(frame(0))).toBe(true);
    expect(timeline.enqueue(frame(0))).toBe(false);
    expect(timeline.consumeNext()?.ct).toBe(0);
    expect(timeline.enqueue(frame(0))).toBe(false);
    expect(timeline.discardedLate).toBe(1);
    expect(timeline.droppedOldest).toBe(0);
    expect(timeline.rejectedAnchoredWindow).toBe(0);
    expect(timeline.rejectedSanityBound).toBe(0);
  });

  it('rejects a far-future client tick without wedging the buffer', () => {
    const timeline = new MovementInputTimeline();

    expect(timeline.enqueue(frame(1e12))).toBe(false);
    expect(timeline.rejectedSanityBound).toBe(1);
    expect(timeline.droppedOldest).toBe(0);
    expect(timeline.rejectedAnchoredWindow).toBe(0);
    expect(timeline.discardedLate).toBe(0);
    expect(timeline.enqueue(frame(0, true))).toBe(true);
    expect(timeline.consumeNext()).toEqual(frame(0, true));
  });

  it('recovers after an empty-buffer shed hole wider than the timeline depth', () => {
    const timeline = new MovementInputTimeline();
    for (let ct = 0; ct < 10; ct++) {
      expect(timeline.enqueue(frame(ct, true))).toBe(true);
      expect(timeline.consumeNext()).not.toBeNull();
    }
    for (let tick = 0; tick < 30; tick++) timeline.consumeNext();
    for (let ct = 32; ct < 40; ct++) timeline.enqueue(frame(ct, true));

    let consumedAfterRecovery = 0;
    for (let ct = 40; ct < 440; ct++) {
      timeline.enqueue(frame(ct, true));
      if (timeline.consumeNext()) consumedAfterRecovery++;
    }

    expect(consumedAfterRecovery).toBe(400);
    expect(timeline.resyncs).toBeGreaterThan(0);
  });

  it('keeps the depth ceiling while a buffered frame anchors the timeline', () => {
    const timeline = new MovementInputTimeline();

    expect(timeline.enqueue(frame(0))).toBe(true);
    expect(timeline.enqueue(frame(MOVEMENT_INPUT_TIMELINE_DEPTH + 1))).toBe(false);
    expect(timeline.rejectedAnchoredWindow).toBe(1);
    expect(timeline.rejectedSanityBound).toBe(0);
    expect(timeline.droppedOldest).toBe(0);
    expect(timeline.discardedLate).toBe(0);
    expect(timeline.consumeNext()).toEqual(frame(0));
  });

  it('keeps the depth ceiling with an empty buffer before the starvation threshold', () => {
    const timeline = new MovementInputTimeline();
    for (let tick = 0; tick < STARVE_RESYNC_TICKS - 1; tick++) timeline.consumeNext();

    expect(timeline.enqueue(frame(MOVEMENT_INPUT_TIMELINE_DEPTH + 1))).toBe(false);
    expect(timeline.rejectedAnchoredWindow).toBe(1);
    expect(timeline.rejectedSanityBound).toBe(0);
    expect(timeline.droppedOldest).toBe(0);
    expect(timeline.discardedLate).toBe(0);
    expect(timeline.resyncs).toBe(0);
  });

  it('accepts the inclusive sanity boundary as an empty-buffer resync anchor', () => {
    const timeline = new MovementInputTimeline();
    for (let tick = 0; tick < STARVE_RESYNC_TICKS; tick++) timeline.consumeNext();

    expect(timeline.enqueue(frame(MOVEMENT_CT_SANITY_BOUND_TICKS))).toBe(true);
    expect(timeline.rejectedAnchoredWindow).toBe(0);
    expect(timeline.rejectedSanityBound).toBe(0);
    expect(timeline.resyncs).toBe(1);
    expect(timeline.consumeNext()?.ct).toBe(MOVEMENT_CT_SANITY_BOUND_TICKS);
  });

  it('does not count a contiguous frame as an empty-buffer resync', () => {
    const timeline = new MovementInputTimeline();
    for (let tick = 0; tick < STARVE_RESYNC_TICKS; tick++) timeline.consumeNext();

    expect(timeline.enqueue(frame(0))).toBe(true);
    expect(timeline.resyncs).toBe(0);
    expect(timeline.consumeNext()).toEqual(frame(0));
  });

  it('rejects an absurd jump after empty-buffer starvation', () => {
    const timeline = new MovementInputTimeline();
    for (let tick = 0; tick < STARVE_RESYNC_TICKS; tick++) timeline.consumeNext();

    expect(timeline.enqueue(frame(MOVEMENT_CT_SANITY_BOUND_TICKS + 1))).toBe(false);
    expect(timeline.rejectedSanityBound).toBe(1);
    expect(timeline.droppedOldest).toBe(0);
    expect(timeline.rejectedAnchoredWindow).toBe(0);
    expect(timeline.discardedLate).toBe(0);
    expect(timeline.resyncs).toBe(0);
  });

  it('advances the ack with one held-input frame on a starved tick', () => {
    const timeline = new MovementInputTimeline();
    const session = {
      pid: 1,
      lastInputAt: 0,
      ...createMovementInputSessionState(2),
      dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
      movementTimeline: timeline,
    };
    const meta = { moveInput: emptyMoveInput() };
    const entity = { auras: [], dead: false, facing: 0, ghost: false };
    const sim = {
      time: 1,
      meta: () => meta,
      entities: new Map([[1, entity]]),
    };
    timeline.enqueue(frame(0, true));

    consumeMovementFramesV2(sim as never, [session]);
    consumeMovementFramesV2(sim as never, [session]);

    expect(meta.moveInput.forward).toBe(true);
    expect(session.lastConsumedCt).toBe(1);
    expect(timeline.consumed).toBe(2);
    expect(timeline.extrapolated).toBe(1);
    expect(timeline.starved).toBe(1);
  });

  it('does not require battleground state when consuming a lightweight sim', () => {
    const timeline = new MovementInputTimeline();
    const session = {
      pid: 1,
      lastInputAt: 0,
      ...createMovementInputSessionState(2),
      dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
      movementTimeline: timeline,
    };
    const meta = { moveInput: emptyMoveInput() };
    const entity = { auras: [], dead: false, facing: 0, ghost: false };
    const sim = {
      time: 1,
      meta: () => meta,
      entities: new Map([[1, entity]]),
    };
    timeline.enqueue(frame(0, true));

    expect(() => consumeMovementFramesV2(sim as never, [session])).not.toThrow();
    expect(meta.moveInput.forward).toBe(true);
    expect(session.lastConsumedCt).toBe(0);
  });

  it('preserves battleground wall pressure after an ESC-menu neutral frame', () => {
    const { sim, pid } = activeBattleground();
    const facing = placeAtReportedWallContact(sim, pid);
    const timeline = new MovementInputTimeline();
    const session = {
      pid,
      lastInputAt: 0,
      ...createMovementInputSessionState(2),
      dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
      movementTimeline: timeline,
    };
    const meta = must(sim.meta(pid), 'battleground player meta');

    timeline.enqueue({ ct: 0, mi: { ...emptyMoveInput(), forward: true }, facing });
    consumeMovementFramesV2(sim, [session]);
    expect(meta.moveInput.forward).toBe(true);

    timeline.enqueue({ ct: 1, mi: emptyMoveInput(), facing });
    consumeMovementFramesV2(sim, [session]);
    expect(meta.moveInput).toEqual(emptyMoveInput());

    expect(sim.unstuck(pid)).toBe(true);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'started', pid }),
    );

    const completed: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20; i++) completed.push(...sim.tick());
    expect(completed).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'completed', pid }),
    );
    expect(sim.bgMatchFor(pid)).not.toBeNull();
    const e = must(sim.entities.get(pid), 'battleground player');
    expect(isBgPos(e.pos.x)).toBe(true);
    const match = must(sim.bgMatchFor(pid), 'battleground match');
    const origin = battlegroundOrigin(match.slot);
    const plot = BG_GRAVEYARDS[0];
    expect(Math.abs(e.pos.x - (origin.x + plot.x))).toBeLessThanOrEqual(plot.hw);
    expect(Math.abs(e.pos.z - (origin.z + plot.z))).toBeLessThanOrEqual(plot.hd);
  });

  it('clears held input on null starvation ticks without advancing the ack', () => {
    const timeline = new MovementInputTimeline();
    const session = {
      pid: 1,
      lastInputAt: 0,
      ...createMovementInputSessionState(2),
      dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
      movementTimeline: timeline,
    };
    const meta = { moveInput: emptyMoveInput() };
    const entity = { auras: [], dead: false, facing: 0, ghost: false };
    const sim = {
      time: 1,
      meta: () => meta,
      entities: new Map([[1, entity]]),
    };
    timeline.enqueue(frame(0, true));
    timeline.enqueue({ ...frame(4), mi: { ...emptyMoveInput(), back: true } });

    consumeMovementFramesV2(sim as never, [session]);
    consumeMovementFramesV2(sim as never, [session]);
    consumeMovementFramesV2(sim as never, [session]);
    expect(meta.moveInput.forward).toBe(true);
    expect(session.lastConsumedCt).toBe(2);

    consumeMovementFramesV2(sim as never, [session]);
    expect(meta.moveInput).toEqual(emptyMoveInput());
    expect(session.lastConsumedCt).toBe(2);
    expect(timeline.resyncs).toBe(1);

    consumeMovementFramesV2(sim as never, [session]);
    expect(meta.moveInput.back).toBe(true);
    expect(session.lastConsumedCt).toBe(4);
  });

  it('discards and counts a real frame whose client tick was extrapolated', () => {
    const timeline = new MovementInputTimeline();
    timeline.enqueue(frame(0, true));
    expect(timeline.consumeNext()).toEqual(frame(0, true));
    expect(timeline.consumeNext()).toEqual({ ...frame(0, true), ct: 1 });

    expect(timeline.enqueue(frame(1, false))).toBe(false);
    expect(timeline.discardedLate).toBe(1);
  });

  it('extrapolates only until the genuine-gap resync threshold', () => {
    const timeline = new MovementInputTimeline();
    timeline.enqueue(frame(0, true));
    timeline.enqueue(frame(4, false));

    expect(timeline.consumeNext()).toEqual(frame(0, true));
    expect(timeline.consumeNext()).toEqual({ ...frame(0, true), ct: 1 });
    expect(timeline.consumeNext()).toEqual({ ...frame(0, true), ct: 2 });
    expect(timeline.consumeNext()).toBeNull();
    expect(timeline.resyncs).toBe(1);
    expect(timeline.consumeNext()).toEqual(frame(4, false));
    expect(timeline.extrapolated).toBe(STARVE_RESYNC_TICKS - 1);
  });

  it('recreates linkdead resume state so client tick zero consumes without starvation', () => {
    const session = {
      pid: 1,
      lastInputAt: 10,
      ...createMovementInputSessionState(2),
      dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
    };
    session.movementTimeline?.enqueue(frame(5));
    expect(session.movementTimeline?.consumeNext()).toBeNull();

    resetMovementInputSessionState(session, 2);
    expect(session.lastConsumedCt).toBe(-1);
    expect(session.movementTimeline?.enqueue(frame(0, true))).toBe(true);
    expect(session.movementTimeline?.consumeNext()).toEqual(frame(0, true));
    expect(session.movementTimeline?.starved).toBe(0);
  });
});
