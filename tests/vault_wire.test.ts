import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), so GameServer runs
// with no live DB. Live GameServer commands stage rows in their session-owned
// transactional journal; isolated dispatcher tests below still exercise the
// legacy insert spies explicitly.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => {}),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // join() kicks off a background flair refresh; stubbing it keeps the suite's
  // stderr free of the unmocked-export rejection that noise would otherwise add.
  loadAccountFlair: vi.fn(async () => ({ titleId: null, cosmetics: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import { bankLedgerIdle } from '../server/bank_ledger';
import { VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS } from '../server/bank_vault_ledger_guard';
import { insertBankLedgerRow, insertBankLedgerRows } from '../server/db';
import type { GameServer as GameServerType } from '../server/game';
import { GameServer } from '../server/game';
import {
  gameMetricsCounters,
  noopGameMetricsCounters,
  setGameMetricsCounters,
  type VaultLedgerIncident,
} from '../server/http/game_signals';
import { REALM } from '../server/realm';
import {
  decodeVaultSpecialRef,
  dispatchVaultCommand,
  emitVaultSelfKeys,
  type VaultSim,
} from '../server/vault_wire';
import { recipeById } from '../src/sim/content/recipes';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { Sim } from '../src/sim/sim';
import {
  bareClient,
  broadcast,
  type FakeClient,
  fakeWs,
  joinServer,
  lastSnap,
} from './helpers/bare_client';
import { completeCraftCast } from './helpers/enchant_family_cast';

// The Materials Vault wire round-trip: vault_deposit / vault_withdraw /
// vault_buy_upgrade resolve inside the authoritative Sim, ride the
// proximity-gated OWNER-ONLY `vault` self-delta, and mirror onto
// ClientWorld.vaultInfo. This gate proves the read-boundary criteria the bank
// gate proves for its own delta, plus the two the vault adds: the delta reaches
// NOBODY but its owner, and every successful op leaves a bank_ledger row while
// every refusal leaves none.
//
// Every value asserted is a LITERAL, never a value compared against itself. The
// rung ladder is 20000/50000/100000/200000/400000 copper and the per-material
// ceiling is 40/80/120/160/200 (src/sim/materials_vault.ts VAULT_UPGRADE_PRICES,
// VAULT_BASE_CAP, VAULT_UPGRADE_STEP). These are pinned here as bare numbers on
// purpose. The ONE exception is `realm: REALM` in the ledger-row assertions
// below, which is a self-comparison and is accepted as unmitigable: the realm
// name is read from the environment at import time, so a literal would pin the
// test host's config rather than the writer's behavior. tests/bank_ledger.test.ts
// and the guild-bank suites make the same exception for the same reason; every
// other field on those rows is a literal.

const insertMock = vi.mocked(insertBankLedgerRow);
// Isolated dispatchers without an admission owner write through the legacy
// batched sibling. Live GameServer sessions instead retain one immutable batch
// per command until the character state and rows commit together.
const insertRowsMock = vi.mocked(insertBankLedgerRows);

interface JournalSession {
  bankLedgerJournal: {
    outbox: {
      snapshot(): {
        batches: readonly { rows: readonly Record<string, unknown>[] }[];
      };
    };
  };
}

/** Materialize the journal's canonical serialized row into the public DB-row
 *  shape these behavior pins predate. Null optional counterparty fields are
 *  omitted exactly as they were at the original vault writer. */
function journalLedgerRows(session: JournalSession, fromBatch = 0): Record<string, unknown>[] {
  return session.bankLedgerJournal.outbox
    .snapshot()
    .batches.slice(fromBatch)
    .flatMap((batch) => batch.rows)
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

function journalBatchCount(session: JournalSession): number {
  return session.bankLedgerJournal.outbox.snapshot().batches.length;
}

// The canonical fake-socket family (tests/helpers/bare_client.ts, issue #2088)
// rather than a hand-rolled copy: a new ClientWorld field then lands in one
// place instead of drifting per suite.
function send(server: GameServerType, session: unknown, msg: Record<string, unknown>): void {
  // biome-ignore lint/suspicious/noExplicitAny: ClientSession is opaque to this suite
  server.handleMessage(session as any, JSON.stringify({ t: 'cmd', ...msg }));
}

// Relocate the first banker NPC onto the player (the bank_wire.test.ts idiom):
// nearBanker is a dist2d check, and moving the NPC (which has no wander AI)
// avoids pushing the PLAYER into a collider. Returns the banker entity.
// biome-ignore lint/suspicious/noExplicitAny: the Sim internals this rig reaches for
function bringBankerToPlayer(sim: any, pid: number): any {
  const banker = sim.entities.get(sim.bankerIds[0]);
  const p = sim.entities.get(pid);
  banker.pos = { ...p.pos };
  banker.prevPos = { ...banker.pos };
  return banker;
}

// biome-ignore lint/suspicious/noExplicitAny: see bringBankerToPlayer
function itemIndex(sim: any, pid: number, itemId: string): number {
  return sim.players.get(pid).inventory.findIndex((s: any) => s.itemId === itemId);
}

/** The LAST bag slot holding `itemId`. copper_ore stacks at 20, so a 60-item
 *  grant lands as three slots; the headroom tests need an untouched full stack,
 *  which is never the first index once earlier deposits have eaten into it. */
// biome-ignore lint/suspicious/noExplicitAny: see bringBankerToPlayer
function lastItemIndex(sim: any, pid: number, itemId: string): number {
  const inv = sim.players.get(pid).inventory;
  for (let i = inv.length - 1; i >= 0; i--) if (inv[i].itemId === itemId) return i;
  return -1;
}

/** The TOTAL carried count of `itemId`, summed across every bag slot: a stack
 *  cap means one material can occupy several, and a first-slot read would
 *  under-report the bags exactly where the headroom cases put them. */
// biome-ignore lint/suspicious/noExplicitAny: see bringBankerToPlayer
function bagCount(sim: any, pid: number, itemId: string): number {
  return sim.players
    .get(pid)
    .inventory.filter((s: any) => s.itemId === itemId)
    .reduce((sum: number, s: any) => sum + s.count, 0);
}

/** Every value stored under `key` anywhere inside a decoded wire frame, at any
 *  depth. Used by the owner-only gate: a leak is a leak wherever it lands, so
 *  the scan must not depend on knowing which nesting the encoder chose. */
function valuesUnderKey(value: unknown, key: string, hits: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) valuesUnderKey(entry, key, hits);
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === key) hits.push(v);
      valuesUnderKey(v, key, hits);
    }
  }
  return hits;
}

/** Stand a fresh character at a banker with the given copper and materials. */
function seat(
  server: GameServerType,
  fc: FakeClient,
  characterId: number,
  name: string,
  copper: number,
  items: [string, number][] = [],
) {
  const session = joinServer(server, fc, characterId, name);
  // biome-ignore lint/suspicious/noExplicitAny: see bringBankerToPlayer
  const sim = server.sim as any;
  const pid = session.pid;
  const banker = bringBankerToPlayer(sim, pid);
  const meta = sim.players.get(pid);
  meta.copper = copper;
  for (const [itemId, count] of items) sim.addItem(itemId, count, pid);
  return { session, sim, pid, meta, banker };
}

beforeEach(async () => {
  // The ledger FIFO tail is process-global, so drain anything a prior test
  // queued BEFORE clearing: a clear that raced a pending insert would let a
  // stray row land inside the next test's assertion window.
  await bankLedgerIdle();
  insertMock.mockClear();
  insertRowsMock.mockClear();
});

describe('materials vault wire round-trip', () => {
  it('refuses a multi-material vault craft after the shared account burst without mutation or RNG', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    try {
      const server = new GameServer();
      const fw = fakeWs();
      const { session, sim, pid, meta } = seat(server, fw, 1, 'Craftguard', 777, [
        ['wolf_fang', 1],
      ]);
      meta.vault.upgrades = 1;
      meta.vault.stock = { copper_ore: 4, smithing_flux: 9 };

      // Ten real retained receipts, not malformed/no-op frames: five moves to
      // the personal bank and five moves back consume the account burst.
      for (let index = 0; index < 5; index++) {
        send(server, session, {
          cmd: 'bank_deposit',
          slot: itemIndex(sim, pid, 'wolf_fang'),
        });
        send(server, session, { cmd: 'bank_withdraw', slot: 0 });
      }

      const recipe = recipeById('recipe_eastbrook_chain_vest');
      if (!recipe) throw new Error('fixture recipe missing');
      const before = {
        inventory: structuredClone(meta.inventory),
        vault: structuredClone(meta.vault),
        copper: meta.copper,
        craftSkills: structuredClone(meta.craftSkills),
        equipment: structuredClone(meta.equipment),
      };
      let draws = 0;
      sim.rng.setObserver(() => draws++);
      try {
        expect(resolveCraftForRecipe(sim.ctx, pid, recipe)).toEqual({
          ok: false,
          recipeId: 'recipe_eastbrook_chain_vest',
          reason: 'busy',
        });
      } finally {
        sim.rng.setObserver(null);
      }

      expect(draws).toBe(0);
      expect({
        inventory: meta.inventory,
        vault: meta.vault,
        copper: meta.copper,
        craftSkills: meta.craftSkills,
        equipment: meta.equipment,
      }).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('charges craft vault rows against a later manual vault sweep', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    try {
      const server = new GameServer();
      const fw = fakeWs();
      const { session, sim, pid, meta } = seat(server, fw, 1, 'Craftshares', 777, [
        ['wolf_fang', 1],
        ['iron_ore', 1],
      ]);
      meta.vault.upgrades = 1;
      meta.vault.stock = { copper_ore: 4, smithing_flux: 9 };

      // Eight 1-row manual receipts leave 113 account-row tokens. The craft's
      // two exact vault takes reduce that to 111, one short of a legal sweep's
      // 112-row worst case, while one command token still remains.
      for (let index = 0; index < 4; index++) {
        send(server, session, {
          cmd: 'bank_deposit',
          slot: itemIndex(sim, pid, 'wolf_fang'),
        });
        send(server, session, { cmd: 'bank_withdraw', slot: 0 });
      }
      const recipe = recipeById('recipe_eastbrook_chain_vest');
      if (!recipe) throw new Error('fixture recipe missing');
      expect(resolveCraftForRecipe(sim.ctx, pid, recipe).ok).toBe(true);
      expect(meta.vault.stock).toEqual({});

      const beforeSweep = {
        inventory: structuredClone(meta.inventory),
        vault: structuredClone(meta.vault),
      };
      send(server, session, { cmd: 'vault_deposit_all' });

      expect({ inventory: meta.inventory, vault: meta.vault }).toEqual(beforeSweep);
      expect(sim.events).toContainEqual({
        type: 'error',
        text: 'You are busy.',
        pid,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ACCEPTANCE: near-banker snapshot carries the vault delta and ClientWorld.vaultInfo mirrors it', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultacc', 20000, [['copper_ore', 5]]);

    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 3,
    });

    // The FIRST snapshot this session receives (nothing has broadcast yet), so
    // the delta cannot be riding a later change: it is the near-banker state.
    const snap = lastSnap(fw.sent);
    expect(snap).toBeNull();
    broadcast(server);
    const first = lastSnap(fw.sent);
    expect(first.self.vault).toEqual({
      stock: { copper_ore: 3 },
      special: [],
      upgrades: 1,
      perMaterialCap: 40, // VAULT_BASE_CAP at rung 1
      nextUpgradeCost: 50000, // VAULT_UPGRADE_PRICES[1]
    });
    // The server's own state agrees with what it shipped (2 of the 5 stayed).
    expect(meta.vault.stock).toEqual({ copper_ore: 3 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(2);

    // The exact decoded object the mirror is about to be handed, captured from
    // the frame that gets applied rather than re-read afterwards.
    const wireVault = first.self.vault;
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(first);
    expect(client.vaultInfo).toEqual({
      stock: { copper_ore: 3 },
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    });
    // The PRESENT path is by reference too, the twin of the omission test's
    // `toBe(vaultRef)` below: a mirror that rebuilt the value (`{ ...s.vault }`)
    // would still satisfy the toEqual above while quietly copying every decode,
    // which is what the __proto__ round-trip pin further down depends on NOT
    // happening.
    expect(client.vaultInfo).toBe(wireVault);
  });

  it('round-trips a glyph-bearing material through server, wire mirror, and exact selector', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, pid, meta } = seat(server, fw, 1, 'Vaultglyph', 0);
    meta.vault.upgrades = 1;
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
    });

    send(server, session, {
      cmd: 'vault_deposit',
      slot: meta.inventory.length - 1,
    });
    expect(meta.vault.stock).toEqual({});
    expect(meta.vault.special).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
      },
    ]);

    broadcast(server);
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.vaultInfo?.special).toEqual(meta.vault.special);
    const row = client.vaultInfo?.special[0];
    if (!row) throw new Error('expected mirrored special vault row');
    send(server, session, {
      cmd: 'vault_withdraw',
      itemId: row.itemId,
      special: { index: 0, instance: row.instance },
    });

    expect(meta.vault.special).toEqual([]);
    expect(
      meta.inventory.find(
        (slot: { instance?: { signer?: string } }) => slot.instance?.signer === 'Ada',
      ),
    ).toMatchObject({ itemId: 'copper_ore', count: 1 });
    expect(journalLedgerRows(session).map((row) => [row.op, row.instance])).toEqual([
      [
        'deposit',
        {
          vaultSpecial: 1,
          instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
          craftedRecipeId: null,
        },
      ],
      [
        'withdraw',
        {
          vaultSpecial: 1,
          instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
          craftedRecipeId: null,
        },
      ],
    ]);
  });

  it('a LOCKED vault near a banker encodes non-null with the unlock price and mirrors', () => {
    // The rung-0 shape is what phase 03's unlock-offer UI renders from: a
    // locked vault AT the banker is not the away-null, it is a real object
    // whose cap is 0 and whose nextUpgradeCost is the unlock price. Every
    // other test in this file buys the unlock before its first asserted
    // broadcast, so this is the one place the locked encode is pinned.
    const server = new GameServer();
    const fw = fakeWs();
    const { pid } = seat(server, fw, 1, 'Vaultlocked', 0);

    broadcast(server);
    const first = lastSnap(fw.sent);
    expect(first.self.vault).toEqual({
      stock: {},
      special: [],
      upgrades: 0,
      perMaterialCap: 0, // locked: no capacity before the unlock rung
      nextUpgradeCost: 20000, // VAULT_UPGRADE_PRICES[0], the 2g unlock
    });
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(first);
    expect(client.vaultInfo).toEqual({
      stock: {},
      special: [],
      upgrades: 0,
      perMaterialCap: 0,
      nextUpgradeCost: 20000,
    });
  });

  it('leaving the banker encodes an explicit null and the client mirror clears', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, banker } = seat(server, fw, 1, 'Vaultnull', 20000, [
      ['copper_ore', 5],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 5,
    });

    broadcast(server);
    const near = lastSnap(fw.sent);
    expect(near.self.vault.stock).toEqual({ copper_ore: 5 });
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(near);
    expect(client.vaultInfo).not.toBeNull();

    // Move the only nearby banker 1000 yd away: vaultInfoFor now returns null,
    // so the encoder ships an EXPLICIT null rather than omitting the key.
    const p = sim.entities.get(pid);
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    fw.sent.length = 0;
    broadcast(server);
    const far = lastSnap(fw.sent);
    expect(far.self).toHaveProperty('vault');
    expect(far.self.vault).toBeNull();

    // The explicit null must CLEAR the mirror: a truthy decode guard
    // (`if (s.vault)`) would skip it and leave a stale vault window open after
    // the player walks away, while still passing the omission test below
    // (undefined is falsy too).
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(far);
    expect(client.vaultInfo).toBeNull();
    // The stock itself is untouched by walking away: only the view went away.
    expect(sim.players.get(pid).vault.stock).toEqual({ copper_ore: 5 });
  });

  it('an unchanged vault omits the delta key and the omission does not wipe a populated mirror', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid } = seat(server, fw, 1, 'Vaultomit', 20000, [['copper_ore', 5]]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 4,
    });

    broadcast(server);
    const snap1 = lastSnap(fw.sent);
    expect(snap1.self.vault.stock).toEqual({ copper_ore: 4 });
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(snap1);
    const vaultRef = client.vaultInfo;
    expect(vaultRef?.stock).toEqual({ copper_ore: 4 });

    // A second broadcast with no vault change: the maybe() closure sees
    // byte-identical JSON and omits the key entirely.
    fw.sent.length = 0;
    broadcast(server);
    const snap2 = lastSnap(fw.sent);
    expect(snap2.self).not.toHaveProperty('vault');

    // Applying the delta-less snapshot keeps the prior mirror, BY REFERENCE
    // (the `if (s.vault !== undefined)` guard is never entered).
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(snap2);
    expect(client.vaultInfo).toBe(vaultRef);
    expect(client.vaultInfo?.stock).toEqual({ copper_ore: 4 });
  });

  it('never rebuilds a large unchanged special-item snapshot, while proximity transitions stay immediate', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { sim, pid, meta, banker } = seat(server, fw, 1, 'Vaultlarge', 0);
    meta.vault.upgrades = 1;
    meta.vault.special = Array.from({ length: 2_000 }, (_, index) => ({
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: `row-${index}` },
    }));
    const build = vi.spyOn(server.sim, 'vaultInfoFor');

    broadcast(server);
    expect(lastSnap(fw.sent).self.vault.special).toHaveLength(2_000);
    expect(build).toHaveBeenCalledTimes(1);

    for (let tick = 0; tick < 12; tick++) {
      sim.tick();
      broadcast(server);
    }
    expect(build).toHaveBeenCalledTimes(1);

    const player = sim.entities.get(pid);
    banker.pos = { x: player.pos.x + 1000, y: player.pos.y, z: player.pos.z + 1000 };
    fw.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fw.sent).self.vault).toBeNull();
    expect(build).toHaveBeenCalledTimes(1); // closing needs no deep clone

    banker.pos = { ...player.pos };
    fw.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fw.sent).self.vault.special).toHaveLength(2_000);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("a dormant '__proto__' stock key rides the wire as an OWN key and pollutes no prototype", () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultproto', 20000);
    send(server, session, { cmd: 'vault_buy_upgrade' });

    // A tolerated save can hand the loader any string key, '__proto__' included
    // (sanitizeVaultState never destroys stock), so seed one SERVER-SIDE as a
    // real OWN data property. defineProperty, never `stock.__proto__ = {...}`:
    // the assignment form runs the Object.prototype setter and changes the
    // PROTOTYPE, leaving no own key at all and pinning nothing.
    //
    // Stock values are strictly positive counts at the browser boundary, so
    // the dormant hostile key carries a valid numeric value. An object value
    // is malformed and the strict decoder deliberately drops that snapshot.
    const stock = meta.vault.stock as unknown as Record<string, unknown>;
    Object.defineProperty(stock, '__proto__', {
      value: 3,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    stock.copper_ore = 3;

    broadcast(server);
    const snap = lastSnap(fw.sent);
    // The encoder's boundary clone (`{ ...vault.stock }`) keeps it own: object
    // spread creates data properties, so the key survives to the JSON.
    expect(Object.hasOwn(snap.self.vault.stock, '__proto__')).toBe(true);

    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(snap);
    const mirrored = client.vaultInfo?.stock as unknown as Record<string, unknown>;
    // By-reference decode: the key arrives OWN, with its seeded value, beside
    // the ordinary material. An Object.assign or keyed rebuild in the mirror
    // would run the inherited setter, which defines no own key at all.
    expect(Object.hasOwn(mirrored, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(mirrored, '__proto__')?.value).toBe(3);
    expect(mirrored.copper_ore).toBe(3);
    // And nothing was reparented: the mirrored stock still inherits from
    // Object.prototype, not from the seeded object.
    expect(Object.getPrototypeOf(mirrored)).toBe(Object.prototype);
    // The server's own record is likewise untouched by the round trip.
    expect(Object.getPrototypeOf(sim.players.get(pid).vault.stock)).toBe(Object.prototype);
    // The global canary for the worst shape of the same bug: nothing anywhere
    // in this round trip may have written the seeded key onto Object.prototype
    // itself, which would leak into every plain object in the process.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('each of the three ops resolves over the wire and the mirror reflects it on the next snapshot', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultops', 70000, [
      ['copper_ore', 10],
    ]);
    const client = bareClient(pid);
    const applyLatest = () => {
      fw.sent.length = 0;
      broadcast(server);
      // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
      (client as any).applySnapshot(lastSnap(fw.sent));
      return client.vaultInfo;
    };

    // 1) buy_upgrade (the unlock): 20000 copper, rung 1, ceiling 40.
    send(server, session, { cmd: 'vault_buy_upgrade' });
    expect(meta.copper).toBe(50000);
    expect(applyLatest()).toEqual({
      stock: {},
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    });

    // 2) deposit a partial count (6 of 10): the rest stays in the bags.
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 6,
    });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(4);
    expect(applyLatest()?.stock).toEqual({ copper_ore: 6 });

    // 3) withdraw a partial count (2): vault -> bags, keyed by itemId.
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: 2 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(6);
    expect(applyLatest()?.stock).toEqual({ copper_ore: 4 });

    // 4) the second rung: 50000 copper, ceiling 40 -> 80, next price 100000.
    send(server, session, { cmd: 'vault_buy_upgrade' });
    expect(meta.copper).toBe(0);
    expect(applyLatest()).toEqual({
      stock: { copper_ore: 4 },
      special: [],
      upgrades: 2,
      perMaterialCap: 80, // VAULT_BASE_CAP + VAULT_UPGRADE_STEP
      nextUpgradeCost: 100000, // VAULT_UPGRADE_PRICES[2]
    });
  });

  it('server authority: malformed and out-of-range vault commands change nothing and write no ledger row', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultauth', 20000, [
      ['copper_ore', 5],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 5,
    });
    const journalStart = journalBatchCount(session);

    // The whole persisted vault, byte-for-byte, before the hostile batch.
    const before = JSON.stringify(meta.vault);
    const beforeCopper = meta.copper;
    const beforeBags = JSON.stringify(meta.inventory);

    // Wrong-type and missing slot on deposit.
    send(server, session, { cmd: 'vault_deposit', slot: 'zero', count: 2 });
    send(server, session, { cmd: 'vault_deposit', count: 2 });
    // Negative and past-the-end inventory indexes.
    send(server, session, { cmd: 'vault_deposit', slot: -1 });
    send(server, session, { cmd: 'vault_deposit', slot: 9999 });
    // Fractional index: Number.isInteger refuses it.
    send(server, session, { cmd: 'vault_deposit', slot: 1.5 });
    // Wrong-type, missing, empty, and unknown itemId on withdraw.
    send(server, session, { cmd: 'vault_withdraw', itemId: 3 });
    send(server, session, { cmd: 'vault_withdraw' });
    send(server, session, { cmd: 'vault_withdraw', itemId: '' });
    send(server, session, { cmd: 'vault_withdraw', itemId: 'not_a_real_item_id' });
    // A NEGATIVE count is refused outright, which is all this batch sends. The
    // other over-count shape (asking for more than is stocked) is CLAMPED
    // rather than refused, so it belongs with the successful ops: its Sim-level
    // pin is tests/materials_vault.test.ts "CLAMPS an over-count to the stored
    // amount instead of refusing it", and its wire twin is the over-ask
    // withdraw arm further down this file.
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: -4 });
    // The upgrade with 0 copper left after the unlock: the price is the Sim's
    // table lookup, so an unaffordable rung refunds nothing and grants nothing.
    expect(meta.copper).toBe(0);
    send(server, session, { cmd: 'vault_buy_upgrade' });

    expect(JSON.stringify(meta.vault)).toBe(before);
    expect(meta.copper).toBe(beforeCopper);
    expect(JSON.stringify(meta.inventory)).toBe(beforeBags);

    // And the observer wrote NOTHING: it derives success from the before/after
    // diff, so a refusal is indistinguishable from no command at all. A writer
    // that instead inferred success from "no exception was thrown" would have
    // minted a row for every line above. Both writers are asserted: the
    // batched one the vault observer uses today, AND the legacy single-row
    // one, so a rewire back to per-row writes cannot slip through this arm
    // as silence on the wrong mock.
    expect(journalBatchCount(session)).toBe(journalStart);
    expect(insertRowsMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('pinned deviation: a present non-number count coerces to undefined (whole stack) online; offline Sim refuses NaN, recorded in state.md, phase-01 ruling', async () => {
    // A RECORDED deviation, pinned so neither side can change it silently. The
    // dispatch arm maps `count` through `typeof msg.count === 'number' ? ... :
    // undefined`, so a present-but-not-a-number count (null here, the shape a
    // JSON client most easily sends) reaches the Sim as undefined, and the Sim
    // reads undefined as "the whole stack". The offline path hands the same
    // value straight to vaultDeposit, which takes the OTHER branch: `count ===
    // undefined ? slot.count : Math.floor(count)` floors null to ZERO (not
    // NaN), and `!(want > 0)` refuses. So the same client input deposits the
    // whole stack online and nothing offline. BOTH sides are asserted below.
    // Do not "fix" the dispatch to make this arm red: change the ruling first.
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultnull2', 20000, [
      ['copper_ore', 5],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    const journalStart = journalBatchCount(session);

    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: null,
    });
    // The WHOLE stack moved: 5 stocked, 0 carried, not a refusal and not a
    // partial. A dispatch that passed the raw null through would deposit
    // nothing at all and leave the bags at 5.
    expect(meta.vault.stock).toEqual({ copper_ore: 5 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(0);
    const rows = journalLedgerRows(session, journalStart);
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe('deposit');
    expect(rows[0].count).toBe(5);
    expect(rows[0].container).toBe('vault');

    // The OFFLINE half of the same deviation, so the pin is two-sided: a bare
    // Sim handed the identical null refuses outright. Without this arm the
    // "deviation" is only half recorded, and an offline change that started
    // accepting null would close the gap with nothing going red.
    // biome-ignore lint/suspicious/noExplicitAny: the Sim internals this rig reaches for
    const offline = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as any;
    const offPid = offline.playerId;
    bringBankerToPlayer(offline, offPid);
    offline.addItem('copper_ore', 5, offPid);
    offline.players.get(offPid).copper = 20000;
    offline.vaultBuyUpgrade(offPid);
    offline.vaultDeposit(itemIndex(offline, offPid, 'copper_ore'), null as any, offPid);
    // Nothing moved in EITHER direction: the stock is still empty and the bags
    // still hold all 5 (the exact opposite of the online 5/0 above).
    expect(offline.players.get(offPid).vault.stock).toEqual({});
    expect(bagCount(offline, offPid, 'copper_ore')).toBe(5);
  });

  it('server authority: a vault at the purchase cap buys nothing more', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    // 20000 + 50000 + 100000 + 200000 + 400000 = 770000, the whole ladder,
    // plus 400000 spare so the refusal below cannot be an affordability one.
    const { session, meta } = seat(server, fw, 1, 'Vaultcap', 1170000);
    for (let i = 0; i < 5; i++) send(server, session, { cmd: 'vault_buy_upgrade' });
    expect(meta.vault.upgrades).toBe(5); // VAULT_UPGRADE_PRICES.length
    expect(meta.copper).toBe(400000);
    // Five ops, five immutable command batches of one row each.
    expect(journalBatchCount(session)).toBe(5);
    expect(journalLedgerRows(session)).toHaveLength(5);
    const journalStart = journalBatchCount(session);

    send(server, session, { cmd: 'vault_buy_upgrade' });
    expect(meta.vault.upgrades).toBe(5);
    expect(meta.copper).toBe(400000);
    expect(journalBatchCount(session)).toBe(journalStart);

    // The capped snapshot advertises no next rung at the top ceiling.
    fw.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fw.sent).self.vault).toEqual({
      stock: {},
      special: [],
      upgrades: 5,
      perMaterialCap: 200, // 40 + 40 * 4
      nextUpgradeCost: null,
    });
  });

  it('owner-only: a co-located bystander never receives the owner vault in any frame', () => {
    const server = new GameServer();
    const ownerWs = fakeWs();
    const nosyWs = fakeWs();
    const owner = seat(server, ownerWs, 1, 'Vaultowner', 20000);
    const nosy = joinServer(server, nosyWs, 2, 'Vaultnosy');
    const sim = owner.sim;

    // Precondition, asserted rather than assumed: the bystander really does see
    // the owner's entity, so an empty scan below means the field was withheld
    // and not that the two were simply out of interest range.
    broadcast(server);
    const baseline = lastSnap(nosyWs.sent);
    // biome-ignore lint/suspicious/noExplicitAny: wire entities are untyped JSON
    const ownerEnt = baseline.ents.find((e: any) => e.id === owner.pid);
    expect(ownerEnt).toBeTruthy();

    // From here on, everything the bystander is sent is under scrutiny.
    nosyWs.sent.length = 0;
    sim.addItem('arcanite_bar', 4, owner.pid);
    send(server, owner.session, { cmd: 'vault_buy_upgrade' });
    send(server, owner.session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, owner.pid, 'arcanite_bar'),
      count: 4,
    });
    broadcast(server);
    // Drop the bystander's per-entity version cache before the LAST broadcast,
    // so the owner's entity rides that frame as a FULL payload rather than the
    // bare keep-alive id an unchanged entity earns. The full payload is where a
    // leaked vault field would actually appear, and it is what lets the entity
    // assertion below be unconditional instead of a silent skip.
    nosy.sentEnts.clear();
    broadcast(server);

    expect(sim.players.get(owner.pid).vault.stock).toEqual({ arcanite_bar: 4 });
    expect(nosyWs.sent.length).toBeGreaterThan(0);

    for (const frame of nosyWs.sent) {
      // The bystander's OWN self block legitimately carries its own (empty,
      // locked) vault, so it is lifted out before the leak scan; everything
      // else in the frame, at any depth, must be free of the key.
      const { self: _own, ...rest } = frame as Record<string, unknown>;
      expect(valuesUnderKey(rest, 'vault')).toEqual([]);
      // The deposited material is the watermark: the bystander never held one,
      // so its id must not appear ANYWHERE in the frame, self block included.
      expect(JSON.stringify(frame)).not.toContain('arcanite_bar');
    }

    // And the broadcast entity payload itself carries no vault field at all.
    const lastNosy = lastSnap(nosyWs.sent);
    // biome-ignore lint/suspicious/noExplicitAny: wire entities are untyped JSON
    const ownerEntAfter = lastNosy.ents.find((e: any) => e.id === owner.pid);
    // Unconditional: the baseline above already proved the owner's entity is
    // visible to this bystander, so its absence here is a rig failure that must
    // go red rather than skip the check it guards.
    expect(ownerEntAfter).toBeTruthy();
    expect(ownerEntAfter).not.toHaveProperty('vault');

    // The scan is DECISIVE, not vacuously empty: the identical scan run over
    // the OWNER's frames finds both the key and the watermark. Without this the
    // loop above would still pass against a build that shipped no vault at all.
    expect(valuesUnderKey(ownerWs.sent, 'vault').length).toBeGreaterThan(0);
    expect(JSON.stringify(ownerWs.sent)).toContain('arcanite_bar');
    // Two distinct sessions, so "the bystander" is not secretly the owner.
    expect(nosy.pid).not.toBe(owner.pid);
  });

  it('spectate: a moderator watching the owner reads the OWNER vault in its OWN self block', () => {
    const server = new GameServer();
    const ownerWs = fakeWs();
    const modWs = fakeWs();
    const owner = seat(server, ownerWs, 1, 'Vaultwatched', 20000, [['copper_ore', 5]]);
    const moderator = joinServer(server, modWs, 2, 'Vaultmod');
    send(server, owner.session, { cmd: 'vault_buy_upgrade' });
    send(server, owner.session, {
      cmd: 'vault_deposit',
      slot: itemIndex(owner.sim, owner.pid, 'copper_ore'),
      count: 3,
    });

    // Spectating anchors the WHOLE proximity section (bank, vault, guildBank)
    // on the observed player, and it parks the moderator's own body in limbo
    // far from every banker: read against the moderator's own pid the vault
    // would be null, so the values below can only have come from the anchor.
    // biome-ignore lint/suspicious/noExplicitAny: enterSpectate is a private server method
    (server as any).enterSpectate(moderator, owner.session);
    modWs.sent.length = 0;
    broadcast(server);

    const modSnap = lastSnap(modWs.sent);
    expect(modSnap.self.vault).toEqual({
      stock: { copper_ore: 3 },
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    });
    // The bank-family posture, pinned: this is the moderator's OWN self block
    // carrying somebody else's private store, so a future change to
    // anchorSession semantics (in either direction) trips here. Read against
    // the moderator's OWN pid the same call returns null (limbo is nowhere near
    // a banker), so the frame above cannot have come from the viewer.
    expect(server.sim.vaultInfoFor(moderator.pid)).toBeNull();

    // The entity-payload scan, with its scope stated exactly rather than
    // implied: spectate anchors the interest query on the OWNER, and the
    // broadcast skips the anchor's own entity (`if (e.id === anchorEntity.id)
    // continue` in server/game.ts), so the owner's payload is NOT in this
    // frame's ents at all. What this loop covers is the AMBIENT entities around
    // the owner: none of them picked up a vault key from the anchored read.
    // The claim "the owner's own entity payload carries no vault" belongs to
    // the co-located-bystander test above, which scans a frame the owner's
    // entity is actually in.
    const modEnts = lastSnap(modWs.sent).ents;
    // Non-vacuous: there really are ambient entities to scan.
    expect(modEnts.length).toBeGreaterThan(0);
    for (const frame of modWs.sent) {
      const { self: _own, ...rest } = frame as Record<string, unknown>;
      expect(valuesUnderKey(rest, 'vault')).toEqual([]);
    }
    expect(moderator.pid).not.toBe(owner.pid);
  });

  it('spectate retarget re-ships vault and cvault even when both targets have the same revision', () => {
    const server = new GameServer();
    const modWs = fakeWs();
    const aWs = fakeWs();
    const bWs = fakeWs();
    const moderator = joinServer(server, modWs, 5, 'Vaultswitcher');
    const a = seat(server, aWs, 6, 'Vaultalpha', 0);
    const b = seat(server, bWs, 7, 'Vaultbeta', 0);
    a.meta.vault = { stock: { copper_ore: 2 }, special: [], upgrades: 1 };
    b.meta.vault = { stock: { iron_ore: 3 }, special: [], upgrades: 1 };
    expect(a.meta.vaultWireRev).toBe(0);
    expect(b.meta.vaultWireRev).toBe(0);

    // biome-ignore lint/suspicious/noExplicitAny: spectate entry is private by design
    (server as any).enterSpectate(moderator, a.session);
    broadcast(server);
    expect(lastSnap(modWs.sent).self.vault.stock).toEqual({ copper_ore: 2 });
    expect(lastSnap(modWs.sent).self.cvault).toEqual({ copper_ore: 2 });

    // No tick and no revision change. The anchor reset's empty lastSent is the
    // only signal that can force equal-revision target B through both gates.
    // biome-ignore lint/suspicious/noExplicitAny: spectate entry is private by design
    (server as any).enterSpectate(moderator, b.session);
    modWs.sent.length = 0;
    broadcast(server);
    expect(lastSnap(modWs.sent).self.vault.stock).toEqual({ iron_ore: 3 });
    expect(lastSnap(modWs.sent).self.cvault).toEqual({ iron_ore: 3 });
  });

  it('a linkdead resume re-ships unchanged vault keys immediately on the fresh socket', () => {
    const server = new GameServer();
    const firstWs = fakeWs();
    const { session, meta } = seat(server, firstWs, 8, 'Vaultresume', 0);
    meta.vault = { stock: { copper_ore: 4 }, special: [], upgrades: 1 };
    broadcast(server);
    expect(lastSnap(firstWs.sent).self.vault.stock).toEqual({ copper_ore: 4 });
    expect(lastSnap(firstWs.sent).self.cvault).toEqual({ copper_ore: 4 });

    firstWs.ws.readyState = 3;
    expect(server.socketClosed(session, firstWs.ws)).toBe(true);
    const resumedWs = fakeWs();
    const resumed = server.join(resumedWs.ws, 8, 8, 'Vaultresume', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session);

    // Same tick, same revisions, and the cadence marker still consumed. The
    // empty lastSent created by resumeSession must nevertheless force both.
    broadcast(server);
    expect(lastSnap(resumedWs.sent).self.vault.stock).toEqual({ copper_ore: 4 });
    expect(lastSnap(resumedWs.sent).self.cvault).toEqual({ copper_ore: 4 });
  });

  it('ledger rows: each successful op writes one container=vault row with the right fields', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid } = seat(server, fw, 71, 'Vaultledger', 70000, [['copper_ore', 10]]);

    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 6,
    });
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: 2 });
    send(server, session, { cmd: 'vault_buy_upgrade' });
    // Four ops, four batches, in the order they happened. The character-owned
    // journal preserves both command and within-command row order until save.
    expect(journalBatchCount(session)).toBe(4);
    const rows = journalLedgerRows(session);
    expect(rows.map((r) => r.op)).toEqual(['buy_slots', 'deposit', 'withdraw', 'buy_slots']);

    // The unlock: negated rung-0 price, no item fields, ladder position 1.
    expect(rows[0]).toEqual({
      realm: REALM,
      characterId: 71,
      accountId: 71,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -20000,
      purchasedSlotsAfter: 1,
      container: 'vault',
      containerId: null,
    });
    // The deposit records the MOVED count (6), never the resulting stock, and
    // carries a null instance: vault storage has no per-instance dimension.
    expect(rows[1]).toEqual({
      realm: REALM,
      characterId: 71,
      accountId: 71,
      op: 'deposit',
      itemId: 'copper_ore',
      count: 6,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: 1,
      container: 'vault',
      containerId: null,
    });
    // The withdraw records what LEFT (2), positive, with no copper.
    expect(rows[2]).toEqual({
      realm: REALM,
      characterId: 71,
      accountId: 71,
      op: 'withdraw',
      itemId: 'copper_ore',
      count: 2,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: 1,
      container: 'vault',
      containerId: null,
    });
    // The second rung is priced from the BEFORE snapshot (50000), not the new
    // next price (100000), and the ladder position climbs to 2.
    expect(rows[3]).toEqual({
      realm: REALM,
      characterId: 71,
      accountId: 71,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -50000,
      purchasedSlotsAfter: 2,
      container: 'vault',
      containerId: null,
    });
  });

  it('ledger rows: the two id columns come from the SESSION, not one id used twice', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    // joinServer() seats accountId === characterId, so every other row in this
    // file carries the same number in both columns and a SWAPPED mapping would
    // read identical. This arm goes to GameServer.join directly (its own
    // signature is (ws, accountId, characterId, ...)) for one session whose two
    // ids differ, which is the only shape that can catch the swap.
    const session = server.join(fw.ws, 907, 88, 'Vaultids', 'warrior', null, false, {});
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    // biome-ignore lint/suspicious/noExplicitAny: see bringBankerToPlayer
    const sim = server.sim as any;
    const pid = session.pid;
    bringBankerToPlayer(sim, pid);
    sim.players.get(pid).copper = 20000;
    sim.addItem('copper_ore', 3, pid);

    send(server, session, { cmd: 'vault_buy_upgrade' });
    const journalStart = journalBatchCount(session);
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 3,
    });
    const rows = journalLedgerRows(session, journalStart);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      realm: REALM,
      characterId: 88,
      accountId: 907,
      op: 'deposit',
      itemId: 'copper_ore',
      count: 3,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: 1,
      container: 'vault',
      containerId: null,
    });
  });

  it('ledger rows: an op refused AT the banker (a full vault) writes nothing', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    // Rung 1 holds 40 per material; 60 in the bags (three 20-stacks) cannot all
    // fit, so the run walks the vault up to its ceiling and then past it.
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultfull', 20000, [
      ['copper_ore', 60],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    // Fill to 35 of the 40 ceiling out of the FIRST stack, leaving 5 headroom.
    send(server, session, { cmd: 'vault_deposit', slot: itemIndex(sim, pid, 'copper_ore') });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 15,
    });
    expect(meta.vault.stock).toEqual({ copper_ore: 35 });
    let journalStart = journalBatchCount(session);

    // A whole untouched 20-stack against 5 headroom: the vault's PARTIAL fill
    // moves 5 and leaves 15 in the bags, and the row must record what actually
    // MOVED (5), never what was asked for (20). Recording the request is the
    // shape that makes an audit read a phantom 15 into the vault.
    send(server, session, { cmd: 'vault_deposit', slot: lastItemIndex(sim, pid, 'copper_ore') });
    expect(meta.vault.stock).toEqual({ copper_ore: 40 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(20); // 5 left in slot 0 + 15 left in the last
    const partial = journalLedgerRows(session, journalStart);
    expect(partial).toHaveLength(1);
    expect(partial[0].op).toBe('deposit');
    expect(partial[0].count).toBe(5);
    expect(partial[0].container).toBe('vault');
    journalStart = journalBatchCount(session);

    // Now the vault is full: the op is refused at the banker, so both snapshots
    // are non-null and IDENTICAL, and the differ writes no row.
    send(server, session, { cmd: 'vault_deposit', slot: itemIndex(sim, pid, 'copper_ore') });
    expect(meta.vault.stock).toEqual({ copper_ore: 40 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(20);
    expect(journalBatchCount(session)).toBe(journalStart);
  });

  it('ledger rows: an over-ask withdraw records what actually LEFT, never the requested count', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultover', 20000, [
      ['copper_ore', 10],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 6,
    });
    expect(meta.vault.stock).toEqual({ copper_ore: 6 });
    const journalStart = journalBatchCount(session);

    // The withdraw twin of the partial-deposit arm above: an ask far past the
    // stock is CLAMPED by the Sim (a withdraw names an id whose count the
    // client only knew a snapshot ago), so 6 leave and the row must record the
    // 6, never the 999 that was asked for. Recording the request is the shape
    // that makes an audit read a phantom 993 out of the vault.
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: 999 });
    expect(meta.vault.stock).toEqual({}); // fully drained: the key is DELETED
    expect(bagCount(sim, pid, 'copper_ore')).toBe(10);
    const rows = journalLedgerRows(session, journalStart);
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe('withdraw');
    expect(rows[0].count).toBe(6);
    expect(rows[0].container).toBe('vault');
  });

  it('vault_deposit_all: one wire command sweeps the bags and writes ONE batched insert', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    // Two eligible materials in different states (iron_ore whole, copper_ore
    // partly pre-stocked) plus untouchable gear: the partial-batch shape the
    // sweep exists for. 20000 buys exactly the unlock.
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultsweep', 20000, [
      ['copper_ore', 30],
      ['iron_ore', 4],
      ['rusty_dagger', 1],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 20,
    });
    expect(meta.vault.stock).toEqual({ copper_ore: 20 });
    const journalStart = journalBatchCount(session);

    send(server, session, { cmd: 'vault_deposit_all' });
    await bankLedgerIdle();

    // The sweep: 20 copper_ore are stocked so headroom is 20 and the carried
    // 10 all move; iron_ore moves whole; the dagger stays. Exact final state,
    // then the ledger.
    expect(meta.vault.stock).toEqual({ copper_ore: 30, iron_ore: 4 });
    expect(bagCount(sim, pid, 'copper_ore')).toBe(0);
    expect(bagCount(sim, pid, 'iron_ore')).toBe(0);
    expect(bagCount(sim, pid, 'rusty_dagger')).toBe(1);

    // ONE immutable command batch for the whole sweep (never one write per
    // material), rows in the differ's sorted key order, each recording what
    // MOVED. The later save emits this batch transactionally.
    expect(journalBatchCount(session)).toBe(journalStart + 1);
    const batch = journalLedgerRows(session, journalStart);
    expect(batch.map((r) => [r.op, r.itemId, r.count])).toEqual([
      ['deposit', 'copper_ore', 10],
      ['deposit', 'iron_ore', 4],
    ]);
    expect(batch.every((r) => r.container === 'vault' && r.containerId === null)).toBe(true);

    // The mirror reflects the swept vault on the next snapshot.
    const client = bareClient(pid);
    fw.sent.length = 0;
    broadcast(server);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.vaultInfo?.stock).toEqual({ copper_ore: 30, iron_ore: 4 });
  });

  it('vault_deposit_all: byte-identical plain material stacks collapse in the batch', async () => {
    // Plain slots key on material id and null identity, so equal stacks still
    // collapse. Identity-bearing slots have a distinct 112-slot bound, pinned
    // by the next regression rather than incorrectly using material-id count.
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultbound', 20000, [
      ['copper_ore', 20], // two SLOTS of one material (stackSize 20)...
      ['copper_ore', 15],
      ['iron_ore', 3],
    ]);
    expect(
      sim.players.get(pid).inventory.filter((s: { itemId: string }) => s.itemId === 'copper_ore'),
    ).toHaveLength(2);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    const journalStart = journalBatchCount(session);
    send(server, session, { cmd: 'vault_deposit_all' });
    expect(meta.vault.stock).toEqual({ copper_ore: 35, iron_ore: 3 });
    expect(journalBatchCount(session)).toBe(journalStart + 1);
    const batch = journalLedgerRows(session, journalStart);
    // ...but ONE ledger row: three slots moved, two rows land. The row ORDER
    // here comes from diffVaultOp's SORTED key union, not stock insertion
    // order (the descending sweep actually stocks iron_ore first), so this
    // literal is deterministic by design, not by accident.
    expect(batch.map((r) => [r.itemId, r.count])).toEqual([
      ['copper_ore', 35],
      ['iron_ore', 3],
    ]);
    expect(batch).toHaveLength(2);
  });

  it.each([56, 112])(
    'vault_deposit_all: admits %i distinct signed identities in one batch',
    (identityCount) => {
      expect(VAULT_DEPOSIT_ALL_LEDGER_MAX_ROWS).toBe(112);
      const server = new GameServer();
      const fw = fakeWs();
      const { session, sim, meta } = seat(server, fw, 1, 'Vaultsigners', 0);
      meta.vault.upgrades = 5;
      meta.inventory.push(
        ...Array.from({ length: identityCount }, (_, index) => ({
          itemId: 'pristine_hide',
          count: 1,
          instance: { signer: `Crafter ${index}` },
        })),
      );
      const journalStart = journalBatchCount(session);
      const eventStart = sim.events.length;

      send(server, session, { cmd: 'vault_deposit_all' });

      expect(
        meta.inventory.filter((slot: { itemId: string }) => slot.itemId === 'pristine_hide'),
      ).toEqual([]);
      expect(meta.vault.special).toHaveLength(identityCount);
      expect(journalBatchCount(session)).toBe(journalStart + 1);
      const batch = journalLedgerRows(session, journalStart);
      expect(batch).toHaveLength(identityCount);
      expect(new Set(batch.map((ledgerRow) => JSON.stringify(ledgerRow.instance))).size).toBe(
        identityCount,
      );
      expect(session.escrowQuarantined).toBe(false);
      expect(sim.events.slice(eventStart)).not.toContainEqual({
        type: 'error',
        text: 'You are busy.',
        pid: session.pid,
      });
    },
  );

  it('realm-budget exhaustion admits the third account and counts a breach; the account bucket still refuses', () => {
    // PR #3670: the realm row bucket is TELEMETRY ONLY (two accounts at their
    // own ceilings drain it, so refusing on it turned ordinary co-play into a
    // realm-wide 'You are busy.'). The database-wide growth ceiling is the
    // authoritative aggregate bound; the per-account bucket keeps refusing.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    const dropped = vi.spyOn(gameMetricsCounters(), 'wsMessageDropped');
    try {
      const server = new GameServer();
      const players = [
        seat(server, fakeWs(), 1, 'Realmsweepone', 0),
        seat(server, fakeWs(), 2, 'Realmsweeptwo', 0),
        seat(server, fakeWs(), 3, 'Realmsweepthree', 0),
      ];
      for (const [playerIndex, player] of players.entries()) {
        player.meta.vault.upgrades = 5;
        player.meta.inventory.push(
          ...Array.from({ length: 112 }, (_, signerIndex) => ({
            itemId: 'pristine_hide',
            count: 1,
            instance: { signer: `Account ${playerIndex} Crafter ${signerIndex}` },
          })),
        );
      }

      for (const player of players.slice(0, 2)) {
        send(server, player.session, { cmd: 'vault_deposit_all' });
        expect(player.meta.vault.special).toHaveLength(112);
        expect(journalLedgerRows(player.session)).toHaveLength(112);
      }

      // The THIRD legitimate account's sweep lands past the realm burst: it
      // ADMITS, its rows commit, no drop is counted, and the breach counter
      // records the admission the old refusing guard would have dropped.
      const third = players[2];
      send(server, third.session, { cmd: 'vault_deposit_all' });
      expect(third.meta.vault.special).toHaveLength(112);
      expect(journalLedgerRows(third.session)).toHaveLength(112);
      expect(dropped).not.toHaveBeenCalledWith('bank_vault');
      // biome-ignore lint/suspicious/noExplicitAny: private coordinator probe
      const snapshot = (server as any).bankVaultLedgerGuardCoordinator.snapshot();
      expect(snapshot.realmRowBreaches).toBe(1);
      expect(snapshot.realmRowTokens).toBeLessThan(0); // overload depth gauge

      // The ACCOUNT bucket is untouched by the conversion: the same account
      // sweeping again inside the second is out of account rows and refuses
      // before the sim runs, which is what reaches the drop counter.
      const beforeRefusal = structuredClone(third.meta.inventory);
      send(server, third.session, { cmd: 'vault_deposit_all' });
      expect(third.meta.inventory).toEqual(beforeRefusal);
      expect(third.meta.vault.special).toHaveLength(112);
      expect(dropped).toHaveBeenCalledWith('bank_vault');
      // An account refusal never reaches the realm bucket: still one breach.
      // biome-ignore lint/suspicious/noExplicitAny: private coordinator probe
      expect((server as any).bankVaultLedgerGuardCoordinator.snapshot().realmRowBreaches).toBe(1);
    } finally {
      dropped.mockRestore();
      vi.useRealTimers();
    }
  });

  it('vault_deposit_all: a refused sweep (locked, then away) moves nothing and writes nothing', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta, banker } = seat(server, fw, 1, 'Vaultsweepno', 0, [
      ['copper_ore', 5],
    ]);
    // Locked (rung 0): the sweep refuses before touching any slot.
    send(server, session, { cmd: 'vault_deposit_all' });
    expect(meta.vault.stock).toEqual({});
    expect(bagCount(sim, pid, 'copper_ore')).toBe(5);
    expect(journalBatchCount(session)).toBe(0);

    // Away from every banker: both snapshots null, the differ writes nothing.
    meta.copper = 20000;
    send(server, session, { cmd: 'vault_buy_upgrade' });
    const journalStart = journalBatchCount(session);
    const p = sim.entities.get(pid);
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    send(server, session, { cmd: 'vault_deposit_all' });
    expect(meta.vault.stock).toEqual({});
    expect(bagCount(sim, pid, 'copper_ore')).toBe(5);
    expect(journalBatchCount(session)).toBe(journalStart);
  });

  it('ledger rows: an op away from every banker writes nothing (a null snapshot on both sides)', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid, meta, banker } = seat(server, fw, 1, 'Vaultaway', 20000, [
      ['copper_ore', 5],
    ]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    const journalStart = journalBatchCount(session);

    const p = sim.entities.get(pid);
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    send(server, session, { cmd: 'vault_deposit', slot: itemIndex(sim, pid, 'copper_ore') });
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore' });
    send(server, session, { cmd: 'vault_buy_upgrade' });
    expect(meta.vault.stock).toEqual({});
    expect(meta.vault.upgrades).toBe(1);
    expect(journalBatchCount(session)).toBe(journalStart);
  });

  it('ledger rows: a rejected live projection quarantines and counts a vault incident', () => {
    // The transactional writer does not discover a missing row after an async
    // insert: it must stage exact evidence synchronously or prevent the mutated
    // character from ever saving. Force that accounting failure on a real wire
    // command and pin both halves of the fail-closed contract.
    const kinds: VaultLedgerIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => kinds.push(kind),
    });
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    // try/finally: a failing expect below must not leave this process-wide sink
    // (or the swallowed console.error) installed for the rest of the file.
    try {
      const server = new GameServer();
      const fw = fakeWs();
      const { session, sim, pid, meta } = seat(server, fw, 1, 'Vaultmetric', 20000, [
        ['copper_ore', 5],
      ]);
      send(server, session, { cmd: 'vault_buy_upgrade' });
      expect(kinds).toEqual([]); // the unlock landed: a healthy write counts nothing

      vi.spyOn(session.bankLedgerJournal.outbox, 'commit').mockImplementationOnce(() => {
        throw new Error('vault ledger projection failed');
      });
      send(server, session, {
        cmd: 'vault_deposit',
        slot: itemIndex(sim, pid, 'copper_ore'),
        count: 3,
      });

      // The Sim mutation happened, but it can never become durable without its
      // row: the session is synchronously quarantined before the kick microtask.
      expect(meta.vault.stock).toEqual({ copper_ore: 3 });
      expect(session.escrowQuarantined).toBe(true);
      expect(kinds).toEqual(['ledger_write_failed']);
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
    }
  });

  it('offline Sim and the wire path reach identical vault state for one action script', () => {
    // The shared script: 70000 copper + 10 copper_ore, unlock, deposit 6,
    // withdraw 2, buy the second rung, then gain 3 rough_hide and SWEEP
    // (vault_deposit_all rides the same equivalence script as the trio: if a
    // later phase gives the sweep a payload normalized only in the dispatch,
    // the two hosts diverge HERE). End state: 10 copper + 3 hide stocked,
    // rung 2, ceiling 80, next price 100000, 0 copper, empty bags arm.
    // biome-ignore lint/suspicious/noExplicitAny: the Sim internals this rig reaches for
    const offline = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as any;
    const offPid = offline.playerId;
    bringBankerToPlayer(offline, offPid);
    offline.addItem('copper_ore', 10, offPid);
    offline.players.get(offPid).copper = 70000;
    offline.vaultBuyUpgrade(offPid);
    offline.vaultDeposit(itemIndex(offline, offPid, 'copper_ore'), 6, offPid);
    offline.vaultWithdraw('copper_ore', 2, offPid);
    offline.vaultBuyUpgrade(offPid);
    offline.addItem('rough_hide', 3, offPid);
    offline.vaultDepositAll(offPid);
    const offInfo = offline.vaultInfoFor(offPid);

    const server = new GameServer();
    const fw = fakeWs();
    const { session, sim, pid } = seat(server, fw, 1, 'Vaultpar', 70000, [['copper_ore', 10]]);
    send(server, session, { cmd: 'vault_buy_upgrade' });
    send(server, session, {
      cmd: 'vault_deposit',
      slot: itemIndex(sim, pid, 'copper_ore'),
      count: 6,
    });
    send(server, session, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: 2 });
    send(server, session, { cmd: 'vault_buy_upgrade' });
    sim.addItem('rough_hide', 3, pid);
    send(server, session, { cmd: 'vault_deposit_all' });
    const onInfo = sim.vaultInfoFor(pid);

    // Both paths land the same literal outcome...
    expect(offInfo).toEqual({
      stock: { copper_ore: 10, rough_hide: 3 },
      special: [],
      upgrades: 2,
      perMaterialCap: 80,
      nextUpgradeCost: 100000,
    });
    expect(offline.players.get(offPid).copper).toBe(0);
    // ...and they equal each other (offline Sim == authoritative server Sim).
    expect(onInfo).toEqual(offInfo);
    expect(sim.players.get(pid).copper).toBe(0);

    // The wire mirror agrees with both, closing the loop offline -> server ->
    // client: a client-side decode that dropped a field would red here while
    // every server-side pin above stayed green.
    fw.sent.length = 0;
    broadcast(server);
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.vaultInfo).toEqual(offInfo);

    // THE CRAFT LEG (Phase 04, the packet's online/offline scripted-sequence
    // criterion): one wolf_fang short in the bags, the vault covering it, on
    // BOTH hosts. Compared on the rng-free outcomes only (vault stock, bag
    // counts by id, copper): the two hosts run different rng streams, so a
    // masterwork proc may differ, but consumption and sourcing may not.
    for (const [simAny, thePid] of [
      [offline, offPid],
      [sim, pid],
    ] as const) {
      simAny.addItem('wolf_fang', 1, thePid);
      simAny.addItem('bone_fragments', 4, thePid);
      simAny.addItem('smithing_flux', 6, thePid);
      simAny.players.get(thePid).vault.stock.wolf_fang = 4;
      simAny.craftItem('recipe_eastbrook_arming_sword', false, thePid, 1);
      completeCraftCast(simAny as never, thePid);
    }
    const craftOutcome = (simAny: unknown, thePid: number) => {
      const meta = (
        simAny as {
          players: Map<
            number,
            { vault: { stock: unknown }; copper: number; equipment: Record<string, string> }
          >;
        }
      ).players.get(thePid);
      return {
        vault: meta?.vault.stock,
        fang: bagCount(simAny, thePid, 'wolf_fang'),
        bone: bagCount(simAny, thePid, 'bone_fragments'),
        flux: bagCount(simAny, thePid, 'smithing_flux'),
        // Both fixture Sims run autoEquip, so the crafted weapon can land in
        // the bags OR straight onto the paperdoll; count it wherever it sits.
        sword:
          bagCount(simAny, thePid, 'eastbrook_arming_sword') +
          Object.values(meta?.equipment ?? {}).filter((id) => id === 'eastbrook_arming_sword')
            .length,
        copper: meta?.copper,
      };
    };
    const offCraft = craftOutcome(offline, offPid);
    // The literal outcome first (carried fang spent before ONE vault unit)...
    expect(offCraft).toEqual({
      vault: { copper_ore: 10, rough_hide: 3, wolf_fang: 3 },
      fang: 0,
      bone: 0,
      flux: 0,
      sword: 1,
      copper: 0,
    });
    // ...and host equality on the same script.
    expect(craftOutcome(sim, pid)).toEqual(offCraft);
  });
});

// ---------------------------------------------------------------------------
// The craft-from-vault stock delta (Bank Storage Phase 04): `cvault` rides the
// self block beside `vault`, but gated on the craft-draw context predicate
// (src/sim/vault_craft_gate.ts) instead of banker proximity. These are the
// decisive decode pins the dirtyEveryDeltaField harness cannot carry (its
// player holds a live delve run, so the gate is closed there by construction).
//
// cvault is SIGNATURE-GATED on (vaultWireRevFor, craftVaultDrawBlockedFor):
// a live vault mutation bumps the rev and ships the new count on the next
// snapshot, a gate flip ships the explicit null (or the restored rows) on the
// next snapshot, and an unchanged pair omits the key entirely, so the
// crafting window never offers already-spent stock and an idle session never
// pays a projection rebuild.
// ---------------------------------------------------------------------------

describe('craft-from-vault stock delta (cvault)', () => {
  it('a successful vault mutation ships the new count next snapshot, then unchanged frames elide', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { sim, pid, meta } = seat(server, fw, 60, 'Cvaultcadence', 0, [['copper_ore', 5]]);
    meta.vault.upgrades = 1;
    meta.vault.stock = { copper_ore: 4 };

    broadcast(server);
    expect(lastSnap(fw.sent).self.cvault).toEqual({ copper_ore: 4 });

    // Same tick. The real deposit bumps the raw revision and must ship the
    // new count immediately.
    sim.vaultDeposit(itemIndex(sim, pid, 'copper_ore'), 5, pid);
    fw.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fw.sent).self.cvault).toEqual({ copper_ore: 9 });

    // With the revision consumed, another same-tick pass stays cheap.
    fw.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fw.sent).self).not.toHaveProperty('cvault');
  });

  it('an open-world snapshot carries the DRAWABLE rows and the mirror adopts by reference', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { sim, pid, meta } = seat(server, fw, 61, 'Cvaultone', 0);
    meta.vault.upgrades = 1;
    // One drawable row among four corrupt shapes: the wire payload must be
    // the drawable-only filter's output, never the raw record (corrupt rows
    // stay dormant server-side, invisible client-side).
    meta.vault.stock = {
      copper_ore: 4,
      tin_ore: 2.5,
      iron_ore: -3,
      silver_ore: Number.NaN,
      rough_hide: Number.MAX_SAFE_INTEGER + 2,
    };

    broadcast(server);
    const first = lastSnap(fw.sent);
    expect(first.self.cvault).toEqual({ copper_ore: 4 });

    const wireStock = first.self.cvault;
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(first);
    // Adopted BY REFERENCE (the vault mirror rule): never a keyed rebuild.
    expect(client.craftVaultStock).toBe(wireStock);
    expect(client.craftVaultStock).toEqual({ copper_ore: 4 });

    // Unchanged stock on the next snapshot omits the key and the mirror
    // keeps the SAME instance (omission means unchanged, never "no vault"):
    // the (rev, gate) signature did not move, so the projection is elided.
    sim.tick();
    fw.sent.length = 0;
    broadcast(server);
    const second = lastSnap(fw.sent);
    expect(second.self).not.toHaveProperty('cvault');
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(second);
    expect(client.craftVaultStock).toBe(wireStock);

    // The clone boundary: mutating the shipped record never reaches the sim.
    (wireStock as Record<string, number>).copper_ore = 999;
    expect(meta.vault.stock.copper_ore).toBe(4);
  });

  it('keeps every server-valid row past 256 keys through the snapshot decoder', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { pid, meta } = seat(server, fw, 64, 'Cvaultwide', 0);
    meta.vault.upgrades = 1;
    meta.vault.stock = Object.fromEntries([
      ...Array.from({ length: 300 }, (_, index) => [`future_material_${index}`, index + 1]),
      ['x'.repeat(512), 1],
      ['__proto__', 2],
    ]);

    broadcast(server);
    const snap = lastSnap(fw.sent);
    const wireStock = snap.self.cvault as Record<string, number>;
    expect(Object.keys(wireStock)).toHaveLength(302);
    expect(wireStock.future_material_299).toBe(300);
    expect(wireStock['x'.repeat(512)]).toBe(1);
    expect(Object.getOwnPropertyDescriptor(wireStock, '__proto__')?.value).toBe(2);

    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(snap);
    expect(client.craftVaultStock).toBe(wireStock);
    expect(Object.keys(client.craftVaultStock ?? {})).toHaveLength(302);
  });

  it("a DRAWABLE own '__proto__' row rides the cvault key end to end as data", () => {
    // The op ruling calls cvault '__proto__-safe end to end'; this arm pins
    // it on the wire, not just at the clone (the clone-side pin lives in
    // tests/vault_craft_gate.test.ts). Unlike the vault key's pollution arm
    // above, the seeded value here MUST be a drawable count (a positive
    // integer): an object value is filtered by drawableVaultCount before the
    // wire, so the pollution-vs-number caveat does not apply; what this arm
    // proves is that a drawable row under the hostile key is never silently
    // dropped or reparented at any hop (encode clone, JSON ride, reference
    // adoption), and that every read still goes through hasOwn.
    const server = new GameServer();
    const fw = fakeWs();
    const { pid, meta } = seat(server, fw, 63, 'Cvaultproto', 0);
    meta.vault.upgrades = 1;
    const stock = meta.vault.stock as unknown as Record<string, unknown>;
    Object.defineProperty(stock, '__proto__', {
      value: 5,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    stock.copper_ore = 3;

    broadcast(server);
    const snap = lastSnap(fw.sent);
    // The boundary clone (Object.fromEntries) defines data properties, so the
    // key survives to the JSON beside the ordinary material.
    expect(Object.hasOwn(snap.self.cvault, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(snap.self.cvault, '__proto__')?.value).toBe(5);
    expect(snap.self.cvault.copper_ore).toBe(3);

    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(snap);
    const mirrored = client.craftVaultStock as unknown as Record<string, unknown>;
    // Adopt-by-reference keeps the own key with its count; nothing was
    // reparented anywhere in the round trip.
    expect(Object.hasOwn(mirrored, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(mirrored, '__proto__')?.value).toBe(5);
    expect(mirrored.copper_ore).toBe(3);
    expect(Object.getPrototypeOf(mirrored)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype as unknown as Record<string, unknown>, 'polluted')).toBe(
      false,
    );
  });

  it('crossing the craft-draw gate encodes an EXPLICIT null and the return trip restores the rows', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const { sim, pid, meta } = seat(server, fw, 62, 'Cvaultgate', 0);
    meta.vault.upgrades = 1;
    meta.vault.stock = { copper_ore: 4 };
    const p = sim.entities.get(pid);
    const home = { ...p.pos };

    broadcast(server);
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.craftVaultStock).toEqual({ copper_ore: 4 });

    // Teleport into the far-east instanced plane: the geometry backstop arm
    // (x > DUNGEON_X_THRESHOLD) closes the gate without needing a live
    // instance membership, which is exactly the fail-closed posture it pins.
    p.pos.x = DUNGEON_X_THRESHOLD + 1;
    p.prevPos = { ...p.pos };
    sim.tick();
    fw.sent.length = 0;
    broadcast(server);
    const gated = lastSnap(fw.sent);
    expect(gated.self).toHaveProperty('cvault');
    expect(gated.self.cvault).toBeNull();
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(gated);
    expect(client.craftVaultStock).toBeNull();

    // Walking back out restores the rows on the next snapshot: the gate
    // probe flips the signature without any revision change.
    p.pos.x = home.x;
    p.prevPos = { ...p.pos };
    sim.tick();
    fw.sent.length = 0;
    broadcast(server);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.craftVaultStock).toEqual({ copper_ore: 4 });
  });

  it('cvault reaches NOBODY but its owner (bystander negative with positive control)', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const fw2 = fakeWs();
    const { meta } = seat(server, fw, 63, 'Cvaultown', 0);
    // The bystander stands at the same banker (maximum proximity overlap).
    seat(server, fw2, 64, 'Cvaultspy', 0);
    meta.vault.upgrades = 1;
    meta.vault.stock = { copper_ore: 4 };

    broadcast(server);
    // Positive control: the owner's frames carry the stocked cvault value...
    const ownHits = valuesUnderKey(fw.sent, 'cvault');
    expect(ownHits).toContainEqual({ copper_ore: 4 });
    // ...while the bystander's frames carry no STOCKED cvault anywhere at any
    // depth (their own self key legitimately encodes their own empty {} or
    // null, so the leak probe is the owner's record, not mere key presence).
    const spyHits = valuesUnderKey(fw2.sent, 'cvault');
    expect(spyHits.filter((v) => v !== null && Object.keys(v as object).length > 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// server/vault_wire.ts unit seam: the module's own contract, driven without a
// GameServer (the narrow VaultSim host interface exists for exactly this; the
// end-to-end pins above stay authoritative for behavior through the real
// dispatch). These arms pin the classes the integration run cannot make
// decisive on its own: per-command shape refusal, the (rev, gate) signature
// elision, and the batch's drain-on-flush (a reused instance must never
// re-insert prior rows).
// ---------------------------------------------------------------------------
describe('vault_wire module units', () => {
  const calls: string[] = [];
  const withdrawArgs: unknown[][] = [];
  const unitSim = (): VaultSim => ({
    ctx: {
      resolve: () => ({ meta: { entityId: 9 } }),
      error: (_id, text) => void calls.push(`error:${text}`),
    },
    vaultInfoFor: () => null,
    vaultDeposit: (slot, count) => void calls.push(`deposit:${slot}:${count}`),
    vaultWithdraw: (itemId, count, ...rest: unknown[]) => {
      calls.push(`withdraw:${itemId}:${count}`);
      withdrawArgs.push([itemId, count, ...rest]);
    },
    vaultDepositAll: () => void calls.push('depositAll'),
    vaultBuyUpgrade: () => void calls.push('buyUpgrade'),
  });
  const WHO = { characterId: 11, accountId: 22 };

  beforeEach(() => {
    calls.length = 0;
    withdrawArgs.length = 0;
  });

  it('strictly decodes and forwards a full special selector, rejecting malformed lookalikes', () => {
    const sim = unitSim();
    const special = {
      index: 2,
      instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
      craftedRecipeId: 'smelt_copper',
    };
    dispatchVaultCommand(
      sim,
      WHO,
      'vault_withdraw',
      { itemId: 'copper_ore', count: 1, special },
      9,
    );
    expect(withdrawArgs).toEqual([['copper_ore', 1, special, 9]]);

    const malformed = [
      { ...special, index: -1 },
      { ...special, extra: true },
      { ...special, instance: null },
      { ...special, instance: [] },
      { ...special, instance: { signer: 'x'.repeat(65) } },
      { ...special, instance: { ['x'.repeat(65)]: 1 } },
      { ...special, craftedRecipeId: '' },
    ];
    for (const value of malformed) {
      expect(decodeVaultSpecialRef(value)).toBeNull();
      dispatchVaultCommand(sim, WHO, 'vault_withdraw', { itemId: 'copper_ore', special: value }, 9);
    }
    expect(withdrawArgs).toHaveLength(1);
  });

  it('routes each command to its sim verb and refuses malformed shapes', () => {
    const sim = unitSim();
    dispatchVaultCommand(sim, WHO, 'vault_deposit', { slot: 3, count: 2 }, 9);
    dispatchVaultCommand(sim, WHO, 'vault_deposit', { slot: 'x' }, 9);
    dispatchVaultCommand(sim, WHO, 'vault_withdraw', { itemId: 'copper_ore' }, 9);
    dispatchVaultCommand(sim, WHO, 'vault_withdraw', { itemId: 4 }, 9);
    dispatchVaultCommand(sim, WHO, 'vault_deposit_all', {}, 9);
    dispatchVaultCommand(sim, WHO, 'vault_buy_upgrade', {}, 9);
    expect(calls).toEqual([
      'deposit:3:2',
      'withdraw:copper_ore:undefined',
      'depositAll',
      'buyUpgrade',
    ]);
  });

  it('probes revisions every pass but builds vault payloads only on first send, change, or open/close', () => {
    let gatedRev: number | null = 3;
    const rawRev: number | null = 3;
    let vaultBuilds = 0;
    let cvaultBuilds = 0;
    const sim = {
      vaultInfoWireRevFor: () => gatedRev,
      vaultWireRevFor: () => rawRev,
      craftVaultDrawBlockedFor: () => false,
      vaultInfoFor: () => {
        vaultBuilds++;
        return {
          stock: { copper_ore: rawRev ?? 0 },
          special: [],
          upgrades: 1,
          perMaterialCap: 40,
          nextUpgradeCost: 50000,
        };
      },
      craftVaultStockFor: () => {
        cvaultBuilds++;
        return { copper_ore: rawRev ?? 0 };
      },
    };
    const session = {
      lastSent: {} as Record<string, string>,
      lastVaultWirePid: null as number | null,
      lastVaultWireRev: null as number | null,
      lastCvaultWirePid: null as number | null,
      lastCvaultWireRev: null as number | null,
      lastCvaultWireBlocked: null as boolean | null,
    };
    const emitted: [string, unknown][] = [];
    const emit = (key: string, value: unknown): void => {
      session.lastSent[key] = JSON.stringify(value ?? null);
      emitted.push([key, value]);
    };

    emitVaultSelfKeys(emit, sim, session, 9);
    expect(emitted.map(([key]) => key)).toEqual(['vault', 'cvault']);
    expect([vaultBuilds, cvaultBuilds]).toEqual([1, 1]);

    emitted.length = 0;
    emitVaultSelfKeys(emit, sim, session, 9);
    expect(emitted).toEqual([]);
    expect([vaultBuilds, cvaultBuilds]).toEqual([1, 1]);

    // A retarget is part of the signature even when the two characters happen
    // to share a revision and lastSent remains populated.
    emitVaultSelfKeys(emit, sim, session, 10);
    expect(emitted.map(([key]) => key)).toEqual(['vault', 'cvault']);
    expect([vaultBuilds, cvaultBuilds]).toEqual([2, 2]);

    emitted.length = 0;
    gatedRev = null;
    emitVaultSelfKeys(emit, sim, session, 10);
    expect(emitted).toEqual([['vault', null]]);
    expect(vaultBuilds).toBe(2); // closing never builds the large value

    emitted.length = 0;
    gatedRev = 3;
    emitVaultSelfKeys(emit, sim, session, 10);
    expect(emitted[0]?.[0]).toBe('vault');
    expect(vaultBuilds).toBe(3);
  });

  it('elides cvault while the (rev, gate) signature holds, ships on either half moving', () => {
    let rev = 4;
    let blocked = false;
    let builds = 0;
    const sim = {
      vaultInfoWireRevFor: () => rev,
      vaultWireRevFor: () => rev,
      craftVaultDrawBlockedFor: () => blocked,
      vaultInfoFor: () => ({
        stock: {},
        special: [],
        upgrades: 1,
        perMaterialCap: 40,
        nextUpgradeCost: 50000,
      }),
      craftVaultStockFor: () => {
        builds++;
        return { copper_ore: rev };
      },
    };
    const session = {
      lastSent: { vault: '{}' } as Record<string, string>,
      lastVaultWirePid: 9 as number | null,
      lastVaultWireRev: 4 as number | null,
      lastCvaultWirePid: 9 as number | null,
      lastCvaultWireRev: 4 as number | null,
      lastCvaultWireBlocked: null as boolean | null,
    };
    const emitted: [string, unknown][] = [];
    const emit = (key: string, value: unknown): void => {
      session.lastSent[key] = JSON.stringify(value ?? null);
      emitted.push([key, value]);
    };

    emitVaultSelfKeys(emit, sim, session, 9);
    expect(builds).toBe(1); // sent.cvault undefined forces a reconnect-style send

    // The signature holds: no rebuild, however many passes run (this was the
    // 4 Hz cadence's unconditional projection rebuild before).
    for (let pass = 0; pass < 10; pass++) emitVaultSelfKeys(emit, sim, session, 9);
    expect(builds).toBe(1);

    rev = 5;
    emitVaultSelfKeys(emit, sim, session, 9);
    expect(builds).toBe(2); // a mutation ships on the very next pass

    // A gate flip ships the EXPLICIT null on the next pass without paying the
    // projection call at all, and the return trip restores the rows.
    emitted.length = 0;
    blocked = true;
    emitVaultSelfKeys(emit, sim, session, 9);
    expect(emitted).toEqual([['cvault', null]]);
    expect(builds).toBe(2);
    blocked = false;
    emitVaultSelfKeys(emit, sim, session, 9);
    expect(builds).toBe(3);
    emitVaultSelfKeys(emit, sim, session, 9);
    expect(builds).toBe(3);
  });

  it('stamps cvault trackers only after the emitter accepts the rebuilt value', () => {
    const session = {
      lastSent: { vault: '{}' } as Record<string, string>,
      lastVaultWirePid: 9 as number | null,
      lastVaultWireRev: 8 as number | null,
      lastCvaultWirePid: 9 as number | null,
      lastCvaultWireRev: 7 as number | null,
      // Seeded NULL so the post-throw assertion is decisive: a stamp that
      // slipped through would move it to false.
      lastCvaultWireBlocked: null as boolean | null,
    };
    const sim = {
      vaultInfoWireRevFor: () => 8,
      vaultWireRevFor: () => 8,
      craftVaultDrawBlockedFor: () => false,
      vaultInfoFor: () => null,
      craftVaultStockFor: () => ({ copper_ore: 8 }),
    };
    expect(() =>
      emitVaultSelfKeys(
        () => {
          throw new Error('wire rejected');
        },
        sim,
        session,
        9,
      ),
    ).toThrow('wire rejected');
    expect(session.lastCvaultWireRev).toBe(7);
    expect(session.lastCvaultWireBlocked).toBeNull();

    // The gate-flip arm keeps the same contract: a rejected emit leaves the
    // blocked tracker unstamped, so the flip re-ships on the next pass.
    session.lastSent.cvault = '{}';
    session.lastCvaultWireRev = 8;
    const blockedSim = { ...sim, craftVaultDrawBlockedFor: () => true };
    expect(() =>
      emitVaultSelfKeys(
        () => {
          throw new Error('gate wire rejected');
        },
        blockedSim,
        session,
        9,
      ),
    ).toThrow('gate wire rejected');
    expect(session.lastCvaultWireBlocked).toBeNull();
  });
});

describe('storage price overrides ride the vault delta (phase 09)', () => {
  it('an overridden vault ladder reaches ClientWorld.vaultInfo unchanged', () => {
    // GameServer builds its own Sim (the boot env knob), so the override rides
    // a sim SWAPPED IN before any join or broadcast (the bank_wire.test.ts
    // idiom): seat(), broadcast(), and the encode all read server.sim at call
    // time, and the one constructor-time capture of the boot sim (the parse
    // subsystem, inert without PARSE_CAPTURE=1) plays no part in the vault
    // flow. The override list must be EXACTLY the compiled length (5 rungs)
    // or the resolver drops the dimension; the locked vault quotes rung 0.
    // 333 appears in NO price table, so a regression to any compiled constant
    // fails on a number that cannot occur by coincidence.
    const server = new GameServer();
    // biome-ignore lint/suspicious/noExplicitAny: the pre-join sim swap is a rig internal
    (server as any).sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      storagePrices: { vaultUpgrades: [333, 334, 335, 336, 337] },
    });
    const fw = fakeWs();
    const { pid } = seat(server, fw, 1, 'Vaultovr', 0);

    broadcast(server);
    const first = lastSnap(fw.sent);
    // The encode quotes the overridden unlock price (a fresh literal, never
    // the override object: comparing against the minted array would be a
    // self-comparison)...
    expect(first.self.vault.nextUpgradeCost).toBe(333);
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(first);
    // ...and the decode mirrors it onto ClientWorld untouched.
    expect(client.vaultInfo?.nextUpgradeCost).toBe(333);
  });

  it('the default rig still quotes the compiled unlock price through to the mirror', () => {
    // The control arm for the override above (deliberately doubling the
    // locked-encode pin earlier in this file): an unmodified GameServer quotes
    // the compiled rung 0, pinned as a fresh literal end to end so an override
    // that leaked into the default boot path fails here. Env note: a
    // shell-exported STORAGE_PRICES WOULD reach this boot sim
    // (server/storage_prices.ts parses at module load) and red this arm; CI
    // and the gate run with it unset, which is the environment this pin
    // assumes.
    const server = new GameServer();
    const fw = fakeWs();
    const { pid } = seat(server, fw, 1, 'Vaultdflt', 0);

    broadcast(server);
    const first = lastSnap(fw.sent);
    expect(first.self.vault.nextUpgradeCost).toBe(20000); // VAULT_UPGRADE_PRICES[0]
    const client = bareClient(pid);
    // biome-ignore lint/suspicious/noExplicitAny: applySnapshot is a ClientWorld internal
    (client as any).applySnapshot(first);
    expect(client.vaultInfo?.nextUpgradeCost).toBe(20000);
  });
});
