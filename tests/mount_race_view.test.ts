// Pure-core tests for the show-jumping race bottom strip view model
// (src/ui/mount_race_view.ts): same-input-same-output over both world shapes
// (the Sim view and the ClientWorld mirror produce the same MountRaceView
// record, so one fixture covers both), the idle model, the countdown conversion,
// and the repaint signature's second-bucketing.

import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/sim/types';
import { mountRaceRenderModel, mountRaceRenderSig } from '../src/ui/mount_race_view';
import type { MountRaceView } from '../src/world_api';

function view(overrides: Partial<MountRaceView> = {}): MountRaceView {
  return {
    raceId: 'race_1_100',
    phase: 'racing',
    clearedMask: 0,
    cleared: 0,
    jumpsTotal: 7,
    goTicksLeft: 0,
    ticksLeft: 300,
    timeLimitTicks: 500,
    ...overrides,
  };
}

describe('mountRaceRenderModel', () => {
  it('maps null (not racing) to the shared idle model instance', () => {
    const a = mountRaceRenderModel(null);
    const b = mountRaceRenderModel(null);
    expect(a.active).toBe(false);
    expect(a).toBe(b);
  });

  it('is idle during the countdown (the center-screen element owns that phase)', () => {
    const m = mountRaceRenderModel(view({ phase: 'countdown', goTicksLeft: 40 }));
    expect(m.active).toBe(false);
  });

  it('exposes only ceiled whole seconds and a bar fraction', () => {
    const m = mountRaceRenderModel(view({ ticksLeft: 301, timeLimitTicks: 500 }));
    expect(m.active).toBe(true);
    expect(Object.keys(m).sort()).toEqual(['active', 'secondsLeft', 'timeFraction'].sort());
    expect(m.secondsLeft).toBe(Math.ceil(301 / TICK_RATE));
    expect(m.timeFraction).toBeCloseTo(301 / 500, 6);
    // Clamped at both ends.
    expect(mountRaceRenderModel(view({ ticksLeft: 0 })).timeFraction).toBe(0);
    expect(mountRaceRenderModel(view({ ticksLeft: 999, timeLimitTicks: 500 })).timeFraction).toBe(
      1,
    );
  });
});

describe('mountRaceRenderSig', () => {
  it('is stable within the same displayed second and changes across seconds', () => {
    // 300/20 = 15 exactly; 299/20 = 14.95 -> ceil 15. Same bucket.
    expect(mountRaceRenderSig(view({ ticksLeft: 300 }))).toBe(
      mountRaceRenderSig(view({ ticksLeft: 299 })),
    );
    expect(mountRaceRenderSig(view({ ticksLeft: 300 }))).not.toBe(
      mountRaceRenderSig(view({ ticksLeft: 280 })),
    );
  });

  it('ignores gate progress but changes on the phase flip and a new race', () => {
    expect(mountRaceRenderSig(view({ cleared: 1 }))).toBe(mountRaceRenderSig(view({ cleared: 2 })));
    expect(mountRaceRenderSig(view({ phase: 'countdown' }))).not.toBe(
      mountRaceRenderSig(view({ phase: 'racing' })),
    );
    expect(mountRaceRenderSig(view({ raceId: 'race_1_100' }))).not.toBe(
      mountRaceRenderSig(view({ raceId: 'race_1_900' })),
    );
  });
});
