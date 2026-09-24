import type { SeqSlot, SequencerHost } from './sequencer';

const foot = { x: 0, y: 0, z: 0 },
  equipment = { x: 0, y: 0, z: 0 },
  normal = { x: 0, y: 0, z: 0 };

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
  const x0 = at.x,
    y0 = at.y,
    z0 = at.z;
  let count = 0;
  for (const side of [-1, 1]) {
    host.pathRibbon(
      escort ? 0xb7d2df : 0xd6dfe4,
      0.18,
      0.2,
      (points) => {
        for (let j = 0; j < points.length; j++) {
          const u = j / (points.length - 1),
            back = 0.1 + u * 3.6;
          // Onrush presses a narrow angular wedge through the air. Intervene
          // opens its guarding shoulder while the opposite arm trails lower.
          const spread =
            side *
            (escort
              ? 0.52 + Math.sin(u * Math.PI) * (side < 0 ? 0.9 : 0.38)
              : 0.32 + Math.min(u / 0.22, 1) * 0.5);
          const height = escort
            ? 1.35 + Math.sin(u * Math.PI) * (side < 0 ? 0.52 : -0.18) - u * 0.9
            : 1.35 - u * 0.9;
          points[j].set(x0 - dx * back + dz * spread, y0 + height, z0 - dz * back - dx * spread);
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
  const at = host.anchorOf(slot.casterId, 0, foot);
  if (!at) return true;
  const angle = host.facingAt?.(slot.casterId) ?? 0;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const escort = slot.abilityId === 'intervene';
  let count = 4;
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
    if (!escort) {
      // Two short scored boot skids explain the heavy stop. They follow the
      // floor and never put a damaging mark on the recipient.
      host.pathRibbon(
        0xbab6a9,
        0.14,
        0.24,
        (points) => {
          for (let j = 0; j < points.length; j++) {
            const u = j / (points.length - 1);
            const px = x - dx * u * 1.65 + dz * Math.sin(u * 8) * 0.055;
            const pz = z - dz * u * 1.65 - dx * Math.sin(u * 8) * 0.055;
            points[j].set(px, host.groundYAt(px, pz) + 0.035, pz);
          }
          return points.length;
        },
        true,
        null,
        true,
        0,
      );
      count++;
    }
  }
  if (escort) {
    const sampled =
      host.weaponFace?.(slot.casterId, 1, equipment, normal) === true ||
      host.weaponFace?.(slot.casterId, 0, equipment, normal) === true;
    const x = sampled ? equipment.x : at.x + dx * 0.5;
    const y = sampled ? equipment.y : at.y + 1.1;
    const z = sampled ? equipment.z : at.z + dz * 0.5;
    const faceAngle = sampled ? Math.atan2(normal.x, normal.z) : angle;
    const sx = Math.sin(faceAngle),
      sz = Math.cos(faceAngle);
    for (let layer = 0; layer < 2; layer++) {
      host.pathRibbon(
        layer ? 0xe2eef2 : 0x7197ad,
        layer ? 0.035 : 0.13,
        layer ? 0.12 : 0.24,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1);
            const across = (u - 0.5) * 1.65;
            const height = 0.38 - Math.abs(u - 0.5) * 1.25;
            points[i].set(x + sz * across + sx * 0.055, y + height, z - sx * across + sz * 0.055);
          }
          return points.length;
        },
        true,
        null,
        layer > 0,
        layer ? 0 : 1,
      );
      count++;
    }
  }
  host.countPrimitive(slot.abilityId, count);
  return true;
}
