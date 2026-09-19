import type { SeqPoint, SequencerHost } from './sequencer';

/** Full-reach blade sweep when the shared membrane pool is occupied. The
 * existing priority ribbon pool admits these before decorative trails. */
export function harvestFallback(host: SequencerHost, at: SeqPoint, facing: number): number {
  let count = 0;
  // The caller owns a shared anchor scratch. Retained paths outlive the next
  // recipient resolve, so capture this wound's scalar origin before returning.
  const x = at.x,
    y = at.y,
    z = at.z;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  for (const layer of [0, 1]) {
    const accepted = host.pathRibbon(
      0xc92343,
      layer ? 0.13 : 0.32,
      0.22,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const angle = (u - 0.5) * 2.65;
          const across = Math.sin(angle) * 6.36;
          const bow = Math.cos(angle) - 1;
          const depth = bow * 2.16 + layer * 0.12;
          points[i].set(
            x + dz * across + dx * depth,
            y + bow * 0.6 - layer * 0.13,
            z - dx * across + dz * depth,
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
