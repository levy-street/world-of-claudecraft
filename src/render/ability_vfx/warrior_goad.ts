import type { SeqSlot, SequencerHost } from './sequencer';

const mouth = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** A directed bark belongs to completion even when the target is immune.
 * No receiving wound, hitstop or control success is inferred here. */
export function drawWarriorGoad(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'taunt') return false;
  if (beat !== 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0.79, mouth);
  if (!at) return true;
  const to = host.anchorOf(slot.targetId, 0.72, target);
  let dx = to ? to.x - at.x : 0,
    dz = to ? to.z - at.z : 0;
  const distance = Math.hypot(dx, dz),
    facing = host.facingAt?.(slot.casterId) ?? 0;
  if (distance > 0.1) {
    dx /= distance;
    dz /= distance;
  } else {
    dx = Math.sin(facing);
    dz = Math.cos(facing);
  }
  const reach = Math.min(6.4, Math.max(2.8, distance * 0.85));
  const layers = slot.tier > 0 ? 1 : 3;
  for (let layer = 0; layer < layers; layer++) {
    const travel = 0.45 + layer * 0.25;
    host.pathRibbon(
      layer === 0 ? 0xffc994 : 0xdd915c,
      layer === 0 ? 0.52 : 0.26,
      0.28,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1),
            side = (u - 0.5) * 2;
          // Broken V-shaped pressure blades: a sharp centre leads two
          // serrated shoulders, with no circular contour or electrical fork.
          const advance =
            reach * travel - 0.65 * Math.abs(side) + 0.07 * Math.sin(u * 38) * (1 - Math.abs(side));
          const spread = side * (0.75 + layer * 0.3);
          points[i].set(
            at.x + dx * advance + dz * spread,
            at.y + 0.06 + (1 - Math.abs(side)) * 0.16,
            at.z + dz * advance - dx * spread,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      layer === 0 ? 1 : 0,
    );
  }
  host.bakedAt?.(
    'shout_dust',
    at.x + dx * 0.75,
    at.y,
    at.z + dz * 0.75,
    4.2,
    0xb69b7e,
    0xf1c89d,
    0.32,
    0,
    0,
    Math.atan2(dx, dz),
  );
  for (let plume = 0; plume < 2; plume++) {
    const travel = 1.2 + plume * 1.2;
    host.bakedAt?.(
      'shout_dust',
      at.x + dx * travel,
      at.y + plume * 0.12,
      at.z + dz * travel,
      2.1 + plume * 0.7,
      0xb69b7e,
      0xffd1a4,
      0.28,
      0,
      0,
      Math.atan2(dx, dz),
      false,
      plume * 0.4,
      1.5,
    );
  }
  host.countPrimitive('taunt', layers + 3);
  return true;
}
