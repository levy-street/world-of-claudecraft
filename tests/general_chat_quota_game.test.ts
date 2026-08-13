import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { consumeQuota } = vi.hoisted(() => ({ consumeQuota: vi.fn() }));

vi.mock('../server/general_chat_quota_db', () => ({
  consumeGeneralChatQuota: consumeQuota,
}));

vi.mock('../server/db', () => ({
  DB_POOL_MAX_CLIENTS: 10,
  GUILD_BANK_ROW_MAX_BYTES: 1_000_000,
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  insertChatLogs: vi.fn(async () => {}),
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({ weaponSkinIds: [], weaponSkinLoadout: {} })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
}));

import { type ClientSession, GameServer } from '../server/game';
import { noopGameMetricsCounters, setGameMetricsCounters } from '../server/http/game_signals';

function fakeWs() {
  const sent: any[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
      on: vi.fn(),
      once: vi.fn(),
      close: vi.fn(),
    } as any,
  };
}

function joinConfigured(server: GameServer, id: number, name: string) {
  const client = fakeWs();
  const session = server.join(client.ws, id, id, name, 'warrior', null, false, {
    generalChatRateLimit: { messages: 1, windowMinutes: 1 },
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { client, session };
}

function send(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

beforeEach(() => {
  consumeQuota.mockReset();
});

afterEach(() => {
  setGameMetricsCounters(noopGameMetricsCounters);
  vi.restoreAllMocks();
});

describe('GameServer General quota authority', () => {
  it('denies sender-only with structured fallback and performs no chat side effects', async () => {
    consumeQuota.mockResolvedValue({ status: 'denied', retryAfterSeconds: 42 });
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    const observer = joinConfigured(server, 22, 'Bet');
    sender.client.sent.length = 0;
    observer.client.sent.length = 0;
    const simChat = vi.spyOn(server.sim, 'chat');
    const chatLog = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    const chatMessage = vi.fn();
    const generalChatQuota = vi.fn();
    setGameMetricsCounters({ ...noopGameMetricsCounters, chatMessage, generalChatQuota });

    send(server, sender.session, '/general hello');
    await vi.waitFor(() => expect(generalChatQuota).toHaveBeenCalledWith('denied'));

    expect(consumeQuota).toHaveBeenCalledWith(11);
    expect(simChat).not.toHaveBeenCalled();
    expect(chatLog).not.toHaveBeenCalled();
    expect(chatMessage).not.toHaveBeenCalled();
    expect(sender.session.chatTokens).toBe(5);
    expect(
      observer.client.sent.flatMap((frame) => (frame.t === 'events' ? frame.list : [])),
    ).not.toContainEqual(expect.objectContaining({ type: 'chat' }));
    expect(sender.client.sent).toContainEqual({
      t: 'events',
      list: [
        {
          type: 'error',
          text: 'General chat limit reached. Try again in 42 seconds.',
          code: 'general_chat_quota',
          channel: 'general',
          retryAfterSeconds: 42,
        },
      ],
    });
  });

  it('cached repeated denials do not escalate the all-chat cooldown or block whisper', async () => {
    consumeQuota.mockResolvedValue({ status: 'denied', retryAfterSeconds: 42 });
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    joinConfigured(server, 22, 'Bet');
    const chatLog = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});

    send(server, sender.session, '/general first');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledOnce());
    send(server, sender.session, '/general second');
    send(server, sender.session, '/w Bet still usable');

    expect(consumeQuota).toHaveBeenCalledOnce();
    expect(sender.session.chatRateViolations).toBe(0);
    expect(sender.session.chatCooldownUntil).toBe(0);
    expect(chatLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whisper', message: 'still usable' }),
    );
  });

  it('never broadcasts an allowed completion after the captured session becomes linkdead', async () => {
    let resolve!: (result: { status: 'allowed' }) => void;
    consumeQuota.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    const simChat = vi.spyOn(server.sim, 'chat');
    const chatLog = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    const generalChatQuota = vi.fn();
    setGameMetricsCounters({ ...noopGameMetricsCounters, generalChatQuota });

    send(server, sender.session, '/general pending');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledOnce());
    sender.session.linkdead = true;
    resolve({ status: 'allowed' });
    // The consume already spent a quota unit that reached nobody, so the
    // outcome is recorded as 'dropped' and the labels still sum to attempts.
    await vi.waitFor(() => expect(generalChatQuota).toHaveBeenCalledWith('dropped'));

    expect(simChat).not.toHaveBeenCalled();
    expect(chatLog).not.toHaveBeenCalled();
    expect(sender.session.chatTokens).toBe(5);
  });

  it('refuses an overlapping same-account send as pending without the unavailable lockout', async () => {
    const resolvers: Array<(result: { status: 'allowed' }) => void> = [];
    consumeQuota.mockImplementation(() => new Promise((done) => resolvers.push(done)));
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    const simChat = vi.spyOn(server.sim, 'chat');
    vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    sender.client.sent.length = 0;

    send(server, sender.session, '/general first');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledOnce());
    send(server, sender.session, '/general second');
    await vi.waitFor(() =>
      expect(sender.client.sent).toContainEqual({
        t: 'events',
        list: [
          {
            type: 'error',
            text: 'Your previous General chat message is still sending. Try again in a moment.',
            code: 'general_chat_quota_pending',
            channel: 'general',
            retryAfterSeconds: 1,
          },
        ],
      }),
    );
    expect(consumeQuota).toHaveBeenCalledOnce();

    resolvers.shift()?.({ status: 'allowed' });
    await vi.waitFor(() =>
      expect(simChat).toHaveBeenCalledWith('/general first', sender.session.pid),
    );
    // The healthy overlap refusal never arms the 1-second unavailable cache:
    // the very next send reaches the quota database immediately.
    send(server, sender.session, '/general third');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledTimes(2));
    resolvers.shift()?.({ status: 'allowed' });
    await vi.waitFor(() =>
      expect(simChat).toHaveBeenCalledWith('/general third', sender.session.pid),
    );
  });

  it('still sets the General sticky channel when an unrelated command ran mid-flight', async () => {
    let resolve!: (result: { status: 'allowed' }) => void;
    consumeQuota.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});

    send(server, sender.session, '/general hello');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledOnce());
    // /who is command work, not a channel selection: it must not trip the
    // sticky-channel fence the way it advanced the old whole-case counter.
    send(server, sender.session, '/who');
    resolve({ status: 'allowed' });

    await vi.waitFor(() => expect(sender.session.rememberedChat).toEqual({ channel: 'general' }));
  });

  it('does not rewrite a newer sticky channel selected while the send was in flight', async () => {
    let resolve!: (result: { status: 'allowed' }) => void;
    consumeQuota.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    joinConfigured(server, 22, 'Bet');
    const simChat = vi.spyOn(server.sim, 'chat');
    vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});

    send(server, sender.session, '/general hello');
    await vi.waitFor(() => expect(consumeQuota).toHaveBeenCalledOnce());
    send(server, sender.session, '/w Bet newer selection');
    expect(sender.session.rememberedChat).toMatchObject({ channel: 'whisper' });
    resolve({ status: 'allowed' });
    await vi.waitFor(() =>
      expect(simChat).toHaveBeenCalledWith('/general hello', sender.session.pid),
    );

    // The broadcast still went out, but the newer whisper selection survives.
    expect(sender.session.rememberedChat).toMatchObject({ channel: 'whisper' });
  });

  it('does no quota database work when the ordinary chat limiter already refuses', () => {
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    sender.session.chatTokens = 0;
    sender.session.chatLastRefill = Date.now() / 1_000;

    send(server, sender.session, '/general first');
    send(server, sender.session, '/general second');
    send(server, sender.session, '/general third');

    expect(consumeQuota).not.toHaveBeenCalled();
    expect(sender.session.chatCooldownUntil).toBeGreaterThan(Date.now() / 1_000);
  });

  it('keeps guild aliases synchronous and exempt for a configured account', async () => {
    const server = new GameServer();
    const sender = joinConfigured(server, 11, 'Aleph');
    const guildChat = vi.spyOn(server.social, 'guildChat').mockResolvedValue(true);
    vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});

    send(server, sender.session, '/g guild line');
    await vi.waitFor(() => expect(guildChat).toHaveBeenCalled());
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it('applies a reconnect resync only to the exact account snapshot it queried', () => {
    const server = new GameServer();
    const queried = joinConfigured(server, 22, 'Queried');
    const joinedAfterSnapshot = joinConfigured(server, 33, 'Later');

    server.resyncGeneralChatRateLimits([22], new Map());

    expect(queried.session.generalChatRateLimit).toBeNull();
    expect(joinedAfterSnapshot.session.generalChatRateLimit).toEqual({
      messages: 1,
      windowMinutes: 1,
    });
  });

  it('pins rememberChatChannel as the only sticky-channel writer, keeping the fence sound', () => {
    const source = readFileSync(resolve(process.cwd(), 'server/game.ts'), 'utf8');
    // The async General path is fenced by chatChannelSequence, which only
    // rememberChatChannel advances. A direct `session.rememberedChat = ...`
    // write anywhere else would move the sticky channel without advancing the
    // fence, silently breaking the newer-selection guarantee, so the single
    // permitted assignment is the one inside the helper (the session literal
    // initializer uses `rememberedChat:` and is not an assignment).
    const writes = [...source.matchAll(/rememberedChat\s*=[^=]/g)];
    expect(writes).toHaveLength(1);
    const helperStart = source.indexOf('private rememberChatChannel(');
    expect(helperStart).toBeGreaterThan(-1);
    expect(source.slice(helperStart, helperStart + 300)).toContain(
      'session.rememberedChat = value',
    );
  });
});
