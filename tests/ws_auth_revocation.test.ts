import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

// Persistence and unrelated referral refreshes are synthetic. Admission,
// disconnectAccount, session creation, and gameplay dispatch use production code.
vi.mock('../server/referral_game_adapter', () => ({
  ReferralGameAdapter: class {
    cards = { isBusy: () => false };
    attach() {}
    detach() {}
    observe() {}
    command() {}
    async stop() {}
  },
}));
vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(async (sql: string) => ({
      // The unrelated social read requires its synthetic schema to be ready.
      rows: sql.includes('FROM pg_index') && sql.includes('indisready') ? [{ ready: 1 }] : [],
      rowCount: 0,
    })),
  },
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
}));

import { accountAdmissionsFor } from '../server/account_admission';
import type { CharacterRow } from '../server/db';
import { GameServer } from '../server/game';
import { isConnectionRefused } from '../server/ip_block';
import { createWsAuth, type WsAuthDeps } from '../server/ws_auth';
import { bufferHandshakeMessages } from '../server/ws_buffer';
import { freshAccountLedger } from '../src/sim/account_ledger';
import { ONLINE_WORLD_AUTH_TYPE } from '../src/world_api';

const ACCOUNT_ID = 101;
const CHARACTER_ID = 701;
const TOKEN = 'synthetic-revocation-test-token';
const authFrame = JSON.stringify({
  t: ONLINE_WORLD_AUTH_TYPE,
  token: TOKEN,
  character: CHARACTER_ID,
});

// The shared bare_client fakeWs has no event listeners or close transition.
// This handshake fixture needs both to exercise the installed message handler.
class HandshakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  readonly sent: Array<{ t: string; error?: string }> = [];
  send(payload: string): void {
    this.sent.push(JSON.parse(payload));
  }
  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const games: GameServer[] = [];

function setup() {
  const game = new GameServer();
  games.push(game);
  const socket = new HandshakeSocket();
  let tokenValid = true;
  const character: CharacterRow = {
    id: CHARACTER_ID,
    account_id: ACCOUNT_ID,
    name: 'RevocationFixture',
    class: 'warrior',
    level: 1,
    state: null,
    is_gm: false,
    force_rename: false,
  };
  const accountAndScopeForToken = vi.fn<WsAuthDeps['accountAndScopeForToken']>(async (token) =>
    tokenValid && token === TOKEN ? { accountId: ACCOUNT_ID, scope: 'full' } : null,
  );
  const getCharacter = vi.fn<WsAuthDeps['getCharacter']>(async (accountId, characterId) =>
    accountId === ACCOUNT_ID && characterId === CHARACTER_ID ? character : null,
  );
  const deps: WsAuthDeps = {
    game,
    accountAndScopeForToken,
    getCharacter,
    moderationStatusForAccount: async () => ({
      locked: false,
      banned: false,
      suspendedUntil: null,
      reason: '',
      message: '',
      chatMutedUntil: null,
      chatStrikes: 0,
    }),
    chatMuteStatusForAccount: async () => ({ mutedUntil: null, reason: '' }),
    adminRolesForAccount: async () => null,
    permissionsForRoles: () => new Set(),
    metaRequestUserData: () => ({}),
    metaEventSourceUrl: () => undefined,
    loadAccountCosmetics: async () => ({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
      mountSkinIds: [],
    }),
    loadAccountLedger: async () => freshAccountLedger(),
    loadAccountMountItems: async () => [],
    acquireCharacterLease: vi.fn(async () => true),
    releaseCharacterLease: vi.fn(async () => {}),
    bankBonusForAccount: async () => ({ bonusSlots: 0, sources: [] }),
    isConnectionRefused,
    bufferHandshakeMessages,
    requestMetadata: () => ({ ip: '192.0.2.1', userAgent: 'local-regression-test' }),
    maxWsPerIpHard: 20,
    maxPlayersPerRealm: 100,
  };
  const auth = createWsAuth(deps);
  return {
    game,
    deps,
    socket,
    character,
    getCharacter,
    accountAndScopeForToken,
    revokeToken: () => {
      // Model the committed DELETE of auth_tokens, before the reset handler
      // invokes the real disconnect hook. No SQL/HTTP reset is claimed here.
      tokenValid = false;
    },
    authenticate: (connection = socket) =>
      auth.authenticateWebSocket(connection.asWebSocket(), authFrame, {} as IncomingMessage),
  };
}

function sendForward(socket: HandshakeSocket): void {
  socket.emit('message', JSON.stringify({ t: 'input', seq: 1, mi: { forward: true }, facing: 0 }));
}

beforeEach(() => {
  vi.spyOn(console, 'error');
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('Unexpected network connection in local auth regression');
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected fetch in local auth regression');
    }),
  );
});

afterEach(async () => {
  try {
    for (const game of games.splice(0)) {
      expect(accountAdmissionsFor(game).activeAccounts).toBe(0);
      for (const session of [...game.clients.values()]) await game.leave(session, 'test cleanup');
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(console.error).not.toHaveBeenCalled();
    expect(Socket.prototype.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe('credential revocation during WebSocket admission', () => {
  it('admits a valid token and accepts forward input through the socket handler', async () => {
    const { authenticate, game, socket, accountAndScopeForToken } = setup();
    await authenticate();

    expect(game.clients.size).toBe(1);
    const session = [...game.clients.values()][0];
    expect(session.accountId).toBe(ACCOUNT_ID);
    expect(session.characterId).toBe(CHARACTER_ID);
    expect(socket.sent.some((frame) => frame.t === 'hello')).toBe(true);
    expect(game.sim.meta(session.pid)?.moveInput.forward).toBe(false);
    sendForward(socket);
    expect(game.sim.meta(session.pid)?.moveInput.forward).toBe(true);
    expect(accountAndScopeForToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a token revoked before authentication without loading a character', async () => {
    const { authenticate, game, socket, revokeToken, getCharacter } = setup();
    revokeToken();
    await authenticate();

    expect(game.clients.size).toBe(0);
    expect(getCharacter).not.toHaveBeenCalled();
    expect(socket.sent).toContainEqual({ t: 'error', error: 'not authenticated' });
    expect(socket.readyState).not.toBe(socket.OPEN);
  });

  it('rejects a pending login when its token is revoked and the account disconnected', async () => {
    const fixture = setup();
    const { game, socket, getCharacter, character, accountAndScopeForToken } = fixture;
    const characterReadStarted = deferred();
    const finishCharacterRead = deferred();
    getCharacter.mockImplementationOnce(async (accountId, characterId) => {
      expect(accountId).toBe(ACCOUNT_ID);
      expect(characterId).toBe(CHARACTER_ID);
      characterReadStarted.resolve();
      await finishCharacterRead.promise;
      return character;
    });

    const pending = fixture.authenticate();
    try {
      await characterReadStarted.promise;
      expect(accountAndScopeForToken).toHaveBeenCalledWith(TOKEN);
      expect(game.clients.size).toBe(0);
      fixture.revokeToken();
      game.disconnectAccount(ACCOUNT_ID, 'Credentials changed');
      expect(await accountAndScopeForToken(TOKEN)).toBeNull();
    } finally {
      finishCharacterRead.resolve();
      await pending;
    }

    // The initial auth read plus the test's explicit revoked-token check above.
    // A known-invalidated probe must not spend another database lookup.
    expect(accountAndScopeForToken).toHaveBeenCalledTimes(2);
    sendForward(socket);
    const sessions = [...game.clients.values()];
    expect({
      sessions: sessions.length,
      acceptedForwardInput: sessions.some((s) => game.sim.meta(s.pid)?.moveInput.forward),
    }).toEqual({ sessions: 0, acceptedForwardInput: false });
    expect(socket.sent.some((frame) => frame.t === 'hello')).toBe(false);
    expect(socket.readyState).not.toBe(socket.OPEN);
  });

  it.each([1, 2])('rejects a stale token snapshot returned by lookup %i', async (lookup) => {
    const fixture = setup();
    const { game, socket, accountAndScopeForToken } = fixture;
    const queryStarted = deferred();
    const finishQuery = deferred();
    const read = accountAndScopeForToken.getMockImplementation();
    if (!read) throw new Error('Missing token fixture');
    let count = 0;
    accountAndScopeForToken.mockImplementation(async (token) => {
      const snapshot = await read(token);
      if (++count === lookup) {
        queryStarted.resolve();
        await finishQuery.promise;
      }
      return snapshot;
    });
    const pending = fixture.authenticate();
    try {
      await queryStarted.promise;
      fixture.revokeToken();
      game.disconnectAccount(ACCOUNT_ID, 'Credentials changed');
    } finally {
      finishQuery.resolve();
      await pending;
    }
    expect(game.clients.size).toBe(0);
    expect(socket.sent).toContainEqual({ t: 'error', error: 'not authenticated' });
    expect(socket.readyState).not.toBe(socket.OPEN);
  });

  it.each([
    null,
    { accountId: ACCOUNT_ID, scope: 'read' as const },
    { accountId: ACCOUNT_ID + 1, scope: 'full' as const },
  ])('releases the fresh lease when final token authority is %j', async (authority) => {
    const { authenticate, deps, game, socket, accountAndScopeForToken } = setup();
    accountAndScopeForToken
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID, scope: 'full' })
      .mockResolvedValueOnce(authority);
    await authenticate();
    expect(game.clients.size).toBe(0);
    const nonce = vi.mocked(deps.acquireCharacterLease).mock.calls[0][2];
    expect(deps.releaseCharacterLease).toHaveBeenCalledExactlyOnceWith(CHARACTER_ID, nonce);
    expect(socket.sent).toContainEqual({ t: 'error', error: 'not authenticated' });
  });

  it('releases the lease and admission capacity when the final lookup throws', async () => {
    const { deps, game, accountAndScopeForToken } = setup();
    deps.maxPlayersPerRealm = 1;
    // createWsAuth snapshots configuration, so use a fresh factory for this cap.
    const auth = createWsAuth(deps);
    const attempt = (socket: HandshakeSocket) =>
      auth.authenticateWebSocket(socket.asWebSocket(), authFrame, {} as IncomingMessage);
    accountAndScopeForToken
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID, scope: 'full' })
      .mockRejectedValueOnce(new Error('synthetic token lookup failure'));
    await expect(attempt(new HandshakeSocket())).rejects.toThrow('synthetic token lookup failure');
    expect(game.clients.size).toBe(0);
    const nonce = vi.mocked(deps.acquireCharacterLease).mock.calls[0][2];
    expect(deps.releaseCharacterLease).toHaveBeenCalledExactlyOnceWith(CHARACTER_ID, nonce);
    expect(accountAdmissionsFor(game).activeAccounts).toBe(0);
    await attempt(new HandshakeSocket());
    expect(game.clients.size).toBe(1);
  });

  it('resumes a valid linkdead session with two token reads and no new lease', async () => {
    const { authenticate, deps, game, socket, accountAndScopeForToken } = setup();
    await authenticate();
    const session = [...game.clients.values()][0];
    socket.close();
    expect(session.linkdead).toBe(true);
    accountAndScopeForToken.mockClear();
    vi.mocked(deps.acquireCharacterLease).mockClear();
    const reconnect = new HandshakeSocket();
    await authenticate(reconnect);
    expect(game.clients.get(session.pid)).toBe(session);
    expect(session.linkdead).toBe(false);
    expect(accountAndScopeForToken).toHaveBeenCalledTimes(2);
    expect(deps.acquireCharacterLease).not.toHaveBeenCalled();
    sendForward(reconnect);
    expect(game.sim.meta(session.pid)?.moveInput.forward).toBe(true);
  });

  it('never converts an expired resume into a fresh join without a lease', async () => {
    const { authenticate, deps, game, socket, accountAndScopeForToken } = setup();
    await authenticate();
    const session = [...game.clients.values()][0];
    socket.close();
    const finalQuery = deferred();
    const finishQuery = deferred();
    accountAndScopeForToken
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID, scope: 'full' })
      .mockImplementationOnce(async () => {
        finalQuery.resolve();
        await finishQuery.promise;
        return { accountId: ACCOUNT_ID, scope: 'full' };
      });
    vi.mocked(deps.acquireCharacterLease).mockClear();
    const reconnect = new HandshakeSocket();
    const pending = authenticate(reconnect);
    try {
      await finalQuery.promise;
      // Grace expiry is a leave, not an account disconnect; the token stays valid.
      await game.leave(session, 'linkdead grace expired');
    } finally {
      finishQuery.resolve();
      await pending;
    }
    expect(game.clients.size).toBe(0);
    expect(deps.acquireCharacterLease).not.toHaveBeenCalled();
    expect(reconnect.sent.some((frame) => frame.t === 'hello')).toBe(false);
    expect(reconnect.readyState).not.toBe(reconnect.OPEN);
  });

  it('does not release an unfenced lease if sending the rejection throws', async () => {
    const { authenticate, deps, socket, accountAndScopeForToken } = setup();
    accountAndScopeForToken
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID, scope: 'full' })
      .mockResolvedValueOnce(null);
    vi.spyOn(socket, 'send').mockImplementationOnce(() => {
      throw new Error('synthetic closed socket');
    });
    await expect(authenticate()).rejects.toThrow('synthetic closed socket');
    const nonce = vi.mocked(deps.acquireCharacterLease).mock.calls[0][2];
    expect(deps.releaseCharacterLease).toHaveBeenCalledExactlyOnceWith(CHARACTER_ID, nonce);
  });

  it('invalidates a pending resume even when its final lookup returns a valid snapshot', async () => {
    const { authenticate, game, socket, accountAndScopeForToken } = setup();
    await authenticate();
    const session = [...game.clients.values()][0];
    socket.close();
    expect(session.linkdead).toBe(true);
    const finalQuery = deferred();
    const finishQuery = deferred();
    accountAndScopeForToken
      .mockResolvedValueOnce({ accountId: ACCOUNT_ID, scope: 'full' })
      .mockImplementationOnce(async () => {
        finalQuery.resolve();
        await finishQuery.promise;
        return { accountId: ACCOUNT_ID, scope: 'full' };
      });
    const reconnect = new HandshakeSocket();
    const pending = authenticate(reconnect);
    try {
      await finalQuery.promise;
      game.disconnectAccount(ACCOUNT_ID, 'Credentials changed');
    } finally {
      finishQuery.resolve();
      await pending;
    }
    expect(game.clients.size).toBe(0);
    expect(reconnect.sent).toContainEqual({ t: 'error', error: 'not authenticated' });
    expect(reconnect.sent.some((frame) => frame.t === 'hello')).toBe(false);
  });

  it('does not invalidate another account when disconnect is requested', async () => {
    const { authenticate, game, getCharacter, character, socket } = setup();
    getCharacter.mockImplementationOnce(async () => {
      game.disconnectAccount(ACCOUNT_ID + 1, 'Credentials changed');
      return character;
    });
    await authenticate();
    expect(game.clients.size).toBe(1);
    sendForward(socket);
    const session = [...game.clients.values()][0];
    expect(game.sim.meta(session.pid)?.moveInput.forward).toBe(true);
  });
});
