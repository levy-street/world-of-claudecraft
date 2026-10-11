import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_BUDDIES_SCHEMA } from '../server/account_buddies_db';
import { PROCESS_LEASE_HOLDER } from '../server/character_lease_db';
import { MATERIAL_SOURCE_JOURNAL_SCHEMA } from '../server/material_source_journal_db';
import { REALM } from '../server/realm';
import {
  saveOfflineReferralCharacter,
  saveReferralCharacter,
} from '../server/referral_character_save_db';
import { REFERRAL_CARDS_SCHEMA } from '../server/referral_schema_db';
import { PgReferralStore, ReferralLeaseLost } from '../server/referral_store_db';
import type { CharacterState } from '../src/sim/character_state';
import { REFERRAL_BAG, REFERRAL_HOLLOW_TRINKET } from '../src/sim/content/referral_rewards';
import {
  createReferralCard,
  creditReferralCard,
  type ReferralCardContext,
  type ReferralCardState,
  transitionReferralCard,
} from '../src/sim/referral_cards';
import { grantReferralReward, moveReferralRewards } from '../src/sim/referral_rewards';

const url = process.env.REFERRAL_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('referral card PostgreSQL transactions', () => {
  const schema = `referral_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool;
  let pool: Pool;
  let store: PgReferralStore;
  let beforeSave: (() => Promise<void>) | undefined;
  const state = { level: 1 } as CharacterState;
  const context: ReferralCardContext = {
    characters: [
      {
        accountId: 10,
        characterId: 100,
        name: 'Inviter',
        level: 1,
        completedQuestIds: ['q_ps_set_sail'],
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
  function card() {
    const value = createReferralCard(20, 10, 20);
    value.status = 'active';
    value.accepted = [true, true];
    value.participants[0] = {
      ...value.participants[0],
      characterId: 100,
      characterName: 'Inviter',
    };
    value.participants[1] = {
      ...value.participants[1],
      characterId: 200,
      characterName: 'Invitee',
    };
    return value;
  }
  const capture = (characterId = 100) => ({
    characterId,
    level: 1,
    state,
    leaseNonce: `nonce-${characterId}`,
  });
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, max: 6, options: `-c search_path=${schema},public` });
    await pool.query(`CREATE TABLE accounts(id INT PRIMARY KEY);
      CREATE TABLE characters(id INT PRIMARY KEY,account_id INT REFERENCES accounts(id) ON DELETE CASCADE,realm TEXT NOT NULL DEFAULT 'test',name TEXT,state JSONB,level INT,updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE referrals(referee_account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,referrer_account_id INT REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE INDEX referrals_pair ON referrals(referrer_account_id,referee_account_id);
      CREATE TABLE character_leases(character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,nonce TEXT,expires_at TIMESTAMPTZ,holder TEXT NOT NULL DEFAULT 'test');
      CREATE TABLE account_blocks(account_id INT,blocked_account_id INT,PRIMARY KEY(account_id,blocked_account_id));
      CREATE TABLE account_buddies(
        account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        owned TEXT[] NOT NULL DEFAULT '{}',
        CONSTRAINT account_buddies_active_keys CHECK (
          cardinality(owned) <= 3 AND owned <@ ARRAY['horse','crystal_lich','forgemaw']::text[]));
      ${ACCOUNT_BUDDIES_SCHEMA}
      ${REFERRAL_CARDS_SCHEMA}
      ${MATERIAL_SOURCE_JOURNAL_SCHEMA}`);
    store = new PgReferralStore({
      leaseHolder: 'test',
      pool,
      save: async (tx, save) => {
        await beforeSave?.();
        return !!(
          await tx.query(
            `UPDATE characters SET state=$2::jsonb WHERE id=$1
        AND EXISTS(SELECT 1 FROM character_leases WHERE character_id=$1 AND nonce=$3 AND expires_at>now())`,
            [save.characterId, JSON.stringify(save.state), save.leaseNonce],
          )
        ).rowCount;
      },
      saveOffline: async (tx, id, next, realm) =>
        !!(
          await tx.query(
            `UPDATE characters SET state=$2::jsonb WHERE id=$1 AND realm=$3
        AND NOT EXISTS(SELECT 1 FROM character_leases WHERE character_id=$1 AND expires_at>=now())`,
            [id, JSON.stringify(next), realm],
          )
        ).rowCount,
      grant: (before) => ({ ...before, xp: (before.xp ?? 0) + 1 }),
      move: (from, to) => ({ from: { ...from, xp: 0 }, to: { ...to, xp: 1 } }),
    });
  });
  beforeEach(async () => {
    beforeSave = undefined;
    await pool.query('TRUNCATE accounts CASCADE');
    await pool.query('INSERT INTO accounts(id) VALUES(10),(20),(30)');
    await pool.query('INSERT INTO referrals VALUES(20,10)');
    await pool.query(
      `INSERT INTO characters(id,account_id,name,state,level) VALUES
      (100,10,'Inviter',$1,1),(200,20,'Invitee',$1,1),(300,10,'New Inviter',$1,1)`,
      [JSON.stringify(state)],
    );
    await pool.query(`INSERT INTO character_leases(character_id,nonce,expires_at) VALUES(100,'nonce-100',now()+interval '1 hour'),
      (200,'nonce-200',now()+interval '1 hour'),(300,'nonce-300',now()+interval '1 hour')`);
    await pool.query(
      'INSERT INTO referral_cards(link_id,inviter_account_id,state) VALUES(20,10,$1)',
      [JSON.stringify(card())],
    );
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it('settles tier five through the upgraded production buddy constraint exactly once', async () => {
    await pool.query(
      "INSERT INTO account_buddies VALUES(10,ARRAY['horse','crystal_lich','forgemaw'])",
    );
    await pool.query('INSERT INTO referral_progress(account_id,completed_count) VALUES(10,5)');
    await pool.query(
      "INSERT INTO referral_reward_outbox(receipt,account_id,tier) VALUES('tier5',10,5)",
    );
    const row = { receipt: 'tier5', accountId: 10, tier: 5 };
    expect(await store.settleReward(row)).toBe(16);
    const read = () =>
      pool.query(`SELECT b.owned,p.rewarded_mask,o.delivered_at
      FROM account_buddies b JOIN referral_progress p USING(account_id)
      JOIN referral_reward_outbox o USING(account_id) WHERE b.account_id=10`);
    const settled = (await read()).rows[0];
    expect(settled.owned).toEqual(['crystal_lich', 'forgemaw', 'horse', 'sapling']);
    expect(settled.rewarded_mask).toBe(16);
    expect(settled.delivered_at).toBeInstanceOf(Date);
    expect(await store.settleReward(row)).toBe(16);
    expect((await read()).rows[0]).toEqual(settled);
  });
  it('atomically credits then allows exactly one concurrent reward redemption', async () => {
    await store.mutate(20, 10, (s) =>
      creditReferralCard(
        s,
        { type: 'questTurnIn', characterId: 100, questId: 'q_ps_set_sail' },
        context,
      ),
    );
    expect(
      (
        await pool.query(
          'SELECT ready_count FROM referral_character_progress WHERE character_id=100',
        )
      ).rows[0].ready_count,
    ).toBe(1);
    const reduce = (s: ReferralCardState) =>
      transitionReferralCard(
        s,
        { type: 'redeem', accountId: 10, expectedRevision: 1, milestone: 'tutorial' },
        context,
      );
    const results = await Promise.all([
      store.mutate(20, 10, reduce, capture),
      store.mutate(20, 10, reduce, capture),
    ]);
    expect(results.filter((r) => r.saves.length === 1)).toHaveLength(1);
    expect(results.filter((r) => r.result.error === 'staleRevision')).toHaveLength(1);
    expect((await pool.query('SELECT state FROM characters WHERE id=100')).rows[0].state.xp).toBe(
      1,
    );
    expect(
      (
        await pool.query(
          'SELECT ready_count FROM referral_character_progress WHERE character_id=100',
        )
      ).rows[0].ready_count,
    ).toBe(0);
  });
  it('refuses moving a loaded old character and retires its expired lease before moving', async () => {
    const moving: ReferralCardContext = {
      characters: [
        { ...context.characters[0], characterId: 300, completedQuestIds: [] },
        context.characters[1],
      ],
    };
    const reduce = (s: ReferralCardState) =>
      transitionReferralCard(
        s,
        { type: 'move', accountId: 10, characterId: 300, expectedRevision: 0 },
        moving,
      );
    await expect(store.mutate(20, 10, reduce, () => capture(300))).rejects.toBeInstanceOf(
      ReferralLeaseLost,
    );
    expect(
      (await pool.query('SELECT state FROM referral_cards')).rows[0].state.participants[0]
        .characterId,
    ).toBe(100);
    await pool.query(
      "UPDATE character_leases SET expires_at=now()-interval '1 second' WHERE character_id=100",
    );
    await store.mutate(20, 10, reduce, () => capture(300));
    expect(
      (await pool.query('SELECT 1 FROM character_leases WHERE character_id=100')).rowCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT state FROM referral_cards')).rows[0].state.participants[0]
        .characterId,
    ).toBe(300);
    expect((await pool.query('SELECT state FROM characters WHERE id=300')).rows[0].state.xp).toBe(
      1,
    );
  });
  it('claims each outbox row in at most one concurrent worker and settles idempotently', async () => {
    await pool.query('INSERT INTO referral_progress(account_id,completed_count) VALUES(10,2)');
    await pool.query(
      "INSERT INTO referral_reward_outbox(receipt,account_id,tier) VALUES('tier1',10,1),('tier2',10,2)",
    );
    const [a, b] = await Promise.all([store.claimRewards(), store.claimRewards()]);
    expect([...a, ...b]).toHaveLength(2);
    expect(new Set([...a, ...b].map((r) => r.receipt)).size).toBe(2);
    const row = [...a, ...b].find((r) => r.tier === 2)!;
    expect(await store.settleReward(row)).toBe(2);
    expect(await store.settleReward(row)).toBe(2);
    expect(
      (await pool.query('SELECT rewarded_mask FROM referral_progress')).rows[0].rewarded_mask,
    ).toBe(2);
  });
  it('binds membership delivery to one immutable owned character across competing realms/retries', async () => {
    await store.bookMembershipBond(20, 'first-paid-receipt');
    const [row] = await store.claimBonds('test', [10]);
    expect(row.receipt).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const [a, b] = await Promise.all([
      store.bindBondRecipient(row, { characterId: 100, name: 'forged', realm: 'test' }),
      store.bindBondRecipient(row, { characterId: 300, name: 'forged', realm: 'test' }),
    ]);
    expect(a).toEqual(b);
    expect(['Inviter', 'New Inviter']).toContain(a?.name);
    expect(
      await store.bindBondRecipient(row, { characterId: 200, name: 'Invitee', realm: 'test' }),
    ).toEqual(a);
    await store.settleBond(row);
    expect(await store.claimBonds('test')).toEqual([]);
  });
  it('creates an idle card for summon and enforces cooldown across instances without accepting client time', async () => {
    await pool.query('DELETE FROM referral_cards');
    expect(await store.summon(20, 10)).toBe(true);
    expect(await store.summon(20, 10)).toBe(false);
    expect(await store.summon(20, 30)).toBe(false);
    await pool.query(
      "UPDATE referral_cards SET inviter_summon_at=now()-interval '30 minutes 1 second'",
    );
    expect(await store.summon(20, 10)).toBe(true);
    await pool.query('INSERT INTO account_blocks VALUES(20,10)');
    expect(await store.summon(20, 20)).toBe(false);
  });
  it('holds the live nonce lease through the reward commit against a simultaneous takeover', async () => {
    await store.mutate(20, 10, (s) =>
      creditReferralCard(
        s,
        { type: 'questTurnIn', characterId: 100, questId: 'q_ps_set_sail' },
        context,
      ),
    );
    let release: () => void = () => {};
    let started: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      started = resolve;
    });
    beforeSave = () =>
      new Promise<void>((resolve) => {
        release = resolve;
        started();
      });
    const claim = store.mutate(
      20,
      10,
      (s) =>
        transitionReferralCard(
          s,
          { type: 'redeem', accountId: 10, expectedRevision: 1, milestone: 'tutorial' },
          context,
        ),
      capture,
    );
    await locked;
    const peer = await pool.connect();
    try {
      await peer.query('BEGIN');
      await peer.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        peer.query("UPDATE character_leases SET nonce='takeover' WHERE character_id=100"),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await peer.query('ROLLBACK');
      peer.release();
      release();
    }
    await claim;
    expect(
      (await pool.query('SELECT nonce FROM character_leases WHERE character_id=100')).rows[0].nonce,
    ).toBe('nonce-100');
  });
  it('protects transferable source characters but allows whole-account deletion cascades', async () => {
    await store.mutate(20, 10, (s) =>
      creditReferralCard(
        s,
        { type: 'questTurnIn', characterId: 100, questId: 'q_ps_set_sail' },
        context,
      ),
    );
    await pool.query('DELETE FROM character_leases WHERE character_id=100');
    await expect(pool.query('DELETE FROM characters WHERE id=100')).rejects.toMatchObject({
      code: '23503',
    });
    expect(
      (
        await pool.query(
          'SELECT character_id FROM referral_transfer_characters ORDER BY character_id',
        )
      ).rows.map((r) => r.character_id),
    ).toEqual([100, 200]);
    await pool.query('DELETE FROM accounts WHERE id=10');
    expect((await pool.query('SELECT 1 FROM referral_transfer_characters')).rowCount).toBe(0);
  });
  it('releases a pending bond recipient deletion guard only after durable settlement', async () => {
    await store.bookMembershipBond(20, 'first-paid');
    const [row] = await store.claimBonds('test', [10]);
    await store.bindBondRecipient(row, { characterId: 100, name: 'Inviter', realm: 'test' });
    await pool.query('DELETE FROM character_leases WHERE character_id=100');
    await expect(pool.query('DELETE FROM characters WHERE id=100')).rejects.toMatchObject({
      code: '23503',
    });
    await store.settleBond(row);
    await pool.query('DELETE FROM characters WHERE id=100');
  });
  it('does not lease an unbound bond from a realm with no locally deliverable inviter', async () => {
    await store.bookMembershipBond(20, 'first-paid');
    expect(await store.claimBonds('other', [])).toEqual([]);
    const local = await store.claimBonds('test', [10]);
    expect(local).toHaveLength(1);
  });
  it('moves real earned rewards through both canonical saves and preserves unrelated card custody on reload/retry', async () => {
    const blank = {
      level: 1,
      inventory: [],
      equipment: {},
      questLog: [],
      questsDone: [],
    } as unknown as CharacterState;
    let source = grantReferralReward(grantReferralReward(blank, 20, 'tutorial'), 20, 'hollow');
    source = grantReferralReward(grantReferralReward(source, 30, 'tutorial'), 30, 'hollow');
    const destination = grantReferralReward(blank, 40, 'tutorial');
    const linkedCharm = source.inventory.find((item) => item.instance?.referralLinkId === 20)!;
    linkedCharm.instance!.enchant = 'test_enchant';
    source.inventory = source.inventory.filter((item) => item !== linkedCharm);
    source.bank = { inventory: [linkedCharm], purchasedSlots: 0, bonusSlots: 0 };
    const earnedCard = card();
    earnedCard.participants[0].credited = 3;
    earnedCard.participants[0].redeemed = 3;
    await pool.query('UPDATE referral_cards SET state=$1 WHERE link_id=20', [
      JSON.stringify(earnedCard),
    ]);
    await pool.query('UPDATE characters SET realm=$1,state=$2 WHERE id=100', [
      REALM,
      JSON.stringify(source),
    ]);
    await pool.query('UPDATE characters SET realm=$1,state=$2 WHERE id=300', [
      REALM,
      JSON.stringify(destination),
    ]);
    await pool.query(
      "UPDATE character_leases SET expires_at=now()-interval '1 second' WHERE character_id=100",
    );
    await pool.query('UPDATE character_leases SET holder=$1 WHERE character_id=300', [
      PROCESS_LEASE_HOLDER,
    ]);
    const canonical = new PgReferralStore({
      pool,
      leaseHolder: PROCESS_LEASE_HOLDER,
      save: saveReferralCharacter,
      saveOffline: saveOfflineReferralCharacter,
      grant: grantReferralReward,
      move: moveReferralRewards,
    });
    const moving: ReferralCardContext = {
      characters: [
        { ...context.characters[0], characterId: 300, completedQuestIds: [] },
        context.characters[1],
      ],
    };
    const reduce = (current: ReferralCardState) =>
      transitionReferralCard(
        current,
        { type: 'move', accountId: 10, characterId: 300, expectedRevision: 0 },
        moving,
      );
    const result = await canonical.mutate(20, 10, reduce, () => ({
      ...capture(300),
      state: destination,
    }));
    expect(result.result.error).toBeUndefined();
    const read = () =>
      pool.query('SELECT id,state FROM characters WHERE id IN (100,300) ORDER BY id');
    const reloaded = (await read()).rows;
    const old = reloaded[0].state as CharacterState;
    const next = reloaded[1].state as CharacterState;
    expect(old.referralRewards).toEqual({ '30': { redeemed: 3 } });
    expect(old.bank?.inventory).toEqual([]);
    expect(old.inventory).toEqual([
      { itemId: REFERRAL_BAG, count: 1 },
      { itemId: REFERRAL_HOLLOW_TRINKET, count: 1, instance: { referralLinkId: 30 } },
    ]);
    expect(next.referralRewards).toEqual({ '20': { redeemed: 3 }, '40': { redeemed: 1 } });
    expect(next.inventory.filter((item) => item.itemId === REFERRAL_BAG)).toHaveLength(2);
    expect(
      next.inventory.find((item) => item.itemId === REFERRAL_HOLLOW_TRINKET)?.instance,
    ).toEqual({ referralLinkId: 20, enchant: 'test_enchant' });
    const retry = await canonical.mutate(20, 10, reduce, () => ({ ...capture(300), state: next }));
    expect(retry.result.error).toBe('staleRevision');
    expect(retry.saves).toEqual([]);
    expect((await read()).rows).toEqual(reloaded);
    const savedCard = (await pool.query('SELECT state FROM referral_cards WHERE link_id=20'))
      .rows[0].state;
    expect(savedCard.revision).toBe(1);
    expect(savedCard.participants[0].characterId).toBe(300);
    expect(savedCard.participants[0].redeemed).toBe(3);
  });
  it('uses the production live and offline save adapters with the canonical material-source journal', async () => {
    const source = {
      level: 1,
      inventory: [],
      questLog: [],
      questsDone: [],
      bank: { inventory: [{ itemId: 'copper_ore', count: 2 }], bags: [] },
    } as unknown as CharacterState;
    const destination = {
      ...source,
      bank: { inventory: [], bags: [] },
    } as unknown as CharacterState;
    await pool.query('UPDATE characters SET realm=$1,state=$2 WHERE id=100', [
      REALM,
      JSON.stringify(source),
    ]);
    await pool.query('UPDATE characters SET realm=$1,state=$2 WHERE id=300', [
      REALM,
      JSON.stringify(destination),
    ]);
    await pool.query(
      "UPDATE character_leases SET expires_at=now()-interval '1 second' WHERE character_id=100",
    );
    await pool.query('UPDATE character_leases SET holder=$1 WHERE character_id=300', [
      PROCESS_LEASE_HOLDER,
    ]);
    const canonical = new PgReferralStore({
      pool,
      leaseHolder: PROCESS_LEASE_HOLDER,
      save: saveReferralCharacter,
      saveOffline: saveOfflineReferralCharacter,
      grant: (before) => before,
      move: (from, to) => ({
        from: { ...from, bank: { ...from.bank!, inventory: [{ itemId: 'copper_ore', count: 1 }] } },
        to: { ...to, bank: { ...to.bank!, inventory: [{ itemId: 'copper_ore', count: 1 }] } },
      }),
    });
    const moving: ReferralCardContext = {
      characters: [
        { ...context.characters[0], characterId: 300, completedQuestIds: [] },
        context.characters[1],
      ],
    };
    await canonical.mutate(
      20,
      10,
      (s) =>
        transitionReferralCard(
          s,
          { type: 'move', accountId: 10, characterId: 300, expectedRevision: 0 },
          moving,
        ),
      () => ({ ...capture(300), state: destination }),
    );
    const anchors = await pool.query(
      "SELECT owner_id FROM material_source_containers WHERE container='personal' ORDER BY owner_id",
    );
    expect(anchors.rows.map((r) => Number(r.owner_id))).toEqual([100, 300]);
    const journal = await pool.query(
      "SELECT owner_id FROM material_source_journal WHERE container='personal' ORDER BY owner_id",
    );
    expect(journal.rows.map((r) => Number(r.owner_id))).toEqual([100, 300]);
  });
  it('releases transferable deletion guards after confirmed decline and the permanent reward lock', async () => {
    const eligible: ReferralCardContext = {
      characters: [
        { ...context.characters[0], completedQuestIds: [] },
        { ...context.characters[1], completedQuestIds: [] },
      ],
    };
    await pool.query('UPDATE referral_cards SET state=$1', [
      JSON.stringify(createReferralCard(20, 10, 20)),
    ]);
    const act = async (input: Record<string, unknown>) =>
      store.mutate(
        20,
        10,
        (s) =>
          transitionReferralCard(
            s,
            { ...input, accountId: 10, expectedRevision: s.revision } as Parameters<
              typeof transitionReferralCard
            >[1],
            eligible,
          ),
        capture,
      );
    await act({ type: 'start' });
    expect((await pool.query('SELECT 1 FROM referral_transfer_characters')).rowCount).toBe(2);
    await act({ type: 'respond', accept: false });
    await act({ type: 'respond', accept: false, confirmDecline: true });
    expect((await pool.query('SELECT 1 FROM referral_transfer_characters')).rowCount).toBe(0);
    const ready = card();
    ready.participants[0].credited = 7;
    ready.participants[0].redeemed = 3;
    await pool.query('UPDATE referral_cards SET state=$1,revision=0', [JSON.stringify(ready)]);
    await act({ type: 'redeem', milestone: 'fogbinder' });
    expect(
      (await pool.query('SELECT 1 FROM referral_transfer_characters WHERE character_id=100'))
        .rowCount,
    ).toBe(1);
    await act({ type: 'redeem', milestone: 'fogbinder', confirmation: 'understand' });
    await act({ type: 'redeem', milestone: 'fogbinder', confirmation: 'confirm' });
    expect(
      (await pool.query('SELECT 1 FROM referral_transfer_characters WHERE character_id=100'))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT 1 FROM referral_transfer_characters WHERE character_id=200'))
        .rowCount,
    ).toBe(1);
  });
  it('books offline first-paid referrals atomically with a durable feed cursor and rejects stale batches', async () => {
    expect(await store.membershipFeedCursor('test')).toBe('0');
    const receipts = [
      {
        cursor: '1',
        accountId: 20,
        firstPaid: {
          receiptId: 'paid_20',
          paidAtMs: 1,
          plan: 'game_monthly' as const,
          reversed: false,
        },
      },
      {
        cursor: '2',
        accountId: 30,
        firstPaid: {
          receiptId: 'paid_30',
          paidAtMs: 1,
          plan: 'game_monthly' as const,
          reversed: false,
        },
      },
    ];
    expect(await store.bookMembershipFeed('test', '0', '2', receipts)).toBe(true);
    expect(await store.membershipFeedCursor('test')).toBe('2');
    expect(
      (await pool.query('SELECT link_id,paid_receipt FROM referral_membership_bonds')).rows,
    ).toEqual([{ link_id: 20, paid_receipt: 'paid_20' }]);
    expect(await store.bookMembershipFeed('test', '0', '2', receipts)).toBe(false);
    expect(await store.membershipFeedCursor('test')).toBe('2');
  });
  it('uses bounded indexed pages and realm claims with a large unrelated backlog', async () => {
    await pool.query('INSERT INTO accounts SELECT generate_series(1000,101099)');
    await pool.query('INSERT INTO referrals SELECT id,10 FROM accounts WHERE id>=1000');
    await pool.query(
      `INSERT INTO referral_cards(link_id,inviter_account_id,state)
      SELECT referee_account_id,10,jsonb_set(jsonb_set($1::jsonb,'{linkId}',to_jsonb(referee_account_id)),
        '{participants,1,accountId}',to_jsonb(referee_account_id)) FROM referrals WHERE referee_account_id>=1000`,
      [JSON.stringify(createReferralCard(1000, 10, 1000))],
    );
    await pool.query(`INSERT INTO referral_membership_bonds(link_id,account_id,paid_receipt,recipient_realm)
      SELECT referee_account_id,10,'paid_'||referee_account_id,
        CASE WHEN referee_account_id<101000 THEN 'other' ELSE 'test' END
      FROM referrals WHERE referee_account_id>=1000`);
    await pool.query(`INSERT INTO referral_reward_outbox(receipt,account_id,tier)
      SELECT 'reward_'||id,id,1 FROM accounts WHERE id BETWEEN 1000 AND 1999`);
    await pool.query(
      'ANALYZE referrals; ANALYZE referral_cards; ANALYZE referral_membership_bonds; ANALYZE referral_reward_outbox',
    );
    const statements: { text: string; values?: unknown[] }[] = [];
    const measuredStore = new PgReferralStore({
      leaseHolder: 'test',
      pool: {
        query: pool.query.bind(pool),
        connect: (async () => {
          const client = await pool.connect();
          const query = client.query.bind(client),
            release = client.release.bind(client);
          client.query = ((text: string, values?: unknown[]) => {
            statements.push({ text, values });
            return query(text, values);
          }) as typeof client.query;
          client.release = (error?: Error | boolean) => {
            client.query = query;
            client.release = release;
            release(error);
          };
          return client;
        }) as Pool['connect'],
      },
      save: async () => true,
      saveOffline: async () => true,
      grant: (before) => before,
      move: (from, to) => ({ from, to }),
    });
    const begin = performance.now();
    const page = await measuredStore.page(10, 50000);
    const pageMs = performance.now() - begin;
    expect(page.links).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    const claimsBegin = performance.now();
    const bonds = await measuredStore.claimBonds('test', []);
    const claimsMs = performance.now() - claimsBegin;
    expect(bonds).toHaveLength(25);
    expect(bonds.every((b) => b.linkId >= 101000)).toBe(true);
    expect(await measuredStore.claimBonds('empty', [])).toEqual([]);
    expect(await measuredStore.claimRewards()).toHaveLength(25);
    const plans = [];
    for (const statement of statements.filter(
      (row) => row.text.startsWith('WITH links') || row.text.startsWith('WITH candidate'),
    )) {
      const explained = await pool.query(
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement.text,
        statement.values,
      );
      const plan = explained.rows[0]['QUERY PLAN'][0];
      const nodes: string[] = [];
      const visit = (node: Record<string, unknown>) => {
        nodes.push(
          String(node['Node Type']) + (node['Index Name'] ? ':' + node['Index Name'] : ''),
        );
        for (const child of (node.Plans ?? []) as Record<string, unknown>[]) visit(child);
      };
      visit(plan.Plan);
      plans.push({
        executionMs: plan['Execution Time'],
        rows: plan.Plan['Actual Rows'],
        hits: plan.Plan['Shared Hit Blocks'],
        nodes,
      });
    }
    process.stdout.write(
      JSON.stringify({
        referralScaleProof: {
          links: 100100,
          otherRealmBonds: 100000,
          rewardRows: 1000,
          pageMs,
          claimsMs,
          plans,
        },
      }) + '\n',
    );
  }, 60000);
});
