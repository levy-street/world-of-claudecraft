import { describe, expect, it } from 'vitest';
import {
  DrainChannelStopLatch,
  drainChannelVisualPlan,
} from '../src/render/drain_channel_visual_core';

describe('Drain Life persistent visual plan', () => {
  it('reconstructs a live beam from replicated channel state', () => {
    expect(
      drainChannelVisualPlan({
        id: 7,
        castingAbility: 'drain_life',
        channeling: true,
        castTargetId: 41,
        castRemaining: 3.25,
        dead: false,
        auras: [],
      }),
    ).toEqual({ targetId: 41, duration: 3.25, demonic: false });
  });

  it('adds a second beam from the companion Eye to the drained target', () => {
    const caster = {
      id: 7,
      castingAbility: 'drain_life',
      channeling: true,
      castTargetId: 41,
      castRemaining: 3.25,
      dead: false,
      auras: [
        {
          id: 'possess_evil_eye',
          name: 'Possess the Evil Eye',
          kind: 'affliction_possession' as const,
          remaining: 8,
          duration: 10,
          value: 1,
          sourceId: 7,
          school: 'shadow' as const,
        },
      ],
    };
    expect(drainChannelVisualPlan(caster)).toEqual({
      targetId: 41,
      duration: 3.25,
      demonic: true,
    });
  });

  it('rejects stopped, dead, targetless, and unrelated channels', () => {
    const base = {
      id: 7,
      castingAbility: 'drain_life',
      channeling: true,
      castTargetId: 41,
      castRemaining: 3.25,
      dead: false,
      auras: [],
    };
    expect(drainChannelVisualPlan({ ...base, channeling: false })).toBeNull();
    expect(drainChannelVisualPlan({ ...base, dead: true })).toBeNull();
    expect(drainChannelVisualPlan({ ...base, castTargetId: null })).toBeNull();
    expect(drainChannelVisualPlan({ ...base, castingAbility: 'mind_flay' })).toBeNull();
  });
});

describe('Drain Life remote stop reconciliation', () => {
  it('blocks stale active snapshots until a stopped snapshot is observed', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);

    expect(latch.allowsSnapshot(7, 41, 1.1)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, null, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.3)).toBe(true);
  });

  it('keeps a newer target-scoped start authoritative until its matching snapshot arrives', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);
    latch.noteEvent(7, 52, 5, 1.01);

    expect(latch.allowsSnapshot(7, 41, 1.1)).toBe(false);
    expect(latch.allowsSnapshot(7, null, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, 52, 1.3)).toBe(true);
    expect(latch.allowsSnapshot(7, 52, 1.31)).toBe(true);
  });

  it('holds a same-target recast over the old snapshot for one replication window', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);
    latch.noteEvent(7, 41, 5, 1.01);

    expect(latch.allowsSnapshot(7, 41, 1.1)).toBe(false);
    expect(latch.allowsSnapshot(7, null, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.21)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.27)).toBe(true);
  });

  it('accepts a different active target as newer if its positive start cue was dropped', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);

    expect(latch.allowsSnapshot(7, 52, 1.1)).toBe(true);
    expect(latch.allowsSnapshot(7, 41, 1.2)).toBe(true);
  });

  it('reconciles a same-target active snapshot after a filtered recast start', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);

    expect(latch.allowsSnapshot(7, 41, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.26)).toBe(true);
  });

  it('reconciles an idle snapshot after the start cue window if its stop cue was filtered', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 5, 1);

    expect(latch.allowsSnapshot(7, null, 1.2)).toBe(false);
    expect(latch.allowsSnapshot(7, null, 1.26)).toBe(false);
    expect(latch.allowsSnapshot(7, 41, 1.27)).toBe(true);
  });

  it('prunes only sources that disappeared, independent of view churn', () => {
    const latch = new DrainChannelStopLatch();
    latch.noteEvent(7, 41, 0, 1);
    latch.prune(new Map<number, unknown>([[7, {}]]));
    expect(latch.allowsSnapshot(7, 41, 1.2)).toBe(false);

    latch.prune(new Map<number, unknown>());
    expect(latch.allowsSnapshot(7, 41, 1.21)).toBe(true);
  });
});
