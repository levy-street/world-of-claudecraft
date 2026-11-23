import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  PgReferralStore,
  ReferralCommitAmbiguous,
  ReferralLeaseLost,
} from '../server/referral_store_db';
import type { CharacterState } from '../src/sim/character_state';
import {
  createReferralCard,
  type ReferralCardContext,
  type ReferralCardState,
  transitionReferralCard,
} from '../src/sim/referral_cards';

const context: ReferralCardContext = {
  characters: [
    {
      accountId: 10,
      characterId: 100,
      name: 'Inviter',
      level: 1,
      completedQuestIds: [],
      partyId: 1,
    },
    {
      accountId: 20,
      characterId: 200,
      name: 'Invitee',
      level: 1,
      completedQuestIds: [],
      partyId: 1,
    },
  ],
};
class FakeClient extends EventEmitter {
  readonly queries: { sql: string; values: unknown[] }[] = [];
  card = createReferralCard(20, 10, 20);
  before: ReferralCardState | null = null;
  failCommit = false;
  released = false;
  async query(sql: string, values: unknown[] = []) {
    this.queries.push({ sql, values });
    const rows: Record<string, unknown>[] = [];
    if (sql === 'BEGIN') this.before = structuredClone(this.card);
    if (sql === 'ROLLBACK' && this.before) this.card = this.before;
    if (sql === 'COMMIT' && this.failCommit) throw new Error('connection lost');
    if (sql.startsWith('SELECT referrer_account_id FROM referrals'))
      rows.push({ referrer_account_id: 10 });
    if (sql === 'SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE')
      rows.push({ id: values[0] });
    if (sql === 'SELECT state FROM referral_cards WHERE link_id = $1 FOR UPDATE')
      rows.push({ state: this.card });
    if (sql.startsWith('UPDATE referral_cards SET state='))
      this.card = JSON.parse(String(values[1]));
    if (sql.includes('INSERT INTO referral_character_progress')) rows.push({ ready_count: 0 });
    if (sql.includes('WITH links AS'))
      rows.push({
        referee_account_id: 20,
        referrer_account_id: 10,
        state: this.card,
        inviter_summon_at: null,
        invitee_summon_at: null,
      });
    return { rows, rowCount: rows.length || 1, command: 'SELECT', oid: 0, fields: [] };
  }
  release() {
    this.released = true;
  }
}
function setup() {
  const client = new FakeClient();
  const pool = {
    connect: async () => client as unknown as PoolClient,
    query: vi.fn(),
  } as unknown as Pick<Pool, 'connect' | 'query'>;
  const save = vi.fn(async () => true);
  const grant = vi.fn((state: CharacterState) => ({ ...state, level: state.level }));
  const store = new PgReferralStore({
    leaseHolder: 'test',
    pool,
    save,
    saveOffline: async () => true,
    grant,
    move: (from, to) => ({ from, to }),
  });
  return { client, save, grant, store };
}
function active(card: ReferralCardState) {
  let state = transitionReferralCard(
    card,
    { type: 'start', accountId: 10, expectedRevision: card.revision },
    context,
  ).state;
  state = transitionReferralCard(
    state,
    { type: 'respond', accept: true, accountId: 10, expectedRevision: state.revision },
    context,
  ).state;
  state = transitionReferralCard(
    state,
    { type: 'respond', accept: true, accountId: 20, expectedRevision: state.revision },
    context,
  ).state;
  state.participants[0].credited = 1;
  return state;
}
describe('durable referral card transitions', () => {
  it('locks accounts in stable order and installs SQL bounds before loading a card', async () => {
    const h = setup();
    await h.store.mutate(20, 10, (card) =>
      transitionReferralCard(card, { type: 'start', accountId: 10, expectedRevision: 0 }, context),
    );
    const locks = h.client.queries.filter((q) => q.sql.includes('FROM accounts'));
    expect(locks.map((q) => q.values[0])).toEqual([10, 20]);
    expect(h.client.queries[1].sql).toContain("statement_timeout = '5s'");
    expect(h.client.queries[1].sql).toContain("lock_timeout = '2s'");
    expect(h.client.card.status).toBe('pending');
    expect(h.client.queries.at(-1)?.sql).toBe('COMMIT');
    expect(h.client.released).toBe(true);
  });
  it('rolls back redemption when the live save lease fence fails', async () => {
    const h = setup();
    h.client.card = active(h.client.card);
    h.save.mockResolvedValue(false);
    const before = structuredClone(h.client.card);
    await expect(
      h.store.mutate(
        20,
        10,
        (card) =>
          transitionReferralCard(
            card,
            {
              type: 'redeem',
              milestone: 'tutorial',
              accountId: 10,
              expectedRevision: card.revision,
            },
            context,
          ),
        () => ({
          characterId: 100,
          level: 1,
          state: { level: 1 } as CharacterState,
          leaseNonce: 'current',
        }),
      ),
    ).rejects.toBeInstanceOf(ReferralLeaseLost);
    expect(h.client.card).toEqual(before);
    expect(h.client.queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(h.client.queries.some((q) => q.sql.startsWith('UPDATE referral_cards SET state='))).toBe(
      false,
    );
  });
  it('persists the exact transformed snapshot and refuses duplicate reward redemption', async () => {
    const h = setup();
    h.client.card = active(h.client.card);
    const capture = () => ({
      characterId: 100,
      level: 1,
      state: { level: 1 } as CharacterState,
      leaseNonce: 'current',
    });
    const reduce = (card: ReferralCardState) =>
      transitionReferralCard(
        card,
        { type: 'redeem', milestone: 'tutorial', accountId: 10, expectedRevision: card.revision },
        context,
      );
    const first = await h.store.mutate(20, 10, reduce, capture);
    expect(first.saves).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
    const second = await h.store.mutate(20, 10, reduce, capture);
    expect(second.result.error).toBe('alreadyRedeemed');
    expect(h.save).toHaveBeenCalledOnce();
  });
  it('surfaces commit ambiguity instead of reporting a retryable reward failure', async () => {
    const h = setup();
    h.client.failCommit = true;
    await expect(
      h.store.mutate(20, 10, (card) =>
        transitionReferralCard(
          card,
          { type: 'start', accountId: 10, expectedRevision: 0 },
          context,
        ),
      ),
    ).rejects.toBeInstanceOf(ReferralCommitAmbiguous);
    expect(h.client.released).toBe(true);
  });
  it('pages each indexed referral arm before joining card state and reads scalar ready count', async () => {
    const h = setup();
    await h.store.page(10, 0, 100);
    const query = h.client.queries.find((q) => q.sql.includes('WITH links AS'))!;
    expect(query.sql).toContain('referrer_account_id = $1 AND referee_account_id > $2');
    expect(query.sql).toContain('ORDER BY referee_account_id LIMIT 51');
    expect(query.sql).toContain('referee_account_id = $1 AND referee_account_id > $2 LIMIT 1');
    expect(
      h.client.queries.some((q) =>
        q.sql.includes('FROM referral_character_progress WHERE character_id=$1'),
      ),
    ).toBe(true);
  });
});
