// Wire decode for a full identity record's worn-copy fields, for the inspect
// window: the terse `eqi` (the per-slot public payload trim,
// server/equipped_instance_wire.ts) and `eqh` (the worn tracked copies'
// public history, server/equipped_history_wire.ts), folded into the one
// Entity.equippedInstances mirror the offline Sim also fills, so the inspect
// window reads a copy's `provenance` the same way on both hosts.
//
// Both keys are sparse like `eq`: an absent key on a full record means no
// worn piece carries one, so the mirror resets rather than keeping stale
// slots. Every `eqi` payload is deep-cloned (its rolled.stats map must never
// alias wire-parsed JSON a later message could mutate). Every `eqh` record
// is judged by the persisted shape (isLoadableItemProvenance) and re-projected
// through publicProvenanceView, so a malformed row is DROPPED rather than
// rendered and even a regressed server can never put a character id or a
// parent guid into the mirror. A tracked copy with no public payload (a
// plain looted epic) arrives in `eqh` alone and gets a slot of its own.
//
// DOM-free and ClientWorld-free (the wire-decode sibling idiom,
// src/net/CLAUDE.md).

import { isLoadableItemProvenance, publicProvenanceView } from '../sim/item_provenance';
import { cloneItemInstancePayload, type EquipSlot, type ItemInstancePayload } from '../sim/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeEquippedInstancesWire(
  eqi: unknown,
  eqh: unknown,
): Partial<Record<EquipSlot, ItemInstancePayload>> {
  const slots = new Map<string, ItemInstancePayload>();
  for (const [slot, inst] of Object.entries((eqi ?? {}) as Record<string, ItemInstancePayload>)) {
    slots.set(slot, cloneItemInstancePayload(inst));
  }
  if (isRecord(eqh)) {
    for (const [slot, record] of Object.entries(eqh)) {
      if (!isLoadableItemProvenance(record)) continue;
      slots.set(slot, { ...(slots.get(slot) ?? {}), provenance: publicProvenanceView(record) });
    }
  }
  // fromEntries defines own data properties, so a hostile `__proto__` slot
  // key can never reach the mirror's prototype.
  return Object.fromEntries(slots) as Partial<Record<EquipSlot, ItemInstancePayload>>;
}
