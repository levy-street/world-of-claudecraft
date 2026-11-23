import { describe, expect, it } from 'vitest';
import {
  isExcludedDecoration,
  isExcludedStreetlamp,
  PAINTED_TOWN_LAMP_PAD,
  PAINTED_TOWN_SCATTER_PAD,
  paintedTownReachCovers,
} from '../src/sim/decoration_exclusions';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import { distancePointToObb, localToWorld, type Point2 } from '../src/sim/placed_town_kit';

it('preserves the original clearing and excludes only the cannon lane tree', () => {
  expect(isExcludedDecoration(2.456450840458274, 211.33819991815835)).toBe(true);
  expect(isExcludedDecoration(442.06173, 1003.16146)).toBe(true);
  expect(isExcludedDecoration(442.06173 + 1.21, 1003.16146)).toBe(false);
  expect(isExcludedDecoration(430, 1000)).toBe(false);
});

describe('painted town clearings (sim/painted_towns/)', () => {
  // Gullhaven's watch house, stepped off along its own width on the side away
  // from the town's middle, so the town-circle early-out is crossed at its far
  // edge and no other building's reach is near the points.
  const town = PAINTED_TOWNS.find((candidate) => candidate.id === 'gullhaven');
  const house = town?.buildings.find((building) => building.id === 'gullhaven_watch_house');
  if (!town || !house) throw new Error('Gullhaven watch house missing');
  const { reach } = house;
  const hub = town.hub.center;
  const plus = localToWorld(reach.center, reach.rotation, reach.halfWidth, 0);
  const minus = localToWorld(reach.center, reach.rotation, -reach.halfWidth, 0);
  const outward =
    Math.hypot(plus.x - hub.x, plus.z - hub.z) > Math.hypot(minus.x - hub.x, minus.z - hub.z)
      ? 1
      : -1;
  const sideways = (yards: number): Point2 =>
    localToWorld(reach.center, reach.rotation, (reach.halfWidth + yards) * outward, 0);
  const others = PAINTED_TOWNS.flatMap((candidate) => candidate.buildings).filter(
    (building) => building.id !== house.id,
  );

  it('measures the probe points off this building alone', () => {
    for (const yards of [
      0.5,
      2,
      PAINTED_TOWN_SCATTER_PAD - 0.01,
      PAINTED_TOWN_SCATTER_PAD + 0.01,
      4,
    ]) {
      const point = sideways(yards);
      expect(distancePointToObb(point, reach)).toBeCloseTo(yards, 6);
      for (const other of others) {
        expect(distancePointToObb(point, other.reach), other.id).toBeGreaterThan(6);
      }
    }
  });

  it('covers the whole reach and stops exactly at the pad', () => {
    expect(paintedTownReachCovers(reach.center.x, reach.center.z, 0.5)).toBe(true);
    const near = sideways(PAINTED_TOWN_SCATTER_PAD - 0.01);
    const past = sideways(PAINTED_TOWN_SCATTER_PAD + 0.01);
    expect(paintedTownReachCovers(near.x, near.z, PAINTED_TOWN_SCATTER_PAD)).toBe(true);
    expect(paintedTownReachCovers(past.x, past.z, PAINTED_TOWN_SCATTER_PAD)).toBe(false);
    expect(paintedTownReachCovers(0, -2000, PAINTED_TOWN_SCATTER_PAD)).toBe(false);
  });

  it('clears scatter 3 yd round a building and road lamps 1 yd round it', () => {
    expect(PAINTED_TOWN_SCATTER_PAD).toBe(3);
    expect(PAINTED_TOWN_LAMP_PAD).toBe(1);
    expect(isExcludedDecoration(reach.center.x, reach.center.z)).toBe(true);
    expect(isExcludedStreetlamp(reach.center.x, reach.center.z)).toBe(true);
    const two = sideways(2);
    expect(isExcludedDecoration(two.x, two.z)).toBe(true);
    expect(isExcludedStreetlamp(two.x, two.z)).toBe(false);
    const half = sideways(0.5);
    expect(isExcludedStreetlamp(half.x, half.z)).toBe(true);
    const four = sideways(4);
    expect(isExcludedDecoration(four.x, four.z)).toBe(false);
  });
});
