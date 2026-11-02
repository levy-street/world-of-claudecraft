import { describe, expect, it } from 'vitest';
import { isBlocked, lineOfSightClear, pathCrossesFence } from '../src/sim/colliders';
import { EASTBROOK_LAYOUT, EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../src/sim/eastbrook_layout';
import { FERRY_BELL_TOWN_LANDING } from '../src/sim/interactions/ferry_bell';
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
// Where a player walks into the civic square from the north road: the
// point the tutorial ferry used to land on. The ferry now sets graduates down
// on the quay (FERRY_BELL_TOWN_LANDING) and the golden guidance walks them up,
// so the square's own entry is pinned here as a literal.
const SQUARE_ENTRY = { x: -6, z: -97.5 };

describe('Eastbrook starter combat quest group', () => {
  // The Studio town rework (#4593) broke up the square group on purpose:
  // Marshal greets the ferry landing, Wilkes, Lin and Brandt stand on the
  // south market lane, and Odell stands north-east of the square. The stands
  // are pinned literally here; the per-stand hygiene below is unchanged.
  it('stands each giver at its authored point, clear of roads, stations and collision', () => {
    expect(
      Object.fromEntries(GIVERS.map((id) => [id, EASTBROOK_NPC_PLACEMENTS_BY_ID[id].position])),
    ).toEqual({
      // nudged off the map's spots by the least that clears a rule: Marshal
      // 1.5 yd off the streetlamp on his landing sightline, Wilkes off the
      // crafts lane, Lin out of her shop's eaves, Brandt off the lane's end
      // and a stride clear of the loom bench
      marshal_redbrook: { x: -86.67, z: -42.95 },
      trader_wilkes: { x: -14.6, z: -119.4 },
      apothecary_lin: { x: -31.3, z: -119.3 },
      foreman_odell: { x: 0.06, z: -82.14 },
      fisherman_brandt: { x: -21.3, z: -120.6 },
    });
    // The one pair the rework leaves close: Wilkes and Brandt share a market
    // corner. Every other giver keeps the old 7 yd minimum to its nearest.
    for (const id of GIVERS) {
      const { position } = EASTBROOK_NPC_PLACEMENTS_BY_ID[id];
      const distances = GIVERS.filter((other) => other !== id).map((other) => {
        const next = EASTBROOK_NPC_PLACEMENTS_BY_ID[other].position;
        return Math.hypot(position.x - next.x, position.z - next.z);
      });
      expect(Math.min(...distances), `${id} nearest neighbor`).toBeGreaterThanOrEqual(
        id === 'trader_wilkes' || id === 'fisherman_brandt' ? 5 : 7,
      );
      expect(
        Math.hypot(position.x - SQUARE_ENTRY.x, position.z - SQUARE_ENTRY.z),
        id,
      ).toBeGreaterThanOrEqual(3);
      expect(isBlocked(WORLD_SEED, position.x, position.z, 0.7), id).toBe(false);
      expect(
        roadDistance(position.x, position.z),
        `${id} keeps the road clear`,
      ).toBeGreaterThanOrEqual(2.5);
      // The rework stands Wilkes and Brandt on the crafts lane among its
      // benches on purpose; they keep 4.5 yd off every bench (a bench master's
      // working reach), every other giver the old 7.
      for (const station of EASTBROOK_LAYOUT.services.stations) {
        expect(
          Math.hypot(position.x - station.position.x, position.z - station.position.z),
          `${id} / ${station.id}`,
        ).toBeGreaterThanOrEqual(id === 'trader_wilkes' || id === 'fisherman_brandt' ? 4.5 : 7);
      }
    }
  });

  // The Studio town rework (#4593) moved Marshal from beside the noticeboard
  // to the ferry landing, where graduates step off the tutorial ferry, so the
  // sightline he must keep is the landing's, not the square entry's. He still
  // stands clear of the board's interaction reach (it stayed on the square).
  it('keeps Marshal visible from the ferry landing and clear of noticeboard interactions', () => {
    const marshal = EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position;
    const board = EASTBROOK_LAYOUT.services.noticeboard;
    const landing = { x: FERRY_BELL_TOWN_LANDING.x, z: FERRY_BELL_TOWN_LANDING.z };
    expect(isBlocked(WORLD_SEED, landing.x, landing.z, 0.5)).toBe(false);
    expect(lineOfSightClear(WORLD_SEED, landing, marshal)).toBe(true);
    for (const point of [board.position, board.frontStandingPoint]) {
      expect(Math.hypot(marshal.x - point.x, marshal.z - point.z)).toBeGreaterThan(
        board.interactionRadius,
      );
    }
    expect(Math.hypot(marshal.x - landing.x, marshal.z - landing.z)).toBeLessThanOrEqual(8);
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
      // Marshal is walked to from the ferry landing he greets (the Studio
      // town rework, #4593); the square givers from the square entry.
      const from =
        id === 'marshal_redbrook'
          ? { x: FERRY_BELL_TOWN_LANDING.x, z: FERRY_BELL_TOWN_LANDING.z }
          : SQUARE_ENTRY;
      const route = [from, ...findPlayerPath(WORLD_SEED, from, target)];
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
