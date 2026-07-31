import { describe, expect, it } from 'vitest';
import { jumpArcLiftAt, raceGateMarkerState } from '../src/render/race_line_core';
import { MOUNT_RACE_COURSE } from '../src/sim/content/mounts';

function states(mask: number, total: number) {
  return Array.from({ length: total }, (_, index) => raceGateMarkerState(mask, index, total));
}

describe('show-jumping racing line guidance', () => {
  it('lifts the racing line into a visible arc over every jump', () => {
    for (const jump of MOUNT_RACE_COURSE.jumps) {
      expect(jumpArcLiftAt(jump.x, jump.z)).toBeGreaterThan(2);
    }
    expect(jumpArcLiftAt(MOUNT_RACE_COURSE.arch.x, MOUNT_RACE_COURSE.arch.z)).toBe(0);
  });

  it('marks cleared gates green and highlights the next uncleared gate', () => {
    expect(states(0, 4)).toEqual(['next', 'pending', 'pending', 'pending']);
    expect(states(0b0001, 4)).toEqual(['cleared', 'next', 'pending', 'pending']);
    expect(states(0b0101, 4)).toEqual(['cleared', 'next', 'cleared', 'pending']);
    expect(states(0b1111, 4)).toEqual(['cleared', 'cleared', 'cleared', 'cleared']);
  });
});
