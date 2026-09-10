import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

const source: SeqPoint = { x: 0, y: 0, z: 0 };
const target: SeqPoint = { x: 0, y: 0, z: 0 };

/** Two opposed, independently confirmed blade collisions. No additional hit
 * or surrounding damage is implied by the caster's broad cutting wake. */
export function twinstrikeBeat(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'raging_gale') return false;
  const outcome =
    slot.componentOutcomes === undefined ? 1 : (slot.componentOutcomes >> (beat * 2)) & 3;
  if (!outcome) return true;
  const profile = meleeImpactProfile(slot.abilityId)!;
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, beat), target);
  const from = host.anchorOf(slot.casterId, 0.55, source);
  if (!at || !from || slot.targetId === slot.casterId) return true;
  const facing = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const reverse = beat === 1,
    primary = !slot.physicalSecondary;
  const roll = reverse ? 0.62 : -0.68;
  if (outcome === 2) {
    host.flipbookAt(
      at.x,
      at.y,
      at.z,
      reverse ? 2.8 : 2.5,
      0xcbd8df,
      'contact_crush',
      1.3,
      0.16,
      roll,
    );
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  let count = 0;
  const sculpted =
    primary &&
    host.crestAt &&
    host.crestAt(
      at.x - dx * 0.25,
      at.y,
      at.z - dz * 0.25,
      reverse ? 1.1 : 1,
      reverse ? 1.38 : 1.22,
      0x420d1d,
      0xe4314d,
      'twinstrike_cut',
      facing,
      0.23,
      roll,
    ) !== false;
  if (sculpted) count++;
  if (
    host.bakedAt &&
    host.bakedAt(
      'warrior_bite',
      at.x - dx * 0.35,
      at.y,
      at.z - dz * 0.35,
      reverse ? 5.8 : 5.2,
      0xffffff,
      0xff8990,
      0.2,
      0,
      0,
      facing,
      false,
      roll,
    ) !== false
  )
    count++;
  for (let layer = 0; layer < 2; layer++) {
    const fallback = primary && !sculpted && layer === 0;
    if (
      host.pathRibbon(
        layer ? 0xe2e9ed : 0x930d2b,
        layer ? 0.13 : fallback ? 0.58 : 0.36,
        layer ? 0.08 : 0.18,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1);
            const span = fallback ? 5.6 : 2.1;
            const s = (u - 0.5) * span;
            const curved = fallback ? Math.sin(u * Math.PI) * 0.85 : Math.sin(u * 27) * 0.035;
            points[i].set(
              at.x + dz * s * Math.cos(roll) - dx * (0.28 - curved),
              at.y + s * Math.sin(roll),
              at.z - dx * s * Math.cos(roll) - dz * (0.28 - curved),
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
      ) !== false
    )
      count++;
  }
  host.burstAt(
    at.x,
    at.y,
    at.z,
    0xa71130,
    slot.tier === 0 ? (reverse ? 21 : 17) : 7,
    reverse ? 1.4 : 1.15,
    'blood',
    0.2,
  );
  if (slot.tier === 0) {
    host.fragmentsAt?.(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      0xcbd5dc,
      reverse ? 9 : 6,
      1.3,
      dx,
      dz,
      0.2,
    );
    count++;
  }
  const force = profile.force * (reverse ? 1.35 : 1.1);
  host.contact?.(slot.casterId, slot.targetId, 'physical', force, slot.abilityId, beat);
  host.abilityAudio?.('impact', slot.spec.palette, force, at.x, at.y, at.z, {
    lite: slot.tier > 0 || !primary,
    finisher: false,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
  host.pulseLight(slot.targetId, slot.spec.palette, reverse ? 1.6 : 1.1, 0.055, 3);
  if (primary) host.shakeAt(at.x, at.y, at.z, reverse ? 0.18 : 0.12);
  host.countPrimitive(slot.abilityId, count + 3);
  return true;
}
