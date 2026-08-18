import {
  accountCosmeticsWithWornMechChroma,
  wornMechChromaId,
} from '../src/sim/mech_chroma_ownership';
import type { SkinCatalog } from '../src/sim/types';
import type { AccountCosmetics } from '../src/world_api';

export const EMPTY_ACCOUNT_COSMETICS: AccountCosmetics = {
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [],
  weaponSkinLoadout: {},
};

export function reconcileWornMechChromaForJoin(args: {
  accountCosmetics: AccountCosmetics;
  catalog: SkinCatalog | undefined;
  skin: number;
  remember: (cosmetics: AccountCosmetics) => AccountCosmetics;
  grant: (chromaId: string) => Promise<AccountCosmetics>;
  updateLive: (cosmetics: AccountCosmetics) => void;
}): AccountCosmetics {
  const wornChromaId = wornMechChromaId(args.catalog, args.skin);
  const accountCosmetics = args.remember(
    accountCosmeticsWithWornMechChroma(args.accountCosmetics, args.catalog, args.skin),
  );
  if (wornChromaId && !args.accountCosmetics.mechChromaIds.includes(wornChromaId)) {
    void args
      .grant(wornChromaId)
      .then(args.updateLive)
      .catch((err) => console.error('failed to reconcile worn account mech chroma:', err));
  }
  return accountCosmetics;
}
