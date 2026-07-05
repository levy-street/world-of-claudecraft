import type { LootRollChoice, LootRollPrompt } from '../sim/types';

export interface IWorldLoot {
  submitLootRoll(rollId: number, choice: LootRollChoice): void;
  // Open need-greed rolls the local player may still answer; lets the HUD
  // reconcile prompts from authoritative state so a missed event is recoverable.
  activeLootRolls(): LootRollPrompt[];
}
