export interface IWorldInteraction {
  interact(): void;
  lootCorpse(id: number): void;
  pickUpObject(id: number): void;
}
