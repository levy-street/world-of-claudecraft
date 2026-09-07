// The server half of the account-bound Reliquary: the insert-only ledger table
// (server/account_reliquary_db.ts), the per-account fold with its serialized
// persistence (server/account_reliquary.ts), the identity-wire standing, and
// the GameServer wiring: join stamps the ledger, a live fill folds at once and
// reaches a sibling character on the same account through the cosmetics wire.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  loadAccountCosmetics: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { readFileSync } from 'node:fs';
import {
  AccountReliquaryFold,
  curatorStandingFor,
  stampAccountRelics,
} from '../../server/account_reliquary';
import {
  ACCOUNT_RELIQUARY_SCHEMA,
  addAccountRelics,
  loadAccountCosmeticsWithRelics,
  loadAccountReliquary,
} from '../../server/account_reliquary_db';
import { GameServer } from '../../server/game';
import { RELIQUARY_ITEM_TO_PAGES, RELIQUARY_MARK_IDS } from '../../src/sim/content/reliquary';
import { markItemDiscovered } from '../../src/sim/deeds';
import { emptyAccountReliquaryLedger } from '../../src/sim/reliquary_account';
import type { Sim } from '../../src/sim/sim';
import { bareClient } from '../helpers/bare_client';

const RELIC = 'cryptbone_helm';
const MARK = [...RELIQUARY_MARK_IDS][0];
const PAGE = RELIQUARY_ITEM_TO_PAGES.get(RELIC)?.[0] as string;

function fakeQuery(rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; params?: readonly unknown[] }[] = [];
  return {
    calls,
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        calls.push({ sql, params });
        return { rows };
      },
    },
  };
}

describe('account_relics storage', () => {
  it('is an insert-only, catalog-bounded row set that boots with the other schemas', () => {
    expect(ACCOUNT_RELIQUARY_SCHEMA).toMatch(/CREATE TABLE IF NOT EXISTS account_relics/);
    expect(ACCOUNT_RELIQUARY_SCHEMA).toMatch(/PRIMARY KEY \(account_id, kind, relic_id\)/);
    expect(ACCOUNT_RELIQUARY_SCHEMA).toMatch(/ON DELETE CASCADE/);
    expect(ACCOUNT_RELIQUARY_SCHEMA).toMatch(
      /CHECK \(kind IN \('items', 'marks', 'mounts', 'titles'\)\)/,
    );
    const db = readFileSync(new URL('../../server/db.ts', import.meta.url), 'utf8');
    expect(db).toMatch(/await client\.query\(ACCOUNT_RELIQUARY_SCHEMA\)/);
  });

  it('loadAccountReliquary reads by account and catalog-filters the rows', async () => {
    const { calls, db } = fakeQuery([
      { kind: 'items', relic_id: RELIC },
      { kind: 'items', relic_id: 'no_such_relic' },
      { kind: 'marks', relic_id: MARK },
      { kind: 'bogus', relic_id: RELIC },
    ]);
    const ledger = await loadAccountReliquary(42, db);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/FROM account_relics WHERE account_id = \$1/);
    expect(calls[0].params).toEqual([42]);
    expect(ledger).toEqual({ items: [RELIC], marks: [MARK], mounts: [], titles: [] });
  });

  it('addAccountRelics batches one ON CONFLICT DO NOTHING insert, and skips an empty add', async () => {
    const { calls, db } = fakeQuery([{ relic_id: RELIC }, { relic_id: MARK }]);
    expect(await addAccountRelics(42, emptyAccountReliquaryLedger(), db)).toBe(0);
    expect(calls).toHaveLength(0);
    const n = await addAccountRelics(
      42,
      { items: [RELIC], marks: [MARK], mounts: [], titles: [] },
      db,
    );
    expect(n).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO account_relics \(account_id, kind, relic_id\)/);
    expect(calls[0].sql).toMatch(/unnest\(\$2::text\[\], \$3::text\[\]\)/);
    expect(calls[0].sql).toMatch(/ON CONFLICT \(account_id, kind, relic_id\) DO NOTHING/);
    expect(calls[0].params).toEqual([42, ['items', 'marks'], [RELIC, MARK]]);
  });

  it('loadAccountCosmeticsWithRelics attaches the ledger to the join read', async () => {
    const cosmetics = await loadAccountCosmeticsWithRelics(5);
    expect(cosmetics.weaponSkinIds).toEqual([]);
    expect(cosmetics.reliquary).toEqual(emptyAccountReliquaryLedger());
  });
});

describe('AccountReliquaryFold', () => {
  function sim(): Sim {
    return new GameServer().sim as Sim;
  }

  it('folds a character into the account, persists only what is new, and idles after', async () => {
    const persisted: { accountId: number; added: unknown }[] = [];
    const fold = new AccountReliquaryFold(async (accountId, added) => {
      persisted.push({ accountId, added });
    });
    const s = sim();
    const pid = s.addPlayer('warrior', 'A');
    const meta = s.players.get(pid)!;
    expect(fold.fold(9, meta)).toBeNull();
    markItemDiscovered(s.ctx, meta, RELIC);
    const grown = fold.fold(9, meta);
    expect(grown?.items).toEqual([RELIC]);
    expect(fold.ledgerFor(9)).toBe(grown);
    // Nothing new on the next sweep: no write, no ledger churn.
    expect(fold.fold(9, meta)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(persisted).toEqual([
      { accountId: 9, added: { items: [RELIC], marks: [], mounts: [], titles: [] } },
    ]);
    // A second character on the account contributing a mark persists the mark only.
    const pid2 = s.addPlayer('mage', 'B');
    const meta2 = s.players.get(pid2)!;
    meta2.reliquary.marks.add(MARK);
    const grown2 = fold.fold(9, meta2);
    expect(grown2).toEqual({ items: [RELIC], marks: [MARK], mounts: [], titles: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(persisted[1]).toEqual({
      accountId: 9,
      added: { items: [], marks: [MARK], mounts: [], titles: [] },
    });
  });

  it('remember widens and never narrows the live ledger', () => {
    const fold = new AccountReliquaryFold(async () => {});
    const seeded = fold.remember(3, { items: [RELIC], marks: [], mounts: [], titles: [] });
    expect(seeded.items).toEqual([RELIC]);
    const stale = fold.remember(3, emptyAccountReliquaryLedger());
    expect(stale.items).toEqual([RELIC]);
    expect(fold.remember(3, undefined).items).toEqual([RELIC]);
    expect(fold.ledgerFor(4)).toEqual(emptyAccountReliquaryLedger());
  });

  it('a failed persist is logged, never thrown, and the live ledger keeps the id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fold = new AccountReliquaryFold(async () => {
      throw new Error('db down');
    });
    const s = sim();
    const pid = s.addPlayer('warrior', 'A');
    const meta = s.players.get(pid)!;
    markItemDiscovered(s.ctx, meta, RELIC);
    expect(fold.fold(9, meta)?.items).toEqual([RELIC]);
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith('failed to save account relics:', expect.any(Error));
    expect(fold.ledgerFor(9).items).toEqual([RELIC]);
    err.mockRestore();
  });

  it('curatorStandingFor is absent when unranked and account-wide when stamped', () => {
    const s = sim();
    const pid = s.addPlayer('warrior', 'A');
    const meta = s.players.get(pid)!;
    expect(curatorStandingFor(meta)).toBeNull();
    stampAccountRelics(meta, { items: [RELIC], marks: [], mounts: [], titles: [] });
    expect(curatorStandingFor(meta)).toEqual({ rank: 1, owned: 1, total: expect.any(Number) });
    // The no-op arms: a missing meta or an absent ledger.
    stampAccountRelics(null, { items: [], marks: [], mounts: [], titles: [] });
    stampAccountRelics(meta, undefined);
    expect(meta.accountRelics.items).toEqual([RELIC]);
  });
});

describe('GameServer wiring', () => {
  function fakeWs() {
    const sent: any[] = [];
    return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
  }
  function lastSnap(sent: any[]): any {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
    return null;
  }
  function join(
    server: GameServer,
    fw: ReturnType<typeof fakeWs>,
    acct: number,
    cid: number,
    name: string,
    ledger?: unknown,
  ) {
    const cosmetics = {
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
      ...(ledger ? { reliquary: ledger } : {}),
    };
    const s = server.join(fw.ws as any, acct, cid, name, 'warrior', null, false, {
      accountCosmetics: cosmetics as any,
    }) as any;
    if ('error' in s) throw new Error(s.error);
    s.blockListLoaded = true;
    return s;
  }

  it('join stamps the stored ledger onto the PlayerMeta and the standing wire', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = join(server, fw, 7, 71, 'Main', {
      items: [RELIC],
      marks: [],
      mounts: [],
      titles: [],
    });
    const sim = server.sim as Sim;
    const meta = sim.players.get(s.pid)!;
    expect(meta.accountRelics.items).toEqual([RELIC]);
    expect(sim.entities.get(s.pid)?.curatorRank).toBe(1);
    expect(sim.entities.get(s.pid)?.relicsOwned).toBe(1);
  });

  it('a live fill folds at once and reaches the next character on the account', async () => {
    const server = new GameServer();
    const sim = server.sim as Sim;
    const fa = fakeWs();
    const a = join(server, fa, 7, 71, 'Main');
    const metaA = sim.players.get(a.pid)!;
    expect(sim.entities.get(a.pid)?.curatorRank).toBeUndefined();

    markItemDiscovered(sim.ctx, metaA, RELIC);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'reliquaryUnlock')).toBe(true);
    // The loop hands every drained batch to both: routeEvents (wire) and
    // detectActivity (the per-event server arms, the fold among them).
    (server as any).routeEvents(events);
    (server as any).detectActivity(events);
    // The fill folded on the event, before any 60s sweep: the session's
    // cosmetics carry the ledger and the identity standing moved.
    expect(a.accountCosmetics.reliquary?.items).toEqual([RELIC]);
    expect(sim.entities.get(a.pid)?.curatorRank).toBe(1);

    // One character per account is in the world at a time, so the sibling
    // joins AFTER Main leaves, with NO stored ledger on its join read: the live
    // fold (not the row) is what hands it the relic.
    await server.leave(a, 'test');
    const fb = fakeWs();
    const b = join(server, fb, 7, 72, 'Alt');
    const metaB = sim.players.get(b.pid)!;
    expect(metaB.deedStats.itemsDiscovered.has(RELIC)).toBe(false);
    expect(metaB.accountRelics.items).toEqual([RELIC]);
    expect(b.accountCosmetics.reliquary?.items).toEqual([RELIC]);
    expect(sim.entities.get(b.pid)?.curatorRank).toBe(1);
    // The sibling's client mirrors the ledger off the cosmetics self key and
    // fills the page the sibling never looted.
    fb.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fb.sent);
    expect(snap.self.cosmetics.reliquary.items).toEqual([RELIC]);
    const client = bareClient(b.pid);
    (client as any).applySnapshot(snap);
    expect(client.accountCosmetics.reliquary?.items).toEqual([RELIC]);
    expect(client.reliquaryPageCompletion(PAGE)?.owned).toBeGreaterThanOrEqual(1);
    expect(client.reliquaryCuratorRank()).toBe(1);
    // The sweep re-stamps the sibling's standing from the account ledger.
    (server as any).refreshCuratorStanding(b);
    expect(sim.entities.get(b.pid)?.curatorRank).toBe(1);
  });
});
