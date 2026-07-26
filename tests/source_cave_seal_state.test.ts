import { describe, expect, it } from 'vitest';
import { sourceCaveSealVisualState } from '../src/render/source_cave_seal_state';
import type { SourceCaveInfo, SourceCaveSealState } from '../src/world_api';

function info(sealState: SourceCaveSealState, inside: number, total: number): SourceCaveInfo {
  return {
    moduleCount: 1,
    modules: ['source_cave_arena'],
    mobs: [],
    totalMobs: 0,
    killed: 0,
    cleared: sealState === 'cleared',
    sealState,
    playersInsideSeal: inside,
    playersInInstance: total,
    activeWave: 0,
    totalWaves: 6,
  };
}

describe('source cave seal visual state', () => {
  it('maps gathering population to a clamped gradual charge fraction', () => {
    expect(sourceCaveSealVisualState(info('idle', 0, 10)).occupancy).toBe(0);
    expect(sourceCaveSealVisualState(info('idle', 1, 10)).occupancy).toBe(0.1);
    expect(sourceCaveSealVisualState(info('idle', 5, 10)).energy).toBe(0.5);
    expect(sourceCaveSealVisualState(info('idle', 10, 10)).energy).toBe(1);
    expect(sourceCaveSealVisualState(info('idle', 12, 10)).occupancy).toBe(1);
  });

  it('uses a slow inward dark-red flow while intact and a fast outward latched breach', () => {
    expect(sourceCaveSealVisualState(info('active', 10, 10))).toMatchObject({
      mode: 'active',
      pulseSpeed: 0.65,
      flowDirection: -1,
    });
    expect(sourceCaveSealVisualState(info('breached', 10, 10))).toMatchObject({
      mode: 'breached',
      energy: 1,
      pulseSpeed: 5.5,
      flowDirection: 1,
    });
  });

  it('lights the containment rim only while the seal is intact and holding', () => {
    // The animated luminous perimeter is the do-not-cross hint: on for the whole
    // contained phase, off before the reboot, after a breach (the flare already
    // says it), and after the clear.
    expect(sourceCaveSealVisualState(info('active', 10, 10)).boundaryGlow).toBe(1);
    expect(sourceCaveSealVisualState(info('idle', 10, 10)).boundaryGlow).toBe(0);
    expect(sourceCaveSealVisualState(info('breached', 10, 10)).boundaryGlow).toBe(0);
    expect(sourceCaveSealVisualState(info('cleared', 10, 10)).boundaryGlow).toBe(0);
  });

  it('leaves a live wreck after the clear, not a dead disc', () => {
    // Clearing this room is vandalism, not a repair. The seal must stay visibly
    // broken AND still animating: energy scales the surviving circuit traces and
    // pulseSpeed drives the boot sweep that keeps failing. Both at zero (the old
    // behavior) rendered pure dark stone, which said nothing at all.
    const wreck = sourceCaveSealVisualState(info('cleared', 10, 10));
    expect(wreck.mode).toBe('cleared');
    expect(wreck.energy).toBeGreaterThan(0);
    // pulseSpeed is the rim's breathing rate in rad/s. It has to stay slow
    // enough that the ease-in/out swell can never read as a flash: one cycle is
    // 2*PI/pulseSpeed seconds, and anything under ~1 Hz is far below the
    // photosensitivity threshold.
    expect(wreck.pulseSpeed).toBeGreaterThan(0);
    expect((2 * Math.PI) / wreck.pulseSpeed).toBeGreaterThan(1);
    // The wreck has no flow left to direct; the shader's wreck branch reads none.
    expect(wreck.flowDirection).toBe(0);
    // Dimmer than the fight it followed: the chest beacon is the room's light now.
    expect(wreck.energy).toBeLessThan(sourceCaveSealVisualState(info('breached', 10, 10)).energy);
    // Occupancy is meaningless once the encounter is over: the disc must not
    // brighten or dim as the raid walks off it to loot.
    expect(wreck.occupancy).toBe(0);
    expect(sourceCaveSealVisualState(info('cleared', 0, 10))).toEqual(wreck);
  });
});
