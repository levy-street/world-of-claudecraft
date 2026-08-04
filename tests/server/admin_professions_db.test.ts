// R35 db layer: recordProfessionsRestore (the audit write the whole restore
// contract leans on) and characterProfessionsRow (the inspector's one query),
// driven against a mocked pool so the SQL text, the parameter order, and the
// snake-to-camel row mapping are pinned rather than assumed by the endpoint
// tests' injected fakes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

import { characterProfessionsRow } from '../../server/admin_db';
import * as db from '../../server/db';
import { recordProfessionsRestore } from '../../server/moderation_db';

const query = db.pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async () => ({ rows: [] }));
});

describe('recordProfessionsRestore', () => {
  it('requires a reason BEFORE touching the database', async () => {
    await expect(
      recordProfessionsRestore({
        characterId: 42,
        adminAccountId: 7,
        action: 'restore_item',
        detail: 'copper_mining_pick x2',
        reason: '   ',
      }),
    ).rejects.toThrow('moderation reason is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('throws character not found when the owner lookup misses', async () => {
    await expect(
      recordProfessionsRestore({
        characterId: 42,
        adminAccountId: 7,
        action: 'restore_item',
        detail: 'copper_mining_pick x2',
        reason: 'lost',
      }),
    ).rejects.toThrow('character not found');
    // Only the owner lookup ran; no audit row without an owner.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('SELECT account_id FROM characters');
    expect(query.mock.calls[0][1]).toEqual([42]);
  });

  it('records the audit row with the action kind and the character-carrying reason', async () => {
    query.mockImplementationOnce(async () => ({ rows: [{ account_id: 9 }] }));
    const result = await recordProfessionsRestore({
      characterId: 42,
      adminAccountId: 7,
      action: 'restore_slot',
      detail: 'mining/gatherers_cache',
      reason: 'row vanished',
    });
    expect(result).toEqual({ accountId: 9 });
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('INSERT INTO account_moderation_actions');
    // Params: accountId, adminAccountId, action, reason, expiresAt. The
    // folded reason must identify the CHARACTER (the table has no character
    // column, and a multi-character account is otherwise unanswerable) and
    // say "requested" (a post-audit refusal is possible and surfaced).
    expect(params).toEqual([
      9,
      7,
      'restore_slot',
      '[requested mining/gatherers_cache for character 42] row vanished',
      null,
    ]);
  });

  it('caps the folded detail at 128 characters (the bounded-prefix invariant)', async () => {
    query.mockImplementationOnce(async () => ({ rows: [{ account_id: 9 }] }));
    await recordProfessionsRestore({
      characterId: 42,
      adminAccountId: 7,
      action: 'restore_item',
      detail: 'x'.repeat(500),
      reason: 'lost',
    });
    const [, params] = query.mock.calls[1];
    const reason = params[3] as string;
    // The prefix stays bounded no matter what a future caller passes: the
    // detail inside it is cleanText-capped at 128, so the whole folded form
    // cannot balloon the audit row.
    expect(reason).toBe(`[requested ${'x'.repeat(128)} for character 42] lost`);
  });
});

describe('characterProfessionsRow', () => {
  it('selects by primary key and maps snake_case columns to the row shape', async () => {
    query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 42,
          name: 'Merlin',
          class: 'mage',
          level: 12,
          account_id: 9,
          username: 'alice',
          state: { xp: 1 },
          updated_at: '2026-06-01T00:00:00Z',
        },
      ],
    }));
    const row = await characterProfessionsRow(42);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM characters c');
    expect(sql).toContain('JOIN accounts a ON a.id = c.account_id');
    expect(sql).toContain('WHERE c.id = $1');
    // The blob column is conditional: a live caller skips the detoast.
    expect(sql).toContain('CASE WHEN $2::boolean THEN c.state ELSE NULL END');
    expect(params).toEqual([42, true]);
    expect(row).toEqual({
      id: 42,
      name: 'Merlin',
      class: 'mage',
      level: 12,
      accountId: 9,
      username: 'alice',
      state: { xp: 1 },
      updatedAt: '2026-06-01T00:00:00Z',
    });
  });

  it('returns null for an unknown character', async () => {
    expect(await characterProfessionsRow(404404)).toBeNull();
  });

  it('skips fetching the blob when the caller holds a live snapshot', async () => {
    query.mockImplementationOnce(async () => ({ rows: [] }));
    await characterProfessionsRow(42, false);
    expect(query.mock.calls[0][1]).toEqual([42, false]);
  });

  it('a FOUND row with the blob suppressed reads state UNDEFINED, never null', async () => {
    // The undefined-vs-null contract: the CASE arm returns SQL NULL for a
    // suppressed blob, and the mapper must translate that to undefined so a
    // live caller's suppression stays distinguishable from a genuinely NULL
    // stored blob (a created-but-never-entered character).
    query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 42,
          name: 'Merlin',
          class: 'mage',
          level: 12,
          account_id: 9,
          username: 'alice',
          state: null,
          updated_at: '2026-06-01T00:00:00Z',
        },
      ],
    }));
    const row = await characterProfessionsRow(42, false);
    expect(row).not.toBeNull();
    expect('state' in (row as object) && (row as { state?: unknown }).state).toBeUndefined();
  });
});
