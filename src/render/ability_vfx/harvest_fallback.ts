import type { SeqPoint, SequencerHost } from './sequencer';

/** Full-reach extraction when the shared sculpture pool is occupied. The
 * existing priority ribbon pool admits these before decorative trails. */
export function harvestFallback(host: SequencerHost, at: SeqPoint, facing: number): number {
  let count = 0;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  for (const side of [-1, 1]) {
    const accepted = host.pathRibbon(
      0xc92343,
      0.72,
      0.25,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const across = side * (0.15 + Math.sin(u * Math.PI * 0.85) * 4.5);
          const depth = u * 1.75;
          points[i].set(
            at.x + dz * across + dx * depth,
            at.y - 0.35 + u * 7.56,
            at.z - dx * across + dz * depth,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
      { from: 0, to: 1 },
    );
    if (accepted !== false) count++;
  }
  return count;
}
