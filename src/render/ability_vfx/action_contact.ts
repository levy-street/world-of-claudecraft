import type { SeqSlot, SequencerHost } from './sequencer';

const left = { x: 0, y: 0, z: 0 },
  right = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** The wire connects both real hands to the victim's throat. */
export function drawThroatWire(host: SequencerHost, slot: SeqSlot): void {
  const casterId = slot.casterId,
    targetId = slot.targetId;
  const throat = host.anchorOf(targetId, 0.74, target);
  if (!throat) return;
  for (const hand of [0, 1] as const) {
    const scratch = hand === 0 ? right : left;
    const from =
      host.handPoint?.(slot.casterId, hand, scratch) ?? host.anchorOf(slot.casterId, 0.68, scratch);
    if (!from) continue;
    (host.tetherRibbon ?? host.pathRibbon).call(host, 0x89949a, 0.035, 0.23, (points) => {
      const currentThroat = host.anchorOf(targetId, 0.74, target);
      const currentHand =
        host.handPoint?.(casterId, hand, scratch) ?? host.anchorOf(casterId, 0.68, scratch);
      if (!currentThroat || !currentHand) return 0;
      for (let i = 0; i < points.length; i++) {
        const u = i / (points.length - 1),
          side = hand === 0 ? -0.13 : 0.13;
        points[i].set(
          currentHand.x + (currentThroat.x + side - currentHand.x) * u,
          currentHand.y + (currentThroat.y - currentHand.y) * u + Math.sin(u * Math.PI) * 0.035,
          currentHand.z + (currentThroat.z - currentHand.z) * u,
        );
      }
      return points.length;
    });
  }
  host.burstAt(throat.x, throat.y, throat.z, 0xd8dee6, 6, 0.35, 'sparks', 0.23);
  host.burstAt(throat.x, throat.y - 0.05, throat.z, 0xa01222, 10, 0.55, 'blood', 0.23);
  host.contact?.(slot.casterId, slot.targetId, 'physical-blood', 1.2, 'garrote', 0);
  host.countPrimitive(slot.abilityId, 4);
}

/** Earth travels from the scooping hand into the eyes, with clods and grit. */
export function drawDirtToss(host: SequencerHost, slot: SeqSlot): void {
  const from = host.handPoint?.(slot.casterId, 1, left) ?? host.anchorOf(slot.casterId, 0.5, left);
  const to = host.anchorOf(slot.targetId, 0.77, target);
  if (!from || !to) return;
  const dx = to.x - from.x,
    dz = to.z - from.z,
    distance = Math.max(0.1, Math.hypot(dx, dz));
  for (let strand = 0; strand < (slot.tier > 0 ? 2 : 5); strand++)
    host.pathRibbon(
      strand % 2 ? 0x8b653d : 0xb09163,
      0.025,
      0.23,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1),
            s = (strand - 2) * 0.05 * Math.sin(u * Math.PI);
          points[i].set(
            from.x + dx * u + (dz / distance) * s,
            from.y + (to.y - from.y) * u + Math.sin(u * Math.PI) * (0.15 + strand * 0.04),
            from.z + dz * u - (dx / distance) * s,
          );
        }
        return points.length;
      },
      false,
    );
  host.fragmentsAt?.(
    'stone_chip',
    to.x,
    to.y,
    to.z,
    0x735136,
    slot.tier > 0 ? 5 : 11,
    0.45,
    dx / distance,
    dz / distance,
    0.23,
  );
  host.bakedAt?.('smoke', to.x, to.y, to.z, 0.95, 0x9c8054, 0xc4aa7a, 0.23, 0, 0, 0);
  host.countPrimitive(slot.abilityId, slot.tier > 0 ? 4 : 7);
}
