import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { drawFurySurface } from './fury_surface';
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
  const reaping = harvest && final;
  const span = harvest ? [4.7, 5.3, 7.4][beat] : [4.7, 5.3][beat];
  const tilt = harvest ? [-0.8, 0.16, 0.9][beat] : [-0.92, 0.85][beat];
  const force = profile.force * (final ? 1.35 : 1);
  const duration = reaping ? 0.25 : 0.23;
  const count =
    drawFurySurface(
      host,
      slot,
      at,
      facing,
      span,
      reaping ? 1.7 : final ? 1.6 : 1.3,
      reaping ? 0.93 : tilt * 0.48,
      duration,
      final,
    ) + (reaping ? drawFurySurface(host, slot, at, facing, span, 1.7, -0.93, duration, true) : 0);
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
      reaping ? 0xc5213e : 0xad9591,
      reaping ? 22 : final ? 12 : 7,
      reaping ? 2.1 : final ? 1.35 : 0.85,
      forwardX,
      forwardZ,
      0.23,
    );
    host.burstAt(at.x, at.y, at.z, 0xab0c2b, final ? 28 : 17, final ? 1.55 : 1.05, 'blood', 0.23);
    if (reaping) {
      const floor = host.groundYAt(at.x, at.z);
      host.bakedAt?.(
        'shout_dust',
        at.x,
        floor + 0.08,
        at.z,
        5.6,
        0x7b5a53,
        0xb49a86,
        0.23,
        0,
        0,
        facing,
      );
      host.fragmentsAt?.(
        'stone_chip',
        at.x,
        floor + 0.1,
        at.z,
        0x65534a,
        12,
        1.5,
        forwardX,
        forwardZ,
        0.23,
      );
    }
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
  host.countPrimitive(
    slot.abilityId,
    count + contactCount + (slot.tier === 0 ? 6 + (reaping ? 2 : 0) : 3),
  );
  return true;
}
