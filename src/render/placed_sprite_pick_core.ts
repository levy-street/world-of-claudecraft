// Ray test against the billboard a far placement draws (placed_imposters.ts).
//
// The sprite tier draws every far batched placement through ONE plain mesh
// whose base geometry is a single unit quad: the vertex shader stands each
// instance upright at its seat, turned about Y to face the camera. three's
// raycast only ever sees that base quad, so a far tree had no exact hit and
// (with the Studio keeping only exact hits) could not be clicked at all.
//
// WHAT COUNTS AS A HIT: any point on the rectangle the shader draws, from the
// sprite's own instance data (its seat, width and height), standing on the
// seat and turned to face the eye exactly the way the vertex shader turns it.
// The transparent texels around the silhouette count too. The baked atlas
// lives on the GPU, and reading it back to test the alpha would stall the
// pick on a readback; at 200 yd and beyond the whole sprite is a few dozen
// pixels, so its rectangle is the honest click target. A ray beside the
// rectangle, or one running edge-on to it (the shader draws nothing there
// either), is a miss.
//
// Pure math on plain numbers: no Three, no allocation, never per frame (one
// call per live sprite per pick: a click, or the editor's throttled hover).

/** Distance along the ray (unit `dir`) to the drawn billboard, or -1 on a
 *  miss. `seat` is the quad's base centre, `width` and `height` its drawn
 *  size, `eyeX`/`eyeZ` the camera position the shader turns it toward. */
export function spriteQuadRayDistance(
  seatX: number,
  seatY: number,
  seatZ: number,
  width: number,
  height: number,
  eyeX: number,
  eyeZ: number,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
): number {
  if (!(width > 0) || !(height > 0)) return -1;
  // The shader's facing: normalize(vec3(toCam.x, 0, toCam.z + 1e-5)).
  const fx = eyeX - seatX;
  const fz = eyeZ - seatZ + 1e-5;
  const len = Math.hypot(fx, fz);
  const nx = fx / len;
  const nz = fz / len;
  // The quad lies in the vertical plane through the seat with normal (nx, 0, nz).
  const denom = dirX * nx + dirZ * nz;
  if (Math.abs(denom) < 1e-9) return -1;
  const t = ((seatX - originX) * nx + (seatZ - originZ) * nz) / denom;
  if (t < 0) return -1;
  const hx = originX + dirX * t - seatX;
  const hy = originY + dirY * t - seatY;
  const hz = originZ + dirZ * t - seatZ;
  // The shader's right axis: vec3(dir.z, 0, -dir.x), spanning -0.5..0.5 of the width.
  const across = hx * nz - hz * nx;
  if (Math.abs(across) > width / 2) return -1;
  if (hy < 0 || hy > height) return -1;
  return t;
}
