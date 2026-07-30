import { describe, expect, it } from 'vitest';
import { TELEPORT_DISPLACEMENT_YD, zoneWarmupMode } from '../src/game/zone_transition';

describe('zone transition warmup policy', () => {
  it('a walked crossing warms up in the background', () => {
    expect(zoneWarmupMode(0)).toBe('background');
    expect(zoneWarmupMode(0.7)).toBe('background');
    // A stalled 250ms frame at full sprint is still a walk, not a teleport.
    expect(zoneWarmupMode(14 * 0.25)).toBe('background');
    expect(zoneWarmupMode(TELEPORT_DISPLACEMENT_YD)).toBe('background');
  });

  it('a teleport-sized jump keeps the blocking loading screen', () => {
    expect(zoneWarmupMode(TELEPORT_DISPLACEMENT_YD + 0.1)).toBe('blocking');
    expect(zoneWarmupMode(500)).toBe('blocking');
  });

  it('the threshold clears any legitimate movement speed with margin', () => {
    // Fastest sustained locomotion is ~14 yd/s; even a 1s frame stall moves
    // less than the threshold plus its safety margin.
    expect(TELEPORT_DISPLACEMENT_YD).toBeGreaterThan(14);
  });
});
