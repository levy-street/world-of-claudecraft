import type { SeqPoint, SequencerHost } from './sequencer';

/** A short compression mark sits on the receiving surface. Unequal creases
 * collapse toward the impact, while the bright material catch clears first. */
export function warriorCrushContact(
  host: SequencerHost,
  targetId: number,
  at: SeqPoint,
  height: number,
  facing: number,
  size: number,
  tier: number,
  surfaceAt?: SeqPoint,
  flashLife = 0.075,
  creaseScale = 1,
): number {
  const body = { x: 0, y: 0, z: 0 };
  const base = host.anchorOf(targetId, 0, body);
  const surface = Math.max(
    0.18,
    Math.min(0.75, ((at.y - (base?.y ?? at.y - 1.6)) / height) * 0.14),
  );
  const relative = facing - (host.facingAt?.(targetId) ?? facing);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  if (surfaceAt) {
    surfaceAt.x = at.x - dx * surface;
    surfaceAt.y = at.y;
    surfaceAt.z = at.z - dz * surface;
  }
  host.flipbookAt(
    at.x - dx * surface,
    at.y,
    at.z - dz * surface,
    size,
    0xe1eaf0,
    'contact_crush',
    1.9,
    flashLife,
    0,
    0.68,
  );
  let count = 1;
  for (let crease = 0; crease < (tier > 0 ? 1 : 3); crease++) {
    for (let layer = 0; layer < 2; layer++) {
      if (
        host.pathRibbon(
          layer ? 0xe3edf2 : 0x334650,
          layer ? 0.085 : 0.29,
          layer ? 0.065 : 0.18,
          (points) => {
            const origin = host.anchorOf(targetId, height, body);
            if (!origin) return 0;
            const yaw = (host.facingAt?.(targetId) ?? facing) + relative;
            const sx = Math.sin(yaw),
              sz = Math.cos(yaw);
            for (let i = 0; i < points.length; i++) {
              const u = i / (points.length - 1);
              const across =
                (u - 0.5) * (crease === 0 ? 1.65 : crease === 1 ? 1.1 : 0.8) * creaseScale;
              const buckle = Math.abs(u - 0.46) * 0.28 + Math.sin(u * 19 + crease) * 0.025;
              points[i].set(
                origin.x + sz * across - sx * surface,
                origin.y + (crease === 0 ? 0 : crease === 1 ? -0.26 : 0.22) + buckle,
                origin.z - sx * across - sz * surface,
              );
            }
            return points.length;
          },
          true,
          null,
          crease > 0,
          crease === 0 ? 1 : 0,
          null,
          true,
        ) !== false
      )
        count++;
    }
  }
  return count;
}
