// Phase 8 station gate and mobile station over the live GameServer wire.
// The offline suite (tests/professions_crafting_hub.test.ts) pins the
// resolveCraft gate through the real Sim, but nothing there proves the ONLINE
// path stays live: that the craft_item wire command's station denial produces
// a craftResult event with reason 'station_required' routed to only the
// owning session, and that the place_mobile_station wire command actually
// reaches the sim (the #2033 stub-trap class of regression: a dropped wire
// case or a stripped reason would leave every offline test green). Modeled
// on the guild_letter_online session-routing suite.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres; only the
// wire dispatch and the tick -> routeEvents pump are under test, never
// persistence (the corpse_harvest_sim broadcast-suite precedent; the vi.mock
// hoisting caveat from #2088 applies: this block cannot reference imports).
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
import type { PlayerMeta } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// A field spot in northern Eastbrook Vale: far outside every station circle
// (the nearest station sits at z 16.5) and clear of hostile camp pull ranges,
// so nothing but the station gate is in play during the test's few ticks.
const FIELD_POS = { x: 0, z: 150 };

const RECIPE_ID = 'recipe_thorium_mining_pick'; // engineering -> toolworks

function fakeWs(): { sent: { t: string; list?: SimEvent[]; [k: string]: unknown }[]; ws: unknown } {
  const sent: { t: string; list?: SimEvent[] }[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
  const entities = (
    server.sim as unknown as {
      entities: Map<number, { pos: { x: number; z: number }; prevPos?: { x: number; z: number } }>;
    }
  ).entities;
  const entity = entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { x: pos.x, z: pos.z };
}

function metaOf(server: GameServer, pid: number): PlayerMeta {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function craftResultsOf(sent: { t: string; list?: SimEvent[] }[]): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === 'craftResult');
}

describe('station gate over the live GameServer wire (session routing)', () => {
  it('a station-bound craft away from the station routes station_required to only the owning session, consuming nothing', () => {
    const server = new GameServer();
    const fcCraft = fakeWs();
    const fcOther = fakeWs();
    const sc = joinServer(server, fcCraft, 91, 'Fieldsmith');
    joinServer(server, fcOther, 92, 'Bystander');
    placeAt(server, sc.pid, FIELD_POS);
    server.sim.addItem('thorium_ore', 4, sc.pid);
    server.sim.addItem('mithril_mining_pick', 1, sc.pid);

    cmd(server, sc, { cmd: 'craft_item', recipe: RECIPE_ID });
    routeTick(server);

    // Exactly one denial, exact wire payload (the denial path draws no rng,
    // so the payload is fully deterministic), owner session only.
    expect(craftResultsOf(fcCraft.sent)).toEqual([
      {
        type: 'craftResult',
        ok: false,
        recipeId: RECIPE_ID,
        reason: 'station_required',
        pid: sc.pid,
      },
    ]);
    expect(craftResultsOf(fcOther.sent)).toEqual([]);
    // No side effect on denial: reagents untouched, nothing produced.
    expect(server.sim.countItem('thorium_ore', sc.pid)).toBe(4);
    expect(server.sim.countItem('mithril_mining_pick', sc.pid)).toBe(1);
    expect(server.sim.countItem('thorium_mining_pick', sc.pid)).toBe(0);
  });

  it('place_mobile_station reaches the sim: a specialized player then crafts station-bound in the field', () => {
    const server = new GameServer();
    const fcCraft = fakeWs();
    const sc = joinServer(server, fcCraft, 93, 'Tinkerer');
    placeAt(server, sc.pid, FIELD_POS);
    const meta = metaOf(server, sc.pid);
    meta.craftSkills.engineering = 75; // specialized: placement is gated on it
    server.sim.addItem('thorium_ore', 4, sc.pid);
    server.sim.addItem('mithril_mining_pick', 1, sc.pid);

    // The wire command must land in the sim's transient per-player slot: this
    // is the liveness proof for the place_mobile_station dispatch case.
    cmd(server, sc, { cmd: 'place_mobile_station', craft: 'engineering' });
    expect(meta.mobileStation).not.toBeNull();
    expect(meta.mobileStation?.craftId).toBe('engineering');

    // The same craft that just denied in the arm above now succeeds AWAY from
    // every static station, through the server-side gate's mobile-station arm.
    cmd(server, sc, { cmd: 'craft_item', recipe: RECIPE_ID });
    routeTick(server);

    expect(server.sim.countItem('thorium_mining_pick', sc.pid)).toBe(1);
    // 3 of 4 ore consumed: the placer is necessarily specialized (that is the
    // mobile-station gate), so the #1134 material discount composes with the
    // craft (max(1, floor(4 * 0.8)) = 3).
    expect(server.sim.countItem('thorium_ore', sc.pid)).toBe(1);
    const results = craftResultsOf(fcCraft.sent);
    expect(results).toHaveLength(1);
    // toMatchObject, not toEqual: a success draws the masterwork proc roll,
    // whose outcome (masterwork flag plus a sibling masterwork event) is
    // seed-dependent detail owned by the Phase 2 suites, not this liveness pin.
    expect(results[0]).toMatchObject({
      type: 'craftResult',
      ok: true,
      recipeId: RECIPE_ID,
      itemId: 'thorium_mining_pick',
      count: 1,
      pid: sc.pid,
    });
  });
});
