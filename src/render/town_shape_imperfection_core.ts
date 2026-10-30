// Render-only "settled" imperfection for procedural town geometry (pure,
// Three-free).
//
// A town built from boxes and extrusions reads ruled: every ridge dead level,
// every wall dead plumb. This core bends the DRAWN vertices of one building or
// prop by a smooth, low-frequency displacement field, seeded from the
// building's id so it is the same on every load and every host:
//   - a lean: a shear of up to `leanRadians` about the footprint base;
//   - a bow: tall walls bulge outward a little at mid-height, most at the
//     middle of each wall and not at all at the corners (stiff quoins);
//   - a sag: above the eave line, ridges and eaves dip between their supports,
//     most at mid-span, nothing at the gable ends;
//   - a wobble: a soft long-wavelength wave on every vertex.
// Every term is zero at and below the footprint base, so footings stay on
// their ground and the sim's collision footprint (which this never reads or
// writes) still matches the drawn base. Amplitudes are a few centimetres to a
// sixth of a yard, and the field's wavelength is many times the size of a
// door or window, so parts modelled against each other move together and
// keep their fit. Vertex counts are unchanged: only existing vertices move
// (callers that want a sagging span give it interior vertices first).

export interface ShapeImperfectionFrame {
  /** Footprint centre in the geometry's frame. */
  centerX: number;
  centerZ: number;
  /** Footprint turn (radians, about +y): the local axes the bow and sag use. */
  yaw: number;
  /** Footprint half extents along the local x and z axes. */
  halfWidth: number;
  halfDepth: number;
  /** Frame y of the footprint base (ground); nothing at or below it moves. */
  baseY: number;
  /** Height of the building above its base (the bow's span). */
  height: number;
  /** Frame y where the roof starts (sag applies above it), or null for no sag. */
  eaveY: number | null;
  /** The local axis the ridge runs along. */
  ridgeAxis: 'x' | 'z';
}

export interface ShapeImperfectionAmplitudes {
  /** Largest lean, radians (about 1 degree reads as settled, not toppling). */
  leanRadians: number;
  /** Largest outward bow of a tall wall at mid-height, yards. */
  bowYards: number;
  /** Largest dip of a ridge at mid-span, yards. */
  sagYards: number;
  /** Wobble amplitude, yards. */
  wobbleYards: number;
  /** Wobble wavelength, yards (long, so straight runs bend, not ripple). */
  wobbleWavelength: number;
}

/** A gently settled building: ~0.7 degree lean, 6 cm bow, 0.15 yd ridge sag. */
export const TOWN_BUILDING_IMPERFECTION: Readonly<ShapeImperfectionAmplitudes> = Object.freeze({
  leanRadians: 0.012,
  bowYards: 0.06,
  sagYards: 0.15,
  wobbleYards: 0.025,
  wobbleWavelength: 7,
});

/** A small prop (stall, bench, fence): a slighter lean, a canvas or rail sag. */
export const TOWN_PROP_IMPERFECTION: Readonly<ShapeImperfectionAmplitudes> = Object.freeze({
  leanRadians: 0.014,
  bowYards: 0.015,
  sagYards: 0.06,
  wobbleYards: 0.012,
  wobbleWavelength: 3.5,
});

/** Height over which the wobble eases in above the base, yards. */
const WOBBLE_RAMP_YARDS = 1.2;
/** The sag eases in across this band below and above the eave line, yards. */
const SAG_RAMP_BELOW = 0.35;
const SAG_RAMP_ABOVE = 0.25;
/** Share of the ridge's mid-span sag the eaves parallel to it keep. */
const EAVE_SAG_SHARE = 0.55;

/** FNV-1a 32-bit hash of a string: the seed of one building's field. */
export function shapeImperfectionSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic [0, 1) stream from a 32-bit seed (mulberry32). */
function seededStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface ShapeImperfection {
  /** Write the displacement of frame point (x, y, z) into `out` [dx, dy, dz]. */
  displace(x: number, y: number, z: number, out: number[] | Float64Array): void;
  /** An upper bound on |displacement| anywhere in the field. */
  readonly maxDisplacement: number;
}

/** The identity field: nothing moves. */
export const NO_SHAPE_IMPERFECTION: ShapeImperfection = Object.freeze({
  displace(_x: number, _y: number, _z: number, out: number[] | Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  },
  maxDisplacement: 0,
});

/** Build the field of one building. Deterministic in (seed, frame, amplitudes). */
export function createShapeImperfection(
  seed: number,
  frame: ShapeImperfectionFrame,
  amplitudes: ShapeImperfectionAmplitudes,
): ShapeImperfection {
  const random = seededStream(seed);
  const signed = () => random() * 2 - 1;
  // Lean: a direction and an amount, at least a third of the cap so every
  // building visibly settles, in the LOCAL frame then turned to the frame.
  const leanAngle = random() * Math.PI * 2;
  const leanAmount = Math.tan(amplitudes.leanRadians * (0.35 + 0.65 * random()));
  const leanLocalX = Math.cos(leanAngle) * leanAmount;
  const leanLocalZ = Math.sin(leanAngle) * leanAmount;
  // Bow: each of the four walls bulges outward by its own share (never inward,
  // so a facade never sinks into the core it was modelled against).
  const bowPosX = 0.3 + 0.7 * random();
  const bowNegX = 0.3 + 0.7 * random();
  const bowPosZ = 0.3 + 0.7 * random();
  const bowNegZ = 0.3 + 0.7 * random();
  const sag = amplitudes.sagYards * (0.6 + 0.4 * random());
  // Wobble: three plane waves on seeded directions and phases.
  const waves = [0, 1, 2].map(() => {
    const theta = random() * Math.PI * 2;
    const tilt = signed() * 0.5;
    const k = (Math.PI * 2) / (amplitudes.wobbleWavelength * (0.8 + 0.4 * random()));
    return {
      kx: Math.cos(theta) * k,
      ky: tilt * k,
      kz: Math.sin(theta) * k,
      phase: random() * Math.PI * 2,
    };
  });
  const cosYaw = Math.cos(frame.yaw);
  const sinYaw = Math.sin(frame.yaw);
  const halfWidth = Math.max(frame.halfWidth, 1e-3);
  const halfDepth = Math.max(frame.halfDepth, 1e-3);
  const height = Math.max(frame.height, 1e-3);
  const bowCap = Math.max(bowPosX, bowNegX, bowPosZ, bowNegZ);
  // Each term's own bound, summed: the lean is capped at the building's
  // height, the bow's two components at bowCap each, the sag at `sag`, and the
  // wobble's three waves at (1, 0.5, 1) of its amplitude.
  const maxDisplacement =
    leanAmount * Math.max(0, frame.height) +
    amplitudes.bowYards * bowCap * Math.SQRT2 +
    (frame.eaveY === null ? 0 : sag) +
    amplitudes.wobbleYards * 1.5;

  return {
    maxDisplacement,
    displace(x: number, y: number, z: number, out: number[] | Float64Array): void {
      const h = y - frame.baseY;
      if (h <= 0) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return;
      }
      // Into the footprint's local frame (yaw about +y).
      const dx = x - frame.centerX;
      const dz = z - frame.centerZ;
      const lx = cosYaw * dx - sinYaw * dz;
      const lz = sinYaw * dx + cosYaw * dz;
      const xn = Math.min(1, Math.max(-1, lx / halfWidth));
      const zn = Math.min(1, Math.max(-1, lz / halfDepth));
      // Lean grows with height; a point above the building's height leans no
      // further (spires and chimneys stay on their towers).
      const leanHeight = Math.min(h, frame.height);
      let ox = leanLocalX * leanHeight;
      let oz = leanLocalZ * leanHeight;
      let oy = 0;
      // Bow: sin over the wall's height, cos across its width, outward along
      // the wall's own axis; scaled by the normalized coordinate so the
      // interior (and the field) stays continuous through the centre.
      const bowY = Math.sin(Math.PI * Math.min(1, h / height)) * amplitudes.bowYards;
      ox += bowY * xn * (xn >= 0 ? bowPosX : bowNegX) * Math.cos((Math.PI / 2) * zn);
      oz += bowY * zn * (zn >= 0 ? bowPosZ : bowNegZ) * Math.cos((Math.PI / 2) * xn);
      // Sag above the eaves: full at mid-ridge, a share along the eaves
      // parallel to it, nothing at the gable ends.
      if (frame.eaveY !== null) {
        const roofWeight = smoothstep(
          frame.eaveY - frame.baseY - SAG_RAMP_BELOW,
          frame.eaveY - frame.baseY + SAG_RAMP_ABOVE,
          h,
        );
        if (roofWeight > 0) {
          const along = frame.ridgeAxis === 'x' ? xn : zn;
          const across = frame.ridgeAxis === 'x' ? zn : xn;
          const spanProfile = Math.sin((Math.PI / 2) * (along + 1));
          const crossProfile = Math.sin((Math.PI / 2) * (across + 1));
          oy -=
            sag * roofWeight * spanProfile * (EAVE_SAG_SHARE + (1 - EAVE_SAG_SHARE) * crossProfile);
        }
      }
      // Wobble, eased in above the base.
      const wobbleWeight = smoothstep(0, WOBBLE_RAMP_YARDS, h) * amplitudes.wobbleYards;
      if (wobbleWeight > 0) {
        const w0 = waves[0];
        const w1 = waves[1];
        const w2 = waves[2];
        ox += wobbleWeight * Math.sin(w0.kx * x + w0.ky * y + w0.kz * z + w0.phase);
        oy += wobbleWeight * 0.5 * Math.sin(w1.kx * x + w1.ky * y + w1.kz * z + w1.phase);
        oz += wobbleWeight * Math.sin(w2.kx * x + w2.ky * y + w2.kz * z + w2.phase);
      }
      // Back from the local frame.
      out[0] = cosYaw * ox + sinYaw * oz;
      out[1] = oy;
      out[2] = -sinYaw * ox + cosYaw * oz;
    },
  };
}

/** Central-difference step for the field's Jacobian (yards). */
const JACOBIAN_STEP = 0.02;

/**
 * Move every vertex of `positions` (xyz triples, in the field's frame) by the
 * field, and turn `normals` by the field's local deformation (the inverse
 * transpose of I + J, to first order) so lighting follows the new shape.
 * In place; vertex count unchanged. Identical input points move identically,
 * so a shared edge stays shared.
 */
export function applyShapeImperfection(
  positions: { length: number; [index: number]: number },
  normals: { length: number; [index: number]: number } | null,
  field: ShapeImperfection,
): void {
  if (field.maxDisplacement === 0) return;
  const d = [0, 0, 0];
  const px = [0, 0, 0];
  const nx = [0, 0, 0];
  const py = [0, 0, 0];
  const ny = [0, 0, 0];
  const pz = [0, 0, 0];
  const nz = [0, 0, 0];
  const count = Math.floor(positions.length / 3);
  for (let vertex = 0; vertex < count; vertex++) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    field.displace(x, y, z, d);
    if (normals) {
      const step = JACOBIAN_STEP;
      field.displace(x + step, y, z, px);
      field.displace(x - step, y, z, nx);
      field.displace(x, y + step, z, py);
      field.displace(x, y - step, z, ny);
      field.displace(x, y, z + step, pz);
      field.displace(x, y, z - step, nz);
      const inv = 1 / (2 * step);
      // J[r][c] = d(displacement r) / d(axis c)
      const j00 = (px[0] - nx[0]) * inv;
      const j10 = (px[1] - nx[1]) * inv;
      const j20 = (px[2] - nx[2]) * inv;
      const j01 = (py[0] - ny[0]) * inv;
      const j11 = (py[1] - ny[1]) * inv;
      const j21 = (py[2] - ny[2]) * inv;
      const j02 = (pz[0] - nz[0]) * inv;
      const j12 = (pz[1] - nz[1]) * inv;
      const j22 = (pz[2] - nz[2]) * inv;
      const n0 = normals[vertex * 3];
      const n1 = normals[vertex * 3 + 1];
      const n2 = normals[vertex * 3 + 2];
      // n' = (I - J^T) n, renormalized.
      const m0 = n0 - (j00 * n0 + j10 * n1 + j20 * n2);
      const m1 = n1 - (j01 * n0 + j11 * n1 + j21 * n2);
      const m2 = n2 - (j02 * n0 + j12 * n1 + j22 * n2);
      const length = Math.hypot(m0, m1, m2);
      if (length > 1e-9) {
        normals[vertex * 3] = m0 / length;
        normals[vertex * 3 + 1] = m1 / length;
        normals[vertex * 3 + 2] = m2 / length;
      }
    }
    positions[vertex * 3] = x + d[0];
    positions[vertex * 3 + 1] = y + d[1];
    positions[vertex * 3 + 2] = z + d[2];
  }
}
