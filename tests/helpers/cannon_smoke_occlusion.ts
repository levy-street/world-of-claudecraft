// What the Fire and Fly player sees through the cannon's smoke and dust: from
// the turret's chase camera, the stacked opacity of every puff a view ray
// crosses (its peak opacity times its alpha-blended share times its sprite's
// mean coverage at that radius, the mean over the random rotations a puff is
// drawn at), at the worst ray and frame of a source's whole life. The rays run
// through a block of points around the source and on past it, so a cloud
// hanging over the ground far behind counts as much as one at the monsters'
// feet. Clods and bark chips are fist-sized: they can cover a sampled ray but
// never a monster, so they are left out; light (the flash, the flame, sparks,
// a hot fireball) takes nothing from what stands behind it and counts as zero
// by the blend itself.
import {
  type CannonPuff,
  cannonPuffAtlasTexels,
  cannonPuffInto,
  newCannonPuffFrame,
  PUFF,
} from '../../src/render/cannon_puff_core';

export interface OcclusionPoint {
  x: number;
  y: number;
  z: number;
}

/** The chase camera over a turret at the origin, looking along +z (pitch 0.5 rad, 16 yd back). */
export const TURRET_CAMERA_EYE: OcclusionPoint = {
  x: 0,
  y: 2 + 16 * Math.sin(0.5),
  z: -16 * Math.cos(0.5),
};

const CELL = 64;
const BINS = 50;
const DEBRIS: readonly number[] = [PUFF.dirt, PUFF.bark];

/** Each sprite's mean alpha by radius (share of its half-cell), read off the real atlas. */
const PROFILE: readonly Float64Array[] = (() => {
  const atlas = cannonPuffAtlasTexels(CELL);
  return [0, 1, 2, 3].map((sprite) => {
    const sum = new Float64Array(BINS);
    const count = new Float64Array(BINS);
    const cx = sprite % 2;
    const cy = Math.floor(sprite / 2);
    for (let j = 0; j < CELL; j++) {
      for (let i = 0; i < CELL; i++) {
        const r = Math.hypot(((i + 0.5) / CELL) * 2 - 1, ((j + 0.5) / CELL) * 2 - 1);
        if (r >= 1) continue;
        const bin = Math.floor(r * BINS);
        sum[bin] += atlas[((cy * CELL + j) * CELL * 2 + cx * CELL + i) * 4 + 3] / 255;
        count[bin]++;
      }
    }
    return sum.map((s, bin) => (count[bin] > 0 ? s / count[bin] : 0));
  });
})();

/** Points every 1.5 yd across, 1.3 yd up to 7 yd and 2 yd deep around (cx, cz): the rays' aim. */
export function occlusionTargets(cx: number, cz: number): OcclusionPoint[] {
  const out: OcclusionPoint[] = [];
  for (let x = -8; x <= 8; x += 1.5) {
    for (let y = 0.5; y <= 7; y += 1.3) {
      for (let z = -6; z <= 6; z += 2) out.push({ x: cx + x, y, z: cz + z });
    }
  }
  return out;
}

/**
 * The most light `count` puffs of `puffs` take from anything seen through them
 * from `eye`, over rays through `targets` and every 1/30 s of `life` seconds.
 */
export function smokeOcclusionPeak(
  puffs: readonly CannonPuff[],
  count: number,
  eye: OcclusionPoint,
  targets: readonly OcclusionPoint[],
  life: number,
): number {
  const f = newCannonPuffFrame();
  let worst = 0;
  for (let t = 0; t <= life; t += 1 / 30) {
    for (const p of targets) {
      const lx = p.x - eye.x;
      const ly = p.y - eye.y;
      const lz = p.z - eye.z;
      const length = Math.hypot(lx, ly, lz);
      const dx = lx / length;
      const dy = ly / length;
      const dz = lz / length;
      let through = 1;
      for (let i = 0; i < count; i++) {
        if (DEBRIS.includes(puffs[i].kind) || !cannonPuffInto(puffs[i], t, f)) continue;
        const occlusion = Math.min(1, f.a * (1 - f.add));
        if (!(occlusion > 0)) continue;
        const wx = f.x - eye.x;
        const wy = f.y - eye.y;
        const wz = f.z - eye.z;
        const along = wx * dx + wy * dy + wz * dz;
        if (along <= 0) continue;
        const r = Math.hypot(wx - along * dx, wy - along * dy, wz - along * dz) / (0.5 * f.size);
        if (r >= 1) continue;
        through *= 1 - occlusion * PROFILE[f.sprite][Math.floor(r * BINS)];
      }
      worst = Math.max(worst, 1 - through);
    }
  }
  return worst;
}
