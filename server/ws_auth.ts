// Lifts the WebSocket auth handshake (first-frame auth, moderation/character
// checks, per-IP hard limit, game.join, and the /ws upgrade wiring) out of
// main.ts and behind an injected deps bag so it can be unit tested without a
// database or a live HTTP server.
//
// The handshake's wire vocabulary (the rejection strings, the per-IP close code
// and reason, the leave reasons, the timeout, the upgrade path) lives in named
// tables at the top of this module rather than as literals scattered through the
// control flow. The rejection strings ride the {t:'error'} frame to the client's
// disconnect path (src/net/online.ts) and are matched there by userFacingApiError
// (src/main.ts), so any value here is part of the wire contract: changing one is a
// wire change that must land in the client matcher in the same commit.

import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import type { BankBonusSource } from '../src/world_api';
import type {
  AccountChatMuteStatus,
  AccountCosmetics,
  AccountModerationStatus,
  CharacterRow,
} from './db';
import type { GameServer } from './game';

// The {t:'error', error} rejection strings, by the exact value the client reads
// and localizes. Each is part of the wire contract (see the module header).
const WS_AUTH_ERROR = {
  badAuthMessage: 'bad auth message',
  authRequired: 'authentication required',
  notAuthenticated: 'not authenticated',
  noSuchCharacter: 'no such character',
  // The per-character load lease refused: another process (or a live session in
  // this one) already holds this character in-world. This EXACT string is the
  // planJoin refusal literal (server/linkdead.ts) the client already maps
  // (src/ui/api_error_i18n.ts, errors.api.alreadyInWorld), so reusing it verbatim
  // needs no new i18n key.
  alreadyInWorld: 'character already in world',
  forceRename: 'This character must be renamed before entering the world.',
  authTimedOut: 'authentication timed out',
} as const;

// The per-IP hard-limit refusal is a raw WS close (code + reason), never a
// {t:'error'} frame; the client surfaces it through the socket onclose path.
const TOO_MANY_CONNECTIONS_CLOSE = {
  code: 1008,
  reason: 'Too many connections from your network',
} as const;

// The first auth frame must arrive within this window or the socket is closed.
const AUTH_TIMEOUT_MS = 10_000;

// Only this upgrade path is accepted; any other path is destroyed at the socket.
const WS_UPGRADE_PATH = '/ws';

// Every failed handshake check sends exactly one {t:'error'} frame (the shape the
// client parses in online.ts onMessage), then closes the socket. Centralizes both
// the frame shape and the send-then-close ordering in one place.
function rejectHandshake(ws: WebSocket, error: string): void {
  ws.send(JSON.stringify({ t: 'error', error }));
  ws.close();
}

export interface WsAuthDeps {
  game: GameServer;
  accountForToken: (token: string) => Promise<number | null>;
  moderationStatusForAccount: (accountId: number) => Promise<AccountModerationStatus>;
  getCharacter: (accountId: number, characterId: number) => Promise<CharacterRow | null>;
  chatMuteStatusForAccount: (accountId: number) => Promise<AccountChatMuteStatus>;
  // Staff identity (accounts.admin_roles): null means not staff. The expanded
  // permission set is snapshotted into the session at join (server/game.ts) and
  // gates the in-game moderation commands; a role change applies at next login.
  adminRolesForAccount: (
    accountId: number,
  ) => Promise<{ username: string; roles: string[] } | null>;
  permissionsForRoles: (roles: readonly string[]) => ReadonlySet<string>;
  // Meta CAPI attribution (server/meta_capi.ts): the browser-cookie user data and
  // the event source URL ride the join metadata into the session for the
  // server-side conversion events (e.g. trackReachedLevel5 in game.ts).
  metaRequestUserData: (
    req: http.IncomingMessage,
    meta: { ip: string; userAgent: string },
  ) => { fbp?: string | null; fbc?: string | null };
  metaEventSourceUrl: (req: http.IncomingMessage) => string | undefined;
  loadAccountCosmetics: (accountId: number) => Promise<AccountCosmetics>;
  isConnectionRefused: (input: {
    blocked: boolean;
    isAdmin: boolean;
    ipSessions: number;
    hardLimit: number;
  }) => boolean;
  bufferHandshakeMessages: (ws: EventEmitter, maxFrames?: number) => () => void;
  requestMetadata: (req: http.IncomingMessage) => { ip: string; userAgent: string };
  maxWsPerIpHard: number;
  // Per-character DB load lease (server/db.ts character_leases), injected like
  // every other DB dependency here so the handshake stays unit-testable without a
  // live database. acquire fences the row with a per-join nonce; release matches
  // that nonce so a stale release cannot delete a re-acquired lease.
  acquireCharacterLease: (characterId: number, nonce: string) => Promise<boolean>;
  releaseCharacterLease: (characterId: number, nonce?: string) => Promise<void>;
  // Recomputes the account's bank bonus slots from live facts (email/Discord/wallet/
  // referrals) so a fresh join stamps the current entitlement into the character state.
  // Called on the FRESH-JOIN arm only, never on a resume (no mid-session recompute); a
  // rejection fails the handshake exactly like a getCharacter failure.
  bankBonusForAccount: (
    accountId: number,
  ) => Promise<{ bonusSlots: number; sources: BankBonusSource[] }>;
}

export interface WsAuthHandlers {
  authenticateWebSocket: (ws: WebSocket, raw: string, req: http.IncomingMessage) => Promise<void>;
  onConnection: (ws: WebSocket, req: http.IncomingMessage) => Promise<void>;
  attachUpgrade: (server: http.Server, wss: WebSocketServer) => void;
}

export function createWsAuth(deps: WsAuthDeps): WsAuthHandlers {
  const {
    game,
    accountForToken,
    moderationStatusForAccount,
    getCharacter,
    chatMuteStatusForAccount,
    adminRolesForAccount,
    permissionsForRoles,
    metaRequestUserData,
    metaEventSourceUrl,
    loadAccountCosmetics,
    isConnectionRefused,
    bufferHandshakeMessages,
    requestMetadata,
    maxWsPerIpHard: MAX_WS_PER_IP_HARD,
    acquireCharacterLease,
    releaseCharacterLease,
    bankBonusForAccount,
  } = deps;

  // Character ids whose lease-acquire-through-join section is in flight in THIS
  // process. Two genuinely concurrent handshakes for one character would race to
  // stamp the lease nonce (the second's acquire re-stamping the first's row),
  // re-opening the leaseless-live-session window; admit only the first and refuse
  // the rest. The id is added before the lease section and removed in a finally,
  // so the check-acquire-join sequence is atomic per character within the process.
  const pendingLeaseJoins = new Set<number>();

  async function authenticateWebSocket(
    ws: WebSocket,
    raw: string,
    req: http.IncomingMessage,
  ): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.error('ws auth: malformed first frame, rejecting handshake', err);
      rejectHandshake(ws, WS_AUTH_ERROR.badAuthMessage);
      return;
    }
    if (msg?.t !== 'auth') {
      rejectHandshake(ws, WS_AUTH_ERROR.authRequired);
      return;
    }

    const token = typeof msg.token === 'string' ? msg.token : '';
    const characterId = Number(msg.character ?? 'NaN');
    const clientSeed = typeof msg.clientSeed === 'string' ? msg.clientSeed : '';
    const accountId = await accountForToken(token);
    if (accountId === null || !Number.isFinite(characterId)) {
      rejectHandshake(ws, WS_AUTH_ERROR.notAuthenticated);
      return;
    }
    const status = await moderationStatusForAccount(accountId);
    if (status.locked) {
      rejectHandshake(ws, status.message);
      return;
    }
    const character = await getCharacter(accountId, characterId);
    if (!character) {
      rejectHandshake(ws, WS_AUTH_ERROR.noSuchCharacter);
      return;
    }
    if (character.force_rename) {
      rejectHandshake(ws, WS_AUTH_ERROR.forceRename);
      return;
    }
    const chatMute = await chatMuteStatusForAccount(accountId);
    // Hard per-IP WS connection limit. The soft threshold (composite score evidence)
    // is handled inside game.join(); this guard blocks egregious bot farms before
    // they consume a session slot.
    const meta = requestMetadata(req);
    const ip = meta.ip;
    const staff = await adminRolesForAccount(accountId);
    const isAdmin = staff !== null;
    const adminPermissions = staff ? [...permissionsForRoles(staff.roles)] : [];
    if (
      isConnectionRefused({
        blocked: game.isIpBlocked(ip),
        isAdmin,
        ipSessions: game.countIpSessions(ip),
        hardLimit: MAX_WS_PER_IP_HARD,
      })
    ) {
      ws.close(TOO_MANY_CONNECTIONS_CLOSE.code, TOO_MANY_CONNECTIONS_CLOSE.reason);
      return;
    }
    const accountCosmetics = await loadAccountCosmetics(accountId);
    const joinMeta = {
      ...meta,
      ...metaRequestUserData(req, meta),
      sourceUrl: metaEventSourceUrl(req),
      mutedUntil: status.chatMutedUntil ?? chatMute.mutedUntil,
      reason: chatMute.reason,
      chatStrikes: status.chatStrikes,
      accountCosmetics,
      isAdmin,
      adminPermissions,
      clientSeed,
    };
    // Two genuinely concurrent handshakes for one character would race to stamp
    // the lease nonce; admit only the first and refuse the rest (never queue).
    if (pendingLeaseJoins.has(character.id)) {
      rejectHandshake(ws, WS_AUTH_ERROR.alreadyInWorld);
      return;
    }
    pendingLeaseJoins.add(character.id);
    try {
      let leaseNonce: string | undefined;
      let result: ReturnType<GameServer['join']>;
      if (game.hasSessionForCharacter(character.id)) {
        // A live or linkdead session in THIS process already owns the lease row;
        // let planJoin adjudicate (a linkdead session resumes and keeps the row's
        // nonce; a live duplicate is rejected) and never re-stamp the row with a
        // fresh acquire that a doomed handshake could leave mismatched.
        result = game.join(
          ws,
          accountId,
          character.id,
          character.name,
          character.class,
          character.state,
          character.is_gm,
          joinMeta,
        );
      } else {
        // Fresh load: claim the lease immediately before creating the session, and
        // only after every cheap refusal above (auth, moderation, ownership,
        // force-rename, the per-IP hard limit), so no refusable handshake pays for
        // the DB write and no session is ever created without a lease. Acquiring on
        // a raw client-supplied id before the getCharacter ownership check would let
        // any authenticated user lock arbitrary characters (a login DoS). The
        // per-join nonce fences the row so a later stale release cannot delete it. A
        // live foreign lease fails closed with the exact 'character already in world'
        // string planJoin already uses.
        //
        // Recompute the bank bonus slots from live account facts and stamp them into
        // the character state at load (server authority). Fresh-join arm ONLY: a resume
        // above keeps its stamped value (no mid-session recompute, locked policy).
        // Computed BEFORE the lease acquire so the lease-held window stays tight; a bare
        // await means a DB error fails the handshake exactly like a getCharacter failure.
        const bankBonus = await bankBonusForAccount(accountId);
        leaseNonce = randomUUID();
        const leased = await acquireCharacterLease(character.id, leaseNonce);
        if (!leased) {
          rejectHandshake(ws, WS_AUTH_ERROR.alreadyInWorld);
          return;
        }
        result = game.join(
          ws,
          accountId,
          character.id,
          character.name,
          character.class,
          character.state,
          character.is_gm,
          { ...joinMeta, leaseNonce, bankBonus },
        );
      }
      if ('error' in result) {
        // join refused after we took the lease. Release it, AWAITED and nonce-fenced
        // so a stale delete never eats a re-acquired row, UNLESS this process already
        // has a live session for the character (that session owns the lease and
        // dropping it would strand the live player). leaseNonce is undefined only on
        // the hasSession path above, where we took no lease to release.
        if (leaseNonce !== undefined && !game.hasSessionForCharacter(character.id)) {
          await releaseCharacterLease(character.id, leaseNonce).catch((err) =>
            console.error('lease release failed:', err),
          );
        }
        rejectHandshake(ws, result.error);
        return;
      }
      const session = result;
      console.log(`+ ${character.name} (${character.class}) joined, ${game.clients.size} online`);
      ws.on('message', (data) => {
        game.handleMessage(session, String(data));
      });
      // A dropped socket starts the linkdead grace instead of logging the
      // character out: the session is held in-world so the client's
      // auto-reconnect (or a fresh login on the same character) resumes it.
      // socketClosed no-ops for kicked sessions and for stale events from a
      // socket that a resume has already replaced; the grace-expiry sweep in
      // game.ts runs the eventual leave().
      ws.on('close', () => {
        if (game.socketClosed(session, ws)) {
          console.log(`~ ${character.name} linkdead, ${game.clients.size} online`);
        }
      });
      ws.on('error', () => {
        game.socketClosed(session, ws);
      });
      // Clears the keepalive liveness flag (game.ts pingLiveSessions). Guarded
      // on socket identity so a late pong from a pre-resume socket cannot mask
      // a black-holed replacement.
      ws.on('pong', () => {
        if (session.ws === ws) session.awaitingPong = false;
      });
    } finally {
      // The join is decided (a session now lives in sessionsByCharacterId, or the
      // handshake was rejected), so a later handshake sees hasSessionForCharacter
      // and no longer needs this guard.
      pendingLeaseJoins.delete(character.id);
    }
  }

  async function onConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const authTimer = setTimeout(() => {
      rejectHandshake(ws, WS_AUTH_ERROR.authTimedOut);
    }, AUTH_TIMEOUT_MS);

    // Pre-auth socket errors (e.g. a first frame over maxPayload, which ws
    // surfaces as an 'error' event) would otherwise be an unhandled exception
    // and crash the process. Tear the connection down quietly instead. The
    // post-auth game.leave handler is attached separately once joined.
    ws.on('error', () => {
      clearTimeout(authTimer);
      try {
        ws.close();
      } catch (err) {
        // The socket may already be closing, in which case close() throws; not fatal.
        console.error('ws auth: closing socket after a pre-auth error failed', err);
      }
    });

    ws.once('message', (data) => {
      clearTimeout(authTimer);
      // Buffer any frames the client sends while the async auth/join handshake
      // is still in flight, then replay them once authenticateWebSocket has
      // attached the permanent message handler. Without this the frames are
      // silently dropped (see ws_buffer.ts).
      const flush = bufferHandshakeMessages(ws);
      void authenticateWebSocket(ws, String(data), req).finally(flush);
    });
  }

  function attachUpgrade(server: http.Server, wss: WebSocketServer): void {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== WS_UPGRADE_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void onConnection(ws, req);
      });
    });
  }

  return { authenticateWebSocket, onConnection, attachUpgrade };
}
