import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { harvestFallback } from './harvest_fallback';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** A confirmed collision owns every layer. Cleave recipients receive the bite,
 * while only the primary recipient owns the full blade membrane. */
export function harvestBeat(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'red_harvest') return false;
  const outcome =
    slot.componentOutcomes === undefined ? 1 : (slot.componentOutcomes >> (beat * 2)) & 3;
  if (outcome === 0) return true;
  const profile = meleeImpactProfile('red_harvest')!;
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, beat), target);
  const from = host.anchorOf(slot.casterId, 0.55, source);
  if (!at || !from || slot.targetId === slot.casterId) return true;
  const facing = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const final = beat === 2,
    primary = !slot.physicalSecondary;
  const roll = meleeImpactProfile('red_harvest', beat)?.angle ?? profile.angle;
  const life = final ? 0.24 : 0.16;
  if (outcome === 2) {
    host.flipbookAt(
      at.x,
      at.y,
      at.z,
      final ? 3.2 : 2.4,
      0xc5d9e1,
      'contact_crush',
      1.3,
      0.16,
      roll,
    );
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  let count = 0;
  host.flipbookAt(
    at.x - dx * 0.18,
    at.y,
    at.z - dz * 0.18,
    final ? 3.8 : beat === 1 ? 2.9 : 2.5,
    final ? 0xffb6ad : 0xea7078,
    'contact_cut',
    final ? 1.25 : 1.05,
    final ? 0.055 : 0.04,
    roll,
  );
  count++;
  // The compact spray starts at its centred wound pivot. The wider world-space
  // membrane carries the blade direction, independently of this contact detail.
  if (
    host.bakedAt &&
    host.bakedAt(
      'harvest_impact',
      at.x - dx * 0.28,
      at.y,
      at.z - dz * 0.28,
      final ? 6.4 : beat === 1 ? 4.8 : 4.2,
      0xffffff,
      0xff8990,
      life - (final ? 0.048 : 0.02),
      final ? 0.048 : 0.02,
      0,
      facing,
      false,
      roll,
    ) !== false
  )
    count++;
  const sculpture =
    primary &&
    host.crestAt &&
    host.crestAt(
      at.x - dx * 0.25,
      at.y,
      at.z - dz * 0.25,
      1.2,
      1.15,
      0x590719,
      0xd9233d,
      final ? 'harvest_eruption' : 'harvest_cut',
      facing,
      life,
      roll,
    ) !== false;
  if (sculpture) count++;
  else if (primary && final) count += harvestFallback(host, at, facing);
  // Admit the contact first. Dust may only borrow capacity left after its core.
  if (primary && final && slot.tier === 0 && host.bakedAt) {
    const floor = host.groundYAt(from.x, from.z);
    for (const side of [-1, 1])
      if (
        host.bakedAt(
          'shout_dust',
          from.x + dz * side * 0.4,
          floor + 0.07,
          from.z - dx * side * 0.4,
          1.25,
          0x79716b,
          0xaaa19a,
          0.2,
          0,
          0,
          facing + Math.PI + side * 0.35,
        ) !== false
      )
        count++;
  }
  // A narrow receiving seam remains visible when optional pools are busy.
  // Both the seam and its dark backing lie on the body, never at the caster.
  const targetId = slot.targetId;
  const height = meleeContactHeight(profile, beat);
  const yawOffset = facing - (host.facingAt?.(targetId) ?? facing);
  const followPoint = { x: 0, y: 0, z: 0 };
  for (let layer = 0; layer < 2; layer++) {
    if (
      host.pathRibbon(
        layer ? 0xffe5de : 0x6c0824,
        layer ? (final ? 0.27 : 0.14) : final ? 0.72 : 0.34,
        layer ? (final ? 0.055 : 0.045) : final ? 0.23 : 0.16,
        (points) => {
          const body = host.anchorOf(targetId, height, followPoint);
          if (!body) return 0;
          const yaw = (host.facingAt?.(targetId) ?? facing) + yawOffset;
          const sx = Math.sin(yaw),
            sz = Math.cos(yaw);
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              s = (u - 0.5) * (final ? 2.7 : 1.8);
            const across = s * Math.cos(roll),
              rise = s * Math.sin(roll);
            const jag = Math.sin(u * 23) * Math.sin(u * Math.PI) * 0.055;
            points[i].set(
              body.x + sz * across - sx * 0.23,
              body.y + rise + jag,
              body.z - sx * across - sz * 0.23,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
        null,
        true,
      ) !== false
    )
      count++;
  }
  host.burstAt(
    at.x,
    at.y,
    at.z,
    0x940c2b,
    slot.tier === 0 ? (final ? 12 : beat === 1 ? 7 : 5) : 3,
    final ? 1.35 : beat === 1 ? 1.0 : 0.85,
    'blood',
    life - (final ? 0.048 : 0.02),
    final ? 0.048 : 0.02,
  );
  if (slot.tier === 0) {
    host.fragmentsAt?.(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      0xc9d0d6,
      final ? 7 : 4,
      final ? 1.7 : 1.1,
      dx,
      dz,
      0.18,
    );
    count++;
  }
  const force = profile.force * (final ? 1.65 : beat === 1 ? 1.15 : 1.05);
  host.contact?.(slot.casterId, slot.targetId, 'physical', force, slot.abilityId, beat);
  host.abilityAudio?.('impact', slot.spec.palette, force, at.x, at.y, at.z, {
    lite: slot.tier > 0 || !primary,
    finisher: final,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
  host.pulseLight(slot.targetId, slot.spec.palette, final ? 2 : 1.1, 0.055, 3);
  if (primary && final) host.shakeAt(at.x, at.y, at.z, 0.36, true);
  host.countPrimitive(slot.abilityId, count + 3);
  return true;
}
