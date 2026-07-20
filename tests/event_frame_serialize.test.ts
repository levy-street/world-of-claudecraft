import { afterEach, describe, expect, it, vi } from 'vitest';

// Only the db surface routeEvents' fan-out can reach needs mocking; the whole
// battery is pure event routing (no leave/lease/autosave), so the short export
// list is sufficient.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { assembleEventsFrame, serializeEventFragments } from '../server/event_frame';
import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass, SimEvent } from '../src/sim/types';

// Golden byte-identity fixture for GameServer.routeEvents. Every assertion pins the
// EXACT raw string a session's socket receives, so the serialize-once refactor cannot
// change a single byte of any events frame without reddening a case here. Captured
// against the pre-refactor implementation; the expected values are authored, never
// regenerated from the implementation under test.

interface FakeClient {
  sent: string[];
  ws: { readyState: number; bufferedAmount: number; send: (payload: string) => void };
}

// RAW-string variant of the repo's fakeWs helper: records the payload verbatim so the
// assertions are byte-level, never JSON.parse'd.
function fakeWs(): FakeClient {
  const sent: string[] = [];
  return {
    sent,
    ws: { readyState: 1, bufferedAmount: 0, send: (payload: string) => sent.push(payload) },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  id: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function routeRaw(server: GameServer, events: SimEvent[]): void {
  (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(events);
}

// The wire frame a session receives, byte-for-byte, is
// JSON.stringify({ t: 'events', list: [...selected events...] }). The expected values
// below are built by JSON.stringify'ing INDEPENDENTLY AUTHORED event objects (matching
// the key order routeEvents leaves on each event, flair appended last), so the pin
// reds both on an authoring mistake here and on a refactor that assembles the frame
// with different bytes (the refactor concatenates pre-serialized fragments, so this
// comparison is a genuine oracle for it, not a tautology).
function eventsFrame(...list: unknown[]): string {
  return JSON.stringify({ t: 'events', list });
}

function entityPos(server: GameServer, pid: number): { x: number; y: number; z: number } {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`no entity for pid ${pid}`);
  return e.pos;
}

type ObserveSpyTarget = { observeEvent: (ctx: unknown, ev: unknown, now: unknown) => void };
function botDetectorOf(server: GameServer): ObserveSpyTarget {
  return (server as unknown as { botDetector: ObserveSpyTarget }).botDetector;
}

afterEach(() => vi.restoreAllMocks());

describe('routeEvents frame bytes and session mutations', () => {
  it('fans a broadcast chat batch out byte-identically to every session', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const sa = joinServer(server, fa, 1, 'Ayla');
    const fb = fakeWs();
    joinServer(server, fb, 2, 'Bram');
    fa.sent.length = 0;
    fb.sent.length = 0;

    const general: SimEvent = {
      type: 'chat',
      fromPid: sa.pid,
      from: 'Ayla',
      channel: 'general',
      text: 'hello all',
    };
    const world: SimEvent = {
      type: 'chat',
      fromPid: sa.pid,
      from: 'Ayla',
      channel: 'world',
      text: 'anyone around',
    };
    routeRaw(server, [general, world]);

    const expected = eventsFrame(
      { type: 'chat', fromPid: sa.pid, from: 'Ayla', channel: 'general', text: 'hello all' },
      { type: 'chat', fromPid: sa.pid, from: 'Ayla', channel: 'world', text: 'anyone around' },
    );
    // Byte-identity: both recipients get the exact same single frame string.
    expect(fa.sent).toEqual([expected]);
    expect(fb.sent).toEqual([expected]);
    expect(fa.sent[0]).toBe(fb.sent[0]);
    // A fully hardcoded pin (no JSON.stringify in the oracle) to foreclose any
    // stringify-vs-stringify tautology worry.
    expect(fb.sent[0]).toBe(
      `{"t":"events","list":[{"type":"chat","fromPid":${sa.pid},"from":"Ayla","channel":"general","text":"hello all"},{"type":"chat","fromPid":${sa.pid},"from":"Ayla","channel":"world","text":"anyone around"}]}`,
    );
  });

  it('stamps sender account flair once and serializes it byte-identically (flair last)', () => {
    const server = new GameServer();
    const fs = fakeWs();
    const streamer = joinServer(server, fs, 1, 'Nova');
    const fl = fakeWs();
    joinServer(server, fl, 2, 'Listener');
    // An AI-operated account: chatSenderFlair yields exactly { ai: true } (no streamer
    // links), so the stamped wire flair is deterministic.
    streamer.chatFlair = { ai: true };
    fs.sent.length = 0;
    fl.sent.length = 0;

    routeRaw(server, [
      { type: 'chat', fromPid: streamer.pid, from: 'Nova', channel: 'general', text: 'live now' },
    ]);

    // flair is appended to the event object by routeEvents (ev.flair = ...), so it is
    // the LAST key on the wire.
    const expected = eventsFrame({
      type: 'chat',
      fromPid: streamer.pid,
      from: 'Nova',
      channel: 'general',
      text: 'live now',
      flair: { ai: true },
    });
    expect(fl.sent).toEqual([expected]);
    expect(fl.sent[0]).toBe(
      `{"t":"events","list":[{"type":"chat","fromPid":${streamer.pid},"from":"Nova","channel":"general","text":"live now","flair":{"ai":true}}]}`,
    );
  });

  it('routes a whisper to its recipient only and records lastWhisperFrom (plain arm)', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const sa = joinServer(server, fa, 1, 'Ayla');
    const fb = fakeWs();
    const sb = joinServer(server, fb, 2, 'Bram');
    fa.sent.length = 0;
    fb.sent.length = 0;
    expect(sb.lastWhisperFrom).toBeNull();

    // The recipient copy of a whisper carries no `to`; it is pid-scoped to the target.
    const whisper: SimEvent = {
      type: 'chat',
      fromPid: sa.pid,
      from: 'Ayla',
      channel: 'whisper',
      text: 'meet me',
      pid: sb.pid,
    };
    routeRaw(server, [whisper]);

    expect(fb.sent).toEqual([
      eventsFrame({
        type: 'chat',
        fromPid: sa.pid,
        from: 'Ayla',
        channel: 'whisper',
        text: 'meet me',
        pid: sb.pid,
      }),
    ]);
    // The sender (and everyone else) never receives it.
    expect(fa.sent).toEqual([]);
    // Side effect: /r reply target is remembered (plain, non-spectating arm).
    expect(sb.lastWhisperFrom).toBe('Ayla');
  });

  it('mirrors a whisper to a spectating session addressed to its own pid and records lastWhisperFrom', () => {
    const server = new GameServer();
    const fWatcher = fakeWs();
    const watcher = joinServer(server, fWatcher, 1, 'Watcher');
    const fSubject = fakeWs();
    const subject = joinServer(server, fSubject, 2, 'Subject');
    // Watcher is spectating Subject: routeEvents re-anchors to Subject's entity, but a
    // whisper addressed to Watcher's OWN pid still mirrors to Watcher (spectating arm).
    watcher.spectating = {
      characterId: subject.characterId,
      name: 'Subject',
      savedPos: { ...entityPos(server, watcher.pid) },
      priorGm: false,
      stowedPet: null,
    };
    fWatcher.sent.length = 0;
    fSubject.sent.length = 0;
    expect(watcher.lastWhisperFrom).toBeNull();

    const whisper: SimEvent = {
      type: 'chat',
      fromPid: subject.pid,
      from: 'Subject',
      channel: 'whisper',
      text: 'psst',
      pid: watcher.pid,
    };
    routeRaw(server, [whisper]);

    expect(fWatcher.sent).toEqual([
      eventsFrame({
        type: 'chat',
        fromPid: subject.pid,
        from: 'Subject',
        channel: 'whisper',
        text: 'psst',
        pid: watcher.pid,
      }),
    ]);
    // Side effect fires on the spectating-mirror arm too.
    expect(watcher.lastWhisperFrom).toBe('Subject');
  });

  it('delivers a heavy-self event to its own session and a spectator, not an unrelated one, and flips selfHeavyDirty', () => {
    const server = new GameServer();
    const fOwner = fakeWs();
    const owner = joinServer(server, fOwner, 1, 'Owner');
    const fSpec = fakeWs();
    const spec = joinServer(server, fSpec, 2, 'Spectator');
    const fOther = fakeWs();
    const other = joinServer(server, fOther, 3, 'Other');
    // Spectator is watching Owner: it re-anchors to Owner's pid, so Owner's pid-scoped
    // events reach the spectator too.
    spec.spectating = {
      characterId: owner.characterId,
      name: 'Owner',
      savedPos: { ...entityPos(server, spec.pid) },
      priorGm: false,
      stowedPet: null,
    };
    owner.selfHeavyDirty = false;
    spec.selfHeavyDirty = false;
    other.selfHeavyDirty = false;
    fOwner.sent.length = 0;
    fSpec.sent.length = 0;
    fOther.sent.length = 0;
    const spy = vi.spyOn(botDetectorOf(server), 'observeEvent');

    const loot: SimEvent = { type: 'loot', text: 'You loot 5 gold', pid: owner.pid };
    routeRaw(server, [loot]);

    const expected = eventsFrame({ type: 'loot', text: 'You loot 5 gold', pid: owner.pid });
    expect(fOwner.sent).toEqual([expected]);
    expect(fSpec.sent).toEqual([expected]);
    expect(fOther.sent).toEqual([]);
    // Heavy-self field re-diff is armed for the owner (its own snapshot) AND for the
    // spectator whose anchor is the owner: the selfHeavyDirty flip has no !spectating
    // guard, so the spectator dirties too. The unrelated session never saw the event.
    expect(owner.selfHeavyDirty).toBe(true);
    expect(spec.selfHeavyDirty).toBe(true);
    expect(other.selfHeavyDirty).toBe(false);
    // observeEvent, by contrast, IS !spectating-guarded on the plain arm (site 2): the
    // spectator reaches the plain arm (its anchor is the owner) but is suppressed, so the
    // event is observed exactly once, for the owner. This pins the guard's suppression
    // direction; removing it would let the spectator double-observe the owner's events.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(owner.botTrackingContext);
  });

  it('drops chat from a blocked sender and public chat from an ignored sender', () => {
    const server = new GameServer();
    const fRecv = fakeWs();
    const recv = joinServer(server, fRecv, 1, 'Recv');
    const fBlocked = fakeWs();
    const blocked = joinServer(server, fBlocked, 2, 'Blocked');
    const fIgnored = fakeWs();
    const ignored = joinServer(server, fIgnored, 3, 'Ignored');
    recv.blockedIds = new Set([blocked.characterId]);
    recv.ignoredIds = new Set([ignored.characterId]);
    fRecv.sent.length = 0;

    routeRaw(server, [
      {
        type: 'chat',
        fromPid: blocked.pid,
        from: 'Blocked',
        channel: 'general',
        text: 'blocked line',
      },
      {
        type: 'chat',
        fromPid: ignored.pid,
        from: 'Ignored',
        channel: 'general',
        text: 'ignored line',
      },
      { type: 'chat', fromPid: recv.pid, from: 'Recv', channel: 'general', text: 'own line' },
    ]);

    // Only the recipient's own line survives; the frame contains neither dropped line.
    expect(fRecv.sent).toEqual([
      eventsFrame({
        type: 'chat',
        fromPid: recv.pid,
        from: 'Recv',
        channel: 'general',
        text: 'own line',
      }),
    ]);
    expect(fRecv.sent[0]).not.toContain('blocked line');
    expect(fRecv.sent[0]).not.toContain('ignored line');
  });

  it('suppresses a blocked social invite for every session (target sees nothing)', () => {
    const server = new GameServer();
    const fTarget = fakeWs();
    const target = joinServer(server, fTarget, 1, 'Target');
    const fSender = fakeWs();
    const sender = joinServer(server, fSender, 2, 'Sender');
    target.blockedIds = new Set([sender.characterId]);
    fTarget.sent.length = 0;
    fSender.sent.length = 0;

    routeRaw(server, [
      { type: 'partyInvite', fromPid: sender.pid, fromName: 'Sender', pid: target.pid },
    ]);

    // The invite is dropped batch-wide, so the target's socket receives no frame.
    expect(fTarget.sent).toEqual([]);
  });

  it('scopes a world-coordinate event to sessions within EVENT_RADIUS', () => {
    const server = new GameServer();
    const fNear = fakeWs();
    const near = joinServer(server, fNear, 1, 'Near');
    const fFar = fakeWs();
    const far = joinServer(server, fFar, 2, 'Far');
    const nearPos = entityPos(server, near.pid);
    const farEnt = server.sim.entities.get(far.pid);
    if (!farEnt) throw new Error('no far entity');
    // Move Far well beyond EVENT_RADIUS (90 yd) from the effect point.
    farEnt.pos.x = nearPos.x + 500;
    farEnt.pos.z = nearPos.z + 500;
    fNear.sent.length = 0;
    fFar.sent.length = 0;

    const fx: SimEvent = {
      type: 'spellfxAt',
      x: nearPos.x,
      z: nearPos.z,
      school: 'fire',
      fx: 'burst',
    };
    routeRaw(server, [fx]);

    expect(fNear.sent).toEqual([
      eventsFrame({ type: 'spellfxAt', x: nearPos.x, z: nearPos.z, school: 'fire', fx: 'burst' }),
    ]);
    expect(fFar.sent).toEqual([]);
  });

  it('serializes a high-volume mixed batch byte-identically across a 20+ session crowd', () => {
    const server = new GameServer();
    const crowd: { fc: FakeClient; session: ClientSession }[] = [];
    for (let i = 0; i < 24; i++) {
      const fc = fakeWs();
      const session = joinServer(server, fc, i + 1, `Crowd${i}`);
      crowd.push({ fc, session });
    }
    for (const { fc } of crowd) fc.sent.length = 0;

    // 20 broadcast chat lines (no pid) plus 4 pid-scoped lines to the first member.
    const speaker = crowd[0].session;
    const broadcast: SimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      broadcast.push({
        type: 'chat',
        fromPid: speaker.pid,
        from: 'Crowd0',
        channel: 'general',
        text: `line ${i}`,
      });
    }
    const personal: SimEvent[] = [];
    for (let i = 0; i < 4; i++) {
      personal.push({ type: 'loot', text: `loot ${i}`, pid: speaker.pid });
    }
    routeRaw(server, [...broadcast, ...personal]);

    // Every crowd member receives one frame carrying exactly the 20 broadcast lines,
    // byte-identical across the whole crowd (the personal loot lines go only to member 0).
    const broadcastFrame = eventsFrame(
      ...broadcast.map((ev) => ({
        type: 'chat',
        fromPid: speaker.pid,
        from: 'Crowd0',
        channel: 'general',
        text: (ev as { text: string }).text,
      })),
    );
    // Member 0 additionally receives its own loot lines in the same single frame.
    const ownerFrame = eventsFrame(
      ...broadcast.map((ev) => ({
        type: 'chat',
        fromPid: speaker.pid,
        from: 'Crowd0',
        channel: 'general',
        text: (ev as { text: string }).text,
      })),
      ...personal.map((ev) => ({
        type: 'loot',
        text: (ev as { text: string }).text,
        pid: speaker.pid,
      })),
    );
    expect(crowd[0].fc.sent).toEqual([ownerFrame]);
    for (let i = 1; i < crowd.length; i++) {
      expect(crowd[i].fc.sent).toEqual([broadcastFrame]);
      expect(crowd[i].fc.sent[0]).toBe(crowd[1].fc.sent[0]);
    }
  });
});

// Pins for the per-session side effects and the serialize-once shape that the golden
// byte fixture above does not, on its own, lock. The two lastWhisperFrom sites and the
// selfHeavyDirty flip are pinned by the whisper and heavy-self cases in the fixture
// (reverting any of those three lines reds a named case there). These add the two
// botDetector.observeEvent call sites, whose stub is a no-op so only a spy can see them,
// and the O(events) serialization shape.
describe('routeEvents bot-detector observation and serialize-once shape', () => {
  it('observes a pid-scoped chat once at the plain arm for a non-spectating recipient (site 2)', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const sa = joinServer(server, fa, 1, 'Ayla');
    const fb = fakeWs();
    const sb = joinServer(server, fb, 2, 'Bram');
    const spy = vi.spyOn(botDetectorOf(server), 'observeEvent');

    // A whisper addressed to Bram, who is not spectating: only the plain arm can fire
    // (the spectating-mirror arm requires session.spectating).
    const whisper: SimEvent = {
      type: 'chat',
      fromPid: sa.pid,
      from: 'Ayla',
      channel: 'whisper',
      text: 'hi',
      pid: sb.pid,
    };
    routeRaw(server, [whisper]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(sb.botTrackingContext);
    expect(spy.mock.calls[0][1]).toBe(whisper);
    expect(typeof spy.mock.calls[0][2]).toBe('number');
  });

  it('observes a self-addressed chat once at the spectating-mirror arm (site 1), which has no !spectating guard', () => {
    const server = new GameServer();
    const fWatcher = fakeWs();
    const watcher = joinServer(server, fWatcher, 1, 'Watcher');
    const fSubject = fakeWs();
    const subject = joinServer(server, fSubject, 2, 'Subject');
    watcher.spectating = {
      characterId: subject.characterId,
      name: 'Subject',
      savedPos: { ...entityPos(server, watcher.pid) },
      priorGm: false,
      stowedPet: null,
    };
    const spy = vi.spyOn(botDetectorOf(server), 'observeEvent');

    // A whisper addressed to the spectating Watcher's OWN pid: only the mirror arm can
    // fire (the plain arm's observe is guarded by !session.spectating).
    const whisper: SimEvent = {
      type: 'chat',
      fromPid: subject.pid,
      from: 'Subject',
      channel: 'whisper',
      text: 'psst',
      pid: watcher.pid,
    };
    routeRaw(server, [whisper]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(watcher.botTrackingContext);
    expect(spy.mock.calls[0][1]).toBe(whisper);
    expect(typeof spy.mock.calls[0][2]).toBe('number');
  });

  it('serializes each event exactly once for the whole batch, not once per session', () => {
    const server = new GameServer();
    const sessions: ClientSession[] = [];
    for (let i = 0; i < 24; i++) {
      const fc = fakeWs();
      sessions.push(joinServer(server, fc, i + 1, `Crowd${i}`));
    }
    const speaker = sessions[0];
    // Twelve broadcast lines fanned to 24 sessions: a per-session serialization would
    // stringify once per recipient (24 calls), a per-session-per-event one would be 288.
    // Serialize-once is exactly events.length (12). The batch is deliberately kept
    // stringify-neutral outside serializeEventFragments: plain broadcast chat with no
    // flair, no social invites, and no pid-scoped events, so nothing else on the fan-out
    // path calls JSON.stringify and inflates the count. Keep it that way if extended.
    const batch: SimEvent[] = [];
    for (let i = 0; i < 12; i++) {
      batch.push({
        type: 'chat',
        fromPid: speaker.pid,
        from: 'Crowd0',
        channel: 'general',
        text: `m${i}`,
      });
    }
    expect(batch.length).toBeLessThan(sessions.length); // the pin only bites while this holds
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    stringifySpy.mockClear();
    routeRaw(server, batch);

    expect(stringifySpy).toHaveBeenCalledTimes(batch.length);
  });
});

// Direct unit tests of the extracted pure module. The integration cases above pin the
// real wire bytes (stronger), but these document the module contract at the shapes the
// caller's mine.length > 0 guard keeps the integration path from reaching (an empty list,
// a single fragment) and the length-alignment serializeEventFragments must hold.
describe('event_frame pure assembly', () => {
  it('serializeEventFragments stringifies each event once, index-aligned', () => {
    const events = [
      { type: 'chat', fromPid: 7, from: 'A', channel: 'general', text: 'hi' },
      { type: 'loot', text: 'gold', pid: 7 },
    ] as unknown as SimEvent[];
    const frags = serializeEventFragments(events);
    expect(frags).toHaveLength(events.length);
    expect(frags[0]).toBe(JSON.stringify(events[0]));
    expect(frags[1]).toBe(JSON.stringify(events[1]));
  });

  it('assembleEventsFrame is byte-identical to JSON.stringify of the whole frame object', () => {
    const events = [
      { type: 'chat', fromPid: 7, from: 'A', channel: 'general', text: 'hi' },
      { type: 'loot', text: 'gold', pid: 7 },
    ] as unknown as SimEvent[];
    expect(assembleEventsFrame(serializeEventFragments(events))).toBe(
      JSON.stringify({ t: 'events', list: events }),
    );
  });

  it('assembleEventsFrame renders an empty list as the empty-array frame', () => {
    expect(assembleEventsFrame([])).toBe('{"t":"events","list":[]}');
  });

  it('assembleEventsFrame joins a single fragment with no trailing separator', () => {
    expect(assembleEventsFrame(['{"type":"log","text":"x"}'])).toBe(
      '{"t":"events","list":[{"type":"log","text":"x"}]}',
    );
  });
});

// Over-delivery and empty-batch selection guards the fan-out relies on (pre-existing
// routeEvents branches the refactor keeps intact).
describe('routeEvents selection guards', () => {
  it('does not deliver the spectated target whisper to a spectator (plain-arm chat skip)', () => {
    const server = new GameServer();
    const fWatcher = fakeWs();
    const watcher = joinServer(server, fWatcher, 1, 'Watcher');
    const fTarget = fakeWs();
    const target = joinServer(server, fTarget, 2, 'Target');
    const fSender = fakeWs();
    const sender = joinServer(server, fSender, 3, 'Sender');
    // Watcher spectates Target: a spectator sees the target's say/yell but NEVER their
    // private whispers (the plain-arm skip at ev.channel not in say/yell while spectating).
    watcher.spectating = {
      characterId: target.characterId,
      name: 'Target',
      savedPos: { ...entityPos(server, watcher.pid) },
      priorGm: false,
      stowedPet: null,
    };
    fWatcher.sent.length = 0;
    fTarget.sent.length = 0;

    const whisper: SimEvent = {
      type: 'chat',
      fromPid: sender.pid,
      from: 'Sender',
      channel: 'whisper',
      text: 'private',
      pid: target.pid,
    };
    routeRaw(server, [whisper]);

    expect(fTarget.sent).toEqual([
      eventsFrame({
        type: 'chat',
        fromPid: sender.pid,
        from: 'Sender',
        channel: 'whisper',
        text: 'private',
        pid: target.pid,
      }),
    ]);
    expect(fWatcher.sent).toEqual([]);
  });

  it('sends nothing for an empty batch', () => {
    const server = new GameServer();
    const fa = fakeWs();
    joinServer(server, fa, 1, 'Ayla');
    fa.sent.length = 0;
    routeRaw(server, []);
    expect(fa.sent).toEqual([]);
  });
});
