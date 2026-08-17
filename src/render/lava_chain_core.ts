// The Drakelands lava chain: where every modeled lava piece goes, as plain
// numbers. Three-free and DOM-free so a Vitest can pin the geometry without
// a renderer (render/ember_features.ts is the thin consumer).
//
// A lava AREA is exactly THREE pieces: a POOL, one RIVER MIDDLE, and one
// RIVER END. The middle is the piece that connects the other two, and there
// is only ever one of it. Tiling a chain of middles down a long run is what
// produced areas built from eleven overlapping models reading as a single
// smear, so a run is sized to its one piece rather than a piece count being
// derived from the run.
//
// Two rules do the work, and both were arithmetic bugs before:
//
// 1. SCALE BY THE CROSS EXTENT. instanceProp normalizes a model so its
//    LONGEST horizontal extent equals fp, and the old code passed the
//    channel WIDTH as fp. That set each piece's LENGTH to the channel
//    width, and since the models have different aspects the channel visibly
//    pinched and bulged piece to piece. Deriving fp from the measured cross
//    ratio makes the rendered channel exactly link.w wide for all three.
//
// 2. PLACE BY THE MELT SURFACE. Every piece used to be dropped at
//    terrain - 0.1, so its melt landed meltRatio * fp above that: a
//    different height for every piece size, which stepped up and down along
//    a single run. Seating each piece so its melt lands on one line makes
//    the surface continuous.
//
// Measured per-piece constants live in LAVA_PIECE_METRICS and are pinned
// against the shipped GLBs by tests/lava_chain_core.test.ts, so a re-export
// that changes a model's proportions fails loudly instead of drifting.

import type { EmberLavaLink } from '../sim/ember_lava_layout';
import { emberLinkPolyline } from '../sim/ember_lava_layout';

/**
 * Per-piece geometry, all normalized by the model's FOOT (its longest
 * horizontal extent), which is what instanceProp scales to fp.
 *
 * `cross` is the bbox extent across the flow over the foot.
 * `melt` is the median height of the molten surface over the model base,
 * sampled over the central half of the cross extent (one band for all three
 * pieces, so the numbers are comparable).
 * `plateau` is the run-length fraction holding at least 90 percent of the
 * piece's full width: the most a middle may advance and still leave a
 * full-width channel behind it.
 */
export const LAVA_PIECE_METRICS = {
  pool: { cross: 0.9066, melt: 0.0387 },
  mid: { cross: 0.5553, melt: 0.0224, plateau: 0.3 },
  end: { cross: 0.6366, melt: 0.0467 },
} as const;

/** how far a river's melt surface rides over the ground it is bedded on */
export const MELT_LIFT = 0.35;

/** the river models run along local +x, so their channel needs a quarter turn */
const RIVER_AXIS_OFFSET = -Math.PI / 2;

export type LavaPieceKind = 'mid' | 'end';

export interface LavaPlacement {
  kind: LavaPieceKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  fp: number;
}

/** the fp that renders a piece exactly `w` wide across the flow */
export function lavaPieceFp(kind: LavaPieceKind, w: number): number {
  return w / LAVA_PIECE_METRICS[kind].cross;
}

/** how a run terminates at each mouth: into a pool, or on open ground */
export type LavaMouth = 'pool' | 'cap';

function arcSampler(link: EmberLavaLink): {
  len: number;
  at: (d: number) => { x: number; z: number };
} {
  const pts = emberLinkPolyline(link);
  const arc: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const len = arc[arc.length - 1];
  const at = (d: number): { x: number; z: number } => {
    const c = Math.min(Math.max(d, 0), len);
    let i = 1;
    while (i < arc.length - 1 && arc[i] < c) i++;
    const t = (c - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]);
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
    };
  };
  return { len, at };
}

/**
 * Every piece one link renders, laid along its shared meander polyline.
 *
 * `groundAt` is the height the melt is bedded on (the caller passes the
 * live terrain sampler; the graded bed under a link already follows this
 * same curve, and inside a receiving basin the terrain drops below the
 * authored bed, which is where the river should pour to).
 *
 * Middles tile from the head trim to the tail trim, stepping by the
 * measured plateau so each piece's full-width band starts where its
 * predecessor's ends and both pinched tails hide under a neighbour. The
 * last centre is CLAMPED to the run's end so no piece overshoots its pool.
 */
export function lavaChainPlacements(
  link: EmberLavaLink,
  mouths: { m0: LavaMouth; m1: LavaMouth },
  groundAt: (x: number, z: number) => number,
): LavaPlacement[] {
  const { len, at } = arcSampler(link);
  const out: LavaPlacement[] = [];
  const midFp = lavaPieceFp('mid', link.w);
  const endFp = lavaPieceFp('end', link.w);
  const midSink = LAVA_PIECE_METRICS.mid.melt * midFp;
  const endSink = LAVA_PIECE_METRICS.end.melt * endFp;

  const place = (kind: LavaPieceKind, d: number, yawExtra: number, fp: number, sink: number) => {
    const here = at(d);
    const ahead = at(Math.min(len, d + 1.5));
    const tangent = Math.atan2(ahead.x - here.x, ahead.z - here.z);
    out.push({
      kind,
      x: here.x,
      z: here.z,
      y: groundAt(here.x, here.z) + MELT_LIFT - sink,
      rot: tangent + RIVER_AXIS_OFFSET + yawExtra,
      fp,
    });
  };

  // The one middle sits between the pool's edge and the end cap, so its
  // body covers the whole gap without either neighbour needing a second
  // piece to reach it.
  const d0 = link.trim0 + (mouths.m0 === 'cap' ? endFp * 0.5 : 0);
  const d1 = len - link.trim1 - (mouths.m1 === 'cap' ? endFp * 0.5 : 0);
  if (d1 > d0) place('mid', (d0 + d1) / 2, 0, midFp, midSink);

  // An end cap points UPflow: the model tapers toward local -x, so the far
  // half turn puts its thin tip at the terminus and its body back up the
  // channel, which is the way a flow actually thins out as it spends.
  if (mouths.m0 === 'cap') place('end', link.trim0, Math.PI, endFp, endSink);
  if (mouths.m1 === 'cap') place('end', len - link.trim1, 0, endFp, endSink);
  return out;
}

/** Test-only window into the derived spacing, so a suite can restate it. */
export const lavaChainInternalsForTest = { RIVER_AXIS_OFFSET, arcSampler };
