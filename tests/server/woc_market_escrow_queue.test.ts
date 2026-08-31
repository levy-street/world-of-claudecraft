// The escrow custody critical section rides the per-character save FIFO (H5:
// the listing custody edge). The hazard it pins: the 30s autosave serializes
// the character INSIDE its queued thunk and commits after an await gap, so an
// escrow write that bypasses the queue can commit first and then be
// overwritten by the autosave's PRE-extraction blob, restoring the item to
// durable bags while the listing holds the escrowed copy (sell it and keep
// it, no crash needed). Drives the REAL GameServer + Sim + custody bridge +
// WocMarketService with the db layer mocked (the guild_bank_persistence
// idiom) and the marketplace db faked.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterState: vi.fn(async (..._args: any[]) => true),
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndGuildBankState: vi.fn(async (..._args: any[]) => true),
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndMarketState: vi.fn(async (..._args: any[]) => true),
}));

vi.mock('../../server/db', () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [] })),
  },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  saveCharacterState: dbMock.saveCharacterState,
  saveCharacterAndGuildBankState: dbMock.saveCharacterAndGuildBankState,
  saveCharacterAndMarketState: dbMock.saveCharacterAndMarketState,
  saveMailState: vi.fn(async () => {}),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  releaseCharacterLease: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { BankLedgerGrowthLimitExceeded } from '../../server/bank_ledger_growth_budget';
import { type ClientSession, GameServer } from '../../server/game';
import {
  noopGameMetricsCounters,
  setGameMetricsCounters,
  type WocEscrowQueueOutcome,
} from '../../server/http/game_signals';
import type { CustodyParcelRow } from '../../server/mail_custody_overlay';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';
import type { CharacterSaveArgs, WocMarketCustody } from '../../server/woc_market';
import { WocMarketService } from '../../server/woc_market';
import { createWocMarketCustody, wocEscrowSerializeStats } from '../../server/woc_market_custody';
import { createWocEscrowGate, type WocEscrowGate } from '../../server/woc_market_escrow_gate';
import { createDevWocMarketEconomy } from '../../server/woc_market_proxy';
import type { WocListingParams } from '../../server/woc_market_rules';
import { WOC_MARKET_RESTRICTED_POLICY } from '../../server/woc_market_rules';
import { WOC_MARKET_RETURN_LETTER } from '../../src/sim/content/letters';
import { ITEMS } from '../../src/sim/data';
import type { GuildBankOpDelta } from '../../src/sim/guild_bank';
import type { CharacterState } from '../../src/sim/sim';
import { stripComments } from '../helpers/strip_comments';
import { FakeWocMarketDb } from './helpers/fake_woc_market_db';

const REALM = 'test-realm';
const SELLER = 21;
const SELLER_CHAR = 21;
const NONCE = 'nonce-live';
const GUILD = 913;

const storageEffect = (
  idempotencyKey: string,
  itemId = 'strongbox_rung_01',
  purchasedSlotsBefore = 0,
  purchasedSlotsAfter = 6,
): StorageAppliedEffect => ({
  realm: REALM,
  accountId: SELLER,
  characterId: SELLER_CHAR,
  itemId,
  expectedCostClaudium: 100,
  idempotencyKey,
  spendClaimToken: '00000000-0000-4000-8000-000000000001',
  purchasedSlotsBefore,
  purchasedSlotsAfter,
});

// A real eligible equipment def from the content tables (the service-test
// fixture shape): tradable, non-quest, so only the custody edge is under test.
const EPIC_ITEM = (() => {
  const id = Object.keys(ITEMS).find((candidate) => {
    const def = ITEMS[candidate];
    return (
      def.quality === 'epic' &&
      !def.soulbound &&
      def.slot !== undefined &&
      !def.noMarketList &&
      def.kind !== 'quest'
    );
  });
  if (!id) throw new Error('no eligible epic equipment def in ITEMS');
  return id;
})();

function listingParams(): WocListingParams {
  return {
    format: 'auction',
    directedBuyerAccount: null,
    startCents: 5000,
    reserveCents: null,
    buyNowCents: null,
    durationHours: 12,
    offerNext: false,
  };
}

function fakeWs(): unknown {
  return { readyState: 1, send: () => {}, close: () => {}, terminate: () => {} };
}

/** A socket that KEEPS what the server sent, for the kick wire pins (the plain
 *  fakeWs above drops every frame). */
function recordingWs(): { close: ReturnType<typeof vi.fn>; sent: string[]; ws: unknown } {
  const sent: string[] = [];
  const close = vi.fn();
  return {
    close,
    sent,
    ws: {
      readyState: 1,
      bufferedAmount: 0,
      send: (payload: string) => {
        sent.push(payload);
      },
      close,
      terminate: () => {},
    },
  };
}

/** The error frames a socket received: the kick signal, separated from the
 *  ordinary social/snapshot traffic a live session also gets. */
function errorFrames(sent: string[]): Array<{ t: string; error?: string }> {
  return sent
    .map((payload) => JSON.parse(payload) as { t: string; error?: string })
    .filter((frame) => frame.t === 'error');
}

/** Install a recording game-metrics sink and return the escrow-queue kinds it
 *  collects, in emission order. afterEach restores the noop sink. */
function recordEscrowKinds(): WocEscrowQueueOutcome[] {
  const kinds: WocEscrowQueueOutcome[] = [];
  setGameMetricsCounters({
    ...noopGameMetricsCounters,
    wocEscrowQueue(kind) {
      kinds.push(kind);
    },
  });
  return kinds;
}

/** A treasury-only book delta. The inverse subtracts copperDelta straight back
 *  off the live book, so a revert is observable as one number rather than only
 *  as a cleared map. */
function goldDelta(copperDelta: number): GuildBankOpDelta {
  return {
    op: 'deposit_gold',
    itemId: null,
    count: null,
    instance: null,
    copperDelta,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  };
}

/** A loaded book plus one unflushed deposit this session owns: the shape a
 *  terminal escrow signal has to unwind. */
function dirtyOwnBook(rig: Rig): void {
  rig.server.sim.loadGuildBank(GUILD, { treasury: 1000, inventory: [], purchasedSlots: 24 });
  rig.session.dirtyGuildBanks.set(GUILD, 1);
  rig.session.unflushedGuildBankOps.set(GUILD, [goldDelta(500)]);
}

interface Rig {
  server: GameServer;
  session: ClientSession;
  custody: WocMarketCustody;
  db: FakeWocMarketDb;
  service: WocMarketService;
  /** Every durable custody parcel row the bridge wrote (the per-parcel
   *  overlay seam that replaced the whole-book persistMailBlob). */
  parcelRows: CustodyParcelRow[];
  /** Every character write across BOTH channels, in commit order, with
   *  whether that blob still holds the escrow item. */
  commits: Array<{ channel: string; holdsItem: boolean }>;
  itemIndex: () => number;
  bagsHold: (itemId: string) => boolean;
  join: (accountId: number, characterId: number, name: string) => ClientSession;
}

function requirePlayerMeta(rig: Pick<Rig, 'server' | 'session'>) {
  const meta = rig.server.sim.meta(rig.session.pid);
  if (!meta) throw new Error('missing test player meta');
  return meta;
}

const blobHoldsItem = (state: CharacterState, itemId: string): boolean =>
  state.inventory.some((s) => s.itemId === itemId);

function makeRig(
  opts: {
    escrowWaitMs?: number;
    escrowWarnMs?: number;
    escrowWarnThrottleMs?: number;
    escrowGate?: WocEscrowGate;
  } = {},
): Rig {
  const server = new GameServer();
  const join = (accountId: number, characterId: number, name: string): ClientSession => {
    const joined = server.join(fakeWs() as never, accountId, characterId, name, 'warrior', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;
    joined.leaseNonce = NONCE;
    return joined;
  };
  const session = join(SELLER, SELLER_CHAR, 'Selara');
  server.sim.addItem(EPIC_ITEM, 1, session.pid, { silent: true });
  const parcelRows: CustodyParcelRow[] = [];
  const custody = createWocMarketCustody(
    {
      get sim() {
        return server.sim;
      },
      wocCustodySession: (characterId) => server.wocCustodySession(characterId),
      enqueueCharacterWrite: (characterId, job) => server.enqueueCharacterWrite(characterId, job),
      serializeCharacterForPersist: (characterId) =>
        server.serializeCharacterForPersist(characterId),
      acknowledgeCharacterSaveEffects: (save) => server.acknowledgeCharacterSaveEffects(save),
      hasCharacterOnlySaveConflict: (characterId) =>
        server.hasCharacterOnlySaveConflict(characterId),
      hasDirtyGuildBooks: (characterId) => server.hasDirtyGuildBooks(characterId),
      flushDirtyGuildBooks: (characterId) => server.flushDirtyGuildBooks(characterId),
      escrowSessionLost: (pid, characterId, kind) =>
        server.escrowSessionLost(pid, characterId, kind),
    },
    {
      ...opts,
      persistParcelRow: async (row) => {
        parcelRows.push(row);
      },
    },
  );
  const db = new FakeWocMarketDb({
    characters: [{ characterId: SELLER_CHAR, accountId: SELLER, name: 'Selara', realm: REALM }],
  });
  const commits: Rig['commits'] = [];
  const origEscrow = db.escrowInsertListing.bind(db);
  db.escrowInsertListing = async (save: CharacterSaveArgs, listing) => {
    commits.push({ channel: 'escrow', holdsItem: blobHoldsItem(save.state, EPIC_ITEM) });
    return origEscrow(save, listing);
  };
  const service = new WocMarketService({
    db,
    economy: createDevWocMarketEconomy(),
    custody,
    verifiedWallet: async () => 'wallet-seller',
    balanceTokens: async () => 100_000_000,
    stepUpDevSig: true,
    config: {
      enabled: true,
      realm: REALM,
      policy: WOC_MARKET_RESTRICTED_POLICY,
      confirmingReviewMs: 6 * 3600 * 1000,
    },
  });
  const inventory = () => {
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing player meta');
    return meta.inventory;
  };
  return {
    server,
    session,
    custody,
    db,
    service,
    parcelRows,
    commits,
    itemIndex: () => inventory().findIndex((s) => s.itemId === EPIC_ITEM),
    bagsHold: (itemId) => inventory().some((s) => s.itemId === itemId),
    join,
  };
}

async function createListing(rig: Rig) {
  // The step-up proof (B6/R1), minted devsig through the real issue path so
  // this suite keeps exercising the escrow queue, not the challenge ladder.
  const params = listingParams();
  const issue = await rig.service.issueStepUpChallenge(SELLER, {
    operation: 'create_listing',
    itemId: EPIC_ITEM,
    expectInstance: null,
    format: params.format,
    startCents: params.startCents,
    reserveCents: params.reserveCents,
    buyNowCents: params.buyNowCents,
    durationHours: params.durationHours,
    offerNext: params.offerNext,
  });
  if (!issue.ok) throw new Error(`issueStepUpChallenge refused: ${issue.reason}`);
  return rig.service.createListing({
    account: SELLER,
    characterId: SELLER_CHAR,
    itemRef: { index: rig.itemIndex(), itemId: EPIC_ITEM },
    params,
    stepUp: {
      nonce: issue.challenge.nonce,
      signature: `devsig:${issue.challenge.nonce}`,
    },
  });
}

/** Hold the NEXT plain-path autosave commit open; it serializes immediately
 *  (item still aboard) and its commit parks until released. */
function holdNextAutosave(rig: Rig): { release: () => void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  dbMock.saveCharacterState.mockImplementationOnce(
    async (_id: number, _level: number, state: CharacterState) => {
      await held;
      rig.commits.push({ channel: 'autosave', holdsItem: blobHoldsItem(state, EPIC_ITEM) });
      return true;
    },
  );
  return { release };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  dbMock.saveCharacterState.mockClear();
  dbMock.saveCharacterState.mockImplementation(async () => true);
  dbMock.saveCharacterAndGuildBankState.mockClear();
  dbMock.saveCharacterAndGuildBankState.mockImplementation(async () => true);
  dbMock.saveCharacterAndMarketState.mockClear();
  dbMock.saveCharacterAndMarketState.mockImplementation(async () => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  setGameMetricsCounters(noopGameMetricsCounters);
});

describe('the escrow critical section rides the per-character save queue (H5)', () => {
  it('acknowledges listing storage effects only after the escrow transaction commits', async () => {
    const committed = makeRig();
    const effect = storageEffect('listing-storage-commit');
    requirePlayerMeta(committed).bank.purchasedSlots = 6;
    expect(committed.server.stageStorageAppliedEffect(effect)).toBe(true);

    const listed = await createListing(committed);
    expect(listed.ok).toBe(true);
    expect(committed.db.escrowSaves[0]?.storageEffects).toEqual([effect]);
    expect(committed.session.pendingStorageAppliedEffects).toEqual([]);

    const refused = makeRig();
    const retained = storageEffect('listing-storage-refused');
    requirePlayerMeta(refused).bank.purchasedSlots = 6;
    expect(refused.server.stageStorageAppliedEffect(retained)).toBe(true);
    refused.db.failNextEscrow = 'cap_reached';

    await expect(createListing(refused)).resolves.toEqual({ ok: false, reason: 'cap_reached' });
    expect(refused.db.escrowSaves[0]?.storageEffects).toEqual([retained]);
    expect(refused.session.pendingStorageAppliedEffects).toEqual([retained]);
  });

  it('a stale autosave snapshot can never resurrect an escrowed item', async () => {
    const rig = makeRig();
    const kinds = recordEscrowKinds();
    const gate = holdNextAutosave(rig);
    const autosaveDone = rig.server.saveCharacter(rig.session);
    await vi.waitFor(() => expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1));

    // The listing rides in while that pre-extraction snapshot is in flight.
    const listingDone = createListing(rig);
    await settle();
    // The critical section has not even STARTED: nothing was extracted (the
    // live bags still hold the copy, so a crash right now loses nothing) and
    // no escrow write committed while the stale snapshot was in flight.
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);

    gate.release();
    const [saved, listed] = await Promise.all([autosaveDone, listingDone]);
    expect(saved).toBe(true);
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);

    // Commit order is queue order: the stale autosave first (item still
    // aboard, harmless because it commits BEFORE the extraction exists),
    // then the escrow write with a FRESH item-free blob. The LAST committed
    // blob must never hold the item once a listing exists.
    expect(rig.commits.map((c) => c.channel)).toEqual(['autosave', 'escrow']);
    expect(rig.commits[0]?.holdsItem).toBe(true);
    expect(rig.commits.at(-1)?.holdsItem).toBe(false);
    expect(rig.bagsHold(EPIC_ITEM)).toBe(false);
    expect(rig.db.escrowSaves).toHaveLength(1);
    // The production readout for the arm that RAN: one job started, no
    // refusal of any kind, and its held slot settled (the terminal kind
    // fires when the WORK settles, before the caller's await resumes).
    expect(kinds).toEqual(['started', 'settled']);
  });

  it('the escrow blob is serialized inside the job, after every queued commit', async () => {
    const rig = makeRig();
    const meta = rig.server.sim.players.get(rig.session.pid);
    if (!meta) throw new Error('missing player meta');
    meta.copper = 111;
    const gate = holdNextAutosave(rig);
    const autosaveDone = rig.server.saveCharacter(rig.session);
    await vi.waitFor(() => expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1));
    const listingDone = createListing(rig);
    await settle();
    // Money moves while the job is still queued: the committed escrow blob
    // must carry the LATER value, proving the job serializes at run time
    // rather than replaying a request-time snapshot.
    meta.copper = 999_999;
    gate.release();
    const [, listed] = await Promise.all([autosaveDone, listingDone]);
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
    expect(rig.db.escrowSaves).toHaveLength(1);
    expect(rig.db.escrowSaves[0]?.state.copper).toBe(999_999);
  });

  it('the escrow blob carries the session save fixups, not the raw live state', async () => {
    const rig = makeRig();
    // A spectating seller: the ordinary save persists the SAVED position and
    // the stowed pet, never the spectator body. The escrow write must apply
    // the same fixups or a listing while spectating corrupts the blob.
    const stowedPet = { name: 'Stowed', kind: 'wolf' } as unknown as NonNullable<
      ClientSession['spectating']
    >['stowedPet'];
    rig.session.spectating = {
      characterId: 999,
      name: 'Watched',
      savedPos: { x: 111, y: 0, z: 222 },
      priorGm: false,
      stowedPet,
    };
    // Non-vacuity control: the LIVE body stands somewhere else entirely and
    // carries no stowed pet, so neither pin below can be satisfied by a raw
    // serialization that happens to agree with the fixup.
    const live = rig.server.sim.serializeCharacter(rig.session.pid);
    if (!live) throw new Error('missing live serialization');
    expect(live.pos).not.toEqual({ x: 111, z: 222 });
    expect(live.pet).not.toEqual(stowedPet);
    const listed = await createListing(rig);
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
    const blob = rig.db.escrowSaves[0]?.state;
    expect(blob?.pos).toEqual({ x: 111, z: 222 });
    // Non-null on purpose: a null pet also serializes as null with the fixups
    // dropped, so only a real stowed pet can catch the regression.
    expect(blob?.pet).toEqual(stowedPet);
  });

  it('the escrow blob carries the JAIL fixup, cage position and sentence alike', async () => {
    const rig = makeRig();
    // The other half of the same rule, and the one that is a moderation
    // escape rather than a cosmetic slip: a blob written from the raw
    // serialization drops the sentence, so the next load walks free.
    const jailed = { returnPos: { x: 40, z: -60 }, returnFacing: 1.25, until: 1_800_000_000_000 };
    rig.session.jailed = jailed;
    const live = rig.server.sim.serializeCharacter(rig.session.pid);
    if (!live) throw new Error('missing live serialization');
    const listed = await createListing(rig);
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
    const blob = rig.db.escrowSaves[0]?.state;
    // jailCageSpawn(21): cage index 1, so angle 0 and radius 11 off
    // JAIL_CENTER (-12000, -12000).
    expect(blob?.pos).toEqual({ x: -11_989, z: -12_000 });
    expect(blob?.jail).toEqual(jailed);
    // Non-vacuity control: the live body is nowhere near the cage and carries
    // no sentence of its own, so only the fixup can put either in the blob.
    expect(live.pos).not.toEqual({ x: -11_989, z: -12_000 });
    expect(live.jail).toBeUndefined();
  });

  it('grant and snapshot blobs carry the fixups too', () => {
    const rig = makeRig();
    const stowedPet = { name: 'Stowed', kind: 'wolf' } as unknown as NonNullable<
      ClientSession['spectating']
    >['stowedPet'];
    rig.session.spectating = {
      characterId: 999,
      name: 'Watched',
      savedPos: { x: 31, y: 0, z: 64 },
      priorGm: false,
      stowedPet,
    };
    const grant = rig.custody.grantCopy(SELLER, SELLER_CHAR, { itemId: EPIC_ITEM, count: 1 });
    if (!grant.ok) throw new Error(`grantCopy refused: ${grant.reason}`);
    expect(grant.save.state.pos).toEqual({ x: 31, z: 64 });
    expect(grant.save.state.pet).toEqual(stowedPet);
    const snap = rig.custody.snapshotCopy(SELLER, SELLER_CHAR);
    if (!snap.ok) throw new Error(`snapshotCopy refused: ${snap.reason}`);
    expect(snap.save.state.pos).toEqual({ x: 31, z: 64 });
    expect(snap.save.state.pet).toEqual(stowedPet);
  });

  it('a quarantined session cannot enter custody at all', async () => {
    const rig = makeRig();
    // A refused guild-bank escrow abandoned this session's live state; the
    // durable row (which still holds the item) is the only truth left, so
    // no custody op may read or persist ANY serialization of it.
    const mailBefore = rig.server.sim.postOffice.mail.length;
    rig.session.escrowQuarantined = true;
    expect(rig.server.wocCustodySession(SELLER_CHAR)).toBeNull();
    // The persist snapshot refuses on its own predicate too, not only through
    // the wrappers that consult wocCustodySession first.
    expect(rig.server.serializeCharacterForPersist(SELLER_CHAR)).toBeNull();
    const res = await createListing(rig);
    expect(res).toEqual({ ok: false, reason: 'character_invalid' });
    expect(rig.db.escrowSaves).toHaveLength(0);
    // No compensation parcel either: mailing over a durable blob that still
    // holds the item would mint the second copy.
    expect(rig.server.sim.postOffice.mail).toHaveLength(mailBefore);
    // Positive control for that absence: the return-parcel arm is real and
    // fires when the extraction pid is genuinely gone from the sim.
    const idsBefore = new Set(rig.server.sim.postOffice.mail.map((m) => m.id));
    const rowsBefore = rig.parcelRows.length;
    rig.custody.restoreCopy(999_999, SELLER_CHAR, { itemId: EPIC_ITEM, count: 2 });
    expect(rig.server.sim.postOffice.mail).toHaveLength(mailBefore + 1);
    const booked = rig.server.sim.postOffice.mail.filter((m) => !idsBefore.has(m.id));
    expect(booked).toHaveLength(1);
    // The whole parcel, not just its existence: addressed by the stable
    // character-id mailbox key, carrying the RETURN letter (never the delivery
    // or sold-notice twin) and the EXACT slot handed in.
    expect(booked[0]?.recipientKey).toBe(String(SELLER_CHAR));
    expect(booked[0]?.letterId).toBe('woc_market_return');
    expect(booked[0]?.letterId).toBe(WOC_MARKET_RETURN_LETTER.letterId);
    expect(booked[0]?.items).toEqual([{ itemId: EPIC_ITEM, count: 2 }]);
    // The in-memory book alone is not the item: the durable parcel row is
    // what makes the parcel survive a restart (the boot merge replays it
    // through the book-once dedupe). The row carries the SAME ref the letter
    // was booked with, so the replay can never double-book.
    expect(rig.parcelRows.length).toBe(rowsBefore + 1);
    const row = rig.parcelRows.at(-1);
    expect(row?.letter).toBe('return');
    expect(row?.recipient.key).toBe(String(SELLER_CHAR));
    expect(row?.items).toEqual([{ itemId: EPIC_ITEM, count: 2 }]);
    expect(row?.custodyRef).toBe(booked[0]?.custodyRef);
  });

  it('a refusal mid-leave restores the LIVE bags, never a second rail', async () => {
    const rig = makeRig();
    const mailBefore = rig.server.sim.postOffice.mail.length;
    // The session flips to left while the escrow write is in flight (a leave
    // begun mid-request). Its teardown flush is queued BEHIND this job, so
    // the durable row still holds the item: restoring the live bags lets the
    // flush persist them, while mailing here would risk two copies.
    rig.db.failNextEscrow = 'cap_reached';
    const origEscrow = rig.db.escrowInsertListing.bind(rig.db);
    rig.db.escrowInsertListing = async (save, listing) => {
      rig.session.left = true;
      return origEscrow(save, listing);
    };
    const res = await createListing(rig);
    expect(res).toEqual({ ok: false, reason: 'cap_reached' });
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.server.sim.postOffice.mail).toHaveLength(mailBefore);
  });

  it('a lease-fenced write restores the copy and kicks the displaced zombie', async () => {
    const rig = makeRig();
    const restores = vi.fn(rig.custody.restoreCopy);
    rig.custody.restoreCopy = restores;
    rig.db.failNextEscrow = 'lease_lost';
    const res = await createListing(rig);
    expect(res).toEqual({ ok: false, reason: 'lease_lost' });
    expect(restores).toHaveBeenCalledTimes(1);
    // The fence-out signal is the same one saveCharacter sends: the zombie is
    // torn down rather than left playing an unsaveable session.
    await vi.waitFor(() => expect(rig.session.left).toBe(true));
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(dbMock.saveCharacterAndMarketState).not.toHaveBeenCalled();
  });

  it('an ambiguous escrow throw quarantines instead of restoring', async () => {
    const rig = makeRig();
    const mailBefore = rig.server.sim.postOffice.mail.length;
    const restores = vi.fn(rig.custody.restoreCopy);
    rig.custody.restoreCopy = restores;
    rig.db.failNextEscrowThrow = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createListing(rig)).rejects.toThrow('broken pipe');
    errSpy.mockRestore();
    // No compensation path ran (the COMMIT may have landed, so a restore
    // could mint the copy twice) and no mail either: the quarantined session
    // is torn down and reloads from the durable row, correct in both
    // branches. The live player may already be gone by now (the kick), which
    // is why the pin is on the restore call, not the abandoned bags.
    expect(restores).not.toHaveBeenCalled();
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(rig.server.sim.postOffice.mail).toHaveLength(mailBefore);
    await vi.waitFor(() => expect(rig.session.left).toBe(true));
  });

  it('a terminal escrow signal for a pid that no longer owns the character does nothing', async () => {
    const rig = makeRig();
    dirtyOwnBook(rig);
    const rec = recordingWs();
    rig.session.ws = rec.ws as never;
    // The extraction pid IS the identity: the character was turned over to
    // another session between the job and this signal, and tearing down the
    // new holder over the old job's outcome would be the takeover bug.
    rig.server.escrowSessionLost(rig.session.pid + 1, SELLER_CHAR, 'ambiguous');
    await settle();
    expect(rig.session.escrowQuarantined).toBe(false);
    expect(rig.session.left).toBe(false);
    expect(errorFrames(rec.sent)).toEqual([]);
    // Nothing was unwound either: the marks, the log, and the live book are
    // exactly as they were.
    expect(rig.session.dirtyGuildBanks.get(GUILD)).toBe(1);
    expect(rig.session.unflushedGuildBankOps.get(GUILD)).toHaveLength(1);
    expect(rig.server.sim.serializeGuildBank(GUILD)?.treasury).toBe(1000);
  });

  it('an ambiguous loss reverts this session own book ops, quarantines, and kicks', async () => {
    const rig = makeRig();
    dirtyOwnBook(rig);
    const rec = recordingWs();
    rig.session.ws = rec.ws as never;
    rig.server.escrowSessionLost(rig.session.pid, SELLER_CHAR, 'ambiguous');
    expect(rig.session.escrowQuarantined).toBe(true);
    // The 500 comes back off the LIVE book: this session can never persist
    // it, so leaving it there would be guild copper no save will ever back.
    expect(rig.server.sim.serializeGuildBank(GUILD)?.treasury).toBe(500);
    expect(rig.session.dirtyGuildBanks.size).toBe(0);
    expect(rig.session.unflushedGuildBankOps.size).toBe(0);
    await vi.waitFor(() => expect(rig.session.left).toBe(true));
    // The WIRE literal is the matcher-covered takeover string. The internal
    // 'market escrow ambiguous' kind is a LEAVE reason for the log only: on
    // the wire it would reach the client as an unlocalizable mystery.
    expect(errorFrames(rec.sent)).toEqual([{ t: 'error', error: 'character taken over' }]);
    expect(rec.sent.join('|')).not.toContain('market escrow');
  });

  it('an ambiguous loss on an already departing session quarantines without a second kick', async () => {
    const rig = makeRig();
    const rec = recordingWs();
    rig.session.ws = rec.ws as never;
    const leaveSpy = vi.spyOn(rig.server, 'leave');
    // A leave that already began: the quarantine flag still has to land (its
    // queued flush re-checks it, which is what stops that flush committing
    // bags-without-the-copy), but the teardown must not run twice.
    rig.session.left = true;
    rig.server.escrowSessionLost(rig.session.pid, SELLER_CHAR, 'ambiguous');
    await settle();
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(rig.session.left).toBe(true);
    expect(leaveSpy).not.toHaveBeenCalled();
    expect(errorFrames(rec.sent)).toEqual([]);
  });

  it('flushes dirty guild books BEFORE the escrow write, atomically with their character half', async () => {
    const rig = makeRig();
    rig.server.sim.loadGuildBank(GUILD, { treasury: 1000, inventory: [], purchasedSlots: 24 });
    rig.session.dirtyGuildBanks.set(GUILD, 1);
    const order: string[] = [];
    dbMock.saveCharacterAndGuildBankState.mockImplementation(async () => {
      order.push('books');
      return true;
    });
    const origEscrow = rig.db.escrowInsertListing.bind(rig.db);
    rig.db.escrowInsertListing = async (save, listing) => {
      order.push('escrow');
      return origEscrow(save, listing);
    };
    const listed = await createListing(rig);
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
    // The book-carrying save committed first (character half + book half in
    // one transaction), so the escrow write's character-row-only commit can
    // never make a book-paired character half durable without its book.
    expect(order).toEqual(['books', 'escrow']);
    expect(rig.server.hasDirtyGuildBooks(SELLER_CHAR)).toBe(false);
  });

  it('quarantines when a dirty guild book has lost its live shadow', async () => {
    const rig = makeRig();
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    // A dirty mark for a guild with NO loaded book is an impossible terminal
    // state: the character half cannot be proved against its book half. The
    // flush must abandon this live session instead of advertising a retry that
    // can never make the missing shadow reappear.
    rig.session.dirtyGuildBanks.set(999, 1);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createListing(rig);
    const logged = errSpy.mock.calls.map((call) => String(call[0]));
    errSpy.mockRestore();
    expect(res).toEqual({ ok: false, reason: 'character_invalid' });
    // The terminal kick may already have removed the live player by the time
    // the request settles. Durability is the proof that matters: neither the
    // character/book save nor the listing write touched the pre-request row,
    // which still contains the item established above.
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(rig.db.escrowSaves).toHaveLength(0);
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(rig.session.dirtyGuildBanks.size).toBe(0);
    expect(
      logged.some((line) => line.includes('guild bank escrow rolled back for guild 999')),
    ).toBe(true);
  });

  it('refuses contended when the guild-book flush THROWS, never a 500', async () => {
    const rig = makeRig();
    const kinds = recordEscrowKinds();
    dirtyOwnBook(rig);
    // The flush save dies inside its transaction: the books are simply not
    // provably clean, which is the bounded typed refusal the seller retries,
    // not an exception out of the request.
    dbMock.saveCharacterAndGuildBankState.mockRejectedValueOnce(new Error('books down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createListing(rig);
    const logged = errSpy.mock.calls.map((call) => String(call[0]));
    errSpy.mockRestore();
    expect(res).toEqual({ ok: false, reason: 'contended' });
    // The job never started, so nothing left the bags and nothing crossed the
    // escrow edge: a refusal here owes no compensation.
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);
    // Booked under its own kind (the throw is a different operator story from
    // a queue that is merely busy), and still loud in the log. The failed
    // sequence still settles its slot: flush_failed without a paired settled
    // would read as a wedged sequence on the entered-minus-settled signal.
    expect(kinds).toEqual(['flush_failed', 'settled']);
    expect(
      logged.some((line) => line.includes(`guild-book flush failed for character ${SELLER_CHAR}`)),
    ).toBe(true);
  });

  it('refuses contended within the wait deadline instead of hanging, with nothing extracted', async () => {
    const rig = makeRig({ escrowWaitMs: 50 });
    const kinds = recordEscrowKinds();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    // Wedge the character's FIFO (any earlier job): the listing request must
    // give up within its deadline, and because the job never started,
    // nothing was extracted and no compensation is owed.
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const startedAt = Date.now();
    const res = await createListing(rig);
    // Within the injected 50ms deadline (generous margin), not the 5s
    // default: this is what pins that opts.escrowWaitMs is actually plumbed.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(res).toEqual({ ok: false, reason: 'contended' });
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);
    // The refusal an operator most needs to see is booked under its OWN kind:
    // the three 'contended' producers answer the same literal on the wire, so
    // the counter is the only thing that tells them apart.
    expect(kinds).toEqual(['deadline_refused']);
    releaseQueue();
    await wedge;
    await settle();
    // The cancelled job drained as a strict no-op (still nothing extracted,
    // still no write); a later listing works.
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);
    const retry = await createListing(rig);
    expect(retry.ok).toBe(true);
    // The cancelled job books nothing between the two beyond its own
    // 'settled' (the abandoned work drained and released its slot): it
    // returns before the 'started' counter, which is what proves it never
    // ran the job body; the retry then books its own started plus settled.
    expect(kinds).toEqual(['deadline_refused', 'settled', 'started', 'settled']);
  });

  it('a job that STARTED before the deadline answers its real outcome, never contended', async () => {
    // The deadline may fire while the transaction is already running; its
    // runtime is bounded by the transaction's own timeouts, and answering
    // 'contended' for a write that may commit would lie to the seller.
    const rig = makeRig({ escrowWaitMs: 30 });
    const origEscrow = rig.db.escrowInsertListing.bind(rig.db);
    rig.db.escrowInsertListing = async (save, listing) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return origEscrow(save, listing);
    };
    const res = await createListing(rig);
    if (!res.ok) throw new Error(`createListing refused: ${res.reason}`);
    expect(rig.db.escrowSaves).toHaveLength(1);
    expect(rig.bagsHold(EPIC_ITEM)).toBe(false);
  });

  it('caps queued escrow jobs at one per character', async () => {
    // A wait deadline the test can never reach: only the depth cap can
    // produce this refusal (the deadline path answers the identical literal,
    // which let a cap-less build pass an earlier version of this pin).
    // A REAL gate, so the refusal's effect on realm capacity is observable:
    // the per-character cap is checked BEFORE the gate precisely so a
    // depth-refused request takes no realm slot, and the release lives only
    // on the work promise, so a swapped order would acquire a hold that
    // nothing ever releases (a leaked slot until the 300s reclaim).
    const gate = createWocEscrowGate(4);
    const rig = makeRig({ escrowWaitMs: 60_000, escrowGate: gate });
    const kinds = recordEscrowKinds();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const first = createListing(rig);
    await settle();
    // Exactly one hold stands: the first request's.
    expect(gate.stats().inFlight).toBe(1);
    // The second request refuses IMMEDIATELY (depth cap), while the first is
    // still waiting for the wedge.
    const startedAt = Date.now();
    const second = await createListing(rig);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(second).toEqual({ ok: false, reason: 'contended' });
    // Booked as the DEPTH refusal, not the deadline one: the wait deadline
    // here is unreachable, so a build that answered from the wrong arm would
    // show up as the wrong kind.
    expect(kinds).toEqual(['depth_refused']);
    // And it took NO realm slot: still exactly the first request's hold.
    expect(gate.stats().inFlight).toBe(1);
    expect(gate.stats().refused).toBe(0);
    releaseQueue();
    await wedge;
    const firstOut = await first;
    expect(firstOut.ok).toBe(true);
    // Exactly ONE settled: the depth-refused request held nothing, so only
    // the first request's sequence releases a slot.
    expect(kinds).toEqual(['depth_refused', 'started', 'settled']);
    // The realm is fully free again: a depth refusal that had taken a slot
    // would strand it here, since only the work promise releases.
    await settle();
    expect(gate.stats().inFlight).toBe(0);
  });

  it('holds the depth-cap slot until the abandoned WORK settles, not until the waiter returns', async () => {
    // A deadline long enough that "immediate" and "waited it out" are far
    // apart on the clock, so the second refusal's ARM is legible from the
    // elapsed time as well as from the counter.
    const rig = makeRig({ escrowWaitMs: 300 });
    const kinds = recordEscrowKinds();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const first = await createListing(rig);
    expect(first).toEqual({ ok: false, reason: 'contended' });
    expect(kinds).toEqual(['deadline_refused']);

    // The waiter has returned, but its ABANDONED work is still queued on the
    // wedged FIFO. Releasing the depth-cap slot here (rather than when that
    // work settles) is what would let 5s retries stack flush after flush onto
    // a queue that is already wedged, so the retry must still refuse.
    const startedAt = Date.now();
    const second = await createListing(rig);
    const secondElapsed = Date.now() - startedAt;
    expect(second).toEqual({ ok: false, reason: 'contended' });
    // Both discriminators for the same claim: the counter names the arm (the
    // decisive one), and the clock rules out a second trip through the 300ms
    // deadline. The bound is generous on purpose: a loaded gate box can stall
    // wall time, and the counter already discriminates the arm.
    expect(kinds).toEqual(['deadline_refused', 'depth_refused']);
    expect(secondElapsed).toBeLessThan(250);

    releaseQueue();
    await wedge;
    await settle();
    // The slot IS released once the work finally settles: the character is
    // not wedged out of listing for the process lifetime. The abandoned
    // sequence's 'settled' lands exactly HERE (at work settlement, after the
    // depth refusal above), which is the terminal kind proving the slot
    // lifecycle rides the work, not the waiter.
    const third = await createListing(rig);
    expect(third.ok).toBe(true);
    expect(kinds).toEqual(['deadline_refused', 'depth_refused', 'settled', 'started', 'settled']);
  });

  it('refuses contended at the realm-global gate, holding nothing', async () => {
    // A saturated gate (cap 0 stands in for "every slot held by other
    // characters": the per-character depth cap cannot produce this arm, so
    // only the gate can). The refusal must hold no slot, extract nothing,
    // and book its OWN kind: on the wire all the queue refusals answer the
    // same 'contended', so the counter is the only discriminator.
    const gate = createWocEscrowGate(0);
    const rig = makeRig({ escrowGate: gate });
    const kinds = recordEscrowKinds();
    const res = await createListing(rig);
    expect(res).toEqual({ ok: false, reason: 'contended' });
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);
    expect(kinds).toEqual(['realm_refused']);
    expect(gate.stats()).toEqual({
      inFlight: 0,
      max: 0,
      refused: 1,
      reclaimed: 0,
      oldestHoldMs: 0,
    });
  });

  it('releases the gate slot when the WORK settles, not when the waiter returns', async () => {
    // The gate slot rides the depth-cap slot's lifecycle: an abandoned
    // (deadline-refused) sequence still holds its realm slot until its
    // queued work drains, or 5s retries could stack realm-wide capacity
    // onto FIFOs that are already wedged.
    const gate = createWocEscrowGate(1);
    const rig = makeRig({ escrowGate: gate, escrowWaitMs: 300 });
    const kinds = recordEscrowKinds();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const first = await createListing(rig);
    expect(first).toEqual({ ok: false, reason: 'contended' });
    expect(kinds).toEqual(['deadline_refused']);
    // The waiter returned, the work is still wedged: the realm slot is HELD.
    expect(gate.stats().inFlight).toBe(1);
    releaseQueue();
    await wedge;
    await settle();
    // The work settled: the slot is free and a fresh listing goes through.
    expect(gate.stats().inFlight).toBe(0);
    const retry = await createListing(rig);
    expect(retry.ok).toBe(true);
    expect(kinds).toEqual(['deadline_refused', 'settled', 'started', 'settled']);
    expect(gate.stats()).toEqual({
      inFlight: 0,
      max: 1,
      refused: 0,
      reclaimed: 0,
      oldestHoldMs: 0,
    });
  });

  it('attributes the extract-side serialize cost per listing, decisively', async () => {
    // Process-lifetime module counters, so assert DELTAS, and pin them with
    // a stubbed hi-res clock: the monotone forms (total >= before) were
    // tautologies over accumulating counters (the audit round's vacuous
    // pair), while a fixed 2.5ms bracket makes every accumulator decisive.
    const rig = makeRig();
    const before = wocEscrowSerializeStats();
    let tick = 0n;
    const hrtime = vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
      tick += 2_500_000n;
      return tick;
    });
    try {
      const res = await createListing(rig);
      expect(res.ok).toBe(true);
    } finally {
      hrtime.mockRestore();
    }
    const after = wocEscrowSerializeStats();
    expect(after.count).toBe(before.count + 1);
    expect(after.totalMs).toBeCloseTo(before.totalMs + 2.5, 6);
    expect(after.maxMs).toBeGreaterThanOrEqual(2.5);
  });

  it('the delivered save rides the FIFO with an in-slot serialize (the closed carve-out)', async () => {
    // The hazard the close removes: a stale pre-grant autosave committing
    // AFTER the grant's save rolled the delivered item back out of the
    // buyer's durable bags. Riding the FIFO orders the persist after every
    // earlier queued write, and serializing INSIDE the slot makes the blob
    // reflect the live bags at run time, not at call time: proven here by
    // granting an item DURING the wait and finding it in the persisted
    // state.
    const rig = makeRig();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const persisted: CharacterState[] = [];
    const grant = rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, async (save) => {
      persisted.push(save.state);
      return 'booked' as const;
    });
    await settle();
    // Still queued behind the wedge: nothing serialized yet.
    expect(persisted).toHaveLength(0);
    // The live bags change while the persist waits its turn; the in-slot
    // serialize must carry this.
    rig.server.sim.addItem(EPIC_ITEM, 1, rig.session.pid, { silent: true });
    releaseQueue();
    await wedge;
    expect(await grant).toBe('booked');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.inventory.some((s) => s.itemId === EPIC_ITEM)).toBe(true);
  });

  it('a wedged FIFO answers busy at the grant deadline, with nothing serialized or written', async () => {
    // The head-of-line bound the old carve-out demanded before the close was
    // safe: the locked delivery segment waits one bounded deadline, parks
    // the row, and moves on; the cancelled job later drains as a strict
    // no-op. Counted under its own kind (the review round: the one failure
    // mode the close introduced must never be silent).
    const kinds = recordEscrowKinds();
    const rig = makeRig({ escrowWaitMs: 300 });
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    let persistRuns = 0;
    const out = await rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, async () => {
      persistRuns++;
      return 'booked' as const;
    });
    expect(out).toBe('busy');
    expect(persistRuns).toBe(0);
    expect(kinds).toEqual(['grant_busy']);
    releaseQueue();
    await wedge;
    await settle();
    // The abandoned job drained without running the persist.
    expect(persistRuns).toBe(0);
  });

  it('a grant that STARTED before the deadline answers its real outcome, never busy', async () => {
    // The twin of the runSerialized arm: a persist that may commit must
    // never be reported 'busy' and parked as retryable (coverage round;
    // mirrors the listing entry's identical pin).
    const rig = makeRig({ escrowWaitMs: 200 });
    let persistRuns = 0;
    const out = await rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, async () => {
      persistRuns++;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return 'booked' as const;
    });
    expect(out).toBe('booked');
    expect(persistRuns).toBe(1);
  });

  it('the grant entry never touches the realm gate, and session_lost covers every guard dimension', async () => {
    // Two review-round pins in one rig. (1) The grant persist consumes NO
    // realm-gate capacity (the sweep taking listing capacity would couple
    // the two backpressure systems the spec designed apart). (2) The
    // in-slot revalidation is a four-dimension guard, and every dimension
    // must independently answer session_lost with the persist never run:
    // the nonce arm is pinned in its own rotation test; here the
    // wrong-account arm (the ownership fence), the torn-down-session arm,
    // and the null-serialize arm.
    const gate = createWocEscrowGate(1);
    const rig = makeRig({ escrowGate: gate });
    let persistRuns = 0;
    const persist = async () => {
      persistRuns++;
      return 'booked' as const;
    };
    // Wrong account: another account may never persist under this character.
    expect(await rig.custody.persistGrantSerialized(SELLER + 1, SELLER_CHAR, NONCE, persist)).toBe(
      'session_lost',
    );
    // Torn-down session: no live session for the character id.
    expect(await rig.custody.persistGrantSerialized(SELLER, 9999, NONCE, persist)).toBe(
      'session_lost',
    );
    expect(persistRuns).toBe(0);
    // The happy path under the same rig proves the guards above were the
    // deciding arms (and leaves the gate provably untouched throughout).
    expect(await rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, persist)).toBe(
      'booked',
    );
    expect(persistRuns).toBe(1);
    // Null serialize: quarantine the session (serializeCharacterForPersist
    // answers null for a quarantined session by contract).
    rig.session.escrowQuarantined = true;
    expect(await rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, persist)).toBe(
      'session_lost',
    );
    expect(persistRuns).toBe(1);
    expect(gate.stats()).toEqual({
      inFlight: 0,
      max: 1,
      refused: 0,
      reclaimed: 0,
      oldestHoldMs: 0,
    });
  });

  it('a THROWING escrow job still releases both slots (the rejection arm of the release)', async () => {
    // The review round: releaseSlot rides work.then(resolve, REJECT); a
    // dropped rejection handler would leak the depth-cap slot AND a realm
    // gate slot for the process lifetime on every throwing job.
    const gate = createWocEscrowGate(1);
    const rig = makeRig({ escrowGate: gate });
    await expect(
      rig.custody.runSerialized(SELLER_CHAR, async () => {
        throw new Error('job blew up');
      }),
    ).rejects.toThrow('job blew up');
    await settle();
    expect(gate.stats().inFlight).toBe(0);
    // The freed slots admit the next sequence.
    const res = await createListing(rig);
    expect(res.ok).toBe(true);
  });

  it('a lease rotated during the grant wait answers session_lost under the slot', async () => {
    // The pre-checks in the delivery arms catch a rotation BEFORE the wait;
    // this is the in-slot re-validation catching one DURING it, the window
    // where only the FIFO position knows the truth.
    const rig = makeRig();
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    let persistRuns = 0;
    const grant = rig.custody.persistGrantSerialized(SELLER, SELLER_CHAR, NONCE, async () => {
      persistRuns++;
      return 'booked' as const;
    });
    await settle();
    rig.session.leaseNonce = 'nonce-rotated';
    releaseQueue();
    await wedge;
    expect(await grant).toBe('session_lost');
    expect(persistRuns).toBe(0);
  });

  it('a held escrow FIFO stalls only its own save: the saveAll wave drains every other character', async () => {
    // The owed saveAll-wave suppression MEASUREMENT (dbperf proof 3), taken
    // as a pinned fact: there is NO suppression mechanism, escrow protection
    // is FIFO ordering alone, and the wave's worker-pool structure bounds
    // the interaction to exactly this shape: a wedged escrow-held FIFO costs
    // ONE worker slot (its character's save waits behind the job), every
    // other character still drains through the remaining workers, and the
    // wave's COMPLETION honestly waits out the held slot. At most
    // SAVE_CONCURRENCY simultaneously escrow-held characters could stall the
    // wave, which is why the realm gate is sized to that constant.
    const rig = makeRig({ escrowWaitMs: 60_000 });
    rig.join(22, 22, 'Belra');
    rig.join(23, 23, 'Celra');
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    // Stands in for a running escrow job: the job IS an enqueueCharacterWrite
    // thunk, and holding the FIFO head is its only coupling to the wave.
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    dbMock.saveCharacterState.mockClear();
    const savedIds = () => dbMock.saveCharacterState.mock.calls.map((args) => args[0] as number);
    let waveDone = false;
    const wave = rig.server.saveAll('autosave').then(() => {
      waveDone = true;
    });
    await settle();
    // The free characters drained while the wedged one waits, and the wave
    // is still honestly open (its completion includes the held save).
    expect(savedIds().sort((a, b) => a - b)).toEqual([22, 23]);
    expect(waveDone).toBe(false);
    releaseQueue();
    await wedge;
    await wave;
    expect(waveDone).toBe(true);
    expect(savedIds()).toContain(SELLER_CHAR);
  });

  it('warns when a queue wait crosses the warn threshold', async () => {
    // A wait deadline far past the wedge, so the job RUNS and the only thing
    // under test is the observability floor for a slow queue.
    const rig = makeRig({ escrowWaitMs: 60_000, escrowWarnMs: 1, escrowWarnThrottleMs: 0 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const listingDone = createListing(rig);
    setTimeout(releaseQueue, 30);
    const listed = await listingDone;
    await wedge;
    const warns = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('escrow queue wait'));
    warnSpy.mockRestore();
    if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(`character ${SELLER_CHAR}`);
  });

  it('throttles the queue-wait warn to one line per burst', async () => {
    const rig = makeRig({ escrowWaitMs: 60_000, escrowWarnMs: 1, escrowWarnThrottleMs: 60_000 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slowListing = async (): Promise<number> => {
      let releaseQueue!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
        await held;
      });
      const startedAt = Date.now();
      const listingDone = createListing(rig);
      setTimeout(releaseQueue, 30);
      const listed = await listingDone;
      await wedge;
      if (!listed.ok) throw new Error(`createListing refused: ${listed.reason}`);
      return Date.now() - startedAt;
    };
    const firstWaited = await slowListing();
    // A second copy for the second listing: the first one is escrowed now.
    rig.server.sim.addItem(EPIC_ITEM, 1, rig.session.pid, { silent: true });
    const secondWaited = await slowListing();
    const warns = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('escrow queue wait'));
    warnSpy.mockRestore();
    // Both waits were warn-eligible (well past the 1ms threshold), so the
    // single line is the throttle, not a second job that happened to be fast.
    expect(firstWaited).toBeGreaterThanOrEqual(20);
    expect(secondWaited).toBeGreaterThanOrEqual(20);
    expect(warns).toHaveLength(1);
  });

  it('refuses contended when the books re-dirty during the queue wait', async () => {
    const rig = makeRig({ escrowWaitMs: 10_000 });
    const kinds = recordEscrowKinds();
    rig.server.sim.loadGuildBank(GUILD, { treasury: 1000, inventory: [], purchasedSlots: 24 });
    let releaseQueue!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const wedge = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
    });
    const listingDone = createListing(rig);
    await settle();
    // The flush ran clean at entry; a book op lands while the job is queued.
    // The in-job re-check must refuse rather than commit a character row
    // whose book-paired deltas have no book half in the same transaction.
    rig.session.dirtyGuildBanks.set(999, 1);
    releaseQueue();
    await wedge;
    const res = await listingDone;
    expect(res).toEqual({ ok: false, reason: 'contended' });
    expect(rig.bagsHold(EPIC_ITEM)).toBe(true);
    expect(rig.db.escrowSaves).toHaveLength(0);
    // The in-job re-check refused, so the job never reached 'started': that
    // pairing is what separates this arm from a job that ran and failed. The
    // sequence still settles its held slot.
    expect(kinds).toEqual(['books_dirty_refused', 'settled']);
  });

  it('every custody FIFO write rides one of the two sanctioned custody entries', () => {
    // The old commitGrant carve-out is CLOSED (the escrow write-path rider):
    // the delivered save now rides custody's bounded persistGrantSerialized,
    // so the FIFO surface is exactly TWO custody entries (the listing's
    // runSerialized, the grant's persistGrantSerialized) and this pin holds
    // the counts: exactly ONE runSerialized call site in the service
    // (createListing), exactly ONE persistGrantSerialized call site in the
    // delivery arms (commitGrant), zero direct enqueueCharacterWrite
    // anywhere outside custody, and custody itself holds exactly the two
    // host.enqueueCharacterWrite seams. Widening any of these must land
    // here in the same change.
    const src = stripComments(readFileSync(resolve(process.cwd(), 'server/woc_market.ts'), 'utf8'));
    expect(src.match(/\.runSerialized\(/g)).toHaveLength(1);
    expect(src).not.toContain('enqueueCharacterWrite');
    // The gauge made GameServer.characterSaveQueues publicly readable, which
    // opens a SECOND door (its enqueue) the two tokens above cannot see; the
    // marketplace modules must never touch the field directly (the
    // qa-checklist round's door-closing judgment: a narrowing getter on
    // game.ts would cost lines against its zero-headroom ceiling).
    expect(src).not.toContain('characterSaveQueues');
    // The coordinator DECLARES the member on the custody interface but never
    // calls it: the call form (dot plus paren) is what stays at zero here.
    expect(src).not.toContain('.persistGrantSerialized(');
    const custodySrc = stripComments(
      readFileSync(resolve(process.cwd(), 'server/woc_market_custody.ts'), 'utf8'),
    );
    expect(custodySrc.match(/host\.enqueueCharacterWrite/g)).toHaveLength(2);
    const deliverySrc = stripComments(
      readFileSync(resolve(process.cwd(), 'server/woc_market_delivery.ts'), 'utf8'),
    );
    expect(deliverySrc.match(/\.persistGrantSerialized\(/g)).toHaveLength(1);
    // The service module is not the only place a custody character write
    // could appear: the sweep and the monitor run the same domain on their
    // own clocks. Counting only in woc_market.ts would date a carve-out a
    // sibling module had already widened, so those two carry a flat zero.
    for (const sibling of [
      'server/woc_market_sweep.ts',
      'server/woc_market_monitor.ts',
      // The extracted delivery arms reach the FIFO ONLY through the
      // sanctioned persistGrantSerialized site counted above; everything
      // else stays flat zero here like the sweep and the monitor.
      'server/woc_market_delivery.ts',
    ]) {
      const siblingSrc = stripComments(readFileSync(resolve(process.cwd(), sibling), 'utf8'));
      // Non-vacuity: a file read that silently produced nothing would satisfy
      // both absence checks below.
      expect(siblingSrc).toContain('export function create');
      expect(siblingSrc).not.toContain('.runSerialized(');
      expect(siblingSrc).not.toContain('enqueueCharacterWrite');
      expect(siblingSrc).not.toContain('characterSaveQueues');
      if (sibling !== 'server/woc_market_delivery.ts') {
        expect(siblingSrc).not.toContain('persistGrantSerialized');
      }
      // The realm-global escrow gate is custody-only by decision (the
      // write-path rider): the sweep and the monitor taking it would couple
      // their backpressure to the listing path's (the enqueueMarketWrite
      // latency chain recorded in the rider spec), so they carry the same
      // flat zero for the gate they carry for the FIFO.
      expect(siblingSrc).not.toContain('EscrowGate');
      expect(siblingSrc).not.toContain('tryAcquire');
    }
  });

  it('wocCustodySession refuses a quarantined session for every custody op', () => {
    const rig = makeRig();
    expect(rig.server.wocCustodySession(SELLER_CHAR)).not.toBeNull();
    rig.session.escrowQuarantined = true;
    expect(rig.server.wocCustodySession(SELLER_CHAR)).toBeNull();
  });

  it('enqueueCharacterWrite shares the saveCharacter FIFO, per character only', async () => {
    const rig = makeRig();
    const other = rig.join(22, 22, 'Brint');
    const order: string[] = [];
    let releaseJob!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const jobDone = rig.server.enqueueCharacterWrite(SELLER_CHAR, async () => {
      await held;
      order.push('job');
      return 'ran';
    });
    dbMock.saveCharacterState.mockImplementation(async (id: number) => {
      order.push(`save:${id}`);
      return true;
    });
    const saveA = rig.server.saveCharacter(rig.session);
    // Character B's save is NOT serialized behind A's held job: the queue is
    // per character, never realm-wide.
    await rig.server.saveCharacter(other);
    expect(order).toEqual(['save:22']);
    releaseJob();
    await saveA;
    expect(await jobDone).toBe('ran');
    expect(order).toEqual(['save:22', 'job', 'save:21']);
  });

  it('a cancelled queued save never starts or reaches the database', async () => {
    const rig = makeRig();
    const targetCharacterId = 31_337;
    const target = rig.join(31_337, targetCharacterId, 'CancelledSave');
    // Joining schedules unrelated account-flair/welcome work. Let that drain
    // and establish a clean write baseline before exercising this save.
    await settle();
    dbMock.saveCharacterState.mockClear();
    dbMock.saveCharacterAndGuildBankState.mockClear();
    dbMock.saveCharacterAndMarketState.mockClear();
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockingWrite = rig.server.enqueueCharacterWrite(targetCharacterId, async () => {
      await blocker;
    });
    const shouldStart = vi.fn(() => false);

    const cancelled = rig.server.saveCharacter(target, { shouldStart });
    releaseBlocker();
    await blockingWrite;

    await expect(cancelled).resolves.toBe(false);
    expect(shouldStart).toHaveBeenCalledTimes(1);
    expect(dbMock.saveCharacterState.mock.calls.some((call) => call[0] === targetCharacterId)).toBe(
      false,
    );
    expect(
      dbMock.saveCharacterAndGuildBankState.mock.calls.some(
        (call) => call[0] === targetCharacterId,
      ),
    ).toBe(false);
    expect(
      dbMock.saveCharacterAndMarketState.mock.calls.some((call) => call[0] === targetCharacterId),
    ).toBe(false);
  });

  it('saveCharacter still propagates a db throw to its caller through the queue', async () => {
    const rig = makeRig();
    dbMock.saveCharacterState.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await expect(rig.server.saveCharacter(rig.session)).rejects.toThrow('db down');
    // The chain is not poisoned: the next save for the same character runs.
    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(true);
  });

  it('quarantines and counts a durable bank-ledger ceiling refusal', async () => {
    const rig = makeRig();
    const reservation = rig.session.bankLedgerJournal.reserveVaultConsumption(
      [{ itemId: 'copper_ore', count: 1 }],
      0,
    );
    if (!reservation) throw new Error('expected a ledger reservation');
    reservation.commit();
    let refusals = 0;
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      bankLedgerGrowthLimitRefused() {
        refusals++;
      },
    });
    const refusal = new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000);
    dbMock.saveCharacterState.mockRejectedValueOnce(refusal);

    await expect(rig.server.saveCharacter(rig.session)).rejects.toBe(refusal);
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(refusals).toBe(1);
    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(false);
    expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1);
  });

  it('quarantines a market-only growth refusal and completes the terminal wire teardown', async () => {
    const rig = makeRig();
    const rec = recordingWs();
    rig.session.ws = rec.ws as never;
    expect(rig.session.dirtyGuildBanks.size).toBe(0);
    const reservation = rig.session.bankLedgerJournal.reserveVaultConsumption(
      [{ itemId: 'copper_ore', count: 1 }],
      0,
    );
    if (!reservation) throw new Error('expected a ledger reservation');
    reservation.commit();

    let refusals = 0;
    const guildIncidents: string[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      bankLedgerGrowthLimitRefused() {
        refusals++;
      },
      guildBankIncident(kind) {
        guildIncidents.push(kind);
      },
    });
    const refusal = new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000);
    dbMock.saveCharacterAndMarketState.mockRejectedValueOnce(refusal);

    await expect(rig.server.saveCharacter(rig.session, { withMarket: true })).rejects.toBe(refusal);
    expect(dbMock.saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
    expect(dbMock.saveCharacterAndGuildBankState).not.toHaveBeenCalled();
    expect(rig.session.escrowQuarantined).toBe(true);
    expect(refusals).toBe(1);
    expect(guildIncidents).toEqual([]);

    await vi.waitFor(() => expect(rig.session.left).toBe(true));
    expect(errorFrames(rec.sent)).toEqual([
      { t: 'error', error: 'character state could not be saved' },
    ]);
    expect(rec.close).toHaveBeenCalledTimes(1);
    await expect(rig.server.saveCharacter(rig.session, { withMarket: true })).resolves.toBe(false);
    expect(dbMock.saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
  });

  it('propagates an ordinary market-only save error without quarantining the session', async () => {
    const rig = makeRig();
    expect(rig.session.dirtyGuildBanks.size).toBe(0);
    const reservation = rig.session.bankLedgerJournal.reserveVaultConsumption(
      [{ itemId: 'copper_ore', count: 1 }],
      0,
    );
    if (!reservation) throw new Error('expected a ledger reservation');
    reservation.commit();

    let refusals = 0;
    const guildIncidents: string[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      bankLedgerGrowthLimitRefused() {
        refusals++;
      },
      guildBankIncident(kind) {
        guildIncidents.push(kind);
      },
    });
    const dbError = new Error('market save unavailable');
    dbMock.saveCharacterAndMarketState.mockRejectedValueOnce(dbError);

    await expect(rig.server.saveCharacter(rig.session, { withMarket: true })).rejects.toBe(dbError);
    expect(rig.session.escrowQuarantined).toBe(false);
    expect(refusals).toBe(0);
    expect(guildIncidents).toEqual([]);

    await expect(rig.server.saveCharacter(rig.session, { withMarket: true })).resolves.toBe(true);
    expect(dbMock.saveCharacterAndMarketState).toHaveBeenCalledTimes(2);
  });

  it('a save queue never admits a second storage purchase behind its captured effect', async () => {
    const rig = makeRig();
    const meta = requirePlayerMeta(rig);
    const first = storageEffect('storage-a');
    const second = storageEffect('storage-b', 'strongbox_rung_02', 6, 12);
    meta.bank.purchasedSlots = 6;
    expect(rig.server.stageStorageAppliedEffect(first)).toBe(true);

    let finish!: (saved: boolean) => void;
    dbMock.saveCharacterState.mockImplementationOnce(
      async () => new Promise<boolean>((resolve) => (finish = resolve)),
    );
    const saving = rig.server.saveCharacter(rig.session);
    await vi.waitFor(() => expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1));
    expect(dbMock.saveCharacterState.mock.calls[0]?.[4]).toEqual([first]);

    meta.bank.purchasedSlots = 12;
    expect(() => rig.server.stageStorageAppliedEffect(second)).toThrow(
      /different pending purchase/,
    );
    finish(true);
    await expect(saving).resolves.toBe(true);
    expect(rig.session.pendingStorageAppliedEffects).toEqual([]);
  });

  it('a throwing save retains staged storage effects for a later commit', async () => {
    const rig = makeRig();
    const effect = storageEffect('storage-retry');
    requirePlayerMeta(rig).bank.purchasedSlots = 6;
    expect(rig.server.stageStorageAppliedEffect(effect)).toBe(true);

    dbMock.saveCharacterState.mockRejectedValueOnce(new Error('db down'));
    await expect(rig.server.saveCharacter(rig.session)).rejects.toThrow('db down');
    expect(rig.session.pendingStorageAppliedEffects).toEqual([effect]);

    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(true);
    expect(rig.session.pendingStorageAppliedEffects).toEqual([]);
  });

  it('a lease-fenced save never retries staged effects from the displaced session', async () => {
    const rig = makeRig();
    const effect = storageEffect('storage-fenced');
    requirePlayerMeta(rig).bank.purchasedSlots = 6;
    expect(rig.server.stageStorageAppliedEffect(effect)).toBe(true);

    // A real lease-fence miss stays false for the displaced lease. Mark this
    // fixture as already departing so the wire teardown is outside this pin.
    rig.session.left = true;
    dbMock.saveCharacterState.mockResolvedValueOnce(false);
    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(false);
    expect(rig.session.pendingStorageAppliedEffects).toEqual([effect]);
    expect(rig.session.escrowQuarantined).toBe(true);
    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(false);
    expect(dbMock.saveCharacterState).toHaveBeenCalledTimes(1);
  });

  it('a missing serializable character refuses while a storage effect is pending', async () => {
    const rig = makeRig();
    requirePlayerMeta(rig).bank.purchasedSlots = 6;
    expect(rig.server.stageStorageAppliedEffect(storageEffect('storage-no-state'))).toBe(true);
    rig.server.sim.removePlayer(rig.session.pid);

    await expect(rig.server.saveCharacter(rig.session)).resolves.toBe(false);
    expect(dbMock.saveCharacterState).not.toHaveBeenCalled();
    expect(rig.session.pendingStorageAppliedEffects).toHaveLength(1);
  });

  it('a WOC acknowledgement from the pre-takeover lease cannot touch the new lease', () => {
    const rig = makeRig();
    const effect = storageEffect('storage-takeover');
    requirePlayerMeta(rig).bank.purchasedSlots = 6;
    expect(rig.server.stageStorageAppliedEffect(effect)).toBe(true);
    const snap = rig.custody.snapshotCopy(SELLER, SELLER_CHAR);
    if (!snap.ok) throw new Error(`snapshotCopy refused: ${snap.reason}`);
    expect(snap.save.leaseNonce).toBe(NONCE);

    rig.session.leaseNonce = 'nonce-after-takeover';
    rig.custody.acknowledgeCharacterSave?.(snap.save);

    expect(rig.session.pendingStorageAppliedEffects).toEqual([effect]);
  });
});
