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

  it('ships the vcup self key within 10 ticks of a queue change, JSON-clean', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 2, 'Delta');
    teleport(server.sim, session.pid, 0, -40);

    // baseline: the first snapshot carries the full CupInfo readout
    advance(server);
    const first = lastSnap(fc);
    expect(first.self.vcup).toBeTruthy();
    expect(first.self.vcup.queued).toBe(false);
    expect(first.self.vcup.standing).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(Object.keys(first.self.vcup.queueSizes).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(Array.isArray(first.self.vcup.board)).toBe(true);
    expect(() => JSON.stringify(first.self.vcup)).not.toThrow();

    // a queue join surfaces on the throttled key within VC_WIRE_HZ (10 ticks)
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
    expect(info.queueSizes['3']).toBe(1);

    // ... and an unchanged readout is delta-elided, not re-sent every eval
    const idle = fc.sent.length;
    for (let i = 0; i < 20; i++) advance(server);
    expect(snapsWithSelfKey(fc, 'vcup', idle)).toHaveLength(0);
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

    // the match readout reaches the players over the throttled vcup key
    // (within one 10-tick eval window of the kickoff)
    for (let i = 0; i < 10; i++) advance(server);
    const matchInfo = snapsWithSelfKey(fcB, 'vcup').pop()?.self.vcup;
    expect(matchInfo?.match?.ballId).toBe(ball.entityId);
    expect(matchInfo?.match?.phase).toBe('active');
    expect(matchInfo?.live?.bracket).toBe(1);

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
    // and the match block clears from the readout
    const cleared = snapsWithSelfKey(fcB, 'vcup', restoreAt).pop()?.self.vcup;
    expect(cleared?.match).toBeNull();
    expect(cleared?.live).toBeNull();
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
