import type { CharacterState } from './sim';
import type { InvSlot } from './types';

export const REMOVED_ZONE1_QUEST_IDS = [
  'q_mogger_tracks',
  'q_brightwood_thinning',
  'q_brightwood_monarch',
  'q_ledger_first_duty',
  'q_ledger_teeth',
  'q_ledger_reedwater',
  'q_ledger_silk',
  'q_ledger_brood',
  'q_ledger_deepvermin',
  'q_ledger_toll',
  'q_ledger_vigil',
  'q_ledger_great_boar',
  'q_ledger_outlaw_captain',
] as const;

export const RETIRED_ZONE1_ITEM_IDS = ['bramblehide_jerkin', 'monarch_crown_helm'] as const;

export const REMOVED_ZONE1_OBJECTIVE_ITEM_IDS = ['glade_pelt', 'monarch_heart'] as const;

export const REMOVED_ZONE1_MOB_IDS = [
  'elder_bristleback',
  'sableweb_matriarch',
  'sableweb_hatchling',
  'brightwood_hare',
  'glade_fox',
  'spotted_fawn',
  'meadow_crane',
  'thornpelt_badger',
  'dawnmane_doe',
  'bramble_lynx',
  'brightwood_stag',
  'grovetusk_boar',
  'sunhide_bear',
  'brightwood_monarch',
] as const;

const REMOVED_QUESTS: ReadonlySet<string> = new Set(REMOVED_ZONE1_QUEST_IDS);
const REMOVED_OBJECTIVE_ITEMS: ReadonlySet<string> = new Set(REMOVED_ZONE1_OBJECTIVE_ITEM_IDS);

function keepItem(slot: InvSlot): boolean {
  return !REMOVED_OBJECTIVE_ITEMS.has(slot.itemId);
}

function sameSlots(a: readonly InvSlot[] | undefined, b: readonly InvSlot[] | undefined): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  return (a ?? []).every((slot, index) => {
    const other = b?.[index];
    return other?.itemId === slot.itemId && other.count === slot.count;
  });
}

export function sanitizeRemovedZone1Content(state: CharacterState): {
  state: CharacterState;
  changed: boolean;
} {
  const questLog = state.questLog
    .filter((quest) => !REMOVED_QUESTS.has(quest.questId))
    .map((quest) => ({
      questId: quest.questId,
      counts: [...quest.counts],
      state: quest.state,
      ...(quest.selection === undefined ? {} : { selection: quest.selection }),
      ...(quest.resolvedCounts === undefined ? {} : { resolvedCounts: [...quest.resolvedCounts] }),
    }));
  const questsDone = state.questsDone.filter((questId) => !REMOVED_QUESTS.has(questId));
  const inventory = state.inventory.filter(keepItem).map((slot) => ({ ...slot }));
  const vendorBuyback = state.vendorBuyback?.filter(keepItem).map((slot) => ({ ...slot }));

  const changed =
    questLog.length !== state.questLog.length ||
    questsDone.length !== state.questsDone.length ||
    !sameSlots(inventory, state.inventory) ||
    !sameSlots(vendorBuyback, state.vendorBuyback);

  return {
    changed,
    state: {
      ...state,
      inventory,
      vendorBuyback,
      questLog,
      questsDone,
    },
  };
}
