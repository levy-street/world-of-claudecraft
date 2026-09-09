import type { SeqSlot, SequencerHost } from './sequencer';

const hand = { x: 0, y: 0, z: 0 };

/** Preparation belongs to the worn equipment. These self casts never claim
 * an enemy hit, a blood payment, or a new activation on aura reconciliation. */
export function drawWarriorReadinessCast(
  host: SequencerHost,
  slot: SeqSlot,
  beat: number,
): boolean {
  const id = slot.abilityId;
  const sanguine = id === 'sanguine_aura';
  const wide = id === 'sweeping_strikes';
  const fury = id === 'berserker_stance';
  const guarded = id === 'defensive_stance';
  if (!sanguine && !wide && !fury && !guarded && id !== 'battle_stance') return false;
  if (slot.physicalSecondary) return true;
  if (sanguine) {
    const at = host.handPoint?.(slot.casterId, 0, hand);
    if (!at) return true;
    // Baked sprite filaments gather at the hilt and release along the blade.
    // They add fine liquid detail without recoloring the body for the buff.
    host.bakedAt?.(
      'warrior_power',
      at.x,
      at.y,
      at.z,
      beat === 0 ? 1.7 : 2.1,
      0x9b1830,
      0xff7869,
      beat === 0 ? 0.25 : 0.3,
      0,
      0,
      (host.facingAt?.(slot.casterId) ?? 0) + Math.PI / 2,
      beat === 0,
      0.3,
      0.7,
    );
    host.weaponTrail?.(slot.casterId, 0, beat === 0 ? 0x9b2333 : 0xff8c70, 0.1, 0.28);
    host.countPrimitive(id, 2);
    return true;
  }
  const color = wide ? 0xe9d8b1 : fury ? 0xc44336 : guarded ? 0xa8cedc : 0xe3e8df;
  host.weaponTrail?.(
    slot.casterId,
    guarded ? 1 : 0,
    color,
    wide ? 0.14 : 0.065,
    wide ? 0.35 : 0.22,
  );
  if (fury) host.weaponTrail?.(slot.casterId, 1, color, 0.065, 0.22);
  host.countPrimitive(id, fury ? 2 : 1);
  return true;
}
