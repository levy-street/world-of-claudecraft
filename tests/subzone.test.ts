import { describe, expect, it } from 'vitest';
import { SUBZONE_DEADBAND, SUBZONE_RADIUS, nearestSubzone } from '../src/ui/subzone';

const pois = [
  { x: 0, z: 0, label: 'Eastbrook' },
  { x: 100, z: 0, label: 'Boar Meadow' },
];

describe('nearestSubzone', () => {
  it('returns null in open wilderness, far from every landmark', () => {
    expect(nearestSubzone(50, 50, pois, null)).toBeNull();
  });

  it('picks the landmark the player is standing in', () => {
    expect(nearestSubzone(5, 5, pois, null)).toBe('Eastbrook');
    expect(nearestSubzone(100, 3, pois, null)).toBe('Boar Meadow');
  });

  it('picks the nearer of two in-range landmarks', () => {
    const close = [
      { x: 0, z: 0, label: 'A' },
      { x: 20, z: 0, label: 'B' },
    ];
    expect(nearestSubzone(2, 0, close, null)).toBe('A');
    expect(nearestSubzone(18, 0, close, null)).toBe('B');
  });

  it('keeps the current subzone within the dead-band (hysteresis)', () => {
    // just past the enter-radius but inside radius+deadband of Eastbrook
    const x = SUBZONE_RADIUS + SUBZONE_DEADBAND - 1;
    expect(nearestSubzone(x, 0, pois, null)).toBeNull();
    expect(nearestSubzone(x, 0, pois, 'Eastbrook')).toBe('Eastbrook');
  });

  it('drops the subzone once clear of the dead-band', () => {
    const x = SUBZONE_RADIUS + SUBZONE_DEADBAND + 1;
    expect(nearestSubzone(x, 0, pois, 'Eastbrook')).toBeNull();
  });
});
