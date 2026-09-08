import { furyCutSurfacePoint } from './fury_shapes';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

const seam: SeqPoint = { x: 0, y: 0, z: 0 };

/** Shared authored surface and cutting seam, including both ascending reaper wakes. */
export function drawFurySurface(
  host: SequencerHost,
  slot: SeqSlot,
  at: SeqPoint,
  facing: number,
  span: number,
  height: number,
  roll: number,
  duration: number,
  heavy: boolean,
): number {
  const forwardX = Math.sin(facing),
    forwardZ = Math.cos(facing);
  // Put the curved sheet on the receiving side of the body. The compact wound
  // remains on the actual recipient anchor in the choreography owner.
  const xAt = at.x - forwardX * 0.65,
    zAt = at.z - forwardZ * 0.65;
  const cosine = Math.cos(roll),
    sine = Math.sin(roll);
  const count = slot.tier > 0 ? 1 : 3;
  for (let strand = 0; strand < count; strand++) {
    const width = strand === 0 ? 0.21 : strand === 1 ? 0.64 : 0.31;
    host.pathRibbon(
      strand === 0 ? slot.accent : 0xc11130,
      width * (heavy ? 1.2 : 1),
      duration,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          furyCutSurfacePoint(i / (points.length - 1), strand * 0.12, seam);
          const x = (seam.x * span) / 3.7,
            y = seam.y * height;
          const across = x * cosine - y * sine,
            rise = x * sine + y * cosine;
          const exit = (seam.z * span) / 3.7;
          points[i].set(
            xAt + forwardZ * across + forwardX * exit,
            at.y + 0.08 + rise,
            zAt - forwardX * across + forwardZ * exit,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      strand === 0 ? 1 : 0,
    );
  }
  host.crestAt?.(
    xAt,
    at.y + 0.08,
    zAt,
    span / 3.7,
    height,
    0x8e0922,
    0xf24e59,
    'blood_cut',
    facing,
    duration,
    roll,
  );
  return count + 1;
}
