// The guild_set_motd wire command: the billboard text is player text, so the
// dispatch runs the same mute + rate + hard-word gates as chat BEFORE the
// SocialService rank gate. Only this path exercises those gates (the offline
// Sim no-ops guildSetMotd and never touches the wire), so each one is driven
// through GameServer.handleMessage with the db mocked.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire/dispatch logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function sendMotd(server: GameServer, session: ClientSession, text: unknown): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'guild_set_motd', text }));
}

function eventsOf(fc: FakeClient): any[] {
  return fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
}

// Replace the SocialService method so the test can assert whether the wire
// gates let the command through to the service at all (the service's own
// rank/clamp logic is covered by tests/social_system.test.ts).
function spyMotd(server: GameServer) {
  const spy = vi.fn(async (_actor: { characterId: number; name: string }, _text: string) => {});
  (server as any).social.guildSetMotd = spy;
  return spy;
}

describe('guild_set_motd wire gates', () => {
  it('clean text passes the gates and reaches the service with the actor + text', () => {
    const server = new GameServer();
    const spy = spyMotd(server);
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Officiala');
    sendMotd(server, session, 'Raid night Friday. Discord: discord.gg/example');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ characterId: 1, name: 'Officiala' });
    expect(spy.mock.calls[0][1]).toBe('Raid night Friday. Discord: discord.gg/example');
  });

  it('an admin-muted session is blocked before the service is called', () => {
    const server = new GameServer();
    const spy = spyMotd(server);
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Muted');
    session.chatMutedUntil = Date.now() + 60_000;
    sendMotd(server, session, 'sneaking past the mute');
    expect(spy).not.toHaveBeenCalled();
    expect(eventsOf(fc)).toContainEqual(
      expect.objectContaining({ type: 'error', text: expect.stringContaining('muted') }),
    );
  });

  it('the chat rate limiter blocks the command while chat is on cooldown', () => {
    const server = new GameServer();
    const spy = spyMotd(server);
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Spammy');
    session.chatCooldownUntil = Date.now() / 1000 + 30;
    sendMotd(server, session, 'rate limited billboard');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a hard-word (slur) billboard is blocked by the chat policy gate', () => {
    const server = new GameServer();
    server.chatFilter.load({
      soft: [],
      hard: ['slurword'],
      config: { warningsBeforeMute: 1, muteLadderSeconds: [600] },
    });
    const spy = spyMotd(server);
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Edgy');
    sendMotd(server, session, 'welcome you slurword');
    expect(spy).not.toHaveBeenCalled();
    expect(eventsOf(fc)).toContainEqual(
      expect.objectContaining({ type: 'error', text: expect.stringContaining('Warning') }),
    );
  });

  it('a non-string text payload is ignored entirely', () => {
    const server = new GameServer();
    const spy = spyMotd(server);
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Fuzzer');
    sendMotd(server, session, 42);
    sendMotd(server, session, null);
    sendMotd(server, session, { nested: 'object' });
    expect(spy).not.toHaveBeenCalled();
  });
});
