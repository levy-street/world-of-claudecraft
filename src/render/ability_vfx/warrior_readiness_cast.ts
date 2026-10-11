import type { SeqSlot, SequencerHost } from './sequencer';
import { warriorEquipmentPrepare } from './warrior_equipment_prepare';
import { drawWarriorWideningCast } from './warrior_widening_arc';

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
    for (const handIndex of [0, 1] as const) {
      if (!(host.isWeaponHand?.(slot.casterId, handIndex) ?? handIndex === 0)) continue;
      const at = host.handPoint?.(slot.casterId, handIndex, hand);
      if (!at) continue;
      // Baked sprite filaments gather at the hilt and release along the blade.
      // They add fine liquid detail without recoloring the body for the buff.
      host.bakedAt?.(
        'warrior_fervor',
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
      host.weaponTrail?.(slot.casterId, handIndex, beat === 0 ? 0x9b2333 : 0xff8c70, 0.1, 0.28);
      host.countPrimitive(id, 2);
    }
    return true;
  }
  const color = wide ? 0xdce6ea : fury ? 0xc44336 : guarded ? 0xa8cedc : 0xe3e8df;
  host.weaponTrail?.(
    slot.casterId,
    guarded ? 1 : 0,
    color,
    wide ? 0.34 : 0.065,
    wide ? 0.35 : 0.22,
  );
  if (fury) host.weaponTrail?.(slot.casterId, 1, color, 0.065, 0.22);
  const reflection =
    beat === 0 && (wide || guarded) ? warriorEquipmentPrepare(host, slot.casterId, guarded) : 0;
  const flourish = wide ? drawWarriorWideningCast(host, slot, beat) : 0;
  host.countPrimitive(id, (fury ? 2 : 1) + reflection + flourish);
  return true;
}
