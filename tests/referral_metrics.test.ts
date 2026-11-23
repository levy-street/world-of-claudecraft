import { Registry } from 'prom-client';
import { expect, it } from 'vitest';
import { referralDiagnostics, registerReferralMetrics } from '../server/referral_metrics';

it('exports cached aggregate diagnostics without player identity labels', async () => {
  const registry = new Registry();
  registerReferralMetrics(registry);
  referralDiagnostics.dbAdmitted = 3;
  referralDiagnostics.evidenceDepth = 2;
  referralDiagnostics.evidenceOldestAt = Date.now() - 2000;
  const first = await registry.metrics();
  expect(first).toContain('woc_referral_db_admitted_total 3');
  expect(first).toContain('woc_referral_evidence_pending 2');
  expect(first).not.toContain('account_id');
  expect(first).not.toContain('character_id');
  referralDiagnostics.dbAdmitted = 4;
  expect(await registry.metrics()).toContain('woc_referral_db_admitted_total 4');
});
