import { describe, expect, it } from 'vitest';
import {
  createPokerStore,
  POKER_MAX_PAYLOAD_BYTES,
  POKER_SCHEMA,
  type PokerTableRow,
} from '../../server/poker_db';

const ROW: PokerTableRow = {
  tableId: 'low-stakes-1',
  payload: { version: 1, seats: [] },
  revision: 3,
  status: 'waiting',
  handNumber: 2,
  actionSequence: 4,
};

describe('poker persistence', () => {
  it('pins DB-enforced character and seat uniqueness', () => {
    expect(POKER_SCHEMA).toContain('character_id INT PRIMARY KEY');
    expect(POKER_SCHEMA).toContain('UNIQUE (realm, table_id, seat_index)');
    expect(POKER_SCHEMA).toContain('PRIMARY KEY (realm, table_id)');
    expect(POKER_SCHEMA).toContain('action_sequence BIGINT NOT NULL');
  });

  it('accepts pg JSONB object payloads without reparsing them as strings', async () => {
    const store = createPokerStore(
      async () => ({
        rows: [
          {
            table_id: ROW.tableId,
            payload: ROW.payload,
            revision: ROW.revision,
            status: ROW.status,
            hand_number: ROW.handNumber,
            action_sequence: ROW.actionSequence,
          },
        ],
      }),
      'realm',
    );

    await expect(store.load(ROW.tableId)).resolves.toEqual(ROW);
  });

  it('joins a seat through the same revision-fenced statement as the table update', async () => {
    let sql = '';
    const store = createPokerStore(async (text, values) => {
      sql = text;
      return { rows: [{ revision: Number(values?.[4]) }] };
    }, 'realm');

    await expect(
      store.save({ ...ROW, revision: 4 }, 3, {
        type: 'join',
        accountId: 7,
        characterId: 9,
        seatIndex: 1,
      }),
    ).resolves.toBe(4);
    expect(sql).toContain('WITH updated AS');
    expect(sql).toContain('INSERT INTO poker_seats');
    expect(sql).toContain('revision = $8');
  });

  it('rejects authoritative payloads above the bounded table size', async () => {
    const store = createPokerStore(async () => ({ rows: [] }), 'realm');
    await expect(
      store.create({
        ...ROW,
        payload: { oversized: 'x'.repeat(POKER_MAX_PAYLOAD_BYTES) },
      }),
    ).rejects.toThrow(/too large/i);
  });
});
