import type { SimEvent } from '../../sim/types';
import { isBloodlettingRecovery } from '../../warrior_recovery_core';
import { type WarriorFuryStateAura, warriorFuryStateKind } from '../warrior_fury_state_core';
import type { SeqSlot, SequencerHost } from './sequencer';

const anchor = { x: 0, y: 0, z: 0 };

/** Match actual snapshot identity, not all Warrior buffs or an approximate name. */
export function isWarriorFuryAuraEvent(
  event: Extract<SimEvent, { type: 'aura' }>,
  target: { auras: readonly (WarriorFuryStateAura & { name?: string })[] } | undefined,
): boolean {
  if (!event.gained || !target) return false;
  return target.auras.some((a) => a.name === event.name && warriorFuryStateKind(a) !== null);
}
/** Visible recovery follows effective healing, independent of the separate
 * weapon strike outcome. No enemy blood transfer or health gain is invented. */
export function drawBloodlettingRecovery(
  host: SequencerHost,
  event: Extract<SimEvent, { type: 'heal2' }>,
  maxHp: number,
): boolean {
  if (!isBloodlettingRecovery(event)) return false;
  if (!Number.isFinite(event.amount) || event.amount <= 0) return true;
  const at = host.anchorOf(event.targetId, 0.53, anchor);
  if (!at) return true;
  const fraction = Number.isFinite(maxHp) && maxHp > 0 ? event.amount / maxHp : 0;
  const strong = fraction >= 0.12;
  const facing = host.facingAt?.(event.targetId) ?? 0,
    dx = Math.sin(facing),
    dz = Math.cos(facing);
  for (const side of [-1, 1])
    host.pathRibbon(
      strong ? 0xff6480 : 0xc52d4b,
      strong ? 0.16 : 0.1,
      0.3,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1),
            across = side * (1.15 - u * 0.9),
            forward = 0.2 + Math.sin(u * Math.PI) * 0.13;
          points[i].set(
            at.x + dz * across + dx * forward,
            at.y - 0.18 + u * 0.28,
            at.z - dx * across + dz * forward,
          );
        }
        return points.length;
      },
      true,
      null,
      false,
      0,
    );
  host.bakedAt?.(
    'warrior_power',
    at.x,
    at.y,
    at.z,
    strong ? 3.5 : 2.3,
    0x9f1838,
    strong ? 0xff9e9a : 0xe04b60,
    0.3,
    0,
    0.4,
    0,
    true,
    0,
    1.6,
  );
  host.countPrimitive('bloodthirst', 3);
  return true;
}

/** A blood-forged brace, not healing on activation. Inward seams meet the
 * native clench and leave the live defensive stitching to its aura owner. */
export function drawFuriousMending(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  if (slot.abilityId !== 'furious_mending') return false;
  if (beat !== 0 || slot.physicalSecondary) return true;
  const at = host.anchorOf(slot.casterId, 0.52, anchor);
  if (!at) return true;
  const facing = host.facingAt?.(slot.casterId) ?? 0,
    dx = Math.sin(facing),
    dz = Math.cos(facing);
  const layers = slot.tier > 0 ? 1 : 3;
  for (let layer = 0; layer < layers; layer++)
    for (const side of [-1, 1]) {
      host.pathRibbon(
        layer === 0 ? 0xff5975 : 0x9c1638,
        layer === 0 ? 0.32 : 0.2,
        0.38,
        (points) => {
          for (let i = 0; i < points.length; i++) {
            const u = i / (points.length - 1),
              across = side * (2.4 - u * 2.12),
              forward = 0.15 + Math.sin(u * Math.PI) * 0.22;
            points[i].set(
              at.x + dz * across + dx * forward,
              at.y + (layer - 1) * 0.32 + Math.sin(u * Math.PI) * 0.45,
              at.z - dx * across + dz * forward,
            );
          }
          return points.length;
        },
        true,
        null,
        false,
        layer === 0 ? 1 : 0,
      );
    }
  for (const side of [-1, 1])
    host.bakedAt?.(
      'warrior_power',
      at.x + dz * side * 0.35,
      at.y,
      at.z - dx * side * 0.35,
      5.2,
      0x9f1838,
      0xff8b9f,
      0.38,
      0,
      0.95,
      facing,
      true,
      side * 0.45,
      1.4,
    );
  host.countPrimitive('furious_mending', layers * 2 + 2);
  return true;
}
