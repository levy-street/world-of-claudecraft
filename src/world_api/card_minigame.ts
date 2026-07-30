// IWorldCardMinigame: the Card Duel minigame facet (src/sim/social/card_duel.ts,
// src/sim/social/card_duel_queue.ts). Poll-style read state (like duel_arena.ts)
// plus a small action surface (like interaction.ts).

import type { CardMinigameInfo } from '../sim/social/card_duel';

export type { CardMinigameInfo };

export interface IWorldCardMinigame {
  cardMinigameInfo: CardMinigameInfo;
  joinCardDuelQueue(): void;
  leaveCardDuelQueue(): void;
  playCardInDuel(cardValue: number): void;
  // Forfeits a LIVE match (distinct from leaveCardDuelQueue, which only
  // leaves the matchmaking queue): the player-issuable escape from a match
  // whose opponent has gone idle.
  forfeitCardDuel(): void;
}
