// Operator-notification pins (server/economy_alert_outbox.ts).
//
// The queue is process-global, so every case resets it first. What is being
// pinned is a set of editorial decisions, not plumbing: which findings are worth
// interrupting a human for, which end of a full queue to drop, and whether a
// truncated batch is allowed to look complete.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  drainEconomyAlerts,
  ECONOMY_ALERT_MAX_QUEUE,
  economyAlertQueueDepth,
  enqueueEconomyAlert,
  notifyEconomyAlerts,
  requeueEconomyAlerts,
  resetEconomyAlertOutboxForTests,
} from '../../server/economy_alert_outbox';
import type { EconomyAlert } from '../../server/economy_reconcile';

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

beforeEach(() => {
  resetEconomyAlertOutboxForTests();
});

describe('only criticals interrupt a human', () => {
  it('sends a critical and drops the warning beside it', () => {
    notifyEconomyAlerts('realm-1', [
      alert({ kind: 'balance_mismatch', severity: 'critical' }),
      // A warning means the reconciler could not tell a finding from save lag or
      // a dropped write. Paging for those retrains the operator to ignore the
      // channel, and the message they then ignore is the real dupe.
      alert({ kind: 'evidence_incomplete', severity: 'warning' }),
      alert({ kind: 'chain_break', severity: 'warning' }),
    ]);
    const drain = drainEconomyAlerts();
    expect(drain.items.map((i) => i.kind)).toEqual(['balance_mismatch']);
    expect(drain.items[0].realm).toBe('realm-1');
  });

  it('carries the sign of the delta, which is the whole finding', () => {
    notifyEconomyAlerts('realm-1', [alert({ delta: -400 })]);
    // Positive is coin the world holds that the ledger cannot explain (the
    // duplication direction); negative is coin that vanished. An operator reads
    // the sign before anything else, so an abs() here would erase the finding.
    expect(drainEconomyAlerts().items[0].delta).toBe(-400);
  });
});

describe('a full queue keeps the first sighting, not the latest', () => {
  it('drops the newest past the cap and counts what it refused', () => {
    for (let i = 0; i < ECONOMY_ALERT_MAX_QUEUE + 3; i++) {
      enqueueEconomyAlert({
        realm: 'r',
        kind: 'supply_mismatch',
        severity: 'critical',
        characterId: null,
        delta: i,
        detail: `finding ${i}`,
      });
    }
    const drain = drainEconomyAlerts();
    expect(drain.items).toHaveLength(ECONOMY_ALERT_MAX_QUEUE);
    // The OLDEST survive: everything after the first sighting of an incident is
    // downstream of the same breach, so the earliest evidence is what an
    // investigation actually starts from. This is the opposite of the social
    // relay's drop-the-oldest rule, and deliberately so.
    expect(drain.items[0].delta).toBe(0);
    expect(drain.suppressed).toBe(3);
  });

  it('never reports a suppressed count twice', () => {
    for (let i = 0; i < ECONOMY_ALERT_MAX_QUEUE + 1; i++) {
      enqueueEconomyAlert({
        realm: 'r',
        kind: 'supply_mismatch',
        severity: 'critical',
        characterId: null,
        delta: i,
        detail: 'x',
      });
    }
    expect(drainEconomyAlerts().suppressed).toBe(1);
    expect(drainEconomyAlerts().suppressed).toBe(0);
  });
});

describe('a failed poll costs a retry, not the findings', () => {
  it('restores the items in order and the suppressed count with them', () => {
    notifyEconomyAlerts('r', [alert({ delta: 1 }), alert({ delta: 2 })]);
    const drain = drainEconomyAlerts();
    expect(economyAlertQueueDepth()).toBe(0);

    requeueEconomyAlerts({ items: drain.items, suppressed: 4 });
    const second = drainEconomyAlerts();
    expect(second.items.map((i) => i.delta)).toEqual([1, 2]);
    // The suppressed count is not decoration: it is the only record that the
    // queue ever refused anything, and losing it on a retry would turn a partial
    // view of an incident into one that claims to be complete.
    expect(second.suppressed).toBe(4);
  });

  it('counts a requeue that no longer fits rather than silently losing it', () => {
    const stale = Array.from({ length: 5 }, (_, i) => ({
      realm: 'r',
      kind: 'supply_mismatch' as const,
      severity: 'critical' as const,
      characterId: null,
      delta: i,
      detail: 'x',
    }));
    // The queue refilled to the cap while the poll was failing.
    for (let i = 0; i < ECONOMY_ALERT_MAX_QUEUE; i++) {
      enqueueEconomyAlert({ ...stale[0], delta: 100 + i });
    }
    requeueEconomyAlerts({ items: stale, suppressed: 0 });
    const drain = drainEconomyAlerts();
    expect(drain.items).toHaveLength(ECONOMY_ALERT_MAX_QUEUE);
    expect(drain.suppressed).toBe(5);
  });
});
