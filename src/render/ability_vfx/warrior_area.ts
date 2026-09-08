import { meleeContactHeight, meleeContactPoint, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorAreaPoint } from './warrior_area_shapes';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 },
  point = { x: 0, y: 0, z: 0 };

export function isWarriorAreaInstant(id: string | undefined): boolean {
  return (
    id === 'whirlwind' ||
    id === 'cleave' ||
    id === 'revenge' ||
    id === 'thunder_clap' ||
    id === 'faultline'
  );
}

/** Exactly one sweep belongs to the cast, regardless of recipient count. */
export function drawReapingArc(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'cleave') return false;
  if (beat > 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0, source);
  if (!at) return true;
  const angle = host.facingAt?.(slot.casterId) ?? 0,
    sine = Math.sin(angle),
    cosine = Math.cos(angle);
  for (let strand = 0; strand < (slot.tier > 0 ? 1 : 3); strand++)
    host.pathRibbon(
      strand === 0 ? 0xf4d1ad : 0x829caf,
      strand === 0 ? 0.2 : 0.1,
      0.28,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          warriorAreaPoint('steel_reap', 0, i / (points.length - 1), strand * 0.11, point);
          points[i].set(
            at.x + point.x * cosine + point.z * sine,
            at.y + point.y,
            at.z + point.z * cosine - point.x * sine,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      strand === 0 ? 1 : 0,
    );
  host.crestAt?.(at.x, at.y, at.z, 1, 1, 0x8c9fae, 0xdeaf8a, 'steel_reap', angle, 0.28);
  host.countPrimitive('cleave', slot.tier > 0 ? 2 : 4);
  return true;
}

/** The authoritative channel pulse owns dust pressure, including the last
 * pulse after cast state clears. No target means no invented body collision. */
export function drawWarriorStormPulse(
  host: SequencerHost,
  x: number,
  z: number,
  radius: number,
  tier: number,
): number {
  const count = tier > 0 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.4;
    const dx = Math.sin(angle),
      dz = Math.cos(angle);
    const px = x + dx * radius * 0.64,
      pz = z + dz * radius * 0.64;
    const floor = host.groundYAt(px, pz) + 0.08;
    host.bakedAt?.('shout_dust', px, floor, pz, 2.8, 0x8e887b, 0xc2b39b, 0.42, 0, 0, angle);
    if (tier === 0) host.fragmentsAt?.('stone_chip', px, floor, pz, 0x9c8e7b, 7, 0.8, dz, -dx, 0.3);
  }
  return count * (tier === 0 ? 2 : 1);
}

/** One real receiving hit. All quality levels retain the compact imprint;
 * it never starts another caster animation, area sweep or area sound. */
export function drawWarriorAreaContact(
  host: SequencerHost,
  id: string,
  sourceId: number,
  targetId: number,
  outcome: 0 | 1 | 2,
  tier: number,
): boolean {
  if (id !== 'bladestorm' && !isWarriorAreaInstant(id)) return false;
  if (!outcome || sourceId === targetId) return true;
  const profile = meleeImpactProfile(id);
  if (!profile) return false;
  const at = host.anchorOf(targetId, meleeContactHeight(profile, 0), target);
  if (!at) return false;
  host.flipbookAt(
    at.x,
    at.y,
    at.z,
    outcome === 2 ? 2.4 : 2.8,
    outcome === 2 ? 0xcadce8 : 0xeac6a4,
    outcome === 2 || id === 'thunder_clap' || id === 'faultline' ? 'contact_crush' : 'contact_cut',
    1.7,
    0.21,
    0.3,
  );
  if (outcome === 2) return true;
  const from = host.anchorOf(sourceId, 0.5, source);
  const angle = from ? Math.atan2(at.x - from.x, at.z - from.z) : 0;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  host.pathRibbon(
    0xf1cbaa,
    0.18,
    0.2,
    (points) => {
      for (let i = 0; i < points.length; i++) {
        meleeContactPoint(profile, i / (points.length - 1), 0, 0, point);
        points[i].set(
          at.x + dz * point.x + dx * point.z,
          at.y + point.y,
          at.z - dx * point.x + dz * point.z,
        );
      }
      return points.length;
    },
    true,
    null,
    true,
    0,
  );
  if (tier === 0)
    host.fragmentsAt?.('metal_splinter', at.x, at.y, at.z, 0xc6aa8f, 8, 0.9, dx, dz, 0.22);
  host.contact?.(sourceId, targetId, 'physical', profile.force, id, 0);
  host.countPrimitive(id, tier === 0 ? 3 : 2);
  return true;
}
