// Measure collision out of a finished art mesh.
//
// The problem this solves: a good looking GLB is an unlabelled pile of
// triangles. The sim needs simple shapes (flat rects you stand on, boxes you
// bump into). Typing those by hand while eyeballing the model is what silently
// drifted out of sync on the first ferry. Modelling the art out of collision
// boxes instead keeps them in sync but caps how good the art can look.
//
// So neither: the art stays whatever the art tool produced, and this module
// DERIVES the collision from it by measurement. Deterministic, re-runnable,
// and therefore checkable by a test, which is the part that was missing.
//
// The one physical rule everything falls out of: a surface is standable only
// if a person actually fits above it. Cast rays straight down, keep the
// up-facing hits that have body headroom clear above them, and the deck,
// the raised sterncastle, the mast, the cabin and the bulwark cap all sort
// themselves into the right bucket without anyone naming them.
//
// Pure and host-agnostic: no Three, no repo imports, no clock, no randomness.
// Callers hand in triangles; tests import the same functions directly.

/** A surface may face at most this far off straight up and still be a floor. */
const DEFAULT_UP_NORMAL_MIN = 0.85;
/** XZ probe pitch. Smaller finds narrower ledges and costs more time. */
const DEFAULT_GRID_STEP = 0.25;
/** Two standable hits within this height merge into one level. */
const DEFAULT_LEVEL_TOLERANCE = 0.35;
/** Measured values round to this many decimals so runs match bit for bit. */
const OUTPUT_DECIMALS = 6;

/** Deterministic rounding. Float noise below this is measurement dither, not
 *  shape, and letting it through would make the generated file churn. */
export function snap(value, decimals = OUTPUT_DECIMALS) {
  const factor = 10 ** decimals;
  const snapped = Math.round(value * factor) / factor;
  // Normalise the negative zero Math.round can hand back.
  return snapped === 0 ? 0 : snapped;
}

export function triangleBounds(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) {
    for (const vertex of tri) {
      for (let axis = 0; axis < 3; axis++) {
        if (vertex[axis] < min[axis]) min[axis] = vertex[axis];
        if (vertex[axis] > max[axis]) max[axis] = vertex[axis];
      }
    }
  }
  return { min, max };
}

/**
 * Uniform XZ bucket index. A downward ray only ever meets triangles whose XZ
 * footprint contains its column, so bucketing by footprint turns the whole
 * measurement from quadratic into roughly linear and keeps this usable on
 * meshes far larger than one ferry.
 */
export function buildColumnIndex(triangles, bounds, cellSize) {
  const originX = bounds.min[0];
  const originZ = bounds.min[2];
  const cols = Math.max(1, Math.ceil((bounds.max[0] - originX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((bounds.max[2] - originZ) / cellSize) + 1);
  const buckets = new Map();
  const clampCol = (value) => Math.min(cols - 1, Math.max(0, value));
  const clampRow = (value) => Math.min(rows - 1, Math.max(0, value));
  for (let index = 0; index < triangles.length; index++) {
    const [a, b, c] = triangles[index];
    const minCol = clampCol(Math.floor((Math.min(a[0], b[0], c[0]) - originX) / cellSize));
    const maxCol = clampCol(Math.floor((Math.max(a[0], b[0], c[0]) - originX) / cellSize));
    const minRow = clampRow(Math.floor((Math.min(a[2], b[2], c[2]) - originZ) / cellSize));
    const maxRow = clampRow(Math.floor((Math.max(a[2], b[2], c[2]) - originZ) / cellSize));
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const key = col * rows + row;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  }
  return { originX, originZ, cols, rows, cellSize, buckets, clampCol, clampRow };
}

function columnTriangles(index, x, z) {
  const col = index.clampCol(Math.floor((x - index.originX) / index.cellSize));
  const row = index.clampRow(Math.floor((z - index.originZ) / index.cellSize));
  return index.buckets.get(col * index.rows + row) ?? [];
}

/**
 * Every surface a straight-down ray through (x, z) crosses, highest first.
 *
 * A vertical ray reduces to a point-in-triangle test in the XZ plane plus a
 * height interpolation, which is both faster and better conditioned than a
 * general ray-triangle routine. Triangles with no XZ area are exactly the
 * vertical walls, which a vertical ray cannot meaningfully land on, so
 * dropping them is correct rather than a shortcut.
 */
export function columnHits(triangles, index, x, z) {
  const hits = [];
  for (const triIndex of columnTriangles(index, x, z)) {
    const [a, b, c] = triangles[triIndex];
    const v0x = b[0] - a[0];
    const v0z = b[2] - a[2];
    const v1x = c[0] - a[0];
    const v1z = c[2] - a[2];
    const area = v0x * v1z - v0z * v1x;
    if (Math.abs(area) < 1e-12) continue;
    const px = x - a[0];
    const pz = z - a[2];
    const u = (px * v1z - pz * v1x) / area;
    const v = (pz * v0x - px * v0z) / area;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
    const e0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e0[1] * e1[2] - e0[2] * e1[1];
    const ny = e0[2] * e1[0] - e0[0] * e1[2];
    const nz = e0[0] * e1[1] - e0[1] * e1[0];
    const length = Math.hypot(nx, ny, nz);
    hits.push({ y, up: length > 0 ? ny / length : 0 });
  }
  // Sort by height, then by facing, so equal-height coplanar hits keep one
  // stable order on every machine.
  hits.sort((left, right) => right.y - left.y || right.up - left.up);
  return hits;
}

/**
 * The standable surfaces in one column: an up-facing hit with body headroom
 * clear above it. This is the whole classifier. A mast fills the space above
 * the deck it stands on, so that column reports no standable surface and
 * becomes an obstacle. A bulwark cap has open sky above it, so it does report
 * one, and gets discarded later for being narrower than a body.
 */
export function standableHeights(hits, headroom, upNormalMin) {
  const surfaces = [];
  for (let index = 0; index < hits.length; index++) {
    const hit = hits[index];
    if (hit.up < upNormalMin) continue;
    // The next surface above is whatever the previous entry was, since hits
    // run highest first. Skip near-coincident shells (a plank drawn twice).
    let ceiling = Infinity;
    for (let above = index - 1; above >= 0; above--) {
      if (hits[above].y > hit.y + 1e-4) {
        ceiling = hits[above].y;
        break;
      }
    }
    if (ceiling - hit.y < headroom) continue;
    surfaces.push(hit.y);
  }
  return surfaces;
}

function levelKey(col, row) {
  return `${col},${row}`;
}

/**
 * Flood fill standable cells into connected levels. Two neighbouring cells
 * join only when their heights agree within tolerance, so a deck and the
 * raised deck above it separate on their own without being told they exist.
 */
function groupLevels(cells, cols, rows, tolerance, diagonal = false) {
  const byKey = new Map();
  for (const cell of cells) byKey.set(levelKey(cell.col, cell.row), cell);
  const seen = new Set();
  const levels = [];
  // Iterate the cell list, not the map, so ordering is the caller's grid scan.
  for (const cell of cells) {
    const startKey = levelKey(cell.col, cell.row);
    if (seen.has(startKey)) continue;
    const group = [];
    const queue = [cell];
    seen.add(startKey);
    while (queue.length > 0) {
      const current = queue.pop();
      group.push(current);
      // Floors join edge to edge: a diagonal touch is a corner, not a path you
      // can walk. Obstacles opt into diagonals, because a round thing like a
      // mast lands on the grid as a diagonal scatter of one big object.
      const neighbours = diagonal
        ? [
            [current.col - 1, current.row - 1],
            [current.col - 1, current.row],
            [current.col - 1, current.row + 1],
            [current.col, current.row - 1],
            [current.col, current.row + 1],
            [current.col + 1, current.row - 1],
            [current.col + 1, current.row],
            [current.col + 1, current.row + 1],
          ]
        : [
            [current.col - 1, current.row],
            [current.col + 1, current.row],
            [current.col, current.row - 1],
            [current.col, current.row + 1],
          ];
      for (const [col, row] of neighbours) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        const key = levelKey(col, row);
        if (seen.has(key)) continue;
        const next = byKey.get(key);
        if (!next) continue;
        if (Math.abs(next.y - current.y) > tolerance) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    levels.push(group);
  }
  return levels;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Cover a set of grid cells with axis-aligned rectangles, biggest first.
 *
 * Greedy and exhaustive rather than clever: at each step take the largest
 * all-covered rectangle available, claim its cells, repeat. Deterministic by
 * construction (ties break on a fixed scan order) and the cell counts here are
 * small. minCells is the body-width floor: a strip narrower than a person is
 * not somewhere you can stand, which is exactly what discards a bulwark cap.
 */
export function coverWithRects(cells, minCells, maxRects) {
  const remaining = new Set(cells.map((cell) => levelKey(cell.col, cell.row)));
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const cell of cells) {
    if (cell.col < minCol) minCol = cell.col;
    if (cell.col > maxCol) maxCol = cell.col;
    if (cell.row < minRow) minRow = cell.row;
    if (cell.row > maxRow) maxRow = cell.row;
  }
  const rects = [];
  // Candidates are tested against the UNCLAIMED set, so the rectangles tile
  // the region instead of stacking on top of each other. Overlapping collision
  // boxes would still work, but they bloat the collider list and make the
  // generated file impossible to read against the mesh.
  while (remaining.size > 0 && rects.length < maxRects) {
    let best = null;
    for (let startCol = minCol; startCol <= maxCol; startCol++) {
      for (let startRow = minRow; startRow <= maxRow; startRow++) {
        if (!remaining.has(levelKey(startCol, startRow))) continue;
        let rowLimit = maxRow;
        for (let endCol = startCol; endCol <= maxCol; endCol++) {
          let endRow = startRow;
          while (endRow <= rowLimit && remaining.has(levelKey(endCol, endRow))) endRow++;
          rowLimit = endRow - 1;
          if (rowLimit < startRow) break;
          const width = endCol - startCol + 1;
          const depth = rowLimit - startRow + 1;
          if (width < minCells || depth < minCells) continue;
          const area = width * depth;
          // Ties break on the scan order, which is fixed, so two runs over the
          // same mesh choose the same rectangles.
          if (
            best === null ||
            area > best.area ||
            (area === best.area && startCol < best.startCol) ||
            (area === best.area && startCol === best.startCol && startRow < best.startRow)
          ) {
            best = { startCol, startRow, endCol, endRow: rowLimit, area };
          }
        }
      }
    }
    if (best === null) break;
    for (let col = best.startCol; col <= best.endCol; col++) {
      for (let row = best.startRow; row <= best.endRow; row++) {
        remaining.delete(levelKey(col, row));
      }
    }
    rects.push(best);
  }
  return { rects, uncovered: remaining };
}

/**
 * Measure one mesh into walkable levels plus everything that blocks.
 *
 * triangles: model-space triangles, y up, as [[x,y,z],[x,y,z],[x,y,z]].
 * config.headroom / config.bodyWidth are in the SAME model units, so a caller
 * working in a scaled asset converts once at the boundary and never again.
 */
export function measureMesh(triangles, config = {}) {
  const gridStep = config.gridStep ?? DEFAULT_GRID_STEP;
  const headroom = config.headroom ?? 2.6;
  const bodyWidth = config.bodyWidth ?? 1;
  const upNormalMin = config.upNormalMin ?? DEFAULT_UP_NORMAL_MIN;
  const levelTolerance = config.levelTolerance ?? DEFAULT_LEVEL_TOLERANCE;
  const maxRectsPerLevel = config.maxRectsPerLevel ?? 8;
  const minLevelCells = config.minLevelCells ?? 8;

  const bounds = triangleBounds(triangles);
  const index = buildColumnIndex(triangles, bounds, gridStep);
  const cols = Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / gridStep));
  const rows = Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / gridStep));

  // Probe cell CENTRES: a probe exactly on a shared edge is the one place the
  // point-in-triangle test is ambiguous, and centres never land there.
  const standable = [];
  const columns = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = bounds.min[0] + (col + 0.5) * gridStep;
      const z = bounds.min[2] + (row + 0.5) * gridStep;
      const hits = columnHits(triangles, index, x, z);
      if (hits.length === 0) continue;
      const surfaces = standableHeights(hits, headroom, upNormalMin);
      columns.push({ col, row, x, z, top: hits[0].y, surfaces });
      for (const y of surfaces) standable.push({ col, row, x, z, y });
    }
  }

  const minCells = Math.max(1, Math.round(bodyWidth / gridStep));
  const groups = groupLevels(standable, cols, rows, levelTolerance);
  const levels = [];
  for (const group of groups) {
    if (group.length < minLevelCells) continue;
    const { rects } = coverWithRects(group, minCells, maxRectsPerLevel);
    if (rects.length === 0) continue;
    const claimed = new Set();
    const shaped = rects.map((rect) => {
      const heights = [];
      for (const cell of group) {
        if (
          cell.col >= rect.startCol &&
          cell.col <= rect.endCol &&
          cell.row >= rect.startRow &&
          cell.row <= rect.endRow
        ) {
          heights.push(cell.y);
          claimed.add(levelKey(cell.col, cell.row));
        }
      }
      const x0 = bounds.min[0] + rect.startCol * gridStep;
      const x1 = bounds.min[0] + (rect.endCol + 1) * gridStep;
      const z0 = bounds.min[2] + rect.startRow * gridStep;
      const z1 = bounds.min[2] + (rect.endRow + 1) * gridStep;
      return {
        x: snap((x0 + x1) / 2),
        z: snap((z0 + z1) / 2),
        hw: snap((x1 - x0) / 2),
        hd: snap((z1 - z0) / 2),
        y: snap(median(heights)),
        cells: heights.length,
        spread: snap(Math.max(...heights) - Math.min(...heights)),
        grid: rect,
      };
    });
    levels.push({
      y: snap(median(group.map((cell) => cell.y))),
      cells: group.length,
      rects: shaped,
      claimed,
    });
  }
  // Largest first: the main deck leads, so downstream "decks[0]" stays the
  // deck a rider lands on.
  levels.sort((left, right) => right.cells - left.cells || left.y - right.y);

  return { bounds, gridStep, cols, rows, columns, levels, minCells };
}

/**
 * Cells inside a level's rectangles where a body does NOT fit: the mast, the
 * cabin, the capstan. Each becomes a solid blocker whose top is the real
 * measured height of the thing standing there, so camera collision follows
 * the art instead of an authored guess.
 */
export function measureFootprintObstacles(measurement, footprint, options = {}) {
  const { columns, gridStep, bounds } = measurement;
  const maxRects = options.maxRects ?? 8;
  const tolerance = options.tolerance ?? 0.2;
  const floorY = footprint.y;
  const blocked = [];
  for (const column of columns) {
    if (column.x < footprint.x - footprint.hw || column.x > footprint.x + footprint.hw) continue;
    if (column.z < footprint.z - footprint.hd || column.z > footprint.z + footprint.hd) continue;
    // Standable AT the deck plane is floor; anything else in the footprint is
    // something standing on the deck, and the mast is the reason this exists.
    const stands = column.surfaces.some((y) => Math.abs(y - floorY) <= tolerance);
    if (stands) continue;
    blocked.push(column);
  }
  if (blocked.length === 0) return [];
  // One box per CONNECTED obstacle, not a rectangle cover of all of them. A
  // mast is a single thing; tiling it into six slivers would be six colliders
  // describing one pole, and the generated file should read like the ship.
  const groups = groupLevels(
    blocked.map((column) => ({ ...column, y: 0 })),
    measurement.cols,
    measurement.rows,
    Infinity,
    true,
  );
  return groups
    .filter((group) => group.length >= (options.minCells ?? 1))
    .slice(0, maxRects)
    .map((group) => {
      let minCol = Infinity;
      let maxCol = -Infinity;
      let minRow = Infinity;
      let maxRow = -Infinity;
      let top = -Infinity;
      for (const column of group) {
        if (column.col < minCol) minCol = column.col;
        if (column.col > maxCol) maxCol = column.col;
        if (column.row < minRow) minRow = column.row;
        if (column.row > maxRow) maxRow = column.row;
        if (column.top > top) top = column.top;
      }
      const x0 = bounds.min[0] + minCol * gridStep;
      const x1 = bounds.min[0] + (maxCol + 1) * gridStep;
      const z0 = bounds.min[2] + minRow * gridStep;
      const z1 = bounds.min[2] + (maxRow + 1) * gridStep;
      return {
        x: snap((x0 + x1) / 2),
        z: snap((z0 + z1) / 2),
        hw: snap((x1 - x0) / 2),
        hd: snap((z1 - z0) / 2),
        topY: snap(top),
        cells: group.length,
      };
    });
}

/**
 * Survey the floor inside one region: how high it sits and how wide it runs.
 *
 * This is what a generated surface needs before it can be laid. A deck goes on
 * TOP of the structural timbers, so the height that matters is the highest
 * floor in the region, not the average; and it must stop short of the sides,
 * so the width that matters is the NARROWEST clear span, not the widest. Both
 * come off the mesh, so moving to a different hull moves the deck with it.
 */
export function surveyRegionFloor(triangles, index, region, options = {}) {
  const step = options.step ?? DEFAULT_GRID_STEP;
  const headroom = options.headroom ?? 2.6;
  const upNormalMin = options.upNormalMin ?? DEFAULT_UP_NORMAL_MIN;
  const band = options.band ?? DEFAULT_LEVEL_TOLERANCE;
  const spanPercentile = options.spanPercentile ?? 0.15;

  // Collect the lowest standable surface per column. "Lowest" because in a
  // hull the thing under your feet is the floor and everything above it is
  // rigging or a platform.
  const floors = [];
  for (let x = region.minX; x <= region.maxX + 1e-9; x += step) {
    for (let z = region.minZ; z <= region.maxZ + 1e-9; z += step) {
      const surfaces = standableHeights(columnHits(triangles, index, x, z), headroom, upNormalMin);
      if (surfaces.length === 0) continue;
      floors.push({ x, z, y: Math.min(...surfaces) });
    }
  }
  if (floors.length === 0) {
    return { samples: 0, plateauY: null, highestY: null, lowestY: null, halfSpan: null };
  }

  // The deck is the height MOST of the region agrees on, not the highest one
  // found. Taking the maximum instead locks onto whatever spar happens to be
  // the only standable thing in a column the rigging shades, which is a real
  // surface and completely the wrong answer.
  const buckets = new Map();
  for (const floor of floors) {
    const key = Math.round(floor.y / band);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let modeKey = null;
  let modeCount = -1;
  // Ascending key order keeps the tie-break deterministic and prefers the
  // lower of two equally populated plateaus, which is the walkable one.
  for (const key of [...buckets.keys()].sort((left, right) => left - right)) {
    const count = buckets.get(key);
    if (count > modeCount) {
      modeCount = count;
      modeKey = key;
    }
  }

  const onPlateau = floors.filter((floor) => Math.abs(floor.y - modeKey * band) <= band);
  const heights = onPlateau.map((floor) => floor.y);
  const ordered = [...heights].sort((left, right) => left - right);
  const percentile = (fraction) =>
    snap(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]);
  const stations = new Map();
  for (const floor of onPlateau) {
    const key = Math.round(floor.x / step);
    stations.set(key, Math.max(stations.get(key) ?? 0, Math.abs(floor.z)));
  }
  // A low percentile rather than the outright minimum: the one station where
  // the hull pinches should not shrink the whole deck, but the deck still has
  // to stay inside the sides almost everywhere.
  const spans = [...stations.values()].sort((left, right) => left - right);
  const halfSpan = spans[Math.min(spans.length - 1, Math.floor(spans.length * spanPercentile))];

  return {
    samples: onPlateau.length,
    plateauY: snap(median(heights)),
    highestY: snap(Math.max(...heights)),
    lowestY: snap(Math.min(...heights)),
    /** Height at or above which the given fraction of the plateau sits. A
     *  generated floor rides a high percentile rather than the outright peak,
     *  so one proud fitting does not lift the whole deck a yard. */
    heightAt: percentile,
    p90: percentile(0.9),
    p99: percentile(0.99),
    halfSpan: snap(halfSpan),
  };
}

/**
 * How far out a surface at `atY` can run before it meets the sides.
 *
 * Scans outward from the centreline at each station and reports the first
 * offset that has structure standing at that height. That is the inner face of
 * a bulwark, a bulkhead, or a wall, which is exactly where a generated floor
 * has to stop. Measured at the height the floor will actually sit at, so a
 * floor laid above the original one still stops in the right place.
 *
 * Returns one entry per station so a caller can taper a floor along a hull
 * that changes width, instead of shrinking the whole thing to its narrowest
 * point or letting it poke out at its widest.
 */
export function measureSideClearance(triangles, index, region, atY, options = {}) {
  const step = options.step ?? DEFAULT_GRID_STEP;
  const rise = options.rise ?? 2;
  const depth = options.depth ?? 1.5;
  const limit = options.limit ?? Infinity;

  // The test is FLOOR PRESENCE, not obstruction. Walking outward from the
  // centreline there is deck under you the whole way to the side, including
  // directly beneath a mast; past the bulwark there is nothing at all. Asking
  // "where does the floor run out" therefore finds the sides and is blind to
  // whatever stands on the deck, which is the distinction that matters here.
  // Testing for obstruction instead cannot tell a thin bulwark from a spar.
  const hasFloor = (x, z) =>
    columnHits(triangles, index, x, z).some(
      (hit) => hit.up >= (options.upNormalMin ?? DEFAULT_UP_NORMAL_MIN) &&
        hit.y >= atY - depth &&
        hit.y <= atY + rise,
    );

  const stations = [];
  for (let x = region.minX; x <= region.maxX + 1e-9; x += step) {
    // Each side runs out on its own; a symmetric rectangle takes the nearer.
    const reach = [1, -1].map((side) => {
      let clear = 0;
      for (let z = step; z <= limit; z += step) {
        if (!hasFloor(x, side * z)) break;
        clear = z;
      }
      return clear;
    });
    stations.push({ x: snap(x), halfSpan: snap(Math.min(reach[0], reach[1])) });
  }
  return stations;
}

/**
 * The hull outline at a set of stations along the long axis, measured from
 * the vertices below a cut height. This is the shape the old plan carried as
 * hand-typed numbers; here it comes off the mesh.
 */
export function measureSilhouette(triangles, bounds, stationCount, cutY) {
  const stations = [];
  const minX = bounds.min[0];
  const maxX = bounds.max[0];
  const span = (maxX - minX) / stationCount;
  const half = span / 2;
  for (let station = 0; station <= stationCount; station++) {
    const x = minX + span * station;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const tri of triangles) {
      for (const vertex of tri) {
        if (vertex[1] > cutY) continue;
        if (Math.abs(vertex[0] - x) > half) continue;
        if (vertex[2] < minZ) minZ = vertex[2];
        if (vertex[2] > maxZ) maxZ = vertex[2];
      }
    }
    if (minZ === Infinity) {
      stations.push({ x: snap(x), halfBeam: 0 });
      continue;
    }
    stations.push({ x: snap(x), halfBeam: snap(Math.max(Math.abs(minZ), Math.abs(maxZ))) });
  }
  return stations;
}
