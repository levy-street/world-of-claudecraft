// The grand ferry build: art in, shipped asset and collision plan out.
//
// The art is not authored here and never will be. It comes from an art tool as
// a finished GLB (source/grand_ferry_ship_art.glb) and this module does three
// things to it, all of them scripted so the whole result rebuilds from source:
//
//   1. SURVEY the pristine hull: where its floor sits, and how wide the clear
//      space runs between its sides, station by station.
//   2. EDIT it: deck over the structural floor timbers, and cut the bulwark
//      open where the gangplank has to mate. Both are corrections a hull needs
//      before it is a boat people board, and both re-apply every build.
//   3. MEASURE the edited result into the walkable plan the sim consumes.
//
// The authored part of this file is INTENT ("deck her from here to here",
// "the gangway goes on the port side amidships"). Every dimension that has to
// agree with the mesh is measured, which is the point: art and collision
// cannot drift apart when one is derived from the other.
//
// Two findings from this hull drove the shape of the code, and both generalise:
//
//   The deck TAPERS but does not STEP. Her sides are about a yard and a third
//   further apart forward than aft, so a single rectangle either leaves a
//   trench along the bulwark or pokes through it; the deck is therefore a run
//   of rectangles that follow her width. Her floor also sits lower forward,
//   but the deck stays at ONE height across all of them, because the movement
//   kernel gates climbing by SLOPE and a height change between two abutting
//   flat rects has no run at all: it would be an invisible wall amidships.
//
// Everything below is in WORLD YARDS, the units the harbour is authored in,
// converted to the model's own units once at the boundary.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addBoxMesh, plankedSlabBoxes, removeTrianglesInBox } from '../lib/glb_edit.mjs';
import { documentTriangles, glbIO } from '../lib/glb_geometry.mjs';
import {
  buildColumnIndex,
  measureFootprintObstacles,
  measureMesh,
  measureSideClearance,
  measureSilhouette,
  snap,
  surveyRegionFloor,
  triangleBounds,
} from '../lib/mesh_collision.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const FERRY_ART_SOURCE = 'scripts/assets/grand_ferry_ship/source/grand_ferry_ship_art.glb';

export const FERRY_BUILD = Object.freeze({
  /** The berth the hull is scaled into. Authored: this is a design decision. */
  berth: Object.freeze({ length: 60, waterlineY: -4.5, draft: 2.5 }),

  /** Probe pitch and body size, in world yards. The body numbers mirror the
   *  sim's own player collider, so "can a person stand here" means the same
   *  thing in the measurement as it does in play. */
  probe: Object.freeze({
    gridStep: 0.35,
    headroom: 2.6,
    bodyWidth: 1.6,
    levelTolerance: 0.5,
  }),

  /** Deck her from the aft end of the open hull to the break of the
   *  forecastle. The ENDS are authored intent; the height, the width and the
   *  taper are surveyed off the hull. */
  deck: Object.freeze({
    fromX: -11.5,
    toX: 10.8,
    /** Floor heights within this much of each other are the same deck. Wider
     *  than the timber ripple, narrower than the step up to a castle. */
    plateauBand: 0.45,
    /** Ride this fraction of the timber tops. Not the outright peak: one proud
     *  fitting would lift the whole deck and swallow the bulwark. */
    heightPercentile: 0.97,
    /** Lay the planks this far proud of the timbers, so the deck reads as
     *  sitting ON the frames rather than sunk into them. */
    lift: 0.05,
    /** One deck rectangle per this much length, before merging. Short enough
     *  to follow the hull, long enough not to shatter it into slivers. */
    bandLength: 3.7,
    /** Neighbouring bands within this much of each other in width merge into
     *  one rectangle. */
    bandMergeTolerance: 0.5,
    /** Hold the planking this far inside the measured clear span so it never
     *  fights the hull skin. */
    sideMargin: 0.2,
    /** How far BELOW the laid deck the original floor may fall and still count
     *  as inside the hull. Her forward well sits lower than her aft floor, and
     *  the width scan must not mistake that for the edge of the boat. */
    wellDepth: 1.5,
    /** A bulwark is chest-high furniture, so it is looked for within this far
     *  of the deck. Anything higher in that column is rigging. */
    furnitureCeiling: 3,
    thickness: 0.3,
    plankPitch: 0.62,
    plankLength: 5.2,
    /** Boards BUTT, they do not gap. A walkable surface with slots in it lets
     *  probes (and daylight) through to the frames below, which reads to the
     *  measurement as a deck full of holes. Planking shows through tone and
     *  staggered joints instead. */
    seam: 0,
    /** Warm weathered oak, three tones cycling like the harbour boardwalk. */
    tones: Object.freeze([
      Object.freeze([0.545, 0.404, 0.243]),
      Object.freeze([0.478, 0.345, 0.204]),
      Object.freeze([0.596, 0.451, 0.286]),
    ]),
  }),

  /** Where the gangplank meets her: port side, amidships, clear of both masts. */
  gangway: Object.freeze({
    id: 'port-gangway',
    x: 4.25,
    halfWidth: 1.4,
    outward: 'z-',
  }),

  /** A rail run is this thick, matching the harbour's own railing colliders. */
  railHalfThickness: 0.14,
});

/**
 * Highest geometry anywhere in an XZ box: what the camera must not clip.
 *
 * `ceiling` matters more than it looks. Without it, any strip of deck lying
 * under a yard or a stay reports the RIGGING as its top, so a bulwark measured
 * this way comes back twenty yards tall. Callers asking about a low fitting
 * pass a ceiling above it and below the rig.
 */
function regionTop(columns, box, ceiling = Infinity) {
  let top = -Infinity;
  for (const column of columns) {
    if (column.x < box.minX || column.x > box.maxX) continue;
    if (column.z < box.minZ || column.z > box.maxZ) continue;
    if (column.top <= ceiling && column.top > top) top = column.top;
    for (const surface of column.surfaces) {
      if (surface <= ceiling && surface > top) top = surface;
    }
  }
  return Number.isFinite(top) ? top : null;
}

/** The highest measured LEVEL whose footprint overlaps an x span. Levels are
 *  connected floor regions, so rigging and other thin geometry never qualify. */
function levelTopOver(measurement, span) {
  let top = null;
  for (const level of measurement.levels) {
    for (const rect of level.rects) {
      if (rect.x + rect.hw < span.minX || rect.x - rect.hw > span.maxX) continue;
      if (top === null || level.y > top) top = level.y;
      break;
    }
  }
  return top;
}

/**
 * Fold per-station clearances into as few deck rectangles as will still follow
 * the hull. Each band takes the NARROWEST clearance it covers, so planking
 * never pokes through the side, and neighbours of similar width merge so the
 * plan reads like a deck rather than a barcode.
 */
function bandDeck(stations, fromX, toX, bandLength, mergeTolerance, sideMargin) {
  const bands = [];
  for (let start = fromX; start < toX - 1e-9; start += bandLength) {
    const end = Math.min(start + bandLength, toX);
    const covered = stations.filter((s) => s.x >= start - 1e-9 && s.x <= end + 1e-9);
    if (covered.length === 0) continue;
    const halfSpan = Math.min(...covered.map((s) => s.halfSpan)) - sideMargin;
    if (halfSpan <= 0) continue;
    bands.push({ fromX: start, toX: end, halfSpan });
  }
  const merged = [];
  for (const band of bands) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.halfSpan - band.halfSpan) <= mergeTolerance) {
      previous.toX = band.toX;
      previous.halfSpan = Math.min(previous.halfSpan, band.halfSpan);
      continue;
    }
    merged.push({ ...band });
  }
  return merged;
}

/**
 * Make sure a boarding opening falls inside ONE deck section.
 *
 * Bands are cut on hull width, which knows nothing about where the gangplank
 * lands, so an opening can straddle a boundary. That is not a cosmetic
 * problem: the neighbouring section would keep its own unbroken rail straight
 * across the opening, and the plank would mate to whichever edge happened to
 * be further outboard. Growing the owning band over the whole opening (and
 * taking the narrower width where it grows, so nothing overhangs) removes the
 * case entirely instead of teaching three other places to cope with it.
 */
function reserveOpening(bands, openingMinX, openingMaxX) {
  const owner = bands.find(
    (band) =>
      (openingMinX + openingMaxX) / 2 >= band.fromX &&
      (openingMinX + openingMaxX) / 2 <= band.toX,
  );
  if (!owner) return bands;
  const kept = [];
  for (const band of bands) {
    if (band === owner) {
      kept.push(band);
      continue;
    }
    if (band.toX > openingMinX && band.toX <= owner.fromX + 1e-9) {
      owner.halfSpan = Math.min(owner.halfSpan, band.halfSpan);
      band.toX = openingMinX;
      owner.fromX = openingMinX;
    }
    if (band.fromX < openingMaxX && band.fromX >= owner.toX - 1e-9) {
      owner.halfSpan = Math.min(owner.halfSpan, band.halfSpan);
      band.fromX = openingMaxX;
      owner.toX = openingMaxX;
    }
    if (band.toX - band.fromX > 1e-6) kept.push(band);
  }
  return kept.sort((left, right) => left.fromX - right.fromX);
}

/**
 * Build the shipped document and the plan measured from it.
 *
 * Returns the edited glTF document plus the plan and a readable report, so the
 * exporter can write artifacts and a probe script can print findings without
 * either of them re-implementing the build.
 */
export async function buildGrandFerry() {
  const sourcePath = path.join(REPO_ROOT, FERRY_ART_SOURCE);
  const sourceBytes = readFileSync(sourcePath);
  const document = await glbIO().read(sourcePath);
  const pristine = documentTriangles(document);
  const pristineBounds = triangleBounds(pristine);

  const modelLength = pristineBounds.max[0] - pristineBounds.min[0];
  const scale = FERRY_BUILD.berth.length / modelLength;
  const world = (yards) => yards / scale;
  const step = world(FERRY_BUILD.probe.gridStep);
  const report = { scale, modelLength };

  // ---- 1. survey the pristine hull -----------------------------------------
  const index = buildColumnIndex(pristine, pristineBounds, step);
  const deckFromX = world(FERRY_BUILD.deck.fromX);
  const deckToX = world(FERRY_BUILD.deck.toX);
  const survey = surveyRegionFloor(
    pristine,
    index,
    { minX: deckFromX, maxX: deckToX, minZ: world(-6), maxZ: world(6) },
    {
      step,
      headroom: world(FERRY_BUILD.probe.headroom),
      band: world(FERRY_BUILD.deck.plateauBand),
    },
  );
  if (survey.halfSpan === null) throw new Error('ferry survey found no deck plateau');
  const deckY = snap(
    survey.heightAt(FERRY_BUILD.deck.heightPercentile) + world(FERRY_BUILD.deck.lift),
  );
  report.survey = { ...survey, heightAt: undefined, deckY };

  const clearance = measureSideClearance(
    pristine,
    index,
    { minX: deckFromX, maxX: deckToX },
    deckY,
    {
      step,
      rise: world(FERRY_BUILD.deck.furnitureCeiling),
      limit: pristineBounds.max[2],
      depth: world(FERRY_BUILD.deck.wellDepth),
    },
  );
  const bands = bandDeck(
    clearance,
    deckFromX,
    deckToX,
    world(FERRY_BUILD.deck.bandLength),
    world(FERRY_BUILD.deck.bandMergeTolerance),
    world(FERRY_BUILD.deck.sideMargin),
  );
  if (bands.length === 0) throw new Error('ferry survey produced no deck bands');
  const openingBands = reserveOpening(
    bands,
    world(FERRY_BUILD.gangway.x - FERRY_BUILD.gangway.halfWidth),
    world(FERRY_BUILD.gangway.x + FERRY_BUILD.gangway.halfWidth),
  );
  const deckRects = openingBands.map((band, ordinal) => ({
    id: openingBands.length === 1 ? 'main-deck' : `main-deck-${ordinal + 1}`,
    x: snap((band.fromX + band.toX) / 2),
    z: 0,
    hw: snap((band.toX - band.fromX) / 2),
    hd: snap(band.halfSpan),
    y: deckY,
  }));
  report.clearance = clearance.map((s) => ({ x: snap(s.x * scale), span: snap(s.halfSpan * scale) }));
  report.deckRects = deckRects;

  // ---- 2. edit: deck her, then open the bulwark for the gangplank ----------
  const planks = deckRects.flatMap((rect) =>
    plankedSlabBoxes({
      x: rect.x,
      z: rect.z,
      hw: rect.hw,
      hd: rect.hd,
      y: rect.y,
      thickness: world(FERRY_BUILD.deck.thickness),
      plankPitch: world(FERRY_BUILD.deck.plankPitch),
      plankLength: world(FERRY_BUILD.deck.plankLength),
      seam: world(FERRY_BUILD.deck.seam),
      tones: FERRY_BUILD.deck.tones,
    }),
  );
  addBoxMesh(document, 'GrandFerryDeck', planks, { roughness: 0.9, metalness: 0 });
  report.plankCount = planks.length;

  const pristineColumns = measureMesh(pristine, {
    gridStep: step,
    headroom: world(FERRY_BUILD.probe.headroom),
    bodyWidth: world(FERRY_BUILD.probe.bodyWidth),
    levelTolerance: world(FERRY_BUILD.probe.levelTolerance),
    minLevelCells: 1e9,
  }).columns;
  const gangwayX = world(FERRY_BUILD.gangway.x);
  const gangwayHalfWidth = world(FERRY_BUILD.gangway.halfWidth);
  const gangwayRect = deckRects.find(
    (rect) => gangwayX >= rect.x - rect.hw && gangwayX <= rect.x + rect.hw,
  );
  if (!gangwayRect) throw new Error('the gangway station falls outside every deck band');
  const bulwarkTop = regionTop(
    pristineColumns,
    {
      minX: gangwayX - gangwayHalfWidth,
      maxX: gangwayX + gangwayHalfWidth,
      minZ: -pristineBounds.max[2],
      maxZ: -gangwayRect.hd,
    },
    deckY + world(FERRY_BUILD.deck.furnitureCeiling),
  );
  if (bulwarkTop === null) throw new Error('ferry survey found no port bulwark at the gangway');
  report.bulwarkTop = bulwarkTop;
  // The cut spans from the deck up past the measured cap and outward through
  // the hull skin, so the opening is clear rather than merely thinned.
  const cutTop = bulwarkTop + world(0.6);
  const removed = removeTrianglesInBox(document, {
    x: gangwayX,
    y: (deckY + cutTop) / 2,
    z: -(gangwayRect.hd + pristineBounds.max[2]) / 2,
    hw: gangwayHalfWidth,
    hh: (cutTop - deckY) / 2,
    hd: (pristineBounds.max[2] - gangwayRect.hd) / 2 + world(0.5),
  });
  if (removed === 0) throw new Error('gangway cut removed nothing: the opening would be closed');
  report.gangwayTrianglesRemoved = removed;

  // ---- 3. measure the edited result ----------------------------------------
  const edited = documentTriangles(document);
  const measurement = measureMesh(edited, {
    gridStep: step,
    headroom: world(FERRY_BUILD.probe.headroom),
    bodyWidth: world(FERRY_BUILD.probe.bodyWidth),
    levelTolerance: world(FERRY_BUILD.probe.levelTolerance),
    maxRectsPerLevel: 6,
    minLevelCells: 10,
  });
  report.levels = measurement.levels.map((level) => ({
    y: level.y,
    cells: level.cells,
    rects: level.rects.length,
  }));

  // minCells keeps ROPES out of the collision. A stay coming down to the rail
  // costs one probe its headroom, and turning that into a collider would give
  // the deck an invisible snag you cannot see to avoid. A mast is a dozen
  // cells and survives the filter; rigging is one or two and does not.
  const obstacles = deckRects.flatMap((rect) =>
    measureFootprintObstacles(measurement, rect, {
      tolerance: world(0.35),
      maxRects: 4,
      minCells: 3,
    }),
  );
  report.obstacles = obstacles;

  const bounds = triangleBounds(edited);
  const plan = assemblePlan({
    bounds,
    deckRects,
    gangwayRect,
    obstacles,
    measurement,
    edited,
    scale,
    world,
  });
  plan.source = {
    file: FERRY_ART_SOURCE,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  };
  return { document, plan, report, measurement, scale };
}

function assemblePlan({
  bounds,
  deckRects,
  gangwayRect,
  obstacles,
  measurement,
  edited,
  scale,
  world,
}) {
  const keelY = bounds.min[1];
  const deckY = deckRects[0].y;
  const deckWorldY = snap(
    FERRY_BUILD.berth.waterlineY - FERRY_BUILD.berth.draft + (deckY - keelY) * scale,
  );
  const railHalfThickness = world(FERRY_BUILD.railHalfThickness);
  const gangwayX = world(FERRY_BUILD.gangway.x);
  const gangwayHalfWidth = world(FERRY_BUILD.gangway.halfWidth);
  const minX = Math.min(...deckRects.map((rect) => rect.x - rect.hw));
  const maxX = Math.max(...deckRects.map((rect) => rect.x + rect.hw));

  // The rail sits at the bulwark cap the art already provides, so its height
  // is measured, not chosen.
  const capTop = regionTop(
    measurement.columns,
    {
      minX,
      maxX,
      minZ: Math.min(...deckRects.map((rect) => rect.hd)),
      maxZ: Math.max(...deckRects.map((rect) => rect.hd)) + world(1.5),
    },
    deckY + world(FERRY_BUILD.deck.furnitureCeiling),
  );
  const railHeight = snap((capTop ?? deckY + world(1)) - deckY);

  const rail = (id, x, z, hw, rot) => ({
    id,
    x: snap(x),
    z: snap(z),
    hw: snap(hw),
    halfThickness: snap(railHalfThickness),
    rot,
    height: railHeight,
  });
  const rails = [];
  for (const [ordinal, rect] of deckRects.entries()) {
    const suffix = deckRects.length === 1 ? '' : `-${ordinal + 1}`;
    rails.push(rail(`starboard${suffix}`, rect.x, rect.hd, rect.hw, 0));
    if (rect !== gangwayRect) {
      rails.push(rail(`port${suffix}`, rect.x, -rect.hd, rect.hw, 0));
      continue;
    }
    // The band carrying the gangway is fenced either side of the opening.
    const from = rect.x - rect.hw;
    const to = rect.x + rect.hw;
    const openingMinX = gangwayX - gangwayHalfWidth;
    const openingMaxX = gangwayX + gangwayHalfWidth;
    if (openingMinX - from > 0) {
      rails.push(
        rail(`port${suffix}-aft`, (from + openingMinX) / 2, -rect.hd, (openingMinX - from) / 2, 0),
      );
    }
    if (to - openingMaxX > 0) {
      rails.push(
        rail(`port${suffix}-fore`, (openingMaxX + to) / 2, -rect.hd, (to - openingMaxX) / 2, 0),
      );
    }
  }
  rails.push(rail('stern', minX, 0, deckRects[0].hd, Math.PI / 2));
  const last = deckRects[deckRects.length - 1];
  rails.push(rail('bow', maxX, 0, last.hd, Math.PI / 2));

  // Ends and sides come off the measured hull outline.
  const stations = measureSilhouette(edited, bounds, 12, deckY);
  const blockingVolumes = [];
  // A bow and a stern come to a POINT, so each is a run of boxes following the
  // silhouette rather than one box at the widest station. A single max-width
  // box reaches out over open water beside the taper, where it blocks nothing
  // real but does occlude sight lines the cinematic linter checks.
  const endBlock = (id, kind, from, to) => {
    const span = stations.filter(
      (station) => station.x >= from - 1e-9 && station.x <= to + 1e-9,
    );
    if (span.length < 2) return;
    // Camera height for a solid end comes off the highest DECK LEVEL over it
    // (a sterncastle is real structure the camera must not enter), never off
    // the raw geometry, which would put an invisible wall up to the masthead.
    const top = levelTopOver(measurement, { minX: from, maxX: to }) ?? deckY;
    for (let index = 0; index + 1 < span.length; index++) {
      const halfBeam = Math.min(span[index].halfBeam, span[index + 1].halfBeam);
      if (halfBeam <= 0) continue;
      blockingVolumes.push({
        id: `${id}-${index + 1}`,
        kind,
        x: snap((span[index].x + span[index + 1].x) / 2),
        z: 0,
        hw: snap((span[index + 1].x - span[index].x) / 2),
        hd: snap(halfBeam),
        rot: 0,
        topY: null,
        cameraTopY: snap(top),
      });
    }
  };
  endBlock('stern-body', 'stern', bounds.min[0], minX);
  endBlock('bow-body', 'bow', maxX, bounds.max[0]);

  // The hull below the deck: solid to a walker at water level, open above so
  // standing ON the deck is never blocked by the ship's own sides (the rails
  // do that). These follow the measured SILHOUETTE, not the deck edge: their
  // job is the shape of the boat in the water, and the gangplank's hull edge
  // has to land against one of them.
  const sideSpan = stations.filter(
    (station) => station.x >= minX - 1e-9 && station.x <= maxX + 1e-9 && station.halfBeam > 0,
  );
  for (const [side, label] of [
    [1, 'starboard'],
    [-1, 'port'],
  ]) {
    for (let index = 0; index + 1 < sideSpan.length; index++) {
      const from = sideSpan[index];
      const to = sideSpan[index + 1];
      // Seated just INSIDE the skin rather than straddling it. A collider
      // centred on the silhouette sticks half its thickness out into open
      // water, which is both wrong and enough to graze a sight line the
      // cinematic gate measures to a hundredth of a yard.
      const fromZ = (from.halfBeam - railHalfThickness) * side;
      const toZ = (to.halfBeam - railHalfThickness) * side;
      const runX = to.x - from.x;
      const runZ = toZ - fromZ;
      blockingVolumes.push({
        id: `lower-hull-${label}-${index + 1}`,
        kind: 'lower-hull',
        x: snap((from.x + to.x) / 2),
        z: snap((fromZ + toZ) / 2),
        hw: snap(Math.hypot(runX, runZ) / 2),
        hd: snap(railHalfThickness),
        rot: snap(Math.atan2(-runZ, runX)),
        topY: snap(deckY),
        cameraTopY: snap(deckY + railHeight),
      });
    }
  }

  for (const [ordinal, obstacle] of obstacles.entries()) {
    blockingVolumes.push({
      id: `deck-obstacle-${ordinal + 1}`,
      kind: 'superstructure',
      x: obstacle.x,
      z: obstacle.z,
      hw: obstacle.hw,
      hd: obstacle.hd,
      rot: 0,
      topY: null,
      cameraTopY: obstacle.topY,
    });
  }

  return {
    version: 2,
    model: {
      length: snap(bounds.max[0] - bounds.min[0]),
      beam: snap(bounds.max[2] - bounds.min[2]),
      height: snap(bounds.max[1] - bounds.min[1]),
      keelY: snap(keelY),
      deckSurfaceY: deckY,
    },
    standardBerth: {
      length: FERRY_BUILD.berth.length,
      waterlineY: FERRY_BUILD.berth.waterlineY,
      draft: FERRY_BUILD.berth.draft,
      deckWorldY,
    },
    decks: deckRects.map((rect) => ({
      id: rect.id,
      x: rect.x,
      z: rect.z,
      hw: rect.hw,
      hd: rect.hd,
      y: rect.y,
      thickness: snap(world(FERRY_BUILD.deck.thickness)),
    })),
    rails,
    blockingVolumes,
    rampMatingEdge: {
      id: FERRY_BUILD.gangway.id,
      x: snap(gangwayX),
      z: snap(-gangwayRect.hd),
      halfWidth: snap(gangwayHalfWidth),
      outward: FERRY_BUILD.gangway.outward,
      y: deckY,
      // The hull's own half-beam AT this station. The plank has to land on the
      // side where the side is; using the model's widest point would hang its
      // outboard end past the skin wherever the hull has narrowed.
      hullHalfBeam: snap(
        stations.reduce((nearest, station) =>
          Math.abs(station.x - gangwayX) < Math.abs(nearest.x - gangwayX) ? station : nearest,
        ).halfBeam,
      ),
    },
    measurementEpsilons: { raw: 0.00001, optimized: 0.005 },
  };
}
