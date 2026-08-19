import { describe, expect, it, vi } from 'vitest';
import type { PokerWireSnapshot } from '../../server/poker_service';
import {
  createPokerWireController,
  type PokerWireDeps,
  type PokerWireSession,
  pokerErrorCode,
} from '../../server/poker_wire';

interface TestSession extends PokerWireSession {
  sent: unknown[];
}

function session(characterId: number, name = `Player ${characterId}`): TestSession {
  return {
    accountId: characterId + 100,
    characterId,
    name,
    linkdead: false,
    left: false,
    sent: [],
  };
}

function snapshot(viewerId: number): PokerWireSnapshot {
  const seat = (playerId: number) => ({
    seat: playerId - 1,
    playerId,
    stack: 2_000,
    bet: 0,
    committed: 0,
    inHand: true,
    folded: false,
    allIn: false,
    holeCards: viewerId === playerId ? [{ rank: 'A', suit: 'spades' }] : null,
  });
  return {
    tableId: 'low-stakes-1',
    config: {
      id: 'low-stakes-1',
      numSeats: 2,
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 2_000,
      maxBuyIn: 2_000,
    },
    handNumber: 1,
    actionSequence: 0,
    button: 0,
    street: 'preflop',
    actorSeat: 0,
    communityCards: [],
    pots: [],
    seats: [seat(1), seat(2)],
    legalActions:
      viewerId === 1 ? { actions: ['fold', 'call'], toCall: 10, minTo: null, maxTo: null } : null,
    lastResult: null,
    revision: 1,
    viewerSeat: viewerId - 1,
    watching: false,
    turnDeadlineMs: 30_000,
  } as PokerWireSnapshot;
}

function requiredSession(sessions: Map<number, TestSession>, characterId: number): TestSession {
  const found = sessions.get(characterId);
  if (!found) throw new Error('Missing test session');
  return found;
}

function setup(overrides: Partial<PokerWireDeps<TestSession>['service']> = {}) {
  const sessions = new Map<number, TestSession>([[1, session(1, 'Ada')]]);
  sessions.set(2, session(2, 'Lin'));
  const service = {
    act: vi.fn(async () => undefined),
    buyIn: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    leaveTable: vi.fn(async () => undefined),
    listTables: vi.fn(async () => []),
    rebuy: vi.fn(async () => undefined),
    snapshot: vi.fn((_: string, viewerId: number | null) => snapshot(viewerId ?? 0)),
    stopWatching: vi.fn(async () => undefined),
    tableForCharacter: vi.fn(() => null),
    viewerIds: vi.fn(() => [1, 2]),
    watchTable: vi.fn(async () => undefined),
    ...overrides,
  } as PokerWireDeps<TestSession>['service'];
  const controller = createPokerWireController<TestSession>({
    enabled: () => true,
    send: (target, message) => target.sent.push(message),
    service,
    sessionForCharacter: (characterId) => sessions.get(characterId) ?? null,
  });
  return { controller, service, sessions };
}

describe('poker wire controller', () => {
  it('strictly rejects malformed table, seat, hand, sequence, and action fields', async () => {
    const { controller, service, sessions } = setup();
    const player = requiredSession(sessions, 1);

    await controller.join(player, { tableId: '../secret', seatIndex: 0 });
    await controller.join(player, { tableId: 'low-stakes-1', seatIndex: 6 });
    await controller.action(player, {
      tableId: 'low-stakes-1',
      handNumber: -1,
      actionSequence: 0,
      action: { type: 'call' },
    });
    await controller.action(player, {
      tableId: 'low-stakes-1',
      handNumber: 1,
      actionSequence: 0,
      action: { type: 'raise', to: 1.5 },
    });

    expect(service.buyIn).not.toHaveBeenCalled();
    expect(service.act).not.toHaveBeenCalled();
    expect(player.sent).toEqual([
      { t: 'poker_error', code: 'table_not_found' },
      { t: 'poker_error', code: 'seat_conflict' },
      { t: 'poker_error', code: 'invalid_action' },
      { t: 'poker_error', code: 'invalid_action' },
    ]);
  });

  it('allows only one in-flight poker request per character', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, service, sessions } = setup({
      listTables: vi.fn(() => blocked.then(() => [])),
    });
    const player = requiredSession(sessions, 1);

    const first = controller.list(player);
    await controller.rebuy(player, { tableId: 'low-stakes-1' });
    expect(service.rebuy).not.toHaveBeenCalled();
    expect(player.sent).toContainEqual({ t: 'poker_error', code: 'busy' });

    release();
    await first;
  });

  it('derives action authority from the authenticated session', async () => {
    const { controller, service, sessions } = setup();
    const player = requiredSession(sessions, 1);

    await controller.action(player, {
      tableId: 'low-stakes-1',
      handNumber: 1,
      actionSequence: 0,
      action: { type: 'call' },
      playerId: 2,
      accountId: 999,
      balance: 999_999,
    });

    expect(service.act).toHaveBeenCalledWith({
      tableId: 'low-stakes-1',
      accountId: player.accountId,
      characterId: player.characterId,
      handNumber: 1,
      actionSequence: 0,
      action: { type: 'call' },
    });
  });

  it('builds one safe snapshot per viewer and reuses it for that viewer result', () => {
    const { controller, service, sessions } = setup();

    controller.broadcast('low-stakes-1', true);

    expect(service.snapshot).toHaveBeenCalledTimes(2);
    expect(service.snapshot).toHaveBeenNthCalledWith(1, 'low-stakes-1', 1);
    expect(service.snapshot).toHaveBeenNthCalledWith(2, 'low-stakes-1', 2);
    const firstSnapshot = (requiredSession(sessions, 1).sent[0] as { snapshot: PokerWireSnapshot })
      .snapshot;
    const secondSnapshot = (requiredSession(sessions, 2).sent[0] as { snapshot: PokerWireSnapshot })
      .snapshot;
    expect(firstSnapshot.seats[0]?.holeCards).not.toBeNull();
    expect(firstSnapshot.seats[1]?.holeCards).toBeNull();
    expect(secondSnapshot.seats[0]?.holeCards).toBeNull();
    expect(secondSnapshot.seats[1]?.holeCards).not.toBeNull();
    expect((requiredSession(sessions, 1).sent[1] as { result: unknown }).result).toBe(
      firstSnapshot.lastResult,
    );
  });

  it('keeps service failures on stable public error codes', () => {
    expect(pokerErrorCode(new Error('Poker action sequence is stale'))).toBe('stale_action');
    expect(pokerErrorCode(new Error('Character is already watching a table'))).toBe(
      'watch_conflict',
    );
    expect(pokerErrorCode(new Error('Rebuy is only allowed between hands'))).toBe(
      'rebuy_not_allowed',
    );
  });
});
