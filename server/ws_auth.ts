// Lifts the WebSocket auth handshake (first-frame auth, moderation/character
// checks, per-IP hard limit, game.join, and the /ws upgrade wiring) out of
// main.ts and behind an injected deps bag so it can be unit tested without a
// database or a live HTTP server.
//
// The handshake's wire vocabulary (the rejection strings, the leave reasons, the
// timeout, the upgrade path) lives in named tables at the top of this module rather
// than as literals scattered through the control flow. The rejection strings ride the
// {t:'error'} frame to the client's disconnect path (src/net/online.ts) and are matched
// there by userFacingApiError (src/main.ts), so any value here is part of the wire
// contract: changing one is a wire change that must land in the client matcher in the
// same commit.

import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { type BankBonusSource, STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
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
  // The realm is at its configured player cap and this is a FRESH join (a resume of
  // an in-world or linkdead session is exempt, staff bypass it). This EXACT lowercase
  // literal is part of the wire contract the client matcher reads verbatim, so
  // changing it is a wire change that must land in the client matcher in the same
  // commit.
  realmFull: 'realm is full',
  // The per-IP hard connection limit refused a fresh handshake (an egregious bot farm
  // opening many sockets from one network); staff are exempt. This EXACT lowercase
  // literal is part of the wire contract the client matcher reads verbatim, so
  // changing it is a wire change that must land in the client matcher in the same
  // commit.
  tooManyConnections: 'too many connections from your network',
  forceRename: 'This character must be renamed before entering the world.',
  authTimedOut: 'authentication timed out',
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
  // The realm player admission cap: a FRESH WS join is refused (with the realmFull
  // wire literal) once game.clients.size plus the in-flight fresh admissions reaches
  // this value. A resume of an in-world or linkdead session is exempt (it reuses an
  // existing world slot) and staff bypass it, mirroring the per-IP exemption in
  // server/ip_block.ts isConnectionRefused. 0 or negative disables the cap.
  maxPlayersPerRealm: number;
  // Per-character DB load lease (server/db.ts character_leases), injected like
  // every other DB dependency here so the handshake stays unit-testable without a
  // live database. acquire stamps the authenticated account on the row and fences
  // it with a per-join nonce; release matches that nonce so a stale release cannot
  // delete a re-acquired lease. Passing accountId lets the owner reclaim a lease
  // stranded by a dead process before its TTL expires (same-account takeover).
  acquireCharacterLease: (
    characterId: number,
    accountId: number,
    nonce: string,
  ) => Promise<boolean>;
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
    maxPlayersPerRealm: MAX_PLAYERS_PER_REALM,
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

  // Fresh joins that have passed the realm-cap check but not yet completed
  // game.join. A plain game.clients.size read at check time can admit past the cap
  // when several fresh handshakes race across the awaits between the check and the
  // game.join insertion, so the cap check compares game.clients.size PLUS this
  // counter. It is incremented once a fresh join clears the cap check and
  // decremented in a finally once game.join has completed or the fresh arm has
  // failed, so the count is conserved on every exit path (a successful join leaves
  // the slot counted by game.clients.size instead).
  let inFlightFreshAdmissions = 0;

  // Under a join storm one console line per realm-cap refusal would flood the log,
  // so refusals are aggregated: emit at most one summary line per window carrying
  // the count of refusals since the last line. Date.now is used because this is
  // server-side wall-clock aggregation, not sim logic (the Rng/Date.now ban is
  // sim-only). The first refusal after an idle window logs immediately. Refusals
  // inside the window arm a trailing flush at the window edge: without it a
  // burst's tail would accumulate silently until the NEXT refusal after the
  // window, which may be hours later, so incident-time counts would read shifted.
  // The timer is unref'd so a pending flush never holds the process open
  // (accepted loss: a tail count still pending at process exit is dropped
  // with it; the joins it counted never happened, so nothing is owed).
  const REALM_FULL_LOG_WINDOW_MS = 30_000;
  let realmFullRefusalsSinceLog = 0;
  let realmFullLastLogAtMs = 0;
  let realmFullFlushTimer: NodeJS.Timeout | null = null;
  function logRealmFullRefusals(nowMs: number): void {
    console.log(
      `ws auth: realm full, refused ${realmFullRefusalsSinceLog} fresh join(s) at cap ${MAX_PLAYERS_PER_REALM}`,
    );
    realmFullRefusalsSinceLog = 0;
    realmFullLastLogAtMs = nowMs;
    // Every flush disarms a pending trailing timer: an inline window-edge flush
    // that left the old timer live would let it fire early into the NEW window
    // and flush a fresh burst's first refusals ahead of their own edge.
    if (realmFullFlushTimer !== null) {
      clearTimeout(realmFullFlushTimer);
      realmFullFlushTimer = null;
    }
  }
  function recordRealmFullRefusal(): void {
    realmFullRefusalsSinceLog++;
    const nowMs = Date.now();
    if (nowMs - realmFullLastLogAtMs >= REALM_FULL_LOG_WINDOW_MS) {
      logRealmFullRefusals(nowMs);
    } else if (realmFullFlushTimer === null) {
      realmFullFlushTimer = setTimeout(
        () => {
          realmFullFlushTimer = null;
          // Defensive: every flush path disarms this timer, so a 0 count should
          // be unreachable; guard anyway so a future ordering bug logs nothing
          // rather than a zero-refusal line.
          if (realmFullRefusalsSinceLog > 0) logRealmFullRefusals(Date.now());
        },
        REALM_FULL_LOG_WINDOW_MS - (nowMs - realmFullLastLogAtMs),
      );
      realmFullFlushTimer.unref();
    }
  }

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
    // Optional rolling-deploy capability. Exact numeric equality is deliberate:
    // strings, booleans, and unknown future versions stay on the legacy wire.
    const timerWireVersion: 1 | typeof STABLE_TIMER_WIRE_VERSION =
      msg.timerWire === STABLE_TIMER_WIRE_VERSION ? STABLE_TIMER_WIRE_VERSION : 1;
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
      rejectHandshake(ws, WS_AUTH_ERROR.tooManyConnections);
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
      timerWireVersion,
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
        // A live or linkdead session in THIS process holds this character, and
        // USUALLY still owns the lease row (not always: a cross-process
        // same-account takeover may have rotated the nonce already, leaving the
        // row owned by the other process until the fence-out kick lands, within
        // one autosave). Either way, let planJoin adjudicate (a linkdead session
        // resumes and keeps its nonce; a live duplicate is rejected) and never
        // re-stamp the row with a fresh acquire that a doomed handshake could
        // leave mismatched.
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
        // Realm admission cap: refuse this FRESH join once the realm is at its
        // configured player cap. This is the fresh arm only: the resume arm above is
        // exempt because it reuses an existing world slot, never adds one. Staff
        // bypass the cap, mirroring the per-IP exemption in isConnectionRefused. A
        // cap of 0 or negative disables it. The count basis is game.clients.size
        // (which includes linkdead sessions, since they still hold world slots)
        // PLUS the in-flight fresh admissions, so a burst of concurrent fresh
        // handshakes racing across the awaits below cannot admit past the cap. The
        // check-then-increment pair has no await between it, so it is atomic in the
        // single-threaded loop. Checked here, before the bank-bonus DB read and the
        // lease acquire, so a refused join never holds a lease and pays for no
        // fresh-arm DB work (the shared handshake reads above, cosmetics and
        // moderation among them, are already spent by this point; they stay bounded
        // by the per-IP hard limit and the auth timeout).
        if (
          MAX_PLAYERS_PER_REALM > 0 &&
          !isAdmin &&
          game.clients.size + inFlightFreshAdmissions >= MAX_PLAYERS_PER_REALM
        ) {
          recordRealmFullRefusal();
          rejectHandshake(ws, WS_AUTH_ERROR.realmFull);
          return;
        }
        inFlightFreshAdmissions++;
        try {
          // Fresh load: claim the lease immediately before creating the session, and
          // only after every cheap refusal above (auth, moderation, ownership,
          // force-rename, the per-IP hard limit, the realm cap), so no refusable
          // handshake pays for the DB write and no session is ever created without a
          // lease. Acquiring on a raw client-supplied id before the getCharacter
          // ownership check would let any authenticated user lock arbitrary
          // characters (a login DoS). The per-join nonce fences the row so a later
          // stale release cannot delete it. A live foreign lease fails closed with
          // the exact 'character already in world' string planJoin already uses.
          //
          // Recompute the bank bonus slots from live account facts and stamp them into
          // the character state at load (server authority). Fresh-join arm ONLY: a resume
          // above keeps its stamped value (no mid-session recompute, locked policy).
          // Computed BEFORE the lease acquire so the lease-held window stays tight; a bare
          // await means a DB error fails the handshake exactly like a getCharacter failure.
          const bankBonus = await bankBonusForAccount(accountId);
          leaseNonce = randomUUID();
          const leased = await acquireCharacterLease(character.id, accountId, leaseNonce);
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
        } finally {
          // Decrement on every fresh-arm exit path (join completed, lease refused,
          // or a thrown DB error): a successful join is now counted by
          // game.clients.size, and a failed one consumed no slot, so the count is
          // conserved for a concurrent handshake either way.
          inFlightFreshAdmissions--;
        }
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
      void authenticateWebSocket(ws, String(data), req)
        .catch((err) => {
          // A database rejection under a slow or unreachable Postgres (a pool
          // checkout wait, a statement/query timeout, a dropped connection) escapes
          // authenticateWebSocket, which is designed to REJECT rather than swallow
          // (tests/character_lease_ws.test.ts pins that). Caught HERE at the caller,
          // not inside authenticateWebSocket, an otherwise-unhandled rejection would
          // leave the client with no frame and no close, hanging it until its own
          // timeout. Convert it into the SAME classified, retryable rejection the
          // client already backs off on (authTimedOut), reusing the shared
          // send-then-close helper, but only while the socket is still open (a
          // reject path that already closed the socket must not double-send).
          console.error('ws auth: handshake rejected, closing socket', err);
          if (ws.readyState === ws.OPEN) rejectHandshake(ws, WS_AUTH_ERROR.authTimedOut);
        })
        .finally(flush);
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
