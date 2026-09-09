// Shared collection-window routing for keyboard and controller input.
export interface CollectionActionsHost {
  toggleDeeds(): void;
  toggleProfessions(): void;
  toggleReliquary(): void;
  toggleCosmetics(): void;
  toggleHarvestJournal(): void;
  togglePerfecting(): void;
  toggleLootExplorer(): void;
}
const COLLECTION_ACTIONS = {
  deeds: 'toggleDeeds',
  professions: 'toggleProfessions',
  reliquary: 'toggleReliquary',
  cosmetics: 'toggleCosmetics',
  harvestJournal: 'toggleHarvestJournal',
  perfecting: 'togglePerfecting',
  lootExplorer: 'toggleLootExplorer',
} as const;
export function dispatchCollectionAction(action: string, host: CollectionActionsHost): boolean {
  if (!Object.hasOwn(COLLECTION_ACTIONS, action)) return false;
  host[COLLECTION_ACTIONS[action as keyof typeof COLLECTION_ACTIONS]]();
  return true;
}
