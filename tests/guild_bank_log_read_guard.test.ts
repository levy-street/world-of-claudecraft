// The dedicated guild bank HISTORY read bucket (server/guild_bank_log_read_guard.ts),
// split off the guild bank OP bucket at the transaction-history review: burst
// and refill arithmetic, refusal-spends-nothing, the idle cap, and the
// backwards-clock clamp, all with injected time only. The GameServer-seam
// wiring (a history read never draws an op token, and a read flood tallies
// into the shared abuse window) is pinned in tests/guild_bank_log_server.test.ts.

import { describe, expect, it } from 'vitest';
import {
  consumeGuildBankLogReadToken,
  createGuildBankLogReadGuard,
  GUILD_BANK_LOG_READ_BURST,
  GUILD_BANK_LOG_READ_REFILL_PER_SECOND,
} from '../server/guild_bank_log_read_guard';
import { GUILD_BANK_OP_BURST } from '../server/guild_bank_op_guard';

describe('guild bank history read guard budget arithmetic', () => {
  it('pins the constants against disagreeing literals', () => {
    expect(GUILD_BANK_LOG_READ_BURST).toBe(20);
    expect(GUILD_BANK_LOG_READ_REFILL_PER_SECOND).toBe(2);
    // The whole point of the split: a reader's burst is wider than the op
    // bucket, so a click storm through the chips and Show older can never
    // have been what drains a member's deposits.
    expect(GUILD_BANK_LOG_READ_BURST).toBeGreaterThan(GUILD_BANK_OP_BURST);
  });

  it('allows exactly the burst at one instant and refuses the next draw', () => {
    const state = createGuildBankLogReadGuard(1000);
    for (let i = 0; i < GUILD_BANK_LOG_READ_BURST; i++) {
      expect(consumeGuildBankLogReadToken(state, 1000)).toBe(true);
    }
    expect(consumeGuildBankLogReadToken(state, 1000)).toBe(false);
  });

  it('spends nothing on a refusal', () => {
    const state = createGuildBankLogReadGuard(1000);
    for (let i = 0; i < GUILD_BANK_LOG_READ_BURST; i++) consumeGuildBankLogReadToken(state, 1000);
    const drained = { ...state };
    expect(consumeGuildBankLogReadToken(state, 1000)).toBe(false);
    expect(state).toEqual(drained);
  });

  it('refills at the stated rate and never past the burst cap', () => {
    const state = createGuildBankLogReadGuard(1000);
    for (let i = 0; i < GUILD_BANK_LOG_READ_BURST; i++) consumeGuildBankLogReadToken(state, 1000);
    expect(consumeGuildBankLogReadToken(state, 1000.25)).toBe(false);
    expect(consumeGuildBankLogReadToken(state, 1000.5)).toBe(true);
    // A long idle refills to the cap, not beyond it.
    for (let i = 0; i < GUILD_BANK_LOG_READ_BURST; i++) consumeGuildBankLogReadToken(state, 5000);
    expect(consumeGuildBankLogReadToken(state, 5000)).toBe(false);
  });

  it('clamps a backwards clock instead of minting tokens', () => {
    const state = createGuildBankLogReadGuard(1000);
    for (let i = 0; i < GUILD_BANK_LOG_READ_BURST; i++) consumeGuildBankLogReadToken(state, 1000);
    expect(consumeGuildBankLogReadToken(state, 900)).toBe(false);
  });
});
