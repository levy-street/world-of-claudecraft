// Prove a collision plan against the mesh it claims to describe.
//
// This is the check that was missing the first time round, when the ferry's
// walkable rects were typed in by eye and then quietly stopped matching the
// boat. It re-derives the answer from the shipped geometry and reports every
// disagreement, so art and collision drifting apart is a build failure rather
// than something a player discovers by falling through a deck.
//
// The exporter runs it on what it just built, and the vitest runs it on what
// is committed. Same function, so there is one definition of "they agree".

import {
  buildColumnIndex,
  columnHits,
  standableHeights,
  triangleBounds,
} from '../lib/mesh_collision.mjs';

const DEFAULT_PROBE_STEP = 0.2;

function insideRect(rect, x, z) {
  return (
    x >= rect.x - rect.hw && x <= rect.x + rect.hw && z >= rect.z - rect.hd && z <= rect.z + rect.hd
  );
}

/**
 * @returns {{problems: string[], stats: object}} problems is empty when the
 * plan and the mesh agree. Every entry names the coordinate that disagrees,
 * because "the deck moved" is useless and "no floor at (2.1, -1.4)" is not.
 */
export function verifyPlanAgainstMesh(triangles, plan, options = {}) {
  const problems = [];
  const boundsEpsilon = options.boundsEpsilon ?? plan.measurementEpsilons.raw;
  const surfaceTolerance = options.surfaceTolerance ?? 0.25;
  const probeStep = options.probeStep ?? DEFAULT_PROBE_STEP;
  const headroom = options.headroom ?? 1.6;
  const furnitureCeiling = options.furnitureCeiling ?? 2;

  const bounds = triangleBounds(triangles);
  const index = buildColumnIndex(triangles, bounds, probeStep);
  // Deck support asks "is there floor here", NOT "can a person stand here with
  // headroom". Those differ under rigging: a stay coming down to the rail robs
  // the headroom without removing the plank, and a deck you duck under is
  // still a deck. Headroom belongs to the standable classifier, not to this.
  const surfacesAt = (x, z) =>
    columnHits(triangles, index, x, z)
      .filter((hit) => hit.up >= 0.8)
      .map((hit) => hit.y);
  const anyGeometryAbove = (x, z, floorY, ceiling) =>
    columnHits(triangles, index, x, z).some(
      (hit) => hit.y > floorY + 0.05 && hit.y <= floorY + ceiling,
    );

  // ---- the model's own dimensions ------------------------------------------
  const measured = {
    length: bounds.max[0] - bounds.min[0],
    beam: bounds.max[2] - bounds.min[2],
    height: bounds.max[1] - bounds.min[1],
    keelY: bounds.min[1],
  };
  for (const key of ['length', 'beam', 'height', 'keelY']) {
    if (Math.abs(measured[key] - plan.model[key]) > boundsEpsilon) {
      problems.push(
        `model.${key}: plan says ${plan.model[key]}, mesh measures ${measured[key]}`,
      );
    }
  }

  // ---- every walkable rect is actually floor -------------------------------
  const blockers = plan.blockingVolumes.filter((volume) => volume.topY === null);
  let supported = 0;
  let blocked = 0;
  const holes = [];
  for (const deck of plan.decks) {
    for (let x = deck.x - deck.hw + probeStep / 2; x < deck.x + deck.hw; x += probeStep) {
      for (let z = deck.z - deck.hd + probeStep / 2; z < deck.z + deck.hd; z += probeStep) {
        // A spot you cannot stand is fine ONLY when the plan already says
        // something solid is there. Unsupported and unblocked is a hole.
        if (blockers.some((volume) => insideRect(volume, x, z))) {
          blocked++;
          continue;
        }
        const floors = surfacesAt(x, z);
        if (floors.some((y) => Math.abs(y - deck.y) <= surfaceTolerance)) {
          supported++;
          continue;
        }
        holes.push({ x: +x.toFixed(3), z: +z.toFixed(3), found: floors.map((y) => +y.toFixed(3)) });
      }
    }
  }
  if (holes.length > 0) {
    const sample = holes
      .slice(0, 6)
      .map((hole) => `(${hole.x}, ${hole.z})->[${hole.found.join(',')}]`)
      .join(' ');
    problems.push(
      `${holes.length} walkable probe(s) have no deck at the planned height: ${sample}`,
    );
  }

  // ---- the gangway opening really is open ----------------------------------
  const edge = plan.rampMatingEdge;
  const deckY = plan.decks[0].y;
  let obstructed = 0;
  for (
    let x = edge.x - edge.halfWidth + probeStep / 2;
    x < edge.x + edge.halfWidth;
    x += probeStep
  ) {
    if (anyGeometryAbove(x, edge.z, deckY, furnitureCeiling)) obstructed++;
  }
  if (obstructed > 0) {
    problems.push(
      `the gangway opening at x=${edge.x} is blocked above the deck at ${obstructed} probe(s)`,
    );
  }

  // ---- a rail run follows a real bulwark -----------------------------------
  // A rail collider fences the DECK edge; the bulwark it represents sits just
  // outboard of that line. Probing only the line itself samples open deck and
  // reports every rail as unbacked, so step outboard as well.
  const deckRect = plan.decks[0];
  const outboard = [0, probeStep, probeStep * 2, probeStep * 3];
  for (const rail of plan.rails) {
    if (rail.hw <= 0) continue;
    const alongZ = rail.rot !== 0;
    const sign = alongZ ? Math.sign(rail.x - deckRect.x) : Math.sign(rail.z - deckRect.z);
    let backed = 0;
    let samples = 0;
    for (let offset = -rail.hw + probeStep / 2; offset < rail.hw; offset += probeStep) {
      const baseX = alongZ ? rail.x : rail.x + offset;
      const baseZ = alongZ ? rail.z + offset : rail.z;
      samples++;
      const found = outboard.some((step) =>
        anyGeometryAbove(
          alongZ ? baseX + sign * step : baseX,
          alongZ ? baseZ : baseZ + sign * step,
          deckY,
          rail.height + furnitureCeiling,
        ),
      );
      if (found) backed++;
    }
    // Not every inch: an art bulwark dips at the sheer and around fittings.
    if (samples > 0 && backed / samples < (options.railBackingFloor ?? 0.6)) {
      problems.push(
        `rail "${rail.id}" has no bulwark behind it at ${samples - backed}/${samples} probes`,
      );
    }
  }

  // ---- a blocker blocks something that exists ------------------------------
  for (const volume of plan.blockingVolumes) {
    if (volume.kind !== 'superstructure') continue;
    const hits = columnHits(triangles, index, volume.x, volume.z);
    if (!hits.some((hit) => hit.y > deckY && hit.y <= volume.cameraTopY + surfaceTolerance)) {
      problems.push(`blocker "${volume.id}" stands where the mesh has nothing`);
    }
  }

  return {
    problems,
    stats: {
      triangles: triangles.length,
      measured,
      deckProbes: supported + blocked + holes.length,
      supported,
      blocked,
      holes: holes.length,
    },
  };
}
