// Pure geometry math for a DASHED flat ring (no Three, no DOM, no i18n): the
// broken-annulus counterpart to THREE.RingGeometry, emitted as plain
// position/index arrays a thin consumer wraps in a BufferGeometry.
//
// Why a dashed ring exists at all: a solid ring at a unit's feet is already
// spoken for. The target reticle (renderer.ts) is a solid, pulsing, bloomed
// annulus and that is the ONLY thing allowed to say "this is my target". A
// second solid ring in the same red (the battleground ally/enemy identity mark)
// read as the same signal, so every enemy on the field looked targeted. Breaking
// the identity ring into dashes separates the two visual languages by SHAPE,
// which survives distance, color-vision differences, and bloom, where a hue or
// opacity difference would not.
//
// Vertex layout matches THREE.RingGeometry's conventions so a consumer can swap
// one for the other without touching its transforms: vertices lie in the XY
// plane (z = 0), winding is counter-clockwise seen from +Z, and the caller is
// expected to lay the ring flat with rotation.x = -PI/2. Only position and index
// are produced: a MeshBasicMaterial with no map needs neither normals nor uvs.
//
// Everything here is deterministic and allocation-bounded by its inputs; the
// consumer builds each geometry once and pools it, so nothing on this path runs
// per frame.

/** Ring shape plus how the annulus is broken into dashes. */
export interface DashedRingSpec {
  /** Inner radius, in world units. */
  inner: number;
  /** Outer radius, in world units. Must exceed `inner`. */
  outer: number;
  /** Number of evenly spaced dashes around the full turn (>= 1). */
  dashes: number;
  /**
   * Fraction of each dash cell that is INKED, in (0, 1]. 1 closes the gaps back
   * into a solid ring; 0.5 means dash and gap are the same arc length.
   */
  duty: number;
  /** Angular subdivisions per dash arc (>= 1); higher is smoother. */
  segments: number;
  /** Optional rotation of the whole dash pattern, in radians (default 0). */
  phase?: number;
}

/** Plain arrays a consumer feeds straight into a BufferGeometry. */
export interface DashedRingArrays {
  /** Interleaved xyz triples, z always 0. */
  positions: Float32Array;
  /** Triangle indices into `positions` (two triangles per angular segment). */
  indices: Uint16Array | Uint32Array;
}

const TAU = Math.PI * 2;

function normalizeSpec(spec: DashedRingSpec): {
  inner: number;
  outer: number;
  dashes: number;
  duty: number;
  segments: number;
  phase: number;
} {
  const inner = Math.max(0, spec.inner);
  const outer = spec.outer;
  if (!(outer > inner)) {
    // Dev-channel throw: a caller-side authoring mistake, never player-facing.
    throw new RangeError(`dashedRingGeometry: outer (${outer}) must exceed inner (${inner})`);
  }
  return {
    inner,
    outer,
    dashes: Math.max(1, Math.floor(spec.dashes)),
    duty: Math.min(1, Math.max(0, spec.duty)),
    segments: Math.max(1, Math.floor(spec.segments)),
    phase: spec.phase ?? 0,
  };
}

/**
 * Build the position/index arrays for a dashed annulus.
 *
 * Each dash is a quad strip of `segments` quads spanning `duty` of its cell,
 * so the drawn arc per dash is `duty * 2*PI / dashes` radians. A duty of 1
 * produces a closed ring whose dashes abut, which is the useful degenerate case
 * (it keeps a caller from needing a second code path to draw a solid ring).
 */
export function dashedRingGeometry(spec: DashedRingSpec): DashedRingArrays {
  const { inner, outer, dashes, duty, segments, phase } = normalizeSpec(spec);
  const ringsPerDash = segments + 1;
  const vertsPerDash = ringsPerDash * 2;
  const vertexCount = dashes * vertsPerDash;
  const positions = new Float32Array(vertexCount * 3);
  const indices: Uint16Array | Uint32Array =
    vertexCount > 65535
      ? new Uint32Array(dashes * segments * 6)
      : new Uint16Array(dashes * segments * 6);

  const cell = TAU / dashes;
  const arc = cell * duty;
  let p = 0;
  let i = 0;
  for (let d = 0; d < dashes; d++) {
    const start = phase + d * cell;
    const base = d * vertsPerDash;
    for (let s = 0; s <= segments; s++) {
      const theta = start + (arc * s) / segments;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // Inner vertex then outer vertex, so a quad is (j, j+1, j+3, j+2).
      positions[p++] = cos * inner;
      positions[p++] = sin * inner;
      positions[p++] = 0;
      positions[p++] = cos * outer;
      positions[p++] = sin * outer;
      positions[p++] = 0;
    }
    for (let s = 0; s < segments; s++) {
      const q = base + s * 2;
      // Counter-clockwise seen from +Z, matching THREE.RingGeometry's facing.
      indices[i++] = q;
      indices[i++] = q + 1;
      indices[i++] = q + 3;
      indices[i++] = q;
      indices[i++] = q + 3;
      indices[i++] = q + 2;
    }
  }
  return { positions, indices };
}

/**
 * The duty an OUTLINE ring needs so its dashes overhang the dashes it sits
 * behind by `pad` on both ends, the angular twin of padding the radii.
 *
 * A dark underlay drawn with the same duty as the color ring would leave each
 * dash END uncapped, so the color would meet bare ground exactly where the
 * dash is thinnest. `pad` is an arc length in world units, converted at the
 * ring's mid radius; the result is clamped to 1 (a pad wide enough to close the
 * gaps yields a solid outline rather than overlapping neighbours).
 */
export function paddedOutlineDuty(spec: DashedRingSpec, pad: number): number {
  const { inner, outer, dashes, duty } = normalizeSpec(spec);
  const mid = (inner + outer) / 2;
  if (mid <= 0 || pad <= 0) return duty;
  const cell = TAU / dashes;
  return Math.min(1, duty + (2 * pad) / mid / cell);
}
