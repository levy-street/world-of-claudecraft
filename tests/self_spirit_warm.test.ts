// The self-spirit warm as two GPU queue units with the worker's hold between
// them (src/render/self_spirit_warm.ts): no unit waits for the worker, no
// frame draws the ghost, and a spirit released during the hold keeps its
// ghost look.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { CompileArmHost } from '../src/render/compile_arms';
import {
  SELF_SPIRIT_LINK_LABEL,
  SELF_SPIRIT_WARM_LABEL,
  type SelfSpiritWarmDeps,
  warmSelfSpiritPrograms,
} from '../src/render/self_spirit_warm';
import type { RootWarmRequest } from '../src/render/shader_warm_lane';

const lane = vi.hoisted(() => ({
  request: vi.fn((..._args: unknown[]): RootWarmRequest | null => null),
  hold: vi.fn(async (_request: RootWarmRequest) => ({ warm: true, timedOut: false, holdMs: 0 })),
}));

vi.mock('../src/render/shader_warm_lane', () => ({
  requestRootWarm: (...args: unknown[]) => lane.request(...args),
  holdRootWarm: (request: RootWarmRequest) => lane.hold(request),
}));

/** A warm request as the lane hands it out, answering `warm`. */
const requestOf = (warm: boolean): RootWarmRequest => ({
  warm: Promise.resolve(warm),
  abandon: () => {},
});

afterEach(() => {
  lane.request.mockReset();
  lane.request.mockImplementation(() => null);
  lane.hold.mockClear();
});

interface UnitCall {
  label: string;
  priority: number;
  releaseTail: boolean | undefined;
  settled: boolean;
}

function rig(options: { blocked?: () => boolean; refuseWarmUnit?: boolean } = {}) {
  const events: string[] = [];
  const calls: UnitCall[] = [];
  const root = new THREE.Group();
  const visual = {
    root,
    ghosted: false,
    setGhost(on: boolean) {
      this.ghosted = on;
      events.push(on ? 'ghost:on' : 'ghost:off');
    },
  };
  const deps: SelfSpiritWarmDeps = {
    blocked: options.blocked ?? (() => false),
    visual: () => visual,
    arms: {} as CompileArmHost,
    run: (work, priority, label, runOptions) => {
      const call: UnitCall = {
        label,
        priority,
        releaseTail: runOptions?.releaseTail,
        settled: false,
      };
      calls.push(call);
      events.push(`unit:${label}`);
      if (options.refuseWarmUnit && label === SELF_SPIRIT_WARM_LABEL) {
        return Promise.reject(new Error('the queue is shut'));
      }
      return Promise.resolve()
        .then(work)
        .then((value) => {
          call.settled = true;
          events.push(`settled:${label}`);
          return value;
        });
    },
    link: (linked) => {
      events.push(`link:${linked === root ? 'self' : 'other'}`);
      return Promise.resolve();
    },
    hold: async (warm) => {
      events.push('hold');
      const outcome = await lane.hold(warm);
      events.push('held');
      return outcome;
    },
  };
  return { deps, events, calls, visual };
}

describe('warmSelfSpiritPrograms', () => {
  it('asks in one unit, holds between units, links in a second released-tail unit', async () => {
    lane.request.mockImplementation(() => requestOf(true));
    const { deps, events, calls, visual } = rig();

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(true);

    expect(events).toEqual([
      `unit:${SELF_SPIRIT_WARM_LABEL}`,
      'ghost:on',
      'ghost:off',
      `settled:${SELF_SPIRIT_WARM_LABEL}`,
      'hold',
      'held',
      `unit:${SELF_SPIRIT_LINK_LABEL}`,
      'ghost:on',
      'link:self',
      'ghost:off',
      `settled:${SELF_SPIRIT_LINK_LABEL}`,
    ]);
    expect(calls.map((call) => [call.priority, call.releaseTail])).toEqual([
      [GPU_WORK_PRIORITY.VISIBLE_PREWARM, undefined],
      [GPU_WORK_PRIORITY.VISIBLE_PREWARM, true],
    ]);
    expect(visual.ghosted).toBe(false);
    expect(lane.request).toHaveBeenCalledWith(
      deps.arms,
      visual.root,
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    );
  });

  it('links at once, cold, when there is nothing to hold for (mode off, nothing to warm)', async () => {
    const { deps, events } = rig();

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(true);

    expect(events).not.toContain('hold');
    expect(events.filter((event) => event.startsWith('unit:'))).toEqual([
      `unit:${SELF_SPIRIT_WARM_LABEL}`,
      `unit:${SELF_SPIRIT_LINK_LABEL}`,
    ]);
    expect(events).toContain('link:self');
  });

  it('does nothing while blocked at entry', async () => {
    const { deps, events } = rig({ blocked: () => true });

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(false);

    expect(events).toEqual([]);
  });

  it('leaves a spirit released during the hold ghosted: no second swap, no link', async () => {
    // The guard used to be read once, before a wait that is now hundreds of
    // milliseconds; undoing the swap on a dead player drew one opaque frame.
    let ghost = false;
    lane.request.mockImplementation(() => requestOf(true));
    lane.hold.mockImplementation(async () => {
      ghost = true;
      return { warm: true, timedOut: false, holdMs: 400 };
    });
    const { deps, events, visual } = rig({ blocked: () => ghost });

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(false);

    expect(events.filter((event) => event.startsWith('ghost:'))).toEqual(['ghost:on', 'ghost:off']);
    expect(events).not.toContain(`unit:${SELF_SPIRIT_LINK_LABEL}`);
    expect(events).not.toContain('link:self');
    expect(visual.ghosted).toBe(false);
  });

  it('skips the link when the player died between the hold and the link unit', async () => {
    let ghost = false;
    const { deps, events } = rig({
      blocked: () => {
        // Blocked from the moment the link unit is admitted.
        if (events.includes(`unit:${SELF_SPIRIT_LINK_LABEL}`)) ghost = true;
        return ghost;
      },
    });

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(false);

    expect(events).not.toContain('link:self');
    expect(events.filter((event) => event.startsWith('ghost:'))).toEqual(['ghost:on', 'ghost:off']);
  });

  it('links cold when the queue refuses the warm unit', async () => {
    lane.request.mockImplementation(() => requestOf(true));
    const { deps, events } = rig({ refuseWarmUnit: true });

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(true);

    expect(events).not.toContain('hold');
    expect(events).toContain('link:self');
  });

  it('skips the link when the visual was rebuilt during the hold', async () => {
    lane.request.mockImplementation(() => requestOf(true));
    const { deps, events, visual } = rig();
    let current: typeof visual | null = visual;
    deps.visual = () => current;
    deps.hold = async (warm) => {
      events.push('hold');
      current = { ...visual, root: new THREE.Group() };
      return lane.hold(warm);
    };

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(false);

    expect(events).toContain('hold');
    expect(events).not.toContain('link:self');
    expect(events.filter((event) => event.startsWith('ghost:'))).toEqual(['ghost:on', 'ghost:off']);
  });

  it('does nothing without a self visual', async () => {
    const { deps, events } = rig();
    deps.visual = () => null;

    await expect(warmSelfSpiritPrograms(deps)).resolves.toBe(false);

    expect(events).toEqual([]);
  });
});
