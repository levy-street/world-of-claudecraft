import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { zoneAt } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import * as chatMod from '../src/sim/social/chat';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function chatEvents(events: SimEvent[]): Extract<SimEvent, { type: 'chat' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'chat' }> => e.type === 'chat');
}

describe('chat channels', () => {
  it('say reaches only players within SAY_RANGE and carries the speaker', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const near = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, near, 10, -40); // within 25
    teleport(sim, far, 60, -40); // beyond 25
    sim.tick();

    sim.chat('Hello there', a);
    const msgs = chatEvents(sim.tick());
    expect(
      msgs.every((m) => m.channel === 'say' && m.entityId === a && m.text === 'Hello there'),
    ).toBe(true);
    const pids = msgs.map((m) => m.pid).sort();
    expect(pids).toContain(a); // speaker hears themselves
    expect(pids).toContain(near);
    expect(pids).not.toContain(far);
  });

  it('yell carries further than say but not world-wide', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mid = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, mid, 60, -40); // beyond say(25), within yell(100)
    teleport(sim, far, 0, -400); // beyond yell
    sim.tick();

    sim.chat('/y Over here!', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((m) => m.channel === 'yell' && m.text === 'Over here!')).toBe(true);
    const pids = msgs.map((m) => m.pid);
    expect(pids).toContain(mid);
    expect(pids).not.toContain(far);
  });

  it('whisper reaches only the target plus a sender echo', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 0, -900); // whisper ignores distance
    teleport(sim, c, 2, -40);
    sim.tick();

    sim.chat('/w bet psst, secret', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs).toHaveLength(2);
    const toTarget = msgs.find((m) => m.pid === b)!;
    expect(toTarget.channel).toBe('whisper');
    expect(toTarget.from).toBe('Aleph');
    expect(toTarget.text).toBe('psst, secret');
    expect(toTarget.to).toBeUndefined();
    const echo = msgs.find((m) => m.pid === a)!;
    expect(echo.to).toBe('Bet');
    expect(msgs.some((m) => m.pid === c)).toBe(false);
  });

  it('/r replies to the last player who whispered you', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, b, 0, -900); // reply ignores distance, like whisper
    sim.tick();

    sim.chat('/w bet psst, secret', a);
    sim.tick();
    // Bet replies without naming Aleph
    sim.chat('/r got it', b);
    const msgs = chatEvents(sim.tick());
    expect(msgs).toHaveLength(2);
    const toTarget = msgs.find((m) => m.pid === a)!;
    expect(toTarget.channel).toBe('whisper');
    expect(toTarget.from).toBe('Bet');
    expect(toTarget.text).toBe('got it');
    const echo = msgs.find((m) => m.pid === b)!;
    expect(echo.to).toBe('Aleph');
  });

  it('/r with no prior whisper errors instead of saying it out loud', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/r hello?', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('/r reply target follows the most recent incoming whisper', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.tick();

    sim.chat('/w aleph first', b); // Bet -> Aleph
    sim.tick();
    sim.chat('/w aleph second', c); // Gimel -> Aleph (now the reply target)
    sim.tick();
    sim.chat('/r back to you', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.channel === 'whisper' && m.to === undefined)!;
    expect(toTarget.pid).toBe(c);
  });

  it('sending a whisper does not change your own /r target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.addPlayer('rogue', 'Gimel');
    sim.tick();

    sim.chat('/w aleph incoming', b); // Bet whispers Aleph -> Aleph's reply target is Bet
    sim.tick();
    sim.chat('/w gimel outgoing', a); // Aleph whispers Gimel; reply target stays Bet
    sim.tick();
    sim.chat('/r still bet', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.channel === 'whisper' && m.to === undefined)!;
    expect(toTarget.pid).toBe(b);
  });

  it('whisper to an unknown player errors instead of leaking text', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/w nobody hello?', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && e.text.includes('nobody'))).toBe(true);
  });

  it('whispering yourself is rejected', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/w aleph echo echo', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('general is a single world-wide broadcast without a pid', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const far = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, far, 0, -900);
    sim.tick();

    sim.chat('/g LFG crypt', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs).toHaveLength(1);
    expect(msgs[0].channel).toBe('general');
    expect(msgs[0].pid).toBeUndefined(); // no pid = routed to everyone
    expect(msgs[0].text).toBe('LFG crypt');
  });

  it('unknown slash commands error instead of being said out loud', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/wiggle', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && e.text.includes('/wiggle'))).toBe(true);
  });

  it('/who explains that the roster is online-only in offline sim play', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/who', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'The /who roster is available in online play.',
      }),
    );
  });

  it('/help lists the chat commands as system notices without sending chat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/help', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    const help = events.filter((e) => e.type === 'error' && e.pid === a) as Extract<
      SimEvent,
      { type: 'error' }
    >[];
    expect(help.length).toBeGreaterThan(0);
    const text = help.map((e) => e.text).join('\n');
    expect(text).toContain('/w <name> <message>');
    expect(text).toContain('/who');
  });

  it('/? and /commands are aliases for /help', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const cmd of ['/?', '/commands']) {
      sim.chat(cmd, a);
      const events = sim.tick();
      expect(chatEvents(events)).toHaveLength(0);
      expect(events.some((e) => e.type === 'error' && e.pid === a)).toBe(true);
    }
  });

  it('an unknown slash command points the player at /help', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/bogus stuff', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && e.pid === a && e.text.includes('/help'))).toBe(
      true,
    );
  });

  it('/played reports zero on a freshly joined character', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.tick();
    sim.chat('/played', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        pid: a,
        text: 'Time played this session: 0s.',
      }),
    );
  });

  it("/where reports the caller's zone, level range, and coordinates", () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 12, -340);
    sim.tick();
    const zone = zoneAt(-340);
    const [lo, hi] = zone.levelRange;
    sim.chat('/where', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        pid: a,
        text: `You are in ${zone.name} (levels ${lo}–${hi}) at (12, -340).`,
      }),
    );
  });

  it('/played accumulates session time as the sim advances', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    // 20 ticks per sim-second; advance just over a minute of world time
    for (let i = 0; i < 20 * 65; i++) sim.tick();
    sim.chat('/played', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    const played = events.find(
      (e): e is Extract<SimEvent, { type: 'error' }> =>
        e.type === 'error' && e.text.startsWith('Time played'),
    );
    // once past a minute the line switches to "Xm Ys" form
    expect(played?.text).toMatch(/^Time played this session: 1m \d+s\.$/);
  });

  it('/where accepts the /loc and /zone aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.tick();
    const expected = `You are in ${zoneAt(-40).name}`;
    for (const cmd of ['/loc', '/zone']) {
      sim.chat(cmd, a);
      const events = sim.tick();
      expect(chatEvents(events)).toHaveLength(0);
      expect(events.some((e) => e.type === 'error' && e.text.startsWith(expected))).toBe(true);
    }
  });

  it('exact-case whisper wins over a case-variant squatter', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const squatter = sim.addPlayer('mage', 'bet'); // joins first, lowercase
    const real = sim.addPlayer('rogue', 'Bet'); // the intended target
    teleport(sim, a, 0, -40);
    sim.tick();
    sim.chat('/w Bet exact match', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.pid !== a);
    expect(toTarget!.pid).toBe(real);
    expect(toTarget!.pid).not.toBe(squatter);
  });

  it('whisper resolves the longest online name so spaced names are not misdelivered', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const short = sim.addPlayer('mage', 'Bob');
    const spaced = sim.addPlayer('rogue', 'Bob Smith');
    teleport(sim, a, 0, -40);
    sim.tick();

    const sent = sim.chat('/w Bob Smith meet at the crypt', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.pid !== a);
    const echo = msgs.find((m) => m.pid === a);

    expect(sent).toEqual({ channel: 'whisper', message: 'meet at the crypt', target: 'Bob Smith' });
    expect(toTarget!.pid).toBe(spaced);
    expect(toTarget!.pid).not.toBe(short);
    expect(echo!.to).toBe('Bob Smith');
  });

  it('whisper resolves spaced names case-insensitively only when unambiguous', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const spaced = sim.addPlayer('rogue', 'Bob Smith');
    teleport(sim, a, 0, -40);
    sim.tick();

    const sent = sim.chat('/w bob smith lowercase works', a);
    const msgs = chatEvents(sim.tick());

    expect(sent).toEqual({ channel: 'whisper', message: 'lowercase works', target: 'Bob Smith' });
    expect(msgs.find((m) => m.pid !== a)!.pid).toBe(spaced);
  });

  it('a shorter exact-case name does not intercept a longer spaced case-insensitive match', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const short = sim.addPlayer('mage', 'Bob');
    const spaced = sim.addPlayer('rogue', 'bob smith');
    teleport(sim, a, 0, -40);
    sim.tick();

    const sent = sim.chat('/w Bob Smith mixed case target', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.pid !== a);

    expect(sent).toEqual({ channel: 'whisper', message: 'mixed case target', target: 'bob smith' });
    expect(toTarget!.pid).toBe(spaced);
    expect(toTarget!.pid).not.toBe(short);
  });

  it('ambiguous case-insensitive whisper is refused, not misdelivered', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    sim.addPlayer('rogue', 'bet');
    teleport(sim, a, 0, -40);
    sim.tick();
    sim.chat('/w BET ambiguous', a); // matches neither exactly
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && /capitalization/i.test(e.text))).toBe(true);
  });

  it('throttles a chat flood after the burst is spent', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.tick();
    let delivered = 0;
    let throttled = false;
    for (let i = 0; i < 40; i++) {
      sim.chat('/g spam ' + i, a);
      const events = sim.tick(); // ~0.05s of refill per tick
      if (events.some((e) => e.type === 'chat')) delivered++;
      if (events.some((e) => e.type === 'error' && /too quickly/i.test(e.text))) throttled = true;
    }
    expect(throttled).toBe(true);
    // 40 messages over ~2s of sim time: burst(8) + refill(2/s) is far below 40
    expect(delivered).toBeLessThan(20);
  });

  it('a joined player hears /world only from other joined players', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const outsider = sim.addPlayer('rogue', 'Gimel');
    // distance must not matter for a global channel
    teleport(sim, a, 0, -40);
    teleport(sim, b, 0, -900);
    teleport(sim, outsider, 2, -40);
    sim.tick();
    sim.chat('/join world', a);
    sim.chat('/join world', b);
    sim.tick();

    sim.chat('/world anyone for the crypt?', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((m) => m.channel === 'world' && m.text === 'anyone for the crypt?')).toBe(
      true,
    );
    const pids = msgs.map((m) => m.pid).sort();
    expect(pids).toContain(a); // sender hears their own message
    expect(pids).toContain(b); // joined, ignores distance
    expect(pids).not.toContain(outsider); // never joined → never hears it
  });

  it('talking in a channel you have not joined errors instead of broadcasting', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/world hello?', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && /not in the world channel/i.test(e.text))).toBe(
      true,
    );
  });

  it('/leave stops further delivery on that channel', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.chat('/join world', a);
    sim.chat('/join world', b);
    sim.tick();
    sim.chat('/leave world', b);
    sim.tick();

    sim.chat('/world still around?', a);
    const pids = chatEvents(sim.tick()).map((m) => m.pid);
    expect(pids).toContain(a);
    expect(pids).not.toContain(b); // left the channel
  });

  it('world and lfg are independent channels', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.chat('/join world', a);
    sim.chat('/join lfg', a);
    sim.chat('/join lfg', b); // b is only in lfg, not world
    sim.tick();

    sim.chat('/world world only', a);
    const worldPids = chatEvents(sim.tick()).map((m) => m.pid);
    expect(worldPids).toContain(a);
    expect(worldPids).not.toContain(b);

    sim.chat('/lfg lfg only', a);
    const lfgMsgs = chatEvents(sim.tick());
    expect(lfgMsgs.every((m) => m.channel === 'lfg')).toBe(true);
    const lfgPids = lfgMsgs.map((m) => m.pid);
    expect(lfgPids).toContain(a);
    expect(lfgPids).toContain(b);
  });

  it('/join confirms with a chat-log notice', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/join world', a);
    const events = sim.tick();
    expect(
      events.some(
        (e) => e.type === 'log' && e.pid === a && /joined the world channel/i.test(e.text),
      ),
    ).toBe(true);
  });

  it('/join rejects unknown channels and the always-on general channel', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/join nonsense', a);
    sim.chat('/join general', a);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /no channel named/i.test(e.text))).toBe(true);
    expect(
      events.some((e) => e.type === 'error' && /general channel is always on/i.test(e.text)),
    ).toBe(true);
    expect(chatEvents(events)).toHaveLength(0); // nothing said out loud
  });

  it('a player who leaves the game is dropped from channel rosters', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.chat('/join world', a);
    sim.chat('/join world', b);
    sim.tick();
    sim.removePlayer(b);

    sim.chat('/world anyone left?', a);
    const pids = chatEvents(sim.tick()).map((m) => m.pid);
    expect(pids).toEqual([a]); // only the remaining subscriber
  });

  it('party channel still works and stays private to the party', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const outsider = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 2, -40);
    teleport(sim, outsider, 4, -40);
    sim.tick();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.tick();

    sim.chat('/p inv pls', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((m) => m.channel === 'party')).toBe(true);
    const pids = msgs.map((m) => m.pid);
    expect(pids).toContain(a);
    expect(pids).toContain(b);
    expect(pids).not.toContain(outsider);
  });

  it('/roll broadcasts a deterministic result in the default 1-100 range to nearby players', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const near = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, near, 10, -40); // within SAY_RANGE
    teleport(sim, far, 80, -40); // beyond SAY_RANGE
    sim.tick();

    sim.chat('/roll', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.channel === 'roll' && m.from === 'Aleph')).toBe(true);
    // text is "<result> (1-100)" with the result inside the range
    const m = /^(\d+) \(1-100\)$/.exec(msgs[0].text)!;
    expect(m).not.toBeNull();
    const result = Number(m[1]);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(100);
    const pids = msgs.map((x) => x.pid);
    expect(pids).toContain(a); // roller sees their own roll
    expect(pids).toContain(near);
    expect(pids).not.toContain(far);
  });

  it('/roll N rolls within 1-N and /roll M-N within the given bounds', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.tick();

    sim.chat('/roll 6', a);
    let msgs = chatEvents(sim.tick());
    let m = /^(\d+) \(1-6\)$/.exec(msgs[0].text)!;
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1);
    expect(Number(m[1])).toBeLessThanOrEqual(6);

    sim.chat('/roll 50-60', a);
    msgs = chatEvents(sim.tick());
    m = /^(\d+) \(50-60\)$/.exec(msgs[0].text)!;
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(50);
    expect(Number(m[1])).toBeLessThanOrEqual(60);
  });

  it('/roll prefers the party channel when the roller is grouped', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const outsider = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 0, -900); // out of say range but in the party
    teleport(sim, outsider, 2, -40);
    sim.tick();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.tick();

    sim.chat('/roll', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((x) => x.channel === 'roll')).toBe(true);
    const pids = msgs.map((x) => x.pid);
    expect(pids).toContain(a);
    expect(pids).toContain(b); // distant party member still sees it
    expect(pids).not.toContain(outsider); // a nearby non-member does not
  });

  it('rejects a malformed roll range instead of saying it out loud', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, -40);
    sim.tick();
    sim.chat('/roll 60-50', a); // min greater than max
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('emotes', () => {
  it('a predefined emote reaches everyone in say range with third-person text', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const near = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, near, 10, -40); // within say range
    teleport(sim, far, 60, -40); // beyond say range
    sim.tick();

    sim.chat('/wave', a);
    const msgs = chatEvents(sim.tick());
    expect(
      msgs.every((m) => m.channel === 'emote' && m.from === 'Aleph' && m.text === 'waves.'),
    ).toBe(true);
    const pids = msgs.map((m) => m.pid).sort();
    expect(pids).toContain(a); // the actor sees their own emote
    expect(pids).toContain(near);
    expect(pids).not.toContain(far);
  });

  it('a targeted emote names an online player', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 10, -40);
    sim.tick();

    sim.chat('/bow Bet', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs[0].channel).toBe('emote');
    expect(msgs[0].text).toBe('bows before Bet.');
  });

  it('a targeted emote falls back to the solo form for an unknown name', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/cheer Nobody', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs[0].text).toBe('cheers!');
  });

  it('emote aliases resolve to the canonical emote', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/hi', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs[0].text).toBe('greets everyone with a hearty hello.');
  });

  it('/me broadcasts freeform action text', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/me ponders the void', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs[0].channel).toBe('emote');
    expect(msgs[0].from).toBe('Aleph');
    expect(msgs[0].text).toBe('ponders the void');
  });

  it('an empty /me does nothing', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/me   ', a);
    const events = sim.tick();
    expect(chatEvents(events)).toHaveLength(0);
    // a bare "/me" with no body is an unknown command
    sim.chat('/me', a);
    const events2 = sim.tick();
    expect(events2.some((e) => e.type === 'error')).toBe(true);
  });

  it('sets and expires a network-visible overhead emote without chat spam', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.playEmote('laugh', a);
    expect(sim.entities.get(a)?.overheadEmoteId).toBe('laugh');
    expect(sim.entities.get(a)?.overheadEmoteSeq).toBe(1);
    sim.playEmote('laugh', a);
    expect(sim.entities.get(a)?.overheadEmoteSeq).toBe(2);
    expect(chatEvents(sim.tick())).toHaveLength(0);
    for (let i = 0; i < 70; i++) sim.tick();
    expect(sim.entities.get(a)?.overheadEmoteId).toBeNull();
  });
});

describe('trade completion event', () => {
  it('emits tradeDone to both sides when the trade executes', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 1, a);
    sim.tick();

    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 1 }], 0, a);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    const events = sim.tick();
    const done = events.filter((e) => e.type === 'tradeDone');
    expect(done.map((e) => e.pid).sort()).toEqual([a, b].sort());
  });
});

describe('snapshot interpolation continuity', () => {
  function bareClient(pid: number): any {
    const c: any = Object.create(ClientWorld.prototype);
    c.cfg = { seed: 42, playerClass: 'warrior' };
    c.entities = new Map();
    c.playerId = pid;
    c.inventory = [];
    c.equipment = {};
    c.copper = 0;
    c.xp = 0;
    c.known = [];
    c.questLog = new Map();
    c.questsDone = new Set();
    c.partyInfo = null;
    c.tradeInfo = null;
    c.duelInfo = null;
    c.lastSnapAt = 0;
    c.snapInterval = 50;
    c.pendingFacingDelta = 0;
    c.connected = true;
    c.eventQueue = [];
    c.mouselookFacing = null;
    return c;
  }

  const wire = (id: number, x: number) => ({
    id,
    k: 'player',
    tid: 'warrior',
    nm: 'Runner',
    lv: 1,
    x,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
  });

  it('re-anchors prevPos at the rendered pose instead of the last server pose', () => {
    const c = bareClient(7);
    const self = (x: number) => ({
      ...wire(7, x),
      res: 0,
      mres: 100,
      rtype: 'mana',
      xp: 0,
      copper: 0,
      inv: [],
      equip: {},
      qlog: [],
      qdone: [],
      cds: {},
      gcd: 0,
      stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
      weapon: { min: 1, max: 2, speed: 2 },
    });
    c.applySnapshot({ t: 'snap', tick: 1, time: 0, self: self(0), ents: [] });
    const e = c.entities.get(7);
    // second snapshot lands: the player moved server-side from x=0 to x=10
    c.applySnapshot({ t: 'snap', tick: 2, time: 0.05, self: self(10), ents: [] });
    // third snapshot from x=10 to x=20: prevPos must sit on the segment the
    // renderer was drawing (between 0 and 10, or slightly past 10 when the
    // frame extrapolated) — never reset all the way back to the old pose
    // unless no time passed at all
    c.applySnapshot({ t: 'snap', tick: 3, time: 0.1, self: self(20), ents: [] });
    expect(e.pos.x).toBe(20);
    expect(e.prevPos.x).toBeGreaterThanOrEqual(0);
    expect(e.prevPos.x).toBeLessThanOrEqual(12.5); // <= 1.25 extrapolation cap
    // and the interpolation target is always ahead of the anchor
    expect(e.prevPos.x).toBeLessThan(e.pos.x);
  });

  it('mirrors overhead emotes from snapshots and clears them when absent', () => {
    const c = bareClient(7);
    const self = (emo?: string, emoSeq?: number) => ({
      ...wire(7, 0),
      ...(emo ? { emo, emoSeq } : {}),
      res: 0,
      mres: 100,
      rtype: 'mana',
      xp: 0,
      copper: 0,
      inv: [],
      equip: {},
      qlog: [],
      qdone: [],
      cds: {},
      gcd: 0,
      stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
      weapon: { min: 1, max: 2, speed: 2 },
    });
    c.applySnapshot({ t: 'snap', tick: 1, time: 0, self: self('laugh', 4), ents: [] });
    expect(c.entities.get(7)?.overheadEmoteId).toBe('laugh');
    expect(c.entities.get(7)?.overheadEmoteSeq).toBe(4);

    c.applySnapshot({ t: 'snap', tick: 2, time: 0.05, self: self('laugh', 5), ents: [] });
    expect(c.entities.get(7)?.overheadEmoteSeq).toBe(5);

    c.applySnapshot({ t: 'snap', tick: 3, time: 0.1, self: self(), ents: [] });

    expect(c.entities.get(7)?.overheadEmoteId).toBeNull();
  });
});

function logEvents(events: SimEvent[]): Extract<SimEvent, { type: 'log' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log');
}

describe('/afk and /dnd presence', () => {
  it('/afk confirms to the setter and auto-replies to whisperers (still delivering)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();

    sim.chat('/afk grabbing lunch', a);
    const confirm = logEvents(sim.tick());
    expect(
      confirm.some((m) => m.pid === a && /Away From Keyboard: grabbing lunch/.test(m.text)),
    ).toBe(true);

    sim.chat('/w Aleph you around?', b);
    const out = sim.tick();
    // Bet gets an auto-reply line about Aleph being away...
    expect(
      logEvents(out).some(
        (m) => m.pid === b && /Aleph is Away From Keyboard: grabbing lunch/.test(m.text),
      ),
    ).toBe(true);
    // ...and the whisper is still delivered to Aleph (afk does not withhold)
    expect(
      chatEvents(out).some(
        (m) => m.channel === 'whisper' && m.pid === a && m.text === 'you around?',
      ),
    ).toBe(true);
  });

  it('/dnd withholds the whisper but still echoes the sender and notifies them', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();

    sim.chat('/dnd raiding', a);
    sim.tick();

    sim.chat('/w Aleph ping', b);
    const out = sim.tick();
    expect(
      logEvents(out).some((m) => m.pid === b && /Aleph is Do Not Disturb: raiding/.test(m.text)),
    ).toBe(true);
    // the recipient copy (no `to`) must not reach Aleph
    expect(chatEvents(out).some((m) => m.channel === 'whisper' && m.pid === a)).toBe(false);
    // but the sender still sees their own outgoing line (carries `to`)
    expect(
      chatEvents(out).some((m) => m.channel === 'whisper' && m.pid === b && m.to === 'Aleph'),
    ).toBe(true);
  });

  it('repeating the bare command toggles the status off', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/afk', a);
    sim.tick();
    sim.chat('/afk', a);
    const out = logEvents(sim.tick());
    expect(out.some((m) => m.pid === a && /no longer Away From Keyboard/.test(m.text))).toBe(true);
  });

  it('sending any other chat clears an away status', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/afk', a);
    sim.tick();
    sim.chat('back now', a);
    const out = logEvents(sim.tick());
    expect(out.some((m) => m.pid === a && /no longer marked as away/.test(m.text))).toBe(true);
  });
});

// Direct unit tests for the extracted chat module (src/sim/social/chat.ts),
// exercising the helpers in isolation through a minimal fake SimContext (no full
// Sim). The big chat() router stays on Sim and is covered by the suites above.
describe('chat module (direct, no Sim)', () => {
  function fakeChatCtx() {
    const players = new Map<number, any>();
    const entities = new Map<number, any>();
    const chatTokens = new Map<number, { tokens: number; at: number }>();
    const channelSubs = new Map<number, Set<string>>();
    const events: any[] = [];
    let time = 0;
    const ctx = {
      get time() {
        return time;
      },
      players,
      entities,
      chatTokens,
      channelSubs,
      resolve: (pid: number) => {
        const meta = players.get(pid);
        const e = entities.get(pid);
        return meta && e ? { meta, e } : null;
      },
      emit: (ev: any) => events.push(ev),
      error: (pid: number, text: string) => events.push({ type: 'error', pid, text }),
      notice: (pid: number, text: string) => events.push({ type: 'log', pid, text }),
    } as unknown as SimContext;
    function addPlayer(pid: number, name: string, x = 0, z = 0) {
      players.set(pid, { entityId: pid, name, cls: 'mage' });
      entities.set(pid, { id: pid, pos: { x, y: 0, z }, hp: 100, maxHp: 100, level: 5 });
    }
    return {
      ctx,
      players,
      entities,
      chatTokens,
      channelSubs,
      events,
      addPlayer,
      setTime: (t: number) => (time = t),
    };
  }

  it('chatAllowed: a burst of 8 passes, the 9th is throttled, then refills over time', () => {
    const h = fakeChatCtx();
    let pass = 0;
    for (let i = 0; i < 8; i++) if (chatMod.chatAllowed(h.ctx, 1)) pass++;
    expect(pass).toBe(8);
    expect(chatMod.chatAllowed(h.ctx, 1)).toBe(false); // bucket drained
    h.setTime(1); // +1s -> +2 tokens (CHAT_REFILL)
    expect(chatMod.chatAllowed(h.ctx, 1)).toBe(true);
  });

  it('whisperMessageForName: exact-case prefix + whitespace boundary; CI only when asked', () => {
    expect(chatMod.whisperMessageForName('Bet hello', 'Bet', true)).toBe('hello');
    expect(chatMod.whisperMessageForName('bet hello', 'Bet', true)).toBe(null); // case-exact required
    expect(chatMod.whisperMessageForName('bet hello', 'Bet', false)).toBe('hello');
    expect(chatMod.whisperMessageForName('Betty hi', 'Bet', true)).toBe(null); // needs a ws boundary
    expect(chatMod.whisperMessageForName('Bet   ', 'Bet', true)).toBe(null); // empty message
  });

  it('resolveWhisperTarget: exact-case wins; an unambiguous CI match resolves; ties error', () => {
    const exactCtx = fakeChatCtx();
    exactCtx.addPlayer(1, 'Bet');
    exactCtx.addPlayer(2, 'bet');
    const exact = chatMod.resolveWhisperTarget(exactCtx.ctx, 'Bet hi there');
    expect(exact && 'target' in exact && exact.target.name).toBe('Bet');

    const ciCtx = fakeChatCtx();
    ciCtx.addPlayer(1, 'Bet');
    const ci = chatMod.resolveWhisperTarget(ciCtx.ctx, 'bet hi');
    expect(ci && 'target' in ci && ci.target.name).toBe('Bet');

    const ambCtx = fakeChatCtx();
    ambCtx.addPlayer(1, 'Abc');
    ambCtx.addPlayer(2, 'aBc');
    const amb = chatMod.resolveWhisperTarget(ambCtx.ctx, 'abc hi');
    expect(amb && 'error' in amb).toBe(true);
  });

  it('handleChannelMembership: join/dup/unknown/leave behave and notify', () => {
    const h = fakeChatCtx();
    h.addPlayer(1, 'Aleph');
    const meta = h.players.get(1);
    chatMod.handleChannelMembership(h.ctx, meta, 'join', 'world');
    expect(h.channelSubs.get(1)?.has('world')).toBe(true);
    expect(h.events.some((e) => /Joined the world channel/.test(e.text))).toBe(true);
    chatMod.handleChannelMembership(h.ctx, meta, 'join', 'world');
    expect(h.events.some((e) => e.type === 'error' && /already in the world/.test(e.text))).toBe(
      true,
    );
    chatMod.handleChannelMembership(h.ctx, meta, 'join', 'nope');
    expect(h.events.some((e) => e.type === 'error' && /no channel named 'nope'/.test(e.text))).toBe(
      true,
    );
    chatMod.handleChannelMembership(h.ctx, meta, 'leave', 'world');
    expect(h.channelSubs.has(1)).toBe(false);
    expect(h.events.some((e) => /Left the world channel/.test(e.text))).toBe(true);
  });

  it('broadcastEmote: delivers an emote chat event to players within SAY_RANGE only', () => {
    const h = fakeChatCtx();
    h.addPlayer(1, 'Aleph', 0, 0);
    h.addPlayer(2, 'Bet', 3, 0); // in range
    h.addPlayer(3, 'Far', 200, 0); // out of range
    chatMod.broadcastEmote(h.ctx, h.players.get(1), h.entities.get(1), 'waves.');
    const recipients = new Set(
      h.events.filter((e) => e.type === 'chat' && e.channel === 'emote').map((e) => e.pid),
    );
    expect(recipients.has(1)).toBe(true);
    expect(recipients.has(2)).toBe(true);
    expect(recipients.has(3)).toBe(false);
  });

  it('inspectReadout + helpLines are pure readouts', () => {
    const target = { name: 'Bet', cls: 'mage' } as any;
    const e = { hp: 50, maxHp: 100, level: 7 } as any;
    const line = chatMod.inspectReadout(target, e);
    expect(line).toContain('Bet: Level 7');
    expect(line).toContain('50%');
    expect(chatMod.helpLines().length).toBe(7);
  });

  it('handleDevChat: parses dev cheats; returns undefined for non-dev input', () => {
    const calls: any[] = [];
    const purse = { copper: 0 };
    const ctx = {
      setPlayerLevel: (lvl: number, pid?: number) => calls.push(['level', lvl, pid]),
      players: new Map([[1, purse]]),
      addItem: (id: string, n: number, pid?: number) => calls.push(['item', id, n, pid]),
      completeQuestForDev: (questId: string, pid?: number) => calls.push(['quest', questId, pid]),
      completeCurrentQuestsForDev: (pid?: number) => calls.push(['quests', pid]),
      spawnDevBot: (name: string) => {
        calls.push(['bot', name]);
        return 7;
      },
      emit: () => {},
      error: () => {},
      entities: new Map(),
      grid: { update() {} },
      playerGrid: { update() {} },
      groundPos: (x: number, z: number) => ({ x, y: 0, z }),
    } as unknown as SimContext;
    expect(chatMod.handleDevChat(ctx, '/dev level 5', 1)).toBe(null);
    expect(calls).toContainEqual(['level', 5, 1]);
    expect(chatMod.handleDevChat(ctx, '/dev give wolf_fang 3', 1)).toBe(null);
    expect(calls).toContainEqual(['item', 'wolf_fang', 3, 1]);
    expect(chatMod.handleDevChat(ctx, '/dev gold 250', 1)).toBe(null);
    expect(purse.copper).toBe(250 * 10000);
    expect(chatMod.handleDevChat(ctx, '/dev gold 9999999', 1)).toBe(null);
    expect(purse.copper).toBe(250 * 10000 + 100000 * 10000); // clamped to 100000g
    expect(chatMod.handleDevChat(ctx, '/dev quest q_wolves', 1)).toBe(null);
    expect(calls).toContainEqual(['quest', 'q_wolves', 1]);
    expect(chatMod.handleDevChat(ctx, '/dev quests', 1)).toBe(null);
    expect(calls).toContainEqual(['quests', 1]);
    expect(chatMod.handleDevChat(ctx, '/dev bot ASASAS', 1)).toBe(null);
    expect(calls).toContainEqual(['bot', 'ASASAS']);
    expect(chatMod.handleDevChat(ctx, 'hello world', 1)).toBe(undefined);
  });

  it('a handled /dev command never falls through to the unknown-command error', () => {
    // Repro for the live bug: /dev gold added the gold AND showed the red
    // "Unknown command" toast, because chat()'s call site only returned early
    // for a non-null SentChat while handleDevChat signals "handled" with null.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, devCommands: true });
    const pid = sim.addPlayer('warrior', 'Cheater');
    sim.drainEvents();
    sim.chat('/dev gold 5', pid);
    const events = sim.drainEvents();
    const errors = events.filter((e: any) => e.type === 'error').map((e: any) => e.text);
    expect(errors.filter((t: string) => t.startsWith('Unknown command'))).toEqual([]);
    expect(sim.meta(pid)?.copper).toBe(5 * 10000);
    expect(
      events.some((e: any) => e.type === 'log' && e.text === '[dev] Added 5g to your purse.'),
    ).toBe(true);
  });

  it('handleDevChat: the /dev help fallback advertises every dev subcommand', () => {
    let help = '';
    const ctx = {
      error: (_pid: number, text: string) => {
        help = text;
      },
    } as unknown as SimContext;
    // A bare "/dev" matches no specific cheat and falls through to the usage line.
    expect(chatMod.handleDevChat(ctx, '/dev', 1)).toBe(null);
    // Every subcommand the parser accepts must be listed, so the help can never
    // silently drift behind the commands again (the "/dev bot" omission this pins).
    for (const cmd of ['level', 'tp', 'give', 'gold', 'quest', 'quests', 'bot'])
      expect(help, `help omits /dev ${cmd}`).toContain(`/dev ${cmd}`);
  });
});

describe('dev bot: a whisperable test dummy', () => {
  it('spawnDevBot adds a unique dummy that a whisper auto-replies to', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const botPid = sim.spawnDevBot('ASASAS');
    expect(botPid).toBeGreaterThanOrEqual(0);
    const botMeta = sim.players.get(botPid)!;
    expect(botMeta.name).toBe('ASASAS');
    expect(botMeta.isDevBot).toBe(true);
    // whisper resolution needs a unique name: a duplicate (any case) or blank is refused
    expect(sim.spawnDevBot('asasas')).toBe(-1);
    expect(sim.spawnDevBot('   ')).toBe(-1);

    sim.chat('/w ASASAS hola', a);
    const msgs = chatEvents(sim.tick());
    // The bot gets NO recipient copy (no owning client; offline it would duplicate
    // the sender's own line). Everything the human sees is addressed to Aleph.
    expect(msgs.every((m) => m.pid === a)).toBe(true);
    // exactly two lines: the sender echo, then the bot's auto-reply
    const echo = msgs.find((m) => m.to === 'ASASAS')!;
    expect(echo.channel).toBe('whisper');
    expect(echo.from).toBe('Aleph');
    expect(echo.text).toBe('hola');
    const reply = msgs.find((m) => m.from === 'ASASAS')!;
    expect(reply.channel).toBe('whisper');
    expect(reply.text).toContain('hola');
    expect(reply.to).toBeUndefined();
    // Aleph can now /r the bot
    expect(sim.players.get(a)!.lastWhisperFrom).toBe('ASASAS');
  });

  it('the /dev bot command spawns a bot only when dev commands are on', () => {
    const on = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, devCommands: true });
    const a = on.addPlayer('warrior', 'Aleph');
    on.chat('/dev bot ASASAS', a);
    on.tick();
    expect([...on.players.values()].find((m) => m.name === 'ASASAS')?.isDevBot).toBe(true);

    // with dev commands off, "/dev bot" is inert (never spawns a player)
    const off = makeWorld();
    const a2 = off.addPlayer('warrior', 'Aleph');
    off.chat('/dev bot NOPE', a2);
    off.tick();
    expect([...off.players.values()].some((m) => m.name === 'NOPE')).toBe(false);
  });
});

describe('/sit and /stand pose', () => {
  it('/sit seats the player, moving clears it, and /stand stands back up', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Sitter');
    teleport(sim, a, 0, -40);
    const e = sim.entities.get(a)!;
    sim.chat('/sit', a);
    expect(e.sitting).toBe(true);
    // Standing back up in place.
    sim.chat('/stand', a);
    expect(e.sitting).toBe(false);
    // Sitting clears the instant you move (the movement path calls standUp).
    sim.chat('/sit', a);
    expect(e.sitting).toBe(true);
    const meta = sim.players.get(a)!;
    meta.moveInput = { ...meta.moveInput, forward: true };
    sim.tick();
    expect(e.sitting).toBe(false);
  });

  it('a dead player cannot sit', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Ghost');
    const e = sim.entities.get(a)!;
    e.dead = true;
    sim.chat('/sit', a);
    expect(e.sitting).toBe(false);
  });
});
