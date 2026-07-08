// HTTP long-poll transport: fallback for environments where WebSocket is blocked
// (corporate proxies, hotel networks, restrictive firewalls). The client polls
// GET /api/transport/poll for queued server messages and POSTs to
// /api/transport/send for input/commands.
//
// Each HTTP transport client gets a FakeWs that mimics the WebSocket API so the
// existing game.ts send/dispatch/broadcast logic works unchanged.

import type * as http from 'node:http';
import type { ClientSession, GameTransport } from './game';
import { json, readBody } from './http_util';

// --- FakeWs: lightweight WebSocket stand-in for HTTP transport clients ----------

const OPEN = 1;
const CLOSED = 3;
const MAX_QUEUED_BYTES = 1024 * 1024; // 1 MiB backpressure cap

export class FakeWs implements GameTransport {
  readyState = OPEN;
  bufferedAmount = 0;
  private queue: string[] = [];
  private queueBytes = 0;
  /** Pending poll response waiting for messages. Resolved when messages arrive. */
  private pollResolve: (() => void) | null = null;

  send(payload: string): void {
    if (this.readyState !== OPEN) return;
    const len = Buffer.byteLength(payload);
    if (this.queueBytes + len > MAX_QUEUED_BYTES) {
      // Backpressure: drop the connection instead of growing unbounded.
      this.readyState = CLOSED;
      return;
    }
    this.queue.push(payload);
    this.queueBytes += len;
    // Wake any pending poll
    if (this.pollResolve) {
      this.pollResolve();
      this.pollResolve = null;
    }
  }

  close(): void {
    this.readyState = CLOSED;
    if (this.pollResolve) {
      this.pollResolve();
      this.pollResolve = null;
    }
  }

  terminate(): void {
    this.close();
  }

  ping(): void {
    // No-op: HTTP has no keepalive ping; the poll loop itself is the liveness signal.
  }

  /** Drain all queued messages. Returns them joined by newline (safe: JSON has no \n). */
  drain(): string[] {
    const msgs = this.queue;
    this.queue = [];
    this.queueBytes = 0;
    return msgs;
  }

  /** Wait for messages or until the transport closes. */
  waitForMessages(): Promise<void> {
    if (this.queue.length > 0 || this.readyState !== OPEN) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pollResolve = resolve;
    });
  }

  /** Clear the pending poll resolver (called on timeout). */
  clearPollResolver(): void {
    if (this.pollResolve) {
      this.pollResolve();
      this.pollResolve = null;
    }
  }
}

// --- HTTP transport session registry -------------------------------------------

const httpSessions = new Map<string, { fake: FakeWs; session: ClientSession }>();

export function getHttpSession(id: string): { fake: FakeWs; session: ClientSession } | undefined {
  return httpSessions.get(id);
}

export function removeHttpSession(id: string): void {
  httpSessions.delete(id);
}

// --- HTTP transport endpoint handlers ------------------------------------------

/**
 * POST /api/transport/connect
 * Body: { token, character, clientSeed? }
 * Returns: { sessionId } on success, or { error } on failure.
 *
 * Reuses the same auth logic as ws_auth.ts but without the WebSocket upgrade.
 */
export async function handleTransportConnect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: {
    game: import('./game').GameServer;
    accountForToken: (token: string) => Promise<number | null>;
    moderationStatusForAccount: (
      accountId: number,
    ) => Promise<import('./db').AccountModerationStatus>;
    getCharacter: (
      accountId: number,
      characterId: number,
    ) => Promise<import('./db').CharacterRow | null>;
    chatMuteStatusForAccount: (accountId: number) => Promise<import('./db').AccountChatMuteStatus>;
    adminRolesForAccount: (
      accountId: number,
    ) => Promise<{ username: string; roles: string[] } | null>;
    permissionsForRoles: (roles: readonly string[]) => ReadonlySet<string>;
    loadAccountCosmetics: (accountId: number) => Promise<import('./db').AccountCosmetics>;
    requestMetadata: (req: http.IncomingMessage) => { ip: string; userAgent: string };
    isConnectionRefused: (input: {
      blocked: boolean;
      isAdmin: boolean;
      ipSessions: number;
      hardLimit: number;
    }) => boolean;
    maxWsPerIpHard: number;
  },
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    return json(res, 400, { error: 'invalid body' });
  }
  const token = typeof body.token === 'string' ? body.token : '';
  const characterId = Number(body.character ?? 'NaN');
  const clientSeed = typeof body.clientSeed === 'string' ? body.clientSeed : '';

  const accountId = await deps.accountForToken(token);
  if (accountId === null || !Number.isFinite(characterId)) {
    return json(res, 401, { error: 'not authenticated' });
  }
  const status = await deps.moderationStatusForAccount(accountId);
  if (status.locked) {
    return json(res, 403, { error: status.message });
  }
  const character = await deps.getCharacter(accountId, characterId);
  if (!character) {
    return json(res, 401, { error: 'no such character' });
  }
  if (character.force_rename) {
    return json(res, 403, { error: 'This character must be renamed before entering the world.' });
  }
  const chatMute = await deps.chatMuteStatusForAccount(accountId);
  const meta = deps.requestMetadata(req);
  const ip = meta.ip;
  const staff = await deps.adminRolesForAccount(accountId);
  const isAdmin = staff !== null;
  const adminPermissions = staff ? [...deps.permissionsForRoles(staff.roles)] : [];
  if (
    deps.isConnectionRefused({
      blocked: deps.game.isIpBlocked(ip),
      isAdmin,
      ipSessions: deps.game.countIpSessions(ip),
      hardLimit: deps.maxWsPerIpHard,
    })
  ) {
    return json(res, 429, { error: 'Too many connections from your network' });
  }
  const accountCosmetics = await deps.loadAccountCosmetics(accountId);
  const fake = new FakeWs();
  const result = deps.game.join(
    fake,
    accountId,
    character.id,
    character.name,
    character.class,
    character.state,
    character.is_gm,
    {
      ...meta,
      mutedUntil: status.chatMutedUntil ?? chatMute.mutedUntil,
      reason: chatMute.reason,
      chatStrikes: status.chatStrikes,
      accountCosmetics,
      isAdmin,
      adminPermissions,
      clientSeed,
    },
  );
  if ('error' in result) {
    fake.close();
    return json(res, 403, { error: result.error });
  }
  const session = result;
  const sessionId = `http_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  httpSessions.set(sessionId, { fake, session });
  console.log(
    `+ ${character.name} (${character.class}) joined via HTTP, ${deps.game.clients.size} online`,
  );
  return json(res, 200, { sessionId });
}

/**
 * GET /api/transport/poll?sessionId=...
 * Long-polls for queued server messages. Returns them as a JSON array of strings.
 * Returns [] if the transport is closed (client should reconnect).
 */
export function handleTransportPoll(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
): void {
  const entry = httpSessions.get(sessionId);
  if (!entry) {
    json(res, 404, { error: 'session not found' });
    return;
  }
  const { fake, session } = entry;
  // If transport already closed, tell the client
  if (fake.readyState === CLOSED || session.left) {
    httpSessions.delete(sessionId);
    json(res, 200, { messages: [], closed: true });
    return;
  }
  // Drain any queued messages immediately
  const msgs = fake.drain();
  if (msgs.length > 0) {
    json(res, 200, { messages: msgs });
    return;
  }
  // No messages yet: long-poll (hold for up to 30s, then return empty)
  const timeout = setTimeout(() => {
    fake.clearPollResolver();
    json(res, 200, { messages: [] });
  }, 30_000);
  // Clean up timeout if client disconnects
  req.on('close', () => {
    clearTimeout(timeout);
    fake.clearPollResolver();
  });
  fake.waitForMessages().then(() => {
    clearTimeout(timeout);
    if (res.writableEnded) return;
    if (fake.readyState === CLOSED || session.left) {
      httpSessions.delete(sessionId);
      json(res, 200, { messages: [], closed: true });
      return;
    }
    json(res, 200, { messages: fake.drain() });
  });
}

/**
 * POST /api/transport/send
 * Body: { sessionId, payload } where payload is the raw JSON string the WS client would send.
 */
export async function handleTransportSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: import('./game').GameServer,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    return json(res, 400, { error: 'invalid body' });
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const payload = typeof body.payload === 'string' ? body.payload : '';
  if (!sessionId || !payload) {
    return json(res, 400, { error: 'missing sessionId or payload' });
  }
  const entry = httpSessions.get(sessionId);
  if (!entry) {
    return json(res, 404, { error: 'session not found' });
  }
  const { session } = entry;
  if (session.left) {
    httpSessions.delete(sessionId);
    return json(res, 404, { error: 'session ended' });
  }
  // Validate payload size (same 16 KiB cap as WS)
  if (Buffer.byteLength(payload) > 16 * 1024) {
    return json(res, 413, { error: 'payload too large' });
  }
  // Process the message exactly as a WS frame
  game.handleMessage(session, payload);
  json(res, 200, { ok: true });
}

/**
 * POST /api/transport/close
 * Body: { sessionId }
 * Graceful disconnect.
 */
export function handleTransportClose(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  game: import('./game').GameServer,
  sessionId: string,
): void {
  const entry = httpSessions.get(sessionId);
  if (!entry) {
    json(res, 200, { ok: true }); // idempotent
    return;
  }
  const { fake, session } = entry;
  httpSessions.delete(sessionId);
  fake.close();
  if (!session.left) {
    game.socketClosed(session, fake);
    // Force leave if linkdead grace isn't needed (HTTP has no reconnect resume)
    void game.leave(session, 'http transport closed');
  }
  json(res, 200, { ok: true });
}
