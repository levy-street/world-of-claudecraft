import type { QuestProgress, QuestState } from '../sim/types';

export interface IWorldQuests {
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  /** Statues this character has bowed to — gates the gargoyle toll-quests. */
  bowedGargoyles: Set<string>;
  questState(questId: string): QuestState;
  acceptQuest(questId: string): void;
  turnInQuest(questId: string): void;
  abandonQuest(questId: string): void;
  acceptLinkedQuest(questId: string, fromPid: number): void;
  // Morwen's repeatable Deepdream brew: server-validated (witch proximity,
  // recipe quest done, 2/2/2 parts in bags) — exchanges the parts for a
  // Deepdream Draught outside the one-shot quest system.
  brewDraught(): void;
  /** Bow to the mirror-guardian gargoyle you are standing beside (gossip). */
  bowToGargoyle(): void;
  /** Challenge the gargoyle: the statue wakes as a level-99 boss (gossip). */
  wakeGargoyle(): void;
}
