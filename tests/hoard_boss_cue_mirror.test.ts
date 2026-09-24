import { describe, expect, it } from 'vitest';
import { HoardBossCueMirror } from '../src/net/hoard_boss_cue_mirror';
import type { SimEvent } from '../src/sim/types';

function warning(overrides: Partial<Extract<SimEvent, { type: 'hoardBossCue' }>> = {}): SimEvent {
  return {
    type: 'hoardBossCue',
    pid: 7,
    instanceId: 12,
    cueId: 3,
    kind: 'mark',
    phase: 'warning',
    x: 4,
    z: 8,
    radius: 3,
    durationSecs: 2,
    ...overrides,
  };
}

describe('Buried Hoard boss cue mirror', () => {
  it('round trips wave geometry and following static targets through JSON events and reconnect', () => {
    let now = 1000;
    const mirror = new HoardBossCueMirror(() => now);
    const event = warning({
      kind: 'sweep',
      variant: 'tide-wave',
      waveGap: -4,
      waveSpan: 15,
      waveLead: 4.925,
      durationSecs: 8.925,
      facing: Math.PI / 2,
    });
    mirror.apply(JSON.parse(JSON.stringify(event)));
    now += 500;
    expect(mirror.views()[0]).toMatchObject({
      waveGap: -4,
      waveSpan: 15,
      waveLead: 4.925,
      remaining: 8.425,
    });
    const resumed = mirror.views();
    mirror.apply({ type: 'riftState', active: true, hoardCues: resumed } as Extract<
      SimEvent,
      { type: 'riftState' }
    >);
    expect(mirror.views()[0]).toMatchObject({
      waveGap: -4,
      waveSpan: 15,
      waveLead: 4.925,
      remaining: 8.425,
    });
    mirror.apply(warning({ variant: 'storm-static', targetId: 42 }));
    expect(mirror.views()[0]).toMatchObject({ variant: 'storm-static', targetId: 42 });
  });

  it('counts events down and replaces a warning with its hazard phase', () => {
    let now = 1_000;
    const mirror = new HoardBossCueMirror(() => now);
    mirror.apply(warning());
    now += 500;
    expect(mirror.views()[0]).toMatchObject({ remaining: 1.5, phase: 'warning' });
    mirror.apply(warning({ phase: 'hazard' }));
    expect(mirror.views()).toHaveLength(1);
    expect(mirror.views()[0].phase).toBe('hazard');
    now += 2_001;
    expect(mirror.views()).toEqual([]);
  });

  it('preserves mechanic identity and safe inner radius across the online mirror', () => {
    const mirror = new HoardBossCueMirror(() => 1_000);
    mirror.apply(
      warning({ variant: 'frost-ring', radius: 8.5, innerRadius: 4.5, durationSecs: 2.2 }),
    );
    expect(mirror.views()[0]).toMatchObject({
      variant: 'frost-ring',
      radius: 8.5,
      innerRadius: 4.5,
      remaining: 2.2,
    });
  });

  it('hydrates active cues from a resumed rift state and clears them', () => {
    let now = 5_000;
    const mirror = new HoardBossCueMirror(() => now);
    mirror.apply({
      type: 'riftState',
      pid: 7,
      active: true,
      eventId: null,
      instanceId: 12,
      seed: 1,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 1,
      origin: { x: 0, z: 0 },
      contentId: 'hoard',
      contentHash: 'hoard',
      upgrade: null,
      name: 'Hoard',
      themeName: 'Valley',
      tier: null,
      expiresAtMs: null,
      hoardCues: [
        {
          instanceId: 12,
          cueId: 9,
          kind: 'mark',
          variant: 'frost-ring',
          phase: 'warning',
          x: 2,
          z: 3,
          radius: 13,
          remaining: 0.8,
          total: 1.45,
          facing: 1,
          halfAngle: 0.7,
          innerRadius: 4.5,
        },
      ],
    });
    now += 300;
    expect(mirror.views()[0]).toMatchObject({
      cueId: 9,
      variant: 'frost-ring',
      innerRadius: 4.5,
      remaining: 0.5,
      total: 1.45,
    });
    mirror.apply({ type: 'hoardBossCueClear', pid: 7 });
    expect(mirror.views()).toEqual([]);
  });
});
