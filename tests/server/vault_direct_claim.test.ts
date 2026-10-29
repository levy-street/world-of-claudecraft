import { describe, expect, it, vi } from 'vitest';
import { commitVaultDirectClaim } from '../../server/vault_direct_claim';
import type { VaultRewardClient } from '../../server/vault_rewards_db';
import type { CharacterState } from '../../src/sim/character_state';

function state(): CharacterState {
  return {
    level: 20,
    xp: 0,
    copper: 10,
    hp: 100,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: {} as CharacterState['equipment'],
    inventory: [],
    questLog: [],
    questsDone: [],
  };
}

function args() {
  return {
    realm: 'test',
    attemptId: '7:1',
    owner: true,
    state: state(),
    claim: {
      characterId: 7,
      recipientName: 'Owner',
      items: [{ itemId: 'thorium_ore', count: 2 }],
      copper: 15,
      mailDueAt: '2026-09-23T00:00:00.000Z',
    },
  };
}

describe('direct vault claim transaction', () => {
  it.each([
    ['heroic_mark', 'heroicMarks'],
    ['lantern_seal', 'lanternSeals'],
  ] as const)(
    'keeps an overflowing %s claim pending before any connection',
    async (itemId, field) => {
      const request = args();
      request.state[field] = Number.MAX_SAFE_INTEGER - 1;
      request.claim.items.push({ itemId, count: 1 }, { itemId, count: 1 });
      const before = structuredClone(request);
      const connect = vi.fn();
      const saveCharacter = vi.fn();
      expect(await commitVaultDirectClaim({ pool: { connect }, saveCharacter }, request)).toBe(
        'retry',
      );
      expect(request).toEqual(before);
      expect(connect).not.toHaveBeenCalled();
      expect(saveCharacter).not.toHaveBeenCalled();
    },
  );

  it('commits the reward snapshot and claim marker on the same client', async () => {
    const queries: string[] = [];
    const client: VaultRewardClient = {
      query: vi.fn(async (sql) => {
        queries.push(sql);
        return { rows: [{ character_id: 7 }], rowCount: 1 };
      }),
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const save = vi.fn(async (_client: VaultRewardClient, saved: CharacterState) => {
      expect(_client).toHaveProperty('query');
      expect(saved.copper).toBe(25);
      return true;
    });
    const result = await commitVaultDirectClaim(
      { pool: { connect: async () => client }, saveCharacter: save },
      args(),
    );
    expect(result).toBe('delivered');
    expect(queries[0]).toBe('BEGIN');
    expect(queries.some((sql) => sql.includes('UPDATE vault_reward_claims'))).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls the character save back when mail already won the claim', async () => {
    const queries: string[] = [];
    const client: VaultRewardClient = {
      query: async (sql) => {
        queries.push(sql);
        return { rows: [], rowCount: sql.includes('UPDATE vault_reward_claims') ? 0 : 1 };
      },
      release: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    expect(
      await commitVaultDirectClaim(
        { pool: { connect: async () => client }, saveCharacter: async () => true },
        args(),
      ),
    ).toBe('already_claimed');
    expect(queries.at(-1)).toBe('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });
});
