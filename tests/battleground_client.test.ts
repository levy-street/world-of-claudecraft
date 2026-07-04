import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { BgInfo } from '../src/world_api';

// ---------------------------------------------------------------------------
// ClientWorld battleground mirror (IWorldBattleground, online side).
// Covers, against a bare ClientWorld driven through applySnapshot/onMessage
// (the snapshots.test.ts idiom, copied here rather than shared):
//   (a) the `bg` delta guard: an omitted key keeps the prior mirror value, an
//       explicit null clears to null (the `arena` key's null semantics),
//   (b) the bg_* command senders and their wire tokens,
//   (c) the spectator command gate: while spectating only chat and the
//       battleground spectate controls go out,
//   (d) the bgInfo.spectating local-override lifecycle (set on bgSpectate,
//       cleared by the spectate-clear frame or bgSpectateLeave; the wire value
//       from the anchored target is always null).
// ---------------------------------------------------------------------------

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot and
// onMessage directly (mirrors snapshots.test.ts `bareClient`).
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.bgInfo = null;
  c.bgSpectatingMatchId = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  return c;
}

interface Internals {
  applySnapshot(snapshot: unknown): void;
  onMessage(raw: string): void;
}

function internalsOf(client: ClientWorld): Internals {
  return client as unknown as Internals;
}

// Attach a capturing socket so cmd() sends land in `sent` (snapshots.test.ts
// client-side delta-merge idiom; WebSocket.OPEN is stubbed per test).
function wireUp(client: ClientWorld): any[] {
  const sent: any[] = [];
  (client as any).ws = {
    readyState: 1,
    send: (payload: string) => sent.push(JSON.parse(payload)),
  };
  return sent;
}

function withWebSocketStub(fn: () => void): void {
  const oldWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = { OPEN: 1 };
  try {
    fn();
  } finally {
    (globalThis as any).WebSocket = oldWebSocket;
  }
}

// A minimal full self record (identity + dynamics) applySnapshot accepts.
function selfRecord(id: number, name: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    k: 'player',
    tid: 'warrior',
    nm: name,
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 100,
    rtype: 'rage',
    ...extra,
  };
}

function snapWith(self: any): any {
  return { t: 'snap', ents: [], self };
}

// The BgInfo shape the server sends fully-formed; the wire `spectating` is
// always null (the self record is the anchored target's view).
function bgFixture(overrides: Partial<BgInfo> = {}): BgInfo {
  return {
    standing: { rating: 1500, wins: 0, losses: 0 },
    queued: false,
    queueSize: 0,
    position: 0,
    waitSec: 0,
    deserterFor: 0,
    match: null,
    liveMatches: [],
    ladder: [],
    spectating: null,
    ...overrides,
  };
}

describe('bg delta guard', () => {
  it('mirrors s.bg onto bgInfo and keeps the prior value when the key is omitted', () => {
    const client = bareClient(1);
    const internals = internalsOf(client);

    internals.applySnapshot(
      snapWith(selfRecord(1, 'Fighter', { bg: bgFixture({ queued: true, queueSize: 3 }) })),
    );
    expect(client.bgInfo).toMatchObject({ queued: true, queueSize: 3 });
    expect(client.bgInfo?.standing).toEqual({ rating: 1500, wins: 0, losses: 0 });

    // a delta-less re-broadcast omits the key: the prior mirror survives, by
    // reference (the delta invariant: never default a missing self field)
    const ref = client.bgInfo;
    internals.applySnapshot(snapWith(selfRecord(1, 'Fighter')));
    expect(client.bgInfo).toBe(ref);
  });

  it('clears to null when the server sends an explicit null (arena null semantics)', () => {
    const client = bareClient(1);
    const internals = internalsOf(client);

    internals.applySnapshot(snapWith(selfRecord(1, 'Fighter', { bg: bgFixture() })));
    expect(client.bgInfo).not.toBeNull();

    internals.applySnapshot(snapWith(selfRecord(1, 'Fighter', { bg: null })));
    expect(client.bgInfo).toBeNull();

    // and a subsequent omitted key keeps the explicit null
    internals.applySnapshot(snapWith(selfRecord(1, 'Fighter')));
    expect(client.bgInfo).toBeNull();
  });
});

describe('battleground command senders', () => {
  it('sends the queue/spectate wire tokens; bgPracticeStart is an online no-op', () => {
    withWebSocketStub(() => {
      const client = bareClient(1);
      const sent = wireUp(client);

      client.bgQueueJoin();
      client.bgQueueLeave();
      client.bgSpectate(5);
      client.bgSpectateNext();
      client.bgSpectateLeave();
      client.bgPracticeStart();

      expect(sent).toEqual([
        { t: 'cmd', cmd: 'bg_queue' },
        { t: 'cmd', cmd: 'bg_leave' },
        { t: 'cmd', cmd: 'bg_spectate', matchId: 5 },
        { t: 'cmd', cmd: 'bg_spectate_next' },
        { t: 'cmd', cmd: 'bg_spectate_leave' },
      ]);
    });
  });
});

describe('spectator command gating', () => {
  it('blocks everything except chat and the bg spectate controls while spectating', () => {
    withWebSocketStub(() => {
      const client = bareClient(1);
      const sent = wireUp(client);
      const internals = internalsOf(client);

      internals.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
      expect(client.spectating).toBe('Suspect');

      // blocked: ordinary commands (queueing included) stay suppressed
      client.bgQueueJoin();
      client.bgQueueLeave();
      client.arenaQueueJoin();
      expect(sent).toEqual([]);

      // allowed: chat plus the spectate hop/leave controls
      client.chat('go blue');
      client.bgSpectateNext();
      client.bgSpectate(2);
      client.bgSpectateLeave();
      expect(sent).toEqual([
        { t: 'cmd', cmd: 'chat', text: 'go blue' },
        { t: 'cmd', cmd: 'bg_spectate_next' },
        { t: 'cmd', cmd: 'bg_spectate', matchId: 2 },
        { t: 'cmd', cmd: 'bg_spectate_leave' },
      ]);
    });
  });
});

describe('bgInfo.spectating local override lifecycle', () => {
  it('surfaces the locally tracked match id over the null wire value, and the clear frame resets it', () => {
    withWebSocketStub(() => {
      const client = bareClient(1);
      wireUp(client);
      const internals = internalsOf(client);

      // not spectating: the mirror carries the wire null through
      internals.applySnapshot(snapWith(selfRecord(1, 'Fighter', { bg: bgFixture() })));
      expect(client.bgInfo?.spectating).toBeNull();

      // ask to watch match 7; server confirms by re-anchoring the snapshot
      client.bgSpectate(7);
      internals.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
      internals.applySnapshot(snapWith(selfRecord(2, 'Suspect', { bg: bgFixture() })));
      expect(client.bgInfo?.spectating).toBe(7);

      // the clear frame (requested exit, match end, or target left) resets the
      // local override; the next bg delta re-mirrors with null
      internals.onMessage(JSON.stringify({ t: 'spectate' }));
      internals.applySnapshot(snapWith(selfRecord(1, 'Fighter', { bg: bgFixture() })));
      expect(client.bgInfo?.spectating).toBeNull();
    });
  });

  it('bgSpectateLeave clears the override before the server clear frame lands', () => {
    withWebSocketStub(() => {
      const client = bareClient(1);
      wireUp(client);
      const internals = internalsOf(client);

      client.bgSpectate(7);
      internals.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
      internals.applySnapshot(snapWith(selfRecord(2, 'Suspect', { bg: bgFixture() })));
      expect(client.bgInfo?.spectating).toBe(7);

      // leave: the local id drops immediately, so the very next bg delta
      // (still anchored to the target until the clear frame) shows null
      client.bgSpectateLeave();
      internals.applySnapshot(snapWith(selfRecord(2, 'Suspect', { bg: bgFixture() })));
      expect(client.bgInfo?.spectating).toBeNull();
    });
  });
});
