// server/character_save_result.ts: the two save-outcome rules the family shared
// by copy before they were extracted. Both are load-bearing refusals, so each
// arm is driven on its own rather than through one save path that would only
// ever exercise the branch it happens to take.
import { describe, expect, it } from 'vitest';
import {
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
} from '../../server/bank_ledger_growth_budget';
import type { BankLedgerSaveEffects } from '../../server/bank_ledger_save_effects_db';
import { characterSaveFailure, characterSaveLanded } from '../../server/character_save_result';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';

const NO_EFFECTS: readonly StorageAppliedEffect[] = [];
// A real effect record, not a cast: the predicate keys on the LIST being
// non-empty, and a well-formed row keeps that honest if the shape ever grows.
const ONE_EFFECT: readonly StorageAppliedEffect[] = [
  {
    realm: 'test-realm',
    accountId: 7,
    characterId: 42,
    itemId: 'strongbox_rung_01',
    expectedCostClaudium: 100,
    idempotencyKey: 'character-save-result-1',
    spendClaimToken: '00000000-0000-4000-8000-000000000001',
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 6,
  },
];
// The predicate only asks whether a ledger is PRESENT, so the narrowest honest
// stand-in is an empty batch list rather than a `never`.
const LEDGER = { batches: [] } as unknown as BankLedgerSaveEffects;

describe('characterSaveLanded: whose zero rows mean "persist nothing"', () => {
  it('reports the unconditional write as landed whatever the row count', () => {
    expect(characterSaveLanded(undefined, NO_EFFECTS, undefined, 0)).toBe(true);
    expect(characterSaveLanded(undefined, NO_EFFECTS, undefined, null)).toBe(true);
    expect(characterSaveLanded(undefined, NO_EFFECTS, undefined, 1)).toBe(true);
  });

  it('judges a lease-fenced save on its row count alone', () => {
    expect(characterSaveLanded('nonce', NO_EFFECTS, undefined, 0)).toBe(false);
    expect(characterSaveLanded('nonce', NO_EFFECTS, undefined, null)).toBe(false);
    expect(characterSaveLanded('nonce', NO_EFFECTS, undefined, 1)).toBe(true);
  });

  it('judges a storage-effect save on its row count even with no fence', () => {
    expect(characterSaveLanded(undefined, ONE_EFFECT, undefined, 0)).toBe(false);
    expect(characterSaveLanded(undefined, ONE_EFFECT, undefined, 1)).toBe(true);
  });

  it('judges a ledger-effect save on its row count even with no fence', () => {
    expect(characterSaveLanded(undefined, NO_EFFECTS, LEDGER, 0)).toBe(false);
    expect(characterSaveLanded(undefined, NO_EFFECTS, LEDGER, 1)).toBe(true);
  });
});

describe('characterSaveFailure: the error a failed save throws', () => {
  it('passes a growth-limit violation through as itself', () => {
    const limit = new BankLedgerGrowthLimitExceeded(4, 2, 5);
    expect(characterSaveFailure(limit, undefined, undefined)).toBe(limit);
  });

  it('passes an unrelated error through unchanged', () => {
    const err = new Error('connection reset');
    expect(characterSaveFailure(err, undefined, undefined)).toBe(err);
  });

  it('passes a pg error that is NOT the growth refusal through unchanged', () => {
    const other = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(characterSaveFailure(other, undefined, undefined)).toBe(other);
  });

  it('routes a DATABASE-raised growth refusal through the recognizer', () => {
    // The SQL arm: the batch writer never threw, PostgreSQL did. Driving it with
    // the trigger's identity but unreadable evidence proves the delegation
    // happens at all (the recognizer refuses malformed evidence loudly); the
    // well-formed mapping itself is the growth-budget suite's own case.
    const raised = Object.assign(new Error('growth refusal'), {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: 'not the evidence shape',
    });
    expect(() => characterSaveFailure(raised, undefined, undefined)).toThrow(
      'malformed trigger evidence',
    );
  });
});
