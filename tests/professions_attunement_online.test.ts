// Professions 2.0 Phase 14 over the live GameServer wire (Phase 14 QA): the
// offline suites pin the emit side (attunement_events, prof_nudges, tier_mail,
// quest_cadence) through the real Sim, but nothing pinned that the four new
// personal/zone celebration events route to the right sessions over the REAL
// server pump, that the work-order cooldown mirrors through the cprof self-delta
// so the client sees the quest as blocked, and that the tier letter reaches only
// its owner over the mail surface. Those are the stub-trap regressions (the 2033
// class): drop the routing or strip a wire field and every offline test stays
// green. Modeled on the masterwork_zone_broadcast session-routing suite and the
// guild_letter_online mail-routing suite.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres; only the sim
// fanout / sweeps and the tick -> routeEvents / broadcastSnapshots wire pump are
// under test, never persistence (the guild_letter_online precedent; the vi.mock
// hoisting caveat from #2088 applies: this block cannot be imported).
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
import { MASTER_TIER_LETTERS } from '../src/sim/content/letters';
import { QUESTS, zoneAt } from '../src/sim/data';
import { announceAttunement } from '../src/sim/professions/attunement_events';
import { WORK_ORDER_CADENCE_TICKS } from '../src/sim/professions/cadence';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { CraftingIdentityView } from '../src/world_api/professions';

const SMITH_PAIR = 'weaponcrafting+armorcrafting';
const WORK_ORDER = 'q_prof_workorder_forge';
const FORGE_MASTER = 'forgemistress_darva';

// Booking happens on the 1 Hz sweep within a second of the crossing; the tier
// letter then flies the 90 second NPC delivery delay (the guild_letter_online
// literal). 95 sim-seconds covers both with margin.
const DELIVERY_WINDOW_TICKS = 95 * 20;
const ONLINE_SUITE_TIMEOUT_MS = 40_000;

type SentMsg = { t: string; list?: SimEvent[]; self?: { cprof?: CraftingIdentityView } };

function fakeWs(): { sent: SentMsg[]; ws: unknown } {
  const sent: SentMsg[] = [];
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

function playersOf(server: GameServer): Map<number, PlayerMeta> {
  return (server.sim as unknown as { players: Map<number, PlayerMeta> }).players;
}

function entitiesOf(server: GameServer): Map<number, Entity> {
  return (server.sim as unknown as { entities: Map<number, Entity> }).entities;
}

function routeOf(server: GameServer): (evs: SimEvent[]) => void {
  return (evs) => (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(evs);
}

/** Move an overworld entity to a different zone than `zoneId` using the layout-
 *  agnostic z-scan (the masterwork_zone_broadcast idiom), so a zone reshuffle
 *  cannot silently turn a far player into an in-zone recipient. */
function moveToOtherZone(e: Entity, zoneId: string): void {
  let z = e.pos.z;
  for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z += 50;
  if (zoneAt(z).id === zoneId) {
    z = e.pos.z;
    for (let i = 0; i < 400 && zoneAt(z).id === zoneId; i++) z -= 50;
  }
  expect(zoneAt(z).id).not.toBe(zoneId);
  e.pos.z = z;
  e.prevPos = { ...e.prevPos, z };
}

/** Pull the pid-scoped events of one type out of a session's sent frames. */
function eventsOf(sent: SentMsg[], type: string): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

describe('attunement celebration over the live GameServer wire (session routing)', () => {
  it('routes the personal attuned event to the owner only and attunedZone to in-zone players only', () => {
    const server = new GameServer();
    const fcOwner = fakeWs();
    const fcNear = fakeWs();
    const fcFar = fakeWs();
    const so = joinServer(server, fcOwner, 101, 'Attuner');
    const sn = joinServer(server, fcNear, 102, 'Nearby');
    const sf = joinServer(server, fcFar, 103, 'Farhand');
    const ownerName = playersOf(server).get(so.pid)!.name;

    const entities = entitiesOf(server);
    const zoneId = zoneAt(entities.get(so.pid)!.pos.z).id;
    // Nearby spawns with the owner (same hub, same zone); park Farhand elsewhere.
    moveToOtherZone(entities.get(sf.pid)!, zoneId);

    // Fan out on the LIVE server sim (the quest-effect trigger is pinned offline;
    // this suite owns the wire routing), then run the real pump.
    announceAttunement(
      (server.sim as unknown as { ctx: Parameters<typeof announceAttunement>[0] }).ctx,
      so.pid,
      SMITH_PAIR,
    );
    routeOf(server)(server.sim.tick());

    // Personal attuned copy: the owner's session only.
    expect(eventsOf(fcOwner.sent, 'attuned')).toEqual([
      { type: 'attuned', pid: so.pid, pairId: SMITH_PAIR },
    ]);
    expect(eventsOf(fcNear.sent, 'attuned')).toEqual([]);
    expect(eventsOf(fcFar.sent, 'attuned')).toEqual([]);

    // Zone broadcast: one copy per in-zone session (owner + nearby), recipient
    // pid on each; the other-zone session gets nothing.
    const zoneCopy = (pid: number) => ({
      type: 'attunedZone',
      pid,
      celebrantPid: so.pid,
      celebrantName: ownerName,
      pairId: SMITH_PAIR,
      zoneId,
    });
    expect(eventsOf(fcOwner.sent, 'attunedZone')).toEqual([zoneCopy(so.pid)]);
    expect(eventsOf(fcNear.sent, 'attunedZone')).toEqual([zoneCopy(sn.pid)]);
    expect(eventsOf(fcFar.sent, 'attunedZone')).toEqual([]);
  });
});

describe('profession nudges over the live GameServer wire (session routing)', () => {
  it('routes the trend nudge and first-tier tutorial to their owner only', () => {
    const server = new GameServer();
    const fcOwner = fakeWs();
    const fcOther = fakeWs();
    const so = joinServer(server, fcOwner, 111, 'Crafter');
    joinServer(server, fcOther, 112, 'Bystander');

    // An unattuned crafter with a leaning trend AND a craft past tier 1: the 1 Hz
    // sweep fires BOTH the trend nudge and the once-ever tier tutorial. The
    // Bystander has no craft skill, so it qualifies for neither (a clean
    // negative), and the events are pid-scoped to the owner regardless.
    playersOf(server).get(so.pid)!.craftSkills.weaponcrafting = 30;
    const route = routeOf(server);
    for (let i = 0; i < 40; i++) route(server.sim.tick());

    expect(eventsOf(fcOwner.sent, 'profTierTutorial')).toEqual([
      { type: 'profTierTutorial', pid: so.pid },
    ]);
    expect(eventsOf(fcOwner.sent, 'profTrendNudge')).toEqual([
      { type: 'profTrendNudge', pid: so.pid, pairId: SMITH_PAIR },
    ]);
    // Neither personal event leaks to the other session.
    expect(eventsOf(fcOther.sent, 'profTierTutorial')).toEqual([]);
    expect(eventsOf(fcOther.sent, 'profTrendNudge')).toEqual([]);
  });
});

// The work-order cooldown reaches the owner as a wire field (cprof), not a
// broadcast event: the server computes cadenceBlockedQuests against ITS tick and
// diffs it onto the self payload.
function moveEntityTo(server: GameServer, pid: number, templateId: string): void {
  const npc = [...entitiesOf(server).values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const e = entitiesOf(server).get(pid);
  if (!e) throw new Error(`entity ${pid} missing`);
  e.pos.x = npc.pos.x + 1;
  e.pos.z = npc.pos.z;
}

function workOrderMaterial(): { itemId: string; count: number } {
  const obj = QUESTS[WORK_ORDER].objectives.find((o) => o.type === 'collect');
  if (!obj || obj.type !== 'collect' || !obj.itemId) throw new Error('no collect objective');
  return { itemId: obj.itemId, count: obj.count };
}

describe('work-order cadence mirror over the live GameServer wire (cprof)', () => {
  it('an online work-order turn-in blocks the quest over cprof, and a lapsed window empties the mirror on a later broadcast', () => {
    const server = new GameServer();
    const fcOwner = fakeWs();
    const so = joinServer(server, fcOwner, 121, 'Worker');
    const meta = playersOf(server).get(so.pid)!;
    const { itemId, count } = workOrderMaterial();

    // A real per-pid turn-in on the live server sim (acceptQuest/turnInQuest take
    // a pid; the collect objective is forced ready, the harness idiom).
    moveEntityTo(server, so.pid, FORGE_MASTER);
    server.sim.acceptQuest(WORK_ORDER, so.pid);
    server.sim.addItem(itemId, count, so.pid);
    const qp = meta.questLog.get(WORK_ORDER);
    if (!qp) throw new Error('work order not accepted online');
    qp.counts = [count];
    qp.state = 'ready';
    moveEntityTo(server, so.pid, FORGE_MASTER);
    server.sim.turnInQuest(WORK_ORDER, so.pid);

    // The cprof SOURCE the wire serializes: the server computes the blocked set
    // against its own tick, and the quest reads unavailable server-side.
    expect(meta.questCadence.get(WORK_ORDER)).toBe(server.sim.tickCount + WORK_ORDER_CADENCE_TICKS);
    expect(server.sim.craftingIdentityFor(so.pid).cadenceBlockedQuests).toContain(WORK_ORDER);
    expect(server.sim.questState(WORK_ORDER, so.pid)).toBe('unavailable');

    // The real wire: the next snapshot broadcast diffs cprof onto the owner's
    // self payload with the blocked quest inside cadenceBlockedQuests.
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    const cprofs = fcOwner.sent
      .filter((m) => m.t === 'snap' && m.self?.cprof)
      .map((m) => m.self!.cprof!);
    expect(cprofs.length).toBeGreaterThan(0);
    expect(cprofs[cprofs.length - 1].cadenceBlockedQuests).toContain(WORK_ORDER);

    // The UNBLOCK arm (blocked -> available over the wire): lapse the window
    // server-side by rewinding the stored availableAt to the server's CURRENT
    // tick (isCadenceBlocked is strict-before, so a key is available exactly
    // AT its availableAt). If the cprof diff failed to re-emit on a set
    // SHRINK, the stale blocked frame would stay last until relog and only
    // the blocked half above would keep this suite green.
    meta.questCadence.set(WORK_ORDER, server.sim.tickCount);
    expect(server.sim.questState(WORK_ORDER, so.pid)).toBe('available');
    routeOf(server)(server.sim.tick());
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    const after = fcOwner.sent
      .filter((m) => m.t === 'snap' && m.self?.cprof)
      .map((m) => m.self!.cprof!);
    // A NEW cprof frame shipped for the shrink (the delta re-emits, it is not
    // the old blocked frame still sitting last), and its blocked set no
    // longer carries the work order.
    expect(after.length).toBeGreaterThan(cprofs.length);
    const lapsedFrame = after[after.length - 1];
    expect(lapsedFrame.cadenceBlockedQuests).not.toContain(WORK_ORDER);
    // Close the loop client-side: feed the LAST wire frame into the bare
    // client mirror and the quest reads available again.
    const client = bareClient({ cadenceBlockedQuests: lapsedFrame.cadenceBlockedQuests });
    expect(client.questState(WORK_ORDER)).toBe('available');
  });
});

// A ClientWorld with no constructor run (the bareClient idiom from
// masterwork_event_mirror / masterwork_zone_broadcast): the client questState
// honors the mirrored cadenceBlockedQuests exactly as the offline Sim honors its
// live questCadence, so a mirrored cooldown reads unavailable client-side too.
function bareClient(identity: Partial<CraftingIdentityView>): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  const w = c as unknown as {
    questLog: Map<string, unknown>;
    questsDone: Set<string>;
    pendingQuestCommands: Map<string, 'accept' | 'turnin'>;
    playerId: number;
    entities: Map<number, { level: number }>;
    craftingIdentity: CraftingIdentityView;
  };
  w.questLog = new Map();
  w.questsDone = new Set();
  w.pendingQuestCommands = new Map();
  // `this.player` is a getter over entities.get(playerId); questState reads only
  // .level off it, so a minimal self entity at a valid level satisfies it.
  w.playerId = 1;
  w.entities = new Map([[1, { level: 5 }]]);
  w.craftingIdentity = {
    version: 1,
    synced: true,
    craftSkills: {},
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 0,
    knownRecipes: [],
    cadenceBlockedQuests: [],
    ...identity,
  } as CraftingIdentityView;
  return c;
}

describe('work-order cadence on the online client (ClientWorld.questState)', () => {
  it('reads a mirrored-blocked work order as unavailable and a non-blocked one as available', () => {
    // Same identity, two repeatable work orders: only the one in the mirrored
    // cadenceBlockedQuests set is gated, so the set is doing the discrimination.
    const client = bareClient({ cadenceBlockedQuests: [WORK_ORDER] });
    expect(client.questState(WORK_ORDER)).toBe('unavailable');
    expect(client.questState('q_prof_workorder_loom')).toBe('available');

    // With the mirror empty (a lapsed window or a pre-Phase-14 server), the same
    // work order is available again.
    const clear = bareClient({ cadenceBlockedQuests: [] });
    expect(clear.questState(WORK_ORDER)).toBe('available');
  });
});

describe('tier mail over the live GameServer wire (session routing)', () => {
  it(
    'a tier crossing delivers the master letter to the owner only, from MASTER_TIER_LETTERS',
    () => {
      const server = new GameServer();
      const fcOwner = fakeWs();
      const fcOther = fakeWs();
      const so = joinServer(server, fcOwner, 131, 'Ascender');
      joinServer(server, fcOther, 132, 'Bystander');

      // Attune the owner to the Smith pair on the live server, pre-acknowledge
      // tier 1 for the primary major (the deploy-baseline state), then set the
      // primary to tier 2 skill: the next sweep books the tier-2 letter (a real
      // crossing above the acknowledged tier).
      const meta = playersOf(server).get(so.pid)!;
      meta.archetype.activeArchetype = 'weaponcrafting';
      meta.archetype.pairedMajor = 'armorcrafting';
      meta.archetype.hobbyCraft = 'leatherworking';
      meta.archetype.attunedPairs = [SMITH_PAIR];
      meta.tierMailSent.set('weaponcrafting', 1);
      meta.craftSkills.weaponcrafting = 50; // tier 2 (tierForSkill = floor(skill / 25))

      const route = routeOf(server);
      for (let i = 0; i < DELIVERY_WINDOW_TICKS; i++) route(server.sim.tick());

      const tierLetter = MASTER_TIER_LETTERS[SMITH_PAIR][2];
      const tierMailOf = (sent: SentMsg[]) =>
        eventsOf(sent, 'mailArrived').filter((ev) =>
          ((ev as { letterId?: string }).letterId ?? '').startsWith('prof_tier_'),
        );
      // Exactly one tier arrival, exact wire payload (letterId + senderName come
      // straight from the MASTER_TIER_LETTERS content entry), owner session only.
      expect(tierMailOf(fcOwner.sent)).toEqual([
        {
          type: 'mailArrived',
          senderName: tierLetter.senderName,
          letterId: tierLetter.letterId,
          pid: so.pid,
        },
      ]);
      expect(tierLetter.letterId).toBe('prof_tier_weaponcrafting_armorcrafting_2');
      expect(tierMailOf(fcOther.sent)).toEqual([]);
      // The acknowledged tier advanced, so a second sweep never re-books it.
      expect(meta.tierMailSent.get('weaponcrafting')).toBe(2);
    },
    ONLINE_SUITE_TIMEOUT_MS,
  );
});
