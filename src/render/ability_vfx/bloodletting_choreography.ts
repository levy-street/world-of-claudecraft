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
  const targetId = slot.targetId,
    height = meleeContactHeight(profile, 0);
  const at = host.anchorOf(targetId, height, target);
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
  const impact = { x: at.x, y: at.y, z: at.z };
  const body = { x: 0, y: 0, z: 0 };
  const facingOffset = facing - (host.facingAt?.(targetId) ?? facing);
  const primary = !slot.physicalSecondary;
  host.flipbookAt(
    at.x - dx * 0.18,
    at.y,
    at.z - dz * 0.18,
    3.4,
    0xea7078,
    'contact_cut',
    1.15,
    0.045,
    roll,
  );
  const sculpted =
    primary &&
    !!host.crestAt &&
    host.crestAt(
      at.x - dx * 0.3,
      at.y,
      at.z - dz * 0.3,
      1.18,
      1.4,
      0x590719,
      0xd9233d,
      'bloodletting_pull',
      facing,
      0.28,
      roll,
    ) !== false;
  let count = sculpted ? 2 : 1;
  if (
    host.bakedAt &&
    host.bakedAt(
      'harvest_impact',
      at.x - dx * 0.4,
      at.y,
      at.z - dz * 0.4,
      7.4,
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
        layer ? 0xffe5de : 0x6c0824,
        layer ? 0.15 : fallback ? 0.62 : 0.5,
        layer ? 0.075 : 0.2,
        (points) => {
          const origin = fallback ? impact : host.anchorOf(targetId, height, body);
          if (!origin) return 0;
          const yaw = fallback ? facing : (host.facingAt?.(targetId) ?? facing) + facingOffset;
          const sx = Math.sin(yaw),
            sz = Math.cos(yaw);
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              s = (u - 0.5) * (fallback ? 7.6 : 2.5);
            const jag = fallback
              ? (Math.cos((u - 0.5) * 2.4) - 1) * 0.35
              : Math.sin(u * 23) * Math.sin(u * Math.PI) * 0.055;
            points[i].set(
              origin.x + sz * s * Math.cos(roll) - sx * 0.24,
              origin.y + s * Math.sin(roll) + jag,
              origin.z - sx * s * Math.cos(roll) - sz * 0.24,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
        fallback ? { from: 0, to: 1 } : null,
        !fallback,
      ) !== false
    )
      count++;
  }
  host.burstAt(at.x, at.y, at.z, 0x940c2b, slot.tier > 0 ? 4 : 10, 1.6, 'blood', 0.25, 0.02);
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
  if (primary) host.shakeAt(at.x, at.y, at.z, 0.15, true);
  host.countPrimitive(slot.abilityId, count + 1);
  return true;
}
