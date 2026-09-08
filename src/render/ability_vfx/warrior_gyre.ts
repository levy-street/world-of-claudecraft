import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorGyrePoint } from './warrior_gyre_shape';

const origin = { x: 0, y: 0, z: 0 },
  point = { x: 0, y: 0, z: 0 };
/** One paired sweep per cast. Real recipient events separately own every
 * body imprint, including blocks; follow-through never invents extra hits. */
export function drawWarriorGyre(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'whirlwind') return false;
  if (beat !== 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0, origin);
  if (!at) return true;
  const angle = host.facingAt?.(slot.casterId) ?? 0,
    dx = Math.sin(angle),
    dz = Math.cos(angle);
  for (let blade = 0; blade < 2; blade++)
    host.pathRibbon(
      0xffaaa6,
      0.22,
      0.34,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          warriorGyrePoint(blade, i / (points.length - 1), 0, point);
          points[i].set(
            at.x + point.x * dz + point.z * dx,
            at.y + point.y,
            at.z - point.x * dx + point.z * dz,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
    );
  host.crestAt?.(at.x, at.y, at.z, 1, 1, 0x9f1933, 0xffbac0, 'blood_gyre', angle, 0.4);
  for (const side of [-1, 1]) {
    const x = at.x + dz * side * 3.6,
      z = at.z - dx * side * 3.6,
      y = host.groundYAt(x, z) + 0.08;
    host.bakedAt?.('shout_dust', x, y, z, 3.4, 0xb7a494, 0xe1c4ab, 0.38, 0, 0, angle + side * 0.9);
    if (slot.tier === 0)
      host.fragmentsAt?.(
        'metal_splinter',
        x,
        y + 0.45,
        z,
        0xbca3a5,
        12,
        1.2,
        dx * side,
        dz * side,
        0.3,
      );
  }
  host.countPrimitive('whirlwind', slot.tier === 0 ? 7 : 5);
  return true;
}
