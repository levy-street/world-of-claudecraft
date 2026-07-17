// Pure view-core for the Card Duel minigame window (Card Master NPC).
//
// Maps the IWorldCardMinigame read surface (cardMinigameInfo) to a render
// model: DOM/i18n-free, so tests/card_duel_view.test.ts drives it directly
// with a plain CardMinigameInfo object (the shape is identical whether it
// came from Sim or ClientWorld, since it is data, not a per-host structure).
// The thin consumer (card_duel_window.ts) paints this.

import type { CardMinigameInfo } from '../world_api';

export interface CardDuelHandCardView {
  value: number;
  playable: boolean;
}

// 'unavailable': no other player is present to ever pair against (the
// offline Sim's single-player case). The window hides/disables the Join
// affordance and shows a clear message instead of letting the player queue
// forever with no feedback.
export type CardDuelWindowState = 'idle' | 'unavailable' | 'queued' | 'inMatch';

export interface CardDuelViewModel {
  state: CardDuelWindowState;
  hand: CardDuelHandCardView[];
  deckCount: number;
  discardCount: number;
  opponentName: string;
  myRounds: number;
  opponentRounds: number;
  waitingOnOpponent: boolean;
}

/** Build the structured Card Duel view from the live IWorld snapshot. */
export function buildCardDuelView(info: CardMinigameInfo): CardDuelViewModel {
  if (!info.match) {
    return {
      state: info.queued ? 'queued' : info.available ? 'idle' : 'unavailable',
      hand: [],
      deckCount: 0,
      discardCount: 0,
      opponentName: '',
      myRounds: 0,
      opponentRounds: 0,
      waitingOnOpponent: false,
    };
  }
  const m = info.match;
  return {
    state: 'inMatch',
    hand: m.hand.map((value) => ({ value, playable: !m.waitingOnOpponent })),
    deckCount: m.deckCount,
    discardCount: m.discardCount,
    opponentName: m.opponent.name,
    myRounds: m.myRounds,
    opponentRounds: m.opponentRounds,
    waitingOnOpponent: m.waitingOnOpponent,
  };
}
