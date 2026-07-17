import { describe, expect, it } from 'vitest';
import { buildCardDuelView } from '../src/ui/card_duel_view';
import type { CardMinigameInfo } from '../src/world_api';

describe('card_duel_view', () => {
  it('idle state when not queued and not in a match', () => {
    const info: CardMinigameInfo = { queued: false, available: true, match: null };
    const view = buildCardDuelView(info);
    expect(view.state).toBe('idle');
    expect(view.hand).toEqual([]);
  });

  it('queued state when waiting in the matchmaking queue', () => {
    const info: CardMinigameInfo = { queued: true, available: true, match: null };
    const view = buildCardDuelView(info);
    expect(view.state).toBe('queued');
  });

  it('unavailable state when no other player exists to ever pair against (offline)', () => {
    const info: CardMinigameInfo = { queued: false, available: false, match: null };
    const view = buildCardDuelView(info);
    expect(view.state).toBe('unavailable');
  });

  it('queued wins over unavailable if somehow both (queued takes priority)', () => {
    const info: CardMinigameInfo = { queued: true, available: false, match: null };
    const view = buildCardDuelView(info);
    expect(view.state).toBe('queued');
  });

  it('inMatch state maps hand, scores, and opponent from a live match', () => {
    const info: CardMinigameInfo = {
      queued: false,
      available: true,
      match: {
        opponent: { pid: 7, name: 'Aki' },
        hand: [3, 8, 1, 5],
        deckCount: 12,
        discardCount: 2,
        myRounds: 1,
        opponentRounds: 0,
        waitingOnOpponent: false,
      },
    };
    const view = buildCardDuelView(info);
    expect(view.state).toBe('inMatch');
    expect(view.opponentName).toBe('Aki');
    expect(view.myRounds).toBe(1);
    expect(view.opponentRounds).toBe(0);
    expect(view.deckCount).toBe(12);
    expect(view.discardCount).toBe(2);
    expect(view.hand).toEqual([
      { value: 3, playable: true },
      { value: 8, playable: true },
      { value: 1, playable: true },
      { value: 5, playable: true },
    ]);
  });

  it('marks every hand card unplayable while waiting on the opponent', () => {
    const info: CardMinigameInfo = {
      queued: false,
      available: true,
      match: {
        opponent: { pid: 7, name: 'Aki' },
        hand: [4, 9],
        deckCount: 10,
        discardCount: 4,
        myRounds: 0,
        opponentRounds: 1,
        waitingOnOpponent: true,
      },
    };
    const view = buildCardDuelView(info);
    expect(view.waitingOnOpponent).toBe(true);
    expect(view.hand.every((c) => !c.playable)).toBe(true);
  });

  it('same input produces the same output regardless of Sim vs ClientWorld origin (data is host-agnostic)', () => {
    const info: CardMinigameInfo = {
      queued: false,
      available: true,
      match: {
        opponent: { pid: 2, name: 'Bo' },
        hand: [6],
        deckCount: 15,
        discardCount: 4,
        myRounds: 0,
        opponentRounds: 0,
        waitingOnOpponent: false,
      },
    };
    // Both Sim.cardMinigameInfo and ClientWorld.cardMinigameInfo produce this
    // exact plain-data shape, so a single stub covers both hosts.
    expect(buildCardDuelView(info)).toEqual(buildCardDuelView({ ...info }));
  });
});
