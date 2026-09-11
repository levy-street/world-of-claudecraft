// The account ledger across the server seam: the heavy `acct` self key, the
// ClientWorld mirror and its account-wide completion reads, the same-tick
// fan-out to a sibling session on the account, the post-save drain into
// account_relic_finds, the join reconcile, and the join-time ledger hand-in.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

vi.mock('../server/account_ledger_db', () => ({
  insertAccountRelicFinds: vi.fn(async () => {}),
  loadAccountLedger: vi.fn(async () => ({ deeds: new Map(), relics: new Map() })),
}));

vi.mock('../server/deeds_db', () => ({
  insertCharacterDeed: vi.fn(async () => {}),
  insertCharacterDeeds: vi.fn(async () => {}),
  getDeedBroadcasts: vi.fn(async () => true),
}));

import { insertAccountRelicFinds } from '../server/account_ledger_db';
import { relicRecordsIdle } from '../server/account_ledger_records';
import { GameServer } from '../server/game';
import { REALM } from '../server/realm';
import {
  type AccountEarner,
  freshAccountLedger,
  recordAccountDeed,
} from '../src/sim/account_ledger';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { grantDeed, markItemDiscovered } from '../src/sim/deeds';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const CATALOGUE_RELIC = 'cryptbone_helm';
const PAGE_ID = 'conquerors_hollow_crypt';
const TITLE_DEED = DEED_ORDER.find((id) => DEEDS[id].reward?.kind === 'title')!;
const insertMock = vi.mocked(insertAccountRelicFinds);

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}

function joinAt(
  server: GameServer,
  fw: ReturnType<typeof fakeWs>,
  acct: number,
  cid: number,
  name: string,
  state: CharacterState | null = null,
  meta?: Record<string, unknown>,
  // The per-account live-session cap (server/linkdead.ts) waves GM joins
  // through, which is how a second character of the same account gets into
  // the world here without touching the production cap.
  isGm = false,
) {
  const s = server.join(fw.ws as any, acct, cid, name, 'warrior', state, isGm, meta as any) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

/** A complete, restorable CharacterState (a fresh warrior's save) with a patch
 *  spread over it: the restore path expects every array present. */
function fullState(patch: Partial<CharacterState>): CharacterState {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
  const base = sim.serializeCharacter(sim.playerId)!;
  return { ...base, ...patch };
}

/** One authoritative tick handed to the loop's two observers, in loop order. */
function tickThrough(server: GameServer): SimEvent[] {
  const events = server.sim.tick();
  const g = server as unknown as {
    routeEvents(e: SimEvent[]): void;
    detectActivity(e: SimEvent[]): void;
  };
  g.routeEvents(events);
  g.detectActivity(events);
  return events;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await relicRecordsIdle();
  await new Promise((resolve) => setImmediate(resolve));
}

describe('account ledger over the wire', () => {
  it('a relic found on one character reaches the account sibling in the same tick and rides `acct` to its client', () => {
    const server = new GameServer();
    const fwA = fakeWs();
    const fwB = fakeWs();
    const a = joinAt(server, fwA, 7, 42, 'Hilda');
    const b = joinAt(server, fwB, 7, 43, 'Bram', null, undefined, true);
    tickThrough(server);
    const sim = server.sim as Sim;
    const metaA = sim.players.get(a.pid)!;
    const metaB = sim.players.get(b.pid)!;

    markItemDiscovered(sim.ctx, metaA, CATALOGUE_RELIC);
    grantDeed(sim.ctx, metaA, 'soc_meet_bursar');
    tickThrough(server);

    const expectEarner: AccountEarner = {
      characterId: 42,
      name: 'Hilda',
      cls: 'warrior',
      day: sim.ctx.utcDay,
    };
    expect(metaB.accountLedger.relics.get(`item:${CATALOGUE_RELIC}`)).toEqual([expectEarner]);
    expect(metaB.accountLedger.deeds.get('soc_meet_bursar')).toEqual([expectEarner]);
    // B's own surfaces are untouched: the ledger, not a copied discovery.
    expect(metaB.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
    expect(metaB.deedsEarned.has('soc_meet_bursar')).toBe(false);
    // Staged for the post-save drain on the ACTOR only.
    expect(a.pendingRelicRecords).toEqual([`item:${CATALOGUE_RELIC}`]);
    expect(b.pendingRelicRecords).toEqual([]);

    fwB.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fwB.sent);
    expect(snap.self.acct).toBeDefined();
    expect(snap.self.acct.r[`item:${CATALOGUE_RELIC}`]).toEqual([
      [42, 'Hilda', 'warrior', sim.ctx.utcDay],
    ]);
    expect(snap.self.acct.d.soc_meet_bursar).toEqual([[42, 'Hilda', 'warrior', sim.ctx.utcDay]]);

    const client = bareClient(b.pid);
    (client as any).applySnapshot(snap);
    expect(client.reliquaryAccountFinds.get(`item:${CATALOGUE_RELIC}`)).toEqual([expectEarner]);
    expect(client.accountDeeds.get('soc_meet_bursar')).toEqual([expectEarner]);
    // The mirror's completion reads are account-wide: the alt's find fills
    // Bram's page though Bram's own discovery set is empty.
    expect(client.deedStats.itemsDiscovered.has(CATALOGUE_RELIC)).toBe(false);
    expect(client.reliquaryPageCompletion(PAGE_ID)?.owned).toBe(1);
    expect(client.reliquaryCuratorRank()).toBe(1);
  });

  it('a stranger account learns nothing', () => {
    const server = new GameServer();
    const fwA = fakeWs();
    const fwC = fakeWs();
    const a = joinAt(server, fwA, 7, 42, 'Hilda');
    const c = joinAt(server, fwC, 8, 77, 'Other');
    tickThrough(server);
    const sim = server.sim as Sim;
    markItemDiscovered(sim.ctx, sim.players.get(a.pid)!, CATALOGUE_RELIC);
    tickThrough(server);
    expect(sim.players.get(c.pid)!.accountLedger.relics.size).toBe(0);
  });

  it('the relic drain publishes only after the authoritative save, with the session identity', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const a = joinAt(server, fw, 7, 42, 'Hilda');
    tickThrough(server);
    await settle();
    insertMock.mockClear();
    const sim = server.sim as Sim;
    markItemDiscovered(sim.ctx, sim.players.get(a.pid)!, CATALOGUE_RELIC);
    tickThrough(server);
    expect(insertMock).not.toHaveBeenCalled();
    await (server as any).saveCharacter(a);
    await settle();
    expect(insertMock).toHaveBeenCalledWith(
      { realm: REALM, characterId: 42, accountId: 7, name: 'Hilda', cls: 'warrior' },
      [`item:${CATALOGUE_RELIC}`],
    );
    expect(a.pendingRelicRecords).toEqual([]);
  });

  it('the join reconcile replays the blob-proven finds into the table', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    insertMock.mockClear();
    const state = fullState({
      deedStats: { itemsDiscovered: [CATALOGUE_RELIC, 'bone_fragments'] },
    });
    joinAt(server, fw, 7, 42, 'Hilda', state);
    await settle();
    expect(insertMock).toHaveBeenCalledWith(
      { realm: REALM, characterId: 42, accountId: 7, name: 'Hilda', cls: 'warrior' },
      [`item:${CATALOGUE_RELIC}`],
    );
  });

  it('the ledger handed in at join is the meta ledger, so an alt-earned title survives the restore', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const accountLedger = freshAccountLedger();
    recordAccountDeed(accountLedger, TITLE_DEED, {
      characterId: 99,
      name: 'Alt',
      cls: 'mage',
      day: '2026-09-01',
    });
    const state = fullState({ activeTitle: TITLE_DEED });
    const s = joinAt(server, fw, 7, 42, 'Hilda', state, { accountLedger });
    const meta = server.sim.meta(s.pid)!;
    expect(meta.accountLedger).toBe(accountLedger);
    expect(meta.activeTitle).toBe(TITLE_DEED);
    // The seed folded this character's own (empty) blob over the loaded rows
    // without disturbing the alt's entry.
    expect(meta.accountLedger.deeds.get(TITLE_DEED)?.[0].characterId).toBe(99);
  });
});
