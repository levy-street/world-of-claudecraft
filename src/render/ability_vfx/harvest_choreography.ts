import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { harvestFallback } from './harvest_fallback';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** A confirmed collision owns every layer. Cleave recipients receive the bite,
 * while only the primary recipient owns the towering extraction. */
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
  const roll = beat === 0 ? -0.66 : beat === 1 ? 0.58 : 0;
  const life = final ? 0.25 : 0.16;
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
  // The broad normal-alpha sprite carries dense red material beneath a very
  // short hot seam. It is prepared before use, including on Low graphics.
  if (
    host.bakedAt &&
    host.bakedAt(
      'harvest_impact',
      at.x - dx * 0.55,
      at.y,
      at.z - dz * 0.55,
      final ? 7.4 : 4.6,
      0xffffff,
      0xff8990,
      life,
      0,
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
      at.y - (final ? 0.35 : 0),
      at.z - dz * 0.25,
      final ? 1.25 : 1.12,
      final ? 1.2 : 1.35,
      0x530b20,
      0xe32d47,
      final ? 'harvest_eruption' : 'harvest_cut',
      facing,
      life,
      roll,
    ) !== false;
  if (sculpture) count++;
  else if (primary && final) count += harvestFallback(host, at, facing);
  // A narrow receiving seam remains visible when optional pools are busy.
  // Both the seam and its dark backing lie on the body, never at the caster.
  for (let layer = 0; layer < 2; layer++) {
    if (
      host.pathRibbon(
        layer ? 0xffc2b1 : 0x790b27,
        layer ? (final ? 0.18 : 0.12) : final ? 0.5 : 0.3,
        layer ? 0.075 : 0.14,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              s = (u - 0.5) * (final ? 2.3 : 1.65);
            const across = s * Math.cos(roll),
              rise = s * Math.sin(roll);
            const jag = Math.sin(u * 23) * Math.sin(u * Math.PI) * 0.055;
            points[i].set(
              at.x + dz * across - dx * 0.23,
              at.y + rise + jag,
              at.z - dx * across - dz * 0.23,
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
    0x940c2b,
    slot.tier === 0 ? (final ? 24 : 13) : 7,
    final ? 1.65 : 1.05,
    'blood',
    life,
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
  const force = profile.force * (final ? 1.5 : 1.05);
  host.contact?.(slot.casterId, slot.targetId, 'physical', force, slot.abilityId, beat);
  host.abilityAudio?.('impact', slot.spec.palette, force, at.x, at.y, at.z, {
    lite: slot.tier > 0 || !primary,
    finisher: final,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
  host.pulseLight(slot.targetId, slot.spec.palette, final ? 2 : 1.1, 0.055, 3);
  if (primary && final) host.shakeAt(at.x, at.y, at.z, 0.28);
  host.countPrimitive(slot.abilityId, count + 3);
  return true;
}
