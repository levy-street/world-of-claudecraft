import { WARRIOR_CONTROL_AUDIO } from '../../game/warrior_control_audio_core';
import type { SimEvent } from '../../sim/types';
import type { AbilityVfxFx } from './fx';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 },
  base = { x: 0, y: 0, z: 0 };

/** These zero-damage casts show the attempted action only. Armor fragments and
 * spell disruption require an authoritative aura event, not a predicted hit. */
export function drawWarriorControlAttempt(
  host: SequencerHost,
  slot: SeqSlot,
  beat: number,
): boolean {
  const punch = slot.abilityId === 'pummel';
  if (!punch && slot.abilityId !== 'sunder_armor') return false;
  if (beat || slot.physicalSecondary) return true;
  const from = host.anchorOf(slot.casterId, punch ? 0.68 : 0.52, source);
  const at = host.anchorOf(slot.targetId, punch ? 0.7 : 0.52, target);
  if (!from || !at) return true;
  const direction = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(direction),
    dz = Math.cos(direction);
  const reach = Math.min(1.2, Math.hypot(at.x - from.x, at.z - from.z) * 0.6);
  for (const side of [-1, 1]) {
    host.pathRibbon(
      punch ? 0xc5d7e1 : 0xd1dbe2,
      punch ? 0.09 : 0.12,
      0.17,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const front = 0.32 + u * reach;
          const across =
            side * (punch ? 0.09 + Math.sin(u * Math.PI) * 0.16 : 0.12) + (punch ? 0 : u * 0.52);
          points[i].set(
            from.x + dx * front + dz * across,
            from.y + (punch ? Math.sin(u * Math.PI) * 0.08 : u * 0.55),
            from.z + dz * front - dx * across,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
    );
  }
  host.countPrimitive(slot.abilityId, 2);
  return true;
}

/** Armor Shear has zero damage. Refresh metadata, including a Warrior refresh
 * of an existing shared Rogue armor aura, identifies the successful peel. */
export function drawWarriorControlAura(
  host: Pick<AbilityVfxFx, 'queueWarriorControl'>,
  ev: Extract<SimEvent, { type: 'aura' }>,
  tier: number,
  auras: readonly { id: string; kind: string; remaining?: number }[] = [],
): boolean {
  const armor = ev.abilityId === 'sunder_armor';
  const punch = ev.abilityId === 'pummel' || ev.abilityId === 'pummel_lockout';
  const slow = ev.abilityId === 'hamstring' || ev.abilityId === 'hamstring_slow';
  if (!armor && !punch && !slow) return false;
  const kind =
    ev.auraKind ??
    (armor ? 'sunder' : ev.abilityId === 'pummel_lockout' ? 'lockout' : undefined) ??
    auras.find(
      (aura) =>
        (aura.remaining ?? 0) > 0 &&
        (armor ? aura.kind === 'sunder' : aura.id === 'pummel_lockout'),
    )?.kind;
  if (!ev.gained || slow || (armor ? kind !== 'sunder' : kind !== 'lockout')) return true;
  host.queueWarriorControl(
    armor ? 'sunder_armor' : 'pummel',
    ev.sourceId ?? ev.targetId,
    ev.targetId,
    tier,
  );
  return true;
}

export function drawWarriorControlSuccess(
  host: SequencerHost,
  abilityId: 'sunder_armor' | 'pummel',
  casterId: number,
  targetId: number,
  tier: number,
): boolean {
  const armor = abilityId === 'sunder_armor';
  const at = host.anchorOf(targetId, armor ? 0.52 : 0.78, target);
  if (!at) return true;
  const from = host.anchorOf(casterId, 0.55, source);
  const direction = from ? Math.atan2(at.x - from.x, at.z - from.z) : 0;
  const dx = Math.sin(direction),
    dz = Math.cos(direction);
  // The receiving silhouette follows body height, including raised platforms
  // and large enemies. Neither impact may begin inside the body centre.
  const feet = host.anchorOf(targetId, 0, base);
  const bodyHeight = feet ? (at.y - feet.y) / (armor ? 0.52 : 0.78) : 2;
  const surface = Math.max(0.18, Math.min(0.65, bodyHeight * (armor ? 0.14 : 0.19)));
  at.x -= dx * surface;
  at.z -= dz * surface;
  if (armor) {
    host.flipbookAt(at.x, at.y, at.z, 7.2, 0xb5d5ed, 'warrior_steel_flash', 3.7, 0.27, 0.42, 0.9);
    for (const side of [-1, 1])
      host.fragmentsAt?.(
        'metal_splinter',
        at.x + dz * side * 0.2,
        at.y,
        at.z - dx * side * 0.2,
        side < 0 ? 0x788c9a : 0xd2dce4,
        tier === 0 ? (side < 0 ? 6 : 10) : 4,
        side < 0 ? 0.65 : 0.95,
        dx * 0.2 + dz * side,
        dz * 0.2 - dx * side,
        side < 0 ? 0.22 : 0.29,
      );
  } else {
    // A compact jaw compression earns its fractured spell core only after
    // the real lockout. No blood, flinch or extra stun stars.
    host.flipbookAt(at.x, at.y, at.z, 7, 0xb1d3e8, 'warrior_crush_flash', 4.2, 0.25, 0, 0.85);
    for (const side of [-1, 1])
      host.pathRibbon(
        side < 0 ? 0x8fa9bc : 0xd8e5ed,
        0.095,
        side < 0 ? 0.15 : 0.18,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              across = side * (0.14 + u * (side < 0 ? 0.85 : 0.68));
            const fracture = u < 0.42 ? u * 0.24 : 0.1 - (u - 0.42) * 0.48;
            points[i].set(at.x + dz * across, at.y + fracture * side, at.z - dx * across);
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
      );
    if (tier === 0) host.burstAt(at.x, at.y, at.z, 0xd5e3ec, 9, 0.55, 'sparks', 0.1, 0.018);
  }
  host.abilityAudio?.('impact', 'physical', armor ? 0.8 : 0.6, at.x, at.y, at.z, {
    lite: tier > 0,
    abilityId,
    sample: WARRIOR_CONTROL_AUDIO[abilityId].impacts[0],
  });
  host.countPrimitive(abilityId, armor ? 3 : tier === 0 ? 4 : 3);
  return true;
}
