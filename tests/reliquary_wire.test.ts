// Reliquary Phase 3: IWorld + wire thrift. Sparse `reliq` self blob, id-only
// `reliquaryUnlock` presentation event, online/offline completion parity for
// scripted state. No UI coverage here.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // The chroma unequip path revokes through the db before its promise chain;
  // stubbed so the movement pin below exercises the real server method.
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  // join() refreshes account flair; stub so tests do not stderr on missing export.
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { applyBoostKitToPlayer } from '../server/pbe_boost';
import { mechChromaItemId } from '../src/sim/content/skins';
import { markItemDiscovered } from '../src/sim/deeds';
import {
  isCataloguedRelicItem,
  noteReliquaryMark,
  RELIQUARY_PAGES_BY_ID,
  reliquaryWireCacheProbe,
  restoreReliquaryState,
} from '../src/sim/reliquary';
import type { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

/** Catalogued Hollow Crypt unique used across Reliquary pin tests. */
const CATALOGUE_RELIC = 'cryptbone_helm';
const PAGE_ID = 'conquerors_hollow_crypt';
/** Hollow Crypt has five item relics; used for Illumination + absolute totals. */
const HOLLOW_CRYPT_RELICS = [
  'cryptbone_greaves',
  'cryptbone_helm',
  'cryptbone_pauldrons',
  'greyjaw_hide_boots',
  'gravewoven_bag',
] as const;
/** Authored profession mark id (Phase 7 field note) for sparse marks[] wire pins. */
const SEEDED_MARK_ID = 'gather_event:pristine_vein';

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}

function lastEvents(sent: any[]): any[] {
  const out: any[] = [];
  for (const msg of sent) {
    if (msg.t === 'events' && Array.isArray(msg.list)) out.push(...msg.list);
  }
  return out;
}

function joinAt(server: GameServer, fw: ReturnType<typeof fakeWs>, acct: number, name: string) {
  const s = server.join(fw.ws as any, acct, acct, name, 'warrior', null) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

/** Pump sim events through the server's private routeEvents (HEAVY_SELF dirty). */
function routeEvents(server: GameServer, events: unknown[]): void {
  (server as unknown as { routeEvents(e: unknown[]): void }).routeEvents(events);
}

function scriptedReliquaryState(sim: Sim, pid: number): void {
  const meta = sim.players.get(pid)!;
  meta.deedStats.dungeonClears.hollow_crypt = 4;
  markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
  // A second catalogued unique so recent is multi-entry and completion is partial.
  markItemDiscovered(sim.ctx, meta, 'cryptbone_greaves');
  // One real hub grant so the folded obtain tally rides the wire for exactly
  // ONE of the two entries: the other stays sparse, which is what proves the
  // fold is per entry rather than a blanket field.
  sim.addItem(CATALOGUE_RELIC, 1, pid);
}

describe('Reliquary wire thrift', () => {
  it('heavy self ships sparse reliq only (no dual itemsDiscovered on the blob)', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 1, 'RelicA');
    const sim = server.sim as Sim;
    scriptedReliquaryState(sim, session.pid);
    // Seed an authored mark so the non-empty marks[] arm is on the wire (Phase 3
    // contract: firstFind / marks / recent; omit-empty when none).
    const meta = sim.players.get(session.pid)!;
    // Through the real write seam, not a hand-mutation: noteReliquaryMark is
    // what pushes recent AND bumps the wire memo's revision, so seeding this
    // way keeps the test honest about how a mark actually reaches the blob.
    noteReliquaryMark(sim.ctx, meta, SEEDED_MARK_ID);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap).not.toBeNull();
    expect(snap.self).toHaveProperty('reliq');

    const reliq = snap.self.reliq;
    // Sparse shape: firstFind + marks + recent. Never a second discovery array.
    expect(reliq).not.toHaveProperty('itemsDiscovered');
    expect(Object.keys(reliq).sort()).toEqual(['firstFind', 'marks', 'recent']);
    // Phase 17 wire shape: pageId is gone from the entry and the obtain tally
    // rides folded onto it as `count`, never as a fourth top-level key.
    expect(reliq.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 4, count: 1 });
    expect(reliq.firstFind.cryptbone_greaves).toEqual({ clears: 4 });
    expect(reliq.marks).toEqual([SEEDED_MARK_ID]);
    expect(reliq.recent).toEqual([CATALOGUE_RELIC, 'cryptbone_greaves', SEEDED_MARK_ID]);

    // Payload thrift: the sparse blob is far smaller than re-shipping dstats discovery.
    const reliqBytes = JSON.stringify(reliq).length;
    const dstatsDiscoveryBytes = JSON.stringify(snap.self.dstats?.itemsDiscovered ?? []).length;
    expect(reliqBytes).toBeLessThan(400);
    // dstats may still carry discovery (ownership authority); reliq must not grow into it.
    expect(reliqBytes).toBeLessThan(dstatsDiscoveryBytes + 200);

    // Ownership still rides dstats, not a duplicate list on reliq.
    expect(snap.self.dstats.itemsDiscovered).toContain(CATALOGUE_RELIC);
  });

  it('quiet ticks omit reliq (dirty-only); a catalogued find re-ships it', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 2, 'RelicB');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    (server as any).broadcastSnapshots(); // first full self
    sim.tick();
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const quiet = lastSnap(fw.sent);
    expect(quiet.self).not.toHaveProperty('reliq');
    expect(quiet.self).not.toHaveProperty('dstats');

    meta.deedStats.dungeonClears.hollow_crypt = 1;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    // routeEvents marks HEAVY_SELF_EVENTS (reliquaryUnlock) so the next snapshot
    // re-diffs sparse reliq without waiting on the staggered backstop.
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'reliquaryUnlock')).toBe(true);
    routeEvents(server, events);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const after = lastSnap(fw.sent);
    expect(after.self).toHaveProperty('reliq');
    expect(after.self.reliq.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 1 });

    // A later OBTAIN of the same relic moves nothing but the tally. In
    // production it still dirties the session (addItem emits a `loot` event,
    // a HEAVY_SELF_EVENTS member; the gate-ON arm below pins that chain);
    // HERE the gate is forced open so this assertion isolates the MEMO'S
    // revision from the dirty flag: even with every tick heavy, a stale build
    // would ship the old bytes.
    (server as any).heavySelfGate = false;
    sim.addItem(CATALOGUE_RELIC, 1, session.pid);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const counted = lastSnap(fw.sent);
    expect(counted.self).toHaveProperty('reliq');
    expect(counted.self.reliq.firstFind[CATALOGUE_RELIC]).toEqual({ clears: 1, count: 1 });
  });

  it('a repeat obtain re-ships promptly through the loot event with the gate ON', () => {
    // The PRODUCTION path for a tally-only change reaching an online client:
    // addItem always emits `loot`, `loot` is in HEAVY_SELF_EVENTS, routing
    // sets selfHeavyDirty, and the next snapshot re-diffs reliq. Nothing else
    // pinned that chain (removing `loot` from HEAVY_SELF_EVENTS would fall
    // back to the ~2s staggered refresh with every other test green), so this
    // drives it with the gate ON, end to end, and asserts the count advances.
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 8, 'RelicJ');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;
    // The premise in the name: SELF_SNAPSHOT_FULL=1 would silently void it.
    expect((server as any).heavySelfGate).toBe(true);

    sim.addItem(CATALOGUE_RELIC, 1, session.pid);
    routeEvents(server, sim.drainEvents());
    (server as any).broadcastSnapshots();
    const first = lastSnap(fw.sent);
    expect(first.self.reliq.firstFind[CATALOGUE_RELIC].count).toBe(1);

    // Isolate the LOOT arm of heavyDue before the decisive broadcast. A
    // repeat obtain reaches the client promptly through TWO redundant arms
    // (proven by mutation while writing this): the `loot` event marks
    // selfHeavyDirty, AND onInventoryChangedForQuests bumps meta.wireRev on
    // every inventory mutation, which the wireRev arm re-diffs. Removing
    // `loot` from HEAVY_SELF_EVENTS therefore does NOT degrade the tally to
    // the staggered backstop today; the failure needs both arms gone. This
    // test holds the loot arm alone: step off the modulo slot, then
    // neutralize the wireRev arm after routing, so ONLY the dirty flag can
    // carry the re-ship and dropping `loot` from the set goes red here.
    while ((sim.tickCount + session.pid) % 40 === 0) sim.tick();
    expect((sim.tickCount + session.pid) % 40).not.toBe(0);
    routeEvents(server, sim.drainEvents()); // clear tick residue deliberately

    // The repeat obtain: no find, no unlock event, only `loot` carries it.
    fw.sent.length = 0;
    const wireRevBefore = meta.wireRev;
    sim.addItem(CATALOGUE_RELIC, 1, session.pid);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'loot')).toBe(true);
    expect(events.some((e) => e.type === 'reliquaryUnlock')).toBe(false);
    routeEvents(server, events);
    expect(session.selfHeavyDirty, 'the loot event must mark the session dirty').toBe(true);
    // The redundant arm's premise, then its neutralization (see above).
    expect(meta.wireRev).toBeGreaterThan(wireRevBefore);
    session.lastWireRev = meta.wireRev;
    (server as any).broadcastSnapshots();
    const after = lastSnap(fw.sent);
    expect(after.self).toHaveProperty('reliq');
    expect(after.self.reliq.firstFind[CATALOGUE_RELIC].count).toBe(2);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(2);
  });

  it('builds the reliq blob once per CHANGE, not once per heavy tick', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 8, 'RelicH');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;
    // Force every tick heavy so the two ticks below are genuinely both due;
    // otherwise the staggered refresh, not the memo, would be doing the work.
    (server as any).heavySelfGate = false;

    meta.deedStats.dungeonClears.hollow_crypt = 2;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    routeEvents(server, sim.drainEvents());
    (server as any).broadcastSnapshots();
    const first = reliquaryWireCacheProbe(meta.reliquary);
    expect(first, 'the heavy tick must have built and cached a blob').toBeDefined();

    // A second heavy tick with nothing changed reuses the SAME record. Object
    // identity, not equal bytes: equal bytes would pass with no memo at all.
    (server as any).broadcastSnapshots();
    expect(reliquaryWireCacheProbe(meta.reliquary)).toBe(first);

    // A write rebuilds: a new record at a higher revision, carrying the change.
    sim.addItem(CATALOGUE_RELIC, 1, session.pid);
    (server as any).broadcastSnapshots();
    const rebuilt = reliquaryWireCacheProbe(meta.reliquary);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt!.rev).toBeGreaterThan(first!.rev);
    expect(JSON.parse(rebuilt!.json).firstFind[CATALOGUE_RELIC]).toEqual({ clears: 2, count: 1 });

    // The memo is keyed on state IDENTITY, so a second character's blob can
    // never be served from the first one's cache.
    const otherFw = fakeWs();
    const other = joinAt(server, otherFw, 9, 'RelicI');
    const otherMeta = sim.players.get(other.pid)!;
    expect(reliquaryWireCacheProbe(otherMeta.reliquary)).toBeUndefined();
    (server as any).broadcastSnapshots();
    expect(reliquaryWireCacheProbe(otherMeta.reliquary)).not.toBe(rebuilt);
    expect(reliquaryWireCacheProbe(otherMeta.reliquary)!.json).toBe('{}');
  });

  it('reliquaryUnlock is id-only with pageIds and no English', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 3, 'RelicC');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    meta.deedStats.dungeonClears.hollow_crypt = 2;
    fw.sent.length = 0;
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    const events = sim.drainEvents();
    routeEvents(server, events);
    (server as any).broadcastSnapshots();

    const unlocks = lastEvents(fw.sent).filter((e) => e.type === 'reliquaryUnlock');
    expect(unlocks.length).toBe(1);
    const ev = unlocks[0];
    expect(ev.itemId).toBe(CATALOGUE_RELIC);
    expect(ev.markId).toBeUndefined();
    expect(ev.pageIds).toEqual([PAGE_ID]);
    expect(ev.pid).toBe(session.pid);
    // First catalogued fill ranks up to 1; curatorRank is an id-only numeric.
    expect(ev.curatorRank).toBe(1);
    // Wire keys are the id-only contract; no display text fields.
    expect(Object.keys(ev).sort()).toEqual(
      ['curatorRank', 'itemId', 'pageIds', 'pid', 'type'].sort(),
    );
    expect(ev.name).toBeUndefined();
    expect(ev.label).toBeUndefined();
    expect(ev.message).toBeUndefined();
    expect(ev.text).toBeUndefined();
  });

  it('reliquaryUnlock includes illuminatedPageId (id-only) when a page completes', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 6, 'RelicF');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    meta.deedStats.dungeonClears.hollow_crypt = 3;
    // Pre-own all but the last Hollow Crypt relic so the final discover illuminates.
    for (const id of HOLLOW_CRYPT_RELICS.slice(0, -1)) {
      markItemDiscovered(sim.ctx, meta, id);
    }
    sim.drainEvents();
    fw.sent.length = 0;
    const lastRelic = HOLLOW_CRYPT_RELICS[HOLLOW_CRYPT_RELICS.length - 1]!;
    markItemDiscovered(sim.ctx, meta, lastRelic);
    const events = sim.drainEvents();
    routeEvents(server, events);
    (server as any).broadcastSnapshots();

    const unlocks = lastEvents(fw.sent).filter((e) => e.type === 'reliquaryUnlock');
    expect(unlocks.length).toBe(1);
    const ev = unlocks[0];
    expect(ev.itemId).toBe(lastRelic);
    expect(ev.pageIds).toEqual([PAGE_ID]);
    expect(ev.illuminatedPageId).toBe(PAGE_ID);
    expect(Object.keys(ev).sort()).toEqual(
      ['illuminatedPageId', 'itemId', 'pageIds', 'pid', 'type'].sort(),
    );
    expect(ev.name).toBeUndefined();
    expect(ev.label).toBeUndefined();
    expect(ev.message).toBeUndefined();
    expect(ev.text).toBeUndefined();
  });

  it('a retro fill keeps its retro flag all the way to the client frame', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 7, 'RelicG');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    sim.drainEvents();
    fw.sent.length = 0;
    // The join seed's own call shape (deeds.ts seedItemDiscovery). Online, the
    // flag is the client's only signal to collapse a veteran's catch-up into
    // one summary line; if it were dropped anywhere between the sim and the
    // routed frame, that login would toast once per seeded relic.
    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC, undefined, { retro: true });
    const events = sim.drainEvents();
    routeEvents(server, events);
    (server as any).broadcastSnapshots();

    const unlocks = lastEvents(fw.sent).filter((e) => e.type === 'reliquaryUnlock');
    expect(unlocks.length).toBe(1);
    expect(unlocks[0].retro).toBe(true);
    expect(unlocks[0].itemId).toBe(CATALOGUE_RELIC);
    // Silent on the state side too: logging in is not a find moment.
    expect(meta.reliquary.recent).toEqual([]);
  });
});

describe('Reliquary movement flag on the server-only grant paths', () => {
  it('a GM item restore re-mints without counting, and still discovers', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 20, 'RelicRestore');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;
    meta.deedStats.dungeonClears.hollow_crypt = 5;

    // The real admin entry point, resolved by characterId exactly as the
    // support handler resolves it.
    const outcome = server.adminRestoreItem(session.characterId, CATALOGUE_RELIC, 2);
    expect(outcome).toBe('ok');

    // The grant really landed (otherwise every claim below is vacuous).
    expect(meta.inventory.some((s) => s.itemId === CATALOGUE_RELIC)).toBe(true);
    // Discovery fires, as on every movement path...
    expect(meta.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();
    // ...while the tally stays empty and no clear count is invented, despite a
    // meter reading 5. A support ticket must not move a player-visible number.
    expect(meta.reliquary.counts).toEqual({});
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toEqual({});
  });

  it('a PBE boost kit seeds gear without counting any of it', () => {
    // Behavioral rather than a source scan: applyBoostKitToPlayer is a pure
    // Sim function (the DB work lives in its callers), so the policy can be
    // driven for real. A boost kit is a SYSTEM SEED, mirroring the join-time
    // retro fill, which deliberately never counts either.
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 22, 'RelicBoost');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;
    meta.pbeBoostKit = 0;

    expect(applyBoostKitToPlayer(sim, session.pid)).toBe(true);

    // Premise: the kit really does hand over catalogued relics, or "no counts"
    // would be true for the boring reason.
    const seededRelics = [...meta.deedStats.itemsDiscovered].filter((id) =>
      isCataloguedRelicItem(id),
    );
    expect(seededRelics.length).toBeGreaterThan(0);
    // The alt-role BAGGED loop is a distinct grant site inside the kit: prove
    // it handed over a catalogued relic of its own, so dropping only ITS
    // movement flag cannot stay green on the equipped items' content alone.
    expect(meta.inventory.some((s) => isCataloguedRelicItem(s.itemId))).toBe(true);
    // Discovery fills the catalog, as on every movement path...
    for (const id of seededRelics) expect(meta.reliquary.firstFind[id]).toBeDefined();
    // ...and not one of them counts as something the world handed the player.
    expect(meta.reliquary.counts).toEqual({});
  });

  it('unequipping a mech chroma re-grants without counting (server arm)', () => {
    // The twin of the offline Sim.unequipMechChroma pin in
    // tests/reliquary_state.test.ts. Both arms must carry the flag or the two
    // hosts answer the tally differently for one action; this is the half a
    // sim-only test cannot see.
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 21, 'RelicChroma');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    const chromaId = 'amber_crimson';
    const itemId = mechChromaItemId(chromaId);
    expect(itemId).toBeTruthy();
    session.accountCosmetics = { ...session.accountCosmetics, mechChromaIds: [chromaId] };
    const before = { ...meta.reliquary.counts };

    (
      server as unknown as { unequipAccountMechChroma(s: unknown, c: string): void }
    ).unequipAccountMechChroma(session, chromaId);

    expect(meta.inventory.some((s) => s.itemId === itemId)).toBe(true);
    expect(meta.deedStats.itemsDiscovered.has(itemId!)).toBe(true);
    expect(meta.reliquary.counts).toEqual(before);
  });
});

describe('Reliquary online / offline parity for scripted state', () => {
  it('ClientWorld mirrors reliq and answers completion identically to Sim', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 4, 'RelicD');
    const sim = server.sim as Sim;
    scriptedReliquaryState(sim, session.pid);
    sim.tick();

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);

    // Sparse mirrors.
    expect(client.reliquaryFirstFind[CATALOGUE_RELIC]).toEqual(
      sim.reliquaryFirstFind[CATALOGUE_RELIC],
    );
    expect([...client.reliquaryMarks]).toEqual([...sim.reliquaryMarks]);
    expect(client.reliquaryRecent).toEqual([...sim.reliquaryRecent]);
    // The obtain tally travels folded onto a firstFind entry and the mirror
    // splits it back out, so the two hosts answer the facet identically.
    expect(client.reliquaryObtainCounts).toEqual(sim.reliquaryObtainCounts);
    expect(client.reliquaryObtainCounts).toEqual({ [CATALOGUE_RELIC]: 1 });

    // Ownership for completion still rides deedStats discovery, mirrored via dstats.
    expect(client.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(true);
    expect(client.deedStats.itemsDiscovered.has('cryptbone_greaves')).toBe(true);

    const offlinePage = sim.reliquaryPageCompletion(PAGE_ID);
    const onlinePage = client.reliquaryPageCompletion(PAGE_ID);
    expect(onlinePage).toEqual(offlinePage);
    expect(onlinePage).not.toBeNull();
    expect(onlinePage!.owned).toBe(2);
    expect(onlinePage!.total).toBe(5);
    expect(onlinePage!.total).toBe(RELIQUARY_PAGES_BY_ID[PAGE_ID]!.relics.length);
    expect(onlinePage!.complete).toBe(false);

    // Absolute completion pins (not only client === sim relative equality).
    const catalog = client.reliquaryCatalogCompletion();
    expect(catalog).toEqual(sim.reliquaryCatalogCompletion());
    expect(catalog.owned).toBe(2);
    expect(catalog.total).toBeGreaterThanOrEqual(2);
    expect(client.reliquaryCuratorRank()).toBe(1);
    expect(client.reliquaryCuratorRank()).toBe(sim.reliquaryCuratorRank());
    expect(client.reliquaryPageClearCount(PAGE_ID)).toBe(sim.reliquaryPageClearCount(PAGE_ID));
    expect(client.reliquaryPageClearCount(PAGE_ID)).toBe(4);
    expect(client.reliquaryPageCompletion('not_a_page')).toBeNull();
  });

  it('the wire blob carries illuminatedPages and ClientWorld DROPS it on decode', () => {
    // The deliberate encode/decode asymmetry: the sticky set rides the reliq
    // blob because wire shape IS save shape, and the client discards it (no
    // facet member, no mirror field). Until now only comments guarded the
    // drop; this pin makes mirroring it a reviewed act, not a drive-by "fix".
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 6, 'RelicF');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;
    meta.reliquary = restoreReliquaryState({
      illuminatedPages: [PAGE_ID],
      marks: [SEEDED_MARK_ID],
    });
    sim.tick();

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    // Premise arm first: the set really is on the wire, so the emptiness
    // below is a decode decision, never an absent field.
    expect(snap.self.reliq.illuminatedPages).toEqual([PAGE_ID]);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    // A sibling surface from the SAME blob decoded (a mark, not a
    // default-initialized field), so the decode arm provably ran and the
    // emptiness below cannot come from a skipped block. Then the sharp claim:
    // no own property of the client names the set; a future mirror
    // assignment would mint one and red this filter.
    expect([...client.reliquaryMarks]).toEqual([SEEDED_MARK_ID]);
    const illumKeys = Object.keys(client as unknown as Record<string, unknown>).filter((k) =>
      /illuminated/i.test(k),
    );
    expect(illumKeys).toEqual([]);
  });

  it('does not invent membership from a presentation-only reliquaryUnlock event', () => {
    // Phase 18 note: the server now carries an illumination fan-out arm for
    // this event, but on the CLIENT it stays presentation-only: membership
    // authority is the sparse self blob, never an event.
    const client = bareClient(99);
    expect(client.reliquaryFirstFind[CATALOGUE_RELIC]).toBeUndefined();
    expect(client.reliquaryRecent).toEqual([]);
    expect(client.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);

    // Events-only payload: no self.reliq / dstats. Membership must stay empty.
    (client as any).onMessage(
      JSON.stringify({
        t: 'events',
        list: [
          {
            type: 'reliquaryUnlock',
            pid: 99,
            itemId: CATALOGUE_RELIC,
            pageIds: [PAGE_ID],
          },
        ],
      }),
    );

    expect(client.reliquaryFirstFind[CATALOGUE_RELIC]).toBeUndefined();
    expect(Object.keys(client.reliquaryFirstFind)).toEqual([]);
    expect(client.reliquaryRecent).toEqual([]);
    expect(client.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
  });

  it('does not force saveCharacter on pure relic fill', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinAt(server, fw, 5, 'RelicE');
    const sim = server.sim as Sim;
    const meta = sim.players.get(session.pid)!;

    // Spy the server method deed unlocks call synchronously (not the async db
    // mock): void this.saveCharacter(session) schedules work after a microtask,
    // so a not-called db mock can false-green a real force-save regression.
    const saveSpy = vi.spyOn(server, 'saveCharacter').mockResolvedValue(true as never);

    markItemDiscovered(sim.ctx, meta, CATALOGUE_RELIC);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'reliquaryUnlock')).toBe(true);
    routeEvents(server, events);
    // detectActivity must not force a deed-style save on reliquaryUnlock
    // (since Phase 18 the event HAS a fan-out arm, the illumination marquee;
    // the arm broadcasts and nothing else: no save, no membership write).
    (server as unknown as { detectActivity(e: unknown[]): void }).detectActivity(events);
    (server as any).broadcastSnapshots();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(meta.reliquary.firstFind[CATALOGUE_RELIC]).toBeDefined();

    // The Phase 18 arm at full fire: a first-ever illumination broadcasts the
    // marquee, and STILL forces no save (marquee only, no record write). The
    // spy resolves so no real social delivery runs.
    const illumSpy = vi
      .spyOn((server as any).social, 'broadcastIllumination')
      .mockResolvedValue(undefined);
    (server as unknown as { detectActivity(e: unknown[]): void }).detectActivity([
      {
        type: 'reliquaryUnlock',
        pid: session.pid,
        itemId: CATALOGUE_RELIC,
        pageIds: [PAGE_ID],
        illuminatedPageId: PAGE_ID,
      },
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(illumSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();

    // The Phase 17 mutation point: a REPEAT obtain writes state (the tally)
    // without being a find at all, so it emits no reliquaryUnlock and nothing
    // marks the session dirty. It must not force a save either: the tally
    // rides the 30s autosave like the rest of the sparse blob, and a per-drop
    // save here would be a write amplification the whole design avoids.
    sim.addItem(CATALOGUE_RELIC, 1, session.pid);
    expect(meta.reliquary.counts[CATALOGUE_RELIC]).toBe(1);
    const repeatEvents = sim.drainEvents();
    routeEvents(server, repeatEvents);
    (server as unknown as { detectActivity(e: unknown[]): void }).detectActivity(repeatEvents);
    (server as any).broadcastSnapshots();
    expect(saveSpy).not.toHaveBeenCalled();

    // Contrast: a synthetic deedUnlocked must schedule saveCharacter so the
    // harness cannot vacuous-pass if the spy target drifts.
    (server as unknown as { detectActivity(e: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'col_set_deathlord' },
    ]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    saveSpy.mockRestore();
  });
});
