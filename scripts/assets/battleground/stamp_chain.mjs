// The battleground terrain stamp chain, evaluated exactly as the map editor's
// terrain brush does.
//
// THREE ports of this chain have to agree or every collider seat, every
// placement seat and every step a fighter takes is wrong: this one (the map
// builder and the field compiler share it), and the sim's own copy in
// src/sim/battleground_field.ts, which cannot import a script module because it
// has to run in the browser. The generated field module carries build-time
// probes so tests pin the two ports against each other rather than trusting
// that they were kept in sync by hand.
//
// Pure and deterministic: no rng, no clock, no filesystem.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** terrain_brush.ts hash01, verbatim. */
export function hash01(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** terrain_brush.ts 'splatter' alpha mask, verbatim. */
export function splatterAlpha(u, v) {
  let best = 0;
  for (let i = 0; i < 26; i++) {
    const bx = hash01(i, 3, 71) * 1.7 - 0.85;
    const by = hash01(i, 7, 71) * 1.7 - 0.85;
    const radius = 0.05 + hash01(i, 11, 71) * 0.22;
    const distance = Math.hypot(u - bx, v - by);
    if (distance < radius) best = Math.max(best, 1 - (distance / radius) ** 2);
  }
  return best;
}

/** Radial brush weight for a normalized distance and a hardness plateau. */
export function brushWeight(distanceRatio, hardness) {
  if (distanceRatio >= 1) return 0;
  const hard = clamp01(hardness);
  let radial = 1;
  if (hard < 1 && distanceRatio > hard) {
    const t = (distanceRatio - hard) / (1 - hard);
    radial = 1 - t * t * (3 - 2 * t);
  }
  return radial;
}

/** Apply one stamp to a running height at a point. */
export function applyStamp(e, x, z, h) {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius;
  const alpha = e.alpha ? splatterAlpha(dx / e.radius, dz / e.radius) : 1;
  const w = (e.falloff === 'flat' ? 1 : brushWeight(t, e.hardness ?? 0)) * alpha;
  if (w <= 0) return h;
  if (e.mode === 'level') return lerp(h, e.delta, w);
  return h + e.delta * w;
}

/**
 * Bind a stamp list into a height sampler. O(stamps) per sample, which is what
 * both the builder and the compiler pay at build time; the runtime reads the
 * baked grid instead.
 */
export function makeHeightAt(stamps) {
  return (x, z) => {
    let h = 0;
    for (const e of stamps) h = applyStamp(e, x, z, h);
    return h;
  };
}
