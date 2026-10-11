import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorSteelContact } from './warrior_steel_contact';

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
  const x = at.x,
    y = at.y,
    z = at.z;
  for (let strand = 0; strand < 4; strand++) {
    const around = [0, 1.3, 3.5, 5.2][strand];
    const reach = [1, 0.76, 0.58, 0.84][strand];
    host.pathRibbon(
      strand === 0 ? 0xe2edf2 : 0x728797,
      strand === 0 ? 0.24 : 0.1,
      strand === 0 ? 0.085 : 0.27,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1),
            along = (-3.3 + u * 5.6) * reach;
          const width = Math.max(0, 1 - Math.abs(u - 0.52) / 0.52);
          const across = Math.cos(around) * width * 1.15;
          points[i].set(
            x + sin * along + cos * across,
            y + Math.sin(around) * width * 0.78,
            z + cos * along - sin * across,
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
  host.crestAt?.(at.x, at.y, at.z, 1, 1, 0x728797, 0xe2edf2, 'breach_wedge', angle, 0.27);
  const contacts = warriorSteelContact(host, slot, at, angle, 0.08, 8.6, 0.24, true);
  if (slot.tier === 0) {
    for (const side of [-1, 1])
      host.fragmentsAt?.(
        'metal_splinter',
        at.x,
        at.y,
        at.z,
        0xaebdc6,
        side < 0 ? 7 : 12,
        side < 0 ? 1.1 : 1.55,
        cos * side,
        -sin * side,
        0.32,
      );
    host.burstAt(at.x, at.y, at.z, 0xe2edf2, 16, 1.1, 'sparks', 0.18);
  }
  host.contact?.(slot.casterId, slot.targetId, 'physical', profile.force, slot.abilityId, 0);
  if (!slot.physicalSecondary) host.shakeAt(at.x, at.y, at.z, 0.19, true);
  host.countPrimitive(slot.abilityId, contacts + (slot.tier > 0 ? 6 : 9));
  return true;
}
