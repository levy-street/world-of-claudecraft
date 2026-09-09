import type { SimEvent } from '../../sim/types';
import { WARRIOR_CONTROL_AUDIO } from '../../warrior_control_audio';
import type { AbilityVfxFx } from './fx';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  target = { x: 0, y: 0, z: 0 };

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
      punch ? 0xc5d7e1 : 0xe8d0a8,
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
  if (!armor) {
    // Depth-tested contact belongs on the receiving jaw surface. A centre
    // anchor puts the authored sprite's bright core inside the skull.
    const surface = Math.max(0.18, Math.min(0.65, (at.y - host.groundYAt(at.x, at.z)) * 0.24));
    at.x -= dx * surface;
    at.z -= dz * surface;
  }
  if (armor) {
    host.flipbookAt(at.x, at.y, at.z, 2.7, 0xe5c9a0, 'contact_cut', 1.25, 0.22);
    for (const side of [-1, 1])
      host.fragmentsAt?.(
        'metal_splinter',
        at.x + dz * side * 0.2,
        at.y,
        at.z - dx * side * 0.2,
        0xc7b9a0,
        tier === 0 ? 8 : 4,
        0.8,
        dx * 0.2 + dz * side,
        dz * 0.2 - dx * side,
        0.34,
      );
  } else {
    // A compact jaw compression earns its fractured spell core only after
    // the real lockout. No blood, flinch or extra stun stars.
    host.flipbookAt(at.x, at.y, at.z, 2.4, 0xc6e6f5, 'contact_crush', 1.3, 0.23, 0, 0.65);
    for (const side of [-1, 1])
      host.pathRibbon(
        0xa5d5f2,
        0.12,
        0.23,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              across = side * (0.12 + u * 0.75);
            points[i].set(
              at.x + dz * across,
              at.y + Math.sin(u * Math.PI) * 0.28 - u * 0.4,
              at.z - dx * across,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        1,
      );
    if (tier === 0) host.burstAt(at.x, at.y, at.z, 0xc6e6f5, 9, 0.55, 'sparks', 0.2);
  }
  host.abilityAudio?.('impact', 'physical', armor ? 0.8 : 0.6, at.x, at.y, at.z, {
    lite: tier > 0,
    abilityId,
    sample: WARRIOR_CONTROL_AUDIO[abilityId].impacts[0],
  });
  host.countPrimitive(abilityId, armor ? 3 : tier === 0 ? 4 : 3);
  return true;
}
