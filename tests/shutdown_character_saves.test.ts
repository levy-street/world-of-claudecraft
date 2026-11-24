import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // bank_ledger.ts (imported via game.ts recordBankOp) reads this at call time.
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import {
  releaseCharacterLease,
  saveCharacterAndMarketState,
  saveCharacterState,
} from '../server/db';
import { type ClientSession, GameServer } from '../server/game';

function join(game: GameServer, id = 1): ClientSession {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };
  const session = game.join(ws as any, id, id, `Player${id}`, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shutdown character persistence', () => {
  it('rejects shutdown when a connected character cannot save', async () => {
    const game = new GameServer();
    join(game);
    vi.mocked(saveCharacterState).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(game.saveAll('shutdown')).rejects.toThrow();
  });

  it('a duplicate departure waits for the original final save', async () => {
    const game = new GameServer();
    const session = join(game);
    let finish!: (value: boolean) => void;
    vi.spyOn(game, 'saveCharacter').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = game.leave(session, 'logout');
    let duplicateDone = false;
    const duplicate = game.leave(session, 'socket closed').then(() => {
      duplicateDone = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(duplicateDone).toBe(false);
    expect(releaseCharacterLease).not.toHaveBeenCalled();
    finish(true);
    await Promise.all([first, duplicate]);
    expect(releaseCharacterLease).toHaveBeenCalledTimes(1);
  });
});

describe('shutdown departure drain', () => {
  it('waits through a retry sleep even when the character FIFO is empty', async () => {
    const game = new GameServer();
    const player = join(game);
    game.sim.meta(player.pid)!.copper = 1277;
    let durableCopper = 1200;
    vi.mocked(saveCharacterAndMarketState)
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockImplementationOnce(async (_id, _level, state) => {
        durableCopper = state.copper;
        return true;
      });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    const departure = game.leave(player, 'logout');
    await vi.advanceTimersByTimeAsync(0);
    expect(game.clients.size).toBe(0);
    expect(game.characterSaveQueues.pendingKeys()).toBe(0);
    game.beginShutdown();
    let completed = false;
    const shutdown = game.saveForShutdown().then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(completed).toBe(false);
    expect(durableCopper).toBe(1200);
    expect(releaseCharacterLease).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([departure, shutdown]);
    expect(durableCopper).toBe(1277);
    expect(releaseCharacterLease).toHaveBeenCalledTimes(1);
  });

  it('drains a departure that starts during the connected-character save', async () => {
    const game = new GameServer();
    const player = join(game);
    let finishSave!: (saved: boolean) => void;
    const save = vi
      .spyOn(game, 'saveCharacter')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          }),
      )
      .mockResolvedValue(true);
    game.beginShutdown();
    const shutdown = game.saveForShutdown();
    await new Promise((resolve) => setImmediate(resolve));
    const departure = game.leave(player, 'logout');
    finishSave(true);
    await Promise.all([shutdown, departure]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(game.hasSessionForCharacter(player.characterId)).toBe(false);
    expect(releaseCharacterLease).toHaveBeenCalledTimes(1);
  });

  it('retains unsaved departing state when shutdown retries are exhausted', async () => {
    const game = new GameServer();
    const player = join(game);
    vi.spyOn(game, 'saveCharacter').mockRejectedValue(new Error('database offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    game.beginShutdown();
    const departure = expect(game.leave(player, 'logout')).rejects.toThrow('database offline');
    const shutdown = expect(game.saveForShutdown()).rejects.toThrow('did not finish durably');
    await vi.advanceTimersByTimeAsync(3750);
    await Promise.all([departure, shutdown]);
    expect(game.sim.entities.has(player.pid)).toBe(true);
    expect(game.hasSessionForCharacter(player.characterId)).toBe(true);
    expect(releaseCharacterLease).not.toHaveBeenCalled();
  });

  it('does not cancel a save when the departure wait times out', async () => {
    const game = new GameServer();
    const player = join(game);
    let finishSave!: (saved: boolean) => void;
    vi.spyOn(game, 'saveCharacter').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    vi.useFakeTimers();
    game.beginShutdown();
    const departure = game.leave(player, 'logout');
    const shutdown = expect(game.saveForShutdown()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20_000);
    await shutdown;
    expect(game.sim.entities.has(player.pid)).toBe(true);
    expect(releaseCharacterLease).not.toHaveBeenCalled();
    finishSave(true);
    await departure;
    expect(releaseCharacterLease).toHaveBeenCalledTimes(1);
  });

  it('seals late departures and socket callbacks after the final save', async () => {
    const game = new GameServer();
    const player = join(game);
    const save = vi.spyOn(game, 'saveCharacter').mockResolvedValue(true);
    game.beginShutdown();
    await game.saveForShutdown();
    await game.leave(player, 'late logout');
    expect(game.socketClosed(player, player.ws)).toBe(false);
    expect(player.left).toBe(false);
    expect(player.linkdead).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(releaseCharacterLease).not.toHaveBeenCalled();
    expect(() => join(game, 2)).toThrow('temporarily unavailable');
  });
});

it('still saves connected players after an earlier ordinary departure exhausted retries', async () => {
  const game = new GameServer();
  const departed = join(game, 1);
  const connected = join(game, 2);
  const save = vi.spyOn(game, 'saveCharacter').mockImplementation(async (session) => {
    if (session === departed) throw new Error('old failure');
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
  const leave = game.leave(departed, 'logout');
  await vi.advanceTimersByTimeAsync(3750);
  await leave;
  expect(game.hasSessionForCharacter(departed.characterId)).toBe(false);
  game.beginShutdown();
  await expect(game.saveForShutdown()).rejects.toThrow('did not finish durably');
  expect(save.mock.calls.some(([session]) => session === connected)).toBe(true);
});
