// Unit tests for server/ws_auth.ts, the WebSocket auth handshake lifted out of
// main.ts behind an injected deps bag. These run in plain Node with no database
// and no live server: ws_auth.ts imports only TYPES from ./db and ./game (erased
// at compile time), so importing it never evaluates db.ts or main.ts. The only
// runtime import beyond the module under test is the pure bufferHandshakeMessages.
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket, WebSocketServer } from 'ws';
import type { AccountModerationStatus, CharacterRow } from '../../server/db';
import { isConnectionRefused as realIsConnectionRefused } from '../../server/ip_block';
import { createWsAuth, type WsAuthDeps } from '../../server/ws_auth';
import { bufferHandshakeMessages } from '../../server/ws_buffer';

// A fake socket: real EventEmitter wiring (on/once/off/emit) so the handshake
// buffer and the post-join ws.on('message'|'close'|'error') handlers work, plus
// spy send/close so we can assert the exact frames and their ordering.
class FakeWs extends EventEmitter {
  send = vi.fn();
  close = vi.fn();
}

const asWs = (w: FakeWs): WebSocket => w as unknown as WebSocket;

function modStatus(over: Partial<AccountModerationStatus> = {}): AccountModerationStatus {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
    ...over,
  };
}

function baseChar(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 7,
    account_id: 1,
    name: 'Aldric',
    class: 'warrior',
    level: 10,
    state: null,
    is_gm: false,
    force_rename: false,
    ...over,
  };
}

// Fresh ws + deps + game spies for every case. The happy path is the default;
// each test overrides exactly one field BEFORE calling createWsAuth (the factory
// destructures its function deps at construction, so an override applied after
// would not be seen). The `game` object is captured by reference, so its method
// spies may be reconfigured before construction too.
function setup() {
  const ws = new FakeWs();
  const session = { pid: 1, tag: 'fake-session' };
  const game = {
    isIpBlocked: vi.fn((_ip: string) => false),
    countIpSessions: vi.fn((_ip: string) => 0),
    // No live session by default, so the handshake takes the fresh-acquire arm.
    hasSessionForCharacter: vi.fn((_characterId: number) => false),
    join: vi.fn(() => session),
    clients: { size: 1 },
    handleMessage: vi.fn(),
    leave: vi.fn(async () => {}),
    socketClosed: vi.fn(() => true),
  };
  const deps: WsAuthDeps = {
    game: game as unknown as WsAuthDeps['game'],
    accountForToken: vi.fn(async () => 1 as number | null),
    moderationStatusForAccount: vi.fn(async () => modStatus()),
    getCharacter: vi.fn(async () => baseChar() as CharacterRow | null),
    chatMuteStatusForAccount: vi.fn(async () => ({
      mutedUntil: null as string | null,
      reason: '',
    })),
    // Default: not staff (null), mirroring staff_db.adminRolesForAccount's fail-closed
    // contract. permissionsForRoles echoes the roles so a test can pin the expansion.
    adminRolesForAccount: vi.fn(async () => null as { username: string; roles: string[] } | null),
    permissionsForRoles: vi.fn((roles: readonly string[]) => new Set<string>(roles)),
    metaRequestUserData: vi.fn(() => ({ fbp: null, fbc: null })),
    metaEventSourceUrl: vi.fn(() => undefined as string | undefined),
    loadAccountCosmetics: vi.fn(async () => ({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    })),
    // Character-lease deps: the happy path holds the lease so every existing case
    // reaches game.join unchanged; the lease branches themselves are covered by
    // tests/character_lease_ws.test.ts.
    acquireCharacterLease: vi.fn(async () => true),
    releaseCharacterLease: vi.fn(async () => {}),
    // Bank bonus deps: the fresh-join arm recomputes the bank bonus and stamps it into the join
    // meta. The default returns an empty grant so every existing case reaches game.join
    // unchanged; the stamp/resume branches are pinned in the bank-bonus block below.
    bankBonusForAccount: vi.fn(async () => ({ bonusSlots: 0, sources: [] })),
    isConnectionRefused: vi.fn(() => false),
    bufferHandshakeMessages,
    requestMetadata: vi.fn(() => ({ ip: '1.2.3.4', userAgent: 'ua' })),
    maxWsPerIpHard: 20,
  };
  const req = {} as http.IncomingMessage;
  return { ws, game, session, deps, req };
}

const authRaw = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'auth', token: 'tok', character: 7, ...over });

const errorFrame = (error: string) => JSON.stringify({ t: 'error', error });

function expectSendThenClose(ws: FakeWs, frame: string) {
  expect(ws.send).toHaveBeenCalledTimes(1);
  expect(ws.send).toHaveBeenCalledWith(frame);
  expect(ws.close).toHaveBeenCalledTimes(1);
  // ws.send must fire before ws.close on every reject path.
  expect(ws.send.mock.invocationCallOrder[0]).toBeLessThan(ws.close.mock.invocationCallOrder[0]);
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('createWsAuth: authenticateWebSocket reject paths', () => {
  it('1. rejects unparseable JSON with "bad auth message" and logs the parse error', async () => {
    const { ws, deps, req } = setup();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), 'not json', req);
    expectSendThenClose(ws, errorFrame('bad auth message'));
    // The caught JSON.parse error is logged, never swallowed silently.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('2. rejects a non-auth message with "authentication required"', async () => {
    const { ws, deps, req } = setup();
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), JSON.stringify({ t: 'hello' }), req);
    expectSendThenClose(ws, errorFrame('authentication required'));
  });

  it('3. rejects a null account with "not authenticated"', async () => {
    const { ws, deps, req } = setup();
    deps.accountForToken = vi.fn(async () => null);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw({ character: 1 }), req);
    expectSendThenClose(ws, errorFrame('not authenticated'));
  });

  it('4. rejects a non-finite character with "not authenticated"', async () => {
    const { ws, deps, req } = setup();
    // account resolves fine here; the branch is forced via a non-numeric character.
    deps.accountForToken = vi.fn(async () => 1);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw({ character: 'abc' }), req);
    expectSendThenClose(ws, errorFrame('not authenticated'));
  });

  it('5. forwards a locked-moderation message verbatim', async () => {
    const { ws, deps, req } = setup();
    deps.moderationStatusForAccount = vi.fn(async () =>
      modStatus({ locked: true, message: 'You are banned.' }),
    );
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expectSendThenClose(ws, errorFrame('You are banned.'));
  });

  it('6. rejects a missing character with "no such character"', async () => {
    const { ws, deps, req } = setup();
    deps.getCharacter = vi.fn(async () => null);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expectSendThenClose(ws, errorFrame('no such character'));
  });

  it('7. rejects a force_rename character with the rename notice', async () => {
    const { ws, deps, req } = setup();
    deps.getCharacter = vi.fn(async () => baseChar({ force_rename: true }));
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expectSendThenClose(
      ws,
      errorFrame('This character must be renamed before entering the world.'),
    );
  });

  it('8. closes 1008 on the IP gate, wiring the gate inputs, and sends NO error frame', async () => {
    const { ws, game, deps, req } = setup();
    deps.isConnectionRefused = vi.fn(() => true);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    // The gate decision is fed the server-resolved inputs verbatim: the per-IP
    // block flag and live session count BOTH keyed by the request IP, the admin
    // exemption, and the configured hard limit. A regression that swaps an arg,
    // drops the admin exemption, or keys the count off the wrong IP would still
    // reject here without this exact-shape assertion.
    expect(deps.isConnectionRefused).toHaveBeenCalledWith({
      blocked: false,
      isAdmin: false,
      ipSessions: 0,
      hardLimit: 20,
    });
    expect(game.isIpBlocked).toHaveBeenCalledWith('1.2.3.4');
    expect(game.countIpSessions).toHaveBeenCalledWith('1.2.3.4');
    // This asymmetry is load-bearing: the hard per-IP limit closes with a code
    // and reason but never writes a {t:'error'} frame first.
    expect(ws.close).toHaveBeenCalledWith(1008, 'Too many connections from your network');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('8b. refuses via the REAL gate predicate when live IP sessions reach the hard limit', async () => {
    const { ws, game, deps, req } = setup();
    // Drive the actual ip_block decision end to end, not a stub, so the gate's
    // real ipSessions >= hardLimit comparison is exercised through the wiring.
    deps.isConnectionRefused = realIsConnectionRefused;
    game.countIpSessions = vi.fn((_ip: string) => 20); // exactly at maxWsPerIpHard (20)
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Too many connections from your network');
    expect(game.join).not.toHaveBeenCalled();
  });

  it('8c. the REAL gate predicate exempts an admin even past the hard limit', async () => {
    const { ws, game, deps, req } = setup();
    deps.isConnectionRefused = realIsConnectionRefused;
    deps.adminRolesForAccount = vi.fn(async () => ({ username: 'Op', roles: ['admin'] }));
    game.countIpSessions = vi.fn((_ip: string) => 999); // far past the limit
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    // isAdmin short-circuits the gate, so the join proceeds and no 1008 fires.
    expect(game.join).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalledWith(1008, 'Too many connections from your network');
  });

  it('9. forwards a game.join error frame', async () => {
    const { ws, game, deps, req } = setup();
    game.join = vi.fn(() => ({ error: 'character already in world' }) as never);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expectSendThenClose(ws, errorFrame('character already in world'));
  });

  it('10. resolves moderation BEFORE loading the character (order is load-bearing)', async () => {
    const { ws, deps, req } = setup();
    // Both checks would fail: a locked (banned) account AND a missing character.
    // The banned message must win, proving moderation is resolved before the
    // character lookup, so a banned account is rejected without any character
    // row being read. A reordering that moved the character load earlier would
    // surface 'no such character' here and fail this test.
    deps.moderationStatusForAccount = vi.fn(async () =>
      modStatus({ locked: true, message: 'You are banned.' }),
    );
    deps.getCharacter = vi.fn(async () => null);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    expectSendThenClose(ws, errorFrame('You are banned.'));
    expect(deps.getCharacter).not.toHaveBeenCalled();
  });
});

describe('createWsAuth: authenticateWebSocket accept path', () => {
  it('joins with the resolved fields, sends no error, and wires the live handlers', async () => {
    const { ws, game, session, deps, req } = setup();
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);

    expect(game.join).toHaveBeenCalledTimes(1);
    expect(game.join).toHaveBeenCalledWith(
      ws,
      1,
      7,
      'Aldric',
      'warrior',
      null,
      false,
      expect.objectContaining({
        ip: '1.2.3.4',
        userAgent: 'ua',
        mutedUntil: null,
        reason: '',
        chatStrikes: 0,
        accountCosmetics: {
          completedQuestIds: [],
          mechChromaIds: [],
          weaponSkinIds: [],
          weaponSkinLoadout: {},
        },
        isAdmin: false,
        // Not staff: the snapshotted permission set is EMPTY (fail closed), never
        // an is_admin-derived fallback.
        adminPermissions: [],
        clientSeed: '',
      }),
    );
    // No {t:'error'} frame on the happy path, and the socket stays OPEN: a
    // regression that left a stray close() on the success path would be caught.
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();

    // The permanent message handler is attached and routes frames to the game.
    expect(ws.listenerCount('message')).toBeGreaterThanOrEqual(1);
    ws.emit('message', 'move-frame');
    expect(game.handleMessage).toHaveBeenCalledWith(session, 'move-frame');

    // A dropped socket routes through game.socketClosed (the linkdead grace),
    // never a direct game.leave: the character is held in-world for a resume.
    ws.emit('close');
    expect(game.socketClosed).toHaveBeenCalledWith(session, ws);
    expect(game.leave).not.toHaveBeenCalled();

    // The pong handler clears the keepalive liveness flag, but only for the
    // session's CURRENT socket (a stale pre-resume pong must not mask a
    // black-holed replacement).
    (session as { ws?: unknown; awaitingPong?: boolean }).ws = ws;
    (session as { awaitingPong?: boolean }).awaitingPong = true;
    ws.emit('pong');
    expect((session as { awaitingPong?: boolean }).awaitingPong).toBe(false);
    (session as { ws?: unknown }).ws = 'a-different-socket';
    (session as { awaitingPong?: boolean }).awaitingPong = true;
    ws.emit('pong');
    expect((session as { awaitingPong?: boolean }).awaitingPong).toBe(true);
  });

  it('snapshots the staff roles into isAdmin + expanded adminPermissions, and rides the CAPI attribution', async () => {
    const { ws, game, deps, req } = setup();
    deps.adminRolesForAccount = vi.fn(async () => ({ username: 'Op', roles: ['moderator'] }));
    deps.permissionsForRoles = vi.fn(() => new Set(['moderation.read', 'moderation.act']));
    deps.metaRequestUserData = vi.fn(() => ({ fbp: 'fb.1.a', fbc: 'fb.1.b' }));
    deps.metaEventSourceUrl = vi.fn(() => 'https://example.test/');
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    // The identity is resolved from the ROLES table (accountId 1) and expanded via
    // permissionsForRoles; the join meta snapshots the expansion, so the in-game
    // moderation gate never re-reads the db mid-session.
    expect(deps.adminRolesForAccount).toHaveBeenCalledWith(1);
    expect(deps.permissionsForRoles).toHaveBeenCalledWith(['moderator']);
    expect(game.join).toHaveBeenCalledWith(
      ws,
      1,
      7,
      'Aldric',
      'warrior',
      null,
      false,
      expect.objectContaining({
        isAdmin: true,
        adminPermissions: ['moderation.read', 'moderation.act'],
        fbp: 'fb.1.a',
        fbc: 'fb.1.b',
        sourceUrl: 'https://example.test/',
      }),
    );
  });

  it('forwards the client-supplied seed into the join meta', async () => {
    const { ws, game, deps, req } = setup();
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw({ clientSeed: 'seed-xyz' }), req);
    expect(game.join).toHaveBeenCalledWith(
      ws,
      1,
      7,
      'Aldric',
      'warrior',
      null,
      false,
      expect.objectContaining({ clientSeed: 'seed-xyz' }),
    );
  });

  it('routes a post-join socket error into the linkdead grace, not a teardown', async () => {
    const { ws, game, session, deps, req } = setup();
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);

    // The post-join 'error' handler holds the session linkdead like a clean
    // close; the grace-expiry sweep in game.ts owns the eventual leave().
    expect(ws.listenerCount('error')).toBeGreaterThanOrEqual(1);
    ws.emit('error', new Error('connection reset'));
    expect(game.socketClosed).toHaveBeenCalledWith(session, ws);
    expect(game.leave).not.toHaveBeenCalled();
  });

  it('prefers the account-level chat mute over the chat-level mute in the join meta', async () => {
    const { ws, game, deps, req } = setup();
    deps.moderationStatusForAccount = vi.fn(async () =>
      modStatus({ chatMutedUntil: '2099-01-01T00:00:00Z' }),
    );
    deps.chatMuteStatusForAccount = vi.fn(async () => ({
      mutedUntil: '2000-01-01T00:00:00Z',
      reason: 'spam',
    }));
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    // mutedUntil = status.chatMutedUntil ?? chatMute.mutedUntil: the account-level
    // value wins when present; reason still rides from the chat-mute status.
    expect(game.join).toHaveBeenCalledWith(
      ws,
      1,
      7,
      'Aldric',
      'warrior',
      null,
      false,
      expect.objectContaining({ mutedUntil: '2099-01-01T00:00:00Z', reason: 'spam' }),
    );
  });

  it('falls back to the chat-level mute when the account has no mute', async () => {
    const { ws, game, deps, req } = setup();
    deps.chatMuteStatusForAccount = vi.fn(async () => ({
      mutedUntil: '2050-06-06T00:00:00Z',
      reason: 'language',
    }));
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);
    // status.chatMutedUntil is null (default), so the chat-level mute is used.
    expect(game.join).toHaveBeenCalledWith(
      ws,
      1,
      7,
      'Aldric',
      'warrior',
      null,
      false,
      expect.objectContaining({ mutedUntil: '2050-06-06T00:00:00Z' }),
    );
  });
});

describe('createWsAuth: bank bonus stamp', () => {
  it('recomputes the bank bonus once and stamps it into the join meta on a fresh join', async () => {
    const { ws, game, deps, req } = setup();
    const grant = {
      bonusSlots: 6,
      sources: [
        { id: 'email', slots: 2, maxSlots: 2 },
        { id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 },
      ],
    };
    deps.bankBonusForAccount = vi.fn(async () => grant);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);

    // Called exactly once, keyed by the resolved account id (1), on the fresh-join arm.
    expect(deps.bankBonusForAccount).toHaveBeenCalledTimes(1);
    expect(deps.bankBonusForAccount).toHaveBeenCalledWith(1);
    // The resolved grant rides the join meta bag (the 8th arg), exactly like leaseNonce,
    // so addPlayer stamps it into the character state.
    const joinMeta = (game.join as any).mock.calls[0][7] as { bankBonus?: unknown };
    expect(joinMeta.bankBonus).toEqual(grant);
  });

  it('never recomputes the bank bonus on the resume arm (no mid-session recompute)', async () => {
    const { ws, game, deps, req } = setup();
    // A live/linkdead session already owns the lease row: the handshake takes the resume
    // arm, which must not recompute or stamp a fresh bonus (locked policy).
    game.hasSessionForCharacter = vi.fn(() => true);
    const { authenticateWebSocket } = createWsAuth(deps);
    await authenticateWebSocket(asWs(ws), authRaw(), req);

    expect(game.join).toHaveBeenCalledTimes(1);
    expect(deps.bankBonusForAccount).not.toHaveBeenCalled();
    const joinMeta = (game.join as any).mock.calls[0][7] as { bankBonus?: unknown };
    expect(joinMeta.bankBonus).toBeUndefined();
  });
});

describe('createWsAuth: onConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends "authentication timed out" then closes after 10s with no first frame', async () => {
    const { ws, deps, req } = setup();
    const { onConnection } = createWsAuth(deps);
    await onConnection(asWs(ws), req);
    vi.advanceTimersByTime(10_000);
    expectSendThenClose(ws, errorFrame('authentication timed out'));
  });

  it('clears the timeout on the first frame and runs the handshake to game.join', async () => {
    const { ws, game, deps, req } = setup();
    const { onConnection } = createWsAuth(deps);
    await onConnection(asWs(ws), req);

    ws.emit('message', authRaw());
    await flushMicrotasks();

    expect(game.join).toHaveBeenCalledTimes(1);
    // The timer was cleared, so advancing past it produces no timeout frame.
    vi.advanceTimersByTime(10_000);
    expect(ws.send).not.toHaveBeenCalledWith(errorFrame('authentication timed out'));
  });

  it('tears down quietly on a pre-auth socket error without throwing', async () => {
    const { ws, deps, req } = setup();
    const { onConnection } = createWsAuth(deps);
    await onConnection(asWs(ws), req);
    expect(() => ws.emit('error', new Error('first frame over maxPayload'))).not.toThrow();
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it('logs, and does not rethrow, when the post-error close itself throws', async () => {
    const { ws, deps, req } = setup();
    // A socket that is already closing: close() throws when called again.
    ws.close = vi.fn(() => {
      throw new Error('already closing');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onConnection } = createWsAuth(deps);
    await onConnection(asWs(ws), req);
    expect(() => ws.emit('error', new Error('pre-auth boom'))).not.toThrow();
    // The failed close is logged, not swallowed.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('createWsAuth: attachUpgrade', () => {
  beforeEach(() => {
    // onConnection arms a 10s timer; fake timers keep it from leaking.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('upgrades /ws through wss.handleUpgrade and reaches onConnection', () => {
    const { deps } = setup();
    const { attachUpgrade } = createWsAuth(deps);
    const server = new EventEmitter();
    const upgraded = new FakeWs();
    const wss = {
      handleUpgrade: vi.fn(
        (_req: unknown, _socket: unknown, _head: unknown, cb: (ws: WebSocket) => void) =>
          cb(asWs(upgraded)),
      ),
    };
    attachUpgrade(server as unknown as http.Server, wss as unknown as WebSocketServer);

    const socket = { destroy: vi.fn() };
    server.emit('upgrade', { url: '/ws' }, socket, Buffer.alloc(0));

    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();
    // The cb path reached onConnection: the auth handlers (timer + listeners) are wired.
    expect(upgraded.listenerCount('message')).toBeGreaterThanOrEqual(1);
    expect(upgraded.listenerCount('error')).toBeGreaterThanOrEqual(1);
  });

  it('destroys the socket for a non-/ws path and never upgrades', () => {
    const { deps } = setup();
    const { attachUpgrade } = createWsAuth(deps);
    const server = new EventEmitter();
    const wss = { handleUpgrade: vi.fn() };
    attachUpgrade(server as unknown as http.Server, wss as unknown as WebSocketServer);

    const socket = { destroy: vi.fn() };
    server.emit('upgrade', { url: '/nope' }, socket, Buffer.alloc(0));

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });
});
