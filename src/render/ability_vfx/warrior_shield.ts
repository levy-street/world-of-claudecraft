import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { physicalContact } from './physical_contact';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };
/** One loaded steel collision. The actual native shield drives the performance;
 * the segmented silhouette enlarges its contact without implying an area hit. */
export function drawWarriorShield(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'shield_slam') return false;
  const profile = meleeImpactProfile(slot.abilityId);
  if (!profile || beat > 0 || slot.targetId === slot.casterId) return true;
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (outcome === 0) return true;
  const from = host.anchorOf(slot.casterId, 0.55, source);
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), target);
  if (!from || !at) return true;
  const angle = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  // Keep the curved plate face on the near side of the struck body; cap the
  // shift for overlapping actors so the sculpture never moves behind its owner.
  const shift = Math.min(1.05, Math.hypot(at.x - from.x, at.z - from.z) * 0.6);
  const x = at.x - dx * shift,
    z = at.z - dz * shift;
  const solid = host.crestAt?.(
    x,
    at.y,
    z,
    1.4,
    1.4,
    0x657c91,
    0xd8efff,
    'shield_contact',
    angle,
    0.24,
  );
  // A cold/full carrier still retains the complete directional primary shape.
  for (let side = -1; side <= 1; side += 2) {
    host.pathRibbon(
      0xd8efff,
      solid === true ? 0.095 : 0.18,
      0.21,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const t = i / (points.length - 1);
          const across =
            side *
            (t < 0.2
              ? (t / 0.2) * 1.32
              : t < 0.5
                ? 1.32 + ((t - 0.2) / 0.3) * 0.15
                : ((1.0 - t) / 0.5) * 1.47);
          points[i].set(x + dz * across, at.y + 1.65 - t * 3.18, z - dx * across);
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
    );
  }
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 2.4, 0xc5d9e1, 'contact_crush', 1.35, 0.2);
    host.countPrimitive(slot.abilityId, 4);
    return true;
  }
  let count = 3 + physicalContact(host, slot, 0, at.x, at.y, at.z);
  if (slot.tier === 0) {
    host.fragmentsAt?.('metal_splinter', x, at.y, z, 0xa8b9c5, 13, 1.2, dx, dz, 0.26);
    host.burstAt(x, at.y, z, 0xd0e8ff, 19, 1.2, 'sparks', 0.2);
    const floor = host.groundYAt(x, z);
    host.bakedAt?.('shout_dust', x, floor + 0.08, z, 3.2, 0xafa18b, 0xc5b49c, 0.4, 0, 0, angle);
    host.fragmentsAt?.('stone_chip', x, floor + 0.09, z, 0x857c70, 7, 0.55, dx, dz, 0.25);
    count += 4;
  }
  host.contact?.(slot.casterId, slot.targetId, 'physical-crush', profile.force, slot.abilityId, 0);
  host.pulseLight(slot.targetId, slot.spec.palette, 1.35, 0.06, 2.8);
  host.countPrimitive(slot.abilityId, count);
  return true;
}
