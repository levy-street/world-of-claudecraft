export interface IWorldInteraction {
  interact(): void;
  lootCorpse(id: number): void;
  autoLoot(id: number): void;
  harvestCorpse(id: number): void;
  pickUpObject(id: number): void;
}
