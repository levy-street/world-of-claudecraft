// The Vale Cup over the real server wire (arena_online template): command
// routing + validation, the throttled 'vcup' self delta key, the wireRev-gated
// 'sport' heavy field (explicit null on restore), the ball's full-rate
// isUpdateDue carve-out for distant viewers, desertion persisting the loss
// BEFORE the leave save, the Sowfield presence label, and the daily-reward /
// activity-card arm on a decided rated match.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => ({})),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  // The character-lease surface game.leave/the autosave loop call (this mock was
  // authored on the release branch, before the character-lease system landed).
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { dailyRewardService } from '../server/daily_rewards';
import * as db from '../server/db';
import { drainActivity } from '../server/discord_activity';
import { type ClientSession, GameServer } from '../server/game';
import { VC_OVER_DELAY } from '../src/sim/social/vale_cup';
import type { PlayerClass } from '../src/sim/types';
import { PITCH_CENTER } from '../src/sim/vale_cup_layout';
import { groundHeight } from '../src/sim/world';

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as any, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function teleport(sim: GameServer['sim'], pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Mirrors the live loop's per-tick order (game.ts start()): tick, route the
// events, detect activity while the sim state (the match record) is still
// current, then broadcast.
function advance(server: GameServer): void {
  const events = server.sim.tick();
  (server as any).routeEvents(events);
  (server as any).detectActivity(events);
  (server as any).broadcastSnapshots();
}

// A catch-up broadcast pass: run `ticks` sim ticks (as the server's
// `while (acc >= DT)` loop does under load) but broadcast ONCE at the end, so
// tickCount can stride past a wire-interval multiple in a single pass.
function advanceCatchUp(server: GameServer, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const events = server.sim.tick();
    (server as any).routeEvents(events);
    (server as any).detectActivity(events);
  }
  (server as any).broadcastSnapshots();
}

function cmd(server: GameServer, session: ClientSession, payload: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));
}

function lastSnap(fc: FakeClient): any {
  for (let i = fc.sent.length - 1; i >= 0; i--) {
    const msg = fc.sent[i] as any;
    if (msg.t === 'snap') return msg;
  }
  return null;
}

function eventsOf(fc: FakeClient, type: string): any[] {
  return fc.sent
    .flatMap((msg: any) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === type);
}

// Snapshots (from message index `fromIndex` on) whose delta self payload
// carries `key` explicitly; delta elision omits an unchanged key, so state
// scans must look at every snapshot, not just the last one.
function snapsWithSelfKey(fc: FakeClient, key: string, fromIndex = 0): any[] {
  return fc.sent
    .slice(fromIndex)
    .filter((msg: any) => msg.t === 'snap' && Object.hasOwn(msg.self, key)) as any[];
}

const OVER_TICKS = VC_OVER_DELAY * 20;

describe('vale cup: online integration (GameServer)', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
    vi.clearAllMocks();
    drainActivity(); // the activity queue is module-global; start each test empty
  });

  it('routes vcup_queue to the sim and rejects malformed bracket/nation/role without crashing', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Queuer');
    teleport(server.sim, session.pid, 0, -40);
    const joinSpy = vi.spyOn(server.sim, 'vcupQueueJoin');
    const roleSpy = vi.spyOn(server.sim, 'vcupSetRole');

    // every malformed shape is dropped before the sim is touched
    const bad = [
      { cmd: 'vcup_queue' },
      { cmd: 'vcup_queue', bracket: 0, nation: 'vale', role: 'striker' },
      { cmd: 'vcup_queue', bracket: 6, nation: 'vale', role: 'striker' },
      { cmd: 'vcup_queue', bracket: 2.5, nation: 'vale', role: 'striker' },
      { cmd: 'vcup_queue', bracket: '3', nation: 'vale', role: 'striker' },
      { cmd: 'vcup_queue', bracket: 3, nation: 'narnia', role: 'striker' },
      { cmd: 'vcup_queue', bracket: 3, nation: 7, role: 'striker' },
      { cmd: 'vcup_queue', bracket: 3, nation: 'vale', role: 'coach' },
      { cmd: 'vcup_queue', bracket: 3, nation: 'vale', role: null },
      { cmd: 'vcup_role', role: 'goalhog' },
      { cmd: 'vcup_role' },
    ];
    for (const payload of bad) cmd(server, session, payload);
    advance(server);
    expect(joinSpy).not.toHaveBeenCalled();
    expect(roleSpy).not.toHaveBeenCalled();
    expect(eventsOf(fc, 'vcupQueued')).toHaveLength(0);

    // the session is still healthy: a valid queue routes and answers
    cmd(server, session, { cmd: 'vcup_queue', bracket: 3, nation: 'vale', role: 'striker' });
    advance(server);
    expect(joinSpy).toHaveBeenCalledWith(3, 'vale', 'striker', false, session.pid);
    const queued = eventsOf(fc, 'vcupQueued');
    expect(queued).toHaveLength(1);
    expect(queued[0].bracket).toBe(3);
    expect(queued[0].position).toBe(1);

    cmd(server, session, { cmd: 'vcup_role', role: 'keeper' });
    advance(server);
    expect(roleSpy).toHaveBeenCalledWith('keeper', session.pid);

    cmd(server, session, { cmd: 'vcup_leave' });
    advance(server);
    expect(eventsOf(fc, 'vcupUnqueued')).toHaveLength(1);
  });

  it('derives liveHidden per viewer: a practicing player is shipped liveHidden, a participant is not', () => {
    // A real Sowfield match runs (two participants) while a third player is off in
    // a private practice instance. The server derives the per-viewer suppression
    // flag `liveHidden = shared.live !== null && full.live === null`; this pins that
    // derivation end to end on the real wire (the pure-sim class-d test exercises
    // cupInfoFor directly, and the client test injects liveHidden manually, so
    // neither covers the server derivation): an inverted or always-false derivation
    // would flip both assertions below.
    const fcA = fakeWs();
    const sa = joinServer(server, fcA, 40, 'Champ');
    const fcB = fakeWs();
    const sb = joinServer(server, fcB, 41, 'Rival');
    const fcP = fakeWs();
    const sp = joinServer(server, fcP, 42, 'Practicer');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    teleport(server.sim, sp.pid, 8, -40);
    // Form a real Sowfield match (it exists as soon as the match forms, well
    // before kickoff, which is all `shared.live` and the liveHidden derivation
    // need) and put the third player in a private practice instance in parallel.
    server.sim.vcupQueueJoin(1, 'vale', 'allrounder', false, sa.pid);
    server.sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, sb.pid);
    server.sim.vcupPracticeStart(2, sp.pid);
    advance(server); // one tick forms the queued match
    expect(server.sim.vcup.match).toBeTruthy();
    expect(server.sim.vcup.practices.length).toBe(1);

    for (let i = 0; i < 12; i++) advance(server);

    // participant: not in a practice, so their client shows the live strip
    const aFrames = snapsWithSelfKey(fcA, 'vcup');
    const aShared = snapsWithSelfKey(fcA, 'vcupb');
    expect(aFrames.length).toBeGreaterThan(0);
    expect(aShared.length).toBeGreaterThan(0);
    const aVcup = aFrames[aFrames.length - 1].self.vcup;
    const aLive = aShared[aShared.length - 1].self.vcupb.live;
    expect(aVcup.liveHidden).toBe(false);
    expect(aLive).not.toBeNull();

    // practicer: server-derived liveHidden TRUE, while the SAME raw strip still
    // rides their vcupb (suppression is per-viewer, never baked into the shared string)
    const pFrames = snapsWithSelfKey(fcP, 'vcup');
    const pShared = snapsWithSelfKey(fcP, 'vcupb');
    expect(pFrames.length).toBeGreaterThan(0);
    expect(pShared.length).toBeGreaterThan(0);
    const pVcup = pFrames[pFrames.length - 1].self.vcup;
    const pLive = pShared[pShared.length - 1].self.vcupb.live;
    expect(pVcup.liveHidden).toBe(true);
    expect(pLive).not.toBeNull();
    // both viewers received a byte-identical realm-wide strip
    expect(pLive).toEqual(aLive);
  });

  it('ships the vcup self key within 10 ticks of a queue change, JSON-clean', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 2, 'Delta');
    teleport(server.sim, session.pid, 0, -40);

    // baseline: the first snapshot carries the readout, split across the
    // per-viewer `vcup` key and the realm-wide `vcupb` key (both ship on a fresh
    // join). The per-viewer remainder rides `vcup`; the realm-wide fields (queue
    // sizes, the winners board) ride `vcupb`.
    advance(server);
    const first = lastSnap(fc);
    expect(first.self.vcup).toBeTruthy();
    expect(first.self.vcup.queued).toBe(false);
    expect(first.self.vcup.standing).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(first.self.vcupb).toBeTruthy();
    expect(Object.keys(first.self.vcupb.queueSizes).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(Array.isArray(first.self.vcupb.board)).toBe(true);
    expect(() => JSON.stringify(first.self.vcup)).not.toThrow();
    expect(() => JSON.stringify(first.self.vcupb)).not.toThrow();

    // a queue join surfaces on the throttled keys within VC_WIRE_HZ (10 ticks):
    // the per-viewer slot on `vcup`, the realm-wide queue count on `vcupb`
    cmd(server, session, { cmd: 'vcup_queue', bracket: 3, nation: 'copperdig', role: 'sweeper' });
    const before = fc.sent.length;
    for (let i = 0; i < 10; i++) advance(server);
    const updates = snapsWithSelfKey(fc, 'vcup', before);
    expect(updates.length).toBeGreaterThan(0);
    const info = updates[updates.length - 1].self.vcup;
    expect(info.queued).toBe(true);
    expect(info.bracket).toBe(3);
    expect(info.nation).toBe('copperdig');
    expect(info.role).toBe('sweeper');
    expect(info.position).toBe(1);
    const sharedUpdates = snapsWithSelfKey(fc, 'vcupb', before);
    expect(sharedUpdates.length).toBeGreaterThan(0);
    expect(sharedUpdates[sharedUpdates.length - 1].self.vcupb.queueSizes['3']).toBe(1);

    // ... and an unchanged readout is delta-elided, not re-sent every eval:
    // NEITHER the per-viewer key NOR the realm-wide key re-ships on an idle window
    const idle = fc.sent.length;
    for (let i = 0; i < 20; i++) advance(server);
    expect(snapsWithSelfKey(fc, 'vcup', idle)).toHaveLength(0);
    expect(snapsWithSelfKey(fc, 'vcupb', idle)).toHaveLength(0);
  });

  it('builds the shared Vale Cup readout once per broadcast pass regardless of session count', () => {
    // The realm-wide `vcupb` fragment is built and stringified a single time per
    // due broadcast pass by the realm-readout memo, then reused by every viewer.
    // Two sessions in one pass must trigger exactly ONE build and ONE stringify,
    // not one per session: that is the whole point of the shared memo. Dueness is
    // `tickCount - lastVcupWireTick >= VC_WIRE_INTERVAL_TICKS`, decided once per
    // pass (VC_WIRE_HZ = 2 at DT = 1/20, so every 10 ticks).
    const VC_WIRE_INTERVAL_TICKS = 10;
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 40, 'ShareOne');
    const sb = joinServer(server, fcB, 41, 'ShareTwo');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);

    // advance well past both sessions' fresh-join ships so lastSent for `vcup`
    // and `vcupb` is settled and the gate opens only on aligned ticks
    for (let i = 0; i < 30; i++) advance(server);

    const memo = (server as any).realmReadout;
    // step up to just before the next DUE pass (the memo is untouched between due
    // passes once both sessions have settled); dueness rides the realm-global
    // lastVcupWireTick tracker, not a tickCount multiple, so align to the tracker
    while (server.sim.tickCount - (server as any).lastVcupWireTick < VC_WIRE_INTERVAL_TICKS - 1)
      advance(server);
    const buildsBefore = memo.objectBuilds;
    const stringifiesBefore = memo.stringifies;

    // one advance crosses exactly one due broadcast pass, shared by both sessions
    advance(server);
    expect(server.sim.tickCount - (server as any).lastVcupWireTick).toBe(0);
    expect(memo.objectBuilds).toBe(buildsBefore + 1);
    expect(memo.stringifies).toBe(stringifiesBefore + 1);
  });

  it('ships a changed shared readout to every settled session in the same due pass, byte-identical', () => {
    // The realm-global dueness tracker deliberately ALIGNS sessions: when the
    // shared readout changes, every settled viewer receives `vcupb` in the SAME
    // due broadcast pass, each frame embedding the one memoized string (maybeRaw
    // splices `"vcupb":<memo.json>` verbatim). This pins the aligned fan-out
    // shape itself, the flip side of the build-once pin above: what a due pass
    // emits is bounded to raw re-sends of one string, never per-session
    // rebuilds, and it lands on one pass, never staggered.
    const VC_WIRE_INTERVAL_TICKS = 10;
    const rawFakeWs = (): FakeClient & { raws: string[] } => {
      const sent: unknown[] = [];
      const raws: string[] = [];
      return {
        sent,
        raws,
        ws: {
          readyState: 1,
          send: (payload: string) => {
            raws.push(payload);
            sent.push(JSON.parse(payload));
          },
        },
      };
    };
    const fcA = rawFakeWs();
    const fcB = rawFakeWs();
    const fcC = fakeWs();
    const sa = joinServer(server, fcA, 60, 'BurstOne');
    const sb = joinServer(server, fcB, 61, 'BurstTwo');
    const sc = joinServer(server, fcC, 62, 'BurstQueuer');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    teleport(server.sim, sc.pid, 8, -40);
    // settle all three past their fresh-join ships so only the due gate opens
    for (let i = 0; i < 30; i++) advance(server);

    // step to just before the next due pass, THEN change the shared readout:
    // the observers A and B do nothing, only C's queue join bumps queueSizes
    while (server.sim.tickCount - (server as any).lastVcupWireTick < VC_WIRE_INTERVAL_TICKS - 1)
      advance(server);
    cmd(server, sc, { cmd: 'vcup_queue', bracket: 3, nation: 'vale', role: 'striker' });
    const aBefore = fcA.sent.length;
    const bBefore = fcB.sent.length;
    const memo = (server as any).realmReadout;
    const stringifiesBefore = memo.stringifies;

    // ONE advance crosses exactly one due pass: both observers get the readout
    advance(server);
    expect(server.sim.tickCount - (server as any).lastVcupWireTick).toBe(0);
    const aShips = snapsWithSelfKey(fcA, 'vcupb', aBefore);
    const bShips = snapsWithSelfKey(fcB, 'vcupb', bBefore);
    expect(aShips).toHaveLength(1);
    expect(bShips).toHaveLength(1);
    expect(aShips[0].self.vcupb.queueSizes['3']).toBe(1);

    // byte identity on the UNPARSED payloads: both frames embed the ONE
    // memoized string, and serving both viewers cost exactly one stringify
    expect(memo.stringifies).toBe(stringifiesBefore + 1);
    const needle = `"vcupb":${memo.json}`;
    expect(fcA.raws.slice(aBefore).some((p) => p.includes(needle))).toBe(true);
    expect(fcB.raws.slice(bBefore).some((p) => p.includes(needle))).toBe(true);
  });

  it('reships the readout to an established session under catch-up, off a wire-interval multiple', () => {
    // broadcastSnapshots runs once per callback OUTSIDE the `while (acc >= DT)`
    // catch-up loop, so under load tickCount jumps 2+ per pass and can land off a
    // VC_WIRE_INTERVAL_TICKS multiple. A `tickCount % N === 0` gate would skip the
    // aligned pass and stall the readout past its throttle; the `>=` dueness gate
    // ships it. This drives a real catch-up stride that lands off a multiple, so it
    // reds on the modulo gate and passes on the tracker.
    const VC_WIRE_INTERVAL_TICKS = 10;
    const fcA = fakeWs();
    const sa = joinServer(server, fcA, 80, 'Established');
    teleport(server.sim, sa.pid, 0, -300); // far idle: its own vcup never changes
    const fcB = fakeWs();
    const sb = joinServer(server, fcB, 81, 'Mover');
    teleport(server.sim, sb.pid, 0, -40);
    for (let i = 0; i < 25; i++) advance(server); // settle both (vcup/vcupb sent, no fresh-join arm)

    // a realm-wide change the established viewer must still see within the throttle:
    // B joins a queue, bumping the shared queueSizes (rides vcupb, not the idler's vcup)
    cmd(server, sb, { cmd: 'vcup_queue', bracket: 4, nation: 'vale', role: 'striker' });
    const after = fcA.sent.length;
    const lastWire = (server as any).lastVcupWireTick;

    // one CATCH-UP pass that ticks a full interval + 1 (due under `>=`) and lands OFF
    // a multiple of the interval (a modulo gate would skip it and stall the readout)
    let stride = VC_WIRE_INTERVAL_TICKS + 1 - (server.sim.tickCount - lastWire);
    while ((server.sim.tickCount + stride) % VC_WIRE_INTERVAL_TICKS === 0) stride++;
    advanceCatchUp(server, stride);

    // decisive preconditions: due under `>=`, but off a modulo multiple
    expect(server.sim.tickCount - lastWire).toBeGreaterThanOrEqual(VC_WIRE_INTERVAL_TICKS);
    expect(server.sim.tickCount % VC_WIRE_INTERVAL_TICKS).not.toBe(0);

    const shared = snapsWithSelfKey(fcA, 'vcupb', after);
    expect(shared.length).toBeGreaterThan(0); // the readout shipped despite the stride
    expect(shared[shared.length - 1].self.vcupb.queueSizes['4']).toBe(1);
  });

  it('isolates the once-a-second live-clock churn: only vcupb reships to a far idle viewer, vcup stays elided', async () => {
    // The phase exists to stop a live match's whole-second clock from re-serializing
    // every viewer's whole CupInfo. A running match ticks the realm-wide `vcupb.live`
    // clock; a far idle viewer (not a participant, not a spectator, so its per-viewer
    // remainder is constant) must receive the churning `vcupb` while its `vcup` stays
    // delta-elided. A regression that folds a per-second field into vcup, or re-sends
    // both keys together, reds the vcup-elided assertion.
    vi.spyOn(dailyRewardService, 'recordValeCupResult').mockResolvedValue(0);
    const fcA = fakeWs();
    const fcB = fakeWs();
    const fcC = fakeWs();
    const sa = joinServer(server, fcA, 60, 'Kicker', 'warrior');
    const sb = joinServer(server, fcB, 61, 'Keeper', 'mage');
    const sc = joinServer(server, fcC, 62, 'FarIdler', 'priest');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    teleport(server.sim, sc.pid, 0, -300); // far from the pitch: spectate stays null
    advance(server);

    cmd(server, sa, { cmd: 'vcup_queue', bracket: 1, nation: 'vale', role: 'striker' });
    cmd(server, sb, { cmd: 'vcup_queue', bracket: 1, nation: 'mirefen', role: 'keeper' });
    advance(server);
    cmd(server, sa, { cmd: 'vcup_ready' });
    cmd(server, sb, { cmd: 'vcup_ready' });
    for (let i = 0; i < 20 * 40 && (server.sim as any).vcup.match?.phase !== 'active'; i++)
      advance(server);
    expect((server.sim as any).vcup.match?.phase).toBe('active');

    // let the far idler settle to a steady state past kickoff
    for (let i = 0; i < 25; i++) advance(server);
    const after = fcC.sent.length;

    // run two full seconds: the whole-second clock advances (so vcupb churns) while
    // the far idler carries no new per-viewer information
    for (let i = 0; i < 40; i++) advance(server);

    const sharedFrames = snapsWithSelfKey(fcC, 'vcupb', after);
    const viewerFrames = snapsWithSelfKey(fcC, 'vcup', after);
    expect(sharedFrames.length).toBeGreaterThan(0); // the clock churn reships the shared key
    expect(viewerFrames).toHaveLength(0); // but never the per-viewer key: the bandwidth win
    // and the reshipped shared strip really is the live clock advancing (>1 distinct value)
    const clocks = sharedFrames.map((f) => f.self.vcupb.live?.clock);
    expect(new Set(clocks).size).toBeGreaterThan(1);
  });

  it('runs a rated 1v1: sport kit flips on, the far ball streams at full rate, desertion persists the loss before the save, and restore sends an explicit sport null', async () => {
    const rewardSpy = vi.spyOn(dailyRewardService, 'recordValeCupResult').mockResolvedValue(0);
    const fcA = fakeWs();
    const fcB = fakeWs();
    const fcW = fakeWs();
    const sa = joinServer(server, fcA, 10, 'Deserter', 'warrior');
    const sb = joinServer(server, fcB, 11, 'Champion', 'mage');
    const sw = joinServer(server, fcW, 12, 'Watcher', 'priest');
    teleport(server.sim, sa.pid, 0, -40);
    teleport(server.sim, sb.pid, 4, -40);
    // The watcher sits 85yd north of the pitch center: outside both the 55yd
    // full-rate and the 80yd half-rate tiers, inside the 90yd interest radius.
    teleport(server.sim, sw.pid, PITCH_CENTER.x, PITCH_CENTER.z + 85);
    advance(server);

    cmd(server, sa, { cmd: 'vcup_queue', bracket: 1, nation: 'vale', role: 'striker' });
    cmd(server, sb, { cmd: 'vcup_queue', bracket: 1, nation: 'mirefen', role: 'keeper' });
    advance(server);

    // both fighters are seated; the heavy 'sport' field flips to the role kit
    // on the match-start snapshot (wireRev bump, no extra command needed)
    for (const [fc, name] of [
      [fcA, 'Deserter'],
      [fcB, 'Champion'],
    ] as const) {
      const found = eventsOf(fc, 'vcupFound');
      expect(found.length, `${name} vcupFound`).toBe(1);
      expect(found[0].bracket).toBe(1);
      const snap = lastSnap(fc);
      // 1v1 coerces every role to the all-rounder kit (PRD)
      expect(snap.self.sport).toEqual({ role: 'allrounder' });
    }

    // pre-match briefing: both fighters ready up (vcup_ready). On the public
    // server the briefing is a fixed >= 30s betting/instructions window (ready-up
    // no longer shortcuts it), so advance past the window + the 3s countdown until
    // the whistle; kickoff spawns the ball at the center spot.
    cmd(server, sa, { cmd: 'vcup_ready' });
    cmd(server, sb, { cmd: 'vcup_ready' });
    for (let i = 0; i < 20 * 40 && (server.sim as any).vcup.match?.phase !== 'active'; i++)
      advance(server);
    const match = (server.sim as any).vcup.match;
    expect(match.phase).toBe('active');
    expect(match.rated).toBe(true);
    const ball = match.ball;
    expect(ball).toBeTruthy();

    // the match readout reaches the players over the throttled keys (within one
    // 10-tick eval window of the kickoff): the per-viewer match view on `vcup`,
    // the realm-wide live strip on `vcupb`
    for (let i = 0; i < 10; i++) advance(server);
    const matchInfo = snapsWithSelfKey(fcB, 'vcup').pop()?.self.vcup;
    expect(matchInfo?.match?.ballId).toBe(ball.entityId);
    expect(matchInfo?.match?.phase).toBe('active');
    const sharedInfo = snapsWithSelfKey(fcB, 'vcupb').pop()?.self.vcupb;
    expect(sharedInfo?.live?.bracket).toBe(1);

    // one settle pass so the watcher has first sight of the spawned ball
    advance(server);
    // full-rate carve-out: a MOVING ball lands a dyn record in EVERY
    // consecutive snapshot for an 85yd viewer (quarter tier without the
    // carve-out: one record per 4 ticks)
    for (let i = 0; i < 6; i++) {
      ball.vx = 6; // keep it rolling against friction (test-only nudge)
      const before = fcW.sent.length;
      advance(server);
      const snap = lastSnap(fcW);
      expect(fcW.sent.length).toBeGreaterThan(before);
      const rec = (snap.ents as any[]).find((r) => r.id === ball.entityId);
      expect(rec, `ball dyn record in consecutive snapshot ${i}`).toBeTruthy();
    }

    // presence: fighters on the pitch report the venue, not the vale
    expect((server as any).presenceOf(sb).zone).toBe('The Sowfield');
    expect((server as any).presenceOf(sw).zone).toBe('Eastbrook Vale');

    // desertion: the leaver's loss is resolved BEFORE the leave save, so the
    // persisted state already carries it (and the pre-match return position,
    // never mid-pitch coordinates)
    await server.leave(sa, 'test disconnect');
    const saveMock = vi.mocked(db.saveCharacterAndMarketState);
    const saved = saveMock.mock.calls.find((c) => c[0] === sa.characterId);
    expect(saved, 'leave save landed').toBeTruthy();
    const state = saved![2] as any;
    expect(state.vcupLosses).toBe(1);
    expect(state.vcupWins ?? 0).toBe(0);
    expect(state.pos.x).toBeCloseTo(0, 1);
    expect(state.pos.z).toBeCloseTo(-40, 1);

    // the walkover decides the match for the remaining side
    const endAt = fcB.sent.length;
    advance(server);
    const results = eventsOf(fcB, 'vcupResult');
    expect(results).toHaveLength(1);
    expect(results[0].won).toBe(true);
    expect(results[0].draw).toBe(false);

    // daily-reward arm: exactly one grant, for the human winner of the rated bout
    expect(rewardSpy).toHaveBeenCalledTimes(1);
    expect(rewardSpy.mock.calls[0][0]).toBe(sb.accountId);
    expect(rewardSpy.mock.calls[0][1]).toMatchObject({
      won: true,
      bracket: 1,
      matchId: match.id,
      rated: true,
      hasBots: false,
      practice: false,
      completionId: expect.any(String),
      completedAt: expect.any(Date),
    });

    // one Discord card for the decided match, tagging the winning side
    const cards = drainActivity().filter((c) => c.kind === 'vale_cup');
    expect(cards).toHaveLength(1);
    expect(cards[0].names).toEqual(['Champion']);
    expect(cards[0].accountIds).toEqual([sb.accountId]);
    expect(cards[0].bracket).toBe(1);
    expect(cards[0].winnerNation).toBe('mirefen');

    // the winner's standing lands on the next vcup eval
    for (let i = 0; i < 10; i++) advance(server);
    const standing = snapsWithSelfKey(fcB, 'vcup', endAt).pop()?.self.vcup.standing;
    expect(standing).toEqual({ wins: 1, losses: 0, draws: 0 });

    // aftermath elapses -> teardown restores the class kit; the heavy block
    // must send sport as an EXPLICIT null (the client keeps the prior value
    // on omission by design, so omission would strand the sport kit)
    const restoreAt = fcB.sent.length;
    for (let i = 0; i < OVER_TICKS + 5; i++) advance(server);
    expect((server.sim as any).vcup.match).toBeNull();
    const sportUpdates = snapsWithSelfKey(fcB, 'sport', restoreAt);
    expect(sportUpdates.length).toBeGreaterThan(0);
    expect(sportUpdates[sportUpdates.length - 1].self.sport).toBeNull();
    // and the match block clears from the readout: `match` off the per-viewer
    // `vcup`, the realm-wide live strip off `vcupb`
    const cleared = snapsWithSelfKey(fcB, 'vcup', restoreAt).pop()?.self.vcup;
    expect(cleared?.match).toBeNull();
    const clearedShared = snapsWithSelfKey(fcB, 'vcupb', restoreAt).pop()?.self.vcupb;
    expect(clearedShared?.live).toBeNull();
    rewardSpy.mockRestore();
  });

  it('gates the daily-reward arm: draws and matchless results grant nothing, practice uses reduced path', () => {
    const rewardSpy = vi.spyOn(dailyRewardService, 'recordValeCupResult').mockResolvedValue(0);
    const fc = fakeWs();
    const session = joinServer(server, fc, 20, 'Gated');
    teleport(server.sim, session.pid, 0, -40);
    const detect = (ev: Record<string, unknown>) => (server as any).detectActivity([ev]);

    // a draw is not a decided match
    detect({ type: 'vcupResult', won: false, draw: true, pid: session.pid });
    // no live match record (already torn down / stale event): no grant
    detect({ type: 'vcupResult', won: true, draw: false, pid: session.pid });
    expect(rewardSpy).not.toHaveBeenCalled();

    // Private practice wins use the reduced bot-match task path and do not create a public card.
    const fakeMatch: any = {
      id: 999,
      bracket: 1,
      rated: false,
      practice: { ownerPid: session.pid, slot: 0 },
      teamA: [session.pid],
      teamB: [9999],
      rosterA: [{ pid: session.pid, bot: false }],
      rosterB: [{ pid: 9999, bot: true }],
      scoreA: 5,
      scoreB: 0,
      nationA: 'vale',
      nationB: 'moon',
    };
    (server.sim as any).vcup.match = fakeMatch;
    detect({ type: 'vcupResult', won: true, draw: false, pid: session.pid });
    expect(rewardSpy).toHaveBeenCalledTimes(1);
    expect(rewardSpy).toHaveBeenLastCalledWith(
      session.accountId,
      expect.objectContaining({
        won: true,
        bracket: 1,
        matchId: 999,
        rated: false,
        hasBots: true,
        practice: true,
      }),
    );
    expect(drainActivity().filter((c) => c.kind === 'vale_cup')).toHaveLength(0);

    detect({ type: 'vcupResult', won: false, draw: false, pid: session.pid });
    expect(rewardSpy).toHaveBeenCalledTimes(1);

    // An unrated, non-practice bot-filled match earns reduced task points but no public card.
    fakeMatch.practice = undefined;
    detect({ type: 'vcupResult', won: true, draw: false, pid: session.pid });
    expect(rewardSpy).toHaveBeenCalledTimes(2);
    expect(rewardSpy).toHaveBeenLastCalledWith(
      session.accountId,
      expect.objectContaining({
        won: true,
        bracket: 1,
        matchId: 999,
        rated: false,
        hasBots: true,
        practice: false,
      }),
    );
    expect(drainActivity().filter((c) => c.kind === 'vale_cup')).toHaveLength(0);

    // A rated loss is still not a daily-reward task: the variant is wins only.
    fakeMatch.rated = true;
    fakeMatch.rosterB[0].bot = false;
    detect({ type: 'vcupResult', won: false, draw: false, pid: session.pid });
    expect(rewardSpy).toHaveBeenCalledTimes(2);
    expect(drainActivity().filter((c) => c.kind === 'vale_cup')).toHaveLength(0);

    // Flipping the same match to a rated win proves the full-value rated path.
    detect({ type: 'vcupResult', won: true, draw: false, pid: session.pid });
    expect(rewardSpy).toHaveBeenCalledTimes(3);
    expect(drainActivity().filter((c) => c.kind === 'vale_cup')).toHaveLength(1);
    (server.sim as any).vcup.match = null;
    rewardSpy.mockRestore();
  });

  it('reuses stable completion data when a Vale Cup result is detected twice', () => {
    vi.useFakeTimers();
    const rewardSpy = vi.spyOn(dailyRewardService, 'recordValeCupResult').mockResolvedValue(0);
    try {
      const fc = fakeWs();
      const session = joinServer(server, fc, 30, 'RetryWinner');
      const match: any = {
        id: 77,
        bracket: 1,
        rated: true,
        practice: null,
        teamA: [session.pid],
        teamB: [9999],
        rosterA: [{ pid: session.pid, bot: false }],
        rosterB: [{ pid: 9999, bot: false }],
        scoreA: 1,
        scoreB: 0,
        nationA: 'vale',
        nationB: 'moon',
      };
      (server.sim as any).vcup.match = match;
      const result = { type: 'vcupResult', won: true, draw: false, pid: session.pid };

      vi.setSystemTime(new Date('2026-06-30T20:59:00.000Z'));
      (server as any).detectActivity([result]);
      vi.setSystemTime(new Date('2026-06-30T21:01:00.000Z'));
      (server as any).detectActivity([result]);

      expect(rewardSpy).toHaveBeenCalledTimes(2);
      const first = rewardSpy.mock.calls[0][1];
      const replay = rewardSpy.mock.calls[1][1];
      const firstCompletedAt = first.completedAt;
      const replayCompletedAt = replay.completedAt;
      expect(firstCompletedAt).toBeInstanceOf(Date);
      expect(replayCompletedAt).toBeInstanceOf(Date);
      expect(first.completionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(firstCompletedAt.toISOString()).toBe('2026-06-30T20:59:00.000Z');
      expect(replay.completionId).toBe(first.completionId);
      expect(replayCompletedAt.toISOString()).toBe(firstCompletedAt.toISOString());
    } finally {
      (server.sim as any).vcup.match = null;
      rewardSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
