// Gullhaven's redoubt: the curtain wall, its gates, the town's buildings, and
// the ground all three stand on.
//
// These pin the defects the first pass shipped, so they cannot come back:
// buildings standing in the painted road, a building swallowing an NPC or the
// spirit healer, colliders sized to something other than the model they stand
// for, grading that raised the ground OUTSIDE the wall, and a wall whose gates
// were not on the roads.
//
// Every measurement runs against the live sim at the real client seed. That
// matters: the plot pads and bench targets in src/sim/content/gullhaven.ts are
// height literals measured off THIS seed's terrain, exactly like the memorial's.

import { describe, expect, it } from 'vitest';
import { FARSHORE_NPCS, FARSHORE_PROPS, FARSHORE_ROADS } from '../src/sim/content/farshore';
import {
  GULLHAVEN_BUILDINGS,
  GULLHAVEN_GATES,
  GULLHAVEN_PLOT_PADS,
  GULLHAVEN_TOWN_BENCHES,
  GULLHAVEN_WALL,
  GULLHAVEN_WALL_LINE,
  gullhavenWallProps,
} from '../src/sim/content/gullhaven';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { groundHeight, roadDistance, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/world_seed.mjs';

const SEED = WORLD_SEED as unknown as number;
const th = (x: number, z: number): number => terrainHeight(x, z, SEED);

// ---------------------------------------------------------------------------
// geometry helpers, deliberately independent of the module under test
// ---------------------------------------------------------------------------
interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}
/**
 * The sim's own convention, copied from `building_layout.buildingLocalToWorld`
 * and `colliders.rotY`: local +X lands on (cos rot, -sin rot) and local +Z on
 * (sin rot, cos rot). Getting this backwards uses the INVERSE rotation, which
 * mirrors every non-square footprint and flips which way a door faces, so the
 * checks below would be measuring a building the sim never places.
 */
function localToWorld(b: Box, lx: number, lz: number): { x: number; z: number } {
  return {
    x: b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot),
    z: b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot),
  };
}
/** The footprint outline, sampled densely enough to catch an edge in a road. */
function outline(b: Box, per = 7): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [{ x: b.x, z: b.z }];
  for (let i = 0; i < per; i++) {
    const t = -1 + (2 * i) / (per - 1);
    pts.push(
      localToWorld(b, (t * b.w) / 2, -b.d / 2),
      localToWorld(b, (t * b.w) / 2, b.d / 2),
      localToWorld(b, -b.w / 2, (t * b.d) / 2),
      localToWorld(b, b.w / 2, (t * b.d) / 2),
    );
  }
  return pts;
}
/** Buildings seat on the ground under their DOOR: local +z centre. */
function doorstep(b: Box): { x: number; z: number } {
  return localToWorld(b, 0, b.d / 2);
}
function boxesOverlap(a: Box, b: Box): boolean {
  const axes = [a, b].flatMap((o) => [
    [Math.cos(o.rot), -Math.sin(o.rot)],
    [Math.sin(o.rot), Math.cos(o.rot)],
  ]);
  const corners = (o: Box) => [
    localToWorld(o, -o.w / 2, -o.d / 2),
    localToWorld(o, o.w / 2, -o.d / 2),
    localToWorld(o, o.w / 2, o.d / 2),
    localToWorld(o, -o.w / 2, o.d / 2),
  ];
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    const proj = (pts: { x: number; z: number }[]) => pts.map((p) => p.x * ax + p.z * az);
    const pa = proj(ca);
    const pb = proj(cb);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** The curtain as a dense curve, the same Catmull-Rom the module lays pieces on. */
const WALL_CURVE: [number, number][] = (() => {
  const pts = GULLHAVEN_WALL_LINE;
  const out: [number, number][] = [];
  const axis = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t ** 3);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([axis(p0[0], p1[0], p2[0], p3[0], t), axis(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
})();
function wallCurveDistance(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [cx, cz] of WALL_CURVE) best = Math.min(best, Math.hypot(x - cx, z - cz));
  return best;
}

const PANELS = GULLHAVEN_WALL.filter((p) => p.id.startsWith('gullhaven_wall_'));
const JAMBS = GULLHAVEN_WALL.filter((p) => p.id.startsWith('gullhaven_gate_'));
const TOWN_BUILDINGS: Box[] = GULLHAVEN_BUILDINGS.map(({ x, z, w, d, rot }) => ({
  x,
  z,
  w,
  d,
  rot,
}));

describe('Gullhaven curtain wall: one record, two consumers', () => {
  it('places a piece for every collider box, at the same position and rotation', () => {
    const props = gullhavenWallProps();
    expect(props).toHaveLength(GULLHAVEN_WALL.length);
    props.forEach((prop, i) => {
      expect(prop.key).toBe(GULLHAVEN_WALL[i].key);
      expect(prop.x).toBe(GULLHAVEN_WALL[i].x);
      expect(prop.z).toBe(GULLHAVEN_WALL[i].z);
      expect(prop.rot).toBe(GULLHAVEN_WALL[i].rot);
    });
  });

  it('sizes every collider to its own MEASURED asset footprint, never a stretched box', () => {
    // The kcas curtain modules are 4.0 long at scale 1 (kcas_wall.glb, and the
    // castle assembly's own `S = CASTLE.module / 4`). The previous pass sized
    // each box to edgeLength / panelCount, which drifted from the model on
    // every edge whose length was not a multiple of four.
    const FOOTPRINT: Record<string, [number, number]> = {
      kcasWall: [4, 1],
      kcasWallCracked: [4, 1.259],
      kcasWallPillar: [4, 1.5],
    };
    for (const piece of GULLHAVEN_WALL) {
      const want = FOOTPRINT[piece.key];
      expect(want, `no measured footprint pinned for ${piece.key}`).toBeDefined();
      expect(piece.w).toBeCloseTo(want[0], 5);
      expect(piece.d).toBeCloseTo(want[1], 5);
      expect(piece.height).toBe(4);
    }
  });

  it('stands the whole run on dry land, out of the sea and off the tide flat', () => {
    for (const piece of GULLHAVEN_WALL) {
      const ground = th(piece.x, piece.z);
      expect(ground, `piece ${piece.id} is under water`).toBeGreaterThan(WATER_LEVEL);
      expect(ground, `piece ${piece.id} stands below the tide line`).toBeGreaterThan(0.5);
    }
  });

  it('never steps more than a panel can absorb between neighbours', () => {
    // A 4 yard panel offset vertically from its neighbour by more than its own
    // height would leave a see-through gap under the higher one. The run crosses
    // the spine's crown, so it does step; what it must not do is break open.
    let worst = 0;
    for (let i = 1; i < PANELS.length; i++) {
      if (Math.hypot(PANELS[i].x - PANELS[i - 1].x, PANELS[i].z - PANELS[i - 1].z) > 6) continue;
      worst = Math.max(
        worst,
        Math.abs(th(PANELS[i].x, PANELS[i].z) - th(PANELS[i - 1].x, PANELS[i - 1].z)),
      );
    }
    expect(worst).toBeLessThan(2);
    expect(worst).toBeLessThan(PANELS[0].height);
  });

  it('seats every piece on the surface the sim collides with', () => {
    // The renderer stands a decorProp at `groundHeight(x, z) - 0.05` with the
    // model re-based to min-y 0, and groundHeight is NOT terrainHeight: it also
    // carries harbour decks, dock surfaces and the walkable lifts. The curtain's
    // west end comes down beside Gullhaven's pier, so a piece that strayed onto
    // the boardwalk would render standing on planks while the collider box and
    // the ground under it disagreed.
    for (const piece of GULLHAVEN_WALL) {
      expect(
        Math.abs(groundHeight(piece.x, piece.z, SEED) - th(piece.x, piece.z)),
        `${piece.id} seats on a deck, not on the terrain`,
      ).toBeLessThan(0.02);
    }
    for (const b of GULLHAVEN_BUILDINGS) {
      expect(
        Math.abs(groundHeight(b.x, b.z, SEED) - th(b.x, b.z)),
        `the building at (${b.x}, ${b.z}) seats on a deck`,
      ).toBeLessThan(0.02);
    }
  });

  it('runs both ends down to the water, so the sea is the flank', () => {
    const ends = [GULLHAVEN_WALL_LINE[0], GULLHAVEN_WALL_LINE[GULLHAVEN_WALL_LINE.length - 1]];
    for (const [ex, ez] of ends) {
      let gap = Number.POSITIVE_INFINITY;
      for (let z = ez - 40; z <= ez + 40; z++)
        for (let x = ex - 40; x <= ex + 40; x++)
          if (th(x, z) < WATER_LEVEL) gap = Math.min(gap, Math.hypot(x - ex, z - ez));
      expect(gap, `the end at (${ex}, ${ez}) does not reach the sea`).toBeLessThan(12);
    }
  });
});

describe('Gullhaven gates', () => {
  it('puts every gate on the wall line AND in the painted road band', () => {
    expect(GULLHAVEN_GATES).toHaveLength(3);
    for (const gate of GULLHAVEN_GATES) {
      expect(
        wallCurveDistance(gate.x, gate.z),
        `gate ${gate.id} is off the wall line`,
      ).toBeLessThan(1);
      // < 2.0 is the painted road core the terrain splat draws
      expect(roadDistance(gate.x, gate.z), `gate ${gate.id} is not on a road`).toBeLessThan(2);
    }
  });

  it('opens a walkable bay: no wall piece stands inside a gateway', () => {
    for (const gate of GULLHAVEN_GATES) {
      for (const panel of PANELS) {
        expect(
          Math.hypot(panel.x - gate.x, panel.z - gate.z),
          `panel ${panel.id} blocks the ${gate.id} gate`,
        ).toBeGreaterThan(3);
      }
    }
  });

  it('flanks every gateway with a pair of jambs, each carrying a torch', () => {
    expect(JAMBS).toHaveLength(GULLHAVEN_GATES.length * 2);
    for (const gate of GULLHAVEN_GATES) {
      const mine = JAMBS.filter((j) => j.id.includes(gate.id));
      expect(mine, `the ${gate.id} gate has no jamb pair`).toHaveLength(2);
      for (const jamb of mine) {
        expect(jamb.key).toBe('kcasWallPillar');
        expect(jamb.parts?.map((p) => p.key)).toEqual(['kcasTorchMounted']);
      }
      // A 6 yard clear opening: two 4 yard modules whose centres sit 10 apart.
      const [a, b] = mine;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(9.5);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(10.1);
    }
  });

  it('closes the joint: the curtain butts up to every jamb', () => {
    // The defect this pins: panels used to be skipped by RADIUS from the gate
    // while the run carried on with its own fixed spacing, so the first surviving
    // panel landed wherever the rhythm put it, anywhere from the bay edge to a
    // full spacing past it. Every gate had up to four yards of open grass between
    // its jamb and the wall. Runs are now measured in arc length BETWEEN bays and
    // filled with whole panels, so each run's first and last piece lands flush.
    for (const gate of GULLHAVEN_GATES) {
      for (const jamb of JAMBS.filter((j) => j.id.includes(gate.id))) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const panel of PANELS) {
          // centre-to-centre of two 4 yard modules: 4.0 is exactly touching
          nearest = Math.min(nearest, Math.hypot(panel.x - jamb.x, panel.z - jamb.z));
        }
        expect(
          nearest,
          `${jamb.id} stands ${nearest.toFixed(2)} from the nearest panel, leaving a hole`,
        ).toBeLessThan(4.1);
      }
    }
  });

  it('lets every road through at a gate and nowhere else', () => {
    // Walk the curve and find each place the painted road crosses it; every one
    // has to be a gate. This is the check that would have caught the wall
    // standing across Fisher Bram's escort route.
    const rd = WALL_CURVE.map(([x, z]) => roadDistance(x, z));
    const crossings: [number, number][] = [];
    for (let i = 2; i < WALL_CURVE.length - 2; i++) {
      if (rd[i] > 2) continue;
      if (rd[i] > rd[i - 1] || rd[i] > rd[i + 1] || rd[i] > rd[i - 2] || rd[i] > rd[i + 2])
        continue;
      crossings.push(WALL_CURVE[i]);
    }
    expect(crossings.length).toBeGreaterThanOrEqual(GULLHAVEN_GATES.length);
    for (const [x, z] of crossings) {
      const nearest = Math.min(...GULLHAVEN_GATES.map((g) => Math.hypot(x - g.x, z - g.z)));
      expect(
        nearest,
        `a road crosses the curtain at (${x.toFixed(1)}, ${z.toFixed(1)}) with no gate`,
      ).toBeLessThan(4);
    }
  });

  it('keeps a road under the north gate, so it is an entrance and not a wall', () => {
    // esc_fs_bram walks (804, 20) -> (810, 70) -> (814, 110) home to Gullhaven.
    // The shore road exists in FARSHORE_ROADS for exactly this reason.
    const shore = FARSHORE_ROADS.find((road) => road.some((p) => p.x === 812.7 && p.z === 91.6));
    expect(shore, 'the shore road is gone; the north gate stands on turf').toBeDefined();
    const north = GULLHAVEN_GATES.find((g) => g.id === 'north');
    expect(north).toBeDefined();
    // Bram's line through the wall passes within the gateway
    expect(roadDistance(812.7, 91.6)).toBeLessThan(2);
  });
});

describe('Gullhaven town buildings', () => {
  it('is a single source: FARSHORE_PROPS.buildings is GULLHAVEN_BUILDINGS', () => {
    expect(FARSHORE_PROPS.buildings).toHaveLength(GULLHAVEN_BUILDINGS.length);
    FARSHORE_PROPS.buildings.forEach((b, i) => {
      const src = GULLHAVEN_BUILDINGS[i];
      expect({ kind: b.kind, x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot }).toEqual({
        kind: src.kind,
        x: src.x,
        z: src.z,
        w: src.w,
        d: src.d,
        rot: src.rot,
      });
    });
  });

  it('keeps every footprint out of the painted road', () => {
    // The band the minimap paints is roadDistance < 4.2, and roadDistance warps
    // its own query by up to 3.5 yards, so measuring the POLYLINE is not enough:
    // the first pass solved to 4.2 off the polyline and still put eight
    // buildings in the streets, three of them dead centre.
    for (const b of TOWN_BUILDINGS) {
      let closest = Number.POSITIVE_INFINITY;
      for (const p of outline(b)) closest = Math.min(closest, roadDistance(p.x, p.z));
      expect(closest, `the building at (${b.x}, ${b.z}) stands in the road`).toBeGreaterThan(4.3);
    }
  });

  it('never swallows an NPC, the spirit healer, or any market fitting', () => {
    const occupants: { label: string; x: number; z: number }[] = [
      ...Object.values(FARSHORE_NPCS).map((n) => ({ label: n.id, x: n.pos.x, z: n.pos.z })),
      ...(FARSHORE_PROPS.graveyards ?? []).map((g) => ({ label: 'spirit healer', x: g.x, z: g.z })),
      ...(FARSHORE_PROPS.wells ?? []).map((w) => ({ label: 'well', x: w.x, z: w.z })),
      ...(FARSHORE_PROPS.stalls ?? []).map((s, i) => ({ label: `stall ${i}`, x: s.x, z: s.z })),
      ...(FARSHORE_PROPS.tents ?? []).map((t, i) => ({ label: `tent ${i}`, x: t.x, z: t.z })),
      ...(FARSHORE_PROPS.crates ?? []).map((c, i) => ({ label: `crate ${i}`, x: c[0], z: c[1] })),
      ...(FARSHORE_PROPS.campfires ?? []).map((c, i) => ({ label: `fire ${i}`, x: c[0], z: c[1] })),
      ...(FARSHORE_PROPS.decorProps ?? [])
        .filter((d) => !String(d.key).startsWith('kcas'))
        .map((d) => ({ label: String(d.key), x: d.x, z: d.z })),
    ];
    // A building is a solid full-height box with no interior (colliders.ts), so
    // anything standing inside one is stuck inside a wall.
    for (const b of TOWN_BUILDINGS) {
      for (const o of occupants) {
        const point: Box = { x: o.x, z: o.z, w: 0.6, d: 0.6, rot: 0 };
        expect(
          boxesOverlap(b, point),
          `${o.label} at (${o.x}, ${o.z}) stands inside the building at (${b.x}, ${b.z})`,
        ).toBe(false);
      }
    }
  });

  it('leaves a walkable alley between every pair, and never overlaps', () => {
    for (let i = 0; i < TOWN_BUILDINGS.length; i++) {
      for (let j = i + 1; j < TOWN_BUILDINGS.length; j++) {
        const a = TOWN_BUILDINGS[i];
        const b = TOWN_BUILDINGS[j];
        expect(boxesOverlap(a, b), `(${a.x}, ${a.z}) and (${b.x}, ${b.z}) overlap`).toBe(false);
        // grown by a yard on every side they must still not touch, so no alley
        // narrows past a body's width
        const grow = (o: Box): Box => ({ ...o, w: o.w + 2, d: o.d + 2 });
        expect(
          boxesOverlap(grow(a), grow(b)),
          `the alley between (${a.x}, ${a.z}) and (${b.x}, ${b.z}) is under 2 yards`,
        ).toBe(false);
      }
    }
  });

  it('stands clear inside the curtain, never leaning on it', () => {
    for (const b of TOWN_BUILDINGS) {
      for (const p of outline(b)) {
        expect(
          wallCurveDistance(p.x, p.z),
          `the building at (${b.x}, ${b.z}) touches the curtain`,
        ).toBeGreaterThan(3.5);
      }
    }
  });

  it('sits level: no footprint corner floats or buries itself past a step', () => {
    // buildingTerrainEnvelope seats a building at the ground under its DOOR with
    // no foundation, so deviation from the doorstep is what shows on screen.
    for (const b of TOWN_BUILDINGS) {
      const seat = th(doorstep(b).x, doorstep(b).z);
      let worst = 0;
      for (const p of outline(b)) worst = Math.max(worst, Math.abs(th(p.x, p.z) - seat));
      expect(worst, `the building at (${b.x}, ${b.z}) is out of level`).toBeLessThan(0.6);
    }
  });

  it('gives every plot its own pad, derived from the building list', () => {
    // Three town benches of three passes each, plus two stamps per building (a
    // smooth blend and a flat floor). The pads are a SEPARATE export because they
    // land after the memorial's grading in data.ts, not with the benches.
    expect(GULLHAVEN_TOWN_BENCHES).toHaveLength(9);
    expect(GULLHAVEN_PLOT_PADS).toHaveLength(GULLHAVEN_BUILDINGS.length * 2);
    for (const b of GULLHAVEN_BUILDINGS) {
      const mine = GULLHAVEN_PLOT_PADS.filter((e) => e.x === b.x && e.z === b.z);
      expect(mine, `no plot pad for the building at (${b.x}, ${b.z})`).toHaveLength(2);
      for (const stamp of mine) {
        expect(stamp.mode).toBe('level');
        expect(stamp.delta).toBe(b.pad);
      }
      expect(mine.some((s) => s.falloff === 'flat')).toBe(true);
      expect(mine.some((s) => s.falloff === 'smooth')).toBe(true);
    }
  });
});

describe("Gullhaven's grading stays inside the town", () => {
  /** The same world with Gullhaven's stamps removed, for a before and after. */
  function ungraded<T>(body: (baseline: (x: number, z: number) => number) => T): T {
    const skip = new Set<unknown>([...GULLHAVEN_TOWN_BENCHES, ...GULLHAVEN_PLOT_PADS]);
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: (BUILTIN_WORLD.terrainEdits ?? []).filter((e: unknown) => !skip.has(e)),
    });
    try {
      const snapshot = new Map<string, number>();
      for (let z = 60; z <= 190; z += 1)
        for (let x = 755; x <= 890; x += 1) snapshot.set(`${x},${z}`, th(x, z));
      setActiveWorldContent(null);
      return body((x, z) => snapshot.get(`${Math.round(x)},${Math.round(z)}`) as number);
    } finally {
      setActiveWorldContent(null);
    }
  }

  it('does not move the coastline by a single square yard', () => {
    ungraded((baseline) => {
      let moved = 0;
      for (let z = 60; z <= 190; z++)
        for (let x = 755; x <= 890; x++) {
          const wasWet = baseline(x, z) < WATER_LEVEL;
          const isWet = th(x, z) < WATER_LEVEL;
          if (wasWet !== isWet) moved++;
        }
      expect(moved).toBe(0);
    });
  });

  it('raises the ground the town uses, not the ridge outside the wall', () => {
    // The first pass centred a 50 yard lift at (864, 126), forty-two yards east
    // of the town: it left the town floor at 5.50 and raised the ridge just
    // outside the east wall to 9.4, so the redoubt sat in a bowl being looked
    // down into. Nothing outside the curtain may rise now.
    ungraded((baseline) => {
      for (const [x, z] of [
        [864, 126],
        [870, 122],
        [876, 126],
        [882, 130],
        [862, 110],
        [866, 140],
      ] as [number, number][]) {
        expect(
          th(x, z) - baseline(x, z),
          `the grading raised (${x}, ${z}), which is outside the wall`,
        ).toBeLessThan(0.12);
      }
    });
  });

  it('leaves the harbour street pocket, the memorial terrace and the hub pad alone', () => {
    // HARBOR_TERRAIN_EDITS levels the ramp foot off the pier to 4.40, and the
    // memorial's terrace to 10.40; a town that drifted upward would turn the
    // ramp into a step, and one that drifted into the mound would flatten the
    // graded contour path.
    expect(th(788, 116)).toBeCloseTo(4.4, 1);
    expect(th(805, 139.6)).toBeCloseTo(10.4, 1);
    expect(th(822, 118)).toBeCloseTo(5.5, 1);
  });

  it('keeps every slope it grades inside the movement climb gate', () => {
    // Deliberately baseline-relative, not an absolute bound over a window. The
    // natural west coast drops 2.4 yards per yard at x 778 where the shore meets
    // the sea, so any absolute assertion here would only pass by picking a scan
    // range that excludes real terrain, and would then be measuring the range
    // rather than the grading. What matters is the ground THIS content changes.
    ungraded((baseline) => {
      let touched = 0;
      let worst = 0;
      let at = '';
      for (let z = 62; z <= 188; z++)
        for (let x = 757; x <= 888; x++) {
          if (Math.abs(th(x, z) - baseline(x, z)) <= 0.05) continue;
          touched++;
          const h = th(x, z);
          for (const [dx, dz] of [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ] as [number, number][]) {
            const step = Math.abs(th(x + dx, z + dz) - h);
            if (step > worst) {
              worst = step;
              at = `(${x}, ${z})`;
            }
          }
        }
      // vacuity floor: the benches and plot pads reshape thousands of yards, so
      // a pass over a handful of cells would mean the diff stopped landing
      expect(touched).toBeGreaterThan(2000);
      expect(
        worst,
        `the grading left a 1 yard step of ${worst.toFixed(2)} at ${at}, which is a wall`,
      ).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    });
  });

  it('never makes any slope in the region steeper than it already was', () => {
    ungraded((baseline) => {
      const step = (at: (x: number, z: number) => number, x: number, z: number) =>
        Math.max(Math.abs(at(x + 1, z) - at(x, z)), Math.abs(at(x, z + 1) - at(x, z)));
      let worstNow = 0;
      let worstBefore = 0;
      for (let z = 62; z <= 188; z++)
        for (let x = 757; x <= 888; x++) {
          worstNow = Math.max(worstNow, step(th, x, z));
          worstBefore = Math.max(worstBefore, step(baseline, x, z));
        }
      expect(worstNow).toBeLessThanOrEqual(worstBefore + 0.01);
    });
  });
});
