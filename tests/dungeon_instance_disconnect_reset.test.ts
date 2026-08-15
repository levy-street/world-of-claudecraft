// Regression coverage for issue #1351: a dropped connection must not forfeit a
// solo (or party) dungeon run. Drives the real server session lifecycle
// (GameServer.join/socketClosed/expireLinkdeadSessions) against the real
// instance-slot pool (src/sim/instances/dungeons.ts), proving the fix through
// the actual disconnect/reconnect code path rather than the sim's occupancy
// check in isolation.
//
// The policy already implemented here (server/linkdead.ts + the durable
// per-character instanceKeyFor key from issue #1600) is: a dropped socket
// never removes the player's entity from the world, so a claimed instance
// never even starts its empty-timeout countdown while the owner is linkdead
// (LINKDEAD_GRACE_MS, five minutes); if the grace window itself lapses
// without a reconnect, the character is logged out and the instance's own
// INSTANCE_EMPTY_TIMEOUT countdown starts from zero, and a relog before that
// elapses rebinds the new session to the SAME still-alive claim via the
// durable character key, so progress survives even a full logout/relogin as
// long as nobody else has since claimed the freed slot. Deliberately leaving
// through the exit portal is unaffected: it always starts the ordinary
// countdown by stepping the player's entity outside the claim footprint.
//
// See src/sim/instances/dungeons.ts (instanceKeyFor) and server/linkdead.ts
// for the mechanisms this test exercises.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import {
  enterDungeon,
  instanceKeyFor,
  leaveDungeon,
  updateInstances,
} from '../src/sim/instances/dungeons';
import { INSTANCE_EMPTY_TIMEOUT } from '../src/sim/types';

type AnyEntity = Record<string, any>;
type AnySim = Record<string, any>;

function fakeWs() {
  const ws: any = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(() => {
      ws.readyState = 3;
    }),
  };
  return ws;
}

function expectJoined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  return result;
}

// Simulate the transport-level drop: the real WebSocketServer close/error
// handlers in server/main.ts call game.socketClosed(session, ws).
function dropSocket(server: GameServer, session: ClientSession, ws: any): boolean {
  ws.readyState = 3; // CLOSED
  return server.socketClosed(session, ws);
}

function claimedHollowCrypt(server: GameServer, pid: number): any {
  const sim = server.sim as AnySim;
  const key = instanceKeyFor(sim.ctx, pid);
  return (sim.instances as any[]).find((i) => i.dungeonId === 'hollow_crypt' && i.partyKey === key);
}

function killAMob(server: GameServer, inst: any, actorPid: number): AnyEntity {
  const sim = server.sim as AnySim;
  const actor = sim.entities.get(actorPid) as AnyEntity;
  const mob = (inst.mobIds as number[])
    .map((id) => sim.entities.get(id) as AnyEntity | undefined)
    .find((e) => e && !e.dead);
  if (!mob) throw new Error('no live mob in claimed instance');
  sim.dealDamage(actor, mob, mob.hp + 1_000_000, false, 'physical', null, 'hit');
  expect(mob.dead).toBe(true);
  return mob;
}

describe('dungeon instance survives a dropped connection (issue #1351)', () => {
  it('keeps a solo claim alive and untouched while the socket is linkdead, even with the empty timer forced to the brink', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 101, 'Solo', 'warrior', null));

    enterDungeon(server.sim.ctx, 'hollow_crypt', session.pid);
    const inst = claimedHollowCrypt(server, session.pid);
    expect(inst).toBeTruthy();
    const mobIds = [...inst.mobIds];
    const killedMob = killAMob(server, inst, session.pid);

    // The connection drops (page reload, network blip, closed tab): the
    // session goes linkdead instead of leaving the world.
    expect(dropSocket(server, session, ws)).toBe(true);

    // Force the empty timer right up to the threshold, then run the real
    // reaper: the linkdead player's entity is still physically standing
    // inside the claim, so occupancy must reset the timer to zero, never free.
    inst.emptyFor = INSTANCE_EMPTY_TIMEOUT - 1;
    updateInstances(server.sim.ctx);
    expect(inst.partyKey).not.toBeNull();
    expect(inst.emptyFor).toBe(0);
    expect(inst.mobIds).toEqual(mobIds);
    expect((server.sim.entities.get(killedMob.id) as AnyEntity | undefined)?.dead).toBe(true);

    // A real tick run (well beyond the window the issue describes) confirms
    // nothing frees out from under a live linkdead grace.
    for (let i = 0; i < 400; i++) server.sim.tick();
    expect(inst.partyKey).not.toBeNull();
    expect((server.sim.entities.get(killedMob.id) as AnyEntity | undefined)?.dead).toBe(true);

    // Reconnecting resumes the SAME session (same pid, same live entity), so
    // the player is simply still standing where they were, claim intact.
    const ws2 = fakeWs();
    const resumed = expectJoined(server.join(ws2, 11, 101, 'Solo', 'warrior', null));
    expect(resumed).toBe(session);
    expect(resumed.linkdead).toBe(false);
    const p = server.sim.entities.get(session.pid) as AnyEntity;
    expect(server.sim.instanceSlotAt(p.pos)).not.toBeNull();
    expect(claimedHollowCrypt(server, session.pid)).toBe(inst);
  });

  it('rebinds a fully relogged player (fresh pid, same character) to their still-alive claim after the linkdead grace itself expires', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 102, 'Ghosted', 'warrior', null));

    enterDungeon(server.sim.ctx, 'hollow_crypt', session.pid);
    const inst = claimedHollowCrypt(server, session.pid);
    const mobIds = [...inst.mobIds];
    const killedMob = killAMob(server, inst, session.pid);

    expect(dropSocket(server, session, ws)).toBe(true);
    // Nobody reconnects before the grace window itself elapses: force it
    // expired and let the tick-driven sweep tear the session down for real.
    session.graceUntil = Date.now() - 1;
    (server as any).expireLinkdeadSessions();
    await vi.waitFor(() => {
      expect(server.sim.entities.has(session.pid)).toBe(false);
    });

    // The claim is genuinely empty now, but its own empty-instance timer has
    // not elapsed: a relog on the SAME character, before that timer fires,
    // must rebind to the still-alive claim (the durable per-character key
    // from issue #1600) rather than mint a fresh one.
    const ws2 = fakeWs();
    const relogged = expectJoined(server.join(ws2, 11, 102, 'Ghosted', 'warrior', null));
    expect(relogged).not.toBe(session); // a genuinely fresh session and pid
    expect(relogged.pid).not.toBe(session.pid);

    enterDungeon(server.sim.ctx, 'hollow_crypt', relogged.pid);

    expect(claimedHollowCrypt(server, relogged.pid)).toBe(inst); // same claim, not a fresh one
    expect(inst.mobIds).toEqual(mobIds); // no respawn happened
    expect((server.sim.entities.get(killedMob.id) as AnyEntity | undefined)?.dead).toBe(true);
  });

  it('still frees a genuinely abandoned claim once both the linkdead grace and the empty timer elapse', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 103, 'Abandoned', 'warrior', null));

    enterDungeon(server.sim.ctx, 'hollow_crypt', session.pid);
    const inst = claimedHollowCrypt(server, session.pid);
    const exitId = inst.exitId;

    dropSocket(server, session, ws);
    session.graceUntil = Date.now() - 1;
    (server as any).expireLinkdeadSessions();
    await vi.waitFor(() => {
      expect(server.sim.entities.has(session.pid)).toBe(false);
    });

    // Nobody ever comes back: the ordinary empty-instance timeout reclaims
    // the slot, same as any other abandoned claim.
    inst.emptyFor = 100000;
    updateInstances(server.sim.ctx);

    expect(inst.partyKey).toBeNull();
    expect(inst.exitId).toBeNull();
    expect(server.sim.entities.has(exitId)).toBe(false);
  });

  it('deliberately leaving through the exit still starts the ordinary empty-instance countdown', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = expectJoined(server.join(ws, 11, 104, 'Leaver', 'warrior', null));

    enterDungeon(server.sim.ctx, 'hollow_crypt', session.pid);
    const inst = claimedHollowCrypt(server, session.pid);
    expect(inst).toBeTruthy();

    leaveDungeon(server.sim.ctx, session.pid);
    const p = server.sim.entities.get(session.pid) as AnyEntity;
    expect(server.sim.instanceSlotAt(p.pos)).toBeNull(); // stepped outside the claim

    inst.emptyFor = 100000; // simulate the ordinary timer having elapsed
    updateInstances(server.sim.ctx);
    expect(inst.partyKey).toBeNull();
  });

  it('a party instance stays claimed while every member is linkdead, consistent with the solo policy', () => {
    const server = new GameServer();
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const a = expectJoined(server.join(ws1, 21, 201, 'Leader', 'warrior', null));
    const b = expectJoined(server.join(ws2, 22, 202, 'Mate', 'mage', null));
    (server.sim as AnySim).partyInvite(b.pid, a.pid);
    (server.sim as AnySim).partyAccept(b.pid);

    enterDungeon(server.sim.ctx, 'hollow_crypt', a.pid);
    enterDungeon(server.sim.ctx, 'hollow_crypt', b.pid);
    const inst = (server.sim as AnySim).instances.find(
      (i: any) => i.dungeonId === 'hollow_crypt' && i.partyKey?.startsWith('party:'),
    );
    expect(inst).toBeTruthy();

    dropSocket(server, a, ws1);
    dropSocket(server, b, ws2);

    inst.emptyFor = INSTANCE_EMPTY_TIMEOUT - 1;
    updateInstances(server.sim.ctx);
    expect(inst.partyKey).not.toBeNull();
    expect(inst.emptyFor).toBe(0);
  });
});
