import type { SeqSlot, SequencerHost } from './sequencer';
const hand = { x: 0, y: 0, z: 0 };
const chest = { x: 0, y: 0, z: 0 };
/** Solid grapnel and interlocked steel links. The real charge owns movement. */
export function drawBloodhook(
  host: SequencerHost,
  slot: SeqSlot,
  sourceFeet: { x: number; y: number; z: number },
  targetFeet: { x: number; y: number; z: number },
): void {
  const from =
    host.handPoint?.(slot.casterId, 0, hand) ??
    host.anchorOf(slot.casterId, 0.55, hand) ??
    sourceFeet;
  const to = host.anchorOf(slot.targetId, 0.57, chest) ?? targetFeet;
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const dx = (to.x - from.x) / Math.max(0.01, distance),
    dz = (to.z - from.z) / Math.max(0.01, distance);
  const flight = Math.min(1, slot.t / 0.14);
  const hx = from.x + (to.x - dx * 0.3 - from.x) * flight;
  const hy = from.y + (to.y - from.y) * flight;
  const hz = from.z + (to.z - dz * 0.3 - from.z) * flight;
  host.crestAt?.(
    hx,
    hy,
    hz,
    1.7,
    1.7,
    0x555c60,
    0xc9d4d9,
    'hook',
    Math.atan2(dx, dz) + 0.65,
    0.07,
  );
  const length = Math.hypot(hx - from.x, hy - from.y, hz - from.z);
  if (length > 0.05)
    host.crestAt?.(
      from.x,
      from.y,
      from.z,
      length,
      0.85,
      0x555b60,
      0xcbd3d5,
      'chain',
      Math.atan2(dx, dz),
      0.07,
      -Math.atan2(hy - from.y, Math.hypot(hx - from.x, hz - from.z)),
    );
  host.countPrimitive(slot.abilityId, 2);
}
