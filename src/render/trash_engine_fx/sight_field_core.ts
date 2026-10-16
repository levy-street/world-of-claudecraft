// PURE (RENDER_PURE_CORES): the layout of a line-of-sight field laid on the
// real floor, shared by every caster whose blast stops at cover (the trash
// engine's G6 nova, sight_field.ts; Cantor Ilvane's Dirge of the Hollow).
//
// Why a fixed, dense mesh: the field used to be one fan per sector with only
// a handful of rings stretched out to each ray's reach, its vertices dropped
// on the floor every 6 yd. Between two samples the fan ran in a straight line
// while the floor did not (a ramp foot, a terrace lip, the cloister stair), so
// the field sank under the stone in bands and z-fought it where the two
// crossed: the flicker players saw. Here the mesh is a polar grid of
// `stations` rings and three columns per sector (both rays and the middle),
// draped ONCE per bar (a planted caster never moves), its vertices a station
// apart (under a yard on every shipped field). A ray's reach is then only a
// per-sector attribute (`aReach`) the fragment shader cuts against, so a
// shadow carving in mid-bar writes a few floats and never re-samples the
// floor. A triangle standing steeper than a walkable slope (a cliff, a riser)
// is discarded on the GPU, so the field never hangs a sheet down a drop.
//
// No Three, no DOM, no clock: the vertex and index layout, the column angles,
// the drape order and the station count are plain math a Vitest drives.

/** Columns per sector: the sector's first ray, its middle, its second ray. */
export const SIGHT_COLUMNS_PER_SECTOR = 3;

/** Longest radial gap between two draped stations, in yards. */
export const SIGHT_STATION_YARDS = 0.75;

/** Fewest and most stations a field is built with. */
export const SIGHT_MIN_STATIONS = 8;
export const SIGHT_MAX_STATIONS = 64;

/**
 * The steepest the field may lie (the cosine of the slope, its normal's y):
 * the authored fields keep every walkable path under 0.75 yd of rise per yard
 * (37 degrees, a normal y of 0.8), so anything steeper is a drop or a riser
 * the polar grid bridged, never ground a player stands on.
 */
export const SIGHT_MIN_NORMAL_Y = 0.62;

/**
 * Yards each field vertex is pulled toward the camera along its own view ray:
 * the field keeps its exact place on screen but always wins the depth test
 * against the floor it lies on (no z-fight, whatever the slope or the GPU),
 * while a pillar, a wall or a body standing up from the floor still hides it.
 */
export const SIGHT_DEPTH_PULL = 0.22;

/** Stations a field of `radius` yards needs (a station under a yard apart). */
export function sightStations(radius: number): number {
  const n = Math.ceil(Math.max(0, radius) / SIGHT_STATION_YARDS);
  return Math.min(SIGHT_MAX_STATIONS, Math.max(SIGHT_MIN_STATIONS, n));
}

/** Vertices of a field over `rays` sectors and `stations` rings out. */
export function sightVertexCount(rays: number, stations: number): number {
  return rays * (stations + 1) * SIGHT_COLUMNS_PER_SECTOR;
}

/** Vertex index of sector `s`, station `k` (0 at the caster), column `c`. */
export function sightVertex(s: number, k: number, c: number, stations: number): number {
  return (s * (stations + 1) + k) * SIGHT_COLUMNS_PER_SECTOR + c;
}

/** The triangle list: two quads per station band per sector. */
export function sightIndex(rays: number, stations: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < rays; s++) {
    for (let k = 0; k < stations; k++) {
      for (let c = 0; c + 1 < SIGHT_COLUMNS_PER_SECTOR; c++) {
        const a = sightVertex(s, k, c, stations);
        const b = sightVertex(s, k, c + 1, stations);
        const d = sightVertex(s, k + 1, c, stations);
        const e = sightVertex(s, k + 1, c + 1, stations);
        out.push(a, b, d, b, e, d);
      }
    }
  }
  return out;
}

/**
 * The floor columns a field samples: two per sector (its first ray, then its
 * middle); a sector's last column is the next sector's first. Column `q`
 * runs at angle `q / (2 * rays)` of a turn (sim convention: angle 0 looks
 * down +z, x = sin, z = cos).
 */
export function sightColumnCount(rays: number): number {
  return rays * 2;
}

/** The floor column vertex (s, c) samples (see sightColumnCount). */
export function sightColumnOf(s: number, c: number, rays: number): number {
  if (c < 2) return s * 2 + c;
  return ((s + 1) % rays) * 2;
}

/** The angle (radians) of floor column `q`. */
export function sightColumnAngle(q: number, rays: number): number {
  return (q / sightColumnCount(rays)) * Math.PI * 2;
}

/**
 * The `n`-th floor sample of a drape, nearest the caster first (station by
 * station, every column of a station before the next), so a budgeted drape
 * finishes the ground under the caster before the rim.
 */
export function sightDrapeSample(n: number, rays: number): { k: number; q: number } {
  const cols = sightColumnCount(rays);
  return { k: Math.floor(n / cols), q: n % cols };
}

/** Floor samples a whole drape takes. */
export function sightDrapeSamples(rays: number, stations: number): number {
  return sightColumnCount(rays) * (stations + 1);
}

/** The reach a sector is drawn lit out to: the FARTHER of its two rays
 *  (conservative: the hatched safe shadow is drawn only where both rays are
 *  blocked, never on a spot the blast can still see). */
export function sectorReach(reach: ArrayLike<number>, s: number): number {
  const j = (s + 1) % reach.length;
  return Math.max(reach[s], reach[j]);
}
