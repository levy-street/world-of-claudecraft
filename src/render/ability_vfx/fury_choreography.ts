import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { physicalContact } from './physical_contact';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';

const source: SeqPoint = { x: 0, y: 0, z: 0 };
const target: SeqPoint = { x: 0, y: 0, z: 0 };

/** Two crossing cuts versus a three-part harvest. Replaces the generic path
 * composition completely; physicalImpact still owns timing and retirement. */
export function furyBeat(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const harvest = slot.abilityId === 'red_harvest';
  if (!harvest && slot.abilityId !== 'raging_gale') return false;
  const profile = meleeImpactProfile(slot.abilityId)!;
  const outcome =
    slot.componentOutcomes === undefined ? 1 : (slot.componentOutcomes >> (beat * 2)) & 3;
  // Native weapon motion still plays through avoided contacts. Only a real
  // component result can authorize material on the victim or contact feedback.
  if (outcome === 0) return true;
  const from = host.anchorOf(slot.casterId, 0.55, source);
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, beat), target);
  if (!from || !at || slot.targetId === slot.casterId) return true;
  const dx = at.x - from.x,
    dz = at.z - from.z;
  const facing =
    Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : (host.facingAt?.(slot.casterId) ?? 0);
  const forwardX = Math.sin(facing),
    forwardZ = Math.cos(facing);
  const final = beat === profile.contacts - 1;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 1.5, 0xc5d9e1, 'contact_crush', 1.25, 0.18);
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  if (slot.physicalSecondary) {
    // Cleave owns another victim's wound, never another performance by the
    // caster. Keep every actual component, including shield-only contacts.
    const contactCount = physicalContact(host, slot, beat, at.x, at.y, at.z);
    host.contact?.(slot.casterId, slot.targetId, 'physical', profile.force, slot.abilityId, beat);
    host.abilityAudio?.('impact', slot.spec.palette, profile.force, at.x, at.y, at.z, {
      lite: true,
      finisher: harvest && final,
      archetype: slot.spec.archetype,
      abilityId: slot.abilityId,
    });
    host.countPrimitive(slot.abilityId, contactCount);
    return true;
  }
  const span = harvest ? [3.6, 4.0, 5.1][beat] : [3.25, 3.85][beat];
  const tilt = harvest ? [-0.8, 0.16, 0.9][beat] : [-0.92, 0.85][beat];
  const red = harvest ? 0xc11130 : 0xb82237;
  const force = profile.force * (final ? 1.35 : 1);
  const count = slot.tier > 0 ? 1 : 3;
  // Bright edge first: retained unchanged when peripheral material is shed.
  for (let strand = 0; strand < count; strand++) {
    const width = strand === 0 ? 0.21 : strand === 1 ? 0.64 : 0.31;
    host.pathRibbon(
      strand === 0 ? slot.accent : red,
      width * (final ? 1.2 : 1),
      0.23,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const across = (u - 0.5) * span;
          const torn = Math.sin(u * 24 + strand * 1.7) * Math.sin(u * Math.PI) * strand * 0.025;
          const rise = across * tilt * 0.46 + Math.sin(u * Math.PI) * 0.18 - strand * 0.08 + torn;
          const exit = Math.sin(u * Math.PI) * (0.16 + strand * 0.11);
          points[i].set(
            at.x + forwardZ * across + forwardX * exit,
            at.y + rise,
            at.z - forwardX * across + forwardZ * exit,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      strand === 0 ? 1 : 0,
    );
  }
  // A substantial, lit blood sheet gives the pale edge dark material support.
  // It uses an existing prewarmed pool and remains readable without bloom.
  host.crestAt?.(
    at.x,
    at.y + 0.08,
    at.z,
    span / 3.7,
    final ? 1.35 : 0.95,
    0x8e0922,
    0xf24e59,
    'blood_cut',
    facing,
    0.23,
    tilt * 0.48,
  );
  // The Fury edge already owns the cut direction. Its compact contact sheet
  // marks the victim without stacking another copy of the generic slash.
  host.flipbookAt(
    at.x,
    at.y,
    at.z,
    final ? 2.4 : 1.9,
    0xb82339,
    'contact_cut',
    1.35,
    0.18,
    tilt * 0.5,
    1.15,
  );
  const contactCount = 1;
  if (slot.tier === 0) {
    host.fragmentsAt?.(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      0xad9591,
      final ? 12 : 7,
      final ? 1.35 : 0.85,
      forwardX,
      forwardZ,
      0.23,
    );
    host.burstAt(at.x, at.y, at.z, 0xab0c2b, final ? 28 : 17, final ? 1.55 : 1.05, 'blood', 0.23);
  }
  host.contact?.(slot.casterId, slot.targetId, 'physical', force, slot.abilityId, beat);
  host.abilityAudio?.('impact', slot.spec.palette, force, at.x, at.y, at.z, {
    lite: slot.tier > 0,
    finisher: harvest && final,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
  host.pulseLight(slot.targetId, slot.spec.palette, final ? 1.8 : 1.05, 0.07, 3);
  if (slot.tier === 0) host.shakeAt(at.x, at.y, at.z, harvest && final ? 0.26 : 0.17);
  host.countPrimitive(slot.abilityId, count + contactCount + (slot.tier === 0 ? 6 : 3));
  return true;
}
