export interface IWorldInteraction {
  interact(): void;
  lootCorpse(id: number): void;
  autoLoot(id: number): void;
  // `components`: the player's per-corpse focus pick (#1142), which tagged
  // component(s) to extract. Omitted, empty, or covering every tagged
  // component all spread the harvest across every tag (pre-#1142 behavior).
  harvestCorpse(id: number, components?: string[]): void;
  pickUpObject(id: number): void;
}
