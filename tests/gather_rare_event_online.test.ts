import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the live GameServer event
// routing is under test (the 2033 stub trap: an event type must be proven to
// flow server to client, not just emitted into the sim's buffer).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const NODE_ID = 'ore_eastbrook_1';

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

/** Every SimEvent delivered to this client across all `events` frames. */
function deliveredEvents(fc: FakeClient): SimEvent[] {
  return fc.sent.filter((m) => m.t === 'events').flatMap((m) => m.list as SimEvent[]);
}

function clearSent(...fcs: FakeClient[]): void {
  for (const fc of fcs) fc.sent.length = 0;
}

function moveTo(internals: SimInternals, pid: number, x: number, z: number): void {
  const e = internals.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
}

// Alpha harvests at the eastbrook ore node; Bravo idles FAR away (x 300, well
// outside the ~120 yd interest radius) but inside eastbrook_vale, so receiving
// the broadcast proves zone fanout rather than interest proximity; Charlie
// stands in mirefen_marsh (z 340) and must never receive it.
function liveSetup() {
  const server = new GameServer();
  const fcA = fakeWs();
  const fcB = fakeWs();
  const fcC = fakeWs();
  const sa = joinServer(server, fcA, 91, 'Alpha');
  const sb = joinServer(server, fcB, 92, 'Bravo');
  const sc = joinServer(server, fcC, 93, 'Charlie');
  const internals = server.sim as unknown as SimInternals;
  const node = GATHER_NODES.find((n) => n.id === NODE_ID);
  if (!node) throw new Error(`missing node ${NODE_ID}`);
  moveTo(internals, sa.pid, node.pos.x, node.pos.z);
  moveTo(internals, sb.pid, 300, 0);
  moveTo(internals, sc.pid, 0, 340);
  // One tick settles the join and re-indexes the spatial grid (the
  // corpse_harvest_sim idiom), then drop the join-time traffic.
  server.sim.tick();
  clearSent(fcA, fcB, fcC);
  return { server, internals, fcA, fcB, fcC, sa, sb, sc };
}

function route(server: GameServer, events: SimEvent[]): void {
  (server as any).routeEvents(events);
}

describe('gather events over the live server (Professions 2.0 Phase 4)', () => {
  it('a real harvest delivers gatherResult (with qty and rareEvent) to the harvesting client only', () => {
    const { server, fcA, fcB, fcC, sa } = liveSetup();

    expect(server.sim.harvestNode(NODE_ID, sa.pid)).toBe(true);
    route(server, server.sim.drainEvents());

    const mine = deliveredEvents(fcA).filter((e) => e.type === 'gatherResult');
    expect(mine).toHaveLength(1);
    const g = mine[0];
    if (g.type !== 'gatherResult') throw new Error('expected gatherResult');
    expect(g.pid).toBe(sa.pid);
    expect(g.nodeId).toBe(NODE_ID);
    expect(g.itemId).toBe('copper_ore');
    // The Phase 4 payload fields ride the wire: qty reflects the granted
    // units (1 at proficiency 0, x5 only on a rare event) and rareEvent is
    // explicitly present, null on a miss.
    expect(g).toHaveProperty('rareEvent');
    expect(g.qty).toBe(g.rareEvent ? 5 : 1);

    // Personal event: nobody else receives a gatherResult.
    expect(deliveredEvents(fcB).filter((e) => e.type === 'gatherResult')).toHaveLength(0);
    expect(deliveredEvents(fcC).filter((e) => e.type === 'gatherResult')).toHaveLength(0);
  });

  it('a rare event reaches an in-zone other player and never an out-of-zone player', () => {
    const { server, internals, fcA, fcB, fcC, sa } = liveSetup();
    const meta = internals.players.get(sa.pid);
    if (!meta) throw new Error('missing harvester meta');

    // Hunt the deterministic shared rng stream until draw #2 hits: reset the
    // session-only cooldown and bag state between attempts so every iteration
    // is a clean granted harvest. No ticks inside the loop, so no combat or
    // respawn noise interleaves with the hunted stream.
    let hitEvents: SimEvent[] | null = null;
    for (let i = 0; i < 3000 && !hitEvents; i++) {
      meta.inventory.length = 0;
      delete meta.nodeHarvestReadyAt[NODE_ID];
      expect(server.sim.harvestNode(NODE_ID, sa.pid)).toBe(true);
      const events = server.sim.drainEvents();
      if (events.some((e) => e.type === 'gatherRareEvent')) hitEvents = events;
    }
    if (!hitEvents) throw new Error('no rare event within 3000 harvests');
    clearSent(fcA, fcB, fcC);
    route(server, hitEvents);

    // The finder gets their own copy.
    const toFinder = deliveredEvents(fcA).filter((e) => e.type === 'gatherRareEvent');
    expect(toFinder).toHaveLength(1);
    if (toFinder[0].type !== 'gatherRareEvent') throw new Error('expected gatherRareEvent');
    expect(toFinder[0].pid).toBe(sa.pid);
    expect(toFinder[0].flavor).toBe('pristine_vein');
    expect(toFinder[0].finderName).toBe('Alpha');
    expect(toFinder[0].finderPid).toBe(sa.pid);

    // The in-zone (but out-of-interest-range) player receives the zone
    // broadcast, addressed to their own pid.
    const toBravo = deliveredEvents(fcB).filter((e) => e.type === 'gatherRareEvent');
    expect(toBravo).toHaveLength(1);
    if (toBravo[0].type !== 'gatherRareEvent') throw new Error('expected gatherRareEvent');
    expect(toBravo[0].pid).not.toBe(sa.pid);
    expect(toBravo[0].flavor).toBe('pristine_vein');
    expect(toBravo[0].finderName).toBe('Alpha');
    expect(toBravo[0].itemId).toBe('copper_ore');
    // The hit's PERSONAL gatherResult stays with the finder even on a rare event.
    expect(deliveredEvents(fcB).filter((e) => e.type === 'gatherResult')).toHaveLength(0);

    // The out-of-zone player receives nothing.
    expect(deliveredEvents(fcC).filter((e) => e.type === 'gatherRareEvent')).toHaveLength(0);
  });
});
