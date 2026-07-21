// Masterwork zone broadcast (Professions 2.0 Phase 6): a masterwork proc in
// the overworld emits one pid-scoped `masterworkZone` copy per player in the
// crafter's zone, the crafter included, next to (never instead of) the
// personal `masterwork` event. Instanced players never receive the copy, and
// an instanced CRAFTER emits no zone copies at all (personal toast only,
// deliberately). The broadcast draws NO rng: the craft path's single-draw
// contract (tests/professions_masterwork.test.ts) stays intact, re-asserted
// here with the same observer idiom. Client side, the zone copy must reach
// the HUD eventQueue and must NOT touch lastMasterwork (that mirror rebuilds
// from ANY 'masterwork' event, which is exactly why this is a separate type).
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer routing suite below needs no
// Postgres; only the sim fanout and the tick -> routeEvents wire pump are
// under test, never persistence (the corpse_harvest_sim broadcast-suite
// precedent).
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
import { ClientWorld } from '../src/net/online';
import { DUNGEON_X_THRESHOLD, zoneAt } from '../src/sim/data';
import { announceMasterworkZone } from '../src/sim/professions/gather_events';
import type { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const RECIPE_ID = 'recipe_eastbrook_ritual_vestments';
const ITEM_ID = 'eastbrook_ritual_vestments';

// Hunted proc seed, pinned (the professions_masterwork suite idiom: only the
// pinned literal is committed). With tailoring as the active archetype and
// skill 200 the single output-side draw procs at 0.14; at this seed, with this
// exact setup order (three extra players added, then the archetype accept, the
// skill poke, 3x linen_scrap, 1x spider_leg, then the craft), the first craft
// procs. Position pokes after setup draw nothing, so both placements below
// share the identical stream. Spare hunted seeds on record: 4, 18, 26, 29.
const PROC_SEED = 2;

// One procced craft with an audience: a bystander in the crafter's zone, a
// player parked in instance space, and a player moved to a different overworld
// zone. Position pokes happen after all rng-relevant setup and draw nothing.
function runScenario(opts?: { crafterInInstanceSpace?: boolean }) {
  const sim = new Sim({ seed: PROC_SEED, playerClass: 'warrior', autoEquip: false });
  const crafter = sim.playerId;
  const nearby = sim.addPlayer('mage', 'Bystander');
  const delver = sim.addPlayer('rogue', 'Delver');
  const farhand = sim.addPlayer('priest', 'Farhand');
  sim.acceptArchetypeQuest('tailoring');
  const meta = (sim as any).players.get(crafter);
  meta.craftSkills.tailoring = 200;
  for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, crafter);
  sim.addItem('spider_leg', 1, crafter);

  const crafterE = sim.entities.get(crafter)!;
  const zoneId = zoneAt(crafterE.pos.z).id;
  // Instance space: far-off x band, z untouched (the exclusion is x-driven).
  sim.entities.get(delver)!.pos.x = DUNGEON_X_THRESHOLD + 100;
  // A different overworld zone: scan the z strips outward from the spawn until
  // the zone id changes (layout-agnostic, so a zone reshuffle cannot silently
  // turn this player into an in-zone recipient).
  const farE = sim.entities.get(farhand)!;
  let z = farE.pos.z;
  for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z += 50;
  if (zoneAt(z).id === zoneId) {
    z = farE.pos.z;
    for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z -= 50;
  }
  expect(zoneAt(z).id).not.toBe(zoneId);
  farE.pos.z = z;
  if (opts?.crafterInInstanceSpace) crafterE.pos.x = DUNGEON_X_THRESHOLD + 100;

  sim.drainEvents();
  const rng: Rng = (sim as any).ctx.rng;
  let draws = 0;
  rng.setObserver(() => {
    draws++;
  });
  sim.craftItem(RECIPE_ID, crafter);
  rng.setObserver(null);
  const events = sim.drainEvents();
  return {
    sim,
    crafter,
    crafterName: meta.name as string,
    nearby,
    delver,
    farhand,
    zoneId,
    draws,
    events,
    personal: events.filter((ev) => ev.type === 'masterwork'),
    zone: events.filter((ev) => ev.type === 'masterworkZone'),
  };
}

describe('emit side (Sim.craftItem)', () => {
  it('fans one masterworkZone copy per in-zone player, crafter included, ids exact (hunted seed)', () => {
    const r = runScenario();
    // The hunted proc landed and the personal event is untouched by the fanout.
    expect(r.personal).toEqual([
      {
        type: 'masterwork',
        recipeId: RECIPE_ID,
        itemId: ITEM_ID,
        crafter: r.crafter,
        pid: r.crafter,
      },
    ]);
    // Exactly two copies: the crafter and the in-zone bystander, in roster
    // order; the instanced player and the other-zone player get nothing.
    expect(r.zone).toEqual([
      {
        type: 'masterworkZone',
        pid: r.crafter,
        crafterPid: r.crafter,
        crafterName: r.crafterName,
        itemId: ITEM_ID,
        recipeId: RECIPE_ID,
        zoneId: r.zoneId,
      },
      {
        type: 'masterworkZone',
        pid: r.nearby,
        crafterPid: r.crafter,
        crafterName: r.crafterName,
        itemId: ITEM_ID,
        recipeId: RECIPE_ID,
        zoneId: r.zoneId,
      },
    ]);
    // Single-draw contract intact: the whole craft, fanout included, drew once.
    expect(r.draws).toBe(1);
  });

  it('an instanced crafter procs the personal event only: no zone copies at all', () => {
    const r = runScenario({ crafterInInstanceSpace: true });
    // Same seed, same stream position: the proc still lands.
    expect(r.personal).toHaveLength(1);
    expect(r.zone).toEqual([]);
    expect(r.draws).toBe(1);
  });
});

// A ClientWorld with no constructor run (the bareClient idiom from
// tests/masterwork_event_mirror.test.ts): lastMasterwork only exists once the
// real event-apply path assigns it, so an accidental assignment from the zone
// copy cannot hide behind an initializer default.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { eventQueue: SimEvent[] }).eventQueue = [];
  return c;
}

function feed(client: ClientWorld, ev: unknown): void {
  (client as unknown as { onMessage(raw: string): void }).onMessage(
    JSON.stringify({ t: 'events', list: [ev] }),
  );
}

describe('online ClientWorld host', () => {
  it('the zone copy reaches the HUD eventQueue and never touches lastMasterwork', () => {
    const client = bareClient();
    feed(client, {
      type: 'masterworkZone',
      pid: 9,
      crafterPid: 7,
      crafterName: 'Bystander',
      itemId: ITEM_ID,
      recipeId: RECIPE_ID,
      zoneId: 'eastbrook_vale',
    });
    // A bystander's zone copy must NOT rebuild their own-proc mirror.
    expect((client as unknown as { lastMasterwork?: unknown }).lastMasterwork).toBeUndefined();
    // It still flowed to the HUD drain, payload untouched.
    const queued = (client as unknown as { eventQueue: SimEvent[] }).eventQueue;
    expect(queued).toEqual([
      {
        type: 'masterworkZone',
        pid: 9,
        crafterPid: 7,
        crafterName: 'Bystander',
        itemId: ITEM_ID,
        recipeId: RECIPE_ID,
        zoneId: 'eastbrook_vale',
      },
    ]);
    // A personal masterwork event afterwards assigns the mirror as before.
    feed(client, { type: 'masterwork', recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: 9, pid: 9 });
    expect(client.lastMasterwork).toEqual({ recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: 9 });
  });
});

// Live GameServer wire routing (Phase 6 QA): the emit suite above pins the
// craft -> announceMasterworkZone integration (hunted seed) and the parity
// golden pins the crafter's own copy, but nothing pinned that each pid-scoped
// zone copy actually reaches ITS session, and only that session, over the
// REAL server pump (sim.tick() returning the buffered events, then
// routeEvents fanning per session). This is the two-session online probe the
// QA file asks for, at the GameServer level (the corpse_harvest_sim
// hcb broadcast-suite precedent): the nearby session receives the copy, the
// other-zone session receives nothing, and the wire payload is exactly the
// text-free id/value set (no English rides the wire).
function fakeWs(): { sent: { t: string; list?: SimEvent[] }[]; ws: unknown } {
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

describe('masterworkZone over the live GameServer wire (session routing)', () => {
  it('routes each pid-scoped copy to its own session only: nearby yes, other zone no', () => {
    const server = new GameServer();
    const fcCrafter = fakeWs();
    const fcNearby = fakeWs();
    const fcFar = fakeWs();
    const sc = joinServer(server, fcCrafter, 91, 'Crafter');
    const sn = joinServer(server, fcNearby, 92, 'Nearby');
    const sf = joinServer(server, fcFar, 93, 'Farhand');
    const entities = (server.sim as unknown as { entities: Map<number, Entity> }).entities;
    const crafterE = entities.get(sc.pid)!;
    const zoneId = zoneAt(crafterE.pos.z).id;
    // Park the far player in a different overworld zone (the z-scan idiom from
    // the emit suite above: layout-agnostic, so a zone reshuffle cannot
    // silently turn them into an in-zone recipient).
    const farE = entities.get(sf.pid)!;
    let z = farE.pos.z;
    for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z += 50;
    if (zoneAt(z).id === zoneId) {
      z = farE.pos.z;
      for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z -= 50;
    }
    expect(zoneAt(z).id).not.toBe(zoneId);
    farE.pos.z = z;
    farE.prevPos = { ...farE.prevPos, z };

    // Fan out on the LIVE server sim (the craft trigger itself is pinned by the
    // emit suite; this suite owns the wire routing), then run the real pump.
    announceMasterworkZone(
      (server.sim as unknown as { ctx: Parameters<typeof announceMasterworkZone>[0] }).ctx,
      sc.pid,
      'Crafter',
      { recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: sc.pid },
    );
    const events = server.sim.tick();
    (server as unknown as { routeEvents(events: SimEvent[]): void }).routeEvents(events);

    const zoneEvsOf = (sent: { t: string; list?: SimEvent[] }[]) =>
      sent
        .filter((m) => m.t === 'events')
        .flatMap((m) => m.list ?? [])
        .filter((ev) => ev.type === 'masterworkZone');
    const copyFor = (pid: number) => ({
      type: 'masterworkZone',
      pid,
      crafterPid: sc.pid,
      crafterName: 'Crafter',
      itemId: ITEM_ID,
      recipeId: RECIPE_ID,
      zoneId,
    });
    // Each in-zone session got exactly ITS copy (recipient pid, not the
    // crafter's), the other-zone session got nothing, and the payload is the
    // exact text-free key set.
    expect(zoneEvsOf(fcCrafter.sent)).toEqual([copyFor(sc.pid)]);
    expect(zoneEvsOf(fcNearby.sent)).toEqual([copyFor(sn.pid)]);
    expect(zoneEvsOf(fcFar.sent)).toEqual([]);
  });
});

// The HUD arm contract for the zone copy (no test instantiates the full Hud,
// so the render rules are source-pinned): every recipient logs the localized
// line in the epic quality color, and NOBODY gets an audio cue from this arm
// (the crafter's own celebration sound rides the personal masterwork plan).
import { readFileSync } from 'node:fs';

describe('hud masterworkZone arm (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const arm = hud.slice(
    hud.indexOf("case 'masterworkZone': {"),
    hud.indexOf('break;', hud.indexOf("case 'masterworkZone': {")),
  );

  it('logs the localized zone line in the epic color', () => {
    expect(arm).toContain("t('hudChrome.crafting.masterworkZoneLine'");
    expect(arm).toContain('QUALITY_COLOR.epic');
  });

  it('plays no audio cue for the zone copy (the personal plan owns the sound)', () => {
    expect(arm).not.toContain('audio.');
    expect(arm).not.toContain('playSound');
  });
});
