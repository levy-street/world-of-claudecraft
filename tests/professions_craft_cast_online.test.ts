// Craft Cast System Phase 3, ONLINE: the three halves of the batch craft that
// only exist on the wire, none of which the offline suites can see.
//   A. The ClientWorld send shapes: a single craft must stay byte-identical to
//      the pre-batch message (no `count` key at all), and the two batch forms
//      must carry exactly the keys they claim.
//   B. The server's msg.count guard, driven with values a hostile client can
//      actually put on the wire (a string, the null a NaN serializes to, a
//      negative, and an absurdly large one), asserted on the batch the SIM
//      ended up armed with rather than on the guard's own arithmetic.
//   C. The self-only `ccast` fragment: present with the server's CLAMPED batch
//      numbers while the cast runs, decoded into the ClientWorld entity mirror,
//      and back to null after the batch finishes or a move cancels it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked so the live GameServer rig needs no database; only the
// wire dispatch, the tick -> routeEvents pump, and broadcastSnapshots are
// under test (the hoisting caveat applies: this block cannot reference imports).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
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
  // Isolated legacy recorders keep these spies. Live craft consumption stages
  // in the session journal and rides saveCharacterState atomically instead.
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
import { insertBankLedgerRows, saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { REALM } from '../server/realm';
import type { ClientWorld } from '../src/net/online';
import { recipeById } from '../src/sim/content/recipes';
import { CRAFT_CAST_ID, type Entity } from '../src/sim/types';
import { bareClient, broadcast, type FakeClient, fakeWs, joinServer } from './helpers/bare_client';
import { completeCraftCast } from './helpers/enchant_family_cast';

// The batched ledger writer the Phase 04 vault arm asserts against.
const insertLedgerRowsMock = vi.mocked(insertBankLedgerRows);
const saveCharacterMock = vi.mocked(saveCharacterState);

function decodedJournalRows(session: ClientSession): Record<string, unknown>[] {
  return session.bankLedgerJournal.outbox
    .snapshot()
    .batches.flatMap((batch) => batch.rows)
    .map((row) => {
      const { instanceJson, counterpartyCopperDelta, counterpartyCount, ...plain } = row;
      return {
        ...plain,
        instance:
          instanceJson === null || instanceJson === undefined
            ? null
            : JSON.parse(String(instanceJson)),
        ...(counterpartyCopperDelta == null ? {} : { counterpartyCopperDelta }),
        ...(counterpartyCount == null ? {} : { counterpartyCount }),
      };
    });
}

// A field recipe (skillReq 0, no station), so a freshly joined character can
// start it standing in the open with nothing but reagents and coin.
const RECIPE_ID = 'recipe_eastbrook_arming_sword';
// The same northern Eastbrook Vale spot the other profession wire suites use:
// outside every station circle and clear of hostile camp pull ranges.
const FIELD_POS = { x: 40, z: 140 };

type SelfWire = {
  ccast?: { r: string; rem: number; tot: number } | null;
  [k: string]: unknown;
};

function entityOf(server: GameServer, pid: number): Entity {
  const entity = server.sim.entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  return entity;
}

function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
  const entity = entityOf(server, pid);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

function routeTick(server: GameServer): void {
  // biome-ignore lint/suspicious/noExplicitAny: routeEvents is a private server-loop method
  (server as any).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

/** The newest self-carrying snapshot frame among everything sent to a fakeWs(). */
function selfAfter(fc: FakeClient, fromIdx = 0): SelfWire {
  for (let i = fc.sent.length - 1; i >= fromIdx; i--) {
    const msg = fc.sent[i];
    if (msg.t === 'snap' && msg.self !== undefined) return msg.self as SelfWire;
  }
  throw new Error('no self-carrying snapshot');
}

function applySnap(client: ClientWorld, snap: unknown): void {
  (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
}

/** The newest whole snapshot frame (the client decodes the frame, not the self
 *  fragment alone). */
function snapAfter(fc: FakeClient, fromIdx = 0): unknown {
  for (let i = fc.sent.length - 1; i >= fromIdx; i--) {
    if (fc.sent[i].t === 'snap' && fc.sent[i].self !== undefined) return fc.sent[i];
  }
  throw new Error('no snapshot frame');
}

/** Reagents for exactly `crafts` full crafts of RECIPE_ID, plus coin for the
 *  gold sink. A fresh character has no craft skill and no archetype, so no
 *  reagent discount applies and the mats-fit is exactly `crafts`. */
function stockFor(server: GameServer, pid: number, crafts: number): void {
  const recipe = recipeById(RECIPE_ID);
  if (!recipe) throw new Error(`${RECIPE_ID} is missing from the recipe table`);
  for (const reagent of recipe.reagents) {
    server.sim.addItem(reagent.itemId, reagent.count * crafts, pid);
  }
  const meta = server.sim.meta(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  meta.copper = 1_000_000;
}

// ---------------------------------------------------------------------------
// A. ClientWorld send shapes.
// ---------------------------------------------------------------------------
describe('ClientWorld.craftItem batch send shapes', () => {
  // The shared bareClient fixture with its send seam captured: rawCmd is the
  // last hop before ws.send, so what lands in `sent` is exactly the payload the
  // wire frame wraps (the tests/professions_commissions.test.ts capture idiom).
  function captureClient(): { client: ClientWorld; sent: Record<string, unknown>[] } {
    const client = bareClient(4101);
    const sent: Record<string, unknown>[] = [];
    (client as unknown as { rawCmd(p: Record<string, unknown>): void }).rawCmd = (p) => {
      sent.push(p);
    };
    return { client, sent };
  }

  it('a single craft sends no count key and no commission key', () => {
    const { client, sent } = captureClient();
    client.craftItem(RECIPE_ID, false, 1);
    expect(sent).toEqual([{ cmd: 'craft_item', recipe: RECIPE_ID }]);
    // toEqual treats a written-undefined key as absent, so absence is asserted
    // directly: the whole point of the count-1 arm is that an old server (and
    // the byte-identity claim) never sees the key at all.
    expect(Object.hasOwn(sent[0], 'count')).toBe(false);
    expect(Object.hasOwn(sent[0], 'commission')).toBe(false);
  });

  it('a batch craft without commission sends recipe plus count only', () => {
    const { client, sent } = captureClient();
    client.craftItem(RECIPE_ID, false, 5);
    expect(sent).toEqual([{ cmd: 'craft_item', recipe: RECIPE_ID, count: 5 }]);
    expect(Object.hasOwn(sent[0], 'commission')).toBe(false);
  });

  it('a commissioned batch craft sends all three keys', () => {
    const { client, sent } = captureClient();
    client.craftItem(RECIPE_ID, true, 5);
    expect(sent).toEqual([{ cmd: 'craft_item', recipe: RECIPE_ID, commission: true, count: 5 }]);
  });

  it('the client floors a fractional count and drops a non-finite one before it can ride', () => {
    // A non-finite count cannot survive JSON (NaN/Infinity serialize to null,
    // which the server reads as "no count" and buys 1), so the client drops it
    // here, the one place it can, and the omitted-key form is what ships.
    const { client, sent } = captureClient();
    client.craftItem(RECIPE_ID, false, 5.9);
    client.craftItem(RECIPE_ID, false, Number.NaN);
    client.craftItem(RECIPE_ID, false, Number.POSITIVE_INFINITY);
    expect(sent).toEqual([
      { cmd: 'craft_item', recipe: RECIPE_ID, count: 5 },
      { cmd: 'craft_item', recipe: RECIPE_ID },
      { cmd: 'craft_item', recipe: RECIPE_ID },
    ]);
    expect(Object.hasOwn(sent[1], 'count')).toBe(false);
    expect(Object.hasOwn(sent[2], 'count')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. The server-side count guard, over the real wire.
// ---------------------------------------------------------------------------
describe('server craft_item count guard over the live wire', () => {
  /** A joined character standing in the field, stocked for `crafts` crafts. */
  function fieldCrafter(
    server: GameServer,
    characterId: number,
    name: string,
    crafts: number,
  ): { session: ClientSession; fc: FakeClient } {
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, name);
    placeAt(server, session.pid, FIELD_POS);
    stockFor(server, session.pid, crafts);
    return { session, fc };
  }

  it('a hostile count that is not a finite number arms a batch of exactly one', () => {
    const server = new GameServer();
    // Every arm is stocked for FOUR crafts and asks for the same recipe, so a
    // batch of 1 can only come from the count guard, never from thin bags.
    const cases: { label: string; count: unknown }[] = [
      { label: 'a numeric string', count: '5' },
      // NaN cannot ride JSON: it serializes to null, which is the value the
      // server's typeof check actually has to refuse.
      { label: 'the null a NaN serializes to', count: Number.NaN },
      { label: 'a negative count', count: -3 },
    ];
    let characterId = 4201;
    for (const { label, count } of cases) {
      const { session } = fieldCrafter(server, characterId++, `Guard${characterId}`, 4);
      const frame = JSON.stringify({
        t: 'cmd',
        cmd: 'craft_item',
        recipe: RECIPE_ID,
        count,
      });
      if (Number.isNaN(count as number)) expect(frame).toContain('"count":null');
      server.handleMessage(session, frame);
      const p = entityOf(server, session.pid);
      expect(p.castingAbility, label).toBe(CRAFT_CAST_ID);
      expect(p.craftCastRecipeId, label).toBe(RECIPE_ID);
      expect(p.craftCastBatchTotal, label).toBe(1);
      expect(p.craftCastBatchRemaining, label).toBe(1);
    }
  });

  it('an enormous count clamps to the mats-fit, while an honest count rides through', () => {
    const server = new GameServer();
    // The positive control first: without it, every "1" above could equally
    // mean the count never reached the sim at all.
    const honest = fieldCrafter(server, 4301, 'HonestBatcher', 4);
    cmd(server, honest.session, { cmd: 'craft_item', recipe: RECIPE_ID, count: 3 });
    const honestP = entityOf(server, honest.session.pid);
    expect(honestP.craftCastBatchTotal).toBe(3);
    expect(honestP.craftCastBatchRemaining).toBe(3);

    // Same stock (four crafts' worth), a count no player could ever mean.
    const greedy = fieldCrafter(server, 4302, 'GreedyBatcher', 4);
    cmd(server, greedy.session, { cmd: 'craft_item', recipe: RECIPE_ID, count: 1e9 });
    const greedyP = entityOf(server, greedy.session.pid);
    expect(greedyP.castingAbility).toBe(CRAFT_CAST_ID);
    expect(greedyP.craftCastBatchTotal).toBe(4);
    expect(greedyP.craftCastBatchRemaining).toBe(4);

    // And the clamp is the BAGS, not a constant: half the stock halves it.
    const thin = fieldCrafter(server, 4303, 'ThinBatcher', 2);
    cmd(server, thin.session, { cmd: 'craft_item', recipe: RECIPE_ID, count: 1e9 });
    expect(entityOf(server, thin.session.pid).craftCastBatchTotal).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C. The self-only `ccast` fragment, server to client and back to null.
// ---------------------------------------------------------------------------
describe('the ccast self fragment round-trips a running batch craft', () => {
  function craftingSession(
    server: GameServer,
    characterId: number,
    name: string,
    crafts: number,
  ): { session: ClientSession; fc: FakeClient } {
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, name);
    placeAt(server, session.pid, FIELD_POS);
    stockFor(server, session.pid, crafts);
    return { session, fc };
  }

  it('carries the clamped batch numbers while the batch runs and counts down per item', () => {
    const server = new GameServer();
    const { session, fc } = craftingSession(server, 4401, 'Batcher', 3);
    const client = bareClient(session.pid);

    // At rest the fragment is an explicit null, not an omitted key: the client
    // decode reads `s.ccast?.r ?? ''`, so a missing key would look identical to
    // "not crafting" and hide a dropped fragment.
    broadcast(server);
    expect(selfAfter(fc).ccast).toBeNull();

    let mark = fc.sent.length;
    cmd(server, session, { cmd: 'craft_item', recipe: RECIPE_ID, count: 3 });
    routeTick(server);
    broadcast(server);
    expect(selfAfter(fc, mark).ccast).toEqual({ r: RECIPE_ID, rem: 3, tot: 3 });

    applySnap(client, snapAfter(fc, mark));
    const mirror = client.entities.get(session.pid);
    if (!mirror) throw new Error('the self entity never reached the client mirror');
    expect(mirror.craftCastRecipeId).toBe(RECIPE_ID);
    expect(mirror.craftCastBatchRemaining).toBe(3);
    expect(mirror.craftCastBatchTotal).toBe(3);

    // One item done: the batch auto-starts the next cast, so the fragment keeps
    // the same recipe and total while only the remaining counter moves.
    mark = fc.sent.length;
    completeCraftCast(server.sim as never, session.pid);
    routeTick(server);
    broadcast(server);
    expect(selfAfter(fc, mark).ccast).toEqual({ r: RECIPE_ID, rem: 2, tot: 3 });
    applySnap(client, snapAfter(fc, mark));
    expect(mirror.craftCastBatchRemaining).toBe(2);
    expect(mirror.craftCastBatchTotal).toBe(3);
  });

  it('goes back to null when the last item of the batch completes on real ticks', () => {
    const server = new GameServer();
    const { session, fc } = craftingSession(server, 4402, 'Finisher', 1);
    const client = bareClient(session.pid);
    const recipe = recipeById(RECIPE_ID);
    if (!recipe) throw new Error(`${RECIPE_ID} is missing from the recipe table`);

    cmd(server, session, { cmd: 'craft_item', recipe: RECIPE_ID });
    const mark = fc.sent.length;
    // A field-band craft cast runs 1.75s, so 40 ticks of the real server loop
    // (2s at 20 Hz) carries it past completion with no hand-driven shortcut.
    for (let i = 0; i < 40; i++) routeTick(server);
    broadcast(server);

    // The craft really happened (an interrupted or never-started cast would
    // also leave ccast null, and would pass a null-only assertion).
    expect(server.sim.countItem(recipe.resultItemId, session.pid)).toBe(recipe.resultCount);
    expect(entityOf(server, session.pid).castingAbility).toBeNull();
    expect(selfAfter(fc, mark).ccast).toBeNull();

    applySnap(client, snapAfter(fc, mark));
    const mirror = client.entities.get(session.pid);
    if (!mirror) throw new Error('the self entity never reached the client mirror');
    expect(mirror.craftCastRecipeId).toBe('');
    expect(mirror.craftCastBatchRemaining).toBe(0);
    expect(mirror.craftCastBatchTotal).toBe(0);
  });

  it('goes back to null when a movement frame cancels the batch mid-cast', () => {
    const server = new GameServer();
    const { session, fc } = craftingSession(server, 4403, 'Walker', 3);
    const client = bareClient(session.pid);

    let mark = fc.sent.length;
    cmd(server, session, { cmd: 'craft_item', recipe: RECIPE_ID, count: 3 });
    routeTick(server);
    broadcast(server);
    expect(selfAfter(fc, mark).ccast).toEqual({ r: RECIPE_ID, rem: 3, tot: 3 });
    applySnap(client, snapAfter(fc, mark));
    const mirror = client.entities.get(session.pid);
    if (!mirror) throw new Error('the self entity never reached the client mirror');
    expect(mirror.craftCastBatchTotal).toBe(3);

    // A real movement frame on the movement lane, not a hand-set cast field.
    mark = fc.sent.length;
    server.handleMessage(session, JSON.stringify({ t: 'input', seq: 1, mi: { f: 1 } }));
    routeTick(server);
    broadcast(server);

    expect(entityOf(server, session.pid).castingAbility).toBeNull();
    expect(selfAfter(fc, mark).ccast).toBeNull();
    applySnap(client, snapAfter(fc, mark));
    expect(mirror.craftCastRecipeId).toBe('');
    expect(mirror.craftCastBatchRemaining).toBe(0);
    expect(mirror.craftCastBatchTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. Craft-from-vault ONLINE (Bank Storage Phase 04): the tick-side halves
// that only exist on the wire: the vaultCraftConsume event -> detectActivity
// -> bank_ledger craft_consume rows, and the cvault self delta converging the
// owner's mirror after a consumption. The offline consumption matrix lives in
// tests/craft_from_vault.test.ts; this block is the server-observation seam.
// ---------------------------------------------------------------------------
describe('craft-from-vault online (Phase 04)', () => {
  it('a vault-backed craft commits ONE craft_consume batch with the cvault character snapshot', async () => {
    await bankLedgerIdle();
    insertLedgerRowsMock.mockClear();
    saveCharacterMock.mockClear();
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinServer(server, fw, 71, 'Vaultcraft');
    const pid = session.pid;
    placeAt(server, pid, FIELD_POS);
    const recipe = recipeById(RECIPE_ID);
    if (!recipe) throw new Error('recipe missing');
    // Premise pin: the arming sword's exact reagent triple; a content retune
    // moves this arm deliberately.
    expect(recipe.reagents).toEqual([
      { itemId: 'wolf_fang', count: 2 },
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'smithing_flux', count: 6 },
    ]);
    // Carried covers everything except ONE wolf_fang; the vault covers it.
    server.sim.addItem('wolf_fang', 1, pid);
    server.sim.addItem('bone_fragments', 4, pid);
    server.sim.addItem('smithing_flux', 6, pid);
    const meta = server.sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 1_000_000;
    meta.vault.upgrades = 1;
    meta.vault.stock = { wolf_fang: 4 };

    cmd(server, session, { cmd: 'craft_item', recipe: RECIPE_ID });
    completeCraftCast(server.sim as never, pid);
    // The real loop shape: drain the tick's events, route them to clients,
    // then run the tick's ONE observer pass (detectActivity) over the same
    // batch. (The craft rows themselves persist through the reservation
    // journal at admission time; the retired recordVaultCraftConsume observer
    // that once fired here is gone.)
    const events = server.sim.tick();
    // biome-ignore lint/suspicious/noExplicitAny: private server-loop methods driven directly
    (server as any).routeEvents(events);
    // biome-ignore lint/suspicious/noExplicitAny: see above
    (server as any).detectActivity(events);

    // The sim consumed carried FIRST (the one carried fang), then the vault.
    expect(meta.vault.stock).toEqual({ wolf_fang: 3 });
    // No row can race ahead of the changed vault blob. One immutable command
    // batch waits in the session journal until the character transaction.
    expect(insertLedgerRowsMock).not.toHaveBeenCalled();
    const staged = session.bankLedgerJournal.outbox.snapshot();
    expect(staged.batches).toHaveLength(1);
    expect(decodedJournalRows(session)).toEqual([
      {
        realm: REALM,
        characterId: 71,
        accountId: session.accountId,
        op: 'craft_consume',
        itemId: 'wolf_fang',
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 1,
        container: 'vault',
        containerId: null,
      },
    ]);
    // Craft completion may also enqueue the deed durability save. Calling the
    // public save seam joins that same character FIFO, so all earlier work has
    // settled when it resolves. Exactly one transaction may claim this prefix.
    await expect(server.saveCharacter(session)).resolves.toBe(true);
    const ledgerSaveCalls = saveCharacterMock.mock.calls.filter((call) => call[5] !== undefined);
    expect(ledgerSaveCalls).toHaveLength(1);
    const saveCall = ledgerSaveCalls[0];
    expect(saveCall[2]).toMatchObject({ vault: { upgrades: 1, stock: { wolf_fang: 3 } } });
    expect(saveCall[5]).toEqual({ owner: staged.owner, batches: staged.batches });
    expect(session.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    // The event is server-side evidence only: no client consumer exists since
    // the reservation journal replaced the observer, so routeEvents DROPS it
    // from the relay (the sim-side emit above stays: it is the conservation
    // sweep's expectation source).
    expect(JSON.stringify(fw.sent)).not.toContain('vaultCraftConsume');

    // The cvault self delta converges the owner's mirror on the next snapshot.
    broadcast(server);
    const snap = snapAfter(fw);
    const client = bareClient(pid);
    applySnap(client, snap);
    expect(client.craftVaultStock).toEqual({ wolf_fang: 3 });
  });

  it('a carried-sufficient craft writes NO ledger row, no event, and leaves the vault byte-identical', async () => {
    await bankLedgerIdle();
    insertLedgerRowsMock.mockClear();
    saveCharacterMock.mockClear();
    const server = new GameServer();
    const fw = fakeWs();
    const session = joinServer(server, fw, 72, 'Bagscraft');
    const pid = session.pid;
    placeAt(server, pid, FIELD_POS);
    stockFor(server, pid, 1);
    const meta = server.sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.vault.upgrades = 1;
    meta.vault.stock = { wolf_fang: 4 };
    const vaultBefore = JSON.stringify(meta.vault);

    cmd(server, session, { cmd: 'craft_item', recipe: RECIPE_ID });
    completeCraftCast(server.sim as never, pid);
    const events = server.sim.tick();
    // biome-ignore lint/suspicious/noExplicitAny: see above
    (server as any).routeEvents(events);
    // biome-ignore lint/suspicious/noExplicitAny: see above
    (server as any).detectActivity(events);

    expect(JSON.stringify(meta.vault)).toBe(vaultBefore);
    expect(insertLedgerRowsMock).not.toHaveBeenCalled();
    expect(session.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    expect(saveCharacterMock).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('vaultCraftConsume');
  });

  it('the real loop wires detectActivity AFTER routeEvents over the same drained batch', () => {
    // The arms above drive routeEvents/detectActivity by hand (the private
    // methods, in that order); this source pin ties the hand-driven shape to
    // the real loop body, so a loop refactor that drops the observer pass or
    // reorders it ahead of routing reds HERE instead of surfacing as silent
    // production audit holes. Comments stripped first (the (^|[^:]) guard
    // keeps protocol :// intact), and the two calls are matched as ADJACENT
    // statements so an intervening early return cannot hide between them.
    const raw = readFileSync(resolve(process.cwd(), 'server/game.ts'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/this\.routeEvents\(events\);\s*this\.detectActivity\(events\);/);
  });
});
