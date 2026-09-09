import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { furyCutSurfacePoint } from './fury_shapes';
import { physicalContact } from './physical_contact';
import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorBladePoint } from './warrior_blade_shape';

interface BladeStyle {
  span: number;
  height: number;
  roll: number;
  blood?: boolean;
  heavy?: boolean;
  groundChop?: boolean;
  rising?: boolean;
}
export const WARRIOR_BLADE_STYLES: Readonly<Record<string, BladeStyle | undefined>> = {
  heroic_strike: { span: 4.2, height: 0.95, roll: -0.95 },
  hamstring: { span: 3.5, height: 0.35, roll: 0.015, blood: true },
  slam: { span: 4.8, height: 1.4, roll: -1.35, groundChop: true },
  overpower: { span: 5.1, height: 1.25, roll: 1.05, rising: true },
  mortal_strike: { span: 5.2, height: 1.4, roll: -0.65 },
  execute: { span: 6.4, height: 1.65, roll: -1.25, heavy: true },
  bloodthirst: { span: 4.6, height: 1.45, roll: -0.8, blood: true },
  victory_rush: { span: 4.8, height: 1.3, roll: 0.35 },
};
const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 },
  point = { x: 0, y: 0, z: 0 };

/** A single owned blade contact. Native animations provide distinct loading,
 * strike and recovery poses; these surfaces follow their authored cut direction. */
export function drawWarriorBlade(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const style = WARRIOR_BLADE_STYLES[slot.abilityId];
  if (!style) return false;
  const profile = meleeImpactProfile(slot.abilityId);
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (!profile || beat > 0 || !outcome || slot.casterId === slot.targetId) return true;
  const from = host.anchorOf(slot.casterId, 0.55, source);
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), target);
  if (!from || !at) return true;
  const facing = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const front = Math.min(0.65, Math.hypot(at.x - from.x, at.z - from.z) * 0.45);
  const xAt = at.x - dx * front,
    zAt = at.z - dz * front;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, style.heavy ? 3 : 2.3, 0xd3e2eb, 'contact_crush', 1.45, 0.2);
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  const scale = style.span / (style.blood ? 3.7 : 4.4);
  const sine = Math.sin(style.roll),
    cosine = Math.cos(style.roll);
  const sample = style.blood ? furyCutSurfacePoint : warriorBladePoint;
  const duration = style.heavy ? 0.28 : 0.24;
  const count = slot.tier > 0 ? 1 : 3;
  for (let strand = 0; strand < count; strand++) {
    host.pathRibbon(
      strand === 0 ? (style.blood ? 0xff9caa : 0xf1f6ff) : style.blood ? 0xb31831 : 0xbc8666,
      (strand === 0 ? 0.19 : 0.1) * (style.heavy ? 1.4 : 1),
      duration,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          sample(i / (points.length - 1), strand * 0.1, point);
          const across = point.x * scale * cosine - point.y * style.height * sine;
          const rise = point.x * scale * sine + point.y * style.height * cosine;
          points[i].set(
            xAt + dz * across + dx * point.z * scale,
            at.y + rise,
            zAt - dx * across + dz * point.z * scale,
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
  host.crestAt?.(
    xAt,
    at.y,
    zAt,
    scale,
    style.height,
    style.blood ? 0x8f1028 : 0x8296a6,
    style.blood ? 0xf24e59 : 0xd6b19a,
    style.blood ? 'blood_cut' : 'steel_cut',
    facing,
    duration,
    style.roll,
  );
  const contacts = physicalContact(host, slot, 0, at.x, at.y, at.z);
  if (slot.tier === 0) {
    host.fragmentsAt?.(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      style.blood ? 0xb01732 : 0xb3ada5,
      style.heavy ? 18 : 10,
      style.heavy ? 1.7 : 1.15,
      dx,
      dz,
      duration,
    );
    if (style.blood) host.burstAt(at.x, at.y, at.z, 0x990c2a, 22, 1.2, 'blood', duration);
    else
      host.burstAt(
        at.x,
        at.y,
        at.z,
        0xe4c7a5,
        style.heavy ? 24 : 16,
        style.heavy ? 1.5 : 1.05,
        'sparks',
        duration,
      );
    if (style.heavy || style.groundChop) {
      const floor = host.groundYAt(at.x, at.z);
      host.bakedAt?.(
        'shout_dust',
        at.x,
        floor + 0.08,
        at.z,
        style.heavy ? 4.2 : 3.4,
        0xa39482,
        0xc2b7a1,
        0.42,
        0,
        0,
        facing,
      );
      host.fragmentsAt?.('stone_chip', at.x, floor + 0.08, at.z, 0x8b8173, 9, 0.85, dx, dz, 0.3);
    }
    if (style.rising) {
      // Two split splinter fans rise along the cut. They sit on the receiving
      // silhouette rather than turning the Warrior's whole model red.
      for (const side of [-1, 1])
        host.fragmentsAt?.(
          'metal_splinter',
          at.x + dz * side * 0.22,
          at.y + 0.35,
          at.z - dx * side * 0.22,
          0xd8aa80,
          6,
          1.25,
          dx + dz * side * 0.4,
          dz - dx * side * 0.4,
          0.28,
        );
    }
  }
  host.contact?.(
    slot.casterId,
    slot.targetId,
    'physical',
    profile.force * (style.heavy ? 1.2 : 1),
    slot.abilityId,
    0,
  );
  host.pulseLight(slot.targetId, slot.spec.palette, style.heavy ? 1.7 : 1.1, 0.06, 3);
  host.countPrimitive(
    slot.abilityId,
    count +
      contacts +
      3 +
      (slot.tier === 0 ? (style.heavy || style.groundChop || style.rising ? 4 : 2) : 0),
  );
  return true;
}
