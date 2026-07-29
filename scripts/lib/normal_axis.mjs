// Detect (and repair) a NORMAL-vs-POSITION axis-space mismatch in a mesh.
//
// Why this exists
// ---------------
// An FBX-derived armor set is authored Z-up and has to be converted to glTF's
// Y-up on the way in. When a converter applies that rotation to POSITION but
// leaves NORMAL alone (or applies it twice), the mesh still has the right shape
// and the right UVs, so every ordinary check passes: the file loads, the texture
// binds, the silhouette is correct. Only the shading is wrong, and it is wrong in
// a way that reads as a lighting bug rather than an asset bug.
//
// The tell is measurable without any renderer: a vertex normal is a smoothed
// average of the faces that share it, so for a sane mesh it points the same way
// as the winding-derived face normal. Score that agreement under every signed
// axis permutation. A healthy mesh peaks at the identity; a mesh whose normals
// live in another axis space peaks at whichever rotation undoes the conversion.
//
// Pure and dependency-free: callers hand over plain typed arrays, so both the
// repair CLI and the Vitest guard drive the same math.

/** The six signed axes, as [sourceComponent, sign] pairs. */
const AXES = [
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [2, 1],
  [2, -1],
];
const AXIS_LABEL = ['x', 'y', 'z'];

/** `(x,-z,y)` style label for a correction, read as "the new x is the old x, the
 *  new y is the old -z, the new z is the old y". */
function correctionName(basis) {
  return `(${basis.map(([c, s]) => `${s < 0 ? '-' : ''}${AXIS_LABEL[c]}`).join(',')})`;
}

/** Every signed axis permutation with determinant +1: the 24 rotations that map
 *  the coordinate frame onto itself. A conversion mistake is always one of these
 *  (mirrors would flip the winding too, which shows up as inside-out geometry,
 *  not as a shading bug), so keeping the set proper avoids reporting a mirror
 *  where a rotation explains the data just as well. */
export const AXIS_CORRECTIONS = (() => {
  const out = [];
  for (const ax of AXES) {
    for (const ay of AXES) {
      if (ay[0] === ax[0]) continue;
      for (const az of AXES) {
        if (az[0] === ax[0] || az[0] === ay[0]) continue;
        const basis = [ax, ay, az];
        // determinant of the signed permutation matrix
        const perm = basis.map(([c]) => c);
        const sign = basis.reduce((s, [, v]) => s * v, 1);
        const parity =
          (perm[0] === 0 && perm[1] === 1) ||
          (perm[0] === 1 && perm[1] === 2) ||
          (perm[0] === 2 && perm[1] === 0)
            ? 1
            : -1;
        if (sign * parity !== 1) continue;
        out.push({
          name: correctionName(basis),
          basis,
          isIdentity: correctionName(basis) === '(x,y,z)',
        });
      }
    }
  }
  return out;
})();

export const IDENTITY_CORRECTION = AXIS_CORRECTIONS.find((c) => c.isIdentity);

/** Look a correction up by its `(x,-z,y)` label. */
export function correctionByName(name) {
  return AXIS_CORRECTIONS.find((c) => c.name === name) ?? null;
}

/** Apply a correction to one vector, into `out`. */
export function applyCorrection(basis, x, y, z, out) {
  const v = [x, y, z];
  out[0] = basis[0][1] * v[basis[0][0]];
  out[1] = basis[1][1] * v[basis[1][0]];
  out[2] = basis[2][1] * v[basis[2][0]];
  return out;
}

/** How many triangles a scoring pass looks at. Vertex normals are smoothed, so
 *  the score is a population statistic; a few thousand faces pin it to well
 *  inside the gap between a healthy mesh and a mis-axed one. */
export const SCORE_SAMPLE_TARGET = 4000;

/**
 * Mean agreement, over sampled triangles, between the (corrected) averaged vertex
 * normal and the winding-derived face normal, for EVERY candidate correction at
 * once. One pass over the geometry scores all 24, which keeps the guard test cheap.
 *
 * `geometry` is `{ position, normal, index }` of plain array-likes; `index` may be
 * null for a non-indexed mesh. Returns `{ scores: Map<name, number>, samples }`.
 */
export function scoreAxisCorrections(geometry, sampleTarget = SCORE_SAMPLE_TARGET) {
  const { position, normal, index } = geometry;
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(position.length / 9);
  const step = Math.max(1, Math.floor(triCount / Math.max(1, sampleTarget)));
  const totals = new Float64Array(AXIS_CORRECTIONS.length);
  const corrected = [0, 0, 0];
  let samples = 0;

  for (let t = 0; t < triCount; t += step) {
    const i0 = index ? index[t * 3] : t * 3;
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2;

    const ax = position[i0 * 3];
    const ay = position[i0 * 3 + 1];
    const az = position[i0 * 3 + 2];
    const e1x = position[i1 * 3] - ax;
    const e1y = position[i1 * 3 + 1] - ay;
    const e1z = position[i1 * 3 + 2] - az;
    const e2x = position[i2 * 3] - ax;
    const e2y = position[i2 * 3 + 1] - ay;
    const e2z = position[i2 * 3 + 2] - az;
    let fx = e1y * e2z - e1z * e2y;
    let fy = e1z * e2x - e1x * e2z;
    let fz = e1x * e2y - e1y * e2x;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-12) continue; // degenerate face carries no orientation
    fx /= fl;
    fy /= fl;
    fz /= fl;

    let nx = (normal[i0 * 3] + normal[i1 * 3] + normal[i2 * 3]) / 3;
    let ny = (normal[i0 * 3 + 1] + normal[i1 * 3 + 1] + normal[i2 * 3 + 1]) / 3;
    let nz = (normal[i0 * 3 + 2] + normal[i1 * 3 + 2] + normal[i2 * 3 + 2]) / 3;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue; // a zero normal votes for nothing
    nx /= nl;
    ny /= nl;
    nz /= nl;

    for (let c = 0; c < AXIS_CORRECTIONS.length; c++) {
      applyCorrection(AXIS_CORRECTIONS[c].basis, nx, ny, nz, corrected);
      totals[c] += corrected[0] * fx + corrected[1] * fy + corrected[2] * fz;
    }
    samples++;
  }

  const scores = new Map();
  for (let c = 0; c < AXIS_CORRECTIONS.length; c++) {
    scores.set(AXIS_CORRECTIONS[c].name, samples === 0 ? 0 : totals[c] / samples);
  }
  return { scores, samples };
}

/**
 * The correction that best explains this mesh's normals, plus the identity score
 * so a caller can judge how healthy the mesh already is.
 *
 * `healthy` is the verdict a guard should assert: the identity wins AND clears
 * `minScore`. Shipped, correctly authored character meshes score about 0.85 to
 * 0.95 at the identity; a mesh whose normals sit in the wrong axis space scores
 * about 0.15 to 0.40 there and about 0.85 to 0.95 at its true correction, so the
 * default threshold sits in a wide empty gap rather than on either population.
 */
export function bestAxisCorrection(geometry, { minScore = 0.7, sampleTarget } = {}) {
  const { scores, samples } = scoreAxisCorrections(geometry, sampleTarget);
  let best = IDENTITY_CORRECTION.name;
  let bestScore = -Infinity;
  for (const [name, score] of scores) {
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  const identity = scores.get(IDENTITY_CORRECTION.name) ?? 0;
  return {
    best,
    bestScore,
    identity,
    samples,
    scores,
    healthy: samples > 0 && best === IDENTITY_CORRECTION.name && identity >= minScore,
  };
}

/** Rewrite `normals` in place under `correction`. Returns the same array. */
export function rotateNormalsInPlace(normals, correction) {
  const out = [0, 0, 0];
  for (let i = 0; i < normals.length; i += 3) {
    applyCorrection(correction.basis, normals[i], normals[i + 1], normals[i + 2], out);
    normals[i] = out[0];
    normals[i + 1] = out[1];
    normals[i + 2] = out[2];
  }
  return normals;
}
