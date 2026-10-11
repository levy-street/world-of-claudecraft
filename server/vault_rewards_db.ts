// Durable vault outcome and one reward claim per participating character.
// The economic ledger is intentionally kept forever: deleting an old outcome
// would permit a replayed attempt id to pay twice after a restored character
// backup. Healthy claims leave the due-mail index when paid or mailed.

import type { CustodyParcelRow } from './mail_custody_overlay';
import { REALM } from './realm';

export const VAULT_REWARDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS vault_reward_outcomes (
  realm TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  owner_character_id BIGINT NOT NULL CHECK (owner_character_id > 0),
  payload JSONB NOT NULL,
  source_payload JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, attempt_id)
);
CREATE TABLE IF NOT EXISTS vault_reward_claims (
  realm TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  character_id BIGINT NOT NULL CHECK (character_id > 0),
  recipient_name TEXT NOT NULL,
  items JSONB NOT NULL,
  copper BIGINT NOT NULL CHECK (copper >= 0),
  guest_cycle TEXT NOT NULL DEFAULT '',
  mail_due_at TIMESTAMPTZ NOT NULL,
  mail_capacity_deferred_at TIMESTAMPTZ,
  direct_claimed_at TIMESTAMPTZ,
  mail_booked_at TIMESTAMPTZ,
  PRIMARY KEY (realm, attempt_id, character_id),
  FOREIGN KEY (realm, attempt_id)
    REFERENCES vault_reward_outcomes (realm, attempt_id),
  CHECK (direct_claimed_at IS NULL OR mail_booked_at IS NULL)
);
-- Keep forever: one row per participating guest/cycle; removing a baseline could let
-- a restored older character exceed the three-payout cycle cap. At 5,000
-- paid guest/cycles daily this is about 1.8 million small rows per year.
CREATE TABLE IF NOT EXISTS vault_guest_cycle_baselines (
  realm TEXT NOT NULL,
  character_id BIGINT NOT NULL,
  guest_cycle TEXT NOT NULL,
  existing_payouts SMALLINT NOT NULL CHECK (existing_payouts BETWEEN 0 AND 3),
  PRIMARY KEY (realm, character_id, guest_cycle)
);
ALTER TABLE vault_reward_outcomes ADD COLUMN IF NOT EXISTS source_payload JSONB;
ALTER TABLE vault_reward_claims ADD COLUMN IF NOT EXISTS guest_cycle TEXT NOT NULL DEFAULT '';
ALTER TABLE vault_reward_claims ADD COLUMN IF NOT EXISTS mail_capacity_deferred_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS vault_reward_claims_due_mail
  ON vault_reward_claims (realm, mail_due_at, attempt_id, character_id)
  WHERE direct_claimed_at IS NULL AND mail_booked_at IS NULL;
CREATE INDEX IF NOT EXISTS vault_reward_claims_recipient_first_deferred
  ON vault_reward_claims (realm, character_id, mail_capacity_deferred_at, attempt_id)
  WHERE direct_claimed_at IS NULL AND mail_booked_at IS NULL
    AND mail_capacity_deferred_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS vault_reward_claims_guest_cycle
  ON vault_reward_claims (realm, character_id, guest_cycle)
  WHERE copper > 0 OR items <> '[]'::jsonb;
`;

export interface VaultRewardItem {
  itemId: string;
  count: number;
}

export interface VaultRewardClaimInput {
  characterId: number;
  recipientName: string;
  items: VaultRewardItem[];
  copper: number;
  mailDueAt: Date;
  guestCycle?: string;
}

export interface VaultOutcomeInput {
  attemptId: string;
  ownerCharacterId: number;
  claims: VaultRewardClaimInput[];
}

export interface VaultRewardClaim {
  characterId: number;
  recipientName: string;
  items: VaultRewardItem[];
  copper: number;
  mailDueAt: string;
  guestCycle?: string;
}

export interface VaultOutcome {
  attemptId: string;
  ownerCharacterId: number;
  claims: VaultRewardClaim[];
  completedAt: Date;
}

export interface DueVaultRewardClaim extends VaultRewardClaim {
  attemptId: string;
}

export interface VaultRewardQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export interface VaultRewardClient {
  query(text: string, values?: unknown[]): Promise<VaultRewardQueryResult>;
  release(): void;
  on?(event: 'error', listener: (error: Error) => void): unknown;
  removeListener?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface VaultRewardPool {
  query(text: string, values?: unknown[]): Promise<VaultRewardQueryResult>;
  connect(): Promise<VaultRewardClient>;
}

/** PostgreSQL JSONB canonicalizes object keys; compare parcels in SQL, not
 * JSON.stringify on a decoded row, when recovering an ambiguous COMMIT. */
export async function vaultCustodyParcelStatus(
  pool: Pick<VaultRewardPool, 'query'>,
  realm: string,
  row: CustodyParcelRow,
): Promise<'missing' | 'matching' | 'conflict'> {
  const found = await pool.query(
    `SELECT recipient_key = $3 AS recipient_matches,
            recipient_name = $4 AS name_matches,
            letter = $5 AS letter_matches,
            items = $6::jsonb AS items_match,
            copper = $7 AS copper_matches
     FROM mail_custody_parcels WHERE custody_ref = $1 AND realm = $2`,
    [
      row.custodyRef,
      realm,
      row.recipient.key,
      row.recipient.name,
      row.letter,
      JSON.stringify(row.items),
      row.copper,
    ],
  );
  if (found.rowCount !== 1) return 'missing';
  const value = found.rows[0];
  return value.recipient_matches === true &&
    value.name_matches === true &&
    value.letter_matches === true &&
    value.items_match === true &&
    value.copper_matches === true
    ? 'matching'
    : 'conflict';
}

/** A missing ambiguous parcel is safe to forget only when a direct claim
 * won the same immutable reward row. The primary key bounds this probe. */
export async function vaultRewardClaimChannel(
  pool: Pick<VaultRewardPool, 'query'>,
  realm: string,
  attemptId: string,
  characterId: number,
): Promise<'direct' | 'mail' | 'pending' | 'missing'> {
  const result = await pool.query(
    `SELECT direct_claimed_at IS NOT NULL AS direct,
            mail_booked_at IS NOT NULL AS mail
     FROM vault_reward_claims
     WHERE realm = $1 AND attempt_id = $2 AND character_id = $3`,
    [realm, attemptId, characterId],
  );
  if (result.rowCount !== 1) return 'missing';
  if (result.rows[0].direct === true) return 'direct';
  if (result.rows[0].mail === true) return 'mail';
  return 'pending';
}

function positiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${label}`);
}

function normalizeOutcome(input: VaultOutcomeInput): Omit<VaultOutcome, 'completedAt'> {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(input.attemptId)) throw new Error('invalid attempt id');
  positiveId(input.ownerCharacterId, 'owner character id');
  if (input.claims.length < 1 || input.claims.length > 5) {
    throw new Error('vault outcome requires 1 to 5 claims');
  }
  const seen = new Set<number>();
  const claims = input.claims.map((claim): VaultRewardClaim => {
    positiveId(claim.characterId, 'claim character id');
    if (seen.has(claim.characterId)) throw new Error('duplicate character claim');
    seen.add(claim.characterId);
    if (!claim.recipientName || claim.recipientName.length > 64) {
      throw new Error('invalid recipient name');
    }
    if (!Number.isSafeInteger(claim.copper) || claim.copper < 0) {
      throw new Error('invalid claim copper');
    }
    if (!(claim.mailDueAt instanceof Date) || !Number.isFinite(claim.mailDueAt.getTime())) {
      throw new Error('invalid mail due time');
    }
    if (claim.items.length > 32) throw new Error('too many claim items');
    if (
      claim.guestCycle !== undefined &&
      (typeof claim.guestCycle !== 'string' || claim.guestCycle.length > 64)
    ) {
      throw new Error('invalid guest cycle');
    }
    const items = claim.items.map(({ itemId, count }) => {
      if (!/^[a-z0-9_:-]{1,128}$/.test(itemId)) throw new Error('invalid reward item id');
      if (!Number.isSafeInteger(count) || count <= 0 || count > 9999) {
        throw new Error('invalid reward item count');
      }
      return { itemId, count };
    });
    return {
      characterId: claim.characterId,
      recipientName: claim.recipientName,
      items,
      copper: claim.copper,
      mailDueAt: claim.mailDueAt.toISOString(),
      ...(claim.guestCycle === undefined ? {} : { guestCycle: claim.guestCycle }),
    };
  });
  if (!seen.has(input.ownerCharacterId)) throw new Error('owner must have a reward claim');
  claims.sort((a, b) => a.characterId - b.characterId);
  return { attemptId: input.attemptId, ownerCharacterId: input.ownerCharacterId, claims };
}

function numericId(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid stored vault reward number');
  return n;
}

/** The caller books mail or performs a lease-fenced character save in this SAME
 * transaction before committing. A standalone status update could lose loot. */
export async function markVaultRewardClaimBooked(
  client: Pick<VaultRewardClient, 'query'>,
  realm: string,
  attemptId: string,
  characterId: number,
  channel: 'direct' | 'mail',
): Promise<boolean> {
  positiveId(characterId, 'claim character id');
  const column = channel === 'direct' ? 'direct_claimed_at' : 'mail_booked_at';
  const result = await client.query(
    `UPDATE vault_reward_claims SET ${column} = now()
     WHERE realm = $1 AND attempt_id = $2 AND character_id = $3
       AND direct_claimed_at IS NULL AND mail_booked_at IS NULL
     RETURNING character_id`,
    [realm, attemptId, characterId],
  );
  return result.rowCount === 1;
}

export function createVaultRewardsDb(pool: VaultRewardPool, realm = REALM) {
  return {
    async guestPayoutsForCycle(characterId: number, cycle: string): Promise<number> {
      positiveId(characterId, 'guest character id');
      if (typeof cycle !== 'string' || cycle.length > 64) throw new Error('invalid guest cycle');
      const result = await pool.query(
        `SELECT LEAST(3,
           COALESCE((SELECT existing_payouts FROM vault_guest_cycle_baselines
             WHERE realm = $1 AND character_id = $2 AND guest_cycle = $3), 0)
           + (SELECT count(*)::int FROM (
             SELECT 1 FROM vault_reward_claims
             WHERE realm = $1 AND character_id = $2 AND guest_cycle = $3
               AND (copper > 0 OR items <> '[]'::jsonb)
             LIMIT 3
           ) paid)
         ) AS payouts`,
        [realm, characterId, cycle],
      );
      return Number(result.rows[0]?.payouts ?? 0);
    },

    async commitVaultOutcome(input: VaultOutcomeInput): Promise<'created' | 'already_committed'> {
      const outcome = normalizeOutcome(input);
      const sourcePayload = JSON.stringify(outcome);
      const client = await pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query(
          "SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '10s'",
        );
        const inserted = await client.query(
          `INSERT INTO vault_reward_outcomes
             (realm, attempt_id, owner_character_id, payload, source_payload)
           VALUES ($1, $2, $3, $4::jsonb, $4::jsonb)
           ON CONFLICT (realm, attempt_id) DO NOTHING
           RETURNING attempt_id`,
          [realm, outcome.attemptId, outcome.ownerCharacterId, sourcePayload],
        );
        if (inserted.rowCount !== 1) {
          const existing = await client.query(
            `SELECT COALESCE(source_payload, payload) = $3::jsonb AS same
             FROM vault_reward_outcomes WHERE realm = $1 AND attempt_id = $2`,
            [realm, outcome.attemptId, sourcePayload],
          );
          if (existing.rowCount !== 1 || existing.rows[0].same !== true) {
            throw new Error('conflicting vault outcome payload');
          }
          await client.query('COMMIT');
          committed = true;
          return 'already_committed';
        }
        const awarded = outcome.claims.map((claim) => ({ ...claim }));
        for (const claim of awarded) {
          if (claim.characterId === outcome.ownerCharacterId) continue;
          // Reserve guest cycle allowance at CLEAR, not at chest/mail take.
          // The transaction-scoped character lock serializes simultaneous
          // clears even across different server processes and attempt ids.
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `${realm}:vault-guest:${claim.characterId}:${claim.guestCycle ?? ''}`,
          ]);
          await client.query(
            `INSERT INTO vault_guest_cycle_baselines
               (realm, character_id, guest_cycle, existing_payouts)
             VALUES ($1, $2, $3,
               COALESCE((SELECT CASE
                 WHEN state #>> '{worldQuests,vaultGuestCycle}' = $3
                 THEN CASE
                   WHEN jsonb_typeof(state #> '{worldQuests,vaultGuestPayouts}') = 'number'
                   THEN LEAST(3, GREATEST(0,
                     FLOOR((state #>> '{worldQuests,vaultGuestPayouts}')::numeric)))::int
                   ELSE 0 END
                 ELSE 0 END
               FROM characters WHERE id = $2 AND realm = $1), 0))
             ON CONFLICT DO NOTHING`,
            [realm, claim.characterId, claim.guestCycle ?? ''],
          );
          const used = await client.query(
            `SELECT existing_payouts FROM vault_guest_cycle_baselines
             WHERE realm = $1 AND character_id = $2 AND guest_cycle = $3`,
            [realm, claim.characterId, claim.guestCycle ?? ''],
          );
          const awarded = await client.query(
            `SELECT 1 FROM vault_reward_claims
             WHERE realm = $1 AND character_id = $2 AND guest_cycle = $3
               AND (copper > 0 OR items <> '[]'::jsonb)
             LIMIT 3`,
            [realm, claim.characterId, claim.guestCycle ?? ''],
          );
          if (Number(used.rows[0]?.existing_payouts) + awarded.rows.length >= 3) {
            claim.items = [];
            claim.copper = 0;
          }
        }
        const awardedPayload = JSON.stringify({ ...outcome, claims: awarded });
        await client.query(
          `UPDATE vault_reward_outcomes SET payload = $3::jsonb
           WHERE realm = $1 AND attempt_id = $2`,
          [realm, outcome.attemptId, awardedPayload],
        );
        for (const claim of awarded) {
          await client.query(
            `INSERT INTO vault_reward_claims
               (realm, attempt_id, character_id, recipient_name, items, copper, mail_due_at, guest_cycle)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
            [
              realm,
              outcome.attemptId,
              claim.characterId,
              claim.recipientName,
              JSON.stringify(claim.items),
              claim.copper,
              claim.mailDueAt,
              claim.guestCycle ?? '',
            ],
          );
        }
        await client.query('COMMIT');
        committed = true;
        return 'created';
      } finally {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },

    async loadVaultOutcome(attemptId: string): Promise<VaultOutcome | null> {
      const result = await pool.query(
        `SELECT payload, completed_at FROM vault_reward_outcomes
         WHERE realm = $1 AND attempt_id = $2`,
        [realm, attemptId],
      );
      if (result.rowCount !== 1) return null;
      return {
        ...(result.rows[0].payload as Omit<VaultOutcome, 'completedAt'>),
        completedAt: result.rows[0].completed_at as Date,
      };
    },

    // A full vault mailbox keeps its payload in this ledger. Move only its
    // next delivery attempt; the immutable outcome remains unchanged.
    async deferVaultRewardClaim(
      attemptId: string,
      characterId: number,
      nextAt: Date,
    ): Promise<boolean> {
      const result = await pool.query(
        `UPDATE vault_reward_claims
            SET mail_due_at = GREATEST(mail_due_at, $4),
                mail_capacity_deferred_at = COALESCE(mail_capacity_deferred_at, now())
         WHERE realm = $1 AND attempt_id = $2 AND character_id = $3
           AND direct_claimed_at IS NULL AND mail_booked_at IS NULL`,
        [realm, attemptId, characterId, nextAt],
      );
      return result.rowCount === 1;
    },

    async wakeOldestVaultRewardClaim(
      characterId: number,
      now: Date,
    ): Promise<DueVaultRewardClaim | null> {
      const result = await pool.query(
        `WITH oldest AS (
           SELECT attempt_id FROM vault_reward_claims
           WHERE realm = $1 AND character_id = $2
             AND direct_claimed_at IS NULL AND mail_booked_at IS NULL
             AND mail_capacity_deferred_at IS NOT NULL
           ORDER BY mail_capacity_deferred_at, attempt_id LIMIT 1
         )
         UPDATE vault_reward_claims AS claim
            SET mail_due_at = LEAST(claim.mail_due_at, $3),
                mail_capacity_deferred_at = NULL
           FROM oldest
          WHERE claim.realm = $1 AND claim.character_id = $2
            AND claim.attempt_id = oldest.attempt_id
            AND claim.direct_claimed_at IS NULL AND claim.mail_booked_at IS NULL
         RETURNING claim.attempt_id, claim.character_id, claim.recipient_name,
                   claim.items, claim.copper, claim.mail_due_at`,
        [realm, characterId, now],
      );
      if (result.rowCount !== 1) return null;
      const row = result.rows[0];
      return {
        attemptId: row.attempt_id as string,
        characterId: numericId(row.character_id),
        recipientName: row.recipient_name as string,
        items: row.items as VaultRewardItem[],
        copper: numericId(row.copper),
        mailDueAt: (row.mail_due_at as Date).toISOString(),
      };
    },

    async dueVaultRewardClaims(
      limit: number,
      now: Date,
      after?: { mailDueAt: string; attemptId: string; characterId: number },
    ): Promise<DueVaultRewardClaim[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('vault due page limit must be 1 to 100');
      }
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new Error('invalid vault due page time');
      }
      const result = await pool.query(
        `SELECT attempt_id, character_id, recipient_name, items, copper, mail_due_at
         FROM vault_reward_claims
         WHERE realm = $1 AND mail_due_at <= $2
           AND direct_claimed_at IS NULL AND mail_booked_at IS NULL
           AND ($4::timestamptz IS NULL OR
             (mail_due_at, attempt_id, character_id) > ($4::timestamptz, $5::text, $6::bigint))
         ORDER BY mail_due_at, attempt_id, character_id
         LIMIT $3`,
        [
          realm,
          now,
          limit,
          after?.mailDueAt ?? null,
          after?.attemptId ?? null,
          after?.characterId ?? null,
        ],
      );
      return result.rows.map((row) => ({
        attemptId: row.attempt_id as string,
        characterId: numericId(row.character_id),
        recipientName: row.recipient_name as string,
        items: row.items as VaultRewardItem[],
        copper: numericId(row.copper),
        mailDueAt: (row.mail_due_at as Date).toISOString(),
      }));
    },
  };
}
