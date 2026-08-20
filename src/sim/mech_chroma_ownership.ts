import type { AccountCosmetics } from '../world_api';
import { mechChromaForSkin } from './content/skins';
import type { SkinCatalog } from './types';

export function wornMechChromaId(catalog: SkinCatalog | undefined, skin: number): string | null {
  if (catalog !== 'mech') return null;
  return mechChromaForSkin(skin)?.id ?? null;
}

export function accountCosmeticsWithWornMechChroma(
  cosmetics: AccountCosmetics,
  catalog: SkinCatalog | undefined,
  skin: number,
): AccountCosmetics {
  const chromaId = wornMechChromaId(catalog, skin);
  if (!chromaId || cosmetics.mechChromaIds.includes(chromaId)) return cosmetics;
  return { ...cosmetics, mechChromaIds: [...cosmetics.mechChromaIds, chromaId] };
}
