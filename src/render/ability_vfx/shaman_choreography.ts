import { abilityHexColor } from '../ability_vfx_core';
import type { SeqPoint, SeqSlot, SequencerHost } from './sequencer';
import { shamanCeremony } from './shaman_ceremonies';
import { shamanContactTail } from './shaman_contact_tail';
import { shamanFaultwakeOpening } from './shaman_earth_impacts';
import { shamanElementalContact } from './shaman_elemental_impacts';
import { sampleShamanOrigin } from './shaman_origins';
import { shamanPrimalCeremony } from './shaman_primal_ceremony';
import { drawShamanThunderVent } from './shaman_vent';

function colors(slot: SeqSlot): [number, number] {
  return [abilityHexColor(slot.spec.tint ?? '#428bcf'), slot.accent];
}

// Each prepared ribbon already carries a coloured envelope and hot spine.
// Keep one pool slot per discharge; sheet filigree supplies the fine branches.
function discharge(
  host: SequencerHost,
  from: SeqPoint,
  to: SeqPoint,
  color: number,
  hot: number,
  width: number,
  life: number,
  seed: number,
): void {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const side = Math.hypot(dx, dz) || 1;
  const sx = -dz / side,
    sz = dx / side;
  const fill = (points: { set(x: number, y: number, z: number): unknown }[]) => {
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      const taper = Math.sin(u * Math.PI);
      const j =
        (Math.sin(i * 4.73 + seed) + Math.sin(i * 2.17 + seed * 3) * 0.42) *
        taper *
        Math.min(0.28, length * 0.075);
      points[i].set(from.x + dx * u + sx * j, from.y + dy * u + j * 0.55, from.z + dz * u + sz * j);
    }
    return 12;
  };
  host.pathRibbon(color, width, life, fill, false, null, true);
  // The shared ribbon's core supplies the white-hot value; hot is the sheet accent.
  void hot;
}

export function shamanRelease(host: SequencerHost, slot: SeqSlot): boolean {
  const shape = slot.spec.shaman;
  if (!shape) return false;
  if (slot.physicalSecondary) return true;
  const at = { x: 0, y: 0, z: 0 };
  if (!sampleShamanOrigin(host, slot.abilityId, slot.casterId, at)) return true;
  const [color, hot] = colors(slot);
  if (shape.action === 'strike' || shape.action === 'imbue') {
    if (host.isWeaponHand?.(slot.casterId, 0))
      host.weaponTrail?.(slot.casterId, 0, color, 0.24, 0.36);
    if (slot.abilityId === 'stormstrike' && host.isWeaponHand?.(slot.casterId, 1))
      host.weaponTrail?.(slot.casterId, 1, hot, 0.2, 0.4);
  }
  if (shape.action === 'bolt' && slot.abilityId !== 'chain_lightning') {
    const target = host.anchorOf(slot.targetId, 0.58);
    if (target) {
      const length = Math.hypot(target.x - at.x, target.y - at.y, target.z - at.z) || 1;
      const reach = Math.min(1.7, length * 0.3) / length;
      discharge(
        host,
        at,
        {
          x: at.x + (target.x - at.x) * reach,
          y: at.y + (target.y - at.y) * reach,
          z: at.z + (target.z - at.z) * reach,
        },
        color,
        hot,
        0.22,
        0.19,
        slot.casterId,
      );
    }
  }
  host.burstAt(
    at.x,
    at.y,
    at.z,
    hot,
    slot.tier === 0 ? 20 : 9,
    0.65,
    shape.element === 'earth'
      ? 'shaman_grit'
      : shape.element === 'fire'
        ? 'shaman_embers'
        : shape.element === 'water'
          ? 'shaman_droplets'
          : 'shaman_sparks',
    0.26,
  );
  host.abilityAudio?.('release', slot.spec.palette, shape.weight, at.x, at.y, at.z, {
    abilityId: slot.abilityId,
    archetype: slot.spec.archetype,
    lite: slot.tier > 0,
  });
  host.countPrimitive(slot.abilityId, 2);
  return true;
}

export function shamanImpact(host: SequencerHost, slot: SeqSlot): boolean {
  const shape = slot.spec.shaman;
  if (!shape) return false;
  const [color, hot] = colors(slot);
  const at = { x: slot.ix, y: slot.iy, z: slot.iz };
  if (slot.componentOutcomes === 0) return true;
  if (slot.componentOutcomes === 2) {
    // Confirmed absorption catches on the ward without inventing a body hit.
    host.burstAt(at.x, at.y, at.z, hot, slot.tier === 0 ? 10 : 4, 0.6, 'shaman_sparks', 0.18);
    host.flipbookAt(at.x, at.y, at.z, 0.8, color, 'shaman_storm', 1, 0.14, 0.4, 0.55);
    return true;
  }
  if (slot.abilityId === 'earthquake' && shape.action === 'field') {
    shamanFaultwakeOpening(host, slot, shape, at, color, hot);
    slot.shamanClimaxAt = slot.t + 0.38;
    slot.lingerUntil = Math.max(slot.lingerUntil, slot.shamanClimaxAt + 0.85);
    return true;
  }
  if (shape.action === 'imbue') {
    // Enchant material starts on the equipped hand, never the character's head.
    if (!sampleShamanOrigin(host, slot.abilityId, slot.casterId, at)) return true;
    shamanElementalContact(host, slot, { ...shape, radius: 0.75, weight: 0.65 }, at, color, hot);
  } else if (
    shape.action === 'ward' ||
    shape.action === 'exalt' ||
    shape.action === 'morph' ||
    shape.action === 'revive'
  ) {
    shamanCeremony(host, slot, at, color, hot);
    if (slot.abilityId.startsWith('primal_exaltation')) {
      slot.shamanClimaxAt = slot.t + 0.3;
      slot.lingerUntil = slot.t + 1.7;
    }
  } else shamanElementalContact(host, slot, shape, at, color, hot);
  host.pulseLight(
    slot.targetId >= 0 ? slot.targetId : slot.casterId,
    slot.spec.palette,
    (shape.action === 'strike' || shape.action === 'jolt' || shape.action === 'bolt' ? 2.8 : 1.3) *
      shape.weight,
    0.28,
    9,
  );
  if (shape.action === 'strike' || shape.action === 'jolt' || shape.action === 'bolt') {
    if (slot.abilityId !== 'lightning_shield') {
      slot.shamanClimaxAt = slot.t + (shape.element === 'storm' ? 0.19 : 0.18);
      slot.lingerUntil = Math.max(slot.lingerUntil, slot.t + 1.05);
    }
    host.contact?.(slot.casterId, slot.targetId, slot.spec.palette, shape.weight, slot.abilityId);
    host.shakeAt(at.x, at.y, at.z, shape.action === 'bolt' ? 0.14 : 0.18, true);
  }
  host.abilityAudio?.('impact', slot.spec.palette, shape.weight, at.x, at.y, at.z, {
    abilityId: slot.abilityId,
    archetype: slot.spec.archetype,
    lite: slot.tier > 0,
  });
  host.countPrimitive(slot.abilityId, 8);
  return true;
}

/** A field's cosmetic crescendo follows its real immediate contact. It neither
 * replays the cast nor changes the field duration or damage event. */
export function shamanFollowThrough(host: SequencerHost, slot: SeqSlot): void {
  if (slot.shamanClimaxAt === undefined || slot.t < slot.shamanClimaxAt) return;
  slot.shamanClimaxAt = undefined;
  if (slot.abilityId.startsWith('primal_exaltation')) {
    const at = host.anchorOf(slot.casterId, 0.5);
    if (at) shamanPrimalCeremony(host, slot, at, true);
    return;
  }
  const shape = slot.spec.shaman;
  if (!shape) return;
  if (shape.action === 'strike' || shape.action === 'jolt' || shape.action === 'bolt') {
    const at = host.anchorOf(slot.targetId, 0.55);
    if (at) shamanContactTail(host, slot, at);
    return;
  }
  if (slot.abilityId !== 'earthquake' || shape.action !== 'field') return;
  const [color, hot] = colors(slot);
  const at = { x: slot.ix, y: slot.iy, z: slot.iz };
  shamanElementalContact(host, slot, shape, at, color, hot);
  if (slot.shamanThunderSpend) {
    slot.shamanThunderSpend = false;
    drawShamanThunderVent(
      host,
      at.x,
      host.groundYAt(at.x, at.z) + 0.85,
      at.z,
      Math.min(4.8, shape.radius),
      slot.tier,
    );
  }
  host.countPrimitive(slot.abilityId, 8);
  host.shakeAt(at.x, at.y, at.z, 0.1, true);
  host.abilityAudio?.('impact', slot.spec.palette, shape.weight, at.x, at.y, at.z, {
    abilityId: slot.abilityId,
    archetype: slot.spec.archetype,
    lite: slot.tier > 0,
  });
}
