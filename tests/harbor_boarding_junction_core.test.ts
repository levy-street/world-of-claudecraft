// The boarding-junction woodwork core (src/render/harbor_boarding_junction_core.ts):
// one aligned plank field over the berth-head rects and the bridge, the
// bridge's visual overlap into the hull, and the flush rail cap at the hull
// end. Driven against the real generated harbors so the geometry claims hold
// for the layouts the game actually ships.

import { describe, expect, it } from 'vitest';
import {
  BRIDGE_HULL_VISUAL_OVERLAP_YARDS,
  boardingJunctionRects,
  bridgeRailCapOverhang,
  bridgeVisualRect,
  HARBOR_PLANK_STYLE,
  junctionPlankBoxes,
  RAIL_CAP_OVERHANG_YARDS,
} from '../src/render/harbor_boarding_junction_core';
import { GULLHAVEN_HARBOR, HARBORS, MAINLAND_HARBOR } from '../src/sim/harbor_layout';

// The SHIPPED style: what buildHarbors feeds the field. Testing a fixture
// copy would go silently stale when a board constant moves.
const STYLE = HARBOR_PLANK_STYLE;

describe('boarding junction field', () => {
  it('collects exactly the berth-head-height rects, bridge included', () => {
    for (const harbor of HARBORS) {
      const rects = boardingJunctionRects(harbor);
      expect(rects).toContain(harbor.bridge);
      expect(rects.length).toBeGreaterThanOrEqual(4);
      for (const rect of rects) expect(rect.y).toBe(harbor.bridge.y);
      // The lower piers stay out of the field.
      expect(rects).not.toContain(harbor.decks[0]);
    }
  });

  it('extends the bridge visual toward the hull and only toward the hull', () => {
    // Mainland hull lies east of the bridge, Gullhaven's lies west.
    const mainland = bridgeVisualRect(MAINLAND_HARBOR);
    const mainlandBridge = MAINLAND_HARBOR.bridge;
    expect(mainland.x + mainland.hw).toBeCloseTo(
      mainlandBridge.x + mainlandBridge.hw + BRIDGE_HULL_VISUAL_OVERLAP_YARDS,
      10,
    );
    expect(mainland.x - mainland.hw).toBeCloseTo(mainlandBridge.x - mainlandBridge.hw, 10);

    const gullhaven = bridgeVisualRect(GULLHAVEN_HARBOR);
    const gullhavenBridge = GULLHAVEN_HARBOR.bridge;
    expect(gullhaven.x - gullhaven.hw).toBeCloseTo(
      gullhavenBridge.x - gullhavenBridge.hw - BRIDGE_HULL_VISUAL_OVERLAP_YARDS,
      10,
    );
    expect(gullhaven.x + gullhaven.hw).toBeCloseTo(gullhavenBridge.x + gullhavenBridge.hw, 10);
  });

  it('cuts the bridge rail cap flush at the hull end and keeps the pier overhang', () => {
    for (const harbor of HARBORS) {
      for (const rail of harbor.bridgeRails) {
        const overhang = bridgeRailCapOverhang(harbor, rail);
        expect(overhang).not.toBeNull();
        if (!overhang) continue;
        const hullPositive = harbor.berth.x >= harbor.bridge.x;
        expect(overhang.positive).toBe(hullPositive ? 0 : RAIL_CAP_OVERHANG_YARDS);
        expect(overhang.negative).toBe(hullPositive ? RAIL_CAP_OVERHANG_YARDS : 0);
      }
      // Every rail that is not part of the bridge keeps the default caps.
      const plainRail = harbor.rails.find((rail) => !harbor.bridgeRails.includes(rail));
      expect(plainRail).toBeDefined();
      if (plainRail) expect(bridgeRailCapOverhang(harbor, plainRail)).toBeNull();
    }
  });

  it('lays every board inside its rect on one shared row grid', () => {
    for (const harbor of HARBORS) {
      const rects = boardingJunctionRects(harbor).map((rect) =>
        rect === harbor.bridge ? bridgeVisualRect(harbor) : rect,
      );
      const anchor = harbor.bridge.z;
      const boxes = junctionPlankBoxes(harbor, STYLE);
      const boards = boxes.filter((box) => box.tone !== STYLE.trimTone);
      const slabs = boxes.filter((box) => box.tone === STYLE.trimTone);
      expect(slabs).toHaveLength(rects.length);
      expect(boards.length).toBeGreaterThan(rects.length);
      for (const board of boards) {
        // Inside exactly one junction rect (boards never overhang the water).
        const owners = rects.filter(
          (rect) =>
            board.x - board.w / 2 >= rect.x - rect.hw - 1e-9 &&
            board.x + board.w / 2 <= rect.x + rect.hw + 1e-9 &&
            board.z - board.d / 2 >= rect.z - rect.hd - 1e-9 &&
            board.z + board.d / 2 <= rect.z + rect.hd + 1e-9,
        );
        expect(owners.length, `board at ${board.x},${board.z}`).toBeGreaterThanOrEqual(1);
        // Row edges sit on the shared anchor grid unless clipped by the rect.
        const lo = board.z - board.d / 2;
        const gridOffset = (lo - anchor - STYLE.groove / 2) / STYLE.pitch;
        const onGrid = Math.abs(gridOffset - Math.round(gridOffset)) < 1e-6;
        const clipped = owners.some((rect) => Math.abs(lo - (rect.z - rect.hd)) < 1e-9);
        expect(onGrid || clipped, `board row edge at ${lo}`).toBe(true);
      }
    }
  });

  it('continues a board flush across the corridor-to-bridge boundary', () => {
    for (const harbor of HARBORS) {
      const hullPositive = harbor.berth.x >= harbor.bridge.x;
      // The pier-side edge of the bridge abuts the berth-head corridor.
      const boundary = hullPositive
        ? harbor.bridge.x - harbor.bridge.hw
        : harbor.bridge.x + harbor.bridge.hw;
      const boards = junctionPlankBoxes(harbor, STYLE).filter((box) => box.tone !== STYLE.trimTone);
      // Only rows that lie within the bridge's own span can continue onto it;
      // the flanking rects share the same pier edge but face open water.
      const endingAt = boards.filter(
        (box) =>
          Math.abs(box.x + box.w / 2 - boundary) < 1e-9 &&
          box.d < STYLE.pitch &&
          Math.abs(box.z - harbor.bridge.z) < harbor.bridge.hd - STYLE.pitch / 2,
      );
      // A board may continue flush across the boundary, or, when the world
      // joint grid drops a butt joint within centimeters of it, the next
      // board starts just past the joint gap. Either way nothing wider than
      // a normal joint interrupts the row.
      const jointSlack = STYLE.jointGap + STYLE.pitch * 0.5 + 1e-6;
      const startingNear = boards.filter(
        (box) => box.x - box.w / 2 >= boundary - 1e-9 && box.x - box.w / 2 <= boundary + jointSlack,
      );
      expect(endingAt.length, `${harbor.id} boundary ${boundary}`).toBeGreaterThan(0);
      for (const left of endingAt) {
        const continuation = startingNear.find((right) => Math.abs(right.z - left.z) < 1e-6);
        expect(continuation, `${harbor.id} row ${left.z} continues`).toBeDefined();
        if (continuation && Math.abs(continuation.x - continuation.w / 2 - boundary) < 1e-9) {
          // A flush continuation is the SAME world board: same tone cycle.
          expect(continuation.tone).toBe(left.tone);
        }
      }
    }
  });
});
