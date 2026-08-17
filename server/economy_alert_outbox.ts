// Economy Watch, phase 3: the OPERATOR NOTIFICATION for a conservation finding.
//
// The `economy_alerts` table is the durable record and the work queue; this is
// the tap on the shoulder. The two are deliberately not the same thing: a table
// answers "what is still unhandled" and a notification answers "look now", and
// an incident needs both. Delivery is AT MOST ONCE by design (the bot drains
// this queue and a failed post loses the message, never the row), which is the
// right trade only because the durable record is the table: a lost ping costs
// latency, never evidence.
//
// CRITICAL ONLY, and that is the whole editorial policy of this module. A
// warning means the reconciler could not tell a finding from save lag or a
// dropped write; paging a human for those retrains them to ignore the channel,
// and the message they then ignore is the real dupe. Warnings stay in the table
// and on the metrics, where somebody looks on purpose rather than being
// interrupted.
//
// Pure and dependency-free (no Discord IO, no database), the discord_relay.ts
// shape, so it is trivially testable.

import type { EconomyAlert, EconomyAlertKind } from './economy_reconcile';

/** One finding awaiting delivery to the operator channel. */
export interface QueuedEconomyAlert {
  realm: string;
  kind: EconomyAlertKind;
  /** Always 'critical'; carried so the bot renders severity without inferring it. */
  severity: 'critical';
  /** The character the finding is against, or null for a realm-wide one. */
  characterId: number | null;
  /** Signed copper. Positive is the duplication direction. */
  delta: number;
  /** The reconciler's own English sentence, already operator-facing. */
  detail: string;
}

/**
 * Queue bound. Small on purpose: past a handful of distinct unhandled criticals
 * the operator's problem is no longer "which one", and the table holds them all
 * regardless.
 */
export const ECONOMY_ALERT_MAX_QUEUE = 20;

const QUEUE: QueuedEconomyAlert[] = [];
let suppressed = 0;

/**
 * Enqueue a critical finding for delivery.
 *
 * Overflow drops the NEWEST and counts it, the opposite of the social relay's
 * rule and for the opposite reason. The relay carries a rolling conversation
 * where the current message is worth more than a stale one; this carries
 * EVIDENCE, and the first sighting of an incident is the one an operator most
 * needs, because everything after it is downstream of the same breach. The
 * suppressed count rides out with the drain so the notification can say how much
 * it is not showing rather than quietly presenting a partial picture as whole.
 */
export function enqueueEconomyAlert(item: QueuedEconomyAlert): void {
  if (QUEUE.length >= ECONOMY_ALERT_MAX_QUEUE) {
    suppressed += 1;
    return;
  }
  QUEUE.push(item);
}

/** Convert filed findings into notifications, keeping only the criticals. */
export function notifyEconomyAlerts(realm: string, alerts: readonly EconomyAlert[]): void {
  for (const a of alerts) {
    if (a.severity !== 'critical') continue;
    enqueueEconomyAlert({
      realm,
      kind: a.kind,
      severity: 'critical',
      characterId: a.characterId,
      delta: a.delta,
      detail: a.detail,
    });
  }
}

export interface EconomyAlertDrain {
  items: QueuedEconomyAlert[];
  /** Findings the cap refused since the last drain. */
  suppressed: number;
}

/** Remove and return everything queued (the bot calls this each poll). */
export function drainEconomyAlerts(): EconomyAlertDrain {
  const items = QUEUE.splice(0, QUEUE.length);
  const dropped = suppressed;
  suppressed = 0;
  return { items, suppressed: dropped };
}

/**
 * Put a failed drain's items BACK at the front, in order, so a poll whose
 * response failed to build costs a retry rather than the findings themselves.
 *
 * The suppressed count is restored too. It is not decoration: it is the only
 * record that the queue ever refused anything, and losing it on a retry would
 * turn a partial view into one that claims to be complete.
 *
 * HONEST LIMIT, the same one the relay's requeue carries: if the queue refilled
 * past the cap during the failed poll, the requeued items no longer fit and the
 * excess is counted as suppressed rather than stored. They are the OLDEST here,
 * so unlike the relay this keeps them and refuses the newcomers, which is the
 * ordering this queue wants anyway.
 */
export function requeueEconomyAlerts(drain: EconomyAlertDrain): void {
  suppressed += drain.suppressed;
  const room = Math.max(0, ECONOMY_ALERT_MAX_QUEUE - QUEUE.length);
  const keep = drain.items.slice(0, room);
  suppressed += drain.items.length - keep.length;
  if (keep.length > 0) QUEUE.unshift(...keep);
}

/** Current queue depth (for tests and diagnostics). */
export function economyAlertQueueDepth(): number {
  return QUEUE.length;
}

/** Drop everything, for tests that need a clean process-global queue. */
export function resetEconomyAlertOutboxForTests(): void {
  QUEUE.length = 0;
  suppressed = 0;
}
