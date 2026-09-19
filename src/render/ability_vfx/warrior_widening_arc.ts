import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { bloodlettingBeat } from './bloodletting_choreography';
import type { SeqSlot, SequencerHost } from './sequencer';
import { drawWarriorAreaReceivingContact } from './warrior_area_receiving_contact';
import { warriorCrushContact } from './warrior_crush_contact';
import { warriorImpactFan } from './warrior_impact_fan';

const origin = { x: 0, y: 0, z: 0 };
const recipient = { x: 0, y: 0, z: 0 };

const ECHO_BLADES = new Set([
  'overpower',
  'mortal_strike',
  'slam',
  'execute',
  'heroic_strike',
  'breachmaker',
  'victory_rush',
]);

/** A broad, open blade flourish primes the follow-on cut. It is a self-buff
 * ceremony, so neither these wakes nor their release can claim enemy damage. */
export function drawWarriorWideningCast(host: SequencerHost, slot: SeqSlot, beat: number): number {
  if (beat !== 0 || slot.physicalSecondary) return 0;
  const anchor = host.anchorOf(slot.casterId, 0, origin);
  if (!anchor) return 0;
  const { x, y, z } = anchor;
  const yaw = host.facingAt?.(slot.casterId) ?? 0;
  let count = 0;
  if (
    host.crestAt &&
    host.crestAt(
      x + Math.sin(yaw) * 1.7,
      y + 1.25,
      z + Math.cos(yaw) * 1.7,
      2,
      1.1,
      0x708898,
      0xdceaf3,
      'steel_cut',
      yaw,
      0.24,
      0.08,
    ) !== false
  )
    count++;
  for (let blade = 0; blade < 2; blade++) {
    if (
      host.pathRibbon(
        blade ? 0xe1edf2 : 0x8ea7b8,
        blade ? 0.19 : 0.48,
        0.3,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1);
            const angle = yaw - 1.8 + u * 3.7 + blade * 0.17;
            const radius = 3.6 + Math.sin(u * Math.PI) * 0.9 - blade * 0.34;
            points[i].set(
              x + Math.sin(angle) * radius,
              y + 1.05 + Math.sin(u * Math.PI) * 0.5 + blade * 0.2,
              z + Math.cos(angle) * radius,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        blade === 0 ? 1 : 0,
        { from: 0, to: 1 },
      ) !== false
    )
      count++;
  }
  return count;
}

/** The secondary damage event is the only permission to show an echo hit.
 * Keep its real target and source ability; never replay the caster flourish. */
export function drawWarriorEchoContact(host: SequencerHost, slot: SeqSlot): boolean {
  if (!slot.physicalSecondary) return false;
  if (bloodlettingBeat(host, slot, 0)) return true;
  const shield = slot.abilityId === 'shield_slam';
  if (!shield && !ECHO_BLADES.has(slot.abilityId)) return false;
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (!outcome || slot.casterId === slot.targetId) return true;
  const profile = meleeImpactProfile(slot.abilityId);
  if (!profile) return false;
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), recipient);
  if (!at) return true;
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 3.2, 0xd3e2eb, 'contact_crush', 1.45, 0.085);
    host.countPrimitive(slot.abilityId, 1);
    return true;
  }
  if (shield) {
    const from = host.anchorOf(slot.casterId, 0.5, origin);
    if (!from) return true;
    const facing = Math.atan2(at.x - from.x, at.z - from.z);
    let count = warriorCrushContact(
      host,
      slot.targetId,
      at,
      meleeContactHeight(profile, 0),
      facing,
      8.2,
      slot.tier,
    );
    count += warriorImpactFan(host, at, facing, 0.08, 3.2, 0x9bafb9);
    host.contact?.(
      slot.casterId,
      slot.targetId,
      'physical',
      profile.force * 1.2,
      slot.abilityId,
      0,
    );
    host.countPrimitive(slot.abilityId, count);
    return true;
  }
  drawWarriorAreaReceivingContact(
    host,
    slot.abilityId,
    slot.casterId,
    slot.targetId,
    slot.tier,
    at,
    profile,
    true,
  );
  return true;
}
