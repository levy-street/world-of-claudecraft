import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; interest logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import type { Entity } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: 'warrior' | 'rogue' = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// Teleport an entity to an absolute position, keeping the spatial grids exact.
function placeAt(server: GameServer, id: number, x: number, z: number): void {
  const e = server.sim.entities.get(id)!;
  const p = server.sim.groundPos(x, z);
  e.pos = p;
  e.prevPos = { ...p };
  server.sim.grid.update(e);
  if (e.kind === 'player') server.sim.playerGrid.update(e);
}

// Nudge an entity so its dynamic wire state changes, then advance the
// snapshot counter and broadcast — without running mob AI or wander.
function step(server: GameServer, moveIds: number[] = []): void {
  for (const id of moveIds) {
    const e = server.sim.entities.get(id)!;
    e.pos.x += 0.5;
    server.sim.grid.update(e);
    if (e.kind === 'player') server.sim.playerGrid.update(e);
  }
  server.sim.tickCount++;
  broadcast(server);
}

function entRecord(snap: any, id: number): any {
  return snap.ents.find((w: any) => w.id === id) ?? null;
}

function inKeep(snap: any, id: number): boolean {
  return (snap.keep ?? []).includes(id);
}

// Offset from the viewer along whichever x direction has world room.
function besideViewer(viewer: Entity, d: number): { x: number; z: number } {
  const dx = viewer.pos.x > 0 ? -d : d;
  return { x: viewer.pos.x + dx, z: viewer.pos.z };
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.missingSince = new Map(); // despawn-grace bookkeeping (set by the real field initializer)
  c.playerId = pid;
  c.moveInput = {};
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

describe('crowd interest management', () => {
  let server: GameServer;
  let viewerFc: FakeClient;
  let viewer: ClientSession;
  let subjectFc: FakeClient;
  let subject: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    viewerFc = fakeWs();
    viewer = joinServer(server, viewerFc, 1, 'Viewer');
    subjectFc = fakeWs();
    subject = joinServer(server, subjectFc, 2, 'Subject');
  });

  function placeSubjectAt(d: number): void {
    const v = server.sim.entities.get(viewer.pid)!;
    const at = besideViewer(v, d);
    placeAt(server, subject.pid, at.x, at.z);
  }

  it('sends full identity on first sight and lite records afterwards', () => {
    placeSubjectAt(30);
    broadcast(server);
    const first = entRecord(lastSnap(viewerFc.sent), subject.pid);
    expect(first).not.toBeNull();
    expect(first.k).toBe('player');
    expect(first.nm).toBe('Subject');
    expect(first.tid).toBeDefined();
    expect(first.lv).toBeDefined();

    viewerFc.sent.length = 0;
    step(server, [subject.pid]);
    const second = entRecord(lastSnap(viewerFc.sent), subject.pid);
    expect(second).not.toBeNull();
    expect(second.x).toBeDefined();
    expect(second.hp).toBeDefined();
    expect(second.k).toBeUndefined();
    expect(second.tid).toBeUndefined();
    expect(second.nm).toBeUndefined();
  });

  it('lists unchanged entities in keep instead of resending them', () => {
    placeSubjectAt(30);
    broadcast(server);
    viewerFc.sent.length = 0;
    step(server); // subject does not move
    const snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, subject.pid)).toBeNull();
    expect(inKeep(snap, subject.pid)).toBe(true);
  });

  it('resends full identity when it changes', () => {
    placeSubjectAt(30);
    broadcast(server);
    viewerFc.sent.length = 0;
    server.sim.setPlayerLevel(3, subject.pid);
    step(server);
    const rec = entRecord(lastSnap(viewerFc.sent), subject.pid);
    expect(rec).not.toBeNull();
    expect(rec.lv).toBe(3);
    expect(rec.nm).toBe('Subject');
  });

  it('omits new entities beyond the 90yd interest radius', () => {
    placeSubjectAt(110);
    broadcast(server);
    const snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, subject.pid)).toBeNull();
    expect(inKeep(snap, subject.pid)).toBe(false);
  });

  it('keeps known entities through the hysteresis band and drops past it', () => {
    placeSubjectAt(85);
    broadcast(server);
    expect(entRecord(lastSnap(viewerFc.sent), subject.pid)).not.toBeNull();

    placeSubjectAt(95);
    viewerFc.sent.length = 0;
    step(server);
    const at95 = lastSnap(viewerFc.sent);
    expect(entRecord(at95, subject.pid) !== null || inKeep(at95, subject.pid)).toBe(true);

    placeSubjectAt(105);
    viewerFc.sent.length = 0;
    step(server);
    const at105 = lastSnap(viewerFc.sent);
    expect(entRecord(at105, subject.pid)).toBeNull();
    expect(inKeep(at105, subject.pid)).toBe(false);
  });

  it('sends full identity again when an entity re-enters interest', () => {
    placeSubjectAt(30);
    broadcast(server);
    placeSubjectAt(150);
    step(server);
    placeSubjectAt(30);
    viewerFc.sent.length = 0;
    step(server);
    const rec = entRecord(lastSnap(viewerFc.sent), subject.pid);
    expect(rec).not.toBeNull();
    expect(rec.nm).toBe('Subject');
  });

  it('updates mid-range entities every other snapshot', () => {
    placeSubjectAt(70);
    broadcast(server); // first sight: full record
    let lite = 0;
    let kept = 0;
    for (let i = 0; i < 4; i++) {
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      const snap = lastSnap(viewerFc.sent);
      if (entRecord(snap, subject.pid)) lite++;
      if (inKeep(snap, subject.pid)) kept++;
    }
    expect(lite).toBe(2);
    expect(kept).toBe(2);
  });

  it('updates far entities every fourth snapshot', () => {
    placeSubjectAt(85);
    broadcast(server);
    let lite = 0;
    for (let i = 0; i < 8; i++) {
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      if (entRecord(lastSnap(viewerFc.sent), subject.pid)) lite++;
    }
    expect(lite).toBe(2);
  });

  it("always updates the viewer's target at full rate", () => {
    placeSubjectAt(70);
    broadcast(server);
    server.sim.entities.get(viewer.pid)!.targetId = subject.pid;
    let lite = 0;
    for (let i = 0; i < 4; i++) {
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      if (entRecord(lastSnap(viewerFc.sent), subject.pid)) lite++;
    }
    expect(lite).toBe(4);
  });

  it('always updates mobs attacking the viewer at full rate', () => {
    const mob = [...server.sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    const v = server.sim.entities.get(viewer.pid)!;
    const at = besideViewer(v, 70);
    placeAt(server, mob.id, at.x, at.z);
    broadcast(server);
    mob.aggroTargetId = viewer.pid;
    let updates = 0;
    for (let i = 0; i < 4; i++) {
      viewerFc.sent.length = 0;
      step(server, [mob.id]);
      if (entRecord(lastSnap(viewerFc.sent), mob.id)) updates++;
    }
    expect(updates).toBe(4);
  });

  it('keeps updating tiered entities when one broadcast covers several sim ticks', () => {
    // under event-loop pressure the 50ms timer fires late and the catch-up
    // loop runs 2+ sim ticks per broadcast; a parity-based stagger never
    // fires for half of all entities then, freezing them on clients
    placeSubjectAt(70);
    broadcast(server);
    for (const extraTicks of [2, 3]) {
      let updates = 0;
      for (let i = 0; i < 8; i++) {
        viewerFc.sent.length = 0;
        // wiggle in place so the position changes but the 55-80yd band holds
        placeSubjectAt(70 + (i % 2) * 0.5);
        server.sim.tickCount += extraTicks;
        broadcast(server);
        if (entRecord(lastSnap(viewerFc.sent), subject.pid)) updates++;
      }
      expect(updates, `entities starve at +${extraTicks} ticks/broadcast`).toBeGreaterThanOrEqual(
        7,
      );
    }
  });

  it('sends one settle record after an entity stops changing, then keeps', () => {
    placeSubjectAt(30);
    broadcast(server);
    step(server, [subject.pid]); // moving: lite records flow
    expect(entRecord(lastSnap(viewerFc.sent), subject.pid)).not.toBeNull();

    // stop: exactly one more record (so the client's extrapolation
    // converges on the rest position), then keep from there on
    viewerFc.sent.length = 0;
    step(server);
    expect(entRecord(lastSnap(viewerFc.sent), subject.pid)).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      viewerFc.sent.length = 0;
      step(server);
      const snap = lastSnap(viewerFc.sent);
      expect(entRecord(snap, subject.pid)).toBeNull();
      expect(inKeep(snap, subject.pid)).toBe(true);
    }
  });

  it("keeps the viewer's fleeing target in interest out to 130yd", () => {
    placeSubjectAt(70);
    broadcast(server);
    server.sim.entities.get(viewer.pid)!.targetId = subject.pid;
    placeSubjectAt(120); // past the normal 100yd drop radius
    viewerFc.sent.length = 0;
    step(server, [subject.pid]);
    const at120 = lastSnap(viewerFc.sent);
    expect(entRecord(at120, subject.pid)).not.toBeNull();

    placeSubjectAt(140); // past even the target allowance
    viewerFc.sent.length = 0;
    step(server);
    const at140 = lastSnap(viewerFc.sent);
    expect(entRecord(at140, subject.pid)).toBeNull();
    expect(inKeep(at140, subject.pid)).toBe(false);
  });

  it('hides undetected stealthed players and sends detected ones as translucent stealth', () => {
    const rogueFc = fakeWs();
    const rogue = joinServer(server, rogueFc, 3, 'Sneaks', 'rogue');
    server.sim.setPlayerLevel(10, viewer.pid);
    server.sim.setPlayerLevel(10, rogue.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    placeAt(server, rogue.pid, v.pos.x + 30, v.pos.z);
    server.sim.targetEntity(null, rogue.pid);
    server.sim.castAbility('stealth', rogue.pid);

    viewerFc.sent.length = 0;
    broadcast(server);
    let snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, rogue.pid)).toBeNull();
    expect(inKeep(snap, rogue.pid)).toBe(false);

    server.sim.setPlayerLevel(15, viewer.pid);
    viewerFc.sent.length = 0;
    step(server);
    snap = lastSnap(viewerFc.sent);
    const detected = entRecord(snap, rogue.pid);
    expect(detected).not.toBeNull();
    expect(detected.auras.some((a: any) => a.kind === 'stealth')).toBe(true);
  });

  it('always sends stealthed party members unless they are dueling the viewer', () => {
    const rogueFc = fakeWs();
    const rogue = joinServer(server, rogueFc, 3, 'PartySneak', 'rogue');
    server.sim.setPlayerLevel(10, viewer.pid);
    server.sim.setPlayerLevel(10, rogue.pid);
    server.sim.partyInvite(rogue.pid, viewer.pid);
    server.sim.partyAccept(rogue.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    placeAt(server, rogue.pid, v.pos.x + 30, v.pos.z);
    server.sim.targetEntity(null, rogue.pid);
    server.sim.castAbility('stealth', rogue.pid);

    viewerFc.sent.length = 0;
    broadcast(server);
    let snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, rogue.pid)).not.toBeNull();

    server.sim.duelRequest(rogue.pid, viewer.pid);
    server.sim.duelAccept(rogue.pid);
    viewerFc.sent.length = 0;
    step(server);
    snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, rogue.pid)).toBeNull();
    expect(inKeep(snap, rogue.pid)).toBe(false);
  });

  it('hides stealthed active duel opponents outside hostile detection range', () => {
    const rogueFc = fakeWs();
    const rogue = joinServer(server, rogueFc, 3, 'DuelSneak', 'rogue');
    server.sim.setPlayerLevel(10, viewer.pid);
    server.sim.setPlayerLevel(10, rogue.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    placeAt(server, rogue.pid, v.pos.x + 30, v.pos.z);
    server.sim.duelRequest(rogue.pid, viewer.pid);
    server.sim.duelAccept(rogue.pid);
    for (let i = 0; i < 20 * 5 && server.sim.duelFor(viewer.pid)?.state !== 'active'; i++)
      server.sim.tick();
    server.sim.castAbility('stealth', rogue.pid);

    viewerFc.sent.length = 0;
    step(server);
    const snap = lastSnap(viewerFc.sent);

    expect(
      server.sim.isHostileTo(
        server.sim.entities.get(viewer.pid)!,
        server.sim.entities.get(rogue.pid)!,
      ),
    ).toBe(true);
    expect(entRecord(snap, rogue.pid)).toBeNull();
    expect(inKeep(snap, rogue.pid)).toBe(false);
  });

  it('hides stealthed active duel opponents even inside normal detection range', () => {
    const rogueFc = fakeWs();
    const rogue = joinServer(server, rogueFc, 3, 'CloseSneak', 'rogue');
    server.sim.setPlayerLevel(10, viewer.pid);
    server.sim.setPlayerLevel(10, rogue.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    placeAt(server, rogue.pid, v.pos.x + 6, v.pos.z);
    server.sim.duelRequest(rogue.pid, viewer.pid);
    server.sim.duelAccept(rogue.pid);
    for (let i = 0; i < 20 * 5 && server.sim.duelFor(viewer.pid)?.state !== 'active'; i++)
      server.sim.tick();
    server.sim.castAbility('stealth', rogue.pid);

    viewerFc.sent.length = 0;
    step(server);
    const snap = lastSnap(viewerFc.sent);

    expect(
      server.sim.isHostileTo(
        server.sim.entities.get(viewer.pid)!,
        server.sim.entities.get(rogue.pid)!,
      ),
    ).toBe(true);
    expect(entRecord(snap, rogue.pid)).toBeNull();
    expect(inKeep(snap, rogue.pid)).toBe(false);
  });

  it('keeps stationary npcs visible out to the legacy 120yd radius', () => {
    const npc = [...server.sim.entities.values()].find((e) => e.kind === 'npc')!;
    // viewer 110yd from the npc, subject player at the same distance
    placeAt(server, viewer.pid, npc.pos.x + 110, npc.pos.z);
    placeAt(server, subject.pid, npc.pos.x + 110, npc.pos.z - 110);
    viewerFc.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(viewerFc.sent);
    const npcRec = entRecord(snap, npc.id);
    expect(npcRec).not.toBeNull();
    expect(npcRec.k).toBe('npc');
    expect(entRecord(snap, subject.pid)).toBeNull();

    // stationary: the next snapshot carries the npc in keep
    viewerFc.sent.length = 0;
    step(server);
    const next = lastSnap(viewerFc.sent);
    expect(entRecord(next, npc.id)).toBeNull();
    expect(inKeep(next, npc.id)).toBe(true);
  });
});

describe('client crowd protocol', () => {
  let server: GameServer;
  let viewerFc: FakeClient;
  let viewer: ClientSession;
  let subjectFc: FakeClient;
  let subject: ClientSession;
  let client: ClientWorld;

  beforeEach(() => {
    server = new GameServer();
    viewerFc = fakeWs();
    viewer = joinServer(server, viewerFc, 1, 'Viewer');
    subjectFc = fakeWs();
    subject = joinServer(server, subjectFc, 2, 'Subject');
    client = bareClient(viewer.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    const at = besideViewer(v, 30);
    placeAt(server, subject.pid, at.x, at.z);
  });

  function apply(): any {
    const snap = lastSnap(viewerFc.sent);
    (client as any).applySnapshot(snap);
    return snap;
  }

  it('retains entities listed in keep', () => {
    broadcast(server);
    apply();
    const e = client.entities.get(subject.pid)!;
    expect(e).toBeDefined();
    const pos = { ...e.pos };

    viewerFc.sent.length = 0;
    step(server); // subject unchanged -> keep
    const snap = apply();
    expect(inKeep(snap, subject.pid)).toBe(true);
    const kept = client.entities.get(subject.pid)!;
    expect(kept).toBe(e);
    expect(kept.pos).toEqual(pos);
  });

  it('prunes entities absent from both ents and keep', () => {
    broadcast(server);
    apply();
    expect(client.entities.has(subject.pid)).toBe(true);

    placeAt(
      server,
      subject.pid,
      server.sim.entities.get(viewer.pid)!.pos.x,
      server.sim.entities.get(viewer.pid)!.pos.z + 150,
    );
    viewerFc.sent.length = 0;
    step(server);
    apply();
    expect(client.entities.has(subject.pid)).toBe(false);
  });

  it('prunes a previously visible duel opponent when they enter stealth', () => {
    const rogueFc = fakeWs();
    const rogue = joinServer(server, rogueFc, 3, 'ClientSneak', 'rogue');
    server.sim.setPlayerLevel(10, viewer.pid);
    server.sim.setPlayerLevel(10, rogue.pid);
    const v = server.sim.entities.get(viewer.pid)!;
    placeAt(server, rogue.pid, v.pos.x + 6, v.pos.z);

    broadcast(server);
    apply();
    expect(client.entities.has(rogue.pid)).toBe(true);

    server.sim.duelRequest(rogue.pid, viewer.pid);
    server.sim.duelAccept(rogue.pid);
    for (let i = 0; i < 20 * 5 && server.sim.duelFor(viewer.pid)?.state !== 'active'; i++)
      server.sim.tick();
    server.sim.castAbility('stealth', rogue.pid);

    viewerFc.sent.length = 0;
    step(server);
    apply();

    expect(client.entities.has(rogue.pid)).toBe(false);
  });

  it('merges lite records preserving identity fields', () => {
    broadcast(server);
    apply();

    viewerFc.sent.length = 0;
    step(server, [subject.pid]);
    const snap = apply();
    const rec = entRecord(snap, subject.pid);
    expect(rec.nm).toBeUndefined(); // really was a lite record
    const e = client.entities.get(subject.pid)!;
    expect(e.name).toBe('Subject');
    expect(e.kind).toBe('player');
    expect(e.level).toBeGreaterThan(0);
    expect(e.pos.x).toBe(rec.x);
  });

  it('ignores lite records for unknown ids without creating ghosts', () => {
    broadcast(server);
    viewerFc.sent.length = 0;
    step(server, [subject.pid]); // produces a lite record for subject
    const snap = lastSnap(viewerFc.sent);
    expect(entRecord(snap, subject.pid).k).toBeUndefined();

    // a fresh client that never saw the full record must not crash or
    // fabricate a broken entity from identity-less data
    const fresh = bareClient(viewer.pid);
    (fresh as any).applySnapshot(snap);
    expect(fresh.entities.has(subject.pid)).toBe(false);
  });

  it('applies identity updates from full records', () => {
    broadcast(server);
    apply();
    expect(client.entities.get(subject.pid)!.level).not.toBe(5);

    server.sim.setPlayerLevel(5, subject.pid);
    viewerFc.sent.length = 0;
    step(server);
    apply();
    expect(client.entities.get(subject.pid)!.level).toBe(5);
  });

  it('keeps the cadence estimate clean across idle pauses', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      broadcast(server);
      apply();
      vi.advanceTimersByTime(100);
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      apply();
      expect(client.entities.get(subject.pid)!.netInterval).toBe(100);

      // records pause while an entity is unchanged; an 800ms standstill is
      // idleness, not cadence — folding it in would smear the entity's
      // next steps in slow motion
      vi.advanceTimersByTime(800);
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      apply();
      expect(client.entities.get(subject.pid)!.netInterval).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks per-entity update timing for interpolation', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      broadcast(server);
      apply();
      const e = client.entities.get(subject.pid)!;
      expect(e.netUpdatedAt).toBeDefined();
      const t0 = e.netUpdatedAt;
      expect(e.netInterval).toBeUndefined(); // one data point is not a cadence

      // keep snapshots must not advance the entity's clock
      vi.advanceTimersByTime(100);
      viewerFc.sent.length = 0;
      step(server);
      apply();
      expect(client.entities.get(subject.pid)!.netUpdatedAt).toBe(t0);

      // a real update measures the gap since the last record
      vi.advanceTimersByTime(100);
      viewerFc.sent.length = 0;
      step(server, [subject.pid]);
      apply();
      const after = client.entities.get(subject.pid)!;
      expect(after.netUpdatedAt).toBeGreaterThan(t0!);
      expect(after.netInterval).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
