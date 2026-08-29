// Pure window-pane derivation for the Eastbrook kit buildings (Three/DOM
// free). The hexb kit GLBs carry no emissive materials or window markers:
// their windows are just small recessed frame assemblies modeled into the one
// building mesh. This core finds those assemblies in the raw geometry and
// emits, per assembly, the assembly's recessed glass plane as a triangle
// soup, matched to the opening's exact shape (arches come out as arches), so
// the lit-window mesh IS the model's own glass geometry instead of a
// rectangle guessed over it.
//
// How: split vertices are merged by exact position triple, triangles are
// grouped into connected components via shared merged vertices, and each
// component is classified against the model's bounding box. A window assembly
// is a small component (bounded triangle count), short relative to the model,
// off the ground, thin across one horizontal axis, and not tall-and-narrow
// near the ground (that shape is a door frame). Inside an accepted assembly
// the triangles facing along the thin axis are clustered by plane offset; the
// pane is the DEEPEST qualifying cluster (recessed behind the assembly's
// outer face, clear of its sill, and at least a quarter of the largest
// qualifying area): kit windows layer a frame-wide surround plate in front
// of the true glass, so area-first selection lit the whole arch. An assembly with no such cluster emits
// nothing: doors, shuttered windows, and solid dormer faces go dark by
// design.
//
// The classification thresholds were validated in-browser against all five
// shipped hexb kit models, and the recessed-plane selection against the live
// bank model: 12 panes glow and 9 assemblies stay correctly dark (doors,
// shutters, dormer housings). All classification inputs are normalized by
// the model bounding box (or are ratios), so the function works identically
// in raw quantized attribute units and in float model units.
const MIN_TRIANGLES = 6;
const MAX_TRIANGLES = 130;
const MIN_NORMALIZED_HEIGHT = 0.04;
const MAX_NORMALIZED_HEIGHT = 0.32;
const MIN_NORMALIZED_BOTTOM = 0.1;
const MAX_THIN_AXIS_FRACTION = 0.12;
const MAX_THICK_AXIS_FRACTION = 0.42;
const DOOR_MAX_NORMALIZED_BOTTOM = 0.3;
const DOOR_MIN_HEIGHT_TO_WIDTH = 1.5;
// Plane clustering along the assembly's thin axis: a triangle joins a cluster
// only when its unit normal points along that axis, and cluster keys quantize
// the centroid offset by an epsilon derived from the model and assembly
// scale, so raw Int16 and float inputs cluster identically.
const PLANE_NORMAL_MIN_AXIS_ALIGNMENT = 0.9;
const PLANE_EPS_MODEL_SPAN_FRACTION = 5e-4;
const PLANE_EPS_THIN_EXTENT_FRACTION = 0.02;
// The outer face (the cluster nearest the component extreme farther from the
// model center) is the frame front, never the glass; the sill band is the
// bottom tenth of the assembly.
const OUTER_FACE_MARGIN_THIN_FRACTION = 0.1;
const OUTER_FACE_MARGIN_EPS_MULTIPLIER = 2;
// A qualifying cluster must carry at least this fraction of the largest
// qualifying area before its depth can win (artifact slivers stay out).
const PANE_MIN_AREA_FRACTION_OF_LARGEST = 0.25;
const SILL_CLEARANCE_HEIGHT_FRACTION = 0.1;

export interface KitWindowPane {
  /**
   * The pane's triangles as flat xyz triples (triangle soup, no dedup), in
   * the same units as the input positions: the assembly's recessed glass
   * plane, exactly as modeled.
   */
  positions: number[];
}

interface ComponentStats {
  triangles: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface PlaneCluster {
  /** Summed triangle area (cross-product magnitude over two). */
  area: number;
  minY: number;
  /** Representative plane offset: the first triangle's centroid coordinate. */
  offset: number;
  positions: number[];
}

interface PaneSearch {
  /** The assembly is thin along x; otherwise thin along z. */
  thinX: boolean;
  eps: number;
  outerExtreme: number;
  /** The opposite extreme: the assembly face nearest the building's core. */
  innerExtreme: number;
  margin: number;
  sillY: number;
  clusters: Map<number, PlaneCluster>;
}

/**
 * Derives one window pane per detected window assembly from a kit GLB's mesh
 * geometry. Pass the position attribute values (three components per vertex,
 * raw quantized integers or floats) and the triangle indices (null for
 * non-indexed geometry). Output coordinates stay in the input's units.
 */
export function kitWindowPanes(
  positions: ArrayLike<number>,
  vertexCount: number,
  indices: ArrayLike<number> | null,
): KitWindowPane[] {
  if (vertexCount < 3) return [];

  // Merge split vertices by exact position triple, so a component is
  // connected through seams the exporter duplicated for normals or UVs.
  const mergedByKey = new Map<string, number>();
  const mergedByVertex = new Int32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const base = vertex * 3;
    const key = `${positions[base]},${positions[base + 1]},${positions[base + 2]}`;
    let merged = mergedByKey.get(key);
    if (merged === undefined) {
      merged = mergedByKey.size;
      mergedByKey.set(key, merged);
    }
    mergedByVertex[vertex] = merged;
  }

  // Union-find over merged vertices; every triangle unions its corners.
  const parent = new Int32Array(mergedByKey.size);
  for (let index = 0; index < parent.length; index++) parent[index] = index;
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const triangleCount = Math.floor((indices ? indices.length : vertexCount) / 3);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const a = find(mergedByVertex[indices ? indices[base] : base]);
    const b = find(mergedByVertex[indices ? indices[base + 1] : base + 1]);
    const c = find(mergedByVertex[indices ? indices[base + 2] : base + 2]);
    if (b !== a) parent[b] = a;
    if (c !== a) parent[c] = a;
  }

  // Model bounding box plus per-component triangle counts and bounding boxes.
  let modelMinX = Infinity;
  let modelMinY = Infinity;
  let modelMinZ = Infinity;
  let modelMaxX = -Infinity;
  let modelMaxY = -Infinity;
  let modelMaxZ = -Infinity;
  const components = new Map<number, ComponentStats>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const root = find(mergedByVertex[indices ? indices[base] : base]);
    let stats = components.get(root);
    if (!stats) {
      stats = {
        triangles: 0,
        minX: Infinity,
        minY: Infinity,
        minZ: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        maxZ: -Infinity,
      };
      components.set(root, stats);
    }
    stats.triangles++;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = indices ? indices[base + corner] : base + corner;
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      if (x < stats.minX) stats.minX = x;
      if (y < stats.minY) stats.minY = y;
      if (z < stats.minZ) stats.minZ = z;
      if (x > stats.maxX) stats.maxX = x;
      if (y > stats.maxY) stats.maxY = y;
      if (z > stats.maxZ) stats.maxZ = z;
      if (x < modelMinX) modelMinX = x;
      if (y < modelMinY) modelMinY = y;
      if (z < modelMinZ) modelMinZ = z;
      if (x > modelMaxX) modelMaxX = x;
      if (y > modelMaxY) modelMaxY = y;
      if (z > modelMaxZ) modelMaxZ = z;
    }
  }
  const modelSpanX = modelMaxX - modelMinX;
  const modelSpanY = modelMaxY - modelMinY;
  const modelSpanZ = modelMaxZ - modelMinZ;
  if (modelSpanX <= 0 || modelSpanY <= 0 || modelSpanZ <= 0) return [];
  const modelMaxSpan = Math.max(modelSpanX, modelSpanY, modelSpanZ);

  // Classify components; each accepted window assembly opens a pane search
  // that the plane-clustering pass below fills.
  const searches = new Map<number, PaneSearch>();
  for (const [root, stats] of components) {
    if (stats.triangles < MIN_TRIANGLES || stats.triangles > MAX_TRIANGLES) continue;
    const spanX = stats.maxX - stats.minX;
    const spanY = stats.maxY - stats.minY;
    const spanZ = stats.maxZ - stats.minZ;
    const normalizedHeight = spanY / modelSpanY;
    if (normalizedHeight < MIN_NORMALIZED_HEIGHT || normalizedHeight > MAX_NORMALIZED_HEIGHT) {
      continue;
    }
    const normalizedBottom = (stats.minY - modelMinY) / modelSpanY;
    if (normalizedBottom < MIN_NORMALIZED_BOTTOM) continue;
    const normalizedSpanX = spanX / modelSpanX;
    const normalizedSpanZ = spanZ / modelSpanZ;
    if (Math.min(normalizedSpanX, normalizedSpanZ) > MAX_THIN_AXIS_FRACTION) continue;
    if (Math.max(normalizedSpanX, normalizedSpanZ) > MAX_THICK_AXIS_FRACTION) continue;
    // Door shape: tall and narrow near the ground. Ratio of absolute extents,
    // so it is unit-independent like the normalized filters above.
    if (
      normalizedBottom < DOOR_MAX_NORMALIZED_BOTTOM &&
      spanY / Math.max(spanX, spanZ) > DOOR_MIN_HEIGHT_TO_WIDTH
    ) {
      continue;
    }
    const thinX = spanX <= spanZ;
    const thinExtent = thinX ? spanX : spanZ;
    const eps = Math.max(
      modelMaxSpan * PLANE_EPS_MODEL_SPAN_FRACTION,
      thinExtent * PLANE_EPS_THIN_EXTENT_FRACTION,
    );
    const minAlongAxis = thinX ? stats.minX : stats.minZ;
    const maxAlongAxis = thinX ? stats.maxX : stats.maxZ;
    const modelCenterAlongAxis = thinX ? (modelMinX + modelMaxX) / 2 : (modelMinZ + modelMaxZ) / 2;
    const outerExtreme =
      Math.abs(maxAlongAxis - modelCenterAlongAxis) >= Math.abs(minAlongAxis - modelCenterAlongAxis)
        ? maxAlongAxis
        : minAlongAxis;
    const innerExtreme = outerExtreme === maxAlongAxis ? minAlongAxis : maxAlongAxis;
    searches.set(root, {
      thinX,
      eps,
      outerExtreme,
      innerExtreme,
      margin: Math.max(
        thinExtent * OUTER_FACE_MARGIN_THIN_FRACTION,
        eps * OUTER_FACE_MARGIN_EPS_MULTIPLIER,
      ),
      sillY: stats.minY + SILL_CLEARANCE_HEIGHT_FRACTION * spanY,
      clusters: new Map(),
    });
  }
  if (searches.size === 0) return [];

  // Cluster each accepted assembly's axis-facing triangles by plane offset.
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const ia = indices ? indices[base] : base;
    const search = searches.get(find(mergedByVertex[ia]));
    if (!search) continue;
    const ib = indices ? indices[base + 1] : base + 1;
    const ic = indices ? indices[base + 2] : base + 2;
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];
    const cz = positions[ic * 3 + 2];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength <= 0) continue;
    const alongAxis = (search.thinX ? nx : nz) / normalLength;
    if (Math.abs(alongAxis) <= PLANE_NORMAL_MIN_AXIS_ALIGNMENT) continue;
    const offset =
      ((search.thinX ? ax : az) + (search.thinX ? bx : bz) + (search.thinX ? cx : cz)) / 3;
    const key = Math.round(offset / search.eps);
    let cluster = search.clusters.get(key);
    if (!cluster) {
      cluster = { area: 0, minY: Infinity, offset, positions: [] };
      search.clusters.set(key, cluster);
    }
    cluster.area += normalLength / 2;
    const triangleMinY = Math.min(ay, by, cy);
    if (triangleMinY < cluster.minY) cluster.minY = triangleMinY;
    cluster.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  // The pane is the DEEPEST qualifying cluster (nearest the assembly's inner
  // extreme) among those recessed behind the outer face, clear of the sill,
  // and carrying at least a quarter of the largest qualifying area. Deepest
  // wins because these kit windows layer a frame-wide surround plate in
  // front of the true glass: on the hexb ground-floor windows the plate
  // spans the whole arch (area 0.020, full component width) while the glass
  // sits deeper at about half the width (area 0.017), so area-first lit the
  // frame instead of the window. The area floor keeps a deep sliver artifact
  // from beating the real glass.
  const panes: KitWindowPane[] = [];
  for (const search of searches.values()) {
    let maxQualifyingArea = 0;
    for (const cluster of search.clusters.values()) {
      if (Math.abs(cluster.offset - search.outerExtreme) <= search.margin) continue;
      if (cluster.minY < search.sillY) continue;
      if (cluster.area > maxQualifyingArea) maxQualifyingArea = cluster.area;
    }
    let best: PlaneCluster | null = null;
    let bestDepth = Infinity;
    for (const cluster of search.clusters.values()) {
      if (Math.abs(cluster.offset - search.outerExtreme) <= search.margin) continue;
      if (cluster.minY < search.sillY) continue;
      if (cluster.area < maxQualifyingArea * PANE_MIN_AREA_FRACTION_OF_LARGEST) continue;
      const depth = Math.abs(cluster.offset - search.innerExtreme);
      if (depth < bestDepth) {
        bestDepth = depth;
        best = cluster;
      }
    }
    if (best) panes.push({ positions: best.positions });
  }
  return panes;
}
