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

CREATE TABLE IF NOT EXISTS poker_seats (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  table_id TEXT NOT NULL,
  seat_index SMALLINT NOT NULL CHECK (seat_index BETWEEN 0 AND 5),
  seated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (realm, table_id)
    REFERENCES poker_tables(realm, table_id) ON DELETE CASCADE,
  UNIQUE (realm, table_id, seat_index)
);
CREATE INDEX IF NOT EXISTS poker_seats_account ON poker_seats(account_id);
`;

export interface PokerTableRow {
  tableId: string;
  payload: unknown;
  revision: number;
  status: 'waiting' | 'playing' | 'closed';
  handNumber: number;
  actionSequence: number;
}

export interface PokerSeatMutation {
  type: 'join' | 'leave';
  accountId: number;
  characterId: number;
  seatIndex: number;
}

export interface PokerStore {
  close(tableId: string, expectedRevision: number): Promise<void>;
  create(row: PokerTableRow): Promise<boolean>;
  load(tableId: string): Promise<PokerTableRow | null>;
  list(): Promise<PokerTableRow[]>;
  save(
    row: PokerTableRow,
    expectedRevision: number,
    seatMutation?: PokerSeatMutation,
  ): Promise<number>;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export type PokerQuery = (text: string, values?: unknown[]) => Promise<QueryResult>;

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
  return {
    tableId: String(row.table_id),
    payload: parsePayload(row.payload),
    revision: Number(row.revision),
    status: row.status as PokerTableRow['status'],
    handNumber: Number(row.hand_number),
    actionSequence: Number(row.action_sequence),
  };
}

export function createPokerStore(query: PokerQuery, realm: string): PokerStore {
  const valuesFor = (row: PokerTableRow): unknown[] => [
    realm,
    row.tableId,
    row.status,
    encodePayload(row.payload),
    row.revision,
    row.handNumber,
    row.actionSequence,
  ];

  return {
    async close(tableId, expectedRevision): Promise<void> {
      const result = await query(
        `WITH closed AS (
           UPDATE poker_tables
           SET status = 'closed', revision = revision + 1, updated_at = now()
           WHERE realm = $1 AND table_id = $2 AND revision = $3
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
           realm, table_id, status, payload, revision, hand_number, action_sequence, updated_at
         )
         VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, now())
         ON CONFLICT (realm, table_id) DO NOTHING
         RETURNING table_id`,
        valuesFor(row),
      );
      return result.rows.length === 1;
    },

    async load(tableId): Promise<PokerTableRow | null> {
      const result = await query(
        `SELECT table_id, payload, revision, status, hand_number, action_sequence
         FROM poker_tables
         WHERE realm = $1 AND table_id = $2`,
        [realm, tableId],
      );
      return result.rows[0] ? parseRow(result.rows[0]) : null;
    },

    async list(): Promise<PokerTableRow[]> {
      const result = await query(
        `SELECT table_id, payload, revision, status, hand_number, action_sequence
         FROM poker_tables
         WHERE realm = $1 AND status <> 'closed'
         ORDER BY table_id
         LIMIT 64`,
        [realm],
      );
      return result.rows.map(parseRow);
    },

    async save(row, expectedRevision, seatMutation): Promise<number> {
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
             WHERE realm = $1 AND table_id = $2 AND revision = $8
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
             WHERE realm = $1 AND table_id = $2 AND revision = $8
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
           WHERE realm = $1 AND table_id = $2 AND revision = $8
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

import { Buffer } from 'node:buffer';

export const POKER_MAX_PAYLOAD_BYTES = 32 * 1024;
