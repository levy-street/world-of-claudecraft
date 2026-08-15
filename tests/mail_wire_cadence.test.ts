// The `mail` self key's cadence + rebuild-only-on-change gate (the market
// gate's shape applied to the Ravenpost). The expensive call is
// sim.mailInfoFor (the full mailbox projection, letter bodies included, which
// used to re-serialize at 20 Hz for every player at a raven pillar), so the
// decisive pin is a SPY on it: within the MAIL_WIRE_HZ cadence the server
// polls the cheap mail revision and must not rebuild while nothing changed; a
// book change, the delivery landing, the viewer's own mail command, and the
// staleness backstop each bring exactly the rebuilds they promise.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
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
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import {
  type ClientSession,
  GameServer,
  MAIL_REFRESH_TICKS,
  MAIL_WIRE_INTERVAL_TICKS,
} from '../server/game';
import { groundHeight } from '../src/sim/world';
import { broadcast, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function placeAtMailbox(server: GameServer, pid: number): void {
  const box = server.sim.entities.get(server.sim.postOffice.mailboxIds[0]);
  if (!box) throw new Error('no mailbox spawned');
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = box.pos.x;
  e.pos.z = box.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function placeFarAway(server: GameServer, pid: number): void {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = 400;
  e.pos.z = 400;
  e.pos.y = groundHeight(400, 400, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function duePass(server: GameServer): void {
  for (let i = 0; i < MAIL_WIRE_INTERVAL_TICKS; i++) server.sim.tick();
  broadcast(server);
}

function mailSnaps(sent: unknown[], from: number): unknown[] {
  // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON, the harness idiom
  return (sent as any[]).slice(from).filter((m) => m.t === 'snap' && m.self && 'mail' in m.self);
}

function mailboxServer(): { server: GameServer; fc: FakeClient; session: ClientSession } {
  const server = new GameServer();
  const fc = fakeWs();
  const session = joinServer(server, fc, 71, 'Postie');
  placeAtMailbox(server, session.pid);
  return { server, fc, session };
}

// Book an authored letter straight through the tracked booking path, with a
// distinct letterId so per-target inboxes are tellable apart in the spectate
// pin below.
function bookAuthoredLetter(server: GameServer, pid: number, letterId: string): void {
  const meta = server.sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  // biome-ignore lint/suspicious/noExplicitAny: reaching the post office is the harness idiom
  const post = (server.sim as any).postOffice;
  post.sendLetter(
    post.mailKeyFor(meta),
    meta.name,
    { letterId, senderName: 'Postmaster', subject: 'Probe', body: 'A line.', delaySeconds: 0 },
    'npc',
  );
}

describe('mail wire cadence + rebuild-only-on-change', () => {
  it('pins the tuned cadence literally: 5-tick interval, 40-tick backstop', () => {
    // The imported constants drive the loop mechanics above; these literal
    // pins keep a server-side retune (say MAIL_WIRE_HZ = 20, reverting the
    // cadence layer) from leaving the suite green while it asserts a window
    // that no longer exists.
    expect(MAIL_WIRE_INTERVAL_TICKS).toBe(5);
    expect(MAIL_REFRESH_TICKS).toBe(40);
  });

  it('rebuilds once for the join, then never again while nothing changes (until the backstop)', () => {
    const { server, fc } = mailboxServer();
    // Settle the welcome letter's announce sweep first: it flips a runtime
    // flag, never the revision, and the pin below depends on that.
    for (let i = 0; i < 40; i++) server.sim.tick();
    const spy = vi.spyOn(server.sim, 'mailInfoFor');
    broadcast(server);
    expect(spy).toHaveBeenCalledTimes(1);
    const first = lastSnap(fc.sent);
    expect(first.self.mail).not.toBeNull();
    expect(first.self.mail.messages.length).toBe(1); // the welcome letter

    // Every due pass up to one interval SHORT of the backstop, with no book
    // or position change: the gate polls the mail revision and skips the
    // rebuild every time. The pre-fix behavior was one rebuild per TICK.
    const passesToBackstop = Math.ceil(MAIL_REFRESH_TICKS / MAIL_WIRE_INTERVAL_TICKS);
    const sent = fc.sent.length;
    for (let pass = 0; pass < passesToBackstop - 1; pass++) duePass(server);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mailSnaps(fc.sent, sent)).toHaveLength(0); // nothing re-shipped either

    // The next due pass crosses the staleness backstop: exactly one more
    // rebuild lands (and, being unchanged, still elides from the wire).
    duePass(server);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(mailSnaps(fc.sent, sent)).toHaveLength(0);
  });

  it('a delivered letter reaches the viewer on their next due pass, with no command', () => {
    const { server, fc, session } = mailboxServer();
    broadcast(server);
    const spy = vi.spyOn(server.sim, 'mailInfoFor');

    // A second player mails the viewer, booked straight through the sim (the
    // wire mail_send resolves recipients against the character DB, mocked
    // empty here; the claim under test is the LANDING, not the send path).
    // The letter rides the 45 s raven, so the viewer's view changes when it
    // lands with NO command in between: the deliverDue revision bump is the
    // only thing that can carry it through the gate.
    const fc2 = fakeWs();
    const sender = joinServer(server, fc2, 72, 'Scribe');
    placeAtMailbox(server, sender.pid);
    const senderMeta = server.sim.meta(sender.pid);
    const viewerMeta = server.sim.meta(session.pid);
    if (!senderMeta || !viewerMeta) throw new Error('missing meta');
    senderMeta.copper = 10_000;
    server.sim.mailSendResolved(
      { key: server.sim.postOffice.mailKeyFor(viewerMeta), name: 'Postie' },
      'Hi',
      'There.',
      0,
      [],
      sender.pid,
    );

    // Mid-window: the booking already advanced the revision, but the cadence
    // gate is not due yet (one tick into the 5-tick window), so a broadcast
    // here must ship nothing and pay no rebuild. Deleting the mailDue branch
    // would rebuild right here and redden this pin.
    server.sim.tick();
    const midWindow = fc.sent.length;
    broadcast(server);
    expect(mailSnaps(fc.sent, midWindow)).toHaveLength(0);
    expect(spy.mock.calls.filter(([pid]) => pid === session.pid).length).toBe(0);

    // Fly the raven home: 45 sim-seconds of ticks, broadcasting on cadence.
    for (let i = 0; i < 46 * 20; i++) server.sim.tick();
    const sent = fc.sent.length;
    duePass(server);
    const snaps = mailSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    const messages = (snaps[0] as any).self.mail.messages;
    expect(messages.some((m: { subject: string }) => m.subject === 'Hi')).toBe(true);
    expect(spy.mock.calls.filter(([pid]) => pid === session.pid).length).toBeGreaterThan(0);
  });

  it("the viewer's own mail_read lands on the next snapshot, not a cadence later", () => {
    const { server, fc, session } = mailboxServer();
    broadcast(server);
    const welcomeId = lastSnap(fc.sent).self.mail.messages[0].id;
    server.sim.tick(); // one tick only: the plain cadence gate is NOT due yet

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'mail_read', id: welcomeId }));
    const sent = fc.sent.length;
    broadcast(server);
    const snaps = mailSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.mail.messages[0].read).toBe(true);
  });

  it("a spectate anchor switch re-ships the NEW target's inbox on the next snapshot", () => {
    // Mirror of the corder spectate pin: the mail revision is realm-global
    // with no target identity, so an anchor change that missed both the
    // lastSent wipe and the tracker resets would leave a moderator reading
    // player A's inbox while spectating B until the staleness backstop.
    const server = new GameServer();
    const fcMod = fakeWs();
    const mod = joinServer(server, fcMod, 76, 'Watcher');
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 77, 'Anna');
    const fcB = fakeWs();
    const bela = joinServer(server, fcB, 78, 'Bela');
    placeAtMailbox(server, a.pid);
    placeAtMailbox(server, bela.pid);
    bookAuthoredLetter(server, a.pid, 'qa_spectate_a');
    bookAuthoredLetter(server, bela.pid, 'qa_spectate_b');
    for (let i = 0; i < 2; i++) server.sim.tick();
    broadcast(server);

    // Enter: anchored on Anna, her letter and not Bela's.
    let before = fcMod.sent.length;
    // biome-ignore lint/suspicious/noExplicitAny: the spectate entry is private by design
    (server as any).enterSpectate(mod, a);
    broadcast(server);
    let snaps = mailSnaps(fcMod.sent, before);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    let inbox = (snaps[0] as any).self.mail;
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect(inbox.messages.some((m: any) => m.letterId === 'qa_spectate_a')).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect(inbox.messages.some((m: any) => m.letterId === 'qa_spectate_b')).toBe(false);

    // Switch to Bela with the book UNCHANGED: only the wipe/reset pair can
    // carry the re-anchored inbox through the gate.
    before = fcMod.sent.length;
    // biome-ignore lint/suspicious/noExplicitAny: the spectate entry is private by design
    (server as any).enterSpectate(mod, bela);
    broadcast(server);
    snaps = mailSnaps(fcMod.sent, before);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    inbox = (snaps[0] as any).self.mail;
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect(inbox.messages.some((m: any) => m.letterId === 'qa_spectate_b')).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect(inbox.messages.some((m: any) => m.letterId === 'qa_spectate_a')).toBe(false);
  });

  it('walking away nulls the key at cadence; returning re-ships the full view', () => {
    const { server, fc, session } = mailboxServer();
    broadcast(server);

    placeFarAway(server, session.pid);
    let sent = fc.sent.length;
    duePass(server);
    let snaps = mailSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.mail).toBeNull();

    placeAtMailbox(server, session.pid);
    sent = fc.sent.length;
    duePass(server);
    snaps = mailSnaps(fc.sent, sent);
    expect(snaps).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: untyped wire JSON
    expect((snaps[0] as any).self.mail.messages.length).toBe(1);
  });
});
