import type { SequencerHost } from './sequencer';

/** A brief reflection opens the real edge or seats the guarding equipment.
 * Both layers resample the worn face; movement cannot leave a floating mark. */
export function warriorEquipmentPrepare(
  host: SequencerHost,
  casterId: number,
  guarded: boolean,
): number {
  const at = { x: 0, y: 0, z: 0 },
    normal = { x: 0, y: 0, z: 0 },
    grip = { x: 0, y: 0, z: 0 };
  let hand: 0 | 1 = guarded ? 1 : 0;
  let sample = host.prepareWeaponFace?.(casterId, hand);
  if (!sample?.(at, normal)) {
    if (!guarded) return 0;
    sample = host.prepareWeaponFace?.(casterId, 0);
    if (!sample?.(at, normal)) return 0;
    hand = 0;
  }
  let count = 0;
  for (let layer = 0; layer < 2; layer++)
    if (
      host.pathRibbon(
        layer ? 0xf0f5f5 : guarded ? 0x93acb6 : 0xb9c7ce,
        layer ? 0.035 : guarded ? 0.16 : 0.12,
        layer ? 0.13 : 0.32,
        (points) => {
          if (!sample?.(at, normal)) return 0;
          const root = host.handPoint?.(casterId, hand, grip);
          let ax = root ? at.x - root.x : 0,
            ay = root ? at.y - root.y : 1,
            az = root ? at.z - root.z : 0;
          const dot = ax * normal.x + ay * normal.y + az * normal.z;
          ax -= dot * normal.x;
          ay -= dot * normal.y;
          az -= dot * normal.z;
          const length = Math.hypot(ax, ay, az);
          if (length < 0.05) {
            ax = -normal.y * normal.x;
            ay = 1 - normal.y * normal.y;
            az = -normal.y * normal.z;
            if (Math.hypot(ax, ay, az) < 0.05) {
              ax = 1;
              ay = az = 0;
            }
          }
          const inverse = 1 / Math.hypot(ax, ay, az);
          ax *= inverse;
          ay *= inverse;
          az *= inverse;
          const bx = ay * normal.z - az * normal.y,
            by = az * normal.x - ax * normal.z,
            bz = ax * normal.y - ay * normal.x;
          const reach = Math.max(0.45, Math.min(1.2, length * 2));
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1) - 0.5;
            const along = guarded ? (0.22 - Math.abs(u) * 0.9) * reach : u * reach;
            const across = guarded ? u * reach * 1.4 : u * reach * 0.18;
            points[i].set(
              at.x + ax * along + bx * across + normal.x * 0.04,
              at.y + ay * along + by * across + normal.y * 0.04,
              at.z + az * along + bz * across + normal.z * 0.04,
            );
          }
          return points.length;
        },
        true,
        null,
        true,
        0,
        null,
        true,
      ) !== false
    )
      count++;
  return count;
}
