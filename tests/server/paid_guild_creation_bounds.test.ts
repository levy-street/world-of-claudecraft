// The coordinator's admission bounds: PAID_GUILD_CREATE_MAX_IN_FLIGHT and
// PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS were exercised by no test. These arms
// drive the module seam directly with a fake host and mock timers.
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bankLedgerSaveEffects: vi.fn(() => undefined),
  acknowledgeCharacterSaveEffects: vi.fn(() => true),
  recordDeedUnlocks: vi.fn(),
  enqueueLinkChange: vi.fn(),
  storageAppliedEffectsCommitted: vi.fn(),
}));

vi.mock('../../server/bank_ledger_session', () => ({
  bankLedgerSaveEffects: mocks.bankLedgerSaveEffects,
  acknowledgeCharacterSaveEffects: mocks.acknowledgeCharacterSaveEffects,
}));
vi.mock('../../server/deeds_records', () => ({ recordDeedUnlocks: mocks.recordDeedUnlocks }));
vi.mock('../../server/discord_link_changes', () => ({
  enqueueLinkChange: mocks.enqueueLinkChange,
}));
vi.mock('../../server/storage_purchases', () => ({
  storageAppliedEffectsCommitted: mocks.storageAppliedEffectsCommitted,
}));

import type { ClientSession } from '../../server/game';
import {
  createPaidGuildCreationCoordinator,
  PAID_GUILD_CREATE_MAX_IN_FLIGHT,
  PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS,
  type PaidGuildCreationHost,
} from '../../server/paid_guild_creation';
import { KeyedSerialWriteAborted } from '../../server/serial_writer';
import type { GuildCreateResult } from '../../server/social';
import { GUILD_CREATION_FEE_COPPER } from '../../src/sim/guild_bank';

const BUSY_NOTICE = 'You are busy. Try again in a moment.';

function fakeSession(characterId: number, pid: number) {
  const outbox = {
    tryReserve: vi.fn(() => ({ batchKey: `batch:${characterId}` })),
    cancel: vi.fn(),
    hasQueuedGuildRows: false,
  };
  const session = {
    accountId: 7,
    characterId,
    pid,
    left: false,
    escrowQuarantined: false,
    leaseNonce: 'lease',
    dirtyGuildBanks: new Set<number>(),
    bankLedgerJournal: { outbox },
    pendingDeedRecords: [],
    pendingStorageAppliedEffects: [],
    lastSave: 0,
    lastPersistedLevel: 5,
    guildCreateSettlement: undefined,
  } as unknown as ClientSession;
  return { session, outbox };
}

type EnqueueCancellable = (
  key: number,
  signal: AbortSignal,
  write: () => Promise<unknown>,
) => Promise<unknown>;

function makeHost(enqueueCancellable: EnqueueCancellable) {
  const notices: string[] = [];
  const createResults: GuildCreateResult[] = [];
  const copper = new Map<number, number>();
  const sessions = new Map<number, ClientSession>();
  const host: PaidGuildCreationHost = {
    characterSaveQueues: {
      enqueueCancellable: enqueueCancellable as never,
    },
    sessionByCharacterId: (characterId) => sessions.get(characterId),
    copperFor: (pid) => copper.get(pid),
    hasEntity: () => true,
    chargeFee: (pid) => {
      copper.set(pid, (copper.get(pid) ?? 0) - GUILD_CREATION_FEE_COPPER);
      return GUILD_CREATION_FEE_COPPER;
    },
    refundFee: (pid, amount) => {
      copper.set(pid, (copper.get(pid) ?? 0) + amount);
      return amount;
    },
    serializeForPersist: () => ({
      level: 5,
      state: {} as never,
      storageEffects: [],
      bankLedgerSnapshot: {} as never,
    }),
    createAtomic: vi.fn(async (args) => ({
      durability: 'committed' as const,
      guildId: 900 + args.characterId,
      feeBatchKey: args.fee.batchKey,
    })),
    guildCreate: async (session, rawName, create) => {
      const result = await create(rawName, session.characterId);
      createResults.push(result);
      return true;
    },
    sendNotice: (_session, text) => notices.push(text),
    quarantineProjection: vi.fn(),
    quarantineGrowthLimit: vi.fn(),
    bustCommittedGuildLog: vi.fn(),
    kick: vi.fn(),
    logSocialError: vi.fn(),
  };
  const admit = (characterId: number, pid: number) => {
    const made = fakeSession(characterId, pid);
    sessions.set(characterId, made.session);
    copper.set(pid, GUILD_CREATION_FEE_COPPER * 5);
    return made;
  };
  return { host, notices, createResults, copper, admit };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('paid guild creation bounds', () => {
  it('pins the in-flight cap and queue timeout literals', () => {
    expect(PAID_GUILD_CREATE_MAX_IN_FLIGHT).toBe(2);
    expect(PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS).toBe(70_000);
  });

  it('refuses a third concurrent create with the busy notice while two hold slots', () => {
    const enqueue = vi.fn((): Promise<unknown> => new Promise(() => {}));
    const { host, notices, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const first = admit(1, 101);
    const second = admit(2, 102);
    const third = admit(3, 103);

    coordinator.start(first.session, 'Iron Vanguard');
    coordinator.start(second.session, 'Stone Watch');
    expect(coordinator.pendingCount).toBe(2);
    expect(notices).toEqual([]);

    coordinator.start(third.session, 'Third Banner');
    expect(notices).toEqual([BUSY_NOTICE]);
    expect(coordinator.pendingCount).toBe(2);
    // The refusal held nothing: no FIFO job, no ledger reservation.
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(third.outbox.tryReserve).not.toHaveBeenCalled();
  });

  it('times a queued create out at exactly 70s, resolves busy, and releases its slot', async () => {
    vi.useFakeTimers();
    const enqueue = (
      _key: number,
      signal: AbortSignal,
      _write: () => Promise<unknown>,
    ): Promise<unknown> =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new KeyedSerialWriteAborted()), {
          once: true,
        });
      });
    const { host, notices, createResults, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const queued = admit(1, 101);

    coordinator.start(queued.session, 'Iron Vanguard');
    expect(coordinator.pendingCount).toBe(1);

    // One millisecond short of the deadline the create still waits.
    await vi.advanceTimersByTimeAsync(PAID_GUILD_CREATE_QUEUE_TIMEOUT_MS - 1);
    expect(createResults).toEqual([]);
    expect(coordinator.pendingCount).toBe(1);

    // At exactly 70s the queue abort fires, the FIFO rejects the unstarted
    // job, and the coordinator resolves the typed busy refusal.
    await vi.advanceTimersByTimeAsync(1);
    expect(createResults).toEqual([{ error: 'busy' }]);
    expect(coordinator.pendingCount).toBe(0);
    expect(queued.outbox.cancel).toHaveBeenCalledWith({ batchKey: 'batch:1' });
    expect(notices).toEqual([]);

    // The released slot admits a fresh create immediately.
    const next = admit(2, 102);
    coordinator.start(next.session, 'Stone Watch');
    expect(coordinator.pendingCount).toBe(1);
    expect(notices).toEqual([]);
  });

  it('silently ignores a duplicate create while the character already has one pending', () => {
    const enqueue = vi.fn((): Promise<unknown> => new Promise(() => {}));
    const { host, notices, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const first = admit(1, 101);

    coordinator.start(first.session, 'Iron Vanguard');
    expect(coordinator.pendingCount).toBe(1);
    coordinator.start(first.session, 'Iron Vanguard Again');

    // The duplicate arm is a deliberate silent early return: no notice, no
    // second FIFO job, no second ledger reservation, slot count unchanged.
    expect(notices).toEqual([]);
    expect(coordinator.pendingCount).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(first.outbox.tryReserve).toHaveBeenCalledTimes(1);
  });

  it('refuses with the fee notice when the founder cannot afford the fee', () => {
    const enqueue = vi.fn((): Promise<unknown> => new Promise(() => {}));
    const { host, notices, copper, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const poor = admit(1, 101);
    copper.set(101, GUILD_CREATION_FEE_COPPER - 1);

    coordinator.start(poor.session, 'Iron Vanguard');

    expect(notices).toEqual(['You need 1 gold to found a guild.']);
    expect(coordinator.pendingCount).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(poor.outbox.tryReserve).not.toHaveBeenCalled();
  });

  it('refuses with the busy notice when the ledger outbox cannot reserve the fee row', () => {
    const enqueue = vi.fn((): Promise<unknown> => new Promise(() => {}));
    const { host, notices, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const starved = admit(1, 101);
    starved.outbox.tryReserve.mockReturnValueOnce(null as never);

    coordinator.start(starved.session, 'Iron Vanguard');

    expect(notices).toEqual([BUSY_NOTICE]);
    expect(coordinator.pendingCount).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(starved.outbox.cancel).not.toHaveBeenCalled();
  });

  it('releases slots on completion so later creates are admitted without refusal', async () => {
    const enqueue = (
      _key: number,
      _signal: AbortSignal,
      write: () => Promise<unknown>,
    ): Promise<unknown> => write();
    const { host, notices, createResults, copper, admit } = makeHost(enqueue);
    const coordinator = createPaidGuildCreationCoordinator(host);
    const first = admit(1, 101);

    coordinator.start(first.session, 'Iron Vanguard');
    await first.session.guildCreateSettlement;

    expect(createResults).toEqual([{ guildId: 901 }]);
    expect(coordinator.pendingCount).toBe(0);
    expect(mocks.acknowledgeCharacterSaveEffects).toHaveBeenCalledTimes(1);
    expect(copper.get(101)).toBe(GUILD_CREATION_FEE_COPPER * 4);

    const second = admit(2, 102);
    const third = admit(3, 103);
    coordinator.start(second.session, 'Stone Watch');
    await second.session.guildCreateSettlement;
    coordinator.start(third.session, 'Third Banner');
    await third.session.guildCreateSettlement;

    expect(notices).toEqual([]);
    expect(createResults).toEqual([{ guildId: 901 }, { guildId: 902 }, { guildId: 903 }]);
    expect(coordinator.pendingCount).toBe(0);
  });
});
