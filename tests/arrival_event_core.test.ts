import { describe, expect, it } from 'vitest';
import { TELEPORT_DISPLACEMENT_YD } from '../src/game/zone_transition';
import {
  ARRIVAL_TELEPORT_DISPLACEMENT_YD,
  createArrivalDetector,
  isTeleportDisplacement,
} from '../src/render/arrival_event_core';

describe('arrival event core', () => {
  it('mirrors the zone transition teleport threshold exactly', () => {
    expect(ARRIVAL_TELEPORT_DISPLACEMENT_YD).toBe(TELEPORT_DISPLACEMENT_YD);
  });

  it('classifies a displacement strictly beyond the threshold as a teleport', () => {
    expect(isTeleportDisplacement(ARRIVAL_TELEPORT_DISPLACEMENT_YD, 0)).toBe(false);
    expect(isTeleportDisplacement(ARRIVAL_TELEPORT_DISPLACEMENT_YD + 0.01, 0)).toBe(true);
    expect(isTeleportDisplacement(25, 25)).toBe(true);
    expect(isTeleportDisplacement(-3, 4)).toBe(false);
  });

  it('fires once on the landing frame and never on the baseline frame', () => {
    const detector = createArrivalDetector();
    expect(detector.observe(500, 500)).toBe(false);
    expect(detector.observe(501, 500.5)).toBe(false);
    expect(detector.observe(1200, -300)).toBe(true);
    expect(detector.observe(1200.5, -300)).toBe(false);
    expect(detector.observe(1200.5, -400)).toBe(true);
  });
});
