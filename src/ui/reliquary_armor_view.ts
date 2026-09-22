// Pure, DOM-free view core for the Reliquary "Armor Cosmetics" panel: the
// acting character's Inner Crucible set progress and the reward skin's claim
// state, from plain ownership lookups. i18n-free like every UI_PURE_CORES
// entry (reliquary_armor_panel.ts resolves the labels and paints).

import {
  CRUCIBLE_CLASS_SETS,
  type CrucibleSkinDef,
  crucibleSkinForClass,
} from '../sim/content/crucible_skins';
import type { PlayerClass } from '../sim/types';

export type ArmorClaimState = 'locked' | 'claimable' | 'claimed';

export interface ArmorPieceView {
  itemId: string;
  owned: boolean;
}

export interface ArmorSetView {
  setId: string;
  pieces: ArmorPieceView[];
  owned: number;
  total: number;
  complete: boolean;
}

export interface ArmorPanelModel {
  playerClass: PlayerClass;
  skin: CrucibleSkinDef | null;
  sets: ArmorSetView[];
  state: ArmorClaimState;
}

export function armorPanelModel(input: {
  playerClass: PlayerClass;
  /** Owned-item lookup: the collection log unioned with the account ledger. */
  has: (itemId: string) => boolean;
  /** Account-wide full-body skin entitlements (AccountCosmetics.founderSkinIds). */
  ownedSkinIds: readonly string[];
}): ArmorPanelModel {
  const skin = crucibleSkinForClass(input.playerClass);
  const sets = (CRUCIBLE_CLASS_SETS[input.playerClass] ?? []).map((set): ArmorSetView => {
    const pieces = set.pieceIds.map((itemId) => ({ itemId, owned: input.has(itemId) }));
    const owned = pieces.filter((p) => p.owned).length;
    return {
      setId: set.setId,
      pieces,
      owned,
      total: pieces.length,
      complete: owned === pieces.length,
    };
  });
  const claimed = skin !== null && input.ownedSkinIds.includes(skin.catalog);
  const state: ArmorClaimState = claimed
    ? 'claimed'
    : skin !== null && sets.some((s) => s.complete)
      ? 'claimable'
      : 'locked';
  return { playerClass: input.playerClass, skin, sets, state };
}
