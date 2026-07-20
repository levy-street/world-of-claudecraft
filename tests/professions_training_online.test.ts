// Phase 9 recipe training over the live GameServer wire: the train_recipe
// dispatch case must reach Sim.trainRecipe, and the outcome must come back as
// the pid-scoped trainResult event routed to ONLY the owning session (deny
// and success arms both; the #2033 stub-trap class of regression: a dropped
// wire case or stripped reason leaves every offline test green). Modeled on
// tests/professions_station_online.test.ts. The snapshot-side mirror (cprof
// knownRecipes, self copper) is pinned in tests/snapshots.test.ts.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the
// vi.mock hoisting caveat from #2088 applies: this block cannot reference
// imports).
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

// alchemy -> the Highwatch apothecary (station_highwatch_apothecary).
const RECIPE_ID = 'recipe_volatile_flux_elixir';
const APOTHECARY_POS = { x: 7, z: 660 };

// A field spot far outside every station circle and clear of camp pulls.
const FIELD_POS = { x: 0, z: 150 };

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

function trainResultsOf(sent: { t: string; list?: SimEvent[] }[]): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === 'trainResult');
}

describe('train_recipe over the live GameServer wire (session routing)', () => {
  it('a deny routes the exact pid-scoped trainResult to only the owning session, charging nothing', () => {
    const server = new GameServer();
    const fcTrainee = fakeWs();
    const fcOther = fakeWs();
    const st = joinServer(server, fcTrainee, 95, 'Fieldpupil');
    joinServer(server, fcOther, 96, 'Bystander');
    placeAt(server, st.pid, FIELD_POS);
    const meta = metaOf(server, st.pid);
    meta.craftSkills.alchemy = 25;
    meta.copper = 10000;

    cmd(server, st, { cmd: 'train_recipe', recipe: RECIPE_ID });
    routeTick(server);

    // Exactly one denial, exact wire payload (denial draws no rng), owner
    // session only; the JSON round trip drops the undefined-free fields.
    expect(trainResultsOf(fcTrainee.sent)).toEqual([
      {
        type: 'trainResult',
        ok: false,
        recipeId: RECIPE_ID,
        reason: 'train_out_of_range',
        pid: st.pid,
      },
    ]);
    expect(trainResultsOf(fcOther.sent)).toEqual([]);
    expect(meta.copper).toBe(10000);
    expect(meta.knownRecipes.has(RECIPE_ID)).toBe(false);
  });

  it('a success at the apothecary charges the fee once, grants, and routes the ok event', () => {
    const server = new GameServer();
    const fcTrainee = fakeWs();
    const st = joinServer(server, fcTrainee, 97, 'Alchpupil');
    placeAt(server, st.pid, APOTHECARY_POS);
    const meta = metaOf(server, st.pid);
    // A server-created fresh character sits past the grandfather cut too (the
    // shared no-state addPlayer path): the explicit both-hosts pin.
    expect(meta.recipesGrandfathered).toBe(true);
    expect(meta.knownRecipes.size).toBe(0);
    meta.craftSkills.alchemy = 25;
    meta.copper = 10000;

    cmd(server, st, { cmd: 'train_recipe', recipe: RECIPE_ID });
    routeTick(server);

    expect(meta.copper).toBe(7500);
    expect(meta.knownRecipes.has(RECIPE_ID)).toBe(true);
    expect(trainResultsOf(fcTrainee.sent)).toEqual([
      { type: 'trainResult', ok: true, recipeId: RECIPE_ID, pid: st.pid },
    ]);

    // The duplicate command (the replay-safety arm over the wire): denied
    // already_known, never re-charged, never re-granted.
    cmd(server, st, { cmd: 'train_recipe', recipe: RECIPE_ID });
    routeTick(server);
    expect(meta.copper).toBe(7500);
    const results = trainResultsOf(fcTrainee.sent);
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({
      type: 'trainResult',
      ok: false,
      recipeId: RECIPE_ID,
      reason: 'train_already_known',
      pid: st.pid,
    });
  });

  it('a malformed recipe value is ignored by the dispatch guard (no crash, no event)', () => {
    const server = new GameServer();
    const fcTrainee = fakeWs();
    const st = joinServer(server, fcTrainee, 98, 'Fuzzer');
    cmd(server, st, { cmd: 'train_recipe', recipe: 42 });
    routeTick(server);
    expect(trainResultsOf(fcTrainee.sent)).toEqual([]);
  });
});
