import { describe, expect, it } from 'vitest';
import { createDungeonEntryFacingFence } from '../../server/dungeon_entry_facing';
import {
  consumeMovementFramesV2,
  createMovementInputSessionState,
  MAX_PLAYOUT_GROWTH_TICKS,
  MOVEMENT_CT_SANITY_BOUND_TICKS,
  MOVEMENT_INPUT_TIMELINE_DEPTH,
  type MovementInputFrameV2,
  MovementInputTimeline,
  PLAYOUT_GROWTH_LATE_FRAMES,
  PLAYOUT_GROWTH_WINDOW_TICKS,
  PLAYOUT_SHRINK_SPARE_TICKS,
  resetMovementInputSessionState,
  STARVE_RESYNC_TICKS,
} from '../../server/movement_input_timeline_v2';
import { emptyMoveInput, type MoveInput } from '../../src/sim/types';

function frame(ct: number, forward = false): { ct: number; mi: MoveInput; facing: number } {
  return { ct, mi: { ...emptyMoveInput(), forward }, facing: ct / 10 };
}

function startedTimeline(): MovementInputTimeline {
  const timeline = new MovementInputTimeline();
  timeline.enqueue(frame(0));
  timeline.consumeNext();
  return timeline;
}

// The 30 fps rhythm: each guessed tick's real frame lands just after it, the next one on time.
function alternateLateFrames(
  timeline: MovementInputTimeline,
  fromCt: number,
  count: number,
): { kept: boolean[]; nextCt: number } {
  const kept: boolean[] = [];
  let ct = fromCt;
  for (let late = 0; late < count; late++) {
    timeline.consumeNext();
    kept.push(timeline.enqueue(frame(ct)));
    timeline.enqueue(frame(ct + 1));
    timeline.consumeNext();
    if (kept.at(-1)) timeline.consumeNext();
    ct += 2;
  }
  return { kept, nextCt: ct };
}

function grownTimeline(): { timeline: MovementInputTimeline; nextCt: number } {
  const timeline = startedTimeline();
  const { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES);
  return { timeline, nextCt };
}

function idleFrame(ct: number, facing: number | null = 0): MovementInputFrameV2 {
  return { ct, mi: emptyMoveInput(), facing };
}

function consumeWithSpareFrame(
  timeline: MovementInputTimeline,
  firstCt: number,
  ticks: number,
  frameAt: (ct: number) => MovementInputFrameV2,
  bodyAtRest: boolean,
  spareFrames = 1,
): number[] {
  const consumedCts: number[] = [];
  for (let ct = firstCt; ct < firstCt + spareFrames; ct++) timeline.enqueue(frameAt(ct));
  for (let ct = firstCt + spareFrames; ct < firstCt + spareFrames + ticks; ct++) {
    timeline.enqueue(frameAt(ct));
    const consumed = timeline.consumeNext(bodyAtRest);
    if (consumed) consumedCts.push(consumed.ct);
  }
  return consumedCts;
}

function lightweightV2Session(timeline: MovementInputTimeline) {
  const session = {
    pid: 1,
    lastInputAt: 0,
    ...createMovementInputSessionState(2),
    dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
    movementTimeline: timeline,
  };
  const meta = { moveInput: emptyMoveInput() };
  const entity = { auras: [], dead: false, facing: 0, ghost: false, pos: { x: 0, y: 0, z: 0 } };
  const sim = {
    time: 1,
    meta: () => meta,
    entities: new Map([[1, entity]]),
  };
  return { session, meta, entity, sim };
}

describe('MovementInputTimeline', () => {
  it('pins the timeline depth, starvation resync threshold and playout bounds', () => {
    expect(MOVEMENT_INPUT_TIMELINE_DEPTH).toBe(6);
    expect(STARVE_RESYNC_TICKS).toBe(3);
    expect(MOVEMENT_CT_SANITY_BOUND_TICKS).toBe(1200);
    expect(MAX_PLAYOUT_GROWTH_TICKS).toBe(2);
    expect(PLAYOUT_GROWTH_LATE_FRAMES).toBe(3);
    expect(PLAYOUT_GROWTH_WINDOW_TICKS).toBe(40);
    expect(PLAYOUT_SHRINK_SPARE_TICKS).toBe(200);
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
    const entity = { auras: [], dead: false, facing: 0, ghost: false, pos: { x: 0, y: 0, z: 0 } };
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
    const entity = { auras: [], dead: false, facing: 0, ghost: false, pos: { x: 0, y: 0, z: 0 } };
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
    const entity = { auras: [], dead: false, facing: 0, ghost: false, pos: { x: 0, y: 0, z: 0 } };
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
    expect(timeline.playoutGrowths).toBe(0);
  });

  it('plays a late frame one tick deeper once late frames keep landing after their guess', () => {
    const timeline = startedTimeline();
    const { kept, nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES);

    expect(kept).toEqual([...Array(PLAYOUT_GROWTH_LATE_FRAMES - 1).fill(false), true]);
    expect(timeline.discardedLate).toBe(PLAYOUT_GROWTH_LATE_FRAMES - 1);
    expect(timeline.playoutGrowths).toBe(1);
    for (let ct = nextCt; ct < nextCt + 5; ct++) {
      timeline.enqueue(frame(ct));
      expect(timeline.consumeNext()).toEqual(frame(ct));
    }
    expect(timeline.extrapolated).toBe(PLAYOUT_GROWTH_LATE_FRAMES);
  });

  it('forgets late frames older than the growth window', () => {
    const timeline = startedTimeline();
    let { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES - 1);
    for (let tick = 0; tick < PLAYOUT_GROWTH_WINDOW_TICKS; tick++) {
      timeline.enqueue(frame(nextCt));
      timeline.consumeNext();
      nextCt++;
    }

    expect(alternateLateFrames(timeline, nextCt, PLAYOUT_GROWTH_LATE_FRAMES).kept).toEqual([
      ...Array(PLAYOUT_GROWTH_LATE_FRAMES - 1).fill(false),
      true,
    ]);
    expect(timeline.playoutGrowths).toBe(1);
  });

  it.each([
    ['the last tick inside', 1, true],
    ['the first tick past', 0, false],
  ])('grows when the oldest counted late frame is %s the window', (_label, margin, grows) => {
    const timeline = startedTimeline();
    let { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES - 1);
    const onTimeTicks =
      PLAYOUT_GROWTH_WINDOW_TICKS - 2 * (PLAYOUT_GROWTH_LATE_FRAMES - 1) - Number(margin);
    for (let tick = 0; tick < onTimeTicks; tick++) {
      timeline.enqueue(frame(nextCt));
      timeline.consumeNext();
      nextCt++;
    }

    expect(alternateLateFrames(timeline, nextCt, 1).kept).toEqual([grows]);
  });

  it('counts one late frame per guessed tick however often it is resent', () => {
    const timeline = startedTimeline();
    timeline.consumeNext();
    for (let copy = 0; copy < PLAYOUT_GROWTH_LATE_FRAMES; copy++) {
      expect(timeline.enqueue(frame(1))).toBe(false);
    }

    expect(timeline.playoutGrowths).toBe(0);
    expect(alternateLateFrames(timeline, 2, PLAYOUT_GROWTH_LATE_FRAMES - 2).kept).toEqual(
      Array(PLAYOUT_GROWTH_LATE_FRAMES - 2).fill(false),
    );
    expect(timeline.playoutGrowths).toBe(0);
  });

  it('keeps the growth cap after an overflow drop while nothing was grown', () => {
    const timeline = startedTimeline();
    for (let ct = 1; ct <= 1 + MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) timeline.enqueue(frame(ct));
    expect(timeline.droppedOldest).toBe(1);
    for (let ct = 2; ct <= 1 + MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) timeline.consumeNext();

    alternateLateFrames(
      timeline,
      2 + MOVEMENT_INPUT_TIMELINE_DEPTH,
      PLAYOUT_GROWTH_LATE_FRAMES * (MAX_PLAYOUT_GROWTH_TICKS + 1),
    );
    expect(timeline.playoutGrowths).toBe(MAX_PLAYOUT_GROWTH_TICKS);
  });

  it('counts only a frame for the latest guessed tick as lateness', () => {
    const timeline = startedTimeline();
    const { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES - 2);
    timeline.consumeNext();
    timeline.consumeNext();

    expect(timeline.enqueue(frame(nextCt))).toBe(false);
    expect(timeline.enqueue(frame(nextCt + 1))).toBe(false);
    expect(timeline.discardedLate).toBe(PLAYOUT_GROWTH_LATE_FRAMES);
    timeline.enqueue(frame(nextCt + 2));
    expect(timeline.consumeNext()).toEqual(frame(nextCt + 2));

    expect(alternateLateFrames(timeline, nextCt + 3, 1).kept).toEqual([true]);
    expect(timeline.playoutGrowths).toBe(1);
  });

  it('stops deepening the playout at the growth cap', () => {
    const timeline = startedTimeline();
    const { kept } = alternateLateFrames(
      timeline,
      1,
      PLAYOUT_GROWTH_LATE_FRAMES * (MAX_PLAYOUT_GROWTH_TICKS + 1),
    );

    expect(kept.filter(Boolean)).toHaveLength(MAX_PLAYOUT_GROWTH_TICKS);
    expect(timeline.playoutGrowths).toBe(MAX_PLAYOUT_GROWTH_TICKS);
  });

  it('keeps the genuine-gap anchor once starvation reaches the resync threshold', () => {
    const timeline = startedTimeline();
    const { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES - 1);
    for (let tick = 0; tick < STARVE_RESYNC_TICKS - 1; tick++) timeline.consumeNext();
    expect(timeline.consumeNext()).toBeNull();

    const lastGuessed = nextCt + STARVE_RESYNC_TICKS - 2;
    expect(timeline.enqueue(frame(lastGuessed))).toBe(false);
    expect(timeline.playoutGrowths).toBe(0);
    expect(timeline.enqueue(frame(lastGuessed + 1))).toBe(true);
    expect(timeline.consumeNext()).toEqual(frame(lastGuessed + 1));
  });

  it('does not deepen a full buffer', () => {
    const timeline = startedTimeline();
    const { nextCt } = alternateLateFrames(timeline, 1, PLAYOUT_GROWTH_LATE_FRAMES - 1);
    for (let ct = nextCt + 1; ct <= nextCt + MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) {
      timeline.enqueue(frame(ct));
    }
    expect(timeline.consumeNext()?.ct).toBe(nextCt);

    expect(timeline.enqueue(frame(nextCt))).toBe(false);
    expect(timeline.playoutGrowths).toBe(0);
  });

  it.each([
    ['an empty-buffer anchor', false],
    ['a resync onto a buffered frame', true],
  ])('restores the full growth allowance after %s', (_label, buffered) => {
    const timeline = startedTimeline();
    const capped = alternateLateFrames(
      timeline,
      1,
      PLAYOUT_GROWTH_LATE_FRAMES * MAX_PLAYOUT_GROWTH_TICKS,
    );
    expect(timeline.playoutGrowths).toBe(MAX_PLAYOUT_GROWTH_TICKS);
    const anchor = capped.nextCt + (buffered ? 5 : 20);
    if (buffered) timeline.enqueue(frame(anchor));
    for (let tick = 0; tick < STARVE_RESYNC_TICKS; tick++) timeline.consumeNext();
    if (!buffered) timeline.enqueue(frame(anchor));
    expect(timeline.resyncs).toBe(1);
    expect(timeline.consumeNext()).toEqual(frame(anchor));

    expect(alternateLateFrames(timeline, anchor + 1, PLAYOUT_GROWTH_LATE_FRAMES).kept.at(-1)).toBe(
      true,
    );
    expect(timeline.playoutGrowths).toBe(MAX_PLAYOUT_GROWTH_TICKS + 1);
  });

  it('counts an overflow drop as one grown tick handed back', () => {
    const timeline = startedTimeline();
    const capped = alternateLateFrames(
      timeline,
      1,
      PLAYOUT_GROWTH_LATE_FRAMES * MAX_PLAYOUT_GROWTH_TICKS,
    );
    const first = capped.nextCt;
    for (let ct = first; ct <= first + MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) {
      timeline.enqueue(frame(ct));
    }
    expect(timeline.droppedOldest).toBe(1);
    for (let ct = first + 1; ct <= first + MOVEMENT_INPUT_TIMELINE_DEPTH; ct++) {
      expect(timeline.consumeNext()?.ct).toBe(ct);
    }

    const next = first + MOVEMENT_INPUT_TIMELINE_DEPTH + 1;
    expect(alternateLateFrames(timeline, next, PLAYOUT_GROWTH_LATE_FRAMES).kept.at(-1)).toBe(true);
    expect(timeline.playoutGrowths).toBe(MAX_PLAYOUT_GROWTH_TICKS + 1);
  });

  it('hands a grown tick back after a sustained spare frame while idle and at rest', () => {
    const { timeline, nextCt } = grownTimeline();
    const consumed = consumeWithSpareFrame(
      timeline,
      nextCt,
      PLAYOUT_SHRINK_SPARE_TICKS * 3,
      idleFrame,
      true,
      2,
    );

    expect(timeline.playoutShrinks).toBe(1);
    const skipped = consumed.findIndex((ct, index) => index > 0 && ct !== consumed[index - 1] + 1);
    expect(skipped).toBe(PLAYOUT_SHRINK_SPARE_TICKS);
    expect(consumed[skipped] - consumed[skipped - 1]).toBe(2);

    const drained: (number | undefined)[] = [];
    for (let tick = 0; tick < 2 + STARVE_RESYNC_TICKS; tick++) {
      drained.push(timeline.consumeNext()?.ct);
    }
    const last = consumed.at(-1) as number;
    expect(drained).toEqual([last + 1, last + 2, last + 3, undefined, undefined]);
    expect(timeline.resyncs).toBe(0);
    expect(timeline.droppedOldest).toBe(0);
  });

  it.each([
    ['no facing', null, 1],
    ['the held facing', 0, 1],
    ['a new facing', 'turning', 0],
  ])(
    'hands a grown tick back only when the skipped frame carries %s',
    (_label, facing, shrinks) => {
      const { timeline, nextCt } = grownTimeline();
      const frameAt = (ct: number) =>
        facing === 'turning' ? idleFrame(ct, ct / 10) : idleFrame(ct, facing as number | null);
      consumeWithSpareFrame(timeline, nextCt, PLAYOUT_SHRINK_SPARE_TICKS * 2, frameAt, true);

      expect(timeline.playoutShrinks).toBe(shrinks);
    },
  );

  it('keeps a grown tick while the body moves', () => {
    const { timeline, nextCt } = grownTimeline();
    consumeWithSpareFrame(timeline, nextCt, PLAYOUT_SHRINK_SPARE_TICKS * 2, idleFrame, false);

    expect(timeline.playoutShrinks).toBe(0);
  });

  it.each(Object.keys(emptyMoveInput()).map((key) => [key]))(
    'keeps a grown tick while the move input carries %s',
    (key) => {
      const { timeline, nextCt } = grownTimeline();
      const mi = { ...emptyMoveInput(), [key]: key === 'gliderPitch' ? 0 : true } as MoveInput;
      const frameAt = (ct: number) => ({ ct, mi, facing: 0 });
      consumeWithSpareFrame(timeline, nextCt, PLAYOUT_SHRINK_SPARE_TICKS * 2, frameAt, true);

      expect(timeline.playoutShrinks).toBe(0);
    },
  );

  it('treats the zero swim steer real clients send at rest as idle input', () => {
    const { timeline, nextCt } = grownTimeline();
    const frameAt = (ct: number) => ({ ct, mi: { ...emptyMoveInput(), swimSteer: 0 }, facing: 0 });
    consumeWithSpareFrame(timeline, nextCt, PLAYOUT_SHRINK_SPARE_TICKS * 2, frameAt, true);

    expect(timeline.playoutShrinks).toBe(1);
  });

  it('keeps a grown tick when either the consumed or the skipped tick moves', () => {
    const { timeline, nextCt } = grownTimeline();
    const alternating = (ct: number) => ({
      ct,
      mi: { ...emptyMoveInput(), forward: ct % 2 === 1 },
      facing: 0,
    });
    consumeWithSpareFrame(timeline, nextCt, PLAYOUT_SHRINK_SPARE_TICKS * 2, alternating, true);

    expect(timeline.playoutShrinks).toBe(0);
  });

  it('restarts the spare count whenever the next frame is not yet buffered', () => {
    const { timeline, nextCt } = grownTimeline();
    let ct = nextCt;
    timeline.enqueue(frame(ct));
    for (let tick = 0; tick < PLAYOUT_SHRINK_SPARE_TICKS * 2; tick++) {
      if (tick % (PLAYOUT_SHRINK_SPARE_TICKS - 1) === 0) {
        timeline.consumeNext(true);
        timeline.enqueue(frame(++ct));
        continue;
      }
      timeline.enqueue(frame(++ct));
      timeline.consumeNext(true);
    }

    expect(timeline.playoutShrinks).toBe(0);
  });

  it('never hands back margin the playout did not grow', () => {
    const timeline = new MovementInputTimeline();
    consumeWithSpareFrame(timeline, 0, PLAYOUT_SHRINK_SPARE_TICKS * 2, idleFrame, true);

    expect(timeline.playoutShrinks).toBe(0);
  });

  it.each([
    ['still', null, 1],
    ['moving along x', 'x', 0],
    ['moving along y', 'y', 0],
    ['moving along z', 'z', 0],
  ])('judges rest from the previous tick: a body %s', (_label, axis, shrinks) => {
    const grown = grownTimeline();
    const { session, entity, sim } = lightweightV2Session(grown.timeline);
    const timeline = session.movementTimeline;
    timeline.enqueue(idleFrame(grown.nextCt));
    for (let ct = grown.nextCt + 1; ct <= grown.nextCt + PLAYOUT_SHRINK_SPARE_TICKS * 2; ct++) {
      timeline.enqueue(idleFrame(ct));
      consumeMovementFramesV2(sim as never, [session]);
      if (axis) entity.pos[axis as 'x' | 'y' | 'z'] += 0.1;
    }

    expect(timeline.playoutShrinks).toBe(shrinks);
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
    session.bodyPosAtLastConsume.x = 0;

    resetMovementInputSessionState(session, 2);
    expect(session.lastConsumedCt).toBe(-1);
    expect(session.bodyPosAtLastConsume.x).toBeNaN();
    expect(session.movementTimeline?.enqueue(frame(0, true))).toBe(true);
    expect(session.movementTimeline?.consumeNext()).toEqual(frame(0, true));
    expect(session.movementTimeline?.starved).toBe(0);
  });
});
