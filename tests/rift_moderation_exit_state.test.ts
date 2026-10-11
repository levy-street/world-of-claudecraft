// A moderation teleport off a rift floor must take the online client OUT of the
// rift, and a return leg onto a live floor must put it back IN.
//
// ClientWorld mirrors `riftFloor` from riftState events alone (no snapshot field),
// and the world map and minimap both lead with `world.riftFloor`. The server's
// moderation moves (/jail, the timed release and /unjail, the moderator jail
// visit) moved the entity directly, without the exit leaveRift
// sends, so a prisoner jailed from a rift kept the rift plan in the cage, and a
// moderator who came back to a live floor never re-received it (no rift map, no
// predicted rift collision). The moves now run through server/moderation_moves.ts:
// the out leg detaches from the floor (rift/runs.ts detachFromRift) and the return
// leg re-describes a live member floor (riftStateEventFor, the resumeSession
// pattern). A jail sentence returns to the rift's exit spot (a sentence outlasts
// the run's empty timeout); a moderator whose floor was freed meanwhile lands
// there too instead of in the empty rift band.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const moderation = vi.hoisted(() => ({
  recordInGameAction: vi.fn(async () => {}),
  muteAccountChat: vi.fn(async () => {}),
  moderateAccount: vi.fn(async () => {}),
  forceCharacterRename: vi.fn(async () => ({ accountId: 0 })),
}));

// Same superset factory as tests/moderation_game.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/moderation_db', () => moderation);

import { type ClientSession, GameServer } from '../server/game';
import { isRiftPos, setActiveWorldContent } from '../src/sim/data';
import { isInJailCage } from '../src/sim/jail';
import type { SimEvent } from '../src/sim/types';
import {
  enterNaturalRift,
  onlineMapModes,
  RIFT_TEST_WORLD,
  type RiftStateEvent,
  riftStates,
} from './rift_online_shared';

// Moderation and the rift floor are the only systems in play: strip ambient
// camps, npcs and objects through the active-world seam, as moderation_game does.
setActiveWorldContent(RIFT_TEST_WORLD);
afterAll(() => setActiveWorldContent(null));

const MOD_PERMS = ['moderation.act', 'moderation.spectate'] as const;

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
type Internals = { routeEvents(events: SimEvent[]): void; enforceJailStates(): void };

function fakeWs(): FakeWs & Parameters<GameServer['join']>[0] {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return ws as unknown as FakeWs & Parameters<GameServer['join']>[0];
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function internals(server: GameServer): Internals {
  return server as unknown as Internals;
}

function command(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

/** One server tick, routed to the sockets exactly as the world loop does. */
function step(server: GameServer): void {
  internals(server).routeEvents(server.sim.tick());
}

/** Every riftState for `pid` the socket has received, in arrival order. */
function wireRiftStates(ws: FakeWs, pid: number): RiftStateEvent[] {
  const events = ws.send.mock.calls
    .map((call) => JSON.parse(String(call[0])) as { t?: string; list?: SimEvent[] })
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? []);
  return riftStates(events, pid);
}

/** A server with `name` joined and standing on floor 0 of a natural rift. The
 *  entry event is drained by the fixture, so it is returned to head the stream. */
function riftServer(
  name: string,
  admin: boolean,
): { server: GameServer; session: ClientSession; ws: FakeWs; entry: RiftStateEvent } {
  const server = new GameServer();
  const ws = fakeWs();
  const session = joined(
    server.join(
      ws,
      1,
      101,
      name,
      'warrior',
      null,
      false,
      admin ? { isAdmin: true, adminPermissions: MOD_PERMS } : undefined,
    ),
  );
  server.sim.setPlayerLevel(20, session.pid);
  const entry = enterNaturalRift(server.sim, session.pid);
  step(server);
  ws.send.mockClear();
  return { server, session, ws, entry };
}

function pos(server: GameServer, pid: number) {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`entity ${pid} missing`);
  return e.pos;
}

function addModerator(server: GameServer): ClientSession {
  return joined(
    server.join(fakeWs(), 9, 109, 'Warden', 'mage', null, false, {
      isAdmin: true,
      adminPermissions: MOD_PERMS,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a jail sentence off a rift floor clears the online rift floor', () => {
  it('/jail sends the rift exit, and /unjail lands at the rift exit spot', async () => {
    const { server, session, ws, entry } = riftServer('Runner', false);
    const moderator = addModerator(server);
    const inst = server.sim.ctx.riftInstances.find((i) => i.instanceId === entry.instanceId)!;

    command(server, moderator, '/jail "Runner" 120');
    await vi.waitFor(() => expect(session.jailed).not.toBeNull());
    step(server);
    expect(isInJailCage(pos(server, session.pid))).toBe(true);
    const out = wireRiftStates(ws, session.pid);
    expect(out.map((e) => [e.active, e.instanceId])).toEqual([[false, entry.instanceId]]);
    const caged = onlineMapModes([entry, ...out], pos(server, session.pid));
    expect(caged.riftFloor).toBeNull();
    expect(caged.map).toBe('overworld');
    expect(caged.minimap).toBe('overworld');
    // The sentence returns to the run's exit, never onto a floor that can be
    // freed (RIFT_EMPTY_TIMEOUT) long before the sentence ends.
    expect(session.jailed?.returnPos).toEqual({ x: inst.returnPos.x, z: inst.returnPos.z });

    command(server, moderator, '/unjail "Runner"');
    await vi.waitFor(() => expect(session.jailed).toBeNull());
    step(server);
    const released = pos(server, session.pid);
    expect(isRiftPos(released.x)).toBe(false);
    expect(released.x).toBeCloseTo(inst.returnPos.x);
    expect(released.z).toBeCloseTo(inst.returnPos.z);
    const all = wireRiftStates(ws, session.pid);
    expect(all.map((e) => e.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...all], released).riftFloor).toBeNull();
  });

  it('a dead rift member jailed (the revive branch) still gets the exit', async () => {
    const { server, session, ws, entry } = riftServer('Fallen', false);
    const moderator = addModerator(server);
    const e = server.sim.entities.get(session.pid)!;
    e.hp = 0;
    e.dead = true;

    command(server, moderator, '/jail "Fallen" 30');
    await vi.waitFor(() => expect(session.jailed).not.toBeNull());
    step(server);
    expect(e.dead).toBe(false);
    expect(isInJailCage(e.pos)).toBe(true);
    const out = wireRiftStates(ws, session.pid);
    expect(out.map((ev) => ev.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...out], e.pos).riftFloor).toBeNull();
  });

  it('an overworld jail and release emit no riftState at all', async () => {
    const server = new GameServer();
    const ws = fakeWs();
    const session = joined(server.join(ws, 1, 101, 'Homebody', 'warrior', null));
    const moderator = addModerator(server);
    expect(isRiftPos(pos(server, session.pid).x)).toBe(false);

    command(server, moderator, '/jail "Homebody" 30');
    await vi.waitFor(() => expect(session.jailed).not.toBeNull());
    step(server);
    command(server, moderator, '/unjail "Homebody"');
    await vi.waitFor(() => expect(session.jailed).toBeNull());
    step(server);
    expect(wireRiftStates(ws, session.pid)).toEqual([]);
  });
});

describe('a moderator leaving a rift floor and coming back', () => {
  it('a jail visit sends the exit, and the return re-describes the live floor', () => {
    const { server, session, ws, entry } = riftServer('Keeper', true);
    const floor = { ...pos(server, session.pid) };

    command(server, session, '/jail');
    expect(session.jailVisit).not.toBeNull();
    step(server);
    const away = wireRiftStates(ws, session.pid);
    expect(away.map((e) => e.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...away], pos(server, session.pid)).riftFloor).toBeNull();

    command(server, session, '/unjail');
    expect(session.jailVisit).toBeNull();
    step(server);
    expect(pos(server, session.pid).x).toBeCloseTo(floor.x);
    expect(pos(server, session.pid).z).toBeCloseTo(floor.z);
    const all = wireRiftStates(ws, session.pid);
    expect(all.map((e) => [e.active, e.instanceId])).toEqual([
      [false, entry.instanceId],
      [true, entry.instanceId],
    ]);
    const back = onlineMapModes([entry, ...all], pos(server, session.pid));
    expect(back.riftFloor).not.toBeNull();
    expect(back.map).not.toBe('overworld');
  });

  it('camera-only spectate keeps the body on its floor, and /unspectate resends it', async () => {
    const { server, session, ws, entry } = riftServer('Watcher', true);
    const target = joined(server.join(fakeWs(), 2, 102, 'Suspect', 'rogue', null));
    const floor = { ...pos(server, session.pid) };

    command(server, session, '/spectate "Suspect"');
    await vi.waitFor(() => expect(session.spectating).not.toBeNull());
    step(server);
    const away = wireRiftStates(ws, session.pid);
    expect(away).toEqual([]);
    expect(pos(server, session.pid).x).toBeCloseTo(floor.x);
    expect(pos(server, session.pid).z).toBeCloseTo(floor.z);
    expect(onlineMapModes([], pos(server, target.pid)).riftFloor).toBeNull();

    command(server, session, '/unspectate');
    await vi.waitFor(() => expect(session.spectating).toBeNull());
    step(server);
    const all = wireRiftStates(ws, session.pid);
    expect(all.map((e) => [e.active, e.instanceId])).toEqual([[true, entry.instanceId]]);
    expect(onlineMapModes(all, pos(server, session.pid)).riftFloor).not.toBeNull();
  });

  it('a floor freed during the visit returns the moderator to the rift exit spot', () => {
    const { server, session, ws, entry } = riftServer('Lingerer', true);
    const inst = server.sim.ctx.riftInstances.find((i) => i.instanceId === entry.instanceId)!;
    const exit = { ...inst.returnPos };

    command(server, session, '/jail');
    // Age the now-empty run past its empty timeout (the 1 Hz sweep frees it).
    inst.emptyFor = 10_000;
    for (let i = 0; i < 20; i++) step(server);
    expect(inst.partyKey).toBeNull();

    command(server, session, '/unjail');
    step(server);
    const landed = pos(server, session.pid);
    expect(isRiftPos(landed.x)).toBe(false);
    expect(landed.x).toBeCloseTo(exit.x);
    expect(landed.z).toBeCloseTo(exit.z);
    const all = wireRiftStates(ws, session.pid);
    expect(all.map((e) => e.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...all], landed).riftFloor).toBeNull();
  });
});
