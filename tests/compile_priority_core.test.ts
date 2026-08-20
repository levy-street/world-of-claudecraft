import { describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  type CompilePriorityNode,
  castingAtPlayerPredicate,
  compilePriorityForTarget,
} from '../src/render/compile_priority_core';

const node = (
  entityId?: unknown,
  parent: CompilePriorityNode | null = null,
): CompilePriorityNode => ({
  userData: entityId === undefined ? {} : { entityId },
  parent,
});

describe('compilePriorityForTarget', () => {
  it('rides ACTIONABLE_VIEW when the target itself is the player target', () => {
    expect(compilePriorityForTarget(node(7), 7)).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
  });

  it('walks the ancestry: a payload under the targeted entity is actionable', () => {
    const payload = node(undefined, node(undefined, node(7)));
    expect(compilePriorityForTarget(payload, 7)).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
  });

  it('rides LIVE_VIEW for any other entity and for untagged roots', () => {
    expect(compilePriorityForTarget(node(8, node(9)), 7)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(compilePriorityForTarget(node(), 7)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
  });

  it('never matches a null player target against an untagged node', () => {
    expect(compilePriorityForTarget(node(), null)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(compilePriorityForTarget(node(7), null)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
  });

  it('gives a CASTING entity the actionable floor even when it is not targeted', () => {
    // A mob casting at a player who has not targeted it is still something that
    // player reacts to, so its programs cannot ride the background lane and
    // land after the cast bar has drained.
    const casting = (id: number) => id === 8;
    expect(compilePriorityForTarget(node(8), 7, casting)).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
    // ... including a payload hung under the casting entity, same walk.
    const payload = node(undefined, node(undefined, node(8)));
    expect(compilePriorityForTarget(payload, 7, casting)).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
    // ... and with no player target at all.
    expect(compilePriorityForTarget(node(8), null, casting)).toBe(
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    );
  });

  it('leaves a non-casting, non-targeted entity on LIVE_VIEW', () => {
    const casting = (id: number) => id === 8;
    expect(compilePriorityForTarget(node(9), 7, casting)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    // An untagged node is never asked about: the predicate only sees real ids.
    const asked: unknown[] = [];
    expect(
      compilePriorityForTarget(node(undefined, node(9)), 7, (id) => {
        asked.push(id);
        return false;
      }),
    ).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(asked).toEqual([9]);
  });

  it('keeps the old behavior for a caller that passes no cast predicate', () => {
    expect(compilePriorityForTarget(node(8), 7)).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(compilePriorityForTarget(node(7), 7)).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
  });
});

describe('castingAtPlayerPredicate', () => {
  const table = new Map<number, { castingAbility?: string | null; targetId?: number | null }>([
    [1, { castingAbility: 'fireball', targetId: 99 }],
    [2, { castingAbility: 'fireball', targetId: 7 }],
    [3, { castingAbility: null, targetId: 99 }],
  ]);
  const isCasting = castingAtPlayerPredicate((id) => table.get(id), 99);

  it('is true only for a cast aimed at the player', () => {
    // A crowd trading abilities among itself must not become ACTIONABLE:
    // that starved the reveal lane past its watchdog on the iGPU crowd leg.
    expect(isCasting(1)).toBe(true);
    expect(isCasting(2)).toBe(false);
    expect(isCasting(3)).toBe(false);
    expect(isCasting(4)).toBe(false);
  });
});
