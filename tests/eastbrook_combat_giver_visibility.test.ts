import { describe, expect, it } from 'vitest';
import { isBlocked, lineOfSightClear, pathCrossesFence } from '../src/sim/colliders';
import { EASTBROOK_LAYOUT, EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../src/sim/eastbrook_layout';
import { findPlayerPath } from '../src/sim/pathfind';
import { groundHeight, roadDistance, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const GIVERS = [
  'marshal_redbrook',
  'trader_wilkes',
  'apothecary_lin',
  'foreman_odell',
  'fisherman_brandt',
] as const;
const SQUARE_CENTER = { x: -14, z: -102 };
const SQUARE_ENTRY = { x: -4.5, z: -101.5 };

describe('Eastbrook starter combat quest group', () => {
  it('spreads the givers around the town square with generous spacing', () => {
    for (const id of GIVERS) {
      const { position } = EASTBROOK_NPC_PLACEMENTS_BY_ID[id];
      expect(
        Math.hypot(position.x - SQUARE_CENTER.x, position.z - SQUARE_CENTER.z),
        id,
      ).toBeLessThanOrEqual(18);
      const distances = GIVERS.filter((other) => other !== id).map((other) => {
        const next = EASTBROOK_NPC_PLACEMENTS_BY_ID[other].position;
        return Math.hypot(position.x - next.x, position.z - next.z);
      });
      expect(Math.min(...distances), `${id} nearest neighbor`).toBeGreaterThanOrEqual(7);
      expect(Math.min(...distances), `${id} nearest neighbor`).toBeLessThanOrEqual(12);
      expect(
        Math.hypot(position.x - SQUARE_ENTRY.x, position.z - SQUARE_ENTRY.z),
        id,
      ).toBeGreaterThanOrEqual(3);
      expect(isBlocked(WORLD_SEED, position.x, position.z, 0.7), id).toBe(false);
      expect(
        roadDistance(position.x, position.z),
        `${id} keeps the road clear`,
      ).toBeGreaterThanOrEqual(2.5);
      for (const station of EASTBROOK_LAYOUT.services.stations) {
        expect(
          Math.hypot(position.x - station.position.x, position.z - station.position.z),
          `${id} / ${station.id}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('keeps Marshal visible from the square entry and clear of noticeboard interactions', () => {
    const marshal = EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position;
    const board = EASTBROOK_LAYOUT.services.noticeboard;
    expect(isBlocked(WORLD_SEED, SQUARE_ENTRY.x, SQUARE_ENTRY.z, 0.5)).toBe(false);
    expect(lineOfSightClear(WORLD_SEED, SQUARE_ENTRY, marshal)).toBe(true);
    for (const point of [board.position, board.frontStandingPoint]) {
      expect(Math.hypot(marshal.x - point.x, marshal.z - point.z)).toBeGreaterThan(
        board.interactionRadius,
      );
    }
    expect(
      Math.hypot(marshal.x - board.position.x, marshal.z - board.position.z),
    ).toBeLessThanOrEqual(8);
  });

  it('keeps walking approaches and neighboring giver sightlines clear around the monument', () => {
    for (const id of GIVERS) {
      const target = EASTBROOK_NPC_PLACEMENTS_BY_ID[id].position;
      expect(
        GIVERS.some(
          (other) =>
            other !== id &&
            lineOfSightClear(WORLD_SEED, target, EASTBROOK_NPC_PLACEMENTS_BY_ID[other].position),
        ),
        `${id} has a visible neighbor`,
      ).toBe(true);
      const route = [SQUARE_ENTRY, ...findPlayerPath(WORLD_SEED, SQUARE_ENTRY, target)];
      for (let leg = 1; leg < route.length; leg++) {
        const a = route[leg - 1];
        const b = route[leg];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(length / 0.25));
        expect(pathCrossesFence(a.x, a.z, b.x, b.z, 0.5), id).toBe(false);
        let lastHeight = groundHeight(a.x, a.z, WORLD_SEED);
        for (let step = 1; step <= steps; step++) {
          const x = a.x + ((b.x - a.x) * step) / steps;
          const z = a.z + ((b.z - a.z) * step) / steps;
          const height = groundHeight(x, z, WORLD_SEED);
          expect(isBlocked(WORLD_SEED, x, z, 0.5), `${id} approach`).toBe(false);
          expect(height, `${id} dry approach`).toBeGreaterThanOrEqual(
            waterLevelAt(x, z, WORLD_SEED) - 0.8,
          );
          if (length > 0)
            expect(
              Math.abs(height - lastHeight) / (length / steps),
              `${id} slope`,
            ).toBeLessThanOrEqual(1.5);
          lastHeight = height;
        }
      }
    }
  });
});
