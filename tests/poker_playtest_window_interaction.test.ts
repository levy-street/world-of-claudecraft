// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { PokerAction } from '../src/sim/poker/engine';
import type { PokerClientPort, PokerClientState } from '../src/sim/poker/protocol';
import { PokerPlaytestWindow } from '../src/ui/poker_playtest_window';

function state(): PokerClientState {
  return {
    connected: true,
    enabled: true,
    tables: [],
    names: { 1: 'Alice', 2: 'Bob' },
    error: null,
    snapshot: {
      tableId: 'low-stakes-1',
      revision: 3,
      viewerSeat: 0,
      watching: false,
      turnDeadlineMs: null,
      config: {
        id: 'low-stakes-1',
        numSeats: 2,
        smallBlind: 10,
        bigBlind: 20,
        minBuyIn: 2_000,
        maxBuyIn: 2_000,
      },
      handNumber: 1,
      actionSequence: 2,
      button: 0,
      street: 'preflop',
      actorSeat: 0,
      communityCards: [],
      pots: [{ amount: 30, eligibleSeats: [0, 1] }],
      seats: [
        {
          seat: 0,
          playerId: 1,
          stack: 1_990,
          bet: 10,
          committed: 10,
          inHand: true,
          folded: false,
          allIn: false,
          holeCards: [],
        },
        {
          seat: 1,
          playerId: 2,
          stack: 1_980,
          bet: 20,
          committed: 20,
          inHand: true,
          folded: false,
          allIn: false,
          holeCards: null,
        },
      ],
      legalActions: {
        actions: ['fold', 'call', 'raise'],
        toCall: 10,
        minTo: 40,
        maxTo: 2_000,
      },
      lastResult: null,
    },
  };
}

describe('poker playtest window interaction', () => {
  it('forwards Call and Raise clicks through the live DOM binding', () => {
    document.body.innerHTML = '<button id=launcher></button><section id=poker></section>';
    const current = state();
    const act = vi.fn<(action: PokerAction) => void>();
    const client: PokerClientPort = {
      pokerState: () => current,
      subscribe: () => () => {},
      requestTables: vi.fn(),
      join: vi.fn(),
      watch: vi.fn(),
      stopWatching: vi.fn(),
      rebuy: vi.fn(),
      leave: vi.fn(),
      act,
    };
    const root = document.querySelector<HTMLElement>('#poker');
    const launcher = document.querySelector<HTMLElement>('#launcher');
    if (!root || !launcher) throw new Error('Poker test DOM is missing');
    const pokerWindow = new PokerPlaytestWindow({
      root: () => root,
      launcher: () => launcher,
      client,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      sound: { deal: () => {}, turn: () => {} },
      now: () => 0,
      schedule: () => 1,
      cancelSchedule: () => {},
    });

    pokerWindow.toggle();
    root.querySelector<HTMLButtonElement>('[data-focus-key=action-call]')?.click();
    const wager = root.querySelector<HTMLInputElement>(`[data-wager='2']`);
    if (wager) wager.value = '80';
    root.querySelector<HTMLButtonElement>('[data-focus-key=action-raise]')?.click();

    expect(act).toHaveBeenNthCalledWith(1, { type: 'call' });
    expect(act).toHaveBeenNthCalledWith(2, { type: 'raise', to: 80 });
  });

  it('preserves an in-progress Raise amount across the turn timer repaint', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    document.body.innerHTML = '<button id=launcher></button><section id=poker></section>';
    const current = state();
    if (!current.snapshot) throw new Error('Poker test snapshot is missing');
    current.snapshot.turnDeadlineMs = 10_000;
    let scheduled: (() => void) | null = null;
    const client: PokerClientPort = {
      pokerState: () => current,
      subscribe: () => () => {},
      requestTables: vi.fn(),
      join: vi.fn(),
      watch: vi.fn(),
      stopWatching: vi.fn(),
      rebuy: vi.fn(),
      leave: vi.fn(),
      act: vi.fn(),
    };
    const root = document.querySelector<HTMLElement>('#poker');
    const launcher = document.querySelector<HTMLElement>('#launcher');
    if (!root || !launcher) throw new Error('Poker test DOM is missing');
    const pokerWindow = new PokerPlaytestWindow({
      root: () => root,
      launcher: () => launcher,
      client,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      sound: { deal: () => {}, turn: () => {} },
      now: () => 0,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
      cancelSchedule: () => {},
    });

    pokerWindow.toggle();
    const wager = root.querySelector<HTMLInputElement>(`[data-focus-key='wager-raise']`);
    if (!wager) throw new Error('Raise wager input is missing');
    wager.focus();
    wager.value = '80';
    wager.dispatchEvent(new Event('input', { bubbles: true }));
    const timerCallback = scheduled as (() => void) | null;
    if (!timerCallback) throw new Error('Turn timer was not scheduled');
    timerCallback();

    const repainted = root.querySelector<HTMLInputElement>(`[data-focus-key='wager-raise']`);
    expect(repainted?.value).toBe('80');
    expect(document.activeElement).toBe(repainted);
  });
});
