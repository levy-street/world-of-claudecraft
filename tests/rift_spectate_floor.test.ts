// A moderator's online rift floor must follow the VIEW, not whichever riftState
// stream last reached the socket.
//
// ClientWorld mirrors `riftFloor` (and its predicted collision region) from
// riftState events alone, and while a moderator spectates, the server's event
// router (routeEvents) forwards the events keyed to the spectated target's pid.
// So the target's rift entry used to drive the moderator's floor, and nothing
// reset it on /unspectate: back on open ground, the world map, minimap and rift
// collision stayed on the target's rift plan. The reverse also failed: spectating
// a player already inside a rift sent no floor at all (the router forwards only
// transitions), so the view showed the overworld map. Now every spectate frame
// resets the client mirror (src/net/rift_floor_mirror.ts), the server follows an
// opening or retargeting frame with the target's live floor, and the return leg
// re-describes the moderator's own floor (server/moderation_moves.ts).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const moderation = vi.hoisted(() => ({
  recordInGameAction: vi.fn(async () => {}),
  muteAccountChat: vi.fn(async () => {}),
  moderateAccount: vi.fn(async () => {}),
  forceCharacterRename: vi.fn(async () => ({ accountId: 0 })),
}));

// Same superset factory as tests/rift_moderation_exit_state.test.ts.
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
import { HoardBossCueMirror } from '../src/net/hoard_boss_cue_mirror';
import type { ClientWorld } from '../src/net/online';
import { allocRiftCollisionToken } from '../src/sim/colliders';
import { isRiftPos, setActiveWorldContent } from '../src/sim/data';
import { riftRegionAt } from '../src/sim/rift_regions';
import type { SimEvent, Vec3 } from '../src/sim/types';
import { mapWindowMode } from '../src/ui/map_window_view';
import { minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';
import { bareClient } from './helpers/bare_client';
import { enterNaturalRift, RIFT_TEST_WORLD, riftStates } from './rift_online_shared';

setActiveWorldContent(RIFT_TEST_WORLD);
afterAll(() => setActiveWorldContent(null));

const MOD_PERMS = ['moderation.act', 'moderation.spectate'] as const;

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
type Internals = { routeEvents(events: SimEvent[]): void };
type Wire = { onMessage(raw: string): void; reconnectAttempts: number };

function fakeWs(): FakeWs & Parameters<GameServer['join']>[0] {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return ws as unknown as FakeWs & Parameters<GameServer['join']>[0];
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function route(server: GameServer, events: SimEvent[]): void {
  (server as unknown as Internals).routeEvents(events);
}

/** One server tick, routed to the sockets exactly as the world loop does. */
function step(server: GameServer): void {
  route(server, server.sim.tick());
}

function command(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

function pos(server: GameServer, pid: number): Vec3 {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`entity ${pid} missing`);
  return e.pos;
}

interface Table {
  server: GameServer;
  moderator: ClientSession;
  modWs: FakeWs;
  suspect: ClientSession;
}

function table(): Table {
  const server = new GameServer();
  const modWs = fakeWs();
  const moderator = joined(
    server.join(modWs, 9, 109, 'Warden', 'mage', null, false, {
      isAdmin: true,
      adminPermissions: MOD_PERMS,
    }),
  );
  const suspect = joined(server.join(fakeWs(), 2, 102, 'Suspect', 'rogue', null));
  server.sim.setPlayerLevel(20, suspect.pid);
  return { server, moderator, modWs, suspect };
}

/** Walk `pid` into a natural rift and route the entry the way the world loop
 *  would have (enterNaturalRift drains it), so spectators of `pid` receive it. */
function enterRiftRouted(
  server: GameServer,
  pid: number,
): Extract<SimEvent, { type: 'riftState' }> {
  const entry = enterNaturalRift(server.sim, pid);
  route(server, [entry]);
  return entry;
}

async function spectate(server: GameServer, moderator: ClientSession, name: string) {
  command(server, moderator, `/spectate "${name}"`);
  await vi.waitFor(() => expect(moderator.spectating?.name).toBe(name));
  step(server);
}

async function unspectate(server: GameServer, moderator: ClientSession) {
  command(server, moderator, '/unspectate');
  await vi.waitFor(() => expect(moderator.spectating).toBeNull());
  step(server);
}

// The moderator's online client: the sanctioned bare client with a real collision
// token, fed the socket's spectate and events frames in arrival order (snapshots
// carry no rift floor, so they are not part of this replay).
function modClient(pid: number): ClientWorld {
  return bareClient(pid, {
    riftCollisionToken: allocRiftCollisionToken(),
    hoardBossCueMirror: new HoardBossCueMirror(() => 1_000),
  });
}

function replay(client: ClientWorld, ws: FakeWs): void {
  for (const call of ws.send.mock.calls) {
    const raw = String(call[0]);
    const frame = JSON.parse(raw) as { t?: string };
    if (frame.t === 'hello' || frame.t === 'spectate' || frame.t === 'events') {
      (client as unknown as Wire).onMessage(raw);
    }
  }
  ws.send.mockClear();
}

/** What the client paints with its view at `at`: the mirrored floor, both map
 *  surfaces, and whether a rift collision region is registered under its token. */
function view(client: ClientWorld, at: Vec3) {
  const world = { riftFloor: client.riftFloor, delveRun: null, player: { pos: at } } as IWorld;
  const token = (client as unknown as { riftCollisionToken: number }).riftCollisionToken;
  return {
    instanceId: client.riftFloor?.instanceId ?? null,
    map: mapWindowMode(world),
    minimap: minimapMode(world),
    region: riftRegionAt(token, at.x, at.z) !== null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('spectating a rift runner drives the view, and /unspectate resets it', () => {
  it('a target entering a rift mid-spectate leaves no rift plan behind after /unspectate', async () => {
    const { server, moderator, modWs, suspect } = table();
    const client = modClient(moderator.pid);
    const home = { ...pos(server, moderator.pid) };
    expect(isRiftPos(home.x)).toBe(false);

    await spectate(server, moderator, 'Suspect');
    const entry = enterRiftRouted(server, suspect.pid);
    replay(client, modWs);
    // Watching the runner: the view is on their floor (the router forwards it).
    const watching = view(client, pos(server, suspect.pid));
    expect(watching.instanceId).toBe(entry.instanceId);
    expect(watching.region).toBe(true);

    const runnerFloor = { ...pos(server, suspect.pid) };
    await unspectate(server, moderator);
    replay(client, modWs);
    const back = pos(server, moderator.pid);
    expect(back.x).toBeCloseTo(home.x);
    expect(back.z).toBeCloseTo(home.z);
    expect(view(client, back)).toEqual({
      instanceId: null,
      map: 'overworld',
      minimap: 'overworld',
      region: false,
    });
    // The runner's floor region is gone from this client's token too.
    expect(view(client, runnerFloor).region).toBe(false);
  });

  it('spectating a player already inside a rift opens on their floor', async () => {
    const { server, moderator, modWs, suspect } = table();
    const client = modClient(moderator.pid);
    const entry = enterRiftRouted(server, suspect.pid);
    replay(client, modWs);
    expect(client.riftFloor, 'sanity: the router never sent the entry here').toBeNull();

    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    const watching = view(client, pos(server, suspect.pid));
    expect(watching.instanceId).toBe(entry.instanceId);
    expect(watching.map).not.toBe('overworld');
    expect(watching.minimap).not.toBe('overworld');
    expect(watching.region).toBe(true);

    await unspectate(server, moderator);
    replay(client, modWs);
    expect(view(client, pos(server, moderator.pid)).instanceId).toBeNull();
    expect(view(client, pos(server, suspect.pid)).region).toBe(false);
  });

  it('retargeting follows the new target: off the floor, then back onto it', async () => {
    const { server, moderator, modWs, suspect } = table();
    joined(server.join(fakeWs(), 3, 103, 'Bystander', 'priest', null));
    const client = modClient(moderator.pid);
    const entry = enterRiftRouted(server, suspect.pid);

    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(entry.instanceId);

    await spectate(server, moderator, 'Bystander');
    replay(client, modWs);
    expect(client.riftFloor).toBeNull();
    expect(view(client, pos(server, suspect.pid)).region).toBe(false);

    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(entry.instanceId);
  });

  it('an overworld spectate round trip sends no riftState at all', async () => {
    const { server, moderator, modWs } = table();
    await spectate(server, moderator, 'Suspect');
    await unspectate(server, moderator);
    const events = modWs.send.mock.calls
      .map((call) => JSON.parse(String(call[0])) as { t?: string; list?: SimEvent[] })
      .filter((frame) => frame.t === 'events')
      .flatMap((frame) => frame.list ?? []);
    expect(events.filter((e) => e.type === 'riftState')).toEqual([]);
  });
});

/** The moderator and the suspect each on their own run off one portal (separate
 *  parties, so separate instances and floor origins), the moderator's client
 *  mirroring its own floor. */
function twoRuns() {
  const t = table();
  const { server, moderator, modWs, suspect } = t;
  server.sim.setPlayerLevel(20, moderator.pid);
  const client = modClient(moderator.pid);
  const own = enterRiftRouted(server, moderator.pid);
  const portal = server.sim.entities.get(server.sim.naturalRiftPortals[0].id);
  if (portal?.riftSeed === undefined || portal.riftBaseLevel === undefined) {
    throw new Error('sanity: the natural portal carries its rift seed');
  }
  server.sim.drainEvents();
  server.sim.enterRift(portal.riftSeed, portal.riftBaseLevel, suspect.pid, undefined, portal);
  const [theirs] = riftStates(server.sim.drainEvents(), suspect.pid);
  route(server, [theirs]);
  expect(theirs.instanceId, 'sanity: two separate runs').not.toBe(own.instanceId);
  replay(client, modWs);
  expect(client.riftFloor?.instanceId).toBe(own.instanceId);
  return { ...t, client, own, theirs };
}

describe('a moderator on their own rift floor spectating another runner', () => {
  it('watches the runner floor, then /unspectate restores their own', async () => {
    const { server, moderator, modWs, suspect, client, own, theirs } = twoRuns();

    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    expect(view(client, pos(server, suspect.pid))).toMatchObject({
      instanceId: theirs.instanceId,
      region: true,
    });

    await unspectate(server, moderator);
    replay(client, modWs);
    const back = pos(server, moderator.pid);
    expect(isRiftPos(back.x)).toBe(true);
    expect(view(client, back)).toMatchObject({ instanceId: own.instanceId, region: true });
    expect(view(client, pos(server, suspect.pid)).region).toBe(false);
  });

  it('the own floor rides right behind the exit frame, ahead of any tick', async () => {
    const { server, moderator, modWs, client, own } = twoRuns();
    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);

    command(server, moderator, '/unspectate');
    await vi.waitFor(() => expect(moderator.spectating).toBeNull());
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(own.instanceId);
    // Nothing queued behind it drops the floor on the next tick.
    step(server);
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(own.instanceId);
  });

  it('a vanished target ends spectate inside the broadcast pass with the own floor', async () => {
    const { server, moderator, modWs, suspect, client, own, theirs } = twoRuns();
    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(theirs.instanceId);

    suspect.left = true;
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    expect(moderator.spectating).toBeNull();
    replay(client, modWs);
    expect(view(client, pos(server, moderator.pid))).toMatchObject({
      instanceId: own.instanceId,
      region: true,
    });
  });

  it('/unspectate then /spectate before a tick lands on the runner floor', async () => {
    const { server, moderator, modWs, client, theirs } = twoRuns();
    await spectate(server, moderator, 'Suspect');
    command(server, moderator, '/unspectate');
    await vi.waitFor(() => expect(moderator.spectating).toBeNull());
    command(server, moderator, '/spectate "Suspect"');
    await vi.waitFor(() => expect(moderator.spectating?.name).toBe('Suspect'));
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(theirs.instanceId);
    step(server);
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(theirs.instanceId);
  });

  it('a drop mid-spectate and a resume land the client back on the own floor', async () => {
    const { server, moderator, modWs, client, own, theirs } = twoRuns();
    await spectate(server, moderator, 'Suspect');
    replay(client, modWs);
    expect(client.riftFloor?.instanceId).toBe(theirs.instanceId);

    // Grace start exits spectate into the dead socket; the resume rides a new one.
    server.socketClosed(moderator, modWs as unknown as Parameters<GameServer['socketClosed']>[1]);
    modWs.send.mockClear();
    const ws2 = fakeWs();
    const resumed = joined(
      server.join(ws2, 9, 109, 'Warden', 'mage', null, false, {
        isAdmin: true,
        adminPermissions: MOD_PERMS,
      }),
    );
    expect(resumed).toBe(moderator);
    (client as unknown as Wire).reconnectAttempts = 1;
    replay(client, ws2);
    expect(client.spectating).toBeNull();
    expect(view(client, pos(server, moderator.pid))).toMatchObject({
      instanceId: own.instanceId,
      region: true,
    });
  });
});

describe('the client mirror on a spectate frame', () => {
  it('drops the floor deadline and hoard cues along with the floor', () => {
    const client = modClient(9);
    const wire = client as unknown as Wire;
    const expiresAt = () =>
      (client as unknown as { riftEventExpiresAtMs: number | null }).riftEventExpiresAtMs;
    const { server, suspect } = table();
    const entry = enterNaturalRift(server.sim, suspect.pid);
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
    const cue = {
      type: 'hoardBossCue',
      pid: suspect.pid,
      instanceId: entry.instanceId,
      cueId: 1,
      kind: 'mark',
      phase: 'warning',
      x: 0,
      z: 0,
      radius: 3,
      durationSecs: 5,
    };
    wire.onMessage(JSON.stringify({ t: 'events', list: [{ ...entry, expiresAtMs: 9e12 }, cue] }));
    expect(client.hoardBossCues()).toHaveLength(1);
    expect(expiresAt()).toBe(9e12);

    wire.onMessage(JSON.stringify({ t: 'spectate', name: null }));
    expect(client.riftFloor).toBeNull();
    expect(client.hoardBossCues()).toEqual([]);
    expect(expiresAt()).toBeNull();
  });
});

describe('a reconnect hello', () => {
  it('drops the watched floor (the server exits spectate at grace start)', () => {
    const client = modClient(9);
    const wire = client as unknown as Wire;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 9, seed: 20061 }));
    const { server, suspect } = table();
    const entry = enterNaturalRift(server.sim, suspect.pid);
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
    wire.onMessage(JSON.stringify({ t: 'events', list: [entry] }));
    expect(client.riftFloor?.instanceId).toBe(entry.instanceId);

    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 9, seed: 20061 }));
    expect(client.spectating).toBeNull();
    expect(client.riftFloor).toBeNull();
    expect(view(client, pos(server, suspect.pid)).region).toBe(false);
  });

  it('a plain reconnect drops the floor until the resume resend restores a live one', () => {
    const client = modClient(1);
    const wire = client as unknown as Wire;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    const { server, suspect } = table();
    const entry = { ...enterNaturalRift(server.sim, suspect.pid), pid: 1 };
    wire.onMessage(JSON.stringify({ t: 'events', list: [entry] }));

    // The run may have ended while the socket was down (its exit went to the
    // dead socket), so the hello alone never keeps a floor.
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    expect(client.riftFloor).toBeNull();
    expect(view(client, pos(server, suspect.pid)).region).toBe(false);
    // resumeSession's describe follows the hello when the floor is still live.
    wire.onMessage(JSON.stringify({ t: 'events', list: [entry] }));
    expect(client.riftFloor?.instanceId).toBe(entry.instanceId);
  });
});
