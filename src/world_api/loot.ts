import type { LootRollChoice, LootRollGroupStatus, LootRollPrompt } from '../sim/types';

export interface IWorldLoot {
  submitLootRoll(rollId: number, choice: LootRollChoice): void;
  // Open need-greed rolls the local player may still answer; lets the HUD
  // reconcile prompts from authoritative state so a missed event is recoverable.
  activeLootRolls(): LootRollPrompt[];
  // Group-visible view of every open need-greed roll in the local player's
  // party: each candidate's choice (need/greed/pass, or null while undecided),
  // never the roll number. Drives the per-player choice strip on the roll frame
  // and keeps the frame up after the local player has answered.
  lootRollGroupStatus(): LootRollGroupStatus[];
}
