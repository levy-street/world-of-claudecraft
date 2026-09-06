// The guild roster purchase coordinator (server/guild_roster_transport.ts):
// the live purse charge, the exact post-charge snapshot, the one atomic write,
// and the arm taken on every outcome, against a real Sim purse and a fake
// game host. The recovery arms the review demanded are pinned here: a lost
// lease abandons the live session, an unknown COMMIT is NEVER refunded and
// abandons the live session, and every known refusal refunds the purse.
import { describe, expect, it, vi } from 'vitest';
import type { GuildRosterPageArgs, GuildRosterPageResult } from '../server/guild_roster_page_db';
import {
  GUILD_ROSTER_PURCHASE_SURFACE,
  type GuildRosterPurchaseHost,
  guildRosterTransport,
} from '../server/guild_roster_transport';
import { Sim } from '../src/sim/sim';

const GOLD = 10_000;
const CHAR = 7;
const GUILD = 42;
const ACCOUNT = 5;
const LEASE = 'lease-1';
const PRICE = 40 * GOLD;

interface HarnessOptions {
  purse?: number;
  session?: 'live' | 'gone' | 'no_lease';
  conflict?: boolean;
  snapshot?: 'live' | 'gone' | 'throws';
  acknowledge?: boolean | 'throws';
  result?: GuildRosterPageResult | ((args: GuildRosterPageArgs) => Promise<GuildRosterPageResult>);
  /** Delay before a queued job starts (a busy save FIFO); default immediate. */
  slotDelayMs?: number;
  queueWaitMs?: number;
}

function harness(opts: HarnessOptions = {}) {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  meta.copper = opts.purse ?? 50 * GOLD;
  const ledgerSnapshot = {
    owner: { realm: 'r', characterId: CHAR, accountId: ACCOUNT },
    rowCount: 0,
    batches: [],
  };
  const order: string[] = [];
  const writer = vi.fn(async (args: GuildRosterPageArgs): Promise<GuildRosterPageResult> => {
    order.push('write');
    const result = opts.result ?? { durability: 'committed', pages: 1 };
    return typeof result === 'function' ? result(args) : result;
  });
  const host: GuildRosterPurchaseHost = {
    sim,
    wocCustodySession: vi.fn(() =>
      opts.session === 'gone'
        ? null
        : { pid, accountId: ACCOUNT, leaseNonce: opts.session === 'no_lease' ? undefined : LEASE },
    ),
    enqueueCharacterWrite: vi.fn(async (_characterId, job) => {
      if (opts.slotDelayMs) await new Promise((r) => setTimeout(r, opts.slotDelayMs));
      order.push('slot');
      const value = await job();
      order.push('slot-done');
      return value;
    }),
    hasCharacterOnlySaveConflict: vi.fn(() => opts.conflict ?? false),
    serializeCharacterForPersist: vi.fn(() => {
      if (opts.snapshot === 'throws') throw new Error('serialize exploded');
      return opts.snapshot === 'gone'
        ? null
        : {
            level: 3,
            state: sim.serializeCharacter(pid)!,
            storageEffects: [],
            bankLedgerSnapshot: ledgerSnapshot as never,
          };
    }),
    acknowledgeCharacterSaveEffects: vi.fn(() => {
      if (opts.acknowledge === 'throws') {
        throw new Error('bank ledger acknowledgement changed after preflight');
      }
      return opts.acknowledge ?? true;
    }),
    escrowSessionLost: vi.fn(),
  };
  const log = { info: vi.fn(), error: vi.fn() };
  const transport = guildRosterTransport(host, writer, {
    log,
    newBatchKey: () => 'roster:test',
    ...(opts.queueWaitMs !== undefined ? { queueWaitMs: opts.queueWaitMs } : {}),
  });
  const buy = () => transport.buyRosterPage(CHAR, GUILD, 0, PRICE);
  return { sim, pid, meta, host, writer, log, order, buy, ledgerSnapshot };
}

describe('guildRosterTransport: the happy path', () => {
  it('charges the live purse, writes the post-charge snapshot atomically, and acknowledges', async () => {
    const h = harness();
    await expect(h.buy()).resolves.toEqual({ outcome: 'ok', pages: 1 });
    // The purse lost exactly the price and keeps it (COMMIT is authoritative).
    expect(h.meta.copper).toBe(10 * GOLD);
    // The write carried the guild CAS inputs, the buyer's lease, and a
    // snapshot taken AFTER the charge (its purse already shows the deduction).
    expect(h.writer).toHaveBeenCalledTimes(1);
    const args = h.writer.mock.calls[0][0];
    expect(args).toMatchObject({
      guildId: GUILD,
      expectedPages: 0,
      characterId: CHAR,
      accountId: ACCOUNT,
      level: 3,
      leaseNonce: LEASE,
      receipt: { batchKey: 'roster:test', copper: PRICE },
    });
    expect(args.state.copper).toBe(10 * GOLD);
    expect(args.ledgerEffects).toBeUndefined();
    // The effect prefix is acknowledged by the SAME captured snapshot object.
    const ack = vi.mocked(h.host.acknowledgeCharacterSaveEffects);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0][0].bankLedgerSnapshot).toBe(h.ledgerSnapshot);
    expect(ack.mock.calls[0][0].leaseNonce).toBe(LEASE);
    expect(h.host.escrowSessionLost).not.toHaveBeenCalled();
    // The audit line names the guild, the page, the buyer, and the copper.
    expect(h.log.info).toHaveBeenCalledTimes(1);
    const line = String(h.log.info.mock.calls[0][0]);
    expect(line).toContain(`guild ${GUILD}`);
    expect(line).toContain('page 1');
    expect(line).toContain(`character ${CHAR}`);
    expect(line).toContain(`${PRICE} copper`);
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it('runs the whole purchase inside the character save FIFO slot', async () => {
    const h = harness();
    await h.buy();
    expect(h.host.enqueueCharacterWrite).toHaveBeenCalledWith(CHAR, expect.any(Function));
    expect(h.order).toEqual(['slot', 'write', 'slot-done']);
  });
});

describe('guildRosterTransport: refusals before any write', () => {
  it('a session that is gone answers session_lost with nothing charged or written', async () => {
    const h = harness({ session: 'gone' });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
  });

  it('a session with no lease yet is asked to retry, nothing charged', async () => {
    const h = harness({ session: 'no_lease' });
    await expect(h.buy()).resolves.toEqual({ outcome: 'retry' });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
  });

  it('a dirty guild book (a character-only save would split it) is asked to retry', async () => {
    const h = harness({ conflict: true });
    await expect(h.buy()).resolves.toEqual({ outcome: 'retry' });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
  });

  it('a short purse is refunded whole and refused with cannotAfford', async () => {
    const h = harness({ purse: 30 * GOLD });
    await expect(h.buy()).resolves.toEqual({ outcome: 'cannotAfford' });
    expect(h.meta.copper).toBe(30 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it('a lost snapshot after the charge refunds and answers session_lost', async () => {
    const h = harness({ snapshot: 'gone' });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
  });
});

describe('guildRosterTransport: known refusals from the write refund the purse', () => {
  it.each([
    ['stale', { durability: 'not_committed', reason: 'stale' }, { outcome: 'stale' }],
    ['no_guild', { durability: 'not_committed', reason: 'no_guild' }, { outcome: 'no_guild' }],
  ] as const)('%s', async (_name, result, outcome) => {
    const h = harness({ result });
    await expect(h.buy()).resolves.toEqual(outcome);
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.host.escrowSessionLost).not.toHaveBeenCalled();
    expect(h.host.acknowledgeCharacterSaveEffects).not.toHaveBeenCalled();
  });

  it('a write that provably rolled back refunds and answers retry with the cause', async () => {
    const boom = new Error('boom');
    const h = harness({
      result: { durability: 'not_committed', reason: 'database_error', error: boom },
    });
    await expect(h.buy()).resolves.toEqual({ outcome: 'retry', error: boom });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.host.escrowSessionLost).not.toHaveBeenCalled();
  });

  it('is loud when a refund cannot land whole (operator compensation)', async () => {
    const h = harness({
      result: async () => {
        // The purse hit the integer-safe ceiling between charge and refund.
        h.meta.copper = Number.MAX_SAFE_INTEGER;
        return { durability: 'not_committed', reason: 'stale' };
      },
    });
    await expect(h.buy()).resolves.toEqual({ outcome: 'stale' });
    expect(h.log.error).toHaveBeenCalledTimes(1);
    expect(String(h.log.error.mock.calls[0][0])).toContain('operator compensation needed');
    expect(String(h.log.error.mock.calls[0][0])).toContain(`character ${CHAR}`);
  });
});

describe('guildRosterTransport: the recovery arms', () => {
  it('a lease lost at COMMIT refunds the dead live copy and abandons the session as fenced', async () => {
    const h = harness({ result: { durability: 'not_committed', reason: 'lease_lost' } });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.host.escrowSessionLost).toHaveBeenCalledWith(
      h.pid,
      CHAR,
      'fenced',
      GUILD_ROSTER_PURCHASE_SURFACE,
    );
  });

  it('a refund shortfall on a lost lease is noted, not an operator alarm (nothing durable was charged)', async () => {
    const h = harness({
      result: async () => {
        h.meta.copper = Number.MAX_SAFE_INTEGER;
        return { durability: 'not_committed', reason: 'lease_lost' };
      },
    });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.log.error).not.toHaveBeenCalled();
    expect(h.log.info).toHaveBeenCalledTimes(1);
    expect(String(h.log.info.mock.calls[0][0])).toContain('nothing durable was charged');
  });

  it('an unknown COMMIT is NEVER refunded: the purse stays charged and the session is abandoned', async () => {
    const lost = new Error('socket closed during COMMIT');
    const h = harness({ result: { durability: 'commit_ambiguous', error: lost } });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    // Refunding here would pay the buyer twice if the page landed.
    expect(h.meta.copper).toBe(10 * GOLD);
    expect(h.host.escrowSessionLost).toHaveBeenCalledWith(
      h.pid,
      CHAR,
      'ambiguous',
      GUILD_ROSTER_PURCHASE_SURFACE,
    );
    expect(h.host.acknowledgeCharacterSaveEffects).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledTimes(1);
    expect(String(h.log.error.mock.calls[0][0])).toContain('unknown COMMIT');
    expect(h.log.error.mock.calls[0][1]).toBe(lost);
  });

  it('a committed page whose effect prefix no longer matches abandons the session, purse kept', async () => {
    const h = harness({ acknowledge: false });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(10 * GOLD);
    expect(h.host.escrowSessionLost).toHaveBeenCalledWith(
      h.pid,
      CHAR,
      'ambiguous',
      GUILD_ROSTER_PURCHASE_SURFACE,
    );
    // The audit line still records the committed page.
    expect(h.log.info).toHaveBeenCalledTimes(1);
  });
});

describe('guildRosterTransport: a throw after the charge can never strand the purse', () => {
  it('a throw before the write refunds and rethrows to the dispatcher', async () => {
    const h = harness({ snapshot: 'throws' });
    await expect(h.buy()).rejects.toThrow('serialize exploded');
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
    expect(h.host.escrowSessionLost).not.toHaveBeenCalled();
  });

  it('a write that REJECTS (durability unknown) keeps the charge and abandons the session', async () => {
    const h = harness({
      result: async () => {
        throw new Error('writer exploded mid-flight');
      },
    });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(10 * GOLD);
    expect(h.host.escrowSessionLost).toHaveBeenCalledWith(
      h.pid,
      CHAR,
      'ambiguous',
      GUILD_ROSTER_PURCHASE_SURFACE,
    );
    expect(String(h.log.error.mock.calls[0][0])).toContain('durability unknown');
  });

  it('an acknowledgement that THROWS after a committed page abandons the session, purse kept', async () => {
    const h = harness({ acknowledge: 'throws' });
    await expect(h.buy()).resolves.toEqual({ outcome: 'session_lost' });
    expect(h.meta.copper).toBe(10 * GOLD);
    expect(h.host.escrowSessionLost).toHaveBeenCalledWith(
      h.pid,
      CHAR,
      'ambiguous',
      GUILD_ROSTER_PURCHASE_SURFACE,
    );
    // The committed page is still on the audit trail.
    expect(h.log.info).toHaveBeenCalledTimes(1);
  });
});

describe('guildRosterTransport: one purchase per character, bounded slot wait', () => {
  it('a repeated command while a purchase is in flight answers busy without touching the purse', async () => {
    let release: (r: GuildRosterPageResult) => void = () => {};
    let writes = 0;
    const h = harness({
      // Only the FIRST write hangs (until released); later ones land at once.
      result: () => {
        writes += 1;
        return writes === 1
          ? new Promise<GuildRosterPageResult>((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ durability: 'committed', pages: 1 });
      },
    });
    const first = h.buy();
    await new Promise((r) => setTimeout(r, 0));
    await expect(h.buy()).resolves.toEqual({ outcome: 'busy' });
    expect(h.writer).toHaveBeenCalledTimes(1);
    release({ durability: 'committed', pages: 1 });
    await expect(first).resolves.toEqual({ outcome: 'ok', pages: 1 });
    expect(h.meta.copper).toBe(10 * GOLD);
    // The guard clears with the purchase: the next command runs.
    h.meta.copper = 50 * GOLD;
    await expect(h.buy()).resolves.toEqual({ outcome: 'ok', pages: 1 });
  });

  it('un-started work past the slot wait is cancelled, nothing charged, and asks for a retry', async () => {
    const h = harness({ slotDelayMs: 40, queueWaitMs: 5 });
    await expect(h.buy()).resolves.toEqual({ outcome: 'retry' });
    expect(String(h.log.error.mock.calls[0][0])).toContain('cancelled un-started');
    // The slot arrives later and finds the job cancelled: a strict no-op.
    await new Promise((r) => setTimeout(r, 60));
    expect(h.meta.copper).toBe(50 * GOLD);
    expect(h.writer).not.toHaveBeenCalled();
  });

  it('work that started before the deadline answers its truth however long the write takes', async () => {
    const h = harness({
      queueWaitMs: 5,
      result: () =>
        new Promise<GuildRosterPageResult>((resolve) =>
          setTimeout(() => resolve({ durability: 'committed', pages: 1 }), 30),
        ),
    });
    await expect(h.buy()).resolves.toEqual({ outcome: 'ok', pages: 1 });
    expect(h.meta.copper).toBe(10 * GOLD);
  });
});
