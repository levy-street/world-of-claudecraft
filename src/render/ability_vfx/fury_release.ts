import type { SeqSlot, SequencerHost } from './sequencer';

const origin = { x: 0, y: 0, z: 0 },
  hand = { x: 0, y: 0, z: 0 };

/** Red Harvest gathers rage into both weapons before its first contact.
 * The reversed fluid sprites finish inside the .15-second load; no victim
 * mark or hit feedback is authorized by this caster-only anticipation. */
export function drawHarvestRelease(host: SequencerHost, slot: SeqSlot): void {
  if (slot.abilityId !== 'red_harvest' || slot.physicalSecondary) return;
  const at = host.anchorOf(slot.casterId, 0.55, origin);
  if (!at) return;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  let count = 0;
  for (const index of [0, 1] as const) {
    const side = index === 0 ? 1 : -1;
    const grip = host.handPoint?.(slot.casterId, index, hand);
    const x = grip?.x ?? at.x + dz * side * 0.5;
    const y = grip?.y ?? at.y;
    const z = grip?.z ?? at.z - dx * side * 0.5;
    if (
      slot.tier === 0 &&
      host.bakedAt &&
      host.bakedAt(
        'warrior_power',
        x,
        y,
        z,
        4.8,
        0x9c1330,
        0xff6973,
        0.14,
        0,
        0.8,
        facing,
        true,
        side * 0.9,
        0.65,
      ) !== false
    )
      count++;
    const ribbon = host.pathRibbon(
      0xc82346,
      0.15,
      0.14,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const across = side * (1 - u) * 1.8;
          const back = Math.sin(u * Math.PI) * 0.6;
          points[i].set(
            x + dz * across - dx * back,
            y + Math.sin(u * Math.PI) * 0.45,
            z - dx * across - dz * back,
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
    if (ribbon !== false) count++;
  }
  host.countPrimitive(slot.abilityId, count);
}
