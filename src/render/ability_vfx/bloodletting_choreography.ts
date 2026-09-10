import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** The bite is one real weapon hit. Self-healing is separately driven by the
 * effective heal event, so this performance never promises a blood transfer. */
export function bloodlettingBeat(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'bloodthirst') return false;
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (beat > 0 || !outcome || slot.targetId === slot.casterId) return true;
  const profile = meleeImpactProfile('bloodthirst')!;
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), target);
  const from = host.anchorOf(slot.casterId, 0.55, source);
  if (!at || !from) return true;
  const facing = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(facing),
    dz = Math.cos(facing),
    roll = -0.74;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 2.8, 0xd3e2eb, 'contact_crush', 1.45, 0.17, roll);
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  const primary = !slot.physicalSecondary;
  const sculpted =
    primary &&
    !!host.crestAt &&
    host.crestAt(
      at.x - dx * 0.3,
      at.y,
      at.z - dz * 0.3,
      1.08,
      1.4,
      0x490b20,
      0xe82c49,
      'bloodletting_pull',
      facing,
      0.28,
      roll,
    ) !== false;
  let count = sculpted ? 1 : 0;
  if (
    host.bakedAt &&
    host.bakedAt(
      'warrior_bite',
      at.x - dx * 0.4,
      at.y,
      at.z - dz * 0.4,
      6.2,
      0xffffff,
      0xff8990,
      0.23,
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
        layer ? 0xe8edf0 : 0x8d0d2c,
        layer ? 0.14 : 0.48,
        layer ? 0.075 : 0.2,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              s = (u - 0.5) * (fallback ? 5.4 : 2.5);
            const jag = Math.sin(u * 31) * Math.sin(u * Math.PI) * 0.065;
            points[i].set(
              at.x + dz * s * Math.cos(roll) - dx * 0.24,
              at.y + s * Math.sin(roll) + jag,
              at.z - dx * s * Math.cos(roll) - dz * 0.24,
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
  host.burstAt(at.x, at.y, at.z, 0x940d2b, slot.tier > 0 ? 10 : 30, 1.45, 'blood', 0.27);
  count++;
  if (slot.tier === 0 && host.fragmentsAt) {
    host.fragmentsAt(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      0xc3d0d8,
      9,
      1.35,
      dx + dz * 0.55,
      dz - dx * 0.55,
      0.24,
    );
    count++;
  }
  if (host.contact) {
    host.contact(slot.casterId, slot.targetId, 'physical', profile.force * 1.3, slot.abilityId, 0);
    count++;
  }
  host.pulseLight(slot.targetId, slot.spec.palette, 1.4, 0.055, 3);
  if (primary) host.shakeAt(at.x, at.y, at.z, 0.15);
  host.countPrimitive(slot.abilityId, count + 1);
  return true;
}
