import type { SeqSlot, SequencerHost } from './sequencer';

/** Paired shoulder pressure and a heavy ground wake follow displayed travel.
 * They do not contain a recipient hit or imply that a stun began on arrival. */
export function drawWarriorRushWake(
  host: SequencerHost,
  slot: SeqSlot,
  at: { x: number; y: number; z: number },
  angle: number,
): boolean {
  if (slot.abilityId !== 'charge' && slot.abilityId !== 'intervene') return false;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const escort = slot.abilityId === 'intervene';
  let count = 0;
  for (const side of [-1, 1]) {
    host.pathRibbon(
      escort ? 0xa4d7ee : 0xe2c598,
      0.18,
      0.2,
      (points) => {
        for (let j = 0; j < points.length; j++) {
          const u = j / (points.length - 1),
            back = 0.1 + u * 3.6;
          const spread = side * (0.55 + Math.sin(u * Math.PI) * 0.42);
          points[j].set(
            at.x - dx * back + dz * spread,
            at.y + 1.35 - u * 0.9,
            at.z - dz * back - dx * spread,
          );
        }
        return points.length;
      },
      true,
    );
    const x = at.x + dz * side * 0.46 - dx * 0.5;
    const z = at.z - dx * side * 0.46 - dz * 0.5;
    host.bakedAt?.(
      'shout_dust',
      x,
      host.groundYAt(x, z) + 0.1,
      z,
      2.2,
      0x9d8e79,
      0xcabb9f,
      0.46,
      0,
      0,
      angle,
    );
    count += 2;
    if (slot.tier === 0) {
      host.fragmentsAt?.(
        'stone_chip',
        x,
        host.groundYAt(x, z) + 0.12,
        z,
        0x9e917e,
        3,
        0.65,
        -dx,
        -dz,
        0.3,
      );
      count++;
    }
  }
  host.countPrimitive(slot.abilityId, count);
  return true;
}

/** Braking crushes dirt below the arriving Warrior, never the other body. */
export function drawWarriorRushArrival(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'charge' && slot.abilityId !== 'intervene') return false;
  if (beat || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0);
  if (!at) return true;
  const angle = host.facingAt?.(slot.casterId) ?? 0;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  for (const side of [-1, 1]) {
    const x = at.x + Math.cos(angle) * side * 0.55;
    const z = at.z - Math.sin(angle) * side * 0.55;
    host.bakedAt?.(
      'shout_dust',
      x,
      host.groundYAt(x, z) + 0.08,
      z,
      3.8,
      0xa4957e,
      0xe6d5b5,
      0.52,
      0,
      0,
      angle + side * 0.6,
    );
    host.fragmentsAt?.(
      'stone_chip',
      x,
      host.groundYAt(x, z) + 0.12,
      z,
      0x8e8271,
      slot.tier === 0 ? 9 : 4,
      1.15,
      dx + side * dz,
      dz - side * dx,
      0.42,
    );
  }
  host.countPrimitive(slot.abilityId, 4);
  return true;
}
