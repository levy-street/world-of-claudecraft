// Gourdlight Eve's road lanterns: a carved pumpkin hung from a short crook post at the
// roadside, every thirty-odd to fifty yards along the roads that join the event cities
// (and down the road to Old Thatchgrin's field), alternating sides, so a traveller
// between towns after dark walks from one warm glow to the next.
//
// Resolved against the LIVE world, never a coordinate (the city dressing's rule,
// seasonal_decor_layout.ts):
//   - the WAY: a shortest path over the world's own road polylines
//     (getActiveWorldContent().roads, joined where two roads meet), from one route
//     end to the other (content/gourdlight_eve_decor.ts GOURDLIGHT_ROAD_LANTERNS). An
//     end is a city's hub (every road waypoint inside its dressed radius reaches it)
//     or the resolved boss field (seasonal/scarecrow_field.ts);
//   - the SPOT: at each step the post walks out sideways from the way until the
//     painted road's own distance field (roadDistance, meander and all) puts it on the
//     verge band, OFF the track;
//   - the CHECKS: never in water, never beside a bridge (the road under it dry for a
//     stretch either side), clear of every static collider by a building's berth
//     (`isBlocked`, the movement query), clear of trees and rocks (the decoration
//     field), lamps, NPCs, gather nodes and the hunt's pumpkins, out of the towns (their
//     own dressing) and the field ring, on gentle ground, and apart from each other. A
//     spot that fails slides a few yards along the road, then tries the far side; one
//     that never passes is dropped, never forced.
//
// Cosmetic only and never solid (a thin post on the verge: nothing a rider snags on).
// Pure and deterministic: no rng (the gaps come from hashing the route id), no clock,
// no Three. Memoized per (world content, seed). The renderer draws exactly this list
// (src/render/seasonal_road_lanterns.ts) while the event runs; the pin is
// tests/seasonal_road_lanterns.test.ts.
import { isBlocked, streetlampPlacements } from './colliders';
import { GATHER_NODES } from './content/gather_nodes';
import {
  GOURDLIGHT_DECOR_CITIES,
  GOURDLIGHT_ROAD_LANTERNS,
  type SeasonalRoadEnd,
  type SeasonalRoadLanternRoute,
} from './content/gourdlight_eve_decor';
import { GOURDLIGHT_PUMPKINS } from './content/gourdlight_pumpkins';
import { CAMPS, getActiveWorldContent, NPCS } from './data';
import { hash2 } from './rng';
import { resolveScarecrowField, SCARECROW_FIELD_RADIUS } from './seasonal/scarecrow_field';
import { chapelAt } from './seasonal_decor_exclusions';
import { DECOR_KIND_SCALE, type SeasonalGroundPiece } from './seasonal_decor_layout';
import {
  generateDecorationsInBounds,
  groundHeight,
  isCliffFace,
  roadDistance,
  WATER_LEVEL,
} from './world';

/** The verge band a post stands in: its distance from the painted road's centre line. */
export const ROAD_LANTERN_BAND: readonly [number, number] = [4.6, 6.4];
/** Never closer than this to another road lantern (yards). */
export const ROAD_LANTERN_MIN_SPACING = 24;
/** A post keeps a building's berth from every static collider (yards). */
export const ROAD_LANTERN_COLLIDER_CLEARANCE = 3;
/** ...and from a tree's or a rock's centre (the canopy, not just the trunk). */
export const ROAD_LANTERN_TREE_CLEARANCE = 4.5;
/** ...and from a streetlamp, an NPC, a gather node or a hunt pumpkin. */
export const ROAD_LANTERN_PROP_CLEARANCE = 3;
/** ...and out of the heart of every mob camp: the inner share of its radius, where its
 *  mobs stand (many roads run through a camp's outskirts, so the rim stays allowed). */
export const ROAD_LANTERN_CAMP_HEART = 0.6;
/** No lantern within this reach of a bridge: the road under the way stays dry this far
 *  either side of the post's own stretch (yards along the way). */
export const ROAD_LANTERN_BRIDGE_REACH = 12;
/** A city's own dressing ends at its rule radius; the road lanterns start this far
 *  beyond it, so a town and its road never read as one heap. */
export const ROAD_LANTERN_TOWN_MARGIN = 10;
/** ...and stop this far out from the boss field's centre (past its dressed ring). */
export const ROAD_LANTERN_FIELD_CLEARANCE = SCARECROW_FIELD_RADIUS + 20;
/** The most the ground may rise or fall between the road and the post (yards). */
const MAX_VERGE_RISE = 1.4;
/** Two road waypoints this close (or a road's end this close to another road) join. */
const JUNCTION_REACH = 8;
/** The boss field reaches the road waypoints within this distance. */
const FIELD_ROAD_REACH = 75;
/** The way is resampled every this many yards. */
const WAY_STEP = 2;
/** How far the post may slide along the road from its nominal spot (yards). */
const SLIDES: readonly number[] = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15];

export interface SeasonalRoadLantern extends SeasonalGroundPiece {
  kind: 'road_lantern';
  /** Which route it lights (GOURDLIGHT_ROAD_LANTERNS.routes id). */
  route: string;
  /** Which side of the way it stands on (+1 left of travel, -1 right). */
  side: 1 | -1;
}

interface Point {
  x: number;
  z: number;
}

function routeHash(id: string, i: number, salt: number): number {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) | 0;
  return hash2(h, i, salt);
}

/** The road graph: every waypoint a node, joined along its road and at junctions. */
interface RoadGraph {
  nodes: Point[];
  edges: { to: number; cost: number }[][];
}

function buildRoadGraph(roads: readonly (readonly Point[])[]): RoadGraph {
  const nodes: Point[] = [];
  const edges: { to: number; cost: number }[][] = [];
  const firstOf: number[] = [];
  const link = (a: number, b: number, cost: number) => {
    edges[a].push({ to: b, cost });
    edges[b].push({ to: a, cost });
  };
  for (const road of roads) {
    firstOf.push(nodes.length);
    road.forEach((p, k) => {
      nodes.push({ x: p.x, z: p.z });
      edges.push([]);
      if (k > 0) {
        const a = nodes.length - 2;
        link(a, a + 1, Math.hypot(p.x - road[k - 1].x, p.z - road[k - 1].z));
      }
    });
  }
  const roadOf = (n: number) => {
    let r = 0;
    while (r + 1 < firstOf.length && firstOf[r + 1] <= n) r++;
    return r;
  };
  // Junctions: a waypoint near another road's waypoint, or a road's END near the
  // middle of another road's segment (a T-junction), joins them.
  for (let a = 0; a < nodes.length; a++) {
    const ra = roadOf(a);
    for (let b = a + 1; b < nodes.length; b++) {
      if (roadOf(b) === ra) continue;
      const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
      if (d <= JUNCTION_REACH) link(a, b, d);
    }
  }
  roads.forEach((road, ri) => {
    if (road.length < 2) return;
    for (const end of [firstOf[ri], firstOf[ri] + road.length - 1]) {
      const e = nodes[end];
      roads.forEach((other, oi) => {
        if (oi === ri) return;
        for (let k = 0; k + 1 < other.length; k++) {
          const a = other[k];
          const b = other[k + 1];
          const abx = b.x - a.x;
          const abz = b.z - a.z;
          const len2 = abx * abx + abz * abz;
          if (len2 === 0) continue;
          const t = Math.max(0, Math.min(1, ((e.x - a.x) * abx + (e.z - a.z) * abz) / len2));
          const px = a.x + abx * t;
          const pz = a.z + abz * t;
          const d = Math.hypot(e.x - px, e.z - pz);
          if (d > JUNCTION_REACH || t === 0 || t === 1) continue;
          const na = firstOf[oi] + k;
          const len = Math.sqrt(len2);
          link(end, na, d + len * t);
          link(end, na + 1, d + len * (1 - t));
        }
      });
    }
  });
  return { nodes, edges };
}

interface EndSpot {
  /** The point the end stands for (a hub or the field's centre). */
  at: Point;
  /** Waypoints within this reach join the end. */
  reach: number;
}

function resolveEnd(seed: number, end: SeasonalRoadEnd): EndSpot | null {
  if ('zoneId' in end) {
    const zone = getActiveWorldContent().zones.find((z) => z.id === end.zoneId);
    const rule = GOURDLIGHT_DECOR_CITIES.find((r) => r.zoneId === end.zoneId);
    if (!zone) return null;
    return { at: { x: zone.hub.x, z: zone.hub.z }, reach: rule?.radius ?? zone.hub.radius };
  }
  const field = resolveScarecrowField(seed);
  return field ? { at: { x: field.x, z: field.z }, reach: FIELD_ROAD_REACH } : null;
}

/** The shortest way over the road graph between two ends, as waypoints (end to end,
 *  each end's own point included), or null when the roads do not join them. */
function shortestWay(graph: RoadGraph, from: EndSpot, to: EndSpot): Point[] | null {
  const n = graph.nodes.length;
  const src = n;
  const dst = n + 1;
  const dist = new Array<number>(n + 2).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n + 2).fill(-1);
  const done = new Array<boolean>(n + 2).fill(false);
  const reachOf = (end: EndSpot, i: number) =>
    Math.hypot(graph.nodes[i].x - end.at.x, graph.nodes[i].z - end.at.z);
  const neighbours = (u: number): { to: number; cost: number }[] => {
    if (u === src) {
      const out: { to: number; cost: number }[] = [];
      for (let i = 0; i < n; i++) {
        const d = reachOf(from, i);
        if (d <= from.reach) out.push({ to: i, cost: d });
      }
      return out;
    }
    if (u === dst) return [];
    const out = [...graph.edges[u]];
    const d = reachOf(to, u);
    if (d <= to.reach) out.push({ to: dst, cost: d });
    return out;
  };
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < (u < 0 ? Infinity : dist[u])) u = i;
    if (u < 0 || u === dst) break;
    done[u] = true;
    for (const e of neighbours(u)) {
      const nd = dist[u] + e.cost;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
      }
    }
  }
  if (!Number.isFinite(dist[dst])) return null;
  const way: Point[] = [to.at];
  for (let u = prev[dst]; u !== src && u >= 0; u = prev[u]) way.push(graph.nodes[u]);
  way.push(from.at);
  return way.reverse();
}

/** The way resampled every WAY_STEP yards (positions plus unit headings). */
function resample(way: readonly Point[]): { x: number; z: number; hx: number; hz: number }[] {
  const out: { x: number; z: number; hx: number; hz: number }[] = [];
  for (let i = 0; i + 1 < way.length; i++) {
    const a = way[i];
    const b = way[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len === 0) continue;
    const hx = (b.x - a.x) / len;
    const hz = (b.z - a.z) / len;
    for (let s = 0; s < len; s += WAY_STEP) out.push({ x: a.x + hx * s, z: a.z + hz * s, hx, hz });
  }
  return out;
}

/** True when (x, z) is inside an event town's own dressing or the boss field's ring. */
function inDressedGround(seed: number, x: number, z: number): boolean {
  const zones = getActiveWorldContent().zones;
  for (const rule of GOURDLIGHT_DECOR_CITIES) {
    const zone = zones.find((zn) => zn.id === rule.zoneId);
    if (!zone) continue;
    if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < rule.radius + ROAD_LANTERN_TOWN_MARGIN)
      return true;
  }
  const field = resolveScarecrowField(seed);
  return !!field && Math.hypot(x - field.x, z - field.z) < ROAD_LANTERN_FIELD_CLEARANCE;
}

/** The fixed spots a post keeps clear of: lamps, NPCs, gather nodes, hunt pumpkins. */
function propSpots(seed: number): Point[] {
  return [
    ...streetlampPlacements(seed).map((l) => ({ x: l.x, z: l.z })),
    ...Object.values(NPCS).map((n) => ({ x: n.pos.x, z: n.pos.z })),
    ...GATHER_NODES.map((g) => ({ x: g.pos.x, z: g.pos.z })),
    ...GOURDLIGHT_PUMPKINS.map((p) => ({ x: p.x, z: p.z })),
  ];
}

export type RoadLanternProblem =
  | 'road'
  | 'verge'
  | 'water'
  | 'bridge'
  | 'collider'
  | 'tree'
  | 'prop'
  | 'chapel'
  | 'town'
  | 'slope'
  | 'camp'
  | 'crowded';

/** Why a post spot is refused, or null when it is clear (exported for the pin). `roadAt`
 *  is the point on the way it stands beside; `placed` every post already seated. */
export function roadLanternProblem(
  seed: number,
  x: number,
  z: number,
  roadAt: Point,
  placed: readonly Point[],
  props: readonly Point[],
): RoadLanternProblem | null {
  const r = roadDistance(x, z);
  if (r < ROAD_LANTERN_BAND[0]) return 'road';
  if (r > ROAD_LANTERN_BAND[1]) return 'verge';
  const h = groundHeight(x, z, seed);
  if (h < WATER_LEVEL + 0.6) return 'water';
  if (groundHeight(roadAt.x, roadAt.z, seed) < WATER_LEVEL + 0.6) return 'bridge';
  if (Math.abs(h - groundHeight(roadAt.x, roadAt.z, seed)) > MAX_VERGE_RISE) return 'slope';
  if (isCliffFace(x, z, seed)) return 'slope';
  if (inDressedGround(seed, x, z)) return 'town';
  if (chapelAt(x, z) !== null) return 'chapel';
  for (const c of CAMPS)
    if (Math.hypot(c.center.x - x, c.center.z - z) < c.radius * ROAD_LANTERN_CAMP_HEART)
      return 'camp';
  for (const p of placed)
    if (Math.hypot(p.x - x, p.z - z) < ROAD_LANTERN_MIN_SPACING) return 'crowded';
  for (const p of props)
    if (Math.hypot(p.x - x, p.z - z) < ROAD_LANTERN_PROP_CLEARANCE) return 'prop';
  const t = ROAD_LANTERN_TREE_CLEARANCE;
  for (const d of generateDecorationsInBounds(seed, {
    minX: x - t,
    maxX: x + t,
    minZ: z - t,
    maxZ: z + t,
  })) {
    if (Math.hypot(d.x - x, d.z - z) < t) return 'tree';
  }
  if (isBlocked(seed, x, z, ROAD_LANTERN_COLLIDER_CLEARANCE)) return 'collider';
  return null;
}

/** True when the way runs over water anywhere within the bridge reach of sample `i`. */
function nearBridge(seed: number, samples: readonly Point[], i: number): boolean {
  const k = Math.ceil(ROAD_LANTERN_BRIDGE_REACH / WAY_STEP);
  for (let j = Math.max(0, i - k); j <= Math.min(samples.length - 1, i + k); j++) {
    if (groundHeight(samples[j].x, samples[j].z, seed) < WATER_LEVEL + 0.4) return true;
  }
  return false;
}

/** Walk out sideways from the way until the painted road's distance reaches the verge
 *  band (the raw waypoints are not the drawn curve, so the walk finds the real verge). */
function vergeSpot(
  p: { x: number; z: number; hx: number; hz: number },
  side: 1 | -1,
): Point | null {
  // left of travel is (-hz, hx)
  const nx = -p.hz * side;
  const nz = p.hx * side;
  const target = (ROAD_LANTERN_BAND[0] + ROAD_LANTERN_BAND[1]) / 2;
  for (let d = 1; d <= 16; d += 0.25) {
    const x = p.x + nx * d;
    const z = p.z + nz * d;
    if (roadDistance(x, z) >= target) return { x, z };
  }
  return null;
}

function routeLanterns(
  seed: number,
  graph: RoadGraph,
  route: SeasonalRoadLanternRoute,
  placed: Point[],
  props: readonly Point[],
): SeasonalRoadLantern[] {
  const from = resolveEnd(seed, route.from);
  const to = resolveEnd(seed, route.to);
  if (!from || !to) return [];
  const way = shortestWay(graph, from, to);
  if (!way) return [];
  const samples = resample(way);
  const [gapMin, gapMax] = GOURDLIGHT_ROAD_LANTERNS.spacing;
  const out: SeasonalRoadLantern[] = [];
  let side: 1 | -1 = routeHash(route.id, 0, 1) < 0.5 ? 1 : -1;
  let next = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i * WAY_STEP < next) continue;
    const at = samples[i];
    if (inDressedGround(seed, at.x, at.z)) continue;
    let seated: SeasonalRoadLantern | null = null;
    for (const s of [side, -side as 1 | -1]) {
      for (const slide of SLIDES) {
        const j = i + Math.round(slide / WAY_STEP);
        if (j < 0 || j >= samples.length) continue;
        if (nearBridge(seed, samples, j)) continue;
        const spot = vergeSpot(samples[j], s);
        if (!spot) continue;
        if (roadLanternProblem(seed, spot.x, spot.z, samples[j], placed, props) !== null) continue;
        // the carved face looks back at the road it lights
        const yaw = Math.atan2(samples[j].x - spot.x, samples[j].z - spot.z);
        seated = {
          kind: 'road_lantern',
          x: spot.x,
          y: groundHeight(spot.x, spot.z, seed),
          z: spot.z,
          yaw,
          scale: DECOR_KIND_SCALE.road_lantern,
          anchor: `road:${route.id}:${n}`,
          route: route.id,
          side: s,
        };
        break;
      }
      if (seated) break;
    }
    if (!seated) {
      // nothing fits here: try again a few yards on
      next = i * WAY_STEP + 4;
      continue;
    }
    out.push(seated);
    placed.push({ x: seated.x, z: seated.z });
    side = -seated.side as 1 | -1;
    n++;
    next = i * WAY_STEP + gapMin + (gapMax - gapMin) * routeHash(route.id, n, 2);
  }
  return out;
}

/** The resolve as a stepper: the road graph on the first step, then one route a step, so
 *  the decor view can spread it over frames (the indoor pumpkins' rule: never one long
 *  stall on the frame the event opens). A world already resolved finishes on step one. */
export interface RoadLanternJob {
  /** Do one slice; true once the posts are resolved (then `result` is set). */
  step(): boolean;
  readonly result: readonly SeasonalRoadLantern[] | null;
}

function memoFor(content = getActiveWorldContent()): Map<number, readonly SeasonalRoadLantern[]> {
  let bySeed = memo.get(content);
  if (!bySeed) {
    bySeed = new Map();
    memo.set(content, bySeed);
  }
  return bySeed;
}

export function roadLanternJob(seed: number): RoadLanternJob {
  // the world the job was opened for: its roads and its memo stay one answer
  const content = getActiveWorldContent();
  const bySeed = memoFor(content);
  let result: readonly SeasonalRoadLantern[] | null = bySeed.get(seed) ?? null;
  let graph: RoadGraph | null = null;
  let props: Point[] = [];
  const placed: Point[] = [];
  const out: SeasonalRoadLantern[] = [];
  let next = 0;
  const routes = GOURDLIGHT_ROAD_LANTERNS.routes;
  return {
    get result() {
      return result;
    },
    step(): boolean {
      if (result) return true;
      if (!graph) {
        graph = buildRoadGraph(content.roads);
        props = propSpots(seed);
        return false;
      }
      if (next < routes.length) {
        out.push(...routeLanterns(seed, graph, routes[next], placed, props));
        next++;
        if (next < routes.length) return false;
      }
      result = out;
      bySeed.set(seed, out);
      return true;
    },
  };
}

/** Resolve every road lantern for the active world at `seed` (route order). */
export function resolveSeasonalRoadLanterns(seed: number): SeasonalRoadLantern[] {
  const graph = buildRoadGraph(getActiveWorldContent().roads);
  const props = propSpots(seed);
  const placed: Point[] = [];
  const out: SeasonalRoadLantern[] = [];
  for (const route of GOURDLIGHT_ROAD_LANTERNS.routes) {
    out.push(...routeLanterns(seed, graph, route, placed, props));
  }
  return out;
}

const memo = new WeakMap<object, Map<number, readonly SeasonalRoadLantern[]>>();

/** The memoized road lanterns per active world and seed. */
export function seasonalRoadLanterns(seed: number): readonly SeasonalRoadLantern[] {
  const bySeed = memoFor();
  let list = bySeed.get(seed);
  if (!list) {
    list = resolveSeasonalRoadLanterns(seed);
    bySeed.set(seed, list);
  }
  return list;
}
