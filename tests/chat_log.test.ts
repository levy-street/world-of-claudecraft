import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  insertChatLogs: vi.fn(async () => {}),
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { ChatLogger, type ChatLogRow } from '../server/chat_log';
import { GameServer } from '../server/game';
import { MAX_CHAT_MESSAGE_LEN, Sim } from '../src/sim/sim';

function row(message: string, channel = 'say'): ChatLogRow {
  return { accountId: 1, characterId: 2, characterName: 'Zyx', channel, message };
}

describe('sent chat normalization', () => {
  function makeWorld() {
    return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  }

  it('captures plain text and /say as say', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(sim.chat('hello world', a)).toEqual({ channel: 'say', message: 'hello world' });
    expect(sim.chat('/say hello again', a)).toEqual({ channel: 'say', message: 'hello again' });
  });

  it('captures /yell as yell', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(sim.chat('/y Over here!', a)).toEqual({ channel: 'yell', message: 'Over here!' });
  });

  it('captures /general as general', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(sim.chat('/general LFG crypt', a)).toEqual({ channel: 'general', message: 'LFG crypt' });
  });

  it('captures /whisper as whisper only when the target is valid', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    expect(sim.chat('/w bet psst', a)).toEqual({
      channel: 'whisper',
      message: 'psst',
      target: 'Bet',
    });
    expect(sim.chat('/w nobody psst', a)).toBeNull();
  });

  it('captures /party only for party members', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    expect(sim.chat('/p before party', a)).toBeNull();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.chat('/p inc on the left', a)).toEqual({
      channel: 'party',
      message: 'inc on the left',
    });
  });

  it('does not capture discarded, unknown, or throttled messages', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(sim.chat('', a)).toBeNull();
    expect(sim.chat('   ', a)).toBeNull();
    expect(sim.chat('/dance', a)).toBeNull();

    let throttled = false;
    for (let i = 0; i < 40; i++) {
      const sent = sim.chat('/general spam ' + i, a);
      sim.tick();
      if (!sent) throttled = true;
    }
    expect(throttled).toBe(true);
  });

  it('caps captured messages at MAX_CHAT_MESSAGE_LEN characters like Sim.chat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const sent = sim.chat('x'.repeat(500), a);
    expect(sent?.message.length).toBe(MAX_CHAT_MESSAGE_LEN);
  });
});

describe('GameServer chat logging', () => {
  function fakeWs() {
    const sent: unknown[] = [];
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

  it('persists accepted chat sends with normalized channel and message only', () => {
    const server = new GameServer();
    const aWs = fakeWs();
    const bWs = fakeWs();
    const a = server.join(aWs.ws, 11, 101, 'Aleph', 'warrior', null);
    const b = server.join(bWs.ws, 22, 202, 'Bet', 'mage', null);
    if ('error' in a || 'error' in b) throw new Error('join failed');

    const logSpy = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    const sendChat = (text: string) =>
      server.handleMessage(a, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));

    sendChat('hello world');
    sendChat('/y Over here');
    sendChat('/general LFG crypt');
    sendChat('/w bet psst');
    server.sim.partyInvite(b.pid, a.pid);
    server.sim.partyAccept(b.pid);
    sendChat('/p party only');
    sendChat('/dance');
    sendChat('/w nobody no leak');

    expect(logSpy.mock.calls.map(([r]) => ({ channel: r.channel, message: r.message }))).toEqual([
      { channel: 'say', message: 'hello world' },
      { channel: 'yell', message: 'Over here' },
      { channel: 'general', message: 'LFG crypt' },
      { channel: 'whisper', message: 'psst' },
      { channel: 'party', message: 'party only' },
    ]);
    expect(
      logSpy.mock.calls.every(
        ([r]) => r.accountId === 11 && r.characterId === 101 && r.characterName === 'Aleph',
      ),
    ).toBe(true);
  });

  it('routes /g through guild chat and remembers guild for plain follow-up messages', async () => {
    const server = new GameServer();
    const aWs = fakeWs();
    const a = server.join(aWs.ws, 11, 101, 'Aleph', 'warrior', null);
    if ('error' in a) throw new Error('join failed');

    const guildSpy = vi.spyOn(server.social, 'guildChat').mockResolvedValue(true);
    const logSpy = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    const sendChat = (text: string) =>
      server.handleMessage(a, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));

    sendChat('/g hello guild');
    sendChat('still guild');
    await Promise.resolve();

    expect(guildSpy.mock.calls.map(([, text]) => text)).toEqual(['hello guild', 'still guild']);
    expect(logSpy.mock.calls.map(([r]) => ({ channel: r.channel, message: r.message }))).toEqual([
      { channel: 'guild', message: 'hello guild' },
      { channel: 'guild', message: 'still guild' },
    ]);
  });

  it('remembers the last explicit whisper target for plain follow-up messages', () => {
    const server = new GameServer();
    const aWs = fakeWs();
    const bWs = fakeWs();
    const a = server.join(aWs.ws, 11, 101, 'Aleph', 'warrior', null);
    const b = server.join(bWs.ws, 22, 202, 'Bet', 'mage', null);
    if ('error' in a || 'error' in b) throw new Error('join failed');

    const logSpy = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});
    const sendChat = (text: string) =>
      server.handleMessage(a, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));

    sendChat('/w Bet first');
    sendChat('second');

    expect(logSpy.mock.calls.map(([r]) => ({ channel: r.channel, message: r.message }))).toEqual([
      { channel: 'whisper', message: 'first' },
      { channel: 'whisper', message: 'second' },
    ]);
  });

  it('blocks chat from muted accounts and shows the mute warning', () => {
    const server = new GameServer();
    const aWs = fakeWs();
    const a = server.join(aWs.ws, 11, 101, 'Aleph', 'warrior', null, false, {
      mutedUntil: new Date(Date.now() + 3600_000).toISOString(),
      reason: 'keep chat civil',
    } as any);
    if ('error' in a) throw new Error('join failed');

    const logSpy = vi.spyOn(server.chatLog, 'log').mockImplementation(() => {});

    server.handleMessage(a, JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'hello world' }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(
      aWs.sent.some(
        (msg: any) =>
          msg.t === 'events' &&
          msg.list?.some(
            (ev: any) =>
              ev.type === 'error' &&
              /muted from chat/i.test(ev.text) &&
              /keep chat civil/i.test(ev.text),
          ),
      ),
    ).toBe(true);
  });
});

describe('ChatLogger', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches rows and flushes on the timer', async () => {
    const writes: ChatLogRow[][] = [];
    const logger = new ChatLogger(async (rows) => {
      writes.push(rows);
    });
    logger.log(row('one'));
    logger.log(row('two'));
    expect(writes).toHaveLength(0); // nothing written yet
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(1);
    expect(writes[0].map((r) => r.message)).toEqual(['one', 'two']);
  });

  it('flushes early once 100 rows are buffered', async () => {
    const writes: ChatLogRow[][] = [];
    const logger = new ChatLogger(async (rows) => {
      writes.push(rows);
    });
    for (let i = 0; i < 100; i++) logger.log(row(`m${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(100);
  });

  it('stop() flushes whatever is left', async () => {
    const writes: ChatLogRow[][] = [];
    const logger = new ChatLogger(async (rows) => {
      writes.push(rows);
    });
    logger.log(row('last words'));
    await logger.stop();
    expect(writes).toHaveLength(1);
    expect(writes[0][0].message).toBe('last words');
  });

  it('re-queues rows when the write fails, then retries', async () => {
    const writes: ChatLogRow[][] = [];
    let fail = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new ChatLogger(async (rows) => {
      if (fail) throw new Error('db down');
      writes.push(rows);
    });
    logger.log(row('survives the outage'));
    await vi.advanceTimersByTimeAsync(5000); // first flush fails, row re-queued
    expect(writes).toHaveLength(0);
    fail = false;
    await vi.advanceTimersByTimeAsync(5000); // retry succeeds
    expect(writes).toHaveLength(1);
    expect(writes[0][0].message).toBe('survives the outage');
    errSpy.mockRestore();
  });

  it('caps the buffer so an unreachable DB cannot grow memory forever', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const written: ChatLogRow[][] = [];
    let fail = true;
    const logger = new ChatLogger(async (rows) => {
      if (fail) throw new Error('db down');
      written.push(rows);
    });
    for (let i = 0; i < 6000; i++) {
      logger.log(row(`m${i}`));
      await vi.advanceTimersByTimeAsync(0); // let threshold flushes run (and fail)
    }
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    const total = written.flat().length;
    expect(total).toBeLessThanOrEqual(5000);
    expect(total).toBeGreaterThan(0);
    errSpy.mockRestore();
  });
});
