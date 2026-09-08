import type { AbilityVfxFx } from './fx';

/** One real channel pulse. Existing ribbon slots carry moving, fletched
 * shafts; no independent channel clock can survive an interrupt. */
export function drawHunterVolley(
  fx: AbilityVfxFx,
  x: number,
  z: number,
  radius: number,
  casterId: number,
  now: number,
  tier: number,
  quality = 1,
): number {
  if (tier >= 2) {
    fx.burstAt(x, fx.groundYAt(x, z) + 0.08, z, 0xb79868, 3, 0.45, 'debris', 0.14);
    return 1;
  }
  const count = Math.max(3, Math.round((tier === 1 ? 7 : 14) * (0.55 + quality * 0.45)));
  let spawned = 0;
  const phase = casterId * 1.73 + Math.floor(now * 10) * 0.83;
  const wind = fx.facingAt(casterId) ?? phase;
  const sx = Math.cos(wind),
    sz = -Math.sin(wind);
  for (let k = 0; k < count; k++) {
    const angle = phase + k * 2.399963;
    const r = radius * Math.sqrt((k + 0.35) / count) * 0.94;
    const px = x + Math.cos(angle) * r,
      pz = z + Math.sin(angle) * r;
    const gy = fx.groundYAt(px, pz);
    const height = 5.5 + (k % 3) * 0.7;
    const leanX = Math.sin(wind) * 0.24,
      leanZ = Math.cos(wind) * 0.24;
    const duration = 0.14 + (k % 3) * 0.02;
    const admitted = fx.pathRibbon(
      k % 3 ? 0xc2a974 : 0xddd3ab,
      0.06,
      0.3,
      (pts) => {
        // Tip, barbed head, straight shaft and forked fletching. The outline
        // moves as a rigid object and stops at the sampled terrain height.
        const along = [0.31, 0, 0.31, 0.18, 0.31, 1.5, 1.24, 1.65, 1.24, 1.5, 0.31, 0];
        const side = [-0.13, 0, 0.13, 0, 0, 0, -0.15, 0, 0.15, 0, 0, 0];
        for (let j = 0; j < pts.length; j++)
          pts[j].set(
            px + leanX * (height + along[j]) + sx * side[j],
            gy + 0.04 + height + along[j],
            pz + leanZ * (height + along[j]) + sz * side[j],
          );
        return pts.length;
      },
      false,
      {
        x: -leanX * height,
        y: -height,
        z: -leanZ * height,
        duration,
        delay: (k % 4) * 0.038,
        onArrive: () => {
          // Terrain contact does not impersonate a successful victim hit.
          fx.burstAt(px, gy + 0.08, pz, 0xb79868, 4, 0.45, 'debris', 0.14);
        },
      },
      true,
    );
    if (admitted) spawned++;
  }
  return spawned;
}
