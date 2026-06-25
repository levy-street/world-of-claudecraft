// Aldrin Club membership as mirrored to the client (read-only display). The
// server is authoritative; the HUD uses this only to gate cosmetic/convenience/
// access perks and render status. It never confers power.
export interface AldrinMembershipPublic {
  since: string;
  until: string;
  lastMethod: string;
  autoRenew: boolean;
}

export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  aldrinClub?: AldrinMembershipPublic | null;
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
