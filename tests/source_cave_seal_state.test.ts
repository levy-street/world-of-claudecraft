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
  it('maps gathering population to a clamped gradual blue-energy fraction', () => {
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

  it('returns to an unpowered neutral seal after clear', () => {
    expect(sourceCaveSealVisualState(info('cleared', 10, 10))).toMatchObject({
      mode: 'cleared',
      occupancy: 0,
      energy: 0,
      pulseSpeed: 0,
      flowDirection: 0,
    });
  });
});
