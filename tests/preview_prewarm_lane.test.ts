import { describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { createPreviewPrewarmLane } from '../src/render/preview_prewarm_lane';

interface RunCall {
  label: string;
  priority: number;
  releaseTail: boolean | undefined;
}

function harness() {
  const calls: RunCall[] = [];
  const order: string[] = [];
  let idleSlots = 0;
  const lane = createPreviewPrewarmLane({
    idleSlot: () => {
      idleSlots++;
      return Promise.resolve();
    },
    run: (unit, priority, label, options) => {
      calls.push({ label, priority, releaseTail: options?.releaseTail });
      order.push(`start:${label}`);
      return Promise.resolve(unit()).then(() => {
        order.push(`end:${label}`);
      });
    },
  });
  return { lane, calls, order, idleSlots: () => idleSlots };
}

describe('preview prewarm lane', () => {
  it('runs scheduled work at BACKGROUND with a released tail', async () => {
    const h = harness();
    await h.lane.queueScheduled('scheduled', () => {});
    expect(h.calls[0]).toMatchObject({
      priority: GPU_WORK_PRIORITY.BACKGROUND,
      // Pinned as the value the lane SHIPS, not as a considered one: a preview
      // unit does real main-thread work in its tail, so the released tail is a
      // known misdeclaration the module header names and explains. Flipping it
      // needs the queue's waitedOnTailCap readout, not an edit to this pin.
      releaseTail: true,
    });
  });

  it('serialises scheduled units and takes an idle slot before each', async () => {
    const h = harness();
    const first = h.lane.queueScheduled('a', () => {});
    const second = h.lane.queueScheduled('b', () => {});
    await Promise.all([first, second]);
    expect(h.order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
    expect(h.idleSlots()).toBe(2);
  });

  it('keeps the scheduled lane draining past a failed unit', async () => {
    const h = harness();
    const boom = h.lane.queueScheduled('boom', () => {
      throw new Error('unit failed');
    });
    const after = h.lane.queueScheduled('after', () => {});
    // The rejection reaches the CALLER, which is how a caller learns its own
    // unit failed, and the lane still advances.
    await expect(boom).rejects.toThrow('unit failed');
    await after;
    expect(h.order).toContain('end:after');
  });
});
