// The railing completeness audit (J5): the owner asked for a way to CONFIRM
// IN CODE that every stretch of boardwalk over open water carries a railing,
// after a stretch shipped with the rail visually buried under a rising seam
// ramp while the mechanical gate stayed green. Everything here derives from
// HarborDef alone (the same records the collider builder, the heightfield,
// and the render consume), so the audit can never drift from what ships.
//
// Two arms:
// 1. unrailedDeckEdgeGaps: every land-deck edge segment whose far side is a
//    plunge (open water, or deeper than any authored boardwalk step) must be
//    covered by a rail collider, except explicit authored openings passed as
//    allowances. Ship decks are out of scope: their rails are generated from
//    the measured hull and the model's own bulwark is the visual guard.
// 2. buriedRailSamples: along every rail run, the DRAWN protection top
//    (supplied by the caller, e.g. the render's rail height profile) must
//    clear the walkable surface a player can stand on beside the rail. This
//    is what failed on the outer piers: the collider was fine, the visual
//    was drawn at one center-sampled height and dove under the ramp.

import { type HarborDef, type HarborRail, harborSurfaceHeight } from './harbor_layout';
import { PLAYER_BODY_RADIUS } from './pathfind';

/** Sampling step along a deck edge or rail run. */
export const RAIL_AUDIT_STEP_YARDS = 0.1;

/** How far past a deck edge the far-side surface is probed. */
export const RAIL_AUDIT_BEYOND_PROBE_YARDS = 0.45;

/** Deepest drop that still counts as authored boardwalk (the Gullhaven
 * apron-to-pier walkway seam steps down ~1.7 onto planks); anything deeper,
 * or open water (-Infinity), is a plunge that needs a rail. */
export const RAIL_AUDIT_MAX_SAFE_DROP_YARDS = 1.8;

/** An unprotected stretch narrower than the player's body never passes a
 * mover, so it is filtered (the berth heads keep a few authored slivers
 * between a rail end and a ramp shoulder). */
export const RAIL_AUDIT_IMPASSABLE_GAP_YARDS = PLAYER_BODY_RADIUS * 2;

/** A rail protects an edge when its line lies within this of the edge line
 * (rails are authored ON deck edges). */
export const RAIL_AUDIT_RAIL_LINE_TOLERANCE_YARDS = 0.35;

/** Minimum height the drawn protection must keep above the adjacent walkable
 * footing everywhere along a run. The nominal cap rides HARBOR_RAIL_HEIGHT
 * (1.05) above it; the slack absorbs the sloped-cap corner cut where a ramp
 * meets a level stretch and the one-bay transition at an authored deck step. */
export const RAIL_MIN_GUARD_YARDS = 0.5;

/** Lateral shoulder probes for the buried-rail arm, finer than and chosen
 * independently of the render profile's probe set so the check is not a
 * self-comparison. */
const BURIED_RAIL_PROBE_OFFSETS_YARDS = [0, 0.2, 0.35, 0.5, 0.7] as const;

export type DeckEdgeSide = 'x-' | 'x+' | 'z-' | 'z+';

export interface DeckEdgeGap {
  harborId: HarborDef['id'];
  deckIndex: number;
  edge: DeckEdgeSide;
  /** The fixed coordinate of the edge line (x for x-edges, z for z-edges). */
  edgeCoord: number;
  /** Unprotected hazard span along the edge (z-range for x-edges). */
  from: number;
  to: number;
}

/** An authored opening the audit accepts (e.g. an arrival-sweep corner). */
export interface DeckEdgeGapAllowance {
  harborId: HarborDef['id'];
  edge: DeckEdgeSide;
  edgeCoord: number;
  from: number;
  to: number;
}

interface EdgeSpec {
  edge: DeckEdgeSide;
  edgeCoord: number;
  alongMin: number;
  alongMax: number;
  outwardX: number;
  outwardZ: number;
}

function deckEdges(deck: { x: number; z: number; hw: number; hd: number }): EdgeSpec[] {
  return [
    {
      edge: 'x-',
      edgeCoord: deck.x - deck.hw,
      alongMin: deck.z - deck.hd,
      alongMax: deck.z + deck.hd,
      outwardX: -1,
      outwardZ: 0,
    },
    {
      edge: 'x+',
      edgeCoord: deck.x + deck.hw,
      alongMin: deck.z - deck.hd,
      alongMax: deck.z + deck.hd,
      outwardX: 1,
      outwardZ: 0,
    },
    {
      edge: 'z-',
      edgeCoord: deck.z - deck.hd,
      alongMin: deck.x - deck.hw,
      alongMax: deck.x + deck.hw,
      outwardX: 0,
      outwardZ: -1,
    },
    {
      edge: 'z+',
      edgeCoord: deck.z + deck.hd,
      alongMin: deck.x - deck.hw,
      alongMax: deck.x + deck.hw,
      outwardX: 0,
      outwardZ: 1,
    },
  ];
}

function railCoversAlong(rail: HarborRail, spec: EdgeSpec, along: number): boolean {
  const xEdge = spec.outwardX !== 0;
  // An x-edge runs along z, so its guarding rail runs along z too (rot PI/2).
  const railRunsAlongZ = rail.rot !== 0;
  if (xEdge !== railRunsAlongZ) return false;
  const fixed = xEdge ? rail.x : rail.z;
  if (Math.abs(fixed - spec.edgeCoord) > RAIL_AUDIT_RAIL_LINE_TOLERANCE_YARDS) return false;
  const center = xEdge ? rail.z : rail.x;
  return Math.abs(along - center) <= rail.hw + 1e-6;
}

function allowanceCovers(
  allowances: readonly DeckEdgeGapAllowance[],
  harborId: HarborDef['id'],
  spec: EdgeSpec,
  from: number,
  to: number,
): boolean {
  return allowances.some(
    (a) =>
      a.harborId === harborId &&
      a.edge === spec.edge &&
      Math.abs(a.edgeCoord - spec.edgeCoord) <= 0.1 &&
      from >= a.from - 0.1 &&
      to <= a.to + 0.1,
  );
}

/**
 * Arm 1: every land-deck edge segment over a plunge, not covered by a rail
 * collider, wider than a player body, and not an explicit authored opening.
 */
export function unrailedDeckEdgeGaps(
  harbor: HarborDef,
  allowances: readonly DeckEdgeGapAllowance[] = [],
): DeckEdgeGap[] {
  const gaps: DeckEdgeGap[] = [];
  for (const [deckIndex, deck] of harbor.decks.entries()) {
    for (const spec of deckEdges(deck)) {
      const span = spec.alongMax - spec.alongMin;
      const steps = Math.max(1, Math.ceil(span / RAIL_AUDIT_STEP_YARDS));
      let runStart: number | null = null;
      let runEnd = 0;
      const closeRun = () => {
        if (runStart === null) return;
        const width = runEnd - runStart;
        if (
          width >= RAIL_AUDIT_IMPASSABLE_GAP_YARDS &&
          !allowanceCovers(allowances, harbor.id, spec, runStart, runEnd)
        ) {
          gaps.push({
            harborId: harbor.id,
            deckIndex,
            edge: spec.edge,
            edgeCoord: spec.edgeCoord,
            from: runStart,
            to: runEnd,
          });
        }
        runStart = null;
      };
      for (let i = 0; i < steps; i++) {
        const along = spec.alongMin + ((i + 0.5) / steps) * span;
        const px = spec.outwardX !== 0 ? spec.edgeCoord : along;
        const pz = spec.outwardX !== 0 ? along : spec.edgeCoord;
        const hereY = harborSurfaceHeight(harbor, px, pz);
        const beyond = harborSurfaceHeight(
          harbor,
          px + spec.outwardX * RAIL_AUDIT_BEYOND_PROBE_YARDS,
          pz + spec.outwardZ * RAIL_AUDIT_BEYOND_PROBE_YARDS,
        );
        const plunge = beyond === -Infinity || hereY - beyond > RAIL_AUDIT_MAX_SAFE_DROP_YARDS;
        const railed = plunge && harbor.rails.some((rail) => railCoversAlong(rail, spec, along));
        if (plunge && !railed) {
          const lo = spec.alongMin + (i / steps) * span;
          const hi = spec.alongMin + ((i + 1) / steps) * span;
          if (runStart === null) runStart = lo;
          runEnd = hi;
        } else {
          closeRun();
        }
      }
      closeRun();
    }
  }
  return gaps;
}

export interface BuriedRailSample {
  harborId: HarborDef['id'];
  railIndex: number;
  x: number;
  z: number;
  along: number;
  requiredTopY: number;
  plannedTopY: number;
}

/**
 * Arm 2: along every rail run, the drawn protection top must stay at least
 * RAIL_MIN_GUARD_YARDS above the highest walkable footing within a
 * shoulder's reach of the rail line. `plannedTopAt` supplies the drawn top
 * (the render's rail height profile) so the sim stays free of render
 * imports; the required side is sampled here, independently.
 */
export function buriedRailSamples(
  harbor: HarborDef,
  plannedTopAt: (rail: HarborRail, railIndex: number, along: number) => number,
): BuriedRailSample[] {
  const findings: BuriedRailSample[] = [];
  for (const [railIndex, rail] of harbor.rails.entries()) {
    const alongX = rail.rot === 0;
    const steps = Math.max(1, Math.ceil((rail.hw * 2) / RAIL_AUDIT_STEP_YARDS));
    for (let i = 0; i <= steps; i++) {
      const along = -rail.hw + (i / steps) * rail.hw * 2;
      const px = alongX ? rail.x + along : rail.x;
      const pz = alongX ? rail.z : rail.z + along;
      let footing = -Infinity;
      for (const offset of BURIED_RAIL_PROBE_OFFSETS_YARDS) {
        for (const side of offset === 0 ? [1] : [-1, 1]) {
          footing = Math.max(
            footing,
            harborSurfaceHeight(
              harbor,
              alongX ? px : px + side * offset,
              alongX ? pz + side * offset : pz,
            ),
          );
        }
      }
      if (footing === -Infinity) continue;
      const requiredTopY = footing + RAIL_MIN_GUARD_YARDS;
      const plannedTopY = plannedTopAt(rail, railIndex, along);
      if (plannedTopY + 1e-6 < requiredTopY) {
        findings.push({
          harborId: harbor.id,
          railIndex,
          x: px,
          z: pz,
          along,
          requiredTopY,
          plannedTopY,
        });
      }
    }
  }
  return findings;
}
