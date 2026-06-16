import { ITEMS } from '../../sim/data';
import type { AttachDef, VisualDef } from './manifest';

function isWeaponAttach(att: AttachDef): boolean {
  if (att.gripRef) return false;
  return att.url.includes('/weapons/');
}

/** Resolve hand attachments, swapping in an item-specific glb when equipped. */
export function resolveWeaponAttachments(def: VisualDef, mainhandId: string | null, standardMaterials = true): AttachDef[] {
  const base = standardMaterials ? (def.attach ?? []) : [];
  if (!mainhandId) return base;
  const model = ITEMS[mainhandId]?.weaponModel;
  if (!model) return base;
  const epicUrl = `models/weapons/${model}.glb`;
  return base.map((att) => (isWeaponAttach(att) ? { ...att, url: epicUrl } : att));
}

/** Every item-specific weapon glb that must be preloaded. */
export function itemWeaponModelUrls(): string[] {
  const urls = new Set<string>();
  for (const item of Object.values(ITEMS)) {
    if (item.weaponModel) urls.add(`models/weapons/${item.weaponModel}.glb`);
  }
  return [...urls];
}
