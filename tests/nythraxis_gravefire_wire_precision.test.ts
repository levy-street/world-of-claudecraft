// Regression test for the Gravefire wire direction-precision bug: the server
// used to round the line's unit direction (dirX/dirZ) to 2 decimals before
// serializing it, same as every other Gravefire field. Direction error compounds
// over the line's full run to NYTHRAXIS_GRAVEFIRE_LENGTH (40yd), so a rounded
// direction can shift a point near the far end from inside the lit window to
// outside it: the client would then show a raider as safe from a burn the
// authoritative sim intends to land. Exercises the real server encode ->
// JSON.parse -> client decode -> hazard-geometry pipeline (server/nythraxis_wire.ts
// riding src/net/ground_telegraph_wire.ts and src/sim/nythraxis_gravefire.ts).
import { describe, expect, it } from 'vitest';
import { nythraxisEncounterWireJson } from '../server/nythraxis_wire';
import { decodeNythraxisGravefires } from '../src/net/ground_telegraph_wire';
import {
  type ActiveNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_HALF_WIDTH,
  pointInNythraxisGravefire,
} from '../src/sim/nythraxis_gravefire';

// A real full-precision unit direction: dirZ = sqrt(1 - dirX^2) to machine
// precision, the shape every live Gravefire line actually carries
// (nythraxisGravefireDirection normalizes an origin-to-target offset, never a
// round 2-decimal number). Neither component is axis-aligned or cardinal.
const DIAGONAL_LINE: ActiveNythraxisGravefire = {
  id: '11:gfl:3',
  sourceId: 11,
  x: 0,
  z: 0,
  dirX: 0.69499,
  dirZ: 0.7190194016158397,
  tail: 0,
  head: 40,
  halfWidth: NYTHRAXIS_GRAVEFIRE_HALF_WIDTH,
  remaining: 5,
};

// A point roughly 39 yards along the line (near the far end, one yard short of
// the head) and roughly 1.45 yards across it: inside the 1.5yd half-width under
// the true direction, but only just.
const FAR_EDGE_POINT = { x: 28.14718813234297, z: 27.034021163017748 };

function parseFragment(json: string): Record<string, unknown> {
  return json.length === 0 ? {} : JSON.parse(`{${json.slice(1)}}`);
}

describe('Nythraxis Gravefire wire direction precision', () => {
  it('places the far-end point inside the true lit window under the full-precision direction', () => {
    const extent = { tail: DIAGONAL_LINE.tail, head: DIAGONAL_LINE.head };
    const along =
      (FAR_EDGE_POINT.x - DIAGONAL_LINE.x) * DIAGONAL_LINE.dirX +
      (FAR_EDGE_POINT.z - DIAGONAL_LINE.z) * DIAGONAL_LINE.dirZ;
    expect(along).toBeCloseTo(39, 2);
    expect(pointInNythraxisGravefire(DIAGONAL_LINE, extent, FAR_EDGE_POINT)).toBe(true);
  });

  it('would have pushed that same point outside the window under the OLD 2-decimal-rounded direction', () => {
    // Reproduces exactly what server/nythraxis_wire.ts used to serialize
    // (round2(dirX)/round2(dirZ)) so the test documents the concrete
    // gameplay consequence of the bug it guards against.
    const roundedLine = {
      ...DIAGONAL_LINE,
      dirX: Math.round(DIAGONAL_LINE.dirX * 100) / 100,
      dirZ: Math.round(DIAGONAL_LINE.dirZ * 100) / 100,
    };
    expect(roundedLine.dirX).toBe(0.69);
    expect(roundedLine.dirZ).toBe(0.72);
    const extent = { tail: DIAGONAL_LINE.tail, head: DIAGONAL_LINE.head };
    expect(pointInNythraxisGravefire(roundedLine, extent, FAR_EDGE_POINT)).toBe(false);
  });

  it('preserves full dirX/dirZ precision across a real server encode -> JSON -> client decode round trip', () => {
    const json = nythraxisEncounterWireJson(
      {
        activeNythraxisGraveEruptions: [],
        activeNythraxisGraveFlames: [],
        activeNythraxisGravefires: [DIAGONAL_LINE],
        activeNythraxisBindingSigils: [],
      },
      { x: 0, z: 0 },
      90,
    );
    const row = (parseFragment(json).nythraxisGravefires as Array<Record<string, unknown>>)[0];
    expect(row.dx).toBe(0.69499);
    expect(row.dz).toBe(0.7190194016158397);

    const [decoded] = decodeNythraxisGravefires(parseFragment(json).nythraxisGravefires);
    expect(decoded.dirX).toBe(DIAGONAL_LINE.dirX);
    expect(decoded.dirZ).toBe(DIAGONAL_LINE.dirZ);

    const extent = { tail: decoded.tail, head: decoded.head };
    expect(pointInNythraxisGravefire(decoded, extent, FAR_EDGE_POINT)).toBe(true);
  });

  it('keeps every other Gravefire field rounded to 2 decimals; dirX/dirZ is the sole exception', () => {
    const json = nythraxisEncounterWireJson(
      {
        activeNythraxisGraveEruptions: [],
        activeNythraxisGraveFlames: [],
        activeNythraxisGravefires: [
          {
            ...DIAGONAL_LINE,
            x: 1.23456,
            z: 2.34567,
            tail: 3.45678,
            head: 39.87654,
            remaining: 4.5555,
          },
        ],
        activeNythraxisBindingSigils: [],
      },
      { x: 0, z: 0 },
      90,
    );
    const row = (parseFragment(json).nythraxisGravefires as Array<Record<string, unknown>>)[0];
    expect(row.x).toBe(1.23);
    expect(row.z).toBe(2.35);
    expect(row.tail).toBe(3.46);
    expect(row.head).toBe(39.88);
    expect(row.rem).toBe(4.56);
    expect(row.dx).toBe(0.69499);
    expect(row.dz).toBe(0.7190194016158397);
  });
});
