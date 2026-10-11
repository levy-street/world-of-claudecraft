import type { SeqPoint, SequencerHost } from './sequencer';

/** Two unequal material exits around the receiving body, never an area ring.
 * Scalar origins survive scratch reuse; optional strips cannot evict active cuts. */
export function warriorImpactFan(
  host: SequencerHost,
  at: SeqPoint,
  facing: number,
  roll: number,
  reach: number,
  color: number,
  life = 0.18,
): number {
  const x = at.x,
    y = at.y,
    z = at.z;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const cosine = Math.cos(roll),
    sine = Math.sin(roll);
  let count = 0;
  for (const side of [-1, 1]) {
    const span = reach * (side < 0 ? 0.78 : 1);
    const admitted = host.pathRibbon(
      color,
      side < 0 ? 0.2 : 0.3,
      life,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const along = side * (0.15 + u * span);
          const split = Math.sin(u * 27 + side) * Math.sin(u * Math.PI) * 0.14;
          const across = along * cosine - split * sine;
          const rise = along * sine + split * cosine + Math.sin(u * Math.PI) * 0.16;
          const away = u * u * reach * 0.3;
          points[i].set(x + dz * across + dx * away, y + rise, z - dx * across + dz * away);
        }
        return points.length;
      },
      true,
      null,
      true,
      0,
      { from: 0, to: 1 },
    );
    if (admitted !== false) count++;
  }
  return count;
}
