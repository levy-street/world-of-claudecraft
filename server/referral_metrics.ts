import { Counter, Gauge, type Registry } from 'prom-client';

/** Process aggregates only: no character/account/receipt labels and no scrape SQL. */
export const referralDiagnostics = {
  dbAdmitted: 0,
  dbRefused: 0,
  dbFailed: 0,
  dbTimeouts: 0,
  dbDurationMs: 0,
  evidenceDepth: 0,
  evidenceOldestAt: 0,
  evidenceParked: 0,
  evidenceOverflow: 0,
  outboxClaimed: 0,
  outboxDelivered: 0,
  outboxFailed: 0,
};

export function registerReferralMetrics(registry: Registry): void {
  const counter = (name: string, help: string, read: () => number) => {
    let previous = 0;
    new Counter({
      name,
      help,
      registers: [registry],
      collect() {
        const current = read();
        this.inc(Math.max(0, current - previous));
        previous = current;
      },
    });
  };
  const gauge = (name: string, help: string, read: () => number) => {
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(read());
      },
    });
  };
  counter(
    'woc_referral_db_admitted_total',
    'Admitted referral database transactions.',
    () => referralDiagnostics.dbAdmitted,
  );
  counter(
    'woc_referral_db_refused_total',
    'Referral transactions refused before pool checkout.',
    () => referralDiagnostics.dbRefused,
  );
  counter(
    'woc_referral_db_failed_total',
    'Failed referral database transactions.',
    () => referralDiagnostics.dbFailed,
  );
  counter(
    'woc_referral_db_timeouts_total',
    'Referral database deadline or statement timeouts.',
    () => referralDiagnostics.dbTimeouts,
  );
  counter(
    'woc_referral_db_duration_seconds_total',
    'Aggregate referral transaction duration in seconds.',
    () => referralDiagnostics.dbDurationMs / 1000,
  );
  gauge(
    'woc_referral_evidence_pending',
    'Buffered referral evidence entries, capped at 512.',
    () => referralDiagnostics.evidenceDepth,
  );
  gauge(
    'woc_referral_evidence_oldest_seconds',
    'Age of the oldest buffered referral evidence.',
    () =>
      referralDiagnostics.evidenceOldestAt
        ? Math.max(0, (Date.now() - referralDiagnostics.evidenceOldestAt) / 1000)
        : 0,
  );
  gauge(
    'woc_referral_evidence_parked',
    'Referral evidence entries waiting for retry backoff.',
    () => referralDiagnostics.evidenceParked,
  );
  counter(
    'woc_referral_evidence_overflow_total',
    'Referral evidence overloads that quarantined affected sessions.',
    () => referralDiagnostics.evidenceOverflow,
  );
  counter(
    'woc_referral_rewards_claimed_total',
    'Referral reward and bond outbox rows claimed.',
    () => referralDiagnostics.outboxClaimed,
  );
  counter(
    'woc_referral_rewards_delivered_total',
    'Referral reward and bond outbox rows settled.',
    () => referralDiagnostics.outboxDelivered,
  );
  counter(
    'woc_referral_rewards_failed_total',
    'Referral reward delivery attempts left pending.',
    () => referralDiagnostics.outboxFailed,
  );
}
