// Creased smooth normals for a flat-shaded low-poly rig (VisualDef.smoothNormals).
//
// A faceted asset (the Quaternius velociraptor the Basin Raptor wears) ships
// every face with its own corners and a flat normal, so each facet reads as a
// hard polygon at a large drawn size. This rebuilds per-corner normals as the
// average of the corners that share its exact position and whose flat normal
// lies within the crease angle of its own: curved surfaces shade smoothly and
// real edges (claws, teeth, the jaw line) stay crisp. Only the normals change:
// the triangle count, the skin and the silhouette are untouched, so the cost is
// one pass at load per geometry and nothing per frame. Pure and three-free, so
// a Vitest drives it on raw arrays.

/** The cosine a smoothed corner's neighbours must clear (crease in degrees). */
export function creaseCosine(creaseDegrees: number): number {
  const deg = Math.min(180, Math.max(0, creaseDegrees));
  return Math.cos((deg * Math.PI) / 180);
}

/**
 * Smoothed unit normals, one per vertex (xyz interleaved). `positions` and
 * `normals` are flat xyz arrays of the same vertex count; corners are grouped
 * by EXACT position (quantized GLB positions compare exactly). A corner keeps
 * its own normal when no neighbour clears the crease, or when the average
 * collapses to zero.
 */
export function creasedNormals(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  creaseDegrees: number,
): Float32Array {
  const count = Math.floor(Math.min(positions.length, normals.length) / 3);
  const out = new Float32Array(count * 3);
  const unit = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = normals[i * 3];
    const y = normals[i * 3 + 1];
    const z = normals[i * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    unit[i * 3] = x / len;
    unit[i * 3 + 1] = y / len;
    unit[i * 3 + 2] = z / len;
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  const minCos = creaseCosine(creaseDegrees);
  for (const members of groups.values()) {
    for (const i of members) {
      const ax = unit[i * 3];
      const ay = unit[i * 3 + 1];
      const az = unit[i * 3 + 2];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const j of members) {
        const bx = unit[j * 3];
        const by = unit[j * 3 + 1];
        const bz = unit[j * 3 + 2];
        if (ax * bx + ay * by + az * bz < minCos - 1e-6) continue;
        sx += bx;
        sy += by;
        sz += bz;
      }
      const len = Math.hypot(sx, sy, sz);
      if (len < 1e-6) {
        out[i * 3] = ax;
        out[i * 3 + 1] = ay;
        out[i * 3 + 2] = az;
      } else {
        out[i * 3] = sx / len;
        out[i * 3 + 1] = sy / len;
        out[i * 3 + 2] = sz / len;
      }
    }
  }
  return out;
}
