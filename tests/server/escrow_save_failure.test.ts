// Guards: which thrown character save counts as `escrow_save_failed`
// (server/escrow_save_failure.ts): only a save that carried dirty guild books,
// and never the three refusals with their own handling (a book refusal, a
// durable-ledger growth refusal, a housing mutation refusal). The nearest
// suite, tests/guild_bank_persistence.test.ts, drives the counter through
// whole guild-bank saves and never reaches a housing refusal.
//
// Cost: 5 ms

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BankLedgerGrowthLimitExceeded } from '../../server/bank_ledger_growth_budget';
import { countsAsEscrowSaveFailure } from '../../server/escrow_save_failure';
import { FreeholdMutationRefused } from '../../server/freehold_mutation';
import { GuildBankEscrowRefused } from '../../server/guild_bank_state';
import { stripComments } from '../helpers/strip_comments';

describe('countsAsEscrowSaveFailure', () => {
  const failure = new Error('the escrow transaction failed');

  it('counts a real failure only when the save carried guild books', () => {
    expect(countsAsEscrowSaveFailure(failure, true)).toBe(true);
    expect(countsAsEscrowSaveFailure(failure, false)).toBe(false);
  });

  it('never counts the three refusals that have their own handling, each on its own', () => {
    for (const refusal of [
      new GuildBankEscrowRefused([]),
      new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000),
      new FreeholdMutationRefused({ kind: 'claim', plotId: 'plot:a' }),
    ]) {
      expect(countsAsEscrowSaveFailure(refusal, true), refusal.name).toBe(false);
    }
  });

  it('is the one rule the save path consults', () => {
    const game = stripComments(readFileSync('server/game.ts', 'utf8'));
    expect(game.split('countsAsEscrowSaveFailure(err, carriesGuildBooks)').length - 1).toBe(1);
    // ONE increment of the incident in the whole coordinator, and it is the
    // statement the rule gates: no second, ungated path can count a refusal.
    expect(game.split("guildBankIncident('escrow_save_failed')").length - 1).toBe(1);
    const rule = game.indexOf('countsAsEscrowSaveFailure(err, carriesGuildBooks)');
    const count = game.indexOf("guildBankIncident('escrow_save_failed')");
    expect(count).toBeGreaterThan(rule);
    expect(game.slice(rule, count)).not.toMatch(/[;}]/);
  });
});
