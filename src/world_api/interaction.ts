export interface IWorldInteraction {
  interact(): void;
  lootCorpse(id: number): void;
  autoLoot(id: number): void;
  pickUpObject(id: number): void;
  /** The Envoys' Hall oath: swear a faction via one of its races. One-shot,
   *  level-gated, and proximity-checked server-side (src/sim/envoys.ts). */
  chooseRace(race: string): void;
  /** Ferry/Envoy passage between the Landing and the sworn realm hub. */
  travel(): void;
}
