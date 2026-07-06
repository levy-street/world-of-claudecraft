export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Prestige cosmetics bought from the roaming merchant Logol, account-bound
  // (docs/prd/woc/logol-merchant.md). Cosmetic-only; the sim never reads them.
  // Optional so existing cosmetics literals keep compiling.
  logolWareIds?: string[];
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  changeSkin(skin: number, catalog?: 'class' | 'mech'): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
}
