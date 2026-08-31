// Short starvation extrapolates the last consumed input while advancing the client tick debt.
// A late release may then disagree for one tick, and client reconciliation absorbs that correction.
import { isStunned } from '../src/sim/combat/cc';
import { type MoveInputFrame, parseMoveInputFrame } from '../src/sim/move_input';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, emptyMoveInput, type MoveInput } from '../src/sim/types';
import { noteBattlegroundWallPressure } from '../src/sim/unstuck';
import { type DungeonEntryFacingFence, decideDungeonEntryInput } from './dungeon_entry_facing';
import {
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
} from './movement_override_epoch';

export const MOVEMENT_INPUT_TIMELINE_DEPTH = 6;
export const STARVE_RESYNC_TICKS = 3;
// Sixty seconds at 20 Hz is twice the 30 second keepalive window. A real gap
// this long reaches session resume instead of timeline recovery.
export const MOVEMENT_CT_SANITY_BOUND_TICKS = 1200;

export interface MovementInputFrameV2 {
  ct: number;
  mi: MoveInput;
  facing: number | null;
}

export interface MovementInputSessionState extends MovementOverrideSessionState {
  pid: number;
  lastInputAt: number;
  movementWireVersion: 1 | 2;
  movementTimeline: MovementInputTimeline | null;
  lastConsumedCt: number;
  // The dungeon-entry heading fence. Deliberately NOT minted by
  // createMovementInputSessionState: a resume must carry the armed fence
  // forward (entryFacing.forResume), never reset it with the wire state.
  dungeonEntryFacing: DungeonEntryFacingFence;
}

export function createMovementInputSessionState(
  movementWireVersion: unknown,
): Omit<MovementInputSessionState, 'pid' | 'lastInputAt' | 'dungeonEntryFacing'> {
  const version = movementWireVersion === 2 ? 2 : 1;
  return {
    movementWireVersion: version,
    movementTimeline: version === 2 ? new MovementInputTimeline() : null,
    lastConsumedCt: -1,
    ...createMovementOverrideSessionState(),
  };
}

export function resetMovementInputSessionState(
  session: MovementInputSessionState,
  movementWireVersion: unknown,
): void {
  Object.assign(session, createMovementInputSessionState(movementWireVersion));
}

export function applyMovementInputFrame(
  session: MovementInputSessionState,
  meta: PlayerMeta,
  entity: Entity,
  raw: unknown,
  simTime: number,
  ctx?: SimContext,
): MoveInputFrame {
  const parsed = parseMoveInputFrame(raw);
  // The dungeon-entry heading fence runs at RECEIVE time, so it covers both
  // wire versions from one place. What it checks is a property of THIS packet
  // (does its `de` acknowledge the entry generation the server forced?), not of
  // the tick the input eventually drives, so deciding here is sound; a v2 frame
  // then carries the already-fenced moveInput and facing into the timeline and
  // the deferred apply needs no fence state of its own.
  const decision = decideDungeonEntryInput(
    session.dungeonEntryFacing,
    entity,
    parsed,
    (raw as { de?: unknown } | null | undefined)?.de,
  );
  session.dungeonEntryFacing = decision.state;
  const frame: MoveInputFrame = {
    ...parsed,
    moveInput: decision.moveInput,
    facing: decision.facing,
  };
  if (session.movementWireVersion === 2) {
    if (frame.ct !== null) {
      session.movementTimeline?.enqueue({
        ct: frame.ct,
        mi: frame.moveInput,
        facing: frame.facing,
      });
    }
    return frame;
  }
  if (ctx) noteBattlegroundWallPressure(ctx, meta, entity);
  Object.assign(meta.moveInput, frame.moveInput);
  if (ctx) noteBattlegroundWallPressure(ctx, meta, entity);
  session.lastInputAt = simTime;
  if (frame.facing !== null && (!entity.dead || entity.ghost) && !isStunned(entity)) {
    entity.facing = frame.facing;
  }
  return frame;
}

export function consumeMovementFramesV2(
  sim: Pick<Sim, 'time' | 'meta' | 'entities' | 'ctx'>,
  sessions: Iterable<MovementInputSessionState>,
): void {
  for (const session of sessions) {
    if (session.movementWireVersion !== 2 || !session.movementTimeline) continue;
    const meta = sim.meta(session.pid);
    const entity = sim.entities.get(session.pid);
    if (!meta || !entity) continue;
    const frame = session.movementTimeline.consumeNext();
    if (!frame) {
      noteBattlegroundWallPressure(sim.ctx, meta, entity);
      Object.assign(meta.moveInput, emptyMoveInput());
      continue;
    }
    noteBattlegroundWallPressure(sim.ctx, meta, entity);
    Object.assign(meta.moveInput, frame.mi);
    noteBattlegroundWallPressure(sim.ctx, meta, entity);
    if (frame.facing !== null && (!entity.dead || entity.ghost) && !isStunned(entity)) {
      entity.facing = frame.facing;
    }
    session.lastConsumedCt = frame.ct;
    session.lastInputAt = sim.time;
  }
}

export class MovementInputTimeline {
  consumed = 0;
  starved = 0;
  extrapolated = 0;
  discardedLate = 0;
  droppedOldest = 0;
  rejectedAnchoredWindow = 0;
  rejectedSanityBound = 0;
  resyncs = 0;

  private readonly frames = new Map<number, MovementInputFrameV2>();
  private expectedClientTick = 0;
  private consecutiveStarvedTicks = 0;
  private lastConsumedFrame: MovementInputFrameV2 | null = null;

  enqueue(frame: MovementInputFrameV2): boolean {
    if (!Number.isSafeInteger(frame.ct) || frame.ct < 0 || this.frames.has(frame.ct)) {
      return false;
    }
    if (frame.ct < this.expectedClientTick) {
      this.discardedLate++;
      return false;
    }
    if (frame.ct > this.expectedClientTick + MOVEMENT_CT_SANITY_BOUND_TICKS) {
      this.rejectedSanityBound++;
      return false;
    }
    if (this.frames.size === 0 && this.consecutiveStarvedTicks >= STARVE_RESYNC_TICKS) {
      const cursorMoved = frame.ct !== this.expectedClientTick;
      this.expectedClientTick = frame.ct;
      this.consecutiveStarvedTicks = 0;
      this.frames.set(frame.ct, frame);
      if (cursorMoved) this.resyncs++;
      return true;
    }
    if (frame.ct > this.expectedClientTick + MOVEMENT_INPUT_TIMELINE_DEPTH) {
      this.rejectedAnchoredWindow++;
      return false;
    }
    this.frames.set(frame.ct, frame);
    while (this.frames.size > MOVEMENT_INPUT_TIMELINE_DEPTH) {
      const oldest = this.oldestBufferedClientTick();
      if (oldest === null) break;
      this.frames.delete(oldest);
      this.expectedClientTick = Math.max(this.expectedClientTick, oldest + 1);
      this.droppedOldest++;
    }
    return true;
  }

  consumeNext(): MovementInputFrameV2 | null {
    const frame = this.frames.get(this.expectedClientTick);
    if (frame) {
      this.frames.delete(this.expectedClientTick);
      this.expectedClientTick++;
      this.consecutiveStarvedTicks = 0;
      this.lastConsumedFrame = frame;
      this.consumed++;
      return frame;
    }

    this.starved++;
    this.consecutiveStarvedTicks++;
    const oldest = this.oldestBufferedClientTick();
    if (this.consecutiveStarvedTicks >= STARVE_RESYNC_TICKS) {
      if (oldest !== null) {
        this.expectedClientTick = oldest;
        this.consecutiveStarvedTicks = 0;
        this.resyncs++;
      }
      return null;
    }
    if (!this.lastConsumedFrame) return null;

    const extrapolated: MovementInputFrameV2 = {
      ct: this.expectedClientTick++,
      mi: { ...this.lastConsumedFrame.mi },
      facing: this.lastConsumedFrame.facing,
    };
    this.lastConsumedFrame = extrapolated;
    this.extrapolated++;
    this.consumed++;
    return extrapolated;
  }

  private oldestBufferedClientTick(): number | null {
    let oldest: number | null = null;
    for (const ct of this.frames.keys()) {
      if (oldest === null || ct < oldest) oldest = ct;
    }
    return oldest;
  }
}
