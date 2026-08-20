// The compile gate's touch tail as budgeted PIECES
// (src/render/linked_program_touch_lane.ts): one queue unit per linked program
// instead of one unit for the whole target, which is what lets a per-frame
// admission let two through in a frame with headroom and none in a frame
// without.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';
import { markProgramReady } from '../src/render/linked_program_readiness';
import type { LinkedProgramLike, MaterialPropertiesLike } from '../src/render/linked_program_touch';
import {
  LINKED_PROGRAM_TOUCH_LABEL,
  type LinkedProgramTouchQueue,
  linkedProgramTouchPriority,
  PREVIEW_LINKED_PROGRAM_TOUCH_LABEL,
  runLinkedProgramTouchLane,
  runWorldGateTouchLane,
  TOUCH_UNPROVEN_UNSETTLED_SUFFIX,
  touchUnprovenLabel,
} from '../src/render/linked_program_touch_lane';

interface RecordedUnit {
  priority: number | undefined;
  label: string | undefined;
}

function stubQueue(): LinkedProgramTouchQueue & {
  units: RecordedUnit[];
  order: string[];
} {
  const units: RecordedUnit[] = [];
  const order: string[] = [];
  return {
    units,
    order,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      units.push({ priority, label });
      order.push(`start:${units.length}`);
      const value = work();
      order.push(`end:${units.length}`);
      return Promise.resolve(value);
    },
  };
}

// The lane's readiness comes from the SETTLE it is the tail of, never from
// three: a program whose readiness three cached false re-issues a
// COMPLETION_STATUS query on every isReady(), and one of those blocked a live
// main thread 5.6 s in production. Every stub here throws from isReady so a
// single driver question fails the suite outright.
function program(): LinkedProgramLike & {
  isReady: () => never;
  uniforms: ReturnType<typeof vi.fn>;
} {
  const uniforms = vi.fn();
  return {
    isReady: () => {
      throw new Error('the touch lane must never query the driver for readiness');
    },
    getUniforms: uniforms,
    getAttributes: vi.fn(),
    uniforms,
  };
}

/** One material under the target: every linked variant three keeps for it, and
 *  the variant a settled compile resolved to (three's `currentProgram`). */
interface MaterialSpec {
  programs: Map<string, LinkedProgramLike>;
  current?: LinkedProgramLike;
}

function targetWith(...materials: MaterialSpec[]): {
  properties: MaterialPropertiesLike;
  target: THREE.Object3D;
} {
  const records = new Map<THREE.Material, MaterialSpec>();
  const target = new THREE.Group();
  for (const spec of materials) {
    const material = new THREE.MeshStandardMaterial({ name: `body${records.size}` });
    records.set(material, spec);
    target.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  }
  return {
    properties: {
      get: (queried) => {
        const spec = records.get(queried as THREE.Material);
        return { programs: spec?.programs, currentProgram: spec?.current };
      },
    },
    target,
  };
}

/** The ordinary case: one material, one settled variant. */
const settledMaterial = (variant: LinkedProgramLike, key = 'skinned'): MaterialSpec => ({
  programs: new Map([[key, variant]]),
  current: variant,
});

describe('runLinkedProgramTouchLane', () => {
  it('issues one labelled unit per ready program, at the tail-piece priority, one at a time', async () => {
    const first = program();
    const second = program();
    const linking = program();
    const { properties, target } = targetWith(
      {
        // still linking: it is no material's settled variant, so nothing ever
        // proved it ready, and touching it would block on the link, which is
        // the stall the gate exists to move off the frame
        programs: new Map([
          ['skinned', first],
          ['pending', linking],
        ]),
        current: first,
      },
      settledMaterial(second, 'far'),
    );
    const queue = stubQueue();

    await expect(runLinkedProgramTouchLane(queue, properties, target, 30)).resolves.toBe(2);

    // A LIVE_VIEW gate's pieces ride BELOW every link submission (TAIL_PIECE):
    // a cheap prologue that starts async driver work goes ahead of a piece
    // that only finishes one.
    expect(queue.units).toEqual([
      { priority: GPU_WORK_PRIORITY.TAIL_PIECE, label: LINKED_PROGRAM_TOUCH_LABEL },
      { priority: GPU_WORK_PRIORITY.TAIL_PIECE, label: LINKED_PROGRAM_TOUCH_LABEL },
    ]);
    // sequential: the pieces are main-thread work, so overlapping them would
    // only make one frame carry several driver round trips
    expect(queue.order).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
    expect(first.uniforms).toHaveBeenCalledTimes(1);
    expect(second.uniforms).toHaveBeenCalledTimes(1);
    expect(linking.uniforms).not.toHaveBeenCalled();
  });

  it('collects once up front, so a piece admitted later never re-touches an earlier one', async () => {
    const touched = program();
    const { properties, target } = targetWith(settledMaterial(touched));
    const walks: unknown[] = [];
    const counting: MaterialPropertiesLike = {
      get: (material) => {
        walks.push(material);
        return properties.get(material);
      },
    };

    await runLinkedProgramTouchLane(stubQueue(), counting, target, 20);

    // One material, read twice: the settle's marking walk, then the collect
    // walk. Neither repeats per piece.
    expect(walks).toHaveLength(2);
    expect(touched.uniforms).toHaveBeenCalledTimes(1);
  });

  it('queues nothing for a target with no linked programs', async () => {
    const queue = stubQueue();
    const { properties, target } = targetWith({ programs: new Map() });

    await expect(runLinkedProgramTouchLane(queue, properties, target, 20)).resolves.toBe(0);

    expect(queue.units).toEqual([]);
  });

  it('stops the lane when a piece rejects, rather than warming past a dead context', async () => {
    const { properties, target } = targetWith(
      settledMaterial(program(), 'a'),
      settledMaterial(program(), 'b'),
    );
    const failing: LinkedProgramTouchQueue = {
      run: () => Promise.reject(new Error('queue shut down')),
    };

    await expect(runLinkedProgramTouchLane(failing, properties, target, 20)).rejects.toThrow(
      'queue shut down',
    );
  });

  it('marks the target as linked on a SETTLED gate, then warms what it marked', async () => {
    const linked = program();
    const { properties, target } = targetWith(settledMaterial(linked));
    const queue = stubQueue();

    // settled defaults to true: the tail of a compile that resolved.
    await expect(runLinkedProgramTouchLane(queue, properties, target, 20)).resolves.toBe(1);

    expect(linked.uniforms).toHaveBeenCalledTimes(1);
  });

  it('marks NOTHING when the gate did not settle, and warms only what an earlier settle proved', async () => {
    // A timed-out gate's compile is still running on the driver: it proved
    // nothing, and claiming it did is how a program nobody linked would be
    // touched (which blocks on the link, the stall the gate exists to avoid).
    const unproven = program();
    const first = targetWith(settledMaterial(unproven));
    const timedOut = stubQueue();

    await expect(
      runLinkedProgramTouchLane(timedOut, first.properties, first.target, 20, { settled: false }),
    ).resolves.toBe(0);
    expect(timedOut.units).toEqual([]);
    expect(unproven.uniforms).not.toHaveBeenCalled();

    // Once a settle over the same target has proved it, a later unsettled tail
    // may warm it: the record is what changed, not the gate.
    await runLinkedProgramTouchLane(stubQueue(), first.properties, first.target, 20);
    const later = stubQueue();

    await expect(
      runLinkedProgramTouchLane(later, first.properties, first.target, 20, { settled: false }),
    ).resolves.toBe(1);
    expect(later.units).toHaveLength(1);
    expect(unproven.uniforms).toHaveBeenCalledTimes(2);
  });

  it('reports how many distinct programs the walk skipped as unproven, 0 included', async () => {
    const proven = program();
    const linking = program();
    // the same still-linking program under two materials: one program, counted once
    const { properties, target } = targetWith(
      settledMaterial(proven, 'a'),
      { programs: new Map([['skinned', linking]]) },
      { programs: new Map([['far', linking]]) },
    );
    const seen: number[] = [];

    await runLinkedProgramTouchLane(stubQueue(), properties, target, 20, {
      settled: false,
      onUnproven: (count) => seen.push(count),
    });
    expect(seen).toEqual([2]);
    expect(linking.uniforms).not.toHaveBeenCalled();

    // Once proved, the same walk reports 0 and warms it.
    markProgramReady(proven);
    markProgramReady(linking);
    await runLinkedProgramTouchLane(stubQueue(), properties, target, 20, {
      settled: false,
      onUnproven: (count) => seen.push(count),
    });
    expect(seen).toEqual([2, 0]);
    expect(linking.uniforms).toHaveBeenCalledTimes(1);
  });

  it('keeps the caller label option, so a second context is priced on its own kind', async () => {
    const preview = program();
    const { properties, target } = targetWith(settledMaterial(preview));
    const queue = stubQueue();

    await runLinkedProgramTouchLane(queue, properties, target, GPU_WORK_PRIORITY.ACTIONABLE_VIEW, {
      label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL,
    });

    expect(queue.units).toEqual([
      {
        priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL,
      },
    ]);
    // The label option alone does not change the settle default: the piece ran.
    expect(preview.uniforms).toHaveBeenCalledTimes(1);
  });

  it('keeps an actionable gate pieces at the actionable floor and drops every other gate to TAIL_PIECE', async () => {
    expect(linkedProgramTouchPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).toBe(
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    );
    expect(linkedProgramTouchPriority(GPU_WORK_PRIORITY.LIVE_VIEW)).toBe(
      GPU_WORK_PRIORITY.TAIL_PIECE,
    );
    expect(linkedProgramTouchPriority(GPU_WORK_PRIORITY.VISIBLE_PREWARM)).toBe(
      GPU_WORK_PRIORITY.TAIL_PIECE,
    );
    // Below every link submission, the boot-debt resume included, and above
    // the cosmetic warmers.
    expect(GPU_WORK_PRIORITY.TAIL_PIECE).toBeLessThan(GPU_WORK_PRIORITY.BOOT_DEBT);
    expect(GPU_WORK_PRIORITY.TAIL_PIECE).toBeGreaterThan(GPU_WORK_PRIORITY.BACKGROUND);
    const actionable = program();
    const { properties, target } = targetWith(settledMaterial(actionable));
    const queue = stubQueue();
    await runLinkedProgramTouchLane(queue, properties, target, GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
    expect(queue.units).toEqual([
      { priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW, label: LINKED_PROGRAM_TOUCH_LABEL },
    ]);
  });
});

describe('runWorldGateTouchLane', () => {
  it('never marks at the walk: a settled gate warms only what a poll proved, and records the rest', async () => {
    resetGpuPrepEventsForTest();
    // The shared-material race the walk mark used to lose: the material's
    // current program is a variant nobody proved (another gate's link still in
    // flight, or a released program relinked under the same key).
    const relinked = program();
    const { properties, target } = targetWith(settledMaterial(relinked));
    target.name = 'Group:7';
    const queue = stubQueue();

    await expect(
      runWorldGateTouchLane(queue, properties, target, 20, { failed: false, timedOut: false }),
    ).resolves.toBe(0);
    expect(queue.units).toEqual([]);
    expect(relinked.uniforms).not.toHaveBeenCalled();
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['touch-unproven']).toBe(1);
    expect(snapshot.events[0]).toMatchObject({ kind: 'touch-unproven', key: 'Group:7', units: 1 });

    // Proved by a poll (the piece's settle arm), the same tail warms it and
    // records nothing: zero unproven is not an event.
    markProgramReady(relinked);
    await expect(
      runWorldGateTouchLane(stubQueue(), properties, target, 20, {
        failed: false,
        timedOut: false,
      }),
    ).resolves.toBe(1);
    expect(relinked.uniforms).toHaveBeenCalledTimes(1);
    expect(gpuPrepEventsSnapshot().counts['touch-unproven']).toBe(1);
  });

  it('keys an unnamed target by its render category, so live entity gates stay attributable', async () => {
    resetGpuPrepEventsForTest();
    const { properties, target } = targetWith(settledMaterial(program()));
    // A live entity gate's group is never named, only categorised.
    target.name = '';
    target.userData.renderCategory = 'entity:mob';
    expect(touchUnprovenLabel(target)).toBe('entity:mob');
    expect(touchUnprovenLabel(new THREE.Group())).toBe('Group');

    await runWorldGateTouchLane(stubQueue(), properties, target, 20, {
      failed: false,
      timedOut: false,
    });
    expect(gpuPrepEventsSnapshot().events[0]).toMatchObject({
      kind: 'touch-unproven',
      key: 'entity:mob',
      units: 1,
    });
    resetGpuPrepEventsForTest();
  });

  it('keys an unsettled gate apart, where unproven programs are expected', async () => {
    resetGpuPrepEventsForTest();
    const { properties, target } = targetWith(settledMaterial(program()));
    target.name = 'fenbridgeBuilding';

    await runWorldGateTouchLane(stubQueue(), properties, target, 20, {
      failed: false,
      timedOut: true,
    });
    expect(gpuPrepEventsSnapshot().events[0]).toMatchObject({
      kind: 'touch-unproven',
      key: `fenbridgeBuilding${TOUCH_UNPROVEN_UNSETTLED_SUFFIX}`,
      units: 1,
    });
    resetGpuPrepEventsForTest();
  });
});
