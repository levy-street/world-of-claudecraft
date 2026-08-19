// Both castles as a MAP PLAN: the curtain runs, tower squares and inner
// courts of the Last Keep and Dawnhold, as axis-aligned world rects the map
// window can project and stroke.
//
// The castles were invisible on the map even though both are named there.
// The baked plate paints from terrainHeight, and a curtain wall is not
// terrain there: it is lift field added on top (terrainHeight at the Last
// Keep's east wall is the 6.0 pad, while groundHeight is the 13.0 walk), so
// no wall, tower or gate ever reached the plate. The bailey buildings are
// decorProps, which the map's detail pass does not read either.
//
// Drawing the plan as a VECTOR overlay rather than baking it keeps it crisp
// at every zoom (the plate is 1.33 px/yd against 5.6 to 6.0 px/yd on screen
// at max zoom, so a baked wall would be upscaled over four times), needs no
// re-bake, and lets the gates read as real gaps: a gate is simply the
// absence of a run.
//
// Geometry is DERIVED from the authored layouts, never re-typed, so a wall
// that moves in the sim moves on the map in the same change.
//
// Pure core: no DOM, no i18n, no color. The painter owns all three.

import { BARBICAN, CASTLE, CASTLE_GATES, CASTLE_TOWERS, GARDEN } from '../sim/castle_layout';
import {
  DAWNHOLD,
  DAWNHOLD_COURT,
  DAWNHOLD_COURT_GATE,
  DAWNHOLD_GATES,
  DAWNHOLD_TOWERS,
} from '../sim/dawnhold_layout';

/** an axis-aligned world rect: centre plus half extents */
export interface PlanRect {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
}

export type PlanPart = 'wall' | 'tower' | 'court';

export interface CastlePlan {
  id: string;
  /** the castle's centre, for a continent-scale landmark glyph */
  cx: number;
  cz: number;
  /** world bounds, for the view cull and for sizing a glyph */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  parts: { part: PlanPart; rect: PlanRect }[];
}

/**
 * One wall line split by its gate spans: a run per solid stretch, and
 * nothing where a gate opens. `axis` is the line's own axis, so an 'x' wall
 * runs along z at a fixed x.
 */
function wallRuns(
  axis: 'x' | 'z',
  line: number,
  a0: number,
  a1: number,
  th: number,
  gates: readonly { a0: number; a1: number }[],
): { part: PlanPart; rect: PlanRect }[] {
  const spans: [number, number][] = [];
  let cur = a0;
  for (const g of [...gates].sort((p, q) => p.a0 - q.a0)) {
    if (g.a0 > cur) spans.push([cur, Math.min(g.a0, a1)]);
    cur = Math.max(cur, g.a1);
  }
  if (cur < a1) spans.push([cur, a1]);
  const half = th / 2;
  return spans
    .filter((s) => s[1] - s[0] > 0.01)
    .map((s) => {
      const mid = (s[0] + s[1]) / 2;
      const len = (s[1] - s[0]) / 2;
      return {
        part: 'wall' as const,
        rect:
          axis === 'x'
            ? { cx: line, cz: mid, hw: half, hd: len }
            : { cx: mid, cz: line, hw: len, hd: half },
      };
    });
}

function bounds(parts: { rect: PlanRect }[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { rect } of parts) {
    minX = Math.min(minX, rect.cx - rect.hw);
    maxX = Math.max(maxX, rect.cx + rect.hw);
    minZ = Math.min(minZ, rect.cz - rect.hd);
    maxZ = Math.max(maxZ, rect.cz + rect.hd);
  }
  return { minX, maxX, minZ, maxZ };
}

function lastKeepPlan(): CastlePlan {
  const th = CASTLE.wallTh;
  const parts: { part: PlanPart; rect: PlanRect }[] = [];
  // the ward terrace, drawn under the walls so the keep's own yard reads
  parts.push({
    part: 'court',
    rect: {
      cx: (CASTLE.ward.x0 + CASTLE.ward.x1) / 2,
      cz: (CASTLE.ward.z0 + CASTLE.ward.z1) / 2,
      hw: (CASTLE.ward.x1 - CASTLE.ward.x0) / 2,
      hd: (CASTLE.ward.z1 - CASTLE.ward.z0) / 2,
    },
  });
  // the curtain: west and east run along z, north and south along x
  parts.push(
    ...wallRuns('x', CASTLE.wx0, CASTLE.wz0, CASTLE.wz1, th, [CASTLE_GATES.main]),
    ...wallRuns('x', CASTLE.wx1, CASTLE.wz0, CASTLE.wz1, th, [CASTLE_GATES.breach]),
    ...wallRuns('z', CASTLE.wz0, CASTLE.wx0, CASTLE.wx1, th, [CASTLE_GATES.postern]),
    ...wallRuns('z', CASTLE.wz1, CASTLE.wx0, CASTLE.wx1, th, []),
  );
  // the barbican: the outer work west of the main gate
  parts.push(
    ...wallRuns('x', BARBICAN.x, BARBICAN.z0, BARBICAN.z1, BARBICAN.th, [CASTLE_GATES.outer]),
    ...wallRuns('z', BARBICAN.z0, BARBICAN.x, CASTLE.wx0, BARBICAN.th, []),
    ...wallRuns('z', BARBICAN.z1, BARBICAN.x, CASTLE.wx0, BARBICAN.th, []),
  );
  // the garden annex south of the curtain: its own south wall plus two
  // side returns up to the curtain (the sim builds exactly these three)
  parts.push(
    ...wallRuns('z', GARDEN.wallZ, GARDEN.x0, GARDEN.x1, GARDEN.th, GARDEN.gates),
    ...wallRuns('x', GARDEN.x0, CASTLE.wz1, GARDEN.wallZ, GARDEN.th, []),
    ...wallRuns('x', GARDEN.x1, CASTLE.wz1, GARDEN.wallZ, GARDEN.th, []),
  );
  for (const t of CASTLE_TOWERS) {
    parts.push({ part: 'tower', rect: { cx: t.x, cz: t.z, hw: t.hw, hd: t.hw } });
  }
  return {
    id: 'the_last_keep',
    cx: (CASTLE.wx0 + CASTLE.wx1) / 2,
    cz: (CASTLE.wz0 + CASTLE.wz1) / 2,
    ...bounds(parts),
    parts,
  };
}

function dawnholdPlan(): CastlePlan {
  const th = DAWNHOLD.wallTh;
  const parts: { part: PlanPart; rect: PlanRect }[] = [];
  // the flower court off the south wall
  parts.push({
    part: 'court',
    rect: {
      cx: (DAWNHOLD_COURT.x0 + DAWNHOLD_COURT.x1) / 2,
      cz: (DAWNHOLD.wz1 + DAWNHOLD_COURT.z1) / 2,
      hw: (DAWNHOLD_COURT.x1 - DAWNHOLD_COURT.x0) / 2,
      hd: (DAWNHOLD_COURT.z1 - DAWNHOLD.wz1) / 2,
    },
  });
  parts.push(
    ...wallRuns('x', DAWNHOLD.wx0, DAWNHOLD.wz0, DAWNHOLD.wz1, th, []),
    ...wallRuns('x', DAWNHOLD.wx1, DAWNHOLD.wz0, DAWNHOLD.wz1, th, [DAWNHOLD_GATES.main]),
    ...wallRuns('z', DAWNHOLD.wz0, DAWNHOLD.wx0, DAWNHOLD.wx1, th, []),
    ...wallRuns('z', DAWNHOLD.wz1, DAWNHOLD.wx0, DAWNHOLD.wx1, th, [DAWNHOLD_GATES.postern]),
  );
  // the court's own three garden walls (the curtain closes its north side)
  parts.push(
    ...wallRuns('x', DAWNHOLD_COURT.x0, DAWNHOLD.wz1, DAWNHOLD_COURT.z1, DAWNHOLD_COURT.th, []),
    ...wallRuns('x', DAWNHOLD_COURT.x1, DAWNHOLD.wz1, DAWNHOLD_COURT.z1, DAWNHOLD_COURT.th, []),
    ...wallRuns('z', DAWNHOLD_COURT.z1, DAWNHOLD_COURT.x0, DAWNHOLD_COURT.x1, DAWNHOLD_COURT.th, [
      DAWNHOLD_COURT_GATE,
    ]),
  );
  for (const t of DAWNHOLD_TOWERS) {
    parts.push({ part: 'tower', rect: { cx: t.x, cz: t.z, hw: t.hw, hd: t.hw } });
  }
  return {
    id: 'dawnhold_castle',
    cx: (DAWNHOLD.wx0 + DAWNHOLD.wx1) / 2,
    cz: (DAWNHOLD.wz0 + DAWNHOLD.wz1) / 2,
    ...bounds(parts),
    parts,
  };
}

/** Both castles' plans, built once from the authored layouts. */
export const CASTLE_MAP_PLANS: readonly CastlePlan[] = [lastKeepPlan(), dawnholdPlan()];

/** a plan part projected into canvas space */
export interface CastlePlanMarker {
  part: PlanPart;
  mx: number;
  my: number;
  w: number;
  h: number;
}

/**
 * Every plan part of every castle overlapping `region`, projected through
 * `toMap`. Rects are normalized so w/h stay positive whatever the
 * projection's axis directions.
 */
export function buildCastlePlanMarkers(
  region: { minX: number; maxX: number; minZ: number; maxZ: number },
  toMap: (x: number, z: number) => { mx: number; my: number },
): CastlePlanMarker[] {
  const out: CastlePlanMarker[] = [];
  for (const plan of CASTLE_MAP_PLANS) {
    if (
      plan.maxX < region.minX ||
      plan.minX > region.maxX ||
      plan.maxZ < region.minZ ||
      plan.minZ > region.maxZ
    ) {
      continue;
    }
    for (const { part, rect } of plan.parts) {
      const a = toMap(rect.cx - rect.hw, rect.cz - rect.hd);
      const b = toMap(rect.cx + rect.hw, rect.cz + rect.hd);
      out.push({
        part,
        mx: Math.min(a.mx, b.mx),
        my: Math.min(a.my, b.my),
        w: Math.abs(b.mx - a.mx),
        h: Math.abs(b.my - a.my),
      });
    }
  }
  return out;
}
