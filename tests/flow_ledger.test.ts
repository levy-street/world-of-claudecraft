// Exercises the buy>sell invariant in server/flow_ledger.ts: the pure
// emissionDecision arithmetic, and the FlowLedger service over an in-memory
// FakeFlowLedgerDb that models the two load-bearing DB guarantees — the UNIQUE
// tx_sig replay guard and the per-season serialization of budget decisions. No
// Postgres, no chain.
import { describe, it, expect } from 'vitest';
import {
  FlowLedger,
  directionOf,
  emissionDecision,
  type EmitResult,
  type FlowEntryInput,
  type FlowLedgerDb,
  type InflowResult,
} from '../server/flow_ledger';

// In-memory FlowLedgerDb. Mirrors the production contract: inflows are idempotent
// on a non-null txSig; recordOutflowWithinBudget serializes per season (modeling
// the advisory lock) so two payouts cannot both spend the same headroom.
class FakeFlowLedgerDb implements FlowLedgerDb {
  seasons = new Map<number, 'active' | 'closed' | 'finalized'>();
  entries: Array<{ entryId: number; seasonId: number; direction: 'in' | 'out'; amountBase: bigint; txSig: string | null }> = [];
  payoutSigs = new Set<string>();
  private seq = 0;
  private locks = new Map<number, Promise<unknown>>();

  async ensureSeason(seasonId: number): Promise<void> {
    if (!this.seasons.has(seasonId)) this.seasons.set(seasonId, 'active');
  }
  setStatus(seasonId: number, status: 'active' | 'closed' | 'finalized'): void {
    this.seasons.set(seasonId, status);
  }
  private headroomSync(seasonId: number): bigint {
    let h = 0n;
    for (const e of this.entries) {
      if (e.seasonId !== seasonId) continue;
      h += e.direction === 'in' ? e.amountBase : -e.amountBase;
    }
    return h;
  }
  async seasonHeadroom(seasonId: number): Promise<bigint> {
    return this.headroomSync(seasonId);
  }
  async seasonIsOpen(seasonId: number): Promise<boolean> {
    return (this.seasons.get(seasonId) ?? 'active') === 'active';
  }
  async recordInflow(input: FlowEntryInput): Promise<InflowResult> {
    if (input.txSig && this.entries.some((e) => e.txSig === input.txSig)) return { ok: false, reason: 'duplicate' };
    const entryId = ++this.seq;
    this.entries.push({ entryId, seasonId: input.seasonId, direction: 'in', amountBase: input.amountBase, txSig: input.txSig ?? null });
    return { ok: true, entryId };
  }
  async recordOutflowWithinBudget(input: FlowEntryInput): Promise<EmitResult> {
    return this.withSeasonLock(input.seasonId, async () => {
      if (input.txSig && (this.payoutSigs.has(input.txSig) || this.entries.some((e) => e.txSig === input.txSig))) {
        return { ok: false, reason: 'duplicate', headroomBase: 0n };
      }
      const headroom = this.headroomSync(input.seasonId);
      // A yield between read and write: if the lock were missing, a second
      // concurrent emit could read the same headroom and over-spend. The lock
      // makes this safe; the test below proves it.
      await Promise.resolve();
      const decision = emissionDecision(headroom, input.amountBase);
      if (!decision.allow) return { ok: false, reason: decision.reason, headroomBase: headroom };
      const entryId = ++this.seq;
      this.entries.push({ entryId, seasonId: input.seasonId, direction: 'out', amountBase: input.amountBase, txSig: input.txSig ?? null });
      if (input.txSig) this.payoutSigs.add(input.txSig);
      return { ok: true, headroomBase: headroom - input.amountBase, entryId, payoutId: this.seq };
    });
  }
  private async withSeasonLock<T>(seasonId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(seasonId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => (release = res));
    this.locks.set(seasonId, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const sink = (seasonId: number, amountBase: bigint, txSig?: string): FlowEntryInput => ({
  seasonId,
  source: 'gamblefi_burn_rake',
  amountBase,
  txSig,
});
const emit = (seasonId: number, amountBase: bigint, txSig?: string): FlowEntryInput => ({
  seasonId,
  source: 'leaderboard_payout',
  amountBase,
  txSig,
  recipient: 'Winner111',
});

describe('emissionDecision (pure invariant)', () => {
  it('rejects non-positive amounts', () => {
    expect(emissionDecision(1000n, 0n)).toEqual({ allow: false, reason: 'bad_amount' });
    expect(emissionDecision(1000n, -5n)).toEqual({ allow: false, reason: 'bad_amount' });
  });
  it('allows an emission strictly under headroom', () => {
    expect(emissionDecision(1000n, 600n)).toEqual({ allow: true });
  });
  it('allows an emission exactly at headroom (net zero, never negative)', () => {
    expect(emissionDecision(1000n, 1000n)).toEqual({ allow: true });
  });
  it('refuses an emission one unit over headroom', () => {
    expect(emissionDecision(1000n, 1001n)).toEqual({ allow: false, reason: 'budget_exceeded' });
  });
  it('refuses any emission against zero headroom (empty pool pays nothing)', () => {
    expect(emissionDecision(0n, 1n)).toEqual({ allow: false, reason: 'budget_exceeded' });
  });
});

describe('directionOf', () => {
  it('classifies sinks as in and emissions as out', () => {
    expect(directionOf('gamblefi_stake')).toBe('in');
    expect(directionOf('marketplace_buyback')).toBe('in');
    expect(directionOf('gamblefi_payout')).toBe('out');
    expect(directionOf('leaderboard_payout')).toBe('out');
  });
});

describe('FlowLedger service', () => {
  const setup = async () => {
    const db = new FakeFlowLedgerDb();
    const ledger = new FlowLedger(db);
    await ledger.ensureSeason(1);
    return { db, ledger };
  };

  it('rejects a crossed direction (inflow source emitted, outflow source credited)', async () => {
    const { ledger } = await setup();
    expect((await ledger.emit({ seasonId: 1, source: 'gamblefi_stake', amountBase: 10n })).reason).toBe('wrong_direction');
    expect((await ledger.creditInflow({ seasonId: 1, source: 'leaderboard_payout', amountBase: 10n })).reason).toBe('wrong_direction');
  });

  it('emits only up to verified sinks, then refuses (the faucet caps itself)', async () => {
    const { ledger } = await setup();
    await ledger.creditInflow(sink(1, 1000n, 'in-a'));
    const a = await ledger.emit(emit(1, 600n, 'out-a'));
    expect(a.ok).toBe(true);
    expect(a.headroomBase).toBe(400n);
    const b = await ledger.emit(emit(1, 400n, 'out-b'));
    expect(b.ok).toBe(true);
    expect(b.headroomBase).toBe(0n);
    const c = await ledger.emit(emit(1, 1n, 'out-c'));
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('budget_exceeded');
    expect(await ledger.headroom(1)).toBe(0n);
  });

  it('an empty-revenue season pays nothing (the #480-before-engine case)', async () => {
    const { ledger } = await setup();
    const r = await ledger.emit(emit(1, 100n, 'x'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('budget_exceeded');
  });

  it('isolates seasons: season 1 sinks cannot fund a season 2 emission', async () => {
    const { db, ledger } = await setup();
    await db.ensureSeason(2);
    await ledger.creditInflow(sink(1, 1000n, 's1-in'));
    const cross = await ledger.emit(emit(2, 500n, 's2-out'));
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe('budget_exceeded');
  });

  it('is idempotent on a replayed inflow tx (no double-credit)', async () => {
    const { ledger } = await setup();
    expect((await ledger.creditInflow(sink(1, 1000n, 'dup-in'))).ok).toBe(true);
    expect((await ledger.creditInflow(sink(1, 1000n, 'dup-in'))).reason).toBe('duplicate');
    expect(await ledger.headroom(1)).toBe(1000n);
  });

  it('is idempotent on a replayed payout tx (no double-spend)', async () => {
    const { ledger } = await setup();
    await ledger.creditInflow(sink(1, 1000n, 'in'));
    expect((await ledger.emit(emit(1, 500n, 'dup-out'))).ok).toBe(true);
    expect((await ledger.emit(emit(1, 500n, 'dup-out'))).reason).toBe('duplicate');
    expect(await ledger.headroom(1)).toBe(500n);
  });

  it('refuses inflows to a closed season', async () => {
    const { db, ledger } = await setup();
    db.setStatus(1, 'closed');
    expect((await ledger.creditInflow(sink(1, 100n, 'late'))).reason).toBe('season_closed');
  });

  it('serializes concurrent payouts so two cannot both spend the same headroom', async () => {
    const { ledger } = await setup();
    await ledger.creditInflow(sink(1, 1000n, 'in'));
    // Both want 700 against 1000 headroom; the invariant must let exactly one through.
    const [a, b] = await Promise.all([ledger.emit(emit(1, 700n, 'race-a')), ledger.emit(emit(1, 700n, 'race-b'))]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1);
    expect([a, b].find((r) => !r.ok)?.reason).toBe('budget_exceeded');
    const hr = await ledger.headroom(1);
    expect(hr).toBe(300n);
    expect(hr >= 0n).toBe(true);
  });

  it('keeps net >= 0 across a mixed sequence (sum out never exceeds sum in)', async () => {
    const { ledger } = await setup();
    let inSig = 0;
    let outSig = 0;
    const amounts: Array<['in' | 'out', bigint]> = [
      ['in', 300n], ['out', 100n], ['in', 50n], ['out', 250n], ['out', 100n], ['in', 500n], ['out', 400n], ['out', 100n],
    ];
    for (const [dir, amt] of amounts) {
      if (dir === 'in') await ledger.creditInflow(sink(1, amt, `i${inSig++}`));
      else await ledger.emit(emit(1, amt, `o${outSig++}`));
      expect((await ledger.headroom(1)) >= 0n).toBe(true);
    }
  });
});
