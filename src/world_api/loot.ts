import type {
  LootRollChoice,
  LootRollGroupStatus,
  LootRollPrompt,
  MasterLootPrompt,
} from '../sim/types';

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
  // Curate-phase master-loot assignments the local player is the MASTER LOOTER
  // of, with the roll's current candidate roster. The master-looter arm of the
  // same reconcile surface as activeLootRolls: it lives here rather than on
  // IWorldParty (where its `assignMasterLoot` command sibling sits) because the
  // HUD reads all three together, every frame, in one loot-roll controller.
  // Returns an empty list for a candidate who is not the master looter, which is
  // what keeps a curate-phase roll off everyone else's screen as a prompt.
  activeMasterLootRolls(): MasterLootPrompt[];
}
