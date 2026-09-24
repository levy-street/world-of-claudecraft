import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';
import { drawWarriorAreaReceivingContact } from './warrior_area_receiving_contact';
import { warriorAreaPoint } from './warrior_area_shapes';
import { drawWarriorGroundReceivingContact } from './warrior_ground_receiving_contact';

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
  // A later cast may overwrite the module scratch while this sweep is alive.
  const x = at.x,
    y = at.y,
    z = at.z;
  const angle = host.facingAt?.(slot.casterId) ?? 0,
    sine = Math.sin(angle),
    cosine = Math.cos(angle);
  for (let strand = 0; strand < (slot.tier > 0 ? 1 : 3); strand++)
    host.pathRibbon(
      strand === 0 ? 0x718896 : 0xe2edf2,
      strand === 0 ? 0.1 : strand === 1 ? 0.26 : 0.13,
      0.28,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          warriorAreaPoint(
            'steel_reap',
            0,
            strand === 0 ? u : strand === 1 ? 0.22 + u * 0.56 : 0.32 + u * 0.36,
            strand * 0.11,
            point,
          );
          points[i].set(
            x + point.x * cosine + point.z * sine,
            y + point.y,
            z + point.z * cosine - point.x * sine,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      strand === 0 ? 1 : 0,
      { from: 0, to: 1 },
    );
  host.crestAt?.(x, y, z, 1, 1, 0x8c9fae, 0xe4edf2, 'steel_reap', angle, 0.28);
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
  if (id !== 'heroic_leap' && id !== 'bladestorm' && !isWarriorAreaInstant(id)) return false;
  if (!outcome || sourceId === targetId) return true;
  const profile = meleeImpactProfile(id);
  if (!profile) return false;
  const at = host.anchorOf(targetId, meleeContactHeight(profile, 0), target);
  if (!at) return false;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 2.4, 0xcadce8, 'contact_crush', 1.7, 0.21, 0.3);
    return true;
  }
  const groundImpact = id === 'heroic_leap' || id === 'thunder_clap' || id === 'faultline';
  if (groundImpact)
    drawWarriorGroundReceivingContact(host, id, sourceId, targetId, tier, at, profile);
  else drawWarriorAreaReceivingContact(host, id, sourceId, targetId, tier, at, profile);
  return true;
}
