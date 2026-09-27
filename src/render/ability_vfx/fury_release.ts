import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { harvestFallback } from './harvest_fallback';
import type { SeqSlot, SequencerHost } from './sequencer';

const origin = { x: 0, y: 0, z: 0 },
  hand = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

/** The original crossing blade membranes lead into the delayed explosion.
 * These describe weapon motion only; wounds and hit feedback wait for damage. */
export function drawHarvestOpeningCut(
  host: SequencerHost,
  slot: Pick<SeqSlot, 'abilityId' | 'casterId' | 'targetId' | 'physicalSecondary' | 'spec'>,
  beat: number,
): void {
  if (slot.abilityId !== 'red_harvest' || slot.physicalSecondary || beat < 0 || beat > 1) return;
  const profile = meleeImpactProfile('red_harvest')!;
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, beat), target);
  const from = host.anchorOf(slot.casterId, 0.55, origin);
  if (!at || !from || slot.targetId === slot.casterId) return;
  const facing = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const distance = Math.min(
    Math.hypot(at.x - from.x, at.z - from.z),
    slot.spec.physical?.reach ?? 3.65,
  );
  const x = from.x + dx * (distance - 0.25),
    z = from.z + dz * (distance - 0.25);
  const roll = meleeImpactProfile('red_harvest', beat)?.angle ?? profile.angle;
  const accepted = host.crestAt?.(
    x,
    at.y,
    z,
    1.2,
    1.15,
    0x590719,
    0xd9233d,
    'harvest_cut',
    facing,
    0.16,
    roll,
  );
  let count = host.crestAt && accepted !== false ? 1 : 0;
  if (!count) {
    target.x = x;
    target.z = z;
    count = harvestFallback(host, target, facing, roll, 3.72 / 6.36);
  }
  host.countPrimitive(slot.abilityId, count);
}

/** Red Harvest gathers rage into both weapons before its first contact.
 * The reversed fluid sprites finish inside the .15-second load; no victim
 * mark or hit feedback is authorized by this caster-only anticipation. */
export function drawHarvestRelease(host: SequencerHost, slot: SeqSlot): void {
  if (slot.abilityId !== 'red_harvest' || slot.physicalSecondary) return;
  const at = host.anchorOf(slot.casterId, 0.55, origin);
  if (!at) return;
  const facing = host.facingAt?.(slot.casterId) ?? 0;
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  let count = 0;
  for (const index of [0, 1] as const) {
    const side = index === 0 ? 1 : -1;
    const grip = host.handPoint?.(slot.casterId, index, hand);
    const x = grip?.x ?? at.x + dz * side * 0.5;
    const y = grip?.y ?? at.y;
    const z = grip?.z ?? at.z - dx * side * 0.5;
    if (
      slot.tier === 0 &&
      host.bakedAt &&
      host.bakedAt(
        'warrior_power',
        x,
        y,
        z,
        4.8,
        0x9c1330,
        0xff6973,
        0.14,
        0,
        0.8,
        facing,
        true,
        side * 0.9,
        0.65,
      ) !== false
    )
      count++;
    const ribbon = host.pathRibbon(
      0xc82346,
      0.15,
      0.14,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const across = side * (1 - u) * 1.8;
          const back = Math.sin(u * Math.PI) * 0.6;
          points[i].set(
            x + dz * across - dx * back,
            y + Math.sin(u * Math.PI) * 0.45,
            z - dx * across - dz * back,
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
    if (ribbon !== false) count++;
  }
  host.countPrimitive(slot.abilityId, count);
}
