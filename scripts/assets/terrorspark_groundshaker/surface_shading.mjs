// Deterministic surface-shading core for the Tank mount look-dev pass.
//
// Three jobs, one module because all three must agree on the same noise fields:
//   1. Periodic (seamlessly tiling) value noise the texture maps are rastered
//      from, plus the non-tiling 3D noise the vertex bake mottles with.
//   2. World-space box-projected UVs, so texel density stays constant across
//      parts of wildly different size instead of stretching with each box.
//   3. The baked macro pass written into COLOR_0: cavity occlusion against the
//      neighbouring parts, contact darkening at the ground, ground grime, top
//      dust, bevel wear, and per-part mottle. This is the low-frequency half of
//      the look; the tiling maps carry the meso and micro bands.
//
// Pure arithmetic over plain typed arrays: no three.js, no DOM, no node
// builtins, so the browser exporter, the Node map builder, and the Vitest suite
// all run this same code. Every value is derived from integer hashes, never
// Math.random, so an export is byte-reproducible.

/** Center value the ORM map's roughness and metalness channels encode. The
 *  exported material factors divide their authored target by it, so the target
 *  lands on the map's midtone and the map is free to scale up to 1 or down into
 *  the cavities. Lives here, not in the Node-only map builder, because the
 *  browser-side material contract has to agree with it. */
export const ORM_CENTER = 230 / 255;

/** Look-dev tunables. Amplitudes are fractions of the base tint. */
export const SURFACE_TUNING = Object.freeze({
  /** Midtone the bake sits at. Deliberately below 1 minus the wear lift: a
   *  worn bevel on a zone whose tint is already 1 would otherwise land on the
   *  material's own base colour and read as a painted-on white outline rather
   *  than as thinned paint. */
  midtone: 0.93,
  /** Mottle every part carries before its own authored variation is added. */
  mottleBase: 0.014,
  /** Cavity-occlusion depth (object-sculpt-spec cavityStrength). */
  occlusion: 0.38,
  /** Extra darkening in the first fraction of a yard above the ground. */
  contact: 0.14,
  /** Ground-thrown grime reach, in yards, and its strength. */
  grimeHeight: 1.05,
  grime: 0.13,
  /** Settled dust lift on upward faces, strongest high on the hull. */
  dust: 0.045,
  /** Paint worn thin on the up-facing bevels and rims. */
  wear: 0.05,
  /** Darkening on the bevels light does NOT reach: the side and underside
   *  fillets. This is what draws a plate's own outline, which is how the
   *  reference sheet separates one armour plate from the next, and it is the
   *  complement of the wear band rather than a second copy of it. */
  seam: 0.15,
  /** Warm dust cast grime pulls the albedo toward (per channel, <= 1). */
  grimeTone: Object.freeze([1, 0.955, 0.86]),
  /** Cool bare-metal cast bevel wear pulls the albedo toward. */
  wearTone: Object.freeze([1, 0.995, 0.985]),
  /** Floor the composed multiplier is clamped to. The darkest zones start near
   *  the bottom of the usable range already, so an unbounded product crushes
   *  the treads and the cannon to black. */
  floor: 0.62,
});

/** Repeats per world yard, per material family. Painted plates read as large
 *  panels; hardware and fabric need a much finer grain at the same texel size. */
export const UV_SCALE = Object.freeze({
  creamPaint: 1.15,
  violetPaint: 1.3,
  darkIron: 1.75,
  bronze: 2.6,
  leather: 5.2,
  textile: 7.5,
});

const HASH_MIX_A = 0x85ebca6b;
const HASH_MIX_B = 0xc2b2ae35;
const HASH_AXIS_X = 0x27d4eb2d;
const HASH_AXIS_Y = 0x165667b1;
const HASH_AXIS_Z = 0x9e3779b1;
const HASH_SEED = 0x7feb352d;
const UINT32_SPAN = 4294967296;

function mix32(value) {
  let hashed = Math.imul(value ^ (value >>> 16), HASH_MIX_A);
  hashed = Math.imul(hashed ^ (hashed >>> 13), HASH_MIX_B);
  return (hashed ^ (hashed >>> 16)) >>> 0;
}

/** Unit hash of a 2D integer lattice point. */
export function hash2(x, y, seed) {
  return (
    mix32(
      (Math.imul(x | 0, HASH_AXIS_X) ^
        Math.imul(y | 0, HASH_AXIS_Y) ^
        Math.imul(seed | 0, HASH_SEED)) |
        0,
    ) / UINT32_SPAN
  );
}

/** Unit hash of a 3D integer lattice point. */
export function hash3(x, y, z, seed) {
  return (
    mix32(
      (Math.imul(x | 0, HASH_AXIS_X) ^
        Math.imul(y | 0, HASH_AXIS_Y) ^
        Math.imul(z | 0, HASH_AXIS_Z) ^
        Math.imul(seed | 0, HASH_SEED)) |
        0,
    ) / UINT32_SPAN
  );
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrapIndex(value, period) {
  return ((value % period) + period) % period;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function smoothstep(edge0, edge1, value) {
  return fade(clamp((value - edge0) / (edge1 - edge0), 0, 1));
}

/** Value noise on a lattice that wraps every `periodX` cells across and
 *  `periodY` down, so sampling with `x = u * periodX, y = v * periodY` tiles
 *  seamlessly over u, v in [0, 1). The two periods are separate on purpose: a
 *  stretched band uses different cell counts per axis, and wrapping both on one
 *  of them leaves the other axis' lattice never reaching its wrap point, which
 *  is a seam. */
export function periodicNoise2(x, y, periodX, periodY, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const xa = wrapIndex(x0, periodX);
  const xb = wrapIndex(x0 + 1, periodX);
  const ya = wrapIndex(y0, periodY);
  const yb = wrapIndex(y0 + 1, periodY);
  return lerp(
    lerp(hash2(xa, ya, seed), hash2(xb, ya, seed), fx),
    lerp(hash2(xa, yb, seed), hash2(xb, yb, seed), fx),
    fy,
  );
}

/** Seamless fractal noise over u, v in [0, 1). `aspect` above 1 stretches the
 *  band along v (the brushed-metal streaks); below 1 it stretches along u (the
 *  grime runs). */
export function periodicFbm2(u, v, basePeriod, octaves, seed, aspect = 1) {
  let amplitude = 1;
  let sum = 0;
  let norm = 0;
  let period = basePeriod;
  for (let octave = 0; octave < octaves; octave++) {
    const periodX = Math.max(1, Math.round(period / aspect));
    sum +=
      amplitude * periodicNoise2(u * periodX, v * period, periodX, period, seed + octave * 977);
    norm += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Non-tiling 3D value noise, for per-vertex mottle in world space. */
export function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);
  const c00 = lerp(hash3(x0, y0, z0, seed), hash3(x0 + 1, y0, z0, seed), fx);
  const c10 = lerp(hash3(x0, y0 + 1, z0, seed), hash3(x0 + 1, y0 + 1, z0, seed), fx);
  const c01 = lerp(hash3(x0, y0, z0 + 1, seed), hash3(x0 + 1, y0, z0 + 1, seed), fx);
  const c11 = lerp(hash3(x0, y0 + 1, z0 + 1, seed), hash3(x0 + 1, y0 + 1, z0 + 1, seed), fx);
  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}

/** Fractal 3D noise centred on 0 (range about [-1, 1]). */
export function signedFbm3(x, y, z, seed, octaves = 3) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum +=
      amplitude *
      (valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 613) - 0.5);
    norm += amplitude * 0.5;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// World-space box-projected UVs
// ---------------------------------------------------------------------------

/** Write world-space box-projected UVs for a NON-INDEXED triangle soup.
 *
 *  The projection plane is picked per triangle from its dominant face-normal
 *  axis, so a triangle is never sheared and coplanar neighbours stay
 *  continuous; the axis flip on a curved surface lands on the 45 degree crease,
 *  where micro detail hides it. `offset` moves a part into world space when its
 *  geometry is authored in a node's local frame (the road wheels).
 *
 *  Each projection group is then folded back toward the origin by a whole number
 *  of repeats. The maps tile with period 1, so an integer UV shift samples
 *  exactly the same texels and leaves derivatives untouched, while the raw range
 *  collapses from tens of repeats to a handful. That is what lets the exporter
 *  quantize the accessor at all (`quantize()` skips any texcoord outside [0, 1],
 *  and float32 texcoords cost more than the rest of the geometry put together).
 *  The fold is per projection GROUP, not per triangle and not per part: one
 *  offset across a group keeps coplanar neighbours continuous, which the vertex
 *  codec's delta prediction depends on, while a single offset for the whole part
 *  would have to span three unrelated world axes (a shoulder plate 1.8 yards up
 *  pushed the range from 5 repeats to 20). Groups are already discontinuous with
 *  each other by construction, so shifting them apart costs nothing. */
export function boxProjectUvInto(positions, normals, uvOut, scale, offset = [0, 0, 0]) {
  if (positions.length % 9 !== 0) {
    throw new Error(`box projection needs a non-indexed triangle soup, got ${positions.length}`);
  }
  const [ox, oy, oz] = offset;
  const triangles = positions.length / 9;
  const groups = new Uint8Array(triangles);
  const groupMinU = [Infinity, Infinity, Infinity];
  const groupMinV = [Infinity, Infinity, Infinity];

  for (let triangle = 0; triangle < triangles; triangle++) {
    const base = triangle * 9;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let corner = 0; corner < 3; corner++) {
      nx += normals[base + corner * 3];
      ny += normals[base + corner * 3 + 1];
      nz += normals[base + corner * 3 + 2];
    }
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const group = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
    groups[triangle] = group;
    for (let corner = 0; corner < 3; corner++) {
      const px = positions[base + corner * 3] + ox;
      const py = positions[base + corner * 3 + 1] + oy;
      const pz = positions[base + corner * 3 + 2] + oz;
      const u = (group === 1 ? px : group === 0 ? pz : px) * scale;
      const v = (group === 1 ? pz : py) * scale;
      const target = (triangle * 3 + corner) * 2;
      uvOut[target] = u;
      uvOut[target + 1] = v;
      if (u < groupMinU[group]) groupMinU[group] = u;
      if (v < groupMinV[group]) groupMinV[group] = v;
    }
  }

  for (let group = 0; group < 3; group++) {
    groupMinU[group] = Number.isFinite(groupMinU[group]) ? Math.floor(groupMinU[group]) : 0;
    groupMinV[group] = Number.isFinite(groupMinV[group]) ? Math.floor(groupMinV[group]) : 0;
  }
  for (let triangle = 0; triangle < triangles; triangle++) {
    const group = groups[triangle];
    for (let corner = 0; corner < 3; corner++) {
      const target = (triangle * 3 + corner) * 2;
      uvOut[target] -= groupMinU[group];
      uvOut[target + 1] -= groupMinV[group];
    }
  }
}

// ---------------------------------------------------------------------------
// Cavity occlusion against the neighbouring parts
// ---------------------------------------------------------------------------

const OCCLUSION_DISTANCES = Object.freeze([0.07, 0.17, 0.34]);
const OCCLUSION_DISTANCE_WEIGHTS = Object.freeze([0.5, 0.32, 0.18]);
const OCCLUSION_TILT = 0.62;
const OCCLUSION_RING = 8;
const OCCLUSION_SHRINK = 0.006;

/** Hemisphere sample directions in a tangent basis: the normal plus one tilted
 *  ring. Fixed and precomputed, so occlusion is stable across runs. */
const OCCLUSION_DIRECTIONS = (() => {
  const directions = [[0, 0, 1]];
  for (let step = 0; step < OCCLUSION_RING; step++) {
    const angle = (step * Math.PI * 2) / OCCLUSION_RING;
    directions.push([
      Math.cos(angle) * Math.sin(OCCLUSION_TILT),
      Math.sin(angle) * Math.sin(OCCLUSION_TILT),
      Math.cos(OCCLUSION_TILT),
    ]);
  }
  return Object.freeze(directions.map((direction) => Object.freeze(direction)));
})();

/** Bucket part boxes into a uniform grid so a sample point only tests the
 *  handful of boxes near it. `boxes` entries are { min: [x,y,z], max: [x,y,z] }. */
export function buildOccluderIndex(boxes, cellSize = 0.3) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      if (box.min[axis] < min[axis]) min[axis] = box.min[axis];
      if (box.max[axis] > max[axis]) max[axis] = box.max[axis];
    }
  }
  if (boxes.length === 0) {
    return { boxes, cellSize, min: [0, 0, 0], dims: [1, 1, 1], cells: [[]] };
  }
  const dims = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    dims[axis] = Math.max(1, Math.ceil((max[axis] - min[axis]) / cellSize) + 1);
  }
  const cells = new Array(dims[0] * dims[1] * dims[2]);
  for (let index = 0; index < cells.length; index++) cells[index] = [];
  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
    const box = boxes[boxIndex];
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      lo[axis] = clamp(Math.floor((box.min[axis] - min[axis]) / cellSize), 0, dims[axis] - 1);
      hi[axis] = clamp(Math.floor((box.max[axis] - min[axis]) / cellSize), 0, dims[axis] - 1);
    }
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          cells[(x * dims[1] + y) * dims[2] + z].push(boxIndex);
        }
      }
    }
  }
  return { boxes, cellSize, min, dims, cells };
}

function occludedAtPoint(index, x, y, z, ownerId) {
  const { boxes, cellSize, min, dims, cells } = index;
  const cx = Math.floor((x - min[0]) / cellSize);
  const cy = Math.floor((y - min[1]) / cellSize);
  const cz = Math.floor((z - min[2]) / cellSize);
  if (cx < 0 || cy < 0 || cz < 0 || cx >= dims[0] || cy >= dims[1] || cz >= dims[2]) return false;
  const candidates = cells[(cx * dims[1] + cy) * dims[2] + cz];
  for (let slot = 0; slot < candidates.length; slot++) {
    const boxIndex = candidates[slot];
    if (boxes[boxIndex].ownerId === ownerId) continue;
    const box = boxes[boxIndex];
    if (
      x > box.min[0] + OCCLUSION_SHRINK &&
      x < box.max[0] - OCCLUSION_SHRINK &&
      y > box.min[1] + OCCLUSION_SHRINK &&
      y < box.max[1] - OCCLUSION_SHRINK &&
      z > box.min[2] + OCCLUSION_SHRINK &&
      z < box.max[2] - OCCLUSION_SHRINK
    ) {
      return true;
    }
  }
  return false;
}

/** Fraction of the normal hemisphere blocked by other parts, in [0, 1]. */
export function occlusionAt(index, x, y, z, nx, ny, nz, ownerId) {
  const length = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / length, ny / length, nz / length];
  const absolute = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const smallest =
    absolute[0] <= absolute[1] && absolute[0] <= absolute[2]
      ? 0
      : absolute[1] <= absolute[2]
        ? 1
        : 2;
  const helper = [0, 0, 0];
  helper[smallest] = 1;
  let tx = helper[1] * n[2] - helper[2] * n[1];
  let ty = helper[2] * n[0] - helper[0] * n[2];
  let tz = helper[0] * n[1] - helper[1] * n[0];
  const tangentLength = Math.hypot(tx, ty, tz) || 1;
  tx /= tangentLength;
  ty /= tangentLength;
  tz /= tangentLength;
  const bx = n[1] * tz - n[2] * ty;
  const by = n[2] * tx - n[0] * tz;
  const bz = n[0] * ty - n[1] * tx;

  let blocked = 0;
  let total = 0;
  for (const direction of OCCLUSION_DIRECTIONS) {
    const dx = tx * direction[0] + bx * direction[1] + n[0] * direction[2];
    const dy = ty * direction[0] + by * direction[1] + n[1] * direction[2];
    const dz = tz * direction[0] + bz * direction[1] + n[2] * direction[2];
    for (let step = 0; step < OCCLUSION_DISTANCES.length; step++) {
      const distance = OCCLUSION_DISTANCES[step];
      const weight = OCCLUSION_DISTANCE_WEIGHTS[step];
      total += weight;
      if (
        occludedAtPoint(index, x + dx * distance, y + dy * distance, z + dz * distance, ownerId)
      ) {
        blocked += weight;
      }
    }
  }
  return total === 0 ? 0 : blocked / total;
}

// ---------------------------------------------------------------------------
// The baked macro pass
// ---------------------------------------------------------------------------

/** How far off an axis a normal has to lean before it counts as a bevel. A
 *  rounded box's flat faces sit at 1, its fillets well below. */
function bevelWeight(nx, ny, nz) {
  const dominant = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
  return smoothstep(0.99, 0.72, dominant);
}

/**
 * Compose the baked macro multiplier for one part into `colorOut` (RGB float
 * triples aligned with `positions`).
 *
 * @param {Float32Array} positions part-local vertex positions
 * @param {Float32Array} normals matching vertex normals
 * @param {Float32Array} colorOut destination, length positions.length
 * @param {object} options
 * @param {[number, number, number]} options.tint semantic zone ratio per channel
 * @param {[number, number, number]} [options.offset] part-local to world offset
 * @param {object|null} [options.occluders] index from buildOccluderIndex
 * @param {number} [options.ownerId] this part's id, excluded from occlusion
 * @param {number} [options.variation] per-part mottle amplitude
 * @param {number} [options.seed] mottle seed
 * @param {object} [options.weights] per-term gate, so the authoring stages can
 *   bring the surface and lighting bands in separately (all 1 by default)
 */
export function shadeSurfaceInto(positions, normals, colorOut, options) {
  const tint = options.tint;
  const [ox, oy, oz] = options.offset ?? [0, 0, 0];
  const occluders = options.occluders ?? null;
  const ownerId = options.ownerId ?? -1;
  const variation = options.variation ?? 0;
  const seed = options.seed ?? 0;
  const tuning = SURFACE_TUNING;
  const weights = options.weights ?? {};
  const midtone = weights.midtone ?? tuning.midtone;
  const occlusionWeight = weights.occlusion ?? 1;
  const contactWeight = weights.contact ?? 1;
  const grimeWeight = weights.grime ?? 1;
  const dustWeight = weights.dust ?? 1;
  const wearWeight = weights.wear ?? 1;
  const seamWeight = weights.seam ?? 1;
  const mottleWeight = weights.mottle ?? 1;

  for (let vertex = 0; vertex < positions.length; vertex += 3) {
    const x = positions[vertex] + ox;
    const y = positions[vertex + 1] + oy;
    const z = positions[vertex + 2] + oz;
    const nx = normals[vertex];
    const ny = normals[vertex + 1];
    const nz = normals[vertex + 2];

    const cavity = occluders ? occlusionAt(occluders, x, y, z, nx, ny, nz, ownerId) : 0;
    const contact = smoothstep(0.55, 0, y);
    const upward = clamp(ny, 0, 1);
    const downward = clamp(-ny, 0, 1);
    // Grime climbs from the tracks and clings hardest to upward ledges and
    // undersides, the way road spray actually settles on a tracked vehicle.
    const grime =
      smoothstep(tuning.grimeHeight, 0, y) * (0.45 + 0.35 * upward + 0.4 * downward) * grimeWeight;
    const dust = upward * smoothstep(1.2, 2.2, y) * dustWeight;
    // Paint thins where hands, weather and cargo reach: the top edges, not the
    // undersides. A uniform bevel lift washes the whole fillet band instead.
    // One signed bevel term rather than two overlapping ones: a fillet that
    // faces up has its paint thinned, a fillet that faces sideways or down is a
    // seam, and the crossover sits halfway between. Applying both bands to the
    // same fillet made every top edge read darker than the flat face beside it.
    const bevel = bevelWeight(nx, ny, nz);
    const bevelBias = bevel * (upward * 2 - 1);
    const wear = bevelBias > 0 ? bevelBias * wearWeight : 0;
    const seam = bevelBias < 0 ? -bevelBias * seamWeight : 0;
    const mottle =
      variation === 0 || mottleWeight === 0
        ? 0
        : signedFbm3(x * 1.6, y * 1.6, z * 1.6, seed) * variation * mottleWeight;

    let shade = midtone;
    shade *= 1 - tuning.occlusion * cavity * occlusionWeight;
    shade *= 1 - tuning.contact * contact * contactWeight;
    shade *= 1 - tuning.grime * grime;
    shade *= 1 + tuning.dust * dust;
    shade *= 1 + tuning.wear * wear;
    shade *= 1 - tuning.seam * seam;
    shade *= 1 + mottle;

    const grimeMix = clamp(grime, 0, 1);
    const wearMix = clamp(wear, 0, 1);
    for (let channel = 0; channel < 3; channel++) {
      const cast =
        lerp(1, tuning.grimeTone[channel], grimeMix) * lerp(1, tuning.wearTone[channel], wearMix);
      colorOut[vertex + channel] = clamp(
        tint[channel] * clamp(shade * cast, tuning.floor, 1),
        0,
        1,
      );
    }
  }
}
