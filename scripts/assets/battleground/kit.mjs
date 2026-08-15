// The Thornhollow ART KIT: the catalogue pieces Thornhollow Fields is built
// out of, and the small amount of arithmetic that makes them fit.
//
// Every catalogue GLB is normalized to a target height before its placement
// scale (src/render/asset_scale.ts), and the map editor baked each one's
// collision at that same normalization (data/battleground/thornhollow_assets.json).
// So a piece's measured extents at placement scale 1 are a fixed property of
// the kit, and the builder can solve for the scale that makes a wall course
// exactly as thick as the plan says, or a course of modules exactly span a run,
// instead of eyeballing numbers that then drift away from the collision.
//
// Everything here is pure arithmetic over the vendored collision table: no rng,
// no clock, no map knowledge.

/** Extents (at placement scale 1) of one kit piece, from its baked boxes. */
export function pieceExtents(assetData, assetId) {
  const data = assetData[assetId];
  if (!data) throw new Error(`kit: no baked collision for ${assetId}`);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const span = (b, hx, hz) => {
    const ry = b.ry ?? 0;
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    return [hx * c + hz * s, hx * s + hz * c];
  };
  for (const b of data.boxes ?? []) {
    const [ex, ez] = span(b, b.hx, b.hz);
    minX = Math.min(minX, b.x - ex);
    maxX = Math.max(maxX, b.x + ex);
    minZ = Math.min(minZ, b.z - ez);
    maxZ = Math.max(maxZ, b.z + ez);
    minY = Math.min(minY, b.y - b.hy);
    maxY = Math.max(maxY, b.y + b.hy);
  }
  for (const r of data.ramps ?? []) {
    const [ex, ez] = span(r, r.hx, r.hz);
    minX = Math.min(minX, r.cx - ex);
    maxX = Math.max(maxX, r.cx + ex);
    minZ = Math.min(minZ, r.cz - ez);
    maxZ = Math.max(maxZ, r.cz + ez);
    minY = Math.min(minY, Math.min(r.yNeg, r.yPos));
    maxY = Math.max(maxY, Math.max(r.yNeg, r.yPos));
  }
  if (!Number.isFinite(minX)) throw new Error(`kit: ${assetId} has no measurable body`);
  return {
    width: maxX - minX,
    depth: maxZ - minZ,
    height: maxY - minY,
    top: maxY,
    minY,
    // Several kit pieces are authored with their origin at one end rather than
    // at the middle of their body (dungeon/barrier_half is offset by half its
    // own length). A run that ignores that lands the whole course beside the
    // rectangle it was supposed to fill, so the builders shift every placement
    // by these and put the BODY where the plan asked for it.
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

/** Round to 4 places the way the field compiler does, so the map file and the
 *  generated module never differ by a float tail. */
export const r4 = (v) => {
  const out = Math.round(v * 1e4) / 1e4;
  return Object.is(out, -0) ? 0 : out;
};

const TAU = Math.PI * 2;

/** Normalize a yaw into [0, 2pi), so mirrored pairs read cleanly in the map. */
export const yaw = (a) => r4(((a % TAU) + TAU) % TAU);

/** Deterministic 0..1 hash. Static layout, never gameplay randomness. */
export function hash01(a, b) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** A deterministic value stream keyed by a salt: the builder's stand-in for a
 *  scatter rng, reproducible byte for byte on every machine. */
export function stream(salt) {
  let i = 0;
  return {
    next: () => hash01(salt * 1.618 + ++i * 0.7351, salt * 0.5219 + i * 2.4142),
    range: (lo, hi) =>
      lo + (hi - lo) * hash01(salt * 1.618 + ++i * 0.7351, salt * 0.5219 + i * 2.4142),
    pick: (list) =>
      list[
        Math.min(
          list.length - 1,
          Math.floor(hash01(salt * 3.7 + ++i, salt + i * 1.3) * list.length),
        )
      ],
  };
}

/**
 * Point-mirror a placement through the field centre. The mirror is a HALF TURN,
 * not a reflection, so a piece keeps its handedness and the two teams' halves
 * are the same build rather than mirror images of it.
 */
export function mirrorPlacement(p) {
  const out = { ...p, x: r4(-p.x), z: r4(-p.z) };
  if (p.rotY !== undefined) out.rotY = yaw(p.rotY + Math.PI);
  return out;
}

/**
 * A run of wall modules that EXACTLY spans `length`, laid along the run's local
 * x. Returns the per-module pitch and the x scale that closes the joints, so a
 * course reads as one wall rather than as a row of blocks with hairlines
 * between them.
 */
export function courseFit(pieceWidth, length, nominalScale) {
  const unit = pieceWidth * nominalScale;
  const count = Math.max(1, Math.round(length / unit));
  const pitch = length / count;
  return { count, pitch, scaleX: pitch / unit };
}

/**
 * World offset that moves a piece's BODY centre onto the point asked for,
 * given its authored origin offset, its final scales and its yaw. Mirrors the
 * compiler's own rotXZ convention, so the collider it bakes lands there too.
 */
export function bodyOffset(ext, scaleX, scaleZ, rotY) {
  const lx = -ext.centerX * scaleX;
  const lz = -ext.centerZ * scaleZ;
  return {
    dx: lx * Math.cos(rotY) + lz * Math.sin(rotY),
    dz: -lx * Math.sin(rotY) + lz * Math.cos(rotY),
  };
}
