import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

/** A dark receiving split, a brief steel catch, then directional swarf. The
 * blade wake remains a separate authored shape; this is the enemy's response. */
export function warriorSteelContact(
  host: SequencerHost,
  slot: SeqSlot,
  at: SeqPoint,
  facing: number,
  roll: number,
  size: number,
  duration: number,
  heavy: boolean,
): number {
  const targetId = slot.targetId,
    profile = meleeImpactProfile(slot.abilityId);
  if (!profile) return 0;
  const x = at.x,
    y = at.y,
    z = at.z,
    dx = Math.sin(facing),
    dz = Math.cos(facing);
  const height = meleeContactHeight(profile, 0);
  const offset = facing - (host.facingAt?.(targetId) ?? facing);
  const body = { x: 0, y: 0, z: 0 };
  host.flipbookAt(
    x - dx * 0.24,
    y,
    z - dz * 0.24,
    size * 0.56,
    0xe9f3f8,
    'contact_cut',
    heavy ? 1.7 : 1.35,
    heavy ? 0.065 : 0.045,
    roll,
  );
  let count = 1;
  if (
    host.bakedAt &&
    host.bakedAt(
      'warrior_shear',
      x - dx * 0.28,
      y,
      z - dz * 0.28,
      size,
      0xffffff,
      0xe3eff7,
      duration,
      0,
      0,
      facing,
      false,
      roll,
    ) !== false
  )
    count++;
  for (let layer = 0; layer < 2; layer++) {
    if (
      host.pathRibbon(
        layer ? 0xe5eff5 : profile.bleeding ? 0x590f24 : 0x263844,
        layer ? (heavy ? 0.2 : 0.12) : heavy ? 0.6 : 0.38,
        layer ? (heavy ? 0.065 : 0.045) : duration,
        (points) => {
          const origin = host.anchorOf(targetId, height, body);
          if (!origin) return 0;
          const yaw = (host.facingAt?.(targetId) ?? facing) + offset;
          const sx = Math.sin(yaw),
            sz = Math.cos(yaw);
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              along = (u - 0.5) * profile.span * 1.35;
            const across = along * Math.cos(roll),
              rise = along * Math.sin(roll);
            const nick = Math.sin(u * 31) * Math.sin(u * Math.PI) * 0.035;
            points[i].set(
              origin.x + sz * across - sx * 0.23,
              origin.y + rise + nick,
              origin.z - sx * across - sz * 0.23,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
        null,
        true,
      ) !== false
    )
      count++;
  }
  if (profile.bleeding) {
    host.burstAt(x, y, z, 0x810e27, slot.tier > 0 ? 5 : 13, 1.05, 'blood', duration - 0.025, 0.025);
    count++;
  }
  return count;
}
