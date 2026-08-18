import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { CHARACTER_ADVISORY_LOCK_NAMESPACE } from './character_lock';

export const POKER_SCHEMA = `
CREATE TABLE IF NOT EXISTS poker_tables (
  realm TEXT NOT NULL,
  table_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'playing', 'closed')),
  payload JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  hand_number BIGINT NOT NULL DEFAULT 0 CHECK (hand_number >= 0),
  action_sequence BIGINT NOT NULL DEFAULT 0 CHECK (action_sequence >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm, table_id)
);

ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS currency_version SMALLINT NOT NULL DEFAULT 0
  CHECK (currency_version IN (0, 1));
ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS escrow_copper BIGINT NOT NULL DEFAULT 0
  CHECK (escrow_copper >= 0);
ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS currency_generation TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE poker_tables ADD CONSTRAINT poker_tables_currency_generation_length
    CHECK (char_length(currency_generation) <= 64);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE poker_tables ADD CONSTRAINT poker_tables_escrow_copper_safe_integer
    CHECK (escrow_copper <= 9007199254740991);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION guard_poker_currency_table_write()
RETURNS trigger AS $$
BEGIN
  IF OLD.currency_version = 1
     AND current_setting('woc.poker_currency_write', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'currency-backed Poker table requires the current currency writer';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS poker_currency_table_write_guard ON poker_tables;
CREATE TRIGGER poker_currency_table_write_guard
BEFORE UPDATE OR DELETE ON poker_tables
FOR EACH ROW EXECUTE FUNCTION guard_poker_currency_table_write();

CREATE TABLE IF NOT EXISTS poker_seats (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  table_id TEXT NOT NULL,
  seat_index SMALLINT NOT NULL CHECK (seat_index BETWEEN 0 AND 5),
  participation_id TEXT CHECK (participation_id IS NULL OR char_length(participation_id) BETWEEN 1 AND 200),
  recoverable_balance BIGINT NOT NULL DEFAULT 0 CHECK (recoverable_balance >= 0),
  seated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (realm, table_id)
    REFERENCES poker_tables(realm, table_id) ON DELETE CASCADE,
  UNIQUE (realm, table_id, seat_index)
);
ALTER TABLE poker_seats ADD COLUMN IF NOT EXISTS participation_id TEXT
  CHECK (participation_id IS NULL OR char_length(participation_id) BETWEEN 1 AND 200);
ALTER TABLE poker_seats ADD COLUMN IF NOT EXISTS recoverable_balance BIGINT NOT NULL DEFAULT 0
  CHECK (recoverable_balance >= 0);
DO $$ BEGIN
  ALTER TABLE poker_seats ADD CONSTRAINT poker_seats_participation_id_length
    CHECK (participation_id IS NULL OR char_length(participation_id) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE poker_seats ADD CONSTRAINT poker_seats_recoverable_balance_nonnegative
    CHECK (recoverable_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE poker_seats ADD CONSTRAINT poker_seats_recoverable_balance_safe_integer
    CHECK (recoverable_balance <= 9007199254740991);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS poker_seats_account ON poker_seats(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS poker_seats_participation
  ON poker_seats(participation_id) WHERE participation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_poker_currency_seat_delete()
RETURNS trigger AS $$
BEGIN
  IF current_setting('woc.poker_currency_write', true) IS DISTINCT FROM '1'
     AND EXISTS (
       SELECT 1 FROM poker_tables
       WHERE realm = OLD.realm AND table_id = OLD.table_id AND currency_version = 1
     ) THEN
    RAISE EXCEPTION 'currency-backed Poker seat requires cash-out before deletion';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS poker_currency_seat_delete_guard ON poker_seats;
CREATE TRIGGER poker_currency_seat_delete_guard
BEFORE DELETE ON poker_seats
FOR EACH ROW EXECUTE FUNCTION guard_poker_currency_seat_delete();

-- KEEP FOREVER: this append-only ledger is the authoritative Poker money audit trail.
CREATE TABLE IF NOT EXISTS poker_ledger (
  operation_id TEXT PRIMARY KEY CHECK (char_length(operation_id) BETWEEN 1 AND 200),
  realm TEXT NOT NULL,
  table_id TEXT NOT NULL,
  hand_number BIGINT NOT NULL CHECK (hand_number >= 0),
  account_id INT,
  character_id INT,
  participation_id TEXT,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('buy_in', 'rebuy', 'cash_out', 'refund', 'rake', 'recovery')
  ),
  copper_delta BIGINT NOT NULL,
  escrow_delta BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (operation_type IN ('rake', 'recovery')) OR
    (account_id IS NOT NULL AND character_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS poker_ledger_table
  ON poker_ledger(realm, table_id, created_at);
CREATE INDEX IF NOT EXISTS poker_ledger_character
  ON poker_ledger(character_id, created_at) WHERE character_id IS NOT NULL;
ALTER TABLE poker_ledger ADD COLUMN IF NOT EXISTS participation_id TEXT;
DO $$ BEGIN
  ALTER TABLE poker_ledger ADD CONSTRAINT poker_ledger_participation_id_length
    CHECK (participation_id IS NULL OR char_length(participation_id) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS poker_ledger_participation
  ON poker_ledger(realm, table_id, participation_id)
  WHERE participation_id IS NOT NULL;
`;

export interface PokerTableRow {
  tableId: string;
  payload: unknown;
  revision: number;
  status: 'waiting' | 'playing' | 'closed';
  handNumber: number;
  actionSequence: number;
  currencyVersion?: 0 | 1;
  escrowCopper?: number;
  currencyGeneration?: string;
}

export interface PokerSeatRow {
  accountId: number;
  characterId: number;
  tableId: string;
  seatIndex: number;
  participationId: string | null;
  recoverableBalance: number;
}

export interface PokerSeatMutation {
  type: 'join' | 'leave';
  accountId: number;
  characterId: number;
  seatIndex: number;
  participationId?: string;
}

export interface PokerSeatBalance {
  characterId: number;
  balance: number;
}

export type PokerLedgerOperationType =
  | 'buy_in'
  | 'rebuy'
  | 'cash_out'
  | 'refund'
  | 'rake'
  | 'recovery';

export interface PokerCurrencyMutation {
  operationId: string;
  accountId: number | null;
  characterId: number | null;
  participationId?: string | null;
  handNumber: number;
  operationType: PokerLedgerOperationType;
  copperDelta: number;
  escrowDelta: number;
  leaseNonce?: string | null;
  copperBefore?: number;
  copperAfter?: number;
}

export interface PokerSaveResult {
  revision: number;
  applied: boolean;
  row?: PokerTableRow;
  characterCopper?: number;
}

export class PokerCurrencyOutcomeUnknownError extends Error {
  readonly code = 'POKER_CURRENCY_OUTCOME_UNKNOWN';
}

export interface PokerStore {
  close(tableId: string, expectedRevision: number): Promise<void>;
  create(row: PokerTableRow): Promise<boolean>;
  load(tableId: string): Promise<PokerTableRow | null>;
  list(): Promise<PokerTableRow[]>;
  listSeats?(): Promise<PokerSeatRow[]>;
  recover?(tableId: string, expectedRevision: number): Promise<void>;
  resetLegacy?(row: PokerTableRow, expectedRevision: number): Promise<number>;
  save(
    row: PokerTableRow,
    expectedRevision: number,
    seatMutation?: PokerSeatMutation,
    currency?: PokerCurrencyMutation,
    seatBalances?: readonly PokerSeatBalance[],
  ): Promise<number | PokerSaveResult>;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
}

export type PokerQuery = (text: string, values?: unknown[]) => Promise<QueryResult>;

interface PokerDbClient {
  query: PokerQuery;
  release(): void;
}

export type PokerConnect = () => Promise<PokerDbClient>;

function encodePayload(payload: unknown): string {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, 'utf8') > POKER_MAX_PAYLOAD_BYTES) {
    throw new Error('Poker table payload is too large');
  }
  return encoded;
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return JSON.parse(payload);
  return payload;
}

function parseRow(row: Record<string, unknown>): PokerTableRow {
  const escrowCopper = Number(row.escrow_copper ?? 0);
  const currencyGeneration = String(row.currency_generation ?? '');
  if (!Number.isSafeInteger(escrowCopper) || escrowCopper < 0) {
    throw new Error('Poker escrow balance is invalid');
  }
  return {
    tableId: String(row.table_id),
    payload: parsePayload(row.payload),
    revision: Number(row.revision),
    status: row.status as PokerTableRow['status'],
    handNumber: Number(row.hand_number),
    actionSequence: Number(row.action_sequence),
    currencyVersion: row.currency_version === 1 || row.currency_version === '1' ? 1 : 0,
    escrowCopper,
    currencyGeneration,
  };
}

function parseSeatRow(row: Record<string, unknown>): PokerSeatRow {
  const accountId = Number(row.account_id);
  const characterId = Number(row.character_id);
  const seatIndex = Number(row.seat_index);
  const tableId = String(row.table_id);
  const recoverableBalance = Number(row.recoverable_balance ?? 0);
  const participationId = typeof row.participation_id === 'string' ? row.participation_id : null;
  if (
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    !Number.isSafeInteger(characterId) ||
    characterId <= 0 ||
    !Number.isSafeInteger(seatIndex) ||
    seatIndex < 0 ||
    seatIndex > 5 ||
    !/^[a-z0-9-]{1,64}$/.test(tableId) ||
    !Number.isSafeInteger(recoverableBalance) ||
    recoverableBalance < 0 ||
    (participationId !== null && (participationId.length < 1 || participationId.length > 200))
  ) {
    throw new Error('Poker recoverable balance is invalid');
  }
  return {
    accountId,
    characterId,
    tableId,
    seatIndex,
    participationId,
    recoverableBalance,
  };
}

export function createPokerStore(
  query: PokerQuery,
  realm: string,
  connect?: PokerConnect,
  leaseHolder = '',
): PokerStore {
  const valuesFor = (row: PokerTableRow): unknown[] => [
    realm,
    row.tableId,
    row.status,
    encodePayload(row.payload),
    row.revision,
    row.handNumber,
    row.actionSequence,
    row.currencyVersion ?? 0,
    row.escrowCopper ?? 0,
    row.currencyGeneration ?? '',
  ];

  const requireConnect = (): PokerConnect => {
    if (!connect) throw new Error('Poker currency database transaction is unavailable');
    return connect;
  };

  const durableCopper = async (
    runQuery: PokerQuery,
    currency: PokerCurrencyMutation,
  ): Promise<number | undefined> => {
    if (currency.characterId === null || currency.accountId === null) return undefined;
    const result = await runQuery(
      `SELECT state->>'copper' AS copper
       FROM characters
       WHERE id = $1 AND account_id = $2 AND realm = $3`,
      [currency.characterId, currency.accountId, realm],
    );
    const copper = Number(result.rows[0]?.copper);
    if (!Number.isSafeInteger(copper) || copper < 0) {
      throw new Error('Poker durable Copper is invalid');
    }
    return copper;
  };

  const matchesLedger = (
    existing: Record<string, unknown> | undefined,
    currency: PokerCurrencyMutation,
  ): boolean =>
    existing !== undefined &&
    Number(existing.account_id ?? 0) === (currency.accountId ?? 0) &&
    Number(existing.character_id ?? 0) === (currency.characterId ?? 0) &&
    (existing.participation_id ?? null) === (currency.participationId ?? null) &&
    Number(existing.hand_number) === currency.handNumber &&
    existing.operation_type === currency.operationType &&
    Number(existing.copper_delta) === currency.copperDelta &&
    Number(existing.escrow_delta) === currency.escrowDelta;

  const reconcileCommittedOperation = async (
    tableId: string,
    currency: PokerCurrencyMutation,
  ): Promise<PokerSaveResult | null> => {
    const replay = await query(
      `SELECT account_id, character_id, participation_id, hand_number, operation_type,
              copper_delta, escrow_delta
       FROM poker_ledger
       WHERE operation_id = $1`,
      [currency.operationId],
    );
    if (!matchesLedger(replay.rows[0], currency)) return null;
    const table = await query(
      `SELECT table_id, payload, revision, status, hand_number, action_sequence,
              currency_version, escrow_copper, currency_generation
       FROM poker_tables
       WHERE realm = $1 AND table_id = $2`,
      [realm, tableId],
    );
    if (!table.rows[0]) throw new Error('Committed Poker table is unavailable');
    return {
      revision: Number(table.rows[0].revision),
      applied: false,
      row: parseRow(table.rows[0]),
      characterCopper: await durableCopper(query, currency),
    };
  };

  const currentTableRow = async (
    client: PokerDbClient,
    tableId: string,
  ): Promise<PokerTableRow | null> => {
    const result = await client.query(
      `SELECT table_id, payload, revision, status, hand_number, action_sequence,
              currency_version, escrow_copper, currency_generation
       FROM poker_tables
       WHERE realm = $1 AND table_id = $2
       FOR UPDATE`,
      [realm, tableId],
    );
    return result.rows[0] ? parseRow(result.rows[0]) : null;
  };

  const saveCurrencyTable = async (
    row: PokerTableRow,
    expectedRevision: number,
    seatMutation: PokerSeatMutation | undefined,
    currency: PokerCurrencyMutation | undefined,
    seatBalances: readonly PokerSeatBalance[],
  ): Promise<PokerSaveResult> => {
    if (row.currencyVersion !== 1) throw new Error('Poker currency table is not enabled');
    if (seatBalances.length > 6) throw new Error('Poker seat balance set is too large');
    const seatIds = new Set<number>();
    for (const seat of seatBalances) {
      if (
        !Number.isSafeInteger(seat.characterId) ||
        seat.characterId <= 0 ||
        !Number.isSafeInteger(seat.balance) ||
        seat.balance < 0 ||
        seatIds.has(seat.characterId)
      ) {
        throw new Error('Poker seat balance is invalid');
      }
      seatIds.add(seat.characterId);
    }
    if (currency) {
      if (
        currency.operationId.length < 1 ||
        currency.operationId.length > 200 ||
        !Number.isSafeInteger(currency.handNumber) ||
        currency.handNumber < 0 ||
        !Number.isSafeInteger(currency.copperDelta) ||
        !Number.isSafeInteger(currency.escrowDelta) ||
        (currency.copperBefore === undefined) !== (currency.copperAfter === undefined) ||
        (currency.copperBefore !== undefined &&
          (!Number.isSafeInteger(currency.copperBefore) ||
            !Number.isSafeInteger(currency.copperAfter) ||
            (currency.copperAfter as number) - currency.copperBefore !== currency.copperDelta))
      ) {
        throw new Error('Poker currency operation is invalid');
      }
      const playerOperation = !['rake', 'recovery'].includes(currency.operationType);
      if (
        playerOperation !== (currency.accountId !== null && currency.characterId !== null) ||
        playerOperation !== Boolean(currency.participationId) ||
        (currency.participationId != null &&
          (currency.participationId.length < 1 || currency.participationId.length > 200)) ||
        (playerOperation && currency.copperDelta + currency.escrowDelta !== 0) ||
        (currency.operationType === 'rake' &&
          (currency.copperDelta !== 0 || currency.escrowDelta >= 0))
      ) {
        throw new Error('Poker currency deltas are invalid');
      }
    }
    const balanceTotal = seatBalances.reduce((sum, seat) => sum + seat.balance, 0);
    if (!Number.isSafeInteger(balanceTotal) || balanceTotal !== (row.escrowCopper ?? 0)) {
      throw new Error('Poker escrow and seat balances do not match');
    }
    const client = await requireConnect()();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('lock_timeout', '1s', true),
                set_config('statement_timeout', '3s', true),
                set_config('idle_in_transaction_session_timeout', '5s', true),
                set_config('woc.poker_currency_write', '1', true)`,
      );
      const current = await currentTableRow(client, row.tableId);
      if (!current) throw new Error('Poker table not found');
      if (current.currencyVersion !== 1) throw new Error('Poker currency table is not enabled');

      if (currency) {
        const replay = await client.query(
          `SELECT account_id, character_id, participation_id, hand_number, operation_type,
                  copper_delta, escrow_delta
           FROM poker_ledger
           WHERE operation_id = $1`,
          [currency.operationId],
        );
        const existing = replay.rows[0];
        if (existing) {
          if (!matchesLedger(existing, currency)) {
            throw new Error('Poker operation id conflicts with another operation');
          }
          if (currency.characterId !== null) {
            await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
              CHARACTER_ADVISORY_LOCK_NAMESPACE,
              currency.characterId,
            ]);
          }
          const characterCopper = await durableCopper(
            (text, values) => client.query(text, values),
            currency,
          );
          await client.query('ROLLBACK');
          return {
            revision: current.revision,
            applied: false,
            row: current,
            characterCopper,
          };
        }
      }

      if (current.revision !== expectedRevision) {
        throw new Error('Poker table changed concurrently');
      }
      const escrowDelta = (row.escrowCopper ?? 0) - (current.escrowCopper ?? 0);
      if (!Number.isSafeInteger(escrowDelta)) throw new Error('Poker escrow delta is invalid');
      if (currency?.escrowDelta !== escrowDelta || (!currency && escrowDelta !== 0)) {
        throw new Error('Poker escrow mutation is missing or inconsistent');
      }

      if (currency && currency.characterId !== null && currency.accountId !== null) {
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          CHARACTER_ADVISORY_LOCK_NAMESPACE,
          currency.characterId,
        ]);
        if (currency.leaseNonce == null) {
          await client.query(
            'DELETE FROM character_leases WHERE character_id = $1 AND expires_at < now()',
            [currency.characterId],
          );
        }
        const character = await client.query(
          `UPDATE characters
           SET state = jsonb_set(
                 COALESCE(state, '{}'::jsonb),
                 '{copper}',
                 to_jsonb((CASE
                   WHEN $8::bigint IS NULL
                     THEN (COALESCE(state->>'copper', '0'))::bigint + $4
                   ELSE $9::bigint
                 END)::bigint),
                 true
               ),
               updated_at = now()
           WHERE id = $1 AND account_id = $2 AND realm = $3
             AND (CASE
                    WHEN $8::bigint IS NULL
                      THEN (COALESCE(state->>'copper', '0'))::bigint + $4
                    ELSE $9::bigint
                  END) BETWEEN 0 AND $5
             AND (
               $6::text IS NULL AND NOT EXISTS (
                 SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND expires_at >= now()
               )
               OR $6::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND holder = $7 AND nonce = $6
               )
             )
           RETURNING id`,
          [
            currency.characterId,
            currency.accountId,
            realm,
            currency.copperDelta,
            Number.MAX_SAFE_INTEGER,
            currency.leaseNonce ?? null,
            leaseHolder,
            currency.copperBefore ?? null,
            currency.copperAfter ?? null,
          ],
        );
        if ((character.rowCount ?? character.rows.length) !== 1) {
          throw new Error(
            currency.copperDelta < 0
              ? 'Not enough Copper or character lease changed'
              : 'Character lease changed or Copper would overflow',
          );
        }
      }

      const nextRevision = expectedRevision + 1;
      const updated = await client.query(
        `UPDATE poker_tables
         SET status = $3, payload = $4::jsonb, revision = $5,
             hand_number = $6, action_sequence = $7, currency_version = 1,
             escrow_copper = $8, currency_generation = $9, updated_at = now()
         WHERE realm = $1 AND table_id = $2 AND revision = $10
         RETURNING revision`,
        [
          realm,
          row.tableId,
          row.status,
          encodePayload(row.payload),
          nextRevision,
          row.handNumber,
          row.actionSequence,
          row.escrowCopper ?? 0,
          row.currencyGeneration ?? '',
          expectedRevision,
        ],
      );
      if ((updated.rowCount ?? updated.rows.length) !== 1) {
        throw new Error('Poker table changed concurrently');
      }

      if (seatMutation?.type === 'join') {
        if (!seatMutation.participationId) throw new Error('Poker participation id is required');
        const balance = seatBalances.find(
          (entry) => entry.characterId === seatMutation.characterId,
        )?.balance;
        if (balance === undefined) throw new Error('Joined Poker seat balance is missing');
        await client.query(
          `INSERT INTO poker_seats(
             account_id, character_id, realm, table_id, seat_index,
             participation_id, recoverable_balance
           ) VALUES($1, $2, $3, $4, $5, $6, $7)`,
          [
            seatMutation.accountId,
            seatMutation.characterId,
            realm,
            row.tableId,
            seatMutation.seatIndex,
            seatMutation.participationId,
            balance,
          ],
        );
      } else if (seatMutation?.type === 'leave') {
        const removed = await client.query(
          'DELETE FROM poker_seats WHERE character_id = $1 AND realm = $2 AND table_id = $3',
          [seatMutation.characterId, realm, row.tableId],
        );
        if ((removed.rowCount ?? 0) !== 1) throw new Error('Poker seat is missing');
      }

      if (seatBalances.length > 0) {
        const balances = await client.query(
          `WITH wanted AS (
             SELECT "characterId" AS character_id, balance
             FROM jsonb_to_recordset($3::jsonb) AS x("characterId" int, balance bigint)
           )
           UPDATE poker_seats AS seats
           SET recoverable_balance = wanted.balance
           FROM wanted
           WHERE seats.realm = $1 AND seats.table_id = $2
             AND seats.character_id = wanted.character_id
           RETURNING seats.character_id`,
          [realm, row.tableId, JSON.stringify(seatBalances)],
        );
        if ((balances.rowCount ?? balances.rows.length) !== seatBalances.length) {
          throw new Error('Poker seat balances changed concurrently');
        }
      }

      if (currency) {
        await client.query(
          `INSERT INTO poker_ledger(
             operation_id, realm, table_id, hand_number, account_id, character_id,
             participation_id, operation_type, copper_delta, escrow_delta, created_at
           ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
          [
            currency.operationId,
            realm,
            row.tableId,
            currency.handNumber,
            currency.accountId,
            currency.characterId,
            currency.participationId ?? null,
            currency.operationType,
            currency.copperDelta,
            currency.escrowDelta,
          ],
        );
      }
      await client.query('COMMIT');
      return {
        revision: nextRevision,
        applied: true,
        characterCopper: currency?.copperAfter,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (currency) {
        try {
          const committed = await reconcileCommittedOperation(row.tableId, currency);
          if (committed) return committed;
        } catch (reconcileError) {
          throw new PokerCurrencyOutcomeUnknownError(
            `Poker currency outcome could not be reconciled: ${String(reconcileError)}`,
          );
        }
      }
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    async close(tableId, expectedRevision): Promise<void> {
      const result = await query(
        `WITH closed AS (
           UPDATE poker_tables
           SET status = 'closed', revision = revision + 1, updated_at = now()
           WHERE realm = $1 AND table_id = $2 AND revision = $3 AND currency_version = 0
           RETURNING realm, table_id, revision
         ), removed AS (
           DELETE FROM poker_seats AS seats
           USING closed
           WHERE seats.realm = closed.realm AND seats.table_id = closed.table_id
         )
         SELECT revision FROM closed`,
        [realm, tableId, expectedRevision],
      );
      if (result.rows.length !== 1) throw new Error('Poker table changed concurrently');
    },

    async create(row): Promise<boolean> {
      const result = await query(
        `INSERT INTO poker_tables(
           realm, table_id, status, payload, revision, hand_number, action_sequence,
           currency_version, escrow_copper, currency_generation, updated_at
         )
         VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (realm, table_id) DO NOTHING
         RETURNING table_id`,
        valuesFor(row),
      );
      return result.rows.length === 1;
    },

    async load(tableId): Promise<PokerTableRow | null> {
      const result = await query(
        `SELECT table_id, payload, revision, status, hand_number, action_sequence,
                currency_version, escrow_copper, currency_generation
         FROM poker_tables
         WHERE realm = $1 AND table_id = $2`,
        [realm, tableId],
      );
      return result.rows[0] ? parseRow(result.rows[0]) : null;
    },

    async list(): Promise<PokerTableRow[]> {
      const result = await query(
        `SELECT table_id, payload, revision, status, hand_number, action_sequence,
                currency_version, escrow_copper, currency_generation
         FROM poker_tables
         WHERE realm = $1 AND status <> 'closed'
         ORDER BY table_id
         LIMIT 64`,
        [realm],
      );
      return result.rows.map(parseRow);
    },

    async listSeats(): Promise<PokerSeatRow[]> {
      const result = await query(
        `SELECT seats.account_id, seats.character_id, seats.table_id, seats.seat_index,
                seats.participation_id, seats.recoverable_balance
         FROM poker_seats AS seats
         JOIN poker_tables AS tables
           ON tables.realm = seats.realm AND tables.table_id = seats.table_id
         WHERE seats.realm = $1 AND tables.status <> 'closed'
         ORDER BY seats.table_id, seats.seat_index
         LIMIT 384`,
        [realm],
      );
      return result.rows.map(parseSeatRow);
    },

    async resetLegacy(row, expectedRevision): Promise<number> {
      if (row.currencyVersion !== 1 || row.escrowCopper !== 0) {
        throw new Error('Legacy Poker reset must create an empty currency table');
      }
      const result = await query(
        `WITH configured AS MATERIALIZED (
           SELECT set_config('woc.poker_currency_write', '1', true)
         ), updated AS (
           UPDATE poker_tables
           SET status = $3, payload = $4::jsonb, revision = revision + 1,
               hand_number = $5, action_sequence = $6,
               currency_version = 1, escrow_copper = 0,
               currency_generation = $7, updated_at = now()
           WHERE realm = $1 AND table_id = $2 AND revision = $8
             AND currency_version = 0
             AND EXISTS (SELECT 1 FROM configured)
           RETURNING realm, table_id, revision
         ), removed AS (
           DELETE FROM poker_seats AS seats
           USING updated
           WHERE seats.realm = updated.realm AND seats.table_id = updated.table_id
         )
         SELECT revision FROM updated`,
        [
          realm,
          row.tableId,
          row.status,
          encodePayload(row.payload),
          row.handNumber,
          row.actionSequence,
          row.currencyGeneration ?? '',
          expectedRevision,
        ],
      );
      const revision = Number(result.rows[0]?.revision);
      if (revision !== expectedRevision + 1) throw new Error('Poker table changed concurrently');
      return revision;
    },

    async recover(tableId, expectedRevision): Promise<void> {
      const client = await requireConnect()();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('lock_timeout', '1s', true),
                  set_config('statement_timeout', '3s', true),
                  set_config('idle_in_transaction_session_timeout', '5s', true),
                  set_config('woc.poker_currency_write', '1', true)`,
        );
        const current = await currentTableRow(client, tableId);
        if (!current || current.revision !== expectedRevision || current.currencyVersion !== 1) {
          throw new Error('Poker table changed concurrently');
        }
        const seatsResult = await client.query(
          `SELECT account_id, character_id, table_id, seat_index,
                  participation_id, recoverable_balance
           FROM poker_seats
           WHERE realm = $1 AND table_id = $2
           ORDER BY character_id`,
          [realm, tableId],
        );
        const seats = seatsResult.rows.map(parseSeatRow);
        const ledgerParticipants = await client.query(
          `SELECT participation_id, MIN(account_id) AS account_id,
                  MIN(character_id) AS character_id,
                  SUM(CASE WHEN operation_type IN ('buy_in', 'rebuy')
                           THEN escrow_delta ELSE 0 END) AS contributed
           FROM poker_ledger
           WHERE realm = $1 AND table_id = $2 AND participation_id IS NOT NULL
           GROUP BY participation_id
           HAVING BOOL_OR(operation_type = 'buy_in')
              AND NOT BOOL_OR(operation_type IN ('cash_out', 'refund'))
              AND MIN(account_id) = MAX(account_id)
              AND MIN(character_id) = MAX(character_id)`,
          [realm, tableId],
        );
        const candidates = seats.map((seat) => ({
          accountId: seat.accountId,
          characterId: seat.characterId,
          participationId:
            seat.participationId ??
            `legacy:${current.currencyGeneration ?? tableId}:${seat.characterId}`,
          requested: seat.recoverableBalance,
          amount: 0,
        }));
        const knownParticipations = new Set(candidates.map((entry) => entry.participationId));
        for (const raw of ledgerParticipants.rows) {
          const participationId = String(raw.participation_id ?? '');
          const accountId = Number(raw.account_id);
          const characterId = Number(raw.character_id);
          const contributed = Number(raw.contributed);
          if (
            knownParticipations.has(participationId) ||
            participationId.length < 1 ||
            participationId.length > 200 ||
            !Number.isSafeInteger(accountId) ||
            accountId <= 0 ||
            !Number.isSafeInteger(characterId) ||
            characterId <= 0 ||
            !Number.isSafeInteger(contributed) ||
            contributed < 0
          ) {
            continue;
          }
          candidates.push({
            accountId,
            characterId,
            participationId,
            requested: contributed,
            amount: 0,
          });
        }
        candidates.sort(
          (left, right) =>
            left.characterId - right.characterId ||
            left.participationId.localeCompare(right.participationId),
        );
        let remaining = current.escrowCopper ?? 0;
        for (const candidate of candidates) {
          candidate.amount = Math.min(candidate.requested, remaining);
          remaining -= candidate.amount;
        }
        // Corruption can make recoverable rows sum below escrow. Preserve every
        // Copper deterministically rather than burning the residual: the first
        // stable recipient receives it. With no identifiable recipient, retain
        // the table and escrow for operator recovery instead of confiscating it.
        if (remaining > 0) {
          const residualRecipient = candidates[0];
          if (!residualRecipient) throw new Error('Poker recovery has no refund recipient');
          residualRecipient.amount += remaining;
          remaining = 0;
        }
        for (const candidate of candidates) {
          await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
            CHARACTER_ADVISORY_LOCK_NAMESPACE,
            candidate.characterId,
          ]);
          await client.query(
            'DELETE FROM character_leases WHERE character_id = $1 AND expires_at < now()',
            [candidate.characterId],
          );
          const liveLease = await client.query(
            `SELECT 1 FROM character_leases
             WHERE character_id = $1 AND expires_at >= now()`,
            [candidate.characterId],
          );
          if (liveLease.rows.length > 0) throw new Error('Poker recovery waits for live character');
          const amount = candidate.amount;
          if (amount > 0) {
            const credited = await client.query(
              `UPDATE characters
               SET state = jsonb_set(
                     COALESCE(state, '{}'::jsonb),
                     '{copper}',
                     to_jsonb(((COALESCE(state->>'copper', '0'))::bigint + $4)::bigint),
                     true
                   ),
                   updated_at = now()
               WHERE id = $1 AND account_id = $2 AND realm = $3
                 AND ((COALESCE(state->>'copper', '0'))::bigint + $4) <= $5
               RETURNING id`,
              [candidate.characterId, candidate.accountId, realm, amount, Number.MAX_SAFE_INTEGER],
            );
            if ((credited.rowCount ?? credited.rows.length) !== 1) {
              throw new Error('Poker recovery Copper credit failed');
            }
          }
          await client.query(
            `INSERT INTO poker_ledger(
               operation_id, realm, table_id, hand_number, account_id, character_id,
               participation_id, operation_type, copper_delta, escrow_delta, created_at
             ) VALUES($1, $2, $3, $4, $5, $6, $7, 'refund', $8, $9, now())`,
            [
              `refund:${createHash('sha256').update(candidate.participationId).digest('hex')}`,
              realm,
              tableId,
              current.handNumber,
              candidate.accountId,
              candidate.characterId,
              candidate.participationId,
              amount,
              -amount,
            ],
          );
        }
        await client.query(
          `INSERT INTO poker_ledger(
             operation_id, realm, table_id, hand_number, operation_type,
             copper_delta, escrow_delta, created_at
           ) VALUES($1, $2, $3, $4, 'recovery', 0, 0, now())`,
          [
            `recovery:${current.currencyGeneration ?? 'legacy'}:${expectedRevision}`,
            realm,
            tableId,
            current.handNumber,
          ],
        );
        const closed = await client.query(
          `DELETE FROM poker_tables
           WHERE realm = $1 AND table_id = $2 AND revision = $3
           RETURNING revision`,
          [realm, tableId, expectedRevision],
        );
        if ((closed.rowCount ?? closed.rows.length) !== 1) {
          throw new Error('Poker recovery table close failed');
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async save(
      row,
      expectedRevision,
      seatMutation,
      currency,
      seatBalances,
    ): Promise<number | PokerSaveResult> {
      if (row.currencyVersion === 1) {
        return saveCurrencyTable(row, expectedRevision, seatMutation, currency, seatBalances ?? []);
      }
      const nextRevision = expectedRevision + 1;
      const baseValues = [
        realm,
        row.tableId,
        row.status,
        encodePayload(row.payload),
        nextRevision,
        row.handNumber,
        row.actionSequence,
        expectedRevision,
      ];
      let result: QueryResult;
      if (seatMutation?.type === 'join') {
        result = await query(
          `WITH updated AS (
             UPDATE poker_tables
             SET status = $3, payload = $4::jsonb, revision = $5,
                 hand_number = $6, action_sequence = $7, updated_at = now()
             WHERE realm = $1 AND table_id = $2 AND revision = $8 AND currency_version = 0
             RETURNING realm, table_id, revision
           ), seated AS (
             INSERT INTO poker_seats(account_id, character_id, realm, table_id, seat_index)
             SELECT $9, $10, realm, table_id, $11 FROM updated
             RETURNING character_id
           )
           SELECT updated.revision FROM updated JOIN seated ON true`,
          [...baseValues, seatMutation.accountId, seatMutation.characterId, seatMutation.seatIndex],
        );
      } else if (seatMutation?.type === 'leave') {
        result = await query(
          `WITH updated AS (
             UPDATE poker_tables
             SET status = $3, payload = $4::jsonb, revision = $5,
                 hand_number = $6, action_sequence = $7, updated_at = now()
             WHERE realm = $1 AND table_id = $2 AND revision = $8 AND currency_version = 0
             RETURNING revision
           ), removed AS (
             DELETE FROM poker_seats
             WHERE character_id = $9 AND EXISTS (SELECT 1 FROM updated)
           )
           SELECT revision FROM updated`,
          [...baseValues, seatMutation.characterId],
        );
      } else {
        result = await query(
          `UPDATE poker_tables
           SET status = $3, payload = $4::jsonb, revision = $5,
               hand_number = $6, action_sequence = $7, updated_at = now()
           WHERE realm = $1 AND table_id = $2 AND revision = $8 AND currency_version = 0
           RETURNING revision`,
          baseValues,
        );
      }
      const revision = Number(result.rows[0]?.revision);
      if (revision !== nextRevision) throw new Error('Poker table changed concurrently');
      return revision;
    },
  };
}

export const POKER_MAX_PAYLOAD_BYTES = 32 * 1024;
