// Short starvation extrapolates the last consumed input while advancing the client tick debt.
// A late release may then disagree for one tick, and client reconciliation absorbs that correction.
// Frames that keep landing right after their tick was extrapolated prove the playout margin too
// thin for that client (a 30 fps sampler alternates on-time and late ticks, which never starves
// three in a row), so the timeline then plays the late frame one tick deeper instead of dropping
// it. Growing replays the guessed tick as an extra one, so a lone late frame (a stall) is still
// dropped. A grown tick is handed back only while the body is at rest on idle input and the
// skipped frame carries no new facing, where skipping it changes nothing.
import { isStunned } from '../src/sim/combat/cc';
import { type MoveInputFrame, parseMoveInputFrame } from '../src/sim/move_input';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, emptyMoveInput, type MoveInput, type Vec3 } from '../src/sim/types';
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
// Two ticks absorb a 30 fps frame of sampling lateness plus about 65 ms of network jitter.
export const MAX_PLAYOUT_GROWTH_TICKS = 2;
export const PLAYOUT_GROWTH_LATE_FRAMES = 3;
export const PLAYOUT_GROWTH_WINDOW_TICKS = 40;
export const PLAYOUT_SHRINK_SPARE_TICKS = 200;

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
  bodyPosAtLastConsume: Vec3;
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
    bodyPosAtLastConsume: { x: Number.NaN, y: Number.NaN, z: Number.NaN },
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
    let accepted = false;
    if (frame.ct !== null) {
      accepted =
        session.movementTimeline?.enqueue({
          ct: frame.ct,
          mi: frame.moveInput,
          facing: frame.facing,
        }) === true;
    }
    if (accepted && ctx) {
      noteBattlegroundWallPressure(
        ctx,
        meta,
        entity,
        frame.moveInput,
        frame.facing ?? entity.facing,
      );
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
    const lastPos = session.bodyPosAtLastConsume;
    const bodyAtRest =
      lastPos.x === entity.pos.x && lastPos.y === entity.pos.y && lastPos.z === entity.pos.z;
    lastPos.x = entity.pos.x;
    lastPos.y = entity.pos.y;
    lastPos.z = entity.pos.z;
    const frame = session.movementTimeline.consumeNext(bodyAtRest);
    if (!frame) {
      noteBattlegroundWallPressure(sim.ctx, meta, entity);
      Object.assign(meta.moveInput, emptyMoveInput());
      continue;
    }
    noteBattlegroundWallPressure(sim.ctx, meta, entity);
    Object.assign(meta.moveInput, frame.mi);
    noteBattlegroundWallPressure(sim.ctx, meta, entity, frame.mi, frame.facing ?? entity.facing);
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
  playoutGrowths = 0;
  playoutShrinks = 0;

  private readonly frames = new Map<number, MovementInputFrameV2>();
  private expectedClientTick = 0;
  private consecutiveStarvedTicks = 0;
  private lastConsumedFrame: MovementInputFrameV2 | null = null;
  private lastExtrapolatedCt = -1;
  private grownTicks = 0;
  private spareTickStreak = 0;
  private consumeTick = 0;
  private readonly recentLateFrameTicks: number[] = [];

  enqueue(frame: MovementInputFrameV2): boolean {
    if (!Number.isSafeInteger(frame.ct) || frame.ct < 0 || this.frames.has(frame.ct)) {
      return false;
    }
    if (frame.ct < this.expectedClientTick) {
      const justLate = frame.ct === this.lastExtrapolatedCt;
      if (justLate) this.recordLateFrame();
      if (justLate && this.canPlayOneTickDeeper()) {
        this.playOneTickDeeper(frame);
        return true;
      }
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
      this.grownTicks = 0;
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
      this.grownTicks = Math.max(0, this.grownTicks - 1);
      this.droppedOldest++;
    }
    return true;
  }

  consumeNext(bodyAtRest = false): MovementInputFrameV2 | null {
    this.consumeTick++;
    this.lastExtrapolatedCt = -1;
    const frame = this.frames.get(this.expectedClientTick);
    if (frame) {
      this.frames.delete(this.expectedClientTick);
      this.expectedClientTick++;
      this.consecutiveStarvedTicks = 0;
      this.lastConsumedFrame = frame;
      this.consumed++;
      this.handBackSpareTickIfIdle(frame, bodyAtRest);
      return frame;
    }

    this.starved++;
    this.consecutiveStarvedTicks++;
    const oldest = this.oldestBufferedClientTick();
    if (this.consecutiveStarvedTicks >= STARVE_RESYNC_TICKS) {
      if (oldest !== null) {
        this.expectedClientTick = oldest;
        this.consecutiveStarvedTicks = 0;
        this.grownTicks = 0;
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
    this.lastExtrapolatedCt = extrapolated.ct;
    this.extrapolated++;
    this.consumed++;
    return extrapolated;
  }

  private recordLateFrame(): void {
    this.lastExtrapolatedCt = -1;
    this.recentLateFrameTicks.push(this.consumeTick);
    if (this.recentLateFrameTicks.length > PLAYOUT_GROWTH_LATE_FRAMES) {
      this.recentLateFrameTicks.shift();
    }
  }

  private canPlayOneTickDeeper(): boolean {
    const late = this.recentLateFrameTicks;
    return (
      late.length === PLAYOUT_GROWTH_LATE_FRAMES &&
      this.consumeTick - late[0] < PLAYOUT_GROWTH_WINDOW_TICKS &&
      this.grownTicks < MAX_PLAYOUT_GROWTH_TICKS &&
      this.frames.size < MOVEMENT_INPUT_TIMELINE_DEPTH
    );
  }

  private playOneTickDeeper(frame: MovementInputFrameV2): void {
    this.expectedClientTick = frame.ct;
    this.grownTicks++;
    this.recentLateFrameTicks.length = 0;
    this.frames.set(frame.ct, frame);
    this.playoutGrowths++;
  }

  private handBackSpareTickIfIdle(consumed: MovementInputFrameV2, bodyAtRest: boolean): void {
    const next = this.frames.get(this.expectedClientTick);
    this.spareTickStreak = next ? this.spareTickStreak + 1 : 0;
    if (
      !next ||
      this.grownTicks === 0 ||
      this.spareTickStreak < PLAYOUT_SHRINK_SPARE_TICKS ||
      !bodyAtRest ||
      !isIdleMoveInput(consumed.mi) ||
      !isIdleMoveInput(next.mi) ||
      (next.facing !== null && next.facing !== consumed.facing)
    ) {
      return;
    }
    this.frames.delete(this.expectedClientTick);
    this.expectedClientTick++;
    this.grownTicks--;
    this.spareTickStreak = 0;
    this.playoutShrinks++;
  }

  private oldestBufferedClientTick(): number | null {
    let oldest: number | null = null;
    for (const ct of this.frames.keys()) {
      if (oldest === null || ct < oldest) oldest = ct;
    }
    return oldest;
  }
}

function isIdleMoveInput(mi: MoveInput): boolean {
  return (
    !mi.forward &&
    !mi.back &&
    !mi.turnLeft &&
    !mi.turnRight &&
    !mi.strafeLeft &&
    !mi.strafeRight &&
    !mi.jump &&
    !mi.dive &&
    !mi.surface &&
    mi.gliderPitch === undefined
  );
}
