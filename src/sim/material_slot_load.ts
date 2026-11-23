// Material provenance is validated before legacy load coercions can erase it.
import { ITEMS } from './data';
import { isChargeBearingPayload } from './item_instance_merge';
import { isMaterialItemId } from './material_ids';
import { normalizeMaterialStack } from './material_stack';
import { skullBagLoadValid } from './pvp/skull_bag';
import { isStackProvenanceItemId, stackProvenanceItemIds } from './stack_provenance_ids';
import { cloneInvSlot, type InvSlot } from './types';

const LOAD_REFUSED = 'material source state is invalid; refusing character load';
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function slotMaterialIds(slot: InvSlot): ReadonlySet<string> | null {
  if (isStackProvenanceItemId(slot.itemId)) return stackProvenanceItemIds();
  if (slot.materialSources === undefined) return null;
  // A removed material remains recoverable. A known non-material must not
  // acquire a material marker that bypasses its equipment load rules.
  if (Object.hasOwn(ITEMS, slot.itemId)) throw new Error(LOAD_REFUSED);
  return new Set([slot.itemId]);
}

export function validateMaterialSlotSourcesOnLoad(raw: unknown): void {
  if (!record(raw) || raw.materialSources === undefined) return;
  if (typeof raw.itemId !== 'string' || raw.itemId === '') throw new Error(LOAD_REFUSED);
  if (raw.instance !== undefined && !record(raw.instance)) throw new Error(LOAD_REFUSED);
  const slot = raw as unknown as InvSlot;
  if (isChargeBearingPayload(slot.instance) && slot.count !== 1) throw new Error(LOAD_REFUSED);
  const ids = slotMaterialIds(slot);
  if (!ids || !normalizeMaterialStack(slot, ids).ok) throw new Error(LOAD_REFUSED);
}

/** Exact sources/counts first; existing payload sanitizers still run afterwards. */
export function validateCharacterMaterialSourcesOnLoad(raw: unknown): void {
  if (!record(raw)) return;
  const bank = record(raw.bank) ? raw.bank : undefined;
  const vault = record(raw.vault) ? raw.vault : undefined;
  for (const slots of [raw.inventory, raw.vendorBuyback, bank?.inventory, vault?.special]) {
    if (Array.isArray(slots)) for (const slot of slots) validateMaterialSlotSourcesOnLoad(slot);
  }
  // The Skull Bag holds trophy skulls by the same per-unit provenance.
  if (!skullBagLoadValid(raw.skullBag)) throw new Error(LOAD_REFUSED);
}

/** Material stacks may contain tolerated legacy excess; packing applies caps on grants. */
export function preservesMaterialCountOnLoad(
  slot: Pick<InvSlot, 'itemId' | 'materialSources' | 'instance'>,
): boolean {
  if (slot.materialSources === undefined && isChargeBearingPayload(slot.instance)) return false;
  return isMaterialItemId(slot.itemId) || slot.materialSources !== undefined;
}

/** Called after the existing instance/recipe sanitizers, on owned row data. */
export function normalizeLoadedMaterialSlot(slot: InvSlot): InvSlot {
  validateMaterialSlotSourcesOnLoad(slot);
  return savedMaterialSlot(slot);
}

/** Canonical, detached save projection. One source validation/projection per
 * slot; unlike load, saving needs no pre-sanitizer pass over the composition.
 * Legacy unsigned units are explicit unknown sources, never invented makers. */
export function savedMaterialSlot(slot: InvSlot): InvSlot {
  const ids = slotMaterialIds(slot);
  if (!ids) return cloneInvSlot(slot);
  if (slot.instance !== undefined && !record(slot.instance)) throw new Error(LOAD_REFUSED);
  if (isChargeBearingPayload(slot.instance) && slot.count !== 1) throw new Error(LOAD_REFUSED);
  const normalized = normalizeMaterialStack(slot, ids);
  if (!normalized.ok) throw new Error(LOAD_REFUSED);
  return normalized.value;
}
