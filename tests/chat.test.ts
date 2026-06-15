import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ClientWorld } from '../src/net/online';
import { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
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
    teleport(sim, near, 10, -40);  // within 25
    teleport(sim, far, 60, -40);   // beyond 25
    sim.tick();

    sim.chat('Hello there', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((m) => m.channel === 'say' && m.entityId === a && m.text === 'Hello there')).toBe(true);
    const pids = msgs.map((m) => m.pid).sort();
    expect(pids).toContain(a);     // speaker hears themselves
    expect(pids).toContain(near);
    expect(pids).not.toContain(far);
  });

  it('yell carries further than say but not world-wide', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mid = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, mid, 60, -40);   // beyond say(25), within yell(100)
    teleport(sim, far, 0, -400);   // beyond yell
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
    teleport(sim, b, 0, -900);     // whisper ignores distance
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
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      text: 'The /who roster is available in online play.',
    }));
  });

  it('exact-case whisper wins over a case-variant squatter', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const squatter = sim.addPlayer('mage', 'bet'); // joins first, lowercase
    const real = sim.addPlayer('rogue', 'Bet');    // the intended target
    teleport(sim, a, 0, -40);
    sim.tick();
    sim.chat('/w Bet exact match', a);
    const msgs = chatEvents(sim.tick());
    const toTarget = msgs.find((m) => m.pid !== a);
    expect(toTarget!.pid).toBe(real);
    expect(toTarget!.pid).not.toBe(squatter);
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
});

describe('emotes', () => {
  it('a predefined emote reaches everyone in say range with third-person text', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const near = sim.addPlayer('mage', 'Bet');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, near, 10, -40); // within say range
    teleport(sim, far, 60, -40);  // beyond say range
    sim.tick();

    sim.chat('/wave', a);
    const msgs = chatEvents(sim.tick());
    expect(msgs.every((m) => m.channel === 'emote' && m.from === 'Aleph' && m.text === 'waves.')).toBe(true);
    const pids = msgs.map((m) => m.pid).sort();
    expect(pids).toContain(a);    // the actor sees their own emote
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
    c.copper = 0; c.xp = 0;
    c.known = [];
    c.questLog = new Map();
    c.questsDone = new Set();
    c.partyInfo = null; c.tradeInfo = null; c.duelInfo = null;
    c.lastSnapAt = 0;
    c.snapInterval = 50;
    c.pendingFacingDelta = 0;
    c.connected = true;
    c.eventQueue = [];
    c.mouselookFacing = null;
    return c;
  }

  const wire = (id: number, x: number) => ({
    id, k: 'player', tid: 'warrior', nm: 'Runner', lv: 1,
    x, y: 0, z: 0, f: 0, hp: 100, mhp: 100,
  });

  it('re-anchors prevPos at the rendered pose instead of the last server pose', () => {
    const c = bareClient(7);
    const self = (x: number) => ({
      ...wire(7, x), res: 0, mres: 100, rtype: 'mana', xp: 0, copper: 0,
      inv: [], equip: {}, qlog: [], qdone: [], cds: {}, gcd: 0,
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
});
