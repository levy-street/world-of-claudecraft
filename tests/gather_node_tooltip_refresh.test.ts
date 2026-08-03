// @vitest-environment happy-dom
//
// The hover tooltip's countdown clock (the phase 14 QA): the paint used to
// be pointer-gated, so a stationary hover froze the m:ss line and a node
// turning ready under the cursor kept reading "Respawns in ...". This
// drives the real attachGatherNodeHoverTooltip over jsdom fake timers: the
// shown cooldown tip re-reads the world at RESPAWN_TICK_MS without any
// pointer movement, flips to Ready live, and disposes its timer on hide.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import {
  attachGatherNodeHoverTooltip,
  RESPAWN_TICK_MS,
} from '../src/ui/gather_node_tooltip_controller';
import type { IWorld } from '../src/world_api';

const NODE = GATHER_NODES[0];

function fakeWorld(state: { harvestable: boolean; respawn: number | null }): IWorld {
  return {
    player: {
      pos: { x: NODE.pos.x, z: NODE.pos.z },
      dead: false,
      inCombat: false,
      castingAbility: null,
      eating: null,
      drinking: null,
      auras: [],
    },
    bags: [null, null, null, null],
    inventory: [],
    gatheringProficiency: {},
    toolEffectSlots: [],
    nodeHarvestableByMe: () => state.harvestable,
    nodeRespawnSeconds: () => state.respawn,
  } as unknown as IWorld;
}

function hoverAt(canvas: HTMLElement): void {
  const ev = new Event('pointermove') as Event & {
    pointerType: string;
    clientX: number;
    clientY: number;
  };
  ev.pointerType = 'mouse';
  ev.clientX = 40;
  ev.clientY = 40;
  canvas.dispatchEvent(ev);
}

describe('the cooldown tooltip ticks without pointer movement', () => {
  beforeEach(() => {
    // performance is faked with the timers: the pointermove throttle reads
    // performance.now, and the two hovers below must both clear it.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    });
    // Step past the throttle window so the FIRST hover paints (lastPickAt
    // starts 0, and a faked clock also starts 0).
    vi.advanceTimersByTime(200);
    document.body.innerHTML = '<div id="tooltip"></div><div id="cv"></div>';
    // jsdom leaves pointerLockElement undefined, which the handler's
    // `!== null` mouselook gate reads as locked; pin it to the unlocked
    // browser value.
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains the countdown, flips to Ready, and stops ticking on hide', () => {
    const state: { harvestable: boolean; respawn: number | null } = {
      harvestable: false,
      respawn: 125,
    };
    const canvas = document.getElementById('cv') as HTMLElement;
    const tooltip = document.getElementById('tooltip') as HTMLElement;
    let hidden = 0;
    attachGatherNodeHoverTooltip(
      canvas,
      fakeWorld(state),
      {
        hideTooltip: () => {
          hidden++;
        },
      },
      () => NODE.id,
      () => null,
      () => false,
    );

    hoverAt(canvas);
    expect(tooltip.innerHTML).toContain('2:05');

    // The still-cursor tick: the world moved, the pointer did not.
    state.respawn = 124;
    vi.advanceTimersByTime(RESPAWN_TICK_MS);
    expect(tooltip.innerHTML).toContain('2:04');

    // The ready flip, still without a pointer event.
    state.harvestable = true;
    state.respawn = null;
    vi.advanceTimersByTime(RESPAWN_TICK_MS);
    expect(tooltip.innerHTML).toContain('Ready');

    // A ready tip arms no clock: nothing repaints from here on.
    const painted = tooltip.innerHTML;
    state.harvestable = false;
    state.respawn = 60;
    vi.advanceTimersByTime(RESPAWN_TICK_MS * 3);
    expect(tooltip.innerHTML).toBe(painted);

    // Hide disposes the timer whole: re-cool the node, hover, leave, and no
    // late tick repaints or throws after the dismissal.
    hoverAt(canvas);
    expect(tooltip.innerHTML).toContain('1:00');
    canvas.dispatchEvent(new Event('pointerleave'));
    expect(hidden).toBe(1);
    const afterHide = tooltip.innerHTML;
    vi.advanceTimersByTime(RESPAWN_TICK_MS * 3);
    expect(tooltip.innerHTML).toBe(afterHide);
  });
});
