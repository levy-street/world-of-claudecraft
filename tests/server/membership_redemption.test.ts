import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ connect: vi.fn(), save: vi.fn(), query: vi.fn() }));
vi.mock('../../server/db', () => ({
  pool: { connect: io.connect, query: io.query },
  saveCharacterStateOnClient: io.save,
}));

import { lockCharacterSaveEffectAccountsOnClient } from '../../server/bank_ledger_save_effects_db';
import { PROCESS_LEASE_HOLDER } from '../../server/character_lease_db';
import {
  consumeMembershipToken,
  redeemMembershipTokenAtomic,
} from '../../server/membership_redemption_db';
import { REALM } from '../../server/realm';
import type { CharacterSaveArgs } from '../../server/woc_market_character_save';
import { MEMBERSHIP_ITEM_DURATION_MS } from '../../src/membership_contract';
import type { CharacterState } from '../../src/sim/character_state';
import type { InvSlot } from '../../src/sim/types';

const state = (inventory: InvSlot[]): CharacterState => ({ inventory, level: 3 }) as CharacterState;
const token = (count = 1): InvSlot => ({ itemId: 'membership_token', count });
const save = (): CharacterSaveArgs => ({
  characterId: 13,
  level: 3,
  state: state([token(2)]),
  leaseNonce: 'lease-nonce',
});

describe('membership token consumption', () => {
  it('removes one token, preserving adjacent items and the remainder of a stack', () => {
    const value = state([{ itemId: 'other', count: 2 }, token(2), { itemId: 'last', count: 3 }]);
    expect(consumeMembershipToken(value, 1)).toBe(true);
    expect(value.inventory).toEqual([
      { itemId: 'other', count: 2 },
      token(),
      { itemId: 'last', count: 3 },
    ]);
    expect(consumeMembershipToken(value, 1)).toBe(true);
    expect(value.inventory).toEqual([
      { itemId: 'other', count: 2 },
      { itemId: 'last', count: 3 },
    ]);
  });
  it.each([-1, 0.5, NaN, Infinity, 7])(
    'refuses invalid slot %s without changing inventory',
    (index) => {
      const value = state([token()]);
      expect(consumeMembershipToken(value, index)).toBe(false);
      expect(value.inventory).toEqual([token()]);
    },
  );
  it.each([0, -1, 0.5, NaN, Infinity])('refuses malformed stack count %s', (count) => {
    const value = state([token(count)]);
    expect(consumeMembershipToken(value, 0)).toBe(false);
    expect(value.inventory[0].count).toBe(count);
  });
  it('honors the instance lock and refuses unrelated items', () => {
    const locked = { ...token(), instance: { locked: true } };
    const value = state([locked, { itemId: 'other', count: 1 }]);
    expect(consumeMembershipToken(value, 0)).toBe(false);
    expect(consumeMembershipToken(value, 1)).toBe(false);
    expect(value.inventory).toEqual([locked, { itemId: 'other', count: 1 }]);
  });
});

/** Transaction model: writes remain pending until COMMIT and ROLLBACK discards both. */
class TransactionClient extends EventEmitter {
  committed = { state: state([token(2)]), expiry: null as Date | null };
  pending = structuredClone(this.committed);
  owned = true;
  lease = true;
  failExtension = false;
  commitError: Error | null = null;
  commitReachedServer = false;
  release = vi.fn();
  query = vi.fn(async (sql: string, values?: unknown[]) => {
    const result = (rows: Record<string, unknown>[] = []) => ({
      rows,
      rowCount: rows.length,
      command: '',
      oid: 0,
      fields: [],
    });
    if (sql === 'BEGIN') this.pending = structuredClone(this.committed);
    if (sql.startsWith('SELECT id FROM accounts')) return result([{ id: values?.[0] }]);
    if (sql.startsWith('SELECT id FROM characters')) return result(this.owned ? [{ id: 13 }] : []);
    if (sql.startsWith('SELECT nonce FROM character_leases'))
      return result(this.lease ? [{ nonce: 'lease-nonce' }] : []);
    if (sql === 'SAVE TEST CHARACTER')
      this.pending.state = structuredClone(values?.[0] as CharacterState);
    if (sql.startsWith('SELECT prepaid_until'))
      return result(this.pending.expiry ? [{ prepaid_until: this.pending.expiry }] : []);
    if (sql.startsWith('INSERT INTO account_memberships')) {
      if (this.failExtension)
        throw Object.assign(new Error('membership write failed'), { code: '23514' });
      this.pending.expiry = values?.[1] as Date;
    }
    if (sql === 'COMMIT') {
      if (!this.commitError || this.commitReachedServer)
        this.committed = structuredClone(this.pending);
      if (this.commitError) throw this.commitError;
    }
    if (sql === 'ROLLBACK') this.pending = structuredClone(this.committed);
    return result();
  });
}

describe('membership token atomic redemption', () => {
  let client: TransactionClient;
  beforeEach(() => {
    vi.clearAllMocks();
    client = new TransactionClient();
    io.connect.mockResolvedValue(client);
    io.save.mockImplementation(
      async (...args: Parameters<typeof import('../../server/db').saveCharacterStateOnClient>) => {
        const [connection, , , snapshot, , storage = [], ledger, proof] = args;
        // Consume the real account-lock proof on the exact same client identity.
        await lockCharacterSaveEffectAccountsOnClient(connection, storage, ledger, proof);
        await connection.query('SAVE TEST CHARACTER', [snapshot]);
        return true;
      },
    );
  });

  it('commits inventory and 30 more days together without changing the captured live snapshot', async () => {
    const captured = save();
    const recurringEnd = Date.now() + 100_000;
    const result = await redeemMembershipTokenAtomic(7, captured, 0, recurringEnd);
    expect(result).toEqual({ ok: true, expiresAt: recurringEnd + MEMBERSHIP_ITEM_DURATION_MS });
    expect(captured.state.inventory).toEqual([token(2)]);
    expect(client.committed.state.inventory).toEqual([token()]);
    expect(client.committed.expiry?.getTime()).toBe(recurringEnd + MEMBERSHIP_ITEM_DURATION_MS);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('account_id = $2 AND realm = $3'),
      [13, 7, REALM],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('holder = $3 AND expires_at > now()'),
      [13, 'lease-nonce', PROCESS_LEASE_HOLDER],
    );
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.findIndex((sql) => sql.includes('FROM accounts'))).toBeLessThan(
      statements.findIndex((sql) => sql.includes('FROM characters')),
    );
    expect(statements.indexOf('SAVE TEST CHARACTER')).toBeLessThan(
      statements.findIndex((sql) => sql.startsWith('INSERT INTO account_memberships')),
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does no database work for missing tokens or missing session lease', async () => {
    expect(await redeemMembershipTokenAtomic(7, { ...save(), state: state([]) }, 0, null)).toEqual({
      ok: false,
      reason: 'token_missing',
    });
    expect(
      await redeemMembershipTokenAtomic(7, { ...save(), leaseNonce: undefined }, 0, null),
    ).toEqual({ ok: false, reason: 'lease_lost' });
    expect(io.connect).not.toHaveBeenCalled();
  });

  it.each(['owned', 'lease'] as const)(
    'refuses the %s fence without saving or granting',
    async (fence) => {
      client[fence] = false;
      expect(await redeemMembershipTokenAtomic(7, save(), 0, null)).toEqual({
        ok: false,
        reason: 'lease_lost',
      });
      expect(io.save).not.toHaveBeenCalled();
      expect(client.committed.expiry).toBeNull();
      expect(client.query).toHaveBeenCalledWith('ROLLBACK', undefined);
    },
  );

  it('refuses a final save-fence miss and preserves the token', async () => {
    io.save.mockResolvedValueOnce(false);
    expect(await redeemMembershipTokenAtomic(7, save(), 0, null)).toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    expect(client.committed.state.inventory).toEqual([token(2)]);
    expect(client.committed.expiry).toBeNull();
  });

  it('rolls the inventory write back when the membership write fails', async () => {
    client.failExtension = true;
    expect(await redeemMembershipTokenAtomic(7, save(), 0, null)).toEqual({
      ok: false,
      reason: 'retry',
    });
    expect(io.save).toHaveBeenCalledOnce();
    expect(client.committed.state.inventory).toEqual([token(2)]);
    expect(client.committed.expiry).toBeNull();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK', undefined);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reports retry for a failed checkout or a COMMIT rejection that proves rollback', async () => {
    io.connect.mockRejectedValueOnce(new Error('pool unavailable'));
    expect(await redeemMembershipTokenAtomic(7, save(), 0, null)).toEqual({
      ok: false,
      reason: 'retry',
    });
    client.commitError = Object.assign(new Error('serialization failure'), { code: '40001' });
    expect(await redeemMembershipTokenAtomic(7, save(), 0, null)).toEqual({
      ok: false,
      reason: 'retry',
    });
    expect(client.committed.state.inventory).toEqual([token(2)]);
    expect(client.committed.expiry).toBeNull();
  });

  it('throws an uncertain COMMIT outcome even when the server actually committed both writes', async () => {
    const error = new Error('connection lost after COMMIT');
    client.commitError = error;
    client.commitReachedServer = true;
    const captured = save();
    await expect(redeemMembershipTokenAtomic(7, captured, 0, null)).rejects.toBe(error);
    expect(client.committed.state.inventory).toEqual([token()]);
    expect(client.committed.expiry).not.toBeNull();
    expect(captured.state.inventory).toEqual([token(2)]);
    expect(io.save).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(error);
  });
});
