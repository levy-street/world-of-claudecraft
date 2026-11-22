import type { SequencerHost } from './sequencer';

const target = { x: 0, y: 0, z: 0 };
/** A target-bound descending sword: height carries power, never a false AoE radius. */
export function solarExecution(host: SequencerHost, sourceId: number, targetId: number): void {
  if (!host.anchorOf(targetId, 0, target)) return;
  const x = target.x,
    y = target.y,
    z = target.z;
  const facing = host.facingAt?.(sourceId) ?? 0;
  const dx = Math.cos(facing),
    dz = -Math.sin(facing);
  for (let layer = 0; layer < 2; layer++) {
    host.pathRibbon(
      layer ? 0xffffe5 : 0xf3ad38,
      layer ? 0.17 : 0.55,
      0.48,
      (pts) => {
        for (let i = 0; i < pts.length; i++) {
          const u = i / (pts.length - 1);
          pts[i].set(x, y + 0.12 + u * 7.4, z);
        }
        return pts.length;
      },
      true,
    );
  }
  host.pathRibbon(
    0xffe29b,
    0.24,
    0.38,
    (pts) => {
      for (let i = 0; i < pts.length; i++) {
        const u = i / (pts.length - 1) - 0.5;
        pts[i].set(x + dx * u * 2.4, y + 5.7 + Math.abs(u) * 0.5, z + dz * u * 2.4);
      }
      return pts.length;
    },
    true,
  );
  host.worldLightAt?.(x, y + 1, z, 'holy', 2.4, 0.18);
  host.contact?.(sourceId, targetId, 'holy', 2.2);
  host.countPrimitive('final_edict', 4);
}
