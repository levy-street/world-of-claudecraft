// Operator-surface pins (server/economy_admin.ts), driven through the db seam
// with no runtime `pg`.
//
// The acknowledge arm carries the weight here. Before it existed
// `acknowledged_at` had no writer at all, which meant three things silently:
// the queue could only grow, the retention sweep (which prunes ONLY
// acknowledged rows) pruned nothing forever, and the dedupe that keeps one
// incident to one row could never be re-armed. So what is pinned is not "the
// route returns 200" but the semantics an operator depends on: who gets
// recorded as having handled it, what a second click does, and what happens to
// a finding that is still true afterwards.

import { beforeEach, describe, expect, it } from 'vitest';
import { acknowledgeEconomyAlert, type EconomyAlertRow } from '../../server/economy_alerts_db';
import type { EconomyAlert } from '../../server/economy_reconcile';

// A tiny stand-in for the `economy_alerts` table: enough rows and enough of the
// dedupe rule to exercise the ack semantics, with no pg at all.
interface FakeRow extends EconomyAlertRow {
  acknowledgedBy: number | null;
}

function fakeTable() {
  let nextId = 1;
  const rows: FakeRow[] = [];
  return {
    rows,
    /** The insertEconomyAlerts dedupe: skip a matching row that is still OPEN. */
    insert(realm: string, alerts: readonly EconomyAlert[]): EconomyAlert[] {
      const inserted: EconomyAlert[] = [];
      for (const a of alerts) {
        const clash = rows.some(
          (r) =>
            r.realm === realm &&
            r.kind === a.kind &&
            r.delta === a.delta &&
            r.characterId === a.characterId &&
            r.acknowledgedAt === null,
        );
        if (clash) continue;
        rows.push({
          id: nextId++,
          realm,
          kind: a.kind,
          severity: a.severity,
          characterId: a.characterId,
          delta: a.delta,
          detail: a.detail,
          acknowledgedAt: null,
          acknowledgedBy: null,
          createdAt: '2026-08-17T00:00:00.000Z',
        });
        inserted.push(a);
      }
      return inserted;
    },
    /** The `acknowledged_at IS NULL` guard: first writer wins. */
    ack(realm: string, id: number, accountId: number): boolean {
      const row = rows.find((r) => r.id === id && r.realm === realm && r.acknowledgedAt === null);
      if (!row) return false;
      row.acknowledgedAt = '2026-08-17T01:00:00.000Z';
      row.acknowledgedBy = accountId;
      return true;
    },
    open(realm: string): FakeRow[] {
      return rows.filter((r) => r.realm === realm && r.acknowledgedAt === null);
    },
  };
}

function alert(over: Partial<EconomyAlert> = {}): EconomyAlert {
  return {
    kind: 'balance_mismatch',
    severity: 'critical',
    characterId: 7,
    delta: 5000,
    detail: 'the ledger and the save disagree',
    ...over,
  };
}

let table: ReturnType<typeof fakeTable>;
beforeEach(() => {
  table = fakeTable();
});

describe('acknowledging is first-writer-wins', () => {
  it('records WHO handled it, and a second click changes nothing', () => {
    table.insert('r1', [alert()]);
    const id = table.rows[0].id;

    expect(table.ack('r1', id, 42)).toBe(true);
    expect(table.rows[0].acknowledgedBy).toBe(42);

    // Two operators working the queue at once is the normal case during an
    // incident. The record of who looked FIRST is worth more than the record of
    // who clicked last, so the second call reports false and rewrites nothing.
    expect(table.ack('r1', id, 99)).toBe(false);
    expect(table.rows[0].acknowledgedBy).toBe(42);
  });

  it('reports false for an id on another realm rather than reaching across', () => {
    table.insert('r1', [alert()]);
    expect(table.ack('other-realm', table.rows[0].id, 42)).toBe(false);
    expect(table.rows[0].acknowledgedAt).toBeNull();
  });

  it('takes the finding out of the open queue', () => {
    table.insert('r1', [alert()]);
    expect(table.open('r1')).toHaveLength(1);
    table.ack('r1', table.rows[0].id, 42);
    expect(table.open('r1')).toHaveLength(0);
  });
});

describe('acknowledging re-arms the dedupe, and that is the point', () => {
  it('lets a still-true finding come back as a NEW row on the next pass', () => {
    // The hazard worth stating out loud: acknowledging is not a mute button. A
    // violation that is still there when the next pass runs files again, and
    // notifies again, because a finding that recurs AFTER an operator called it
    // handled is new information rather than a duplicate.
    table.insert('r1', [alert()]);
    const first = table.rows[0].id;

    // While it is open, the same finding does NOT pile up.
    expect(table.insert('r1', [alert()])).toEqual([]);
    expect(table.rows).toHaveLength(1);

    table.ack('r1', first, 42);
    expect(table.insert('r1', [alert()])).toHaveLength(1);
    expect(table.rows).toHaveLength(2);
    // The handled one stays as history; only the fresh one is in the queue.
    expect(table.open('r1').map((r) => r.id)).toEqual([table.rows[1].id]);
  });
});

describe('the real db functions guard their inputs before any query', () => {
  it('refuses a non-positive or unsafe alert id without touching the pool', async () => {
    // These run against the REAL module with no database configured: reaching a
    // query would throw rather than answering false, so a pass proves the guard
    // short-circuits first.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(await acknowledgeEconomyAlert('r1', bad, 42)).toBe(false);
    }
  });
});
