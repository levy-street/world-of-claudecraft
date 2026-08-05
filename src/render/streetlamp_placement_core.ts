// streetlamp_placement_core: where the town streetlamps stand. Pure (no Three,
// no DOM), so the whole layout is a deterministic function of the road polylines,
// the zone hubs, and two caller-supplied probes, and a Vitest can assert spacing,
// reach, and clearance without a renderer.
//
// The lamps are a TOWN fixture, not a world one: they line the roads for a short
// walk out of each hub and stop. Lighting all 90 road polylines end to end would
// both cost more than it is worth and read wrong, since the point of a lamp is
// that somebody maintains it.
//
// Roads arrive as sparse authored waypoints; src/sim/world.ts densifies and warps
// them into the curve the terrain splat actually paints. We walk the raw chords
// (as frost_sky.ts's Icemantle lanterns already do), so a lamp can sit up to the
// meander amplitude off the painted road centre. That is why the roadside offset
// below is generous enough to keep the post out of the track either way.

/** A zone hub: the town centre and the radius its plateau is flattened to. */
export interface LampTown {
  x: number;
  z: number;
  radius: number;
}

/** One lamp post, in world XZ, tagged with the town whose cull group owns it. */
export interface LampSite {
  x: number;
  z: number;
  /** ground height at the post's foot, carried from the probe that vetted it */
  y: number;
  /** index into the `towns` array this lamp belongs to */
  town: number;
  /** deterministic yaw so the lantern housings do not all face the same way */
  yaw: number;
}

/** Half-open [start, end) index range into `sites`, one per town, in order. */
export interface LampTownRange {
  start: number;
  end: number;
}

export interface StreetlampPlan {
  sites: LampSite[];
  townRanges: LampTownRange[];
}

export interface StreetlampPlanOptions {
  /** yards of road between consecutive lamps */
  spacing?: number;
  /** how far the lamp posts sit off the road centreline */
  offset?: number;
  /** reach out of a hub = radius * reachScale + reachPad, in yards */
  reachScale?: number;
  reachPad?: number;
  /** two lamps closer together than this collapse to one (roads converge on hubs) */
  minSeparation?: number;
  /** a site whose ground sits below this is over water or a void: dropped */
  minGroundY?: number;
}

const DEFAULTS = {
  spacing: 14,
  offset: 2.6,
  reachScale: 1.6,
  reachPad: 60,
  minSeparation: 8,
  minGroundY: -3,
};

export interface StreetlampProbes {
  /** ground height at a world XZ (the sim's terrainHeight, bound to the seed) */
  groundAt(x: number, z: number): number;
  /** true when a prop, building, or collider already owns this spot */
  blocked(x: number, z: number): boolean;
  /** deterministic 0..1 roll for a world XZ (the shared propPlacementRoll) */
  roll(x: number, z: number, n: number): number;
}

/**
 * Lay out every town's streetlamps.
 *
 * Walks each road polyline by CUMULATIVE arc length rather than restarting the
 * step at every waypoint, so lamps stay evenly spaced instead of bunching up
 * wherever the authored road happens to have a dense corner. Sides alternate down
 * the run, which is what makes a lit road read as a road rather than as a fence.
 */
export function planStreetlamps(
  roads: readonly (readonly { x: number; z: number }[])[],
  towns: readonly LampTown[],
  probes: StreetlampProbes,
  options: StreetlampPlanOptions = {},
): StreetlampPlan {
  const spacing = options.spacing ?? DEFAULTS.spacing;
  const offset = options.offset ?? DEFAULTS.offset;
  const reachScale = options.reachScale ?? DEFAULTS.reachScale;
  const reachPad = options.reachPad ?? DEFAULTS.reachPad;
  const minSeparation = options.minSeparation ?? DEFAULTS.minSeparation;
  const minGroundY = options.minGroundY ?? DEFAULTS.minGroundY;
  const minSepSq = minSeparation * minSeparation;

  const sites: LampSite[] = [];
  const townRanges: LampTownRange[] = [];

  for (let townIndex = 0; townIndex < towns.length; townIndex++) {
    const town = towns[townIndex];
    const reach = town.radius * reachScale + reachPad;
    const reachSq = reach * reach;
    const start = sites.length;
    // Only the polylines that come anywhere near this hub can contribute, and
    // rejecting them by their own extent first keeps the walk off the other
    // thirteen towns' roads entirely.
    for (const road of roads) {
      if (road.length < 2 || !roadReachesTown(road, town, reach)) continue;
      let stepIndex = 0;
      let carried = spacing * 0.5; // distance still owed before the next lamp
      for (let i = 0; i + 1 < road.length; i++) {
        const a = road[i];
        const b = road[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len <= 1e-6) continue;
        const ux = dx / len;
        const uz = dz / len;
        // the roadside normal, so a lamp stands beside the track, not on it
        const nx = -uz;
        const nz = ux;
        for (let d = carried; d < len; d += spacing) {
          const side = stepIndex % 2 === 0 ? offset : -offset;
          stepIndex++;
          const x = a.x + ux * d + nx * side;
          const z = a.z + uz * d + nz * side;
          const tdx = x - town.x;
          const tdz = z - town.z;
          if (tdx * tdx + tdz * tdz > reachSq) continue;
          if (tooClose(sites, start, x, z, minSepSq)) continue;
          const y = probes.groundAt(x, z);
          if (y < minGroundY) continue;
          if (probes.blocked(x, z)) continue;
          sites.push({ x, y, z, town: townIndex, yaw: probes.roll(x, z, 31) * Math.PI * 2 });
        }
        // carry the unspent remainder into the next chord so the spacing runs
        // continuously along the whole polyline
        const consumed = Math.max(0, Math.ceil((len - carried) / spacing)) * spacing;
        carried = carried + consumed - len;
      }
    }
    townRanges.push({ start, end: sites.length });
  }
  return { sites, townRanges };
}

/** Cheap reject: does any authored waypoint of this road fall inside the reach? */
function roadReachesTown(
  road: readonly { x: number; z: number }[],
  town: LampTown,
  reach: number,
): boolean {
  // Waypoints can be far apart, so allow for a chord that passes the hub with
  // both ends outside: half the longest chord is the slack that needs covering.
  let longest = 0;
  for (let i = 0; i + 1 < road.length; i++) {
    const len = Math.hypot(road[i + 1].x - road[i].x, road[i + 1].z - road[i].z);
    if (len > longest) longest = len;
  }
  const slack = reach + longest * 0.5;
  const slackSq = slack * slack;
  for (const point of road) {
    const dx = point.x - town.x;
    const dz = point.z - town.z;
    if (dx * dx + dz * dz <= slackSq) return true;
  }
  return false;
}

/** Roads converge on a hub, so overlapping runs would stack lamps on each other. */
function tooClose(
  sites: readonly LampSite[],
  from: number,
  x: number,
  z: number,
  minSepSq: number,
): boolean {
  for (let i = from; i < sites.length; i++) {
    const dx = sites[i].x - x;
    const dz = sites[i].z - z;
    if (dx * dx + dz * dz < minSepSq) return true;
  }
  return false;
}

/**
 * Which lamps carry a real point light. The forward renderer keeps only
 * `GFX.maxPointLights` lights alive at once (renderer.ts budgetFireLights), and
 * campfires, braziers, and quest glows already compete for those slots, so
 * lighting every post would starve them and light nothing extra. Every OTHER lamp
 * still carries its HDR emissive lantern and its baked ground pool, which is what
 * actually paints the road; the real lights only add the falloff on nearby
 * geometry. Same rule as frost_sky.ts's Icemantle lanterns, named and tested here
 * so the stride is not a magic modulo buried in a build loop.
 */
export const LAMP_LIGHT_STRIDE = 3;

export function lampCarriesLight(indexInTown: number): boolean {
  return indexInTown % LAMP_LIGHT_STRIDE === 0;
}
