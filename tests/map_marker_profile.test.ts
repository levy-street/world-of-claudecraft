import { describe, expect, it } from 'vitest';
import { mapMarkerProfileFor, mapMarkerProfileForFlags } from '../src/ui/map_marker_profile_core';

describe('map marker responsive profile', () => {
  it.each([
    ['desktop landscape', false, false, 1600, 900, 'standard'],
    ['desktop portrait', false, false, 900, 1600, 'standard'],
    ['touch portrait', true, false, 390, 844, 'standard'],
    ['touch square', true, false, 390, 390, 'standard'],
    ['touch landscape', true, false, 844, 390, 'compact'],
    ['compact touch portrait', true, true, 390, 844, 'compact'],
  ] as const)(
    '%s resolves %s',
    (_name, touch, compact, viewportWidth, viewportHeight, expected) => {
      expect(mapMarkerProfileFor({ touch, compact, viewportWidth, viewportHeight })).toBe(expected);
    },
  );

  it('offers the same allocation-free flag policy to the Hud adapter', () => {
    expect(mapMarkerProfileForFlags(false, true, true)).toBe('standard');
    expect(mapMarkerProfileForFlags(true, false, false)).toBe('standard');
    expect(mapMarkerProfileForFlags(true, true, false)).toBe('compact');
    expect(mapMarkerProfileForFlags(true, false, true)).toBe('compact');
  });
});
