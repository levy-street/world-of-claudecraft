// server/mail_recipient.ts: the mail_send recipient resolution, including the
// same-account stamp the sim's account-bound rule consumes. Postgres and the
// social directory are plain recording fakes (the tests/server idiom).
import { describe, expect, it } from 'vitest';
import {
  characterSharesAccount,
  mailRecipientFor,
  resolveOfflineMailRecipient,
} from '../../server/mail_recipient';

function fakePool(rows: { account_id: number }[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, params: unknown[]) => {
      calls.push({ text, params });
      return { rows };
    },
  };
}

function fakeDirectory(
  chars: Record<string, { id: number; name: string }>,
  blocked: Record<number, number[]> = {},
) {
  return {
    findCharacterByName: async (name: string) => chars[name] ?? null,
    blockedIds: async (charId: number) => blocked[charId] ?? [],
  };
}

const SENDER = { characterId: 11, accountId: 100 };

describe('mailRecipientFor (the live-session arm)', () => {
  it('keys by the character id string and compares ACCOUNTS, not characters', () => {
    expect(mailRecipientFor(42, 'Alicia', 100, SENDER)).toEqual({
      key: '42',
      name: 'Alicia',
      sameAccount: true,
    });
    expect(mailRecipientFor(42, 'Bob', 200, SENDER)).toEqual({
      key: '42',
      name: 'Bob',
      sameAccount: false,
    });
  });
});

describe('characterSharesAccount', () => {
  it('reads account_id by character id with a parameterized query', async () => {
    const pool = fakePool([{ account_id: 100 }]);
    expect(await characterSharesAccount(pool, 42, 100)).toBe(true);
    expect(pool.calls).toEqual([
      { text: 'SELECT account_id FROM characters WHERE id = $1', params: [42] },
    ]);
  });

  it('answers false for another account and for a missing row', async () => {
    expect(await characterSharesAccount(fakePool([{ account_id: 200 }]), 42, 100)).toBe(false);
    expect(await characterSharesAccount(fakePool([]), 42, 100)).toBe(false);
  });
});

describe('resolveOfflineMailRecipient', () => {
  it('resolves an alt on the sender account as sameAccount', async () => {
    const dir = fakeDirectory({ Alicia: { id: 42, name: 'Alicia' } });
    const pool = fakePool([{ account_id: 100 }]);
    expect(await resolveOfflineMailRecipient(dir, pool, 'Alicia', SENDER)).toEqual({
      key: '42',
      name: 'Alicia',
      sameAccount: true,
    });
    expect(pool.calls[0]?.params).toEqual([42]);
  });

  it('resolves a stranger as another account', async () => {
    const dir = fakeDirectory({ Bob: { id: 7, name: 'Bob' } });
    const pool = fakePool([{ account_id: 200 }]);
    expect(await resolveOfflineMailRecipient(dir, pool, 'Bob', SENDER)).toEqual({
      key: '7',
      name: 'Bob',
      sameAccount: false,
    });
  });

  it('returns null for an unknown name and never touches the pool', async () => {
    const pool = fakePool([{ account_id: 100 }]);
    expect(await resolveOfflineMailRecipient(fakeDirectory({}), pool, 'Nobody', SENDER)).toBeNull();
    expect(pool.calls).toHaveLength(0);
  });

  it('returns null when the recipient has blocked the sender, before the account read', async () => {
    const dir = fakeDirectory({ Bob: { id: 7, name: 'Bob' } }, { 7: [SENDER.characterId] });
    const pool = fakePool([{ account_id: 100 }]);
    expect(await resolveOfflineMailRecipient(dir, pool, 'Bob', SENDER)).toBeNull();
    expect(pool.calls).toHaveLength(0);
  });
});
