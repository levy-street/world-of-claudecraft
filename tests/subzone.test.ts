import { describe, expect, it } from 'vitest';
import {
  AREA_EXIT_PAD,
  currentSubzone,
  namedAreaAt,
  nearestSubzone,
  SUBZONE_DEADBAND,
  SUBZONE_RADIUS,
} from '../src/ui/subzone';

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

// --- authored named areas (MapDoc `locations`) --------------------------------

const areas = [
  // The whole city, drawn wide.
  { name: 'Tidehold', minX: -200, minZ: -200, maxX: 200, maxZ: 200 },
  // A plaza inside it.
  { name: 'The Glass Market', minX: -40, minZ: -40, maxX: 40, maxZ: 40 },
  // A square inside the plaza.
  { name: "Baldemar's Square", minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
  // A long thin one: a rect a point+radius could never model.
  { name: 'Ropewalk', minX: 300, minZ: -4, maxX: 420, maxZ: 4 },
];

describe('namedAreaAt', () => {
  it('returns null outside every rect', () => {
    expect(namedAreaAt(1000, 1000, areas, null)).toBeNull();
  });

  it('names the SMALLEST rect containing the player', () => {
    expect(namedAreaAt(0, 0, areas, null)).toBe("Baldemar's Square");
    expect(namedAreaAt(25, 25, areas, null)).toBe('The Glass Market');
    expect(namedAreaAt(150, 150, areas, null)).toBe('Tidehold');
  });

  it('covers a long thin rect a POI radius would miss or overshoot', () => {
    expect(namedAreaAt(410, 0, areas, null)).toBe('Ropewalk');
    // 20 yards off the end: outside the rect, and past the exit pad.
    expect(namedAreaAt(440, 0, areas, null)).toBeNull();
  });

  it('holds the current area through the exit pad, then drops it', () => {
    // Just outside Ropewalk's east end but inside the pad.
    expect(namedAreaAt(420 + AREA_EXIT_PAD - 1, 0, areas, 'Ropewalk')).toBe('Ropewalk');
    expect(namedAreaAt(420 + AREA_EXIT_PAD + 1, 0, areas, 'Ropewalk')).toBeNull();
  });

  it('does not resurrect an area the player never entered', () => {
    expect(namedAreaAt(1000, 1000, areas, 'Ropewalk')).toBeNull();
  });
});

describe('currentSubzone', () => {
  it('prefers an authored rect over a zone POI point covering the same ground', () => {
    const overlapping = [{ x: 0, z: 0, label: 'Somewhere Else' }];
    expect(currentSubzone(0, 0, overlapping, areas, null)).toEqual({
      label: "Baldemar's Square",
      poiIndex: -1,
    });
  });

  it('falls back to the zone POI list where no rect covers the player', () => {
    expect(currentSubzone(100, 0, pois, [], null)).toEqual({
      label: 'Boar Meadow',
      poiIndex: 1,
    });
  });

  it('reports -1 for an authored area so the caller skips the positional locale key', () => {
    expect(currentSubzone(410, 0, pois, areas, null)?.poiIndex).toBe(-1);
  });

  it('is null in open ground with neither kind in range', () => {
    expect(currentSubzone(5000, 5000, pois, areas, null)).toBeNull();
  });
});
