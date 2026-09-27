import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorCrushContact } from './warrior_crush_contact';
import { warriorImpactFan } from './warrior_impact_fan';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 },
  shield = { x: 0, y: 0, z: 0 },
  normal = { x: 0, y: 0, z: 0 };
/** One loaded steel collision. The actual native shield drives the performance;
 * the segmented silhouette enlarges its contact without implying an area hit. */
export function drawWarriorShield(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'shield_slam') return false;
  const profile = meleeImpactProfile(slot.abilityId);
  if (!profile || beat > 0 || slot.targetId === slot.casterId) return true;
  const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
  if (outcome === 0) return true;
  const from = host.anchorOf(slot.casterId, 0.55, source);
  const at = host.anchorOf(slot.targetId, meleeContactHeight(profile, 0), target);
  if (!from || !at) return true;
  // The outward transfer belongs to this impact, even if the scratch anchor
  // is reused for another fighter before the ribbon's next rendered frame.
  const impactX = at.x,
    impactY = at.y,
    impactZ = at.z;
  const sampled = host.weaponFace?.(slot.casterId, 1, shield, normal) === true;
  const angle = sampled ? Math.atan2(normal.x, normal.z) : Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  // Start at the equipped buckler face. Missing-equipment hosts keep the
  // original near-body fallback, capped for overlapping actors.
  const shift = Math.min(1.05, Math.hypot(at.x - from.x, at.z - from.z) * 0.6);
  const x = sampled ? shield.x : at.x - dx * shift,
    y = sampled ? shield.y : at.y,
    z = sampled ? shield.z : at.z - dz * shift;
  const solid = host.crestAt?.(
    x,
    y,
    z,
    1.4,
    1.4,
    0x667782,
    0xdde5e9,
    'shield_contact',
    angle,
    0.18,
  );
  // A cold/full carrier still retains the complete directional primary shape.
  for (let side = -1; side <= 1; side += 2) {
    host.pathRibbon(
      0xe3ebef,
      solid === true ? 0.095 : 0.18,
      0.13,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const t = i / (points.length - 1);
          const across =
            side *
            (t < 0.2
              ? (t / 0.2) * 1.32
              : t < 0.5
                ? 1.32 + ((t - 0.2) / 0.3) * 0.15
                : ((1.0 - t) / 0.5) * 1.47);
          points[i].set(x + dz * across, y + 1.65 - t * 3.18, z - dx * across);
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
    );
  }
  // A braced shield transfers a compressed thrust to the recipient. The two
  // open shoulders leave the real buckler visible through the larger fracture.
  if (sampled) {
    for (const side of [-1, 1])
      host.pathRibbon(
        0xc9d5dd,
        0.14,
        0.18,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1);
            const bow = Math.sin(u * Math.PI) * side * 0.45;
            points[i].set(
              x + (impactX - x) * u + dz * bow,
              y + (impactY - y) * u,
              z + (impactZ - z) * u - dx * bow,
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
  }
  if (outcome === 2) {
    host.flipbookAt(at.x, at.y, at.z, 2.4, 0xc5d9e1, 'contact_crush', 1.35, 0.2);
    host.countPrimitive(slot.abilityId, sampled ? 6 : 4);
    return true;
  }
  const incoming = Math.atan2(at.x - from.x, at.z - from.z);
  let count =
    (sampled ? 5 : 3) +
    warriorCrushContact(
      host,
      slot.targetId,
      at,
      meleeContactHeight(profile, 0),
      incoming,
      8.2,
      slot.tier,
      undefined,
      0.075,
      1.45,
    );
  const sx = Math.sin(incoming),
    sz = Math.cos(incoming);
  const receiving = { x: at.x - sx * 0.28, y: at.y, z: at.z - sz * 0.28 };
  if (
    host.bakedAt?.(
      'warrior_crush',
      receiving.x,
      receiving.y,
      receiving.z,
      14.2,
      0xe0e9ef,
      0xffffff,
      0.24,
      0,
      0,
      incoming,
      false,
      0.08,
      1.65,
    ) !== false &&
    host.bakedAt
  )
    count++;
  count += warriorImpactFan(host, receiving, incoming, 0.08, 3.2, 0x9bafb9);
  if (slot.tier === 0) {
    const sx = Math.sin(incoming),
      sz = Math.cos(incoming);
    // The same thirteen chips split into unequal outward shoulder jets.
    // They expand from the victim, with no additional area-damage boundary.
    for (const side of [-1, 1])
      host.fragmentsAt?.(
        'metal_splinter',
        at.x + sz * side * 0.22,
        at.y + 0.16,
        at.z - sx * side * 0.22,
        0xb9c6cd,
        side < 0 ? 6 : 7,
        1.6,
        sx + sz * side * 1.2,
        sz - sx * side * 1.2,
        0.3,
        true,
      );
    host.burstAt(at.x, at.y, at.z, 0xe2ecf2, 19, 1.2, 'sparks', 0.16, 0.02);
    const floor = host.groundYAt(from.x, from.z);
    host.bakedAt?.(
      'shout_dust',
      from.x,
      floor + 0.08,
      from.z,
      3.2,
      0xafa18b,
      0xc5b49c,
      0.3,
      0,
      0,
      angle,
    );
    host.fragmentsAt?.(
      'stone_chip',
      from.x,
      floor + 0.09,
      from.z,
      0x857c70,
      7,
      0.55,
      -dx,
      -dz,
      0.25,
    );
    count += 5;
  }
  host.contact?.(
    slot.casterId,
    slot.targetId,
    'physical-crush',
    profile.force * 1.2,
    slot.abilityId,
    0,
  );
  if (!slot.physicalSecondary) host.shakeAt(at.x, at.y, at.z, 0.29, true);
  host.pulseLight(slot.targetId, slot.spec.palette, 1.35, 0.06, 2.8);
  host.countPrimitive(slot.abilityId, count);
  return true;
}
