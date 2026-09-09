// Premium signatures stay separate from recorded gatherers.
import { canonicalMaterialComposition, isPremiumMaterialSource } from './material_sources';
import type { InvSlot } from './types';

export function holdsMaterialSignature(
  inventory: readonly InvSlot[],
  itemId: string,
  signer?: string,
): boolean {
  return inventory.some((slot) => {
    if (slot.itemId !== itemId || slot.count <= 0) return false;
    if (slot.materialSources === undefined) {
      return signer === undefined ? !!slot.instance?.signer : slot.instance?.signer === signer;
    }
    if (slot.instance?.signer !== undefined) return false;
    const read = canonicalMaterialComposition(slot.materialSources, slot.count);
    return (
      read.ok &&
      read.value.some(({ source }) =>
        signer === undefined ? isPremiumMaterialSource(source) : source.signer === signer,
      )
    );
  });
}

/** Mutates only the owned slot's composition; historical gatherer snapshots stay intact. */
export function rekeyMaterialSignature(slot: InvSlot, oldName: string, newName: string): boolean {
  if (slot.materialSources === undefined) return false;
  const read = canonicalMaterialComposition(slot.materialSources, slot.count);
  if (!read.ok || slot.instance?.signer !== undefined) {
    throw new Error('refusing signer rename for invalid material sources');
  }
  if (!read.value.some(({ source }) => source.signer === oldName)) return false;
  const renamed = canonicalMaterialComposition(
    read.value.map(({ source, count }) => ({
      source: source.signer === oldName ? { ...source, signer: newName } : source,
      count,
    })),
    slot.count,
  );
  if (!renamed.ok) throw new Error('refusing invalid material signer rename');
  slot.materialSources = renamed.value;
  return true;
}
