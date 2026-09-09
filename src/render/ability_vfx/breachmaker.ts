import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { physicalContact } from './physical_contact';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** A guard-breaking spear of forged pressure follows the native two-hand
 * thrust. The independent vulnerability is owned by the worn aura elsewhere. */
export function drawBreachmaker(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'breachmaker') return false;
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (beat > 0 || !outcome || slot.targetId === slot.casterId) return true;
  const profile = meleeImpactProfile('breachmaker')!;
  const from = host.anchorOf(slot.casterId, 0.55, source);
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), target);
  if (!from || !at) return true;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 2.8, 0xc6dce9, 'contact_crush', 1.5, 0.23);
    return true;
  }
  const angle = Math.atan2(at.x - from.x, at.z - from.z),
    sin = Math.sin(angle),
    cos = Math.cos(angle);
  for (let strand = 0; strand < 4; strand++) {
    const around = (strand * Math.PI) / 2;
    host.pathRibbon(
      strand % 2 ? 0xb68461 : 0xe6d4bd,
      0.17,
      0.27,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1),
            along = -3.3 + u * 5.6;
          const width = Math.max(0, 1 - Math.abs(u - 0.52) / 0.52);
          const across = Math.cos(around) * width * 1.15;
          points[i].set(
            at.x + sin * along + cos * across,
            at.y + Math.sin(around) * width * 0.78,
            at.z + cos * along - sin * across,
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
  }
  host.crestAt?.(at.x, at.y, at.z, 1, 1, 0x728797, 0xe1b180, 'breach_wedge', angle, 0.27);
  physicalContact(host, slot, 0, at.x, at.y, at.z);
  if (slot.tier === 0) {
    for (const side of [-1, 1])
      host.fragmentsAt?.(
        'metal_splinter',
        at.x,
        at.y,
        at.z,
        0xb9a591,
        12,
        1.55,
        cos * side,
        -sin * side,
        0.32,
      );
    host.burstAt(at.x, at.y, at.z, 0xf1c48d, 16, 1.1, 'sparks', 0.22);
  }
  host.contact?.(slot.casterId, slot.targetId, 'physical', profile.force, slot.abilityId, 0);
  host.countPrimitive(slot.abilityId, slot.tier > 0 ? 7 : 10);
  return true;
}
