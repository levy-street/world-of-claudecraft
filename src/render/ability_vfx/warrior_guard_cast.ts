import type { SeqSlot, SequencerHost } from './sequencer';

const point = { x: 0, y: 0, z: 0 },
  equipment = { x: 0, y: 0, z: 0 },
  normal = { x: 0, y: 0, z: 0 };
/** The aura owns the assembling armor. Activation supplies only the short
 * lock-in flash and metal grit, never a second ring or a pretend enemy hit. */
export function drawWarriorGuardCast(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const id = slot.abilityId;
  if (id !== 'raised_guard' && id !== 'iron_resolve' && id !== 'die_by_sword') return false;
  if (beat !== 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0.48, point);
  if (!at) return true;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const sampled =
    id !== 'iron_resolve' &&
    host.weaponFace?.(slot.casterId, id === 'raised_guard' ? 1 : 0, equipment, normal) === true;
  const angle = sampled ? Math.atan2(normal.x, normal.z) : facing;
  const side = id === 'raised_guard' ? -0.5 : id === 'die_by_sword' ? 0.4 : 0;
  const x = sampled ? equipment.x : at.x + Math.cos(facing) * side + Math.sin(facing) * 0.45;
  const y = sampled ? equipment.y : at.y;
  const z = sampled ? equipment.z : at.z - Math.sin(facing) * side + Math.cos(facing) * 0.45;
  host.burstAt(
    x,
    y,
    z,
    id === 'iron_resolve' ? 0xe2b681 : 0xc5e0ee,
    slot.tier === 0 ? 14 : 5,
    0.65,
    'sparks',
    0.18,
  );
  if (slot.tier === 0)
    host.fragmentsAt?.(
      'metal_splinter',
      x,
      y,
      z,
      0xc1cdd4,
      6,
      0.45,
      Math.sin(angle),
      Math.cos(angle),
      0.2,
    );
  host.pulseLight(slot.casterId, 'physical', 0.55, 0.045, 1.8);
  host.countPrimitive(id, slot.tier === 0 ? 3 : 2);
  return true;
}
